import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { effectiveTemplate, resolveForDay, serializePeriodTemplate } from '../periodTemplates/service'
import { classLabel } from './shared'
import { getTerm } from './service'
import { getVersion, computeDiff, serializeVersion, type VersionEntry } from './versions'
import { activeLocksForTerm, lockBlocks, type EntryLike } from './locks'
import { needsLab, markBusy, isBusy, type Occupancy } from './autogen'
import { activeTypes } from './constraints'
import { simulatedAnneal, effectiveRefinementWeights, type RefineEntry, type ProblemContext } from './refinement'
import { computeDiagnostics, type Diagnostic } from './diagnostics'
import type { whatIfBody } from './schema'

// ───────────────────────── Phase T8 — What-If / partial re-optimization ─────────────────────────
// See phase-t8-what-if.md. Read T7's versions.ts/locks.ts/overrides.ts doc comments first — this module is
// what "genuinely respect every lock type during a real partial re-solve" (not the T7 minimal skip-locked-
// stuff integration in solver.ts/autogen.ts) looks like, plus the "identify the minimal affected region"
// capability the roadmap calls a major product capability.
//
// Design: a changeEvent is exactly "one more hard constraint became true/false for a specific slot" (per
// the spec) — TEACHER_UNAVAILABLE/ROOM_UNAVAILABLE/PERIOD_REMOVED/EVENT_BLOCKING_SLOTS all reduce to "these
// existing sessions must leave their current slot", and REQUIREMENT_ADDED/REQUIREMENT_CHANGED reduce to
// "this cohort needs N more (or fewer) placements of one classSubject". Every OTHER session in the version
// — everything not touched by one of those two shapes, and (belt-and-suspenders) anything an active
// TimetableLock protects regardless of the event — is frozen: copied into the patched entries array
// byte-for-byte, never even passed to the placement/SA code below. That's what makes "97% untouched" true
// by construction, not just plausible.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type ChangeEvent = z.infer<typeof whatIfBody>['changeEvent']
type SlotRef = { dayOfWeek: number; periodIdx: number }
const slotKeyOf = (s: { dayOfWeek: number; periodIdx: number }) => `${s.dayOfWeek}:${s.periodIdx}`

export interface WhatIfUnplaced {
  classId: string; classLabel: string; classSubjectId: string | null; subjectName: string | null
  teacherId: string | null; teacherName: string | null; remaining: number; reason: string
}

export interface LockConflict { entry: VersionEntry; lockId: string; lockType: string; reason?: string }

export interface WhatIfResult {
  item: ReturnType<typeof serializeVersion>
  changeEvent: ChangeEvent
  draftEntries: VersionEntry[]
  unplaced: WhatIfUnplaced[]
  diagnostics: Diagnostic[]
  lockConflicts: LockConflict[]
  summary: { affectedSessionCount: number; unaffectedSessionCount: number; affectedCohorts: { id: string; name: string }[] }
}

// ───────────────────────── shared lookups ─────────────────────────

async function classGrid(ctx: Ctx, cls: { periodTemplateId: string | null; academicYearId: string }) {
  const template = await effectiveTemplate(ctx.schoolId, cls.periodTemplateId)
  if (!template) return { workingDays: [] as number[], periodsByDay: new Map<number, number[]>() }
  const workingDayPattern = await prisma.workingDayPattern.findFirst({ where: { schoolId: ctx.schoolId, academicYearId: cls.academicYearId } })
  const allowedDayNums = workingDayPattern
    ? new Set((workingDayPattern.workingDays as string[]).map(d => DAY_NAMES.indexOf(d)).filter(n => n >= 1 && n <= 6))
    : new Set([1, 2, 3, 4, 5, 6])
  const periodsByDay = new Map<number, number[]>()
  for (const day of allowedDayNums) {
    const resolved = await resolveForDay(ctx.schoolId, template.id, day)
    if (!resolved) continue
    const idxs = serializePeriodTemplate(resolved).periods.filter(p => p.kind === 'class').map(p => p.idx)
    if (idxs.length) periodsByDay.set(day, idxs)
  }
  return { workingDays: [...periodsByDay.keys()].sort((a, b) => a - b), periodsByDay }
}

// ───────────────────────── main entry point ─────────────────────────

export async function whatIf(ctx: Ctx, input: z.infer<typeof whatIfBody>): Promise<WhatIfResult> {
  const version = await getVersion(ctx, input.versionId)
  const event = input.changeEvent
  const term = await getTerm(ctx, version.termId)
  const scopeClassIds = version.scopeClassIds as string[]
  if (!scopeClassIds.length) throw new HttpError(400, 'Version has no scoped classes to patch')

  const entries = version.entries as unknown as VersionEntry[]
  const classes = await prisma.class.findMany({ where: { id: { in: scopeClassIds }, schoolId: ctx.schoolId }, include: { grade: true } })
  const classById = new Map(classes.map(c => [c.id, c]))
  const gridByClass = new Map<string, { workingDays: number[]; periodsByDay: Map<number, number[]> }>()
  for (const c of classes) gridByClass.set(c.id, await classGrid(ctx, c))

  const rooms = await prisma.room.findMany({ where: { schoolId: ctx.schoolId } })
  const labRoomIds = new Set(rooms.filter(r => r.kind === 'lab').map(r => r.id))

  const active = await activeTypes(ctx)
  const enforceTeacherCollision = active.has('TEACHER_COLLISION')
  const enforceRoomCollision = active.has('ROOM_COLLISION')

  const locks = await activeLocksForTerm(ctx, term.id)
  const lockedRoomIds = new Set(locks.filter(l => l.lockType === 'ROOM').map(l => l.targetId).filter((x): x is string => !!x))

  // Cohort membership for every class touched, for both lockBlocks' cohortIds argument and the summary's
  // affectedCohorts[] — collected once for the whole version scope.
  const cohortRows = await prisma.cohort.findMany({ where: { schoolId: ctx.schoolId, members: { some: { classId: { in: scopeClassIds } } } }, include: { members: true } })
  const cohortIdsByClass = new Map<string, string[]>()
  for (const c of cohortRows) for (const m of c.members) {
    const arr = cohortIdsByClass.get(m.classId) ?? []
    arr.push(c.id)
    cohortIdsByClass.set(m.classId, arr)
  }
  const cohortById = new Map(cohortRows.map(c => [c.id, c]))

  const entryLike = (e: { classId: string; classSubjectId: string; teacherId: string | null; roomId: string | null; sessionId: string | null; dayOfWeek: number; periodIdx: number }): EntryLike => e
  const lockBlockingEntry = (e: VersionEntry) => locks.find(l => lockBlocks(l, cohortIdsByClass.get(e.classId) ?? [], entryLike(e)))
  const anyLockBlocksCandidate = (candidates: EntryLike[]) => locks.some(l => candidates.some(c => lockBlocks(l, cohortIdsByClass.get(c.classId) ?? [], c)))

  // classSubject -> subject name/code (for the needsLab heuristic, same one autogen.ts/overrides.ts use).
  const classSubjectIds = [...new Set(entries.map(e => e.classSubjectId))]
  const classSubjectRows = classSubjectIds.length ? await prisma.classSubject.findMany({ where: { id: { in: classSubjectIds } }, include: { subject: true } }) : []
  const subjectInfoByCs = new Map(classSubjectRows.map(cs => [cs.id, { name: cs.subject.name, code: cs.subject.code, color: cs.subject.color }]))
  const wantsLabFor = (classSubjectId: string) => { const s = subjectInfoByCs.get(classSubjectId); return s ? needsLab(s.name, s.code) : false }

  // ───────────────────────── step 1: identify the seed set the event directly touches ─────────────────────────

  let movableSeed: VersionEntry[] = []
  let toRemove: VersionEntry[] = []
  let newSessionSpecs: { memberClassIds: string[]; classSubjectByClass: Map<string, string>; teacherId: string; roomRequirement: string; specificRoomId: string | null; subjectName: string }[] = []
  const preUnplaced: WhatIfUnplaced[] = []
  const forbidden = { teacherSlots: new Set<string>(), roomSlots: new Set<string>(), classSlots: new Set<string>() } // "key@day:period"

  switch (event.type) {
    case 'TEACHER_UNAVAILABLE': {
      const bad = new Set(event.slots.map(slotKeyOf))
      for (const s of event.slots) forbidden.teacherSlots.add(`${event.teacherId}@${slotKeyOf(s)}`)
      movableSeed = entries.filter(e => e.teacherId === event.teacherId && bad.has(slotKeyOf(e)))
      break
    }
    case 'ROOM_UNAVAILABLE': {
      const bad = new Set(event.slots.map(slotKeyOf))
      for (const s of event.slots) forbidden.roomSlots.add(`${event.roomId}@${slotKeyOf(s)}`)
      movableSeed = entries.filter(e => e.roomId === event.roomId && bad.has(slotKeyOf(e)))
      break
    }
    case 'PERIOD_REMOVED': {
      const slot = slotKeyOf(event)
      for (const cid of scopeClassIds) forbidden.classSlots.add(`${cid}@${slot}`)
      movableSeed = entries.filter(e => e.dayOfWeek === event.dayOfWeek && e.periodIdx === event.periodIdx)
      break
    }
    case 'EVENT_BLOCKING_SLOTS': {
      let targetClassIds = scopeClassIds
      if (event.classIds?.length) targetClassIds = event.classIds.filter(id => scopeClassIds.includes(id))
      else if (event.cohortIds?.length) {
        const members = new Set<string>()
        for (const cid of event.cohortIds) for (const m of cohortById.get(cid)?.members ?? []) members.add(m.classId)
        targetClassIds = scopeClassIds.filter(id => members.has(id))
      }
      const bad = new Set(event.slots.map(slotKeyOf))
      for (const cid of targetClassIds) for (const s of event.slots) forbidden.classSlots.add(`${cid}@${slotKeyOf(s)}`)
      const targetSet = new Set(targetClassIds)
      movableSeed = entries.filter(e => targetSet.has(e.classId) && bad.has(slotKeyOf(e)))
      break
    }
    case 'REQUIREMENT_ADDED':
    case 'REQUIREMENT_CHANGED': {
      const req = await prisma.teachingRequirement.findFirst({ where: { id: event.teachingRequirementId, schoolId: ctx.schoolId }, include: { subject: true, cohort: { include: { members: { include: { class: true } } } } } })
      if (!req) throw notFound('Teaching requirement')
      const memberClassIds = req.cohort.members.map(m => m.classId)
      if (!memberClassIds.length) throw new HttpError(400, `Cohort "${req.cohort.name}" has no member classes`)
      if (!memberClassIds.every(id => scopeClassIds.includes(id))) {
        throw new HttpError(400, `Requirement's cohort "${req.cohort.name}" is not fully within this version's scope — fork/patch a version covering it first`)
      }
      const assignment = await prisma.teachingAssignment.findUnique({ where: { teachingRequirementId: req.id } })
      if (!assignment) {
        preUnplaced.push({ classId: memberClassIds[0], classLabel: req.cohort.name, classSubjectId: null, subjectName: req.subject.name, teacherId: null, teacherName: null, remaining: req.requiredPeriodsPerWeek, reason: `No teacher assigned to "${req.subject.name}" for this cohort yet — create a Teaching Assignment first` })
        break
      }
      const classSubjectByClass = new Map<string, string>()
      for (const cid of memberClassIds) {
        let cs = await prisma.classSubject.findUnique({ where: { classId_subjectId: { classId: cid, subjectId: req.subjectId } } })
        if (!cs) cs = await prisma.classSubject.create({ data: { schoolId: ctx.schoolId, classId: cid, subjectId: req.subjectId, teacherId: assignment.teacherId, periodsPerWeek: req.requiredPeriodsPerWeek } })
        classSubjectByClass.set(cid, cs.id)
      }
      const repClassSubjectId = classSubjectByClass.get(memberClassIds[0])!
      const alreadyPlaced = entries.filter(e => e.classId === memberClassIds[0] && e.classSubjectId === repClassSubjectId).length
      const delta = req.requiredPeriodsPerWeek - alreadyPlaced

      if (delta > 0) {
        for (let i = 0; i < delta; i++) {
          newSessionSpecs.push({ memberClassIds, classSubjectByClass, teacherId: assignment.teacherId, roomRequirement: req.roomRequirement, specificRoomId: req.specificRoomId, subjectName: req.subject.name })
        }
      } else if (delta < 0) {
        const need = -delta
        const candidateSlots = entries.filter(e => e.classId === memberClassIds[0] && e.classSubjectId === repClassSubjectId)
          .map(e => ({ dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx }))
          .sort((a, b) => (b.dayOfWeek - a.dayOfWeek) || (b.periodIdx - a.periodIdx))
        let picked = 0
        for (const slot of candidateSlots) {
          if (picked >= need) break
          const groupEntries = memberClassIds.map(cid => entries.find(e => e.classId === cid && e.classSubjectId === classSubjectByClass.get(cid) && e.dayOfWeek === slot.dayOfWeek && e.periodIdx === slot.periodIdx)).filter((e): e is VersionEntry => !!e)
          if (groupEntries.some(e => lockBlockingEntry(e))) continue // a locked member of this cohort session — pick a different slot instead
          toRemove.push(...groupEntries)
          picked++
        }
        if (picked < need) {
          preUnplaced.push({ classId: memberClassIds[0], classLabel: req.cohort.name, classSubjectId: repClassSubjectId, subjectName: req.subject.name, teacherId: assignment.teacherId, teacherName: null, remaining: need - picked, reason: `${need - picked} of this cohort's own "${req.subject.name}" session(s) sit under an active TimetableLock and could not be removed to satisfy the lowered requirement` })
        }
      }
      break
    }
  }

  // Locks are fully respected: any seed entry an active lock protects is excluded from movement outright —
  // it stays exactly where it is, and the tension is surfaced as a lockConflicts[] entry rather than
  // silently either violating the lock or violating the event.
  const lockConflicts: LockConflict[] = []
  const movable: VersionEntry[] = []
  for (const e of movableSeed) {
    const blocker = lockBlockingEntry(e)
    if (blocker) lockConflicts.push({ entry: e, lockId: blocker.id, lockType: blocker.lockType, reason: blocker.reason ?? undefined })
    else movable.push(e)
  }
  toRemove = toRemove.filter(e => {
    const blocker = lockBlockingEntry(e)
    if (blocker) { lockConflicts.push({ entry: e, lockId: blocker.id, lockType: blocker.lockType, reason: blocker.reason ?? undefined }); return false }
    return true
  })

  // ───────────────────────── step 2: frozen occupancy (everything else — the "97% untouched" set) ─────────────────────────

  const movableKeys = new Set(movable.map(e => `${e.classId}:${e.dayOfWeek}:${e.periodIdx}`))
  const removeKeys = new Set(toRemove.map(e => `${e.classId}:${e.dayOfWeek}:${e.periodIdx}`))
  const frozen = entries.filter(e => !movableKeys.has(`${e.classId}:${e.dayOfWeek}:${e.periodIdx}`) && !removeKeys.has(`${e.classId}:${e.dayOfWeek}:${e.periodIdx}`))

  const classBusy: Occupancy = new Map()
  const teacherBusy: Occupancy = new Map()
  const roomBusy: Occupancy = new Map()
  for (const e of frozen) {
    const slot = `${e.dayOfWeek}:${e.periodIdx}`
    markBusy(classBusy, e.classId, slot)
    if (e.teacherId) markBusy(teacherBusy, e.teacherId, slot)
    if (e.roomId) markBusy(roomBusy, e.roomId, slot)
  }
  // Rest of the school's live schedule (outside this version's own scope) — same cross-check every
  // generation path in this codebase performs.
  const outside = await prisma.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, termId: term.id, classId: { notIn: scopeClassIds } } })
  for (const e of outside) {
    const slot = `${e.dayOfWeek}:${e.periodIdx}`
    if (e.teacherId) markBusy(teacherBusy, e.teacherId, slot)
    if (e.roomId) markBusy(roomBusy, e.roomId, slot)
  }
  for (const key of forbidden.teacherSlots) { const [id, slot] = key.split('@'); markBusy(teacherBusy, id, slot) }
  for (const key of forbidden.roomSlots) { const [id, slot] = key.split('@'); markBusy(roomBusy, id, slot) }
  for (const key of forbidden.classSlots) { const [id, slot] = key.split('@'); markBusy(classBusy, id, slot) }

  // ───────────────────────── step 3: greedy relocation / placement of the affected region only ─────────────────────────

  const pickRoom = (existingRoomId: string | null, wantsLab: boolean, slot: string): { ok: boolean; roomId: string | null } => {
    if (!existingRoomId && !wantsLab) return { ok: true, roomId: null }
    if (wantsLab || (existingRoomId && labRoomIds.has(existingRoomId))) {
      if (existingRoomId && !lockedRoomIds.has(existingRoomId) && !(enforceRoomCollision && isBusy(roomBusy, existingRoomId, slot))) return { ok: true, roomId: existingRoomId }
      const alt = [...labRoomIds].filter(id => !lockedRoomIds.has(id)).find(id => !(enforceRoomCollision && isBusy(roomBusy, id, slot)))
      return alt ? { ok: true, roomId: alt } : { ok: false, roomId: null }
    }
    if (!existingRoomId) return { ok: true, roomId: null }
    if (!lockedRoomIds.has(existingRoomId) && !(enforceRoomCollision && isBusy(roomBusy, existingRoomId, slot))) return { ok: true, roomId: existingRoomId }
    return { ok: false, roomId: null }
  }

  // `relocated` holds only sessions that GENUINELY moved (a new day/period/room) — these, plus any brand-
  // new placements below, are what "affected" means. `stuck` holds seed sessions the event targeted but
  // that no conflict-free slot could be found for (a real infeasibility, surfaced via unplaced[] below,
  // not silently dropped) — they stay exactly where they are, so they rejoin the frozen set unchanged and
  // are correctly NOT counted as affected (nothing about them actually changed).
  const relocated: VersionEntry[] = []
  const stuck: VersionEntry[] = []
  const unplaced: WhatIfUnplaced[] = [...preUnplaced]

  for (const e of movable) {
    const grid = gridByClass.get(e.classId)
    let placed: VersionEntry | null = null
    outer: for (const day of grid?.workingDays ?? []) {
      for (const idx of grid?.periodsByDay.get(day) ?? []) {
        if (day === e.dayOfWeek && idx === e.periodIdx) continue
        const slot = `${day}:${idx}`
        if (isBusy(classBusy, e.classId, slot)) continue // a class's own grid can never legitimately double-book one slot, toggle or not
        if (e.teacherId && enforceTeacherCollision && isBusy(teacherBusy, e.teacherId, slot)) continue
        const room = pickRoom(e.roomId, wantsLabFor(e.classSubjectId), slot)
        if (!room.ok) continue
        const candidate: EntryLike = { classId: e.classId, classSubjectId: e.classSubjectId, teacherId: e.teacherId, roomId: room.roomId, sessionId: e.sessionId, dayOfWeek: day, periodIdx: idx }
        if (anyLockBlocksCandidate([candidate])) continue
        markBusy(classBusy, e.classId, slot)
        if (e.teacherId) markBusy(teacherBusy, e.teacherId, slot)
        if (room.roomId) markBusy(roomBusy, room.roomId, slot)
        placed = { ...e, dayOfWeek: day, periodIdx: idx, roomId: room.roomId }
        break outer
      }
    }
    if (placed) relocated.push(placed)
    else {
      const info = subjectInfoByCs.get(e.classSubjectId)
      unplaced.push({
        classId: e.classId, classLabel: classLabel(classById.get(e.classId)!), classSubjectId: e.classSubjectId,
        subjectName: info?.name ?? null, teacherId: e.teacherId, teacherName: null, remaining: 1,
        reason: `No conflict-free slot found for this session once the triggering change (${event.type}) is applied`,
      })
      // Genuinely infeasible to relocate — kept in place rather than silently dropped, and re-marked busy so
      // later placements in this same run don't double-book it.
      const slot = `${e.dayOfWeek}:${e.periodIdx}`
      markBusy(classBusy, e.classId, slot)
      if (e.teacherId) markBusy(teacherBusy, e.teacherId, slot)
      if (e.roomId) markBusy(roomBusy, e.roomId, slot)
      stuck.push(e)
    }
  }

  const newlyPlaced: VersionEntry[] = []
  for (const spec of newSessionSpecs) {
    // A cohort session needs a slot free across EVERY member class's own template AND every member class's
    // occupancy simultaneously — intersect the member classes' own candidate grids (a class not actually
    // sharing a slot with the others simply never matches, same as generateForCohorts' own single template
    // assumption for a cohort's members).
    const grids = spec.memberClassIds.map(cid => gridByClass.get(cid)).filter((g): g is NonNullable<typeof g> => !!g)
    const commonDays = grids.length ? grids[0].workingDays.filter(d => grids.every(g => g.workingDays.includes(d))) : []
    let placed: VersionEntry[] | null = null
    outer2: for (const day of commonDays) {
      const commonIdxs = grids[0].periodsByDay.get(day)!.filter(idx => grids.every(g => g.periodsByDay.get(day)?.includes(idx)))
      for (const idx of commonIdxs) {
        const slot = `${day}:${idx}`
        if (spec.memberClassIds.some(cid => isBusy(classBusy, cid, slot))) continue // same — structural, not a toggleable constraint
        if (enforceTeacherCollision && isBusy(teacherBusy, spec.teacherId, slot)) continue
        let roomId: string | null = null
        if (spec.roomRequirement === 'SPECIFIC_ROOM') {
          if (!spec.specificRoomId || lockedRoomIds.has(spec.specificRoomId) || (enforceRoomCollision && isBusy(roomBusy, spec.specificRoomId, slot))) continue
          roomId = spec.specificRoomId
        } else if (spec.roomRequirement === 'LAB_TYPE') {
          const alt = [...labRoomIds].filter(id => !lockedRoomIds.has(id)).find(id => !(enforceRoomCollision && isBusy(roomBusy, id, slot)))
          if (!alt) continue
          roomId = alt
        }
        const candidates: EntryLike[] = spec.memberClassIds.map(cid => ({ classId: cid, classSubjectId: spec.classSubjectByClass.get(cid)!, teacherId: spec.teacherId, roomId, sessionId: null, dayOfWeek: day, periodIdx: idx }))
        if (anyLockBlocksCandidate(candidates)) continue
        markBusy(teacherBusy, spec.teacherId, slot)
        if (roomId) markBusy(roomBusy, roomId, slot)
        placed = candidates.map(c => { markBusy(classBusy, c.classId, slot); return { classId: c.classId, dayOfWeek: day, periodIdx: idx, classSubjectId: c.classSubjectId, roomId, teacherId: spec.teacherId, sessionId: null } })
        break outer2
      }
      if (placed) break
    }
    if (placed) newlyPlaced.push(...placed)
    else {
      const repClass = classById.get(spec.memberClassIds[0])
      unplaced.push({ classId: spec.memberClassIds[0], classLabel: repClass ? classLabel(repClass) : spec.memberClassIds[0], classSubjectId: spec.classSubjectByClass.get(spec.memberClassIds[0]) ?? null, subjectName: spec.subjectName, teacherId: spec.teacherId, teacherName: null, remaining: 1, reason: `No free slot for this cohort's added "${spec.subjectName}" period across every member class simultaneously` })
    }
  }

  // ───────────────────────── step 4: SA polish over just the touched region (T5's actual scorer/mover) ─────────────────────────
  // Small, additive quality pass — the greedy placement above is already hard-constraint-safe on its own.
  // Only runs when every touched class shares common candidate slots (guaranteed valid for ALL of them,
  // never just some) and there's more than one entry to meaningfully move around.
  const touchedForSA = [...relocated, ...newlyPlaced]
  let saPolished = touchedForSA
  if (touchedForSA.length > 1) {
    const touchedClassIds = [...new Set(touchedForSA.map(e => e.classId))]
    const grids = touchedClassIds.map(cid => gridByClass.get(cid)).filter((g): g is NonNullable<typeof g> => !!g)
    const commonDays = grids.length ? grids[0].workingDays.filter(d => grids.every(g => g.workingDays.includes(d))) : []
    const commonPeriodsByDay = new Map<number, number[]>()
    for (const day of commonDays) {
      const idxs = grids[0].periodsByDay.get(day)!.filter(idx => grids.every(g => g.periodsByDay.get(day)?.includes(idx)))
      if (idxs.length) commonPeriodsByDay.set(day, idxs)
    }
    const hasAssignmentLockNearby = locks.some(l => l.lockType === 'ASSIGNMENT' && touchedForSA.some(e => e.classSubjectId === l.targetId))
    if (commonDays.length && !hasAssignmentLockNearby) {
      // classSlot: every FROZEN entry's own class+day+period, not just teacher/room — this is what closes
      // the same-class double-booking gap ExternalOccupancy's own doc comment describes. `frozen` here
      // holds the rest of a touched class's sessions that this SA pass never sees directly (it only
      // receives `touchedForSA`), so without this a relocate/swap move could land a touched session
      // straight on top of one of its own class's already-placed frozen sessions. `outside` entries belong
      // to classes outside this version's scope entirely, so they can never share a classId with anything
      // in `touchedForSA` — included anyway for uniformity with the teacher/room loop, costs nothing.
      const external = { teacherSlot: new Map<string, Set<string>>(), roomSlot: new Map<string, Set<string>>(), classSlot: new Map<string, Set<string>>() }
      for (const e of [...frozen, ...outside]) {
        const slot = `${e.dayOfWeek}:${e.periodIdx}`
        if (e.teacherId) { const s = external.teacherSlot.get(e.teacherId) ?? new Set<string>(); s.add(slot); external.teacherSlot.set(e.teacherId, s) }
        if (e.roomId) { const s = external.roomSlot.get(e.roomId) ?? new Set<string>(); s.add(slot); external.roomSlot.set(e.roomId, s) }
        const cs = external.classSlot.get(e.classId) ?? new Set<string>(); cs.add(slot); external.classSlot.set(e.classId, cs)
      }
      const weights = await effectiveRefinementWeights(ctx)
      const refineEntries: RefineEntry[] = touchedForSA.map((e, i) => ({
        id: i + 1, classId: e.classId, gradeId: classById.get(e.classId)?.gradeId ?? 'ungrouped', dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx,
        classSubjectId: e.classSubjectId, subjectName: subjectInfoByCs.get(e.classSubjectId)?.name ?? '', roomId: e.roomId, teacherId: e.teacherId,
        isDoublePeriod: false, notPreferred: false,
      }))
      const problemCtx: ProblemContext = { workingDays: commonDays, periodsByDay: commonPeriodsByDay, doublePairsByDay: new Map(), labRoomIds, weights, external }
      const result = simulatedAnneal(refineEntries, problemCtx, 400, 4242)
      if (result.hardAfter === 0) {
        saPolished = result.best.map(r => ({ ...touchedForSA[r.id - 1], dayOfWeek: r.dayOfWeek, periodIdx: r.periodIdx, roomId: r.roomId }))
      }
    }
  }

  // ───────────────────────── step 5: assemble the patched full snapshot + new TimetableVersion ─────────────────────────

  // Byte-identical entries (frozen, including every `stuck` seed session that couldn't be moved) plus the
  // genuinely touched region (relocated + newly-placed, after SA polish) — `toRemove` entries are simply
  // absent from both. diffFromParent still uses the standard slot-keyed computeDiff (T7's own lineage
  // convention, unchanged), but the summary counts below are computed directly from what this function
  // itself actually did — one relocated/added/removed session is exactly one affected session, never
  // double-counted as "removed from its old slot" + "added at its new one".
  const patchedEntries: VersionEntry[] = [...frozen, ...stuck, ...saPolished]

  const diff = computeDiff(entries, patchedEntries)
  const affectedSessionCount = relocated.length + newlyPlaced.length + toRemove.length
  const unaffectedSessionCount = entries.length - relocated.length - toRemove.length

  const touchedClassIdsFinal = new Set([...relocated.map(e => e.classId), ...newlyPlaced.map(e => e.classId), ...toRemove.map(e => e.classId)])
  const affectedCohorts = cohortRows.filter(c => c.members.some(m => touchedClassIdsFinal.has(m.classId))).map(c => ({ id: c.id, name: c.name }))

  let diagnostics: Diagnostic[] = []
  if (unplaced.length) {
    const cohortsForDiag = cohortRows.filter(c => unplaced.some(u => c.members.some(m => m.classId === u.classId)))
    if (cohortsForDiag.length) {
      const cohortsWithClasses = await prisma.cohort.findMany({ where: { id: { in: cohortsForDiag.map(c => c.id) } }, include: { members: { include: { class: true } } } })
      diagnostics = await computeDiagnostics(ctx, cohortsWithClasses, unplaced)
    }
  }

  const changeReason = describeEvent(event)
  const newVersion = await prisma.timetableVersion.create({
    data: {
      schoolId: ctx.schoolId, academicYearId: version.academicYearId, termId: version.termId,
      scopeCohortIds: version.scopeCohortIds as unknown as object, scopeClassIds: version.scopeClassIds as unknown as object,
      status: 'GENERATED', parentVersionId: version.id, changeReason,
      entries: patchedEntries as unknown as object,
      diffFromParent: diff as unknown as object,
      createdById: ctx.actorId,
    },
  })

  await audit(ctx.schoolId, ctx.actorId, 'what-if', 'timetableVersion', newVersion.id, { parentVersionId: version.id }, {
    changeEvent: event, affectedSessionCount, unaffectedSessionCount, unplaced: unplaced.length, lockConflicts: lockConflicts.length,
  })

  return {
    item: serializeVersion(newVersion),
    changeEvent: event,
    draftEntries: saPolished,
    unplaced,
    diagnostics,
    lockConflicts,
    summary: { affectedSessionCount, unaffectedSessionCount, affectedCohorts },
  }
}

function describeEvent(event: ChangeEvent): string {
  switch (event.type) {
    case 'TEACHER_UNAVAILABLE': return `What-if: teacher unavailable for ${event.slots.length} period(s)`
    case 'ROOM_UNAVAILABLE': return `What-if: room unavailable for ${event.slots.length} period(s)`
    case 'REQUIREMENT_ADDED': return `What-if: teaching requirement added (${event.teachingRequirementId})`
    case 'REQUIREMENT_CHANGED': return `What-if: teaching requirement changed (${event.teachingRequirementId})`
    case 'PERIOD_REMOVED': return `What-if: period removed (day ${event.dayOfWeek}, period ${event.periodIdx})`
    case 'EVENT_BLOCKING_SLOTS': return `What-if: school event blocking ${event.slots.length} slot(s)`
  }
}
