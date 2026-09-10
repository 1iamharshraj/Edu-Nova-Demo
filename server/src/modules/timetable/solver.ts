import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { effectiveTemplate, resolveForDay, serializePeriodTemplate } from '../periodTemplates/service'
import type { PeriodDef } from '../periodTemplates/service'
import { classLabel } from './shared'
import { getTerm } from './service'
import { markBusy, isBusy, doublePairs, type Occupancy, type DraftEntry, type UnplacedItem } from './autogen'
import { activeTypes } from './constraints'
import { resolveAssignment } from './assignmentModes'
import { activeLocksForTerm } from './locks'
import type { autoGenerateBody } from './schema'

// ───────────────────────── Phase T4 §4 — cohort-scoped generation ─────────────────────────
// See phase-t4-solver-core.md §4. `cohortIds` was optional when this phase shipped (the legacy
// ClassSubject-scoped `autoGenerate()` in ./autogen.ts ran whenever it was omitted, keeping Phase 26's
// shipped "Auto-Generate" UI byte-identical); Phase T10 §2 retired that legacy path and made `cohortIds`
// required, so this is now the only generation path, reached via the same POST /auto-generate endpoint.
// This phase is greedy-initial-placement only (no soft-constraint scoring/SA — that's T5), generalized for
// T1's day-of-week PeriodTemplate overrides and scoped through Cohort/TeachingRequirement/
// TeachingAssignment rather than directly through ClassSubject.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] // index 1..6 used (Sun unused, matches TimetableEntry.dayOfWeek)

// Contiguous same-day "class"-kind period runs of exactly `size`, no break inside the run — generalizes
// autogen.ts's doublePairs (size 2) to TRIPLE/BLOCK sizes too (this phase treats BLOCK the same as DOUBLE:
// a documented simplification, refined when T5 adds real block-scheduling semantics).
function contiguousRuns(periods: PeriodDef[], size: number): number[][] {
  if (size <= 1) return periods.filter(p => p.kind === 'class').map(p => [p.idx])
  if (size === 2) return doublePairs(periods).map(([a, b]) => [a, b])
  const sorted = periods.slice().sort((a, b) => a.idx - b.idx)
  const runs: number[][] = []
  for (let i = 0; i + size <= sorted.length; i++) {
    const window = sorted.slice(i, i + size)
    if (window.every(p => p.kind === 'class') && window.every((p, j) => j === 0 || p.start === window[j - 1].end)) {
      runs.push(window.map(p => p.idx))
    }
  }
  return runs
}

const durationSize = (d: string) => (d === 'DOUBLE' || d === 'BLOCK' ? 2 : d === 'TRIPLE' ? 3 : 1)

export async function generateForCohorts(ctx: Ctx, input: z.infer<typeof autoGenerateBody>) {
  const cohortIds = input.cohortIds!
  const term = await getTerm(ctx, input.termId)

  const cohorts = await prisma.cohort.findMany({
    where: { id: { in: cohortIds }, schoolId: ctx.schoolId },
    include: { members: { include: { class: { include: { grade: true } } } } },
  })
  if (cohorts.length !== cohortIds.length) throw new HttpError(404, 'One or more cohorts not found')
  for (const c of cohorts) {
    if (c.academicYearId !== term.academicYearId) {
      throw new HttpError(400, `Cohort "${c.name}" does not belong to this term's academic year`)
    }
  }

  const active = await activeTypes(ctx)
  const enforceTeacherCollision = active.has('TEACHER_COLLISION')
  const enforceRoomCollision = active.has('ROOM_COLLISION')
  const enforceCohortCollision = active.has('COHORT_COLLISION')
  const enforceRoomCapability = active.has('ROOM_CAPABILITY_MATCH')

  const rooms = await prisma.room.findMany({ where: { schoolId: ctx.schoolId } })
  const labRoomIds = rooms.filter(r => r.kind === 'lab').map(r => r.id)

  // Phase T7 §3 — MINIMAL lock integration: full-regenerate/refine must not touch anything an active
  // TimetableLock currently protects (see phase-t7-versioning-override.md §3 — "full 'every lock type
  // respected during solving' is T8's job, not this phase's"). A locked teacher/room is treated as globally
  // busy; a locked day/period is excluded everywhere; a locked ASSIGNMENT excludes that one exact slot; a
  // locked COHORT is skipped entirely for this generation run.
  const locks = await activeLocksForTerm(ctx, term.id)
  const lockedTeacherIds = new Set(locks.filter(l => l.lockType === 'TEACHER').map(l => l.targetId))
  const lockedRoomIds = new Set(locks.filter(l => l.lockType === 'ROOM').map(l => l.targetId))
  const lockedDays = new Set(locks.filter(l => l.lockType === 'DAY').map(l => l.dayOfWeek))
  const lockedPeriods = new Set(locks.filter(l => l.lockType === 'PERIOD').map(l => l.periodIdx))
  const lockedAssignments = new Set(locks.filter(l => l.lockType === 'ASSIGNMENT').map(l => `${l.targetId}:${l.dayOfWeek}:${l.periodIdx}`))
  const lockedCohortIds = new Set(locks.filter(l => l.lockType === 'COHORT').map(l => l.targetId))

  const workingDayPattern = await prisma.workingDayPattern.findFirst({ where: { schoolId: ctx.schoolId, academicYearId: term.academicYearId } })
  const allowedDayNums = workingDayPattern
    ? new Set((workingDayPattern.workingDays as string[]).map(d => DAY_NAMES.indexOf(d)).filter(n => n >= 1 && n <= 6))
    : new Set([1, 2, 3, 4, 5, 6])

  // Same cross-class busy tracking as the legacy generator (autogen.ts) — existing entries elsewhere in
  // the school (including ones the legacy generator produced) block this run too, and vice versa, since
  // both paths write the same TimetableEntry table (roadmap D3).
  const allExisting = await prisma.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, termId: term.id } })
  const targetClassIds = new Set(cohorts.flatMap(c => c.members.map(m => m.classId)))
  const teacherBusy: Occupancy = new Map()
  const roomBusy: Occupancy = new Map()
  for (const e of allExisting) {
    if (input.mode === 'full-regenerate' && targetClassIds.has(e.classId)) continue
    const slot = `${e.dayOfWeek}:${e.periodIdx}`
    if (e.teacherId) markBusy(teacherBusy, e.teacherId, slot)
    if (e.roomId) markBusy(roomBusy, e.roomId, slot)
  }

  const draftEntries: DraftEntry[] = []
  const unplaced: UnplacedItem[] = []
  let conflictsAvoided = 0

  for (const cohort of cohorts) {
    if (lockedCohortIds.has(cohort.id)) {
      unplaced.push({ classId: '', classLabel: cohort.name, classSubjectId: null, subjectName: null, teacherId: null, teacherName: null, remaining: 0, reason: `Cohort "${cohort.name}" is locked (TimetableLock) — skipped by this generation run` })
      continue
    }
    const memberClasses = cohort.members.map(m => m.class)
    if (!memberClasses.length) {
      unplaced.push({ classId: '', classLabel: cohort.name, classSubjectId: null, subjectName: null, teacherId: null, teacherName: null, remaining: 0, reason: `Cohort "${cohort.name}" has no member classes` })
      continue
    }

    // All member classes must share an equivalent period grid for a single session to make sense across
    // all of them at once — this phase uses the first member class's effective base template as the
    // cohort's own template (documented MVP simplification: reconciling genuinely mismatched per-member
    // templates on a cross-section cohort is a T5+ concern).
    const baseTemplate = await effectiveTemplate(ctx.schoolId, memberClasses[0].periodTemplateId)
    if (!baseTemplate) {
      unplaced.push({ classId: memberClasses[0].id, classLabel: cohort.name, classSubjectId: null, subjectName: null, teacherId: null, teacherName: null, remaining: 0, reason: 'No period template configured for this cohort\'s classes — set one up under Academic Setup → Periods first' })
      continue
    }

    // Resolve the actual periods for each candidate day of week (T1 §5 — day-specific overrides, e.g. a
    // Saturday half-day), skipping days that have no periods or aren't a school working day.
    const periodsByDay = new Map<number, PeriodDef[]>()
    for (const day of allowedDayNums) {
      const resolved = await resolveForDay(ctx.schoolId, baseTemplate.id, day)
      if (!resolved) continue
      const periods = serializePeriodTemplate(resolved).periods.filter(p => p.kind === 'class')
      if (periods.length) periodsByDay.set(day, periods)
    }
    const workingDays = [...periodsByDay.keys()].sort((a, b) => a - b)
    if (!workingDays.length) {
      unplaced.push({ classId: memberClasses[0].id, classLabel: cohort.name, classSubjectId: null, subjectName: null, teacherId: null, teacherName: null, remaining: 0, reason: 'No working days with a resolvable period template for this cohort' })
      continue
    }

    const requirements = await prisma.teachingRequirement.findMany({ where: { schoolId: ctx.schoolId, cohortId: cohort.id }, include: { subject: true } })

    // fill-empty keeps each member class's own already-placed entries untouched; full-regenerate treats
    // the whole grid as empty for classes in this generation's scope (the delete happens at commit time,
    // same convention as the legacy generator).
    const ownExisting = input.mode === 'fill-empty' ? allExisting.filter(e => memberClasses.some(c => c.id === e.classId)) : []
    const occupiedByClass = new Map<string, Set<string>>() // classId -> slot set (this cohort's own scratch view)
    for (const c of memberClasses) occupiedByClass.set(c.id, new Set(ownExisting.filter(e => e.classId === c.id).map(e => `${e.dayOfWeek}:${e.periodIdx}`)))
    // Day-repeat relaxation (allowRepeat, below) is tracked per requirement purely from placements made in
    // THIS run — matching the legacy generator's own behavior (it doesn't reconstruct "days already used"
    // from pre-existing entries either, since a fill-empty run's own occupied-slot set already prevents
    // double-booking; only the "spread across days first" heuristic needs the running Set).
    const daysUsedByRequirement = new Map<string, Set<number>>()

    for (const req of requirements) {
      let assignment = await prisma.teachingAssignment.findUnique({ where: { teachingRequirementId: req.id } })
      // T5 §1 — Modes 2-4 (POOL/RANDOM/OPTIMIZED) resolve their teacher lazily, right here, as part of
      // generation (exactly what "the solver picks one from the pool respecting hard constraints" means in
      // practice) — FIXED-mode requirements with no assignment yet still fall through to the unplaced
      // reason below unchanged, so T4's existing behavior for FIXED is byte-identical.
      if (!assignment && req.assignmentMode !== 'FIXED') {
        try {
          assignment = await resolveAssignment(ctx, req.id, term.id, { liveTeacherBusy: teacherBusy })
        } catch (err) {
          const reason = err instanceof HttpError ? err.message : 'Could not resolve a teacher for this requirement'
          unplaced.push({ classId: memberClasses[0].id, classLabel: cohort.name, classSubjectId: null, subjectName: req.subject.name, teacherId: null, teacherName: null, remaining: req.requiredPeriodsPerWeek, reason })
          continue
        }
      }
      if (!assignment) {
        unplaced.push({ classId: memberClasses[0].id, classLabel: cohort.name, classSubjectId: null, subjectName: req.subject.name, teacherId: null, teacherName: null, remaining: req.requiredPeriodsPerWeek, reason: `No teacher assigned to "${req.subject.name}" for this cohort yet — create a Teaching Assignment first` })
        continue
      }

      // TimetableEntry.classSubjectId is required — find-or-create the ClassSubject row per member class
      // this requirement touches (roadmap D3: one TimetableEntry row per underlying Class). Does not
      // overwrite an existing ClassSubject's own teacherId/periodsPerWeek if one already exists — the
      // per-slot teacherId/roomId on TimetableEntry (set below) is what actually drives the schedule.
      const classSubjectByClass = new Map<string, string>()
      for (const cls of memberClasses) {
        let cs = await prisma.classSubject.findUnique({ where: { classId_subjectId: { classId: cls.id, subjectId: req.subjectId } } })
        if (!cs) {
          cs = await prisma.classSubject.create({
            data: { schoolId: ctx.schoolId, classId: cls.id, subjectId: req.subjectId, teacherId: assignment.teacherId, periodsPerWeek: req.requiredPeriodsPerWeek },
          })
        }
        classSubjectByClass.set(cls.id, cs.id)
      }

      const alreadyPlaced = memberClasses[0] ? ownExisting.filter(e => e.classId === memberClasses[0].id && e.classSubjectId === classSubjectByClass.get(memberClasses[0].id)).length : 0
      let need = Math.max(0, req.requiredPeriodsPerWeek - alreadyPlaced)
      if (need === 0) continue

      const daysUsed = daysUsedByRequirement.get(req.id) ?? new Set<number>()
      daysUsedByRequirement.set(req.id, daysUsed)
      const allowRepeat = () => need > workingDays.length - daysUsed.size

      // §3 — a locked day/period/assignment blocks placement here regardless of enforceXCollision (locks
      // are an admin's own explicit instruction, not a toggleable Constraint row).
      const repClassSubjectId = classSubjectByClass.get(memberClasses[0].id) ?? ''
      const lockedSlot = (day: number, idxs: number[]) => lockedDays.has(day) || idxs.some(i => lockedPeriods.has(i)) || idxs.some(i => lockedAssignments.has(`${repClassSubjectId}:${day}:${i}`))

      const freeLabRoom = (slots: string[]) => labRoomIds.filter(id => !lockedRoomIds.has(id)).find(id => slots.every(s => !isBusy(roomBusy, id, s))) ?? null
      const roomOk = (day: number, idxs: number[]): { ok: boolean; roomId: string | null } => {
        if (req.roomRequirement === 'ANY') return { ok: true, roomId: null }
        const slots = idxs.map(i => `${day}:${i}`)
        if (req.roomRequirement === 'SPECIFIC_ROOM') {
          if (!req.specificRoomId) return { ok: false, roomId: null }
          if (lockedRoomIds.has(req.specificRoomId)) return { ok: false, roomId: null }
          if (enforceRoomCollision && !slots.every(s => !isBusy(roomBusy, req.specificRoomId, s))) return { ok: false, roomId: null }
          if (enforceRoomCapability) { /* SPECIFIC_ROOM already names the exact room — capability check is implicit */ }
          return { ok: true, roomId: req.specificRoomId }
        }
        // LAB_TYPE
        if (!enforceRoomCollision) return { ok: true, roomId: labRoomIds.filter(id => !lockedRoomIds.has(id))[0] ?? null }
        const room = freeLabRoom(slots)
        return { ok: !!room, roomId: room }
      }

      const classesOccupiedAt = (day: number, idxs: number[]) => {
        if (!enforceCohortCollision) return false
        return memberClasses.some(c => idxs.some(i => occupiedByClass.get(c.id)!.has(`${day}:${i}`)))
      }
      const teacherBusyAt = (day: number, idxs: number[]) =>
        (enforceTeacherCollision && idxs.some(i => isBusy(teacherBusy, assignment.teacherId, `${day}:${i}`)))
        || lockedTeacherIds.has(assignment.teacherId) || lockedSlot(day, idxs)

      const place = (day: number, idxs: number[], roomId: string | null, isDouble: boolean) => {
        for (const cls of memberClasses) {
          for (const idx of idxs) {
            const slot = `${day}:${idx}`
            occupiedByClass.get(cls.id)!.add(slot)
            draftEntries.push({
              classId: cls.id, classLabel: classLabel(cls), dayOfWeek: day, periodIdx: idx,
              classSubjectId: classSubjectByClass.get(cls.id)!, subjectName: req.subject.name, subjectColor: req.subject.color,
              roomId, roomName: roomId ? rooms.find(r => r.id === roomId)?.name : undefined,
              teacherId: assignment.teacherId, teacherName: undefined, isDoublePeriod: isDouble,
            })
          }
        }
        for (const idx of idxs) markBusy(teacherBusy, assignment.teacherId, `${day}:${idx}`)
        if (roomId) for (const idx of idxs) markBusy(roomBusy, roomId, `${day}:${idx}`)
        daysUsed.add(day)
      }

      const blockSize = durationSize(req.sessionDuration)
      if (blockSize > 1 && req.labDoubleAllowed) {
        let progressed = true
        while (need >= blockSize && progressed) {
          progressed = false
          const repeat = allowRepeat()
          for (const day of workingDays) {
            if (!repeat && daysUsed.has(day)) continue
            const runs = contiguousRuns(periodsByDay.get(day)!, blockSize)
            let placedHere = false
            for (const idxs of runs) {
              if (classesOccupiedAt(day, idxs)) continue
              if (teacherBusyAt(day, idxs)) { conflictsAvoided++; continue }
              const { ok, roomId } = roomOk(day, idxs)
              if (!ok) { conflictsAvoided++; continue }
              place(day, idxs, roomId, true)
              need -= blockSize
              progressed = true
              placedHere = true
              break
            }
            if (placedHere) break
          }
        }
      }

      let progressed = true
      while (need > 0 && progressed) {
        progressed = false
        const repeat = allowRepeat()
        for (const day of workingDays) {
          if (!repeat && daysUsed.has(day)) continue
          let placedHere = false
          for (const p of periodsByDay.get(day)!) {
            const idxs = [p.idx]
            if (classesOccupiedAt(day, idxs)) continue
            if (teacherBusyAt(day, idxs)) { conflictsAvoided++; continue }
            const { ok, roomId } = roomOk(day, idxs)
            if (!ok) { conflictsAvoided++; continue }
            place(day, idxs, roomId, false)
            need -= 1
            progressed = true
            placedHere = true
            break
          }
          if (placedHere) break
        }
      }

      if (need > 0) {
        const teacher = await prisma.user.findUnique({ where: { id: assignment.teacherId }, select: { name: true } })
        const reasonParts = [`No free slot for ${teacher?.name ?? 'the assigned teacher'}'s remaining ${need} ${req.subject.name} period${need === 1 ? '' : 's'} this week`]
        if (req.roomRequirement !== 'ANY' && !labRoomIds.length && req.roomRequirement === 'LAB_TYPE') reasonParts.push('no Lab-type room exists in this school')
        else if (req.roomRequirement !== 'ANY') reasonParts.push('the required room type is booked at every remaining candidate slot')
        else reasonParts.push('the teacher is booked (or the cohort has no free periods left) at every remaining candidate slot')
        unplaced.push({
          classId: memberClasses[0].id, classLabel: cohort.name, classSubjectId: classSubjectByClass.get(memberClasses[0].id) ?? null,
          subjectName: req.subject.name, teacherId: assignment.teacherId, teacherName: teacher?.name ?? null, remaining: need, reason: reasonParts.join(' — '),
        })
      }
    }
  }

  await audit(ctx.schoolId, ctx.actorId, 'auto-generate', 'timetable', term.id, undefined, {
    mode: input.mode, cohortIds, draftEntries: draftEntries.length, unplaced: unplaced.length, conflictsAvoided,
  })

  return { draftEntries, unplaced, conflictsAvoided }
}
