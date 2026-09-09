import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { effectiveTemplate, serializePeriodTemplate } from '../periodTemplates/service'
import type { PeriodDef } from '../periodTemplates/service'
import { classLabel } from './shared'
import { getClass, getTerm, assertSameYear, listEntries, replaceGrid, type EntryInput } from './service'
import type { autoGenerateBody, autoGenerateCommitBody } from './schema'

// ───────────────────────────── Phase 26: timetable auto-generation ─────────────────────────────
//
// A first-draft generator, not an autonomous scheduler (see phase-26-timetable-autogen.md). It fills the
// tedious 80% of a timetable — every ClassSubject's periods/week, placed with a free teacher and (where
// needed) a matching free room — and hands back a DRAFT the admin reviews before committing. It reuses
// the manual builder's own class/term lookups (service.ts#getClass/getTerm/assertSameYear) and, on
// commit, its own write path (service.ts#replaceGrid, so the exact same conflict-check in
// service.ts#validateGrid runs) — never a parallel conflict engine that could disagree with it.

// The project's timetables are always built Mon–Fri (see sampleConstants.ts#DAYS and every seeded
// grid) — dayOfWeek 6 (Saturday) exists in the schema/validation but nothing in this codebase schedules
// into it, so the generator only ever proposes days 1–5.
const WORKING_DAYS = [1, 2, 3, 4, 5]

// No explicit "needs a lab" flag exists anywhere in the schema (Subject/CurriculumSubject/ClassSubject
// all lack one — checked before writing this). Rather than invent a new column for a first-draft
// generator, infer it from the subject name/code, same heuristic a human scheduler would use at a
// glance. Good enough to route Chemistry/Physics/Biology/Computer practicals into a Lab-kind room;
// documented in the final report as the one spot a future `CurriculumSubject.needsLabRoom` boolean
// would clean up if this heuristic ever misfires on a real school's subject naming.
const LAB_SUBJECT_RE = /lab|practical|chemistry|physics|biology|computer/i
const needsLab = (name: string, code: string) => LAB_SUBJECT_RE.test(name) || LAB_SUBJECT_RE.test(code)

export interface DraftEntry {
  classId: string
  classLabel: string
  dayOfWeek: number
  periodIdx: number
  classSubjectId: string
  subjectName: string
  subjectColor: string
  roomId: string | null
  roomName?: string
  teacherId: string | null
  teacherName?: string
  isDoublePeriod: boolean
}

export interface UnplacedItem {
  classId: string
  classLabel: string
  classSubjectId: string | null
  subjectName: string | null
  teacherId: string | null
  teacherName: string | null
  remaining: number
  reason: string
}

type Occupancy = Map<string, Set<string>> // key (teacherId/roomId) -> set of "day:period"

function markBusy(map: Occupancy, key: string, slot: string) {
  const set = map.get(key) ?? new Set<string>()
  set.add(slot)
  map.set(key, set)
}
const isBusy = (map: Occupancy, key: string | null, slot: string) => !!key && !!map.get(key)?.has(slot)

// GET the double-period pairs a template supports: two adjacent class periods with no break between
// them (the second's start equals the first's end). Used to place lab/practical subjects as a block.
function doublePairs(periods: PeriodDef[]): [number, number][] {
  const sorted = periods.slice().sort((a, b) => a.idx - b.idx)
  const pairs: [number, number][] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1]
    if (a.kind === 'class' && b.kind === 'class' && a.end === b.start) pairs.push([a.idx, b.idx])
  }
  return pairs
}

// POST /auto-generate — builds a draft, does not write anything.
export async function autoGenerate(ctx: Ctx, input: z.infer<typeof autoGenerateBody>) {
  const term = await getTerm(ctx, input.termId)

  const classes = input.classId
    ? [await getClass(ctx, input.classId)]
    : await prisma.class.findMany({ where: { schoolId: ctx.schoolId, academicYearId: term.academicYearId }, include: { grade: true } })
  if (input.classId) assertSameYear(classes[0], term)
  if (!classes.length) throw new HttpError(400, 'No classes found for this term’s academic year')

  const targetClassIds = new Set(classes.map(c => c.id))
  const rooms = await prisma.room.findMany({ where: { schoolId: ctx.schoolId } })
  const labRoomIds = rooms.filter(r => r.kind === 'lab').map(r => r.id)

  // Every existing entry in the school for this term — used to know when a teacher/room is already busy
  // elsewhere. A class being fully regenerated has its own current rows excluded here: those rows are
  // about to be deleted at commit time (see commitAutoGenerate), so they must not block new placements.
  const allExisting = await prisma.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, termId: term.id } })
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

  for (const cls of classes) {
    const template = await effectiveTemplate(ctx.schoolId, cls.periodTemplateId)
    if (!template) {
      unplaced.push({
        classId: cls.id, classLabel: classLabel(cls), classSubjectId: null, subjectName: null, teacherId: null, teacherName: null, remaining: 0,
        reason: 'No period template configured for this class — set one up under Academic Setup → Periods first',
      })
      continue
    }
    const periods = serializePeriodTemplate(template).periods
    const classPeriods = periods.filter(p => p.kind === 'class').sort((a, b) => a.idx - b.idx)
    const doubles = doublePairs(periods)

    const classSubjects = await prisma.classSubject.findMany({
      where: { classId: cls.id },
      include: { subject: true, teacher: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })

    // fill-empty keeps this class's own already-placed entries untouched; full-regenerate treats the
    // whole grid as empty (the actual delete happens at commit time).
    const ownExisting = input.mode === 'fill-empty' ? allExisting.filter(e => e.classId === cls.id) : []
    const occupied = new Set(ownExisting.map(e => `${e.dayOfWeek}:${e.periodIdx}`))
    const scheduledCount = new Map<string, number>()
    const daysUsedBySubject = new Map<string, Set<number>>()
    for (const e of ownExisting) {
      scheduledCount.set(e.classSubjectId, (scheduledCount.get(e.classSubjectId) ?? 0) + 1)
      const set = daysUsedBySubject.get(e.classSubjectId) ?? new Set<number>()
      set.add(e.dayOfWeek)
      daysUsedBySubject.set(e.classSubjectId, set)
    }

    const place = (day: number, idx: number, cs: (typeof classSubjects)[number], roomId: string | null, isDoublePeriod: boolean) => {
      const slot = `${day}:${idx}`
      occupied.add(slot)
      if (cs.teacherId) markBusy(teacherBusy, cs.teacherId, slot)
      if (roomId) markBusy(roomBusy, roomId, slot)
      daysFor(cs.id).add(day)
      draftEntries.push({
        classId: cls.id, classLabel: classLabel(cls), dayOfWeek: day, periodIdx: idx,
        classSubjectId: cs.id, subjectName: cs.subject.name, subjectColor: cs.subject.color,
        roomId, roomName: roomId ? rooms.find(r => r.id === roomId)?.name : undefined,
        teacherId: cs.teacherId, teacherName: cs.teacher?.name, isDoublePeriod,
      })
    }

    // Free lab room at one or two contiguous slots on the same day.
    const freeLabRoom = (slots: string[]) => labRoomIds.find(id => slots.every(s => !isBusy(roomBusy, id, s))) ?? null
    // The same mutable Set instance every caller shares for a given classSubject, so placements made
    // mid-loop (via place() above) are immediately visible to the "already used this day" checks below.
    const daysFor = (classSubjectId: string) => {
      let set = daysUsedBySubject.get(classSubjectId)
      if (!set) { set = new Set<number>(); daysUsedBySubject.set(classSubjectId, set) }
      return set
    }

    for (const cs of classSubjects) {
      const already = scheduledCount.get(cs.id) ?? 0
      let need = Math.max(0, cs.periodsPerWeek - already)
      if (need === 0) continue
      const wantsLab = needsLab(cs.subject.name, cs.subject.code)
      const daysUsed = daysFor(cs.id)

      // The no-double-same-subject-same-day rule, relaxed exactly when the spec says to: recomputed
      // before every placement (not just once) so it reacts to the actual remaining capacity, not merely
      // to "has this subject touched every day yet" — a fully-booked day the subject was never placed on
      // still doesn't count as spare capacity. Once what's left literally cannot fit one-per-day into the
      // days not yet used, allow repeats on an already-used day rather than under-filling and giving up.
      const allowRepeat = () => need > WORKING_DAYS.length - daysUsed.size

      // Lab double-period block first, while >=2 periods remain.
      if (wantsLab) {
        let progressed = true
        while (need >= 2 && progressed) {
          progressed = false
          const repeat = allowRepeat()
          for (const day of WORKING_DAYS) {
            if (!repeat && daysUsed.has(day)) continue
            for (const [a, b] of doubles) {
              const slotA = `${day}:${a}`, slotB = `${day}:${b}`
              if (occupied.has(slotA) || occupied.has(slotB)) continue
              if (isBusy(teacherBusy, cs.teacherId, slotA) || isBusy(teacherBusy, cs.teacherId, slotB)) { conflictsAvoided++; continue }
              const room = freeLabRoom([slotA, slotB])
              if (!room) { conflictsAvoided++; continue }
              place(day, a, cs, room, true)
              place(day, b, cs, room, true)
              need -= 2
              progressed = true
              break
            }
            if (progressed) break
          }
        }
      }

      // Single-period placement for whatever remains.
      let progressed = true
      while (need > 0 && progressed) {
        progressed = false
        const repeat = allowRepeat()
        for (const day of WORKING_DAYS) {
          if (!repeat && daysUsed.has(day)) continue
          for (const p of classPeriods) {
            const slot = `${day}:${p.idx}`
            if (occupied.has(slot)) continue
            if (isBusy(teacherBusy, cs.teacherId, slot)) { conflictsAvoided++; continue }
            let room: string | null = null
            if (wantsLab) {
              room = freeLabRoom([slot])
              if (!room) { conflictsAvoided++; continue }
            }
            place(day, p.idx, cs, room, false)
            need -= 1
            progressed = true
            break
          }
          if (progressed) break
        }
      }

      if (need > 0) {
        const reasonParts = [`No free slot for ${cs.teacher?.name ?? 'the assigned teacher'}'s remaining ${need} ${cs.subject.name} period${need === 1 ? '' : 's'} this week`]
        if (wantsLab && !labRoomIds.length) reasonParts.push('no Lab-type room exists in this school')
        else if (wantsLab) reasonParts.push('every Lab room is booked at the remaining candidate slots')
        else reasonParts.push('the teacher is booked (or the class has no free periods left) at every remaining candidate slot')
        unplaced.push({
          classId: cls.id, classLabel: classLabel(cls), classSubjectId: cs.id, subjectName: cs.subject.name,
          teacherId: cs.teacherId, teacherName: cs.teacher?.name ?? null, remaining: need, reason: reasonParts.join(' — '),
        })
      }
    }
  }

  await audit(ctx.schoolId, ctx.actorId, 'auto-generate', 'timetable', term.id, undefined, {
    mode: input.mode, classIds: [...targetClassIds], draftEntries: draftEntries.length, unplaced: unplaced.length, conflictsAvoided,
  })

  return { draftEntries, unplaced, conflictsAvoided }
}

// POST /auto-generate/commit — writes the draft via the exact same path the manual "add entry" endpoint
// uses (replaceGrid → validateGrid), grouped per class. fill-empty merges the draft onto each class's
// current grid (nothing already placed is touched or deleted); full-regenerate replaces the whole grid,
// so any manually-placed entries not present in draftEntries are deleted — the destructive path the
// frontend must gate behind an explicit confirmation.
export async function commitAutoGenerate(ctx: Ctx, input: z.infer<typeof autoGenerateCommitBody>) {
  if (!input.draftEntries.length) throw new HttpError(400, 'No draft entries to commit')
  const term = await getTerm(ctx, input.termId)

  const byClass = new Map<string, EntryInput[]>()
  for (const e of input.draftEntries) {
    const arr = byClass.get(e.classId) ?? []
    arr.push({ dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId, roomId: e.roomId ?? null, teacherId: e.teacherId ?? null })
    byClass.set(e.classId, arr)
  }

  const results: { classId: string; entries: number }[] = []
  for (const [classId, newEntries] of byClass) {
    const cls = await getClass(ctx, classId)
    assertSameYear(cls, term)
    let finalEntries = newEntries
    if (input.mode === 'fill-empty') {
      const existing = await listEntries(classId, term.id)
      finalEntries = [
        ...existing.map(e => ({ dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId, roomId: e.roomId, teacherId: e.teacherId })),
        ...newEntries,
      ]
    }
    const after = await replaceGrid(ctx, { classId, termId: term.id, entries: finalEntries })
    results.push({ classId, entries: after.length })
  }

  await audit(ctx.schoolId, ctx.actorId, 'auto-generate-commit', 'timetable', term.id, undefined, {
    mode: input.mode, classes: [...byClass.keys()], entriesCommitted: input.draftEntries.length,
  })
  return { committed: input.draftEntries.length, classes: results }
}
