// Pure, side-effect-free scheduling helpers shared by the timetable seed (seed/timetable.ts) and every
// timetable route module (timetableCore.ts, timetableSessionsJobs.ts, timetableVersions.ts,
// substitution.ts). Nothing here calls route()/crud()/addSeedFragment() — importing this file never
// registers anything, so it's safe for the seed (which runs before any route module import) and every
// route module to share it regardless of import order.
//
// Every lookup below takes an explicit `Collections` object rather than calling store.ts's `table()`
// directly — `table()` calls `getDB()`, which (before the very first seed finishes building the DB) would
// recursively re-invoke the seed itself. Route handlers just pass `getDB()`'s result; the seed passes its
// own in-progress `db` object.
//
// SIMULATED FOR SPEED (see .agents/edunova/static-demo-plan.md and the roadmap's T0 "simulate the
// solver" instruction): this is a deterministic greedy round-robin placer with REAL teacher/room/class
// conflict-checking, not the real backend's backtracking + simulated-annealing solver
// (server/src/modules/timetable/{autogen,solver,refinement}.ts). Soft-constraint optimization (workload
// balance, gap minimization, preference weighting) is never attempted here — every placement is "first
// conflict-free slot found," which is enough to always produce a legal (no double-booking) timetable
// without porting the real search/refinement engine.

import { uid, SCHOOL_ID, type Collections, type Row } from '../store'

// ── School-wide period template (T1/D7 promises per-day variation; this demo keeps one flat Mon-Fri
// template for every day, with Saturday off — see seed/timetable.ts's WorkingDayPattern row). ──
export const PERIOD_TEMPLATE_ID = 'pt-default'
export const WORKING_DAYS = [1, 2, 3, 4, 5]
export const CLASS_PERIOD_IDXS = [1, 2, 3, 5, 6, 7, 9, 10]
export const CONSECUTIVE_RUNS: number[][] = [[1, 2, 3], [5, 6, 7], [9, 10]]

export function defaultPeriods() {
  return [
    { idx: 1, label: 'Period 1', start: '09:00', end: '09:40', kind: 'class' },
    { idx: 2, label: 'Period 2', start: '09:40', end: '10:20', kind: 'class' },
    { idx: 3, label: 'Period 3', start: '10:20', end: '11:00', kind: 'class' },
    { idx: 4, label: 'Recess', start: '11:00', end: '11:15', kind: 'break' },
    { idx: 5, label: 'Period 4', start: '11:15', end: '11:55', kind: 'class' },
    { idx: 6, label: 'Period 5', start: '11:55', end: '12:35', kind: 'class' },
    { idx: 7, label: 'Period 6', start: '12:35', end: '13:15', kind: 'class' },
    { idx: 8, label: 'Lunch', start: '13:15', end: '13:55', kind: 'break' },
    { idx: 9, label: 'Period 7', start: '13:55', end: '14:35', kind: 'class' },
    { idx: 10, label: 'Period 8', start: '14:35', end: '15:15', kind: 'class' },
  ]
}

// ── Occupancy tracking: id -> set of "day:idx" slot keys. ──
export type Occupancy = Map<string, Set<string>>
export const slotKey = (day: number, idx: number) => `${day}:${idx}`
export function markBusy(o: Occupancy, id: string, slot: string) {
  const s = o.get(id) ?? new Set<string>()
  s.add(slot)
  o.set(id, s)
}
export function isBusy(o: Occupancy, id: string, slot: string) {
  return o.get(id)?.has(slot) ?? false
}

const LAB_SUBJECT_IDS = new Set(['physics', 'chemistry', 'biology', 'science', 'computer'])
export function needsLab(subjectId: string) {
  return LAB_SUBJECT_IDS.has(subjectId)
}

export function classLabelOf(db: Collections, classId: string): string {
  const c = (db.Class ?? []).find(r => r.id === classId)
  if (!c) return classId
  const grade = (db.Grade ?? []).find(g => g.id === c.gradeId)
  return `${grade?.label ?? '?'}-${c.section}`
}

export function cohortMemberClassIds(db: Collections, cohortId: string): string[] {
  const c = (db.Cohort ?? []).find(r => r.id === cohortId)
  return (c?.classIds as string[] | undefined) ?? []
}

/** Finds (or creates, matching the real backend's own find-or-create pattern) the ClassSubject row
 * backing one class+subject pairing — every TimetableEntry needs a classSubjectId. */
export function ensureClassSubject(db: Collections, classId: string, subjectId: string, teacherId: string | null, periodsPerWeek: number): Row {
  const rows = db.ClassSubject ?? (db.ClassSubject = [])
  let cs = rows.find(r => r.classId === classId && r.subjectId === subjectId)
  if (!cs) {
    cs = { id: uid('cs'), schoolId: SCHOOL_ID, classId, subjectId, teacherId: teacherId ?? undefined, periodsPerWeek } as Row
    rows.push(cs)
  }
  return cs
}

export function labRoomIds(db: Collections): string[] {
  return (db.Room ?? []).filter(r => r.kind === 'LAB').map(r => String(r.id))
}

export interface PlacedEntry {
  classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string
  roomId: string | null; teacherId: string | null; sessionId: string | null
}
export interface UnplacedItem {
  classId: string; classLabel: string; classSubjectId: string | null; subjectName: string | null
  teacherId: string | null; teacherName: string | null; remaining: number; reason: string
}

export interface PlacementRequest {
  classId: string
  subjectId: string
  subjectName: string
  teacherId: string | null
  teacherName: string | null
  periodsPerWeek: number
  sessionDuration: 'SINGLE' | 'DOUBLE' | 'TRIPLE' | 'BLOCK'
  roomId: string | null // pre-resolved specific room, when roomRequirement === SPECIFIC_ROOM
  wantsLab: boolean
}

const DURATION_LEN: Record<string, number> = { SINGLE: 1, DOUBLE: 2, TRIPLE: 3, BLOCK: 4 }

/** Deterministic greedy round-robin placement — the "Auto-Generate" simulation. Mutates the three
 * Occupancy maps it's given (seed them with any pre-existing/frozen busy-ness first) and returns the
 * newly-placed entries plus anything that couldn't be fit into a conflict-free slot. */
export function greedyPlace(
  db: Collections,
  requests: PlacementRequest[],
  classBusy: Occupancy, teacherBusy: Occupancy, roomBusy: Occupancy,
  labRooms: string[],
): { placed: PlacedEntry[]; unplaced: UnplacedItem[] } {
  const placed: PlacedEntry[] = []
  const unplaced: UnplacedItem[] = []

  for (const req of requests) {
    const runLen = DURATION_LEN[req.sessionDuration] ?? 1
    const runs = runLen > 1 ? CONSECUTIVE_RUNS.filter(r => r.length >= runLen) : CLASS_PERIOD_IDXS.map(i => [i])
    let remaining = req.periodsPerWeek
    let guard = 0
    while (remaining > 0 && guard < 200) {
      guard++
      let didPlace = false
      outer: for (const day of WORKING_DAYS) {
        for (const run of runs) {
          const idxs = runLen > 1 ? run.slice(0, runLen) : run
          if (idxs.some(idx => isBusy(classBusy, req.classId, slotKey(day, idx)))) continue
          if (req.teacherId && idxs.some(idx => isBusy(teacherBusy, req.teacherId!, slotKey(day, idx)))) continue
          let roomId: string | null = null
          if (req.roomId) {
            if (idxs.some(idx => isBusy(roomBusy, req.roomId!, slotKey(day, idx)))) continue
            roomId = req.roomId
          } else if (req.wantsLab) {
            const free = labRooms.find(rid => !idxs.some(idx => isBusy(roomBusy, rid, slotKey(day, idx))))
            if (!free) continue
            roomId = free
          }
          for (const idx of idxs) {
            markBusy(classBusy, req.classId, slotKey(day, idx))
            if (req.teacherId) markBusy(teacherBusy, req.teacherId, slotKey(day, idx))
            if (roomId) markBusy(roomBusy, roomId, slotKey(day, idx))
          }
          const cs = ensureClassSubject(db, req.classId, req.subjectId, req.teacherId, req.periodsPerWeek)
          for (const idx of idxs) {
            placed.push({ classId: req.classId, dayOfWeek: day, periodIdx: idx, classSubjectId: cs.id, roomId, teacherId: req.teacherId, sessionId: null })
          }
          remaining -= idxs.length
          didPlace = true
          break outer
        }
      }
      if (!didPlace) break
    }
    if (remaining > 0) {
      unplaced.push({
        classId: req.classId, classLabel: classLabelOf(db, req.classId),
        classSubjectId: (db.ClassSubject ?? []).find(r => r.classId === req.classId && r.subjectId === req.subjectId)?.id ?? null,
        subjectName: req.subjectName, teacherId: req.teacherId, teacherName: req.teacherName,
        remaining, reason: req.teacherId ? `No conflict-free slot found for the remaining ${remaining} period(s)` : `No teacher assigned to "${req.subjectName}" for this cohort yet`,
      })
    }
  }
  return { placed, unplaced }
}

/** Seeds the three Occupancy maps from a set of already-placed entries (e.g. the rest of the school's
 * live TimetableEntry rows) so a new placement run never collides with what's already there. */
export function seedOccupancyFrom(entries: { classId: string; teacherId?: string | null; roomId?: string | null; dayOfWeek: number; periodIdx: number }[], classBusy: Occupancy, teacherBusy: Occupancy, roomBusy: Occupancy) {
  for (const e of entries) {
    const slot = slotKey(e.dayOfWeek, e.periodIdx)
    markBusy(classBusy, e.classId, slot)
    if (e.teacherId) markBusy(teacherBusy, e.teacherId, slot)
    if (e.roomId) markBusy(roomBusy, e.roomId, slot)
  }
}
