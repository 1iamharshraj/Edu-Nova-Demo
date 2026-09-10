import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import type { Ctx } from '../../lib/rbac'
import { effectiveTemplate, resolveForDay, serializePeriodTemplate } from '../periodTemplates/service'

// ───────────────────────── Phase T5 §2 — soft-constraint scoring + SA refinement ─────────────────────────
// See phase-t5-full-solver.md §2. Turns server/scratch/t0-solver-spike/spike.ts's throwaway SA into real
// production code, applying T0's two identified fixes from the start:
//   (1) incremental/delta scoring — a move updates only the running per-teacher/per-cohort penalty
//       contributions it actually touches, never a full rescore of every entry;
//   (2) decomposed by cohort-group (per grade) — refineDraft groups entries by their class's gradeId and
//       runs one independent SA pass per group, each with its own time budget, never one whole-school pass.
// The lexicographic staged objective is exactly T0's: hard (never touched here — a candidate move is
// validated against hard constraints BEFORE it is even scored, so refinement can only ever start from and
// stay at hard=0) >> major (~1000/unit) >> workload (~50/unit) >> minor (~1/unit), via the same
// well-separated-weight-magnitude trick that collapses staging into one scalar for a single SA acceptance
// rule (see spike.ts's own comment on why this works).

export const W_MAJOR = 1_000
export const W_WORKLOAD = 50
export const W_MINOR = 1

export const REFINEMENT_TYPES = [
  'LAB_SPLIT', 'TEACHER_DAILY_OVERLOAD', 'TEACHER_WEEKLY_OVERLOAD', // major tier
  'WORKLOAD_VARIANCE', 'TEACHER_GAPS', // workload tier
  'UNPREFERRED_SLOT', 'FORCED_SAME_DAY_REPEAT', 'ADJACENT_SAME_SUBJECT', // minor tier
] as const
export type RefinementType = (typeof REFINEMENT_TYPES)[number]

export const REFINEMENT_TIER: Record<RefinementType, 1 | 2 | 3> = {
  LAB_SPLIT: 1, TEACHER_DAILY_OVERLOAD: 1, TEACHER_WEEKLY_OVERLOAD: 1,
  WORKLOAD_VARIANCE: 2, TEACHER_GAPS: 2,
  UNPREFERRED_SLOT: 3, FORCED_SAME_DAY_REPEAT: 3, ADJACENT_SAME_SUBJECT: 3,
}
const TIER_WEIGHT = { 1: W_MAJOR, 2: W_WORKLOAD, 3: W_MINOR }

// T0 spike's own example weights (one "unit" of each type before the tier multiplier — e.g. one lab split
// = DEFAULT_REFINEMENT_WEIGHTS.LAB_SPLIT * W_MAJOR points). Seeded into Preference(scope='REFINEMENT').
export const DEFAULT_REFINEMENT_WEIGHTS: Record<RefinementType, number> = {
  LAB_SPLIT: 1, TEACHER_DAILY_OVERLOAD: 1, TEACHER_WEEKLY_OVERLOAD: 1,
  WORKLOAD_VARIANCE: 1, TEACHER_GAPS: 0.2,
  UNPREFERRED_SLOT: 1, FORCED_SAME_DAY_REPEAT: 1, ADJACENT_SAME_SUBJECT: 1,
}

const DAILY_CAP = 6
const WEEKLY_CAP = 30

export async function seedRefinementPreferenceDefaults(ctx: Ctx) {
  const existing = new Set((await prisma.preference.findMany({ where: { schoolId: ctx.schoolId, scope: 'REFINEMENT' } })).map(p => p.type))
  let added = 0
  for (const type of REFINEMENT_TYPES) {
    if (existing.has(type)) continue
    await prisma.preference.create({
      data: { schoolId: ctx.schoolId, type, scope: 'REFINEMENT', weight: DEFAULT_REFINEMENT_WEIGHTS[type], priority: REFINEMENT_TIER[type], enabled: true },
    })
    added++
  }
  return added
}

export async function effectiveRefinementWeights(ctx: Ctx, profileName?: string): Promise<Record<RefinementType, number>> {
  const rows = await prisma.preference.findMany({ where: { schoolId: ctx.schoolId, scope: 'REFINEMENT', enabled: true } })
  const weights: Record<string, number> = { ...DEFAULT_REFINEMENT_WEIGHTS }
  for (const r of rows) weights[r.type] = r.weight
  let profile = null as { weightOverrides: unknown } | null
  if (profileName) profile = await prisma.preferenceProfile.findUnique({ where: { schoolId_name: { schoolId: ctx.schoolId, name: profileName } } })
  else profile = await prisma.preferenceProfile.findFirst({ where: { schoolId: ctx.schoolId, active: true } })
  if (profile?.weightOverrides) {
    const overrides = profile.weightOverrides as Record<string, number>
    for (const [type, w] of Object.entries(overrides)) if (type in weights) weights[type] = w
  }
  return weights as Record<RefinementType, number>
}

// ───────────────────────── entry model (operates on DraftEntry-shaped rows) ─────────────────────────

export interface RefineEntry {
  id: number // synthetic, stable within one refinement run
  classId: string
  gradeId: string
  dayOfWeek: number
  periodIdx: number
  classSubjectId: string
  subjectName: string
  roomId: string | null
  teacherId: string | null
  isDoublePeriod: boolean
  notPreferred: boolean // resolved once up front from TeacherAvailability, cheap to keep denormalized on the entry
}

export interface ScoreBreakdown {
  major: number; workload: number; minor: number; total: number
  details: Record<string, number>
}

// Cross-group-decomposed refinement (per D2/T0) means group A's SA pass has no visibility into group B's
// entries at all — correct for scoring (grades are near-block-diagonal), but NOT correct for hard-
// constraint feasibility when a teacher or room genuinely IS shared across grade groups (a real, expected
// case, not an edge case — one teacher covering the same subject in two different grades is completely
// ordinary). Without this, group A's SA could relocate a shared teacher into a slot group B's OWN, already-
// finalized entries occupy, since group A's move generators only ever check group A's own occupancy index.
// `external` is a FROZEN (never mutated by this group's moves) snapshot of every OTHER group's current
// teacher/room occupancy, threaded into every move-feasibility check below alongside the group's own idx —
// this is what makes "zero hard violations across the WHOLE draft, not just within each group" true.
//
// `classSlot` (added post-T8): T5's own callers never needed this — a refinement group always contains
// EVERY entry belonging to a given class together (grade-decomposed grouping never splits one class across
// groups), so class-level double-booking was always caught by the group's own live `idx.classSlot` and
// external class tracking was redundant. T8's what-if engine breaks that assumption: it runs SA over only
// the FEW touched sessions of a class while the REST of that same class's sessions sit in a frozen set
// never passed into the group at all. Without external class-slot tracking, a touched session could be
// relocated directly onto one of its own class's frozen sessions — a genuine same-class double-booking —
// since neither the live idx (which only knows about the touched entries) nor teacherSlot/roomSlot (which
// track a different axis entirely) would ever catch it. Populated by whatif.ts from every frozen entry's
// class+day+period before invoking the SA polish step; T5's own caller (refineDraft) already builds a
// classSlot-shaped `latest` map but only used it for teacher/room here — extending it costs it nothing,
// since within-group class collisions were already impossible there by construction.
export interface ExternalOccupancy {
  teacherSlot: Map<string, Set<string>> // teacherId -> "day:period"
  roomSlot: Map<string, Set<string>> // roomId -> "day:period"
  classSlot?: Map<string, Set<string>> // classId -> "day:period"
}

export interface ProblemContext {
  workingDays: number[]
  periodsByDay: Map<number, number[]>
  doublePairsByDay: Map<number, [number, number][]>
  labRoomIds: Set<string>
  weights: Record<RefinementType, number>
  external?: ExternalOccupancy
}

const externalTeacherBusy = (ctx: ProblemContext, teacherId: string | null, slot: string) => !!teacherId && !!ctx.external?.teacherSlot.get(teacherId)?.has(slot)
const externalRoomBusy = (ctx: ProblemContext, roomId: string | null, slot: string) => !!roomId && !!ctx.external?.roomSlot.get(roomId)?.has(slot)
const externalClassBusy = (ctx: ProblemContext, classId: string | null, slot: string) => !!classId && !!ctx.external?.classSlot?.get(classId)?.has(slot)

function scoreFull(entries: RefineEntry[], weights: Record<RefinementType, number>): ScoreBreakdown {
  const teacherSlots = new Map<string, Map<string, number>>()
  const teacherDayCount = new Map<string, Map<number, number>>()
  const teacherWeekCount = new Map<string, number>()
  const teacherDaySlots = new Map<string, Map<number, number[]>>()

  for (const e of entries) {
    if (!e.teacherId) continue
    const slot = `${e.dayOfWeek}:${e.periodIdx}`
    const inner = teacherSlots.get(e.teacherId) ?? new Map<string, number>()
    inner.set(slot, (inner.get(slot) ?? 0) + 1)
    teacherSlots.set(e.teacherId, inner)
    const dayMap = teacherDayCount.get(e.teacherId) ?? new Map<number, number>()
    dayMap.set(e.dayOfWeek, (dayMap.get(e.dayOfWeek) ?? 0) + 1)
    teacherDayCount.set(e.teacherId, dayMap)
    teacherWeekCount.set(e.teacherId, (teacherWeekCount.get(e.teacherId) ?? 0) + 1)
    const dsMap = teacherDaySlots.get(e.teacherId) ?? new Map<number, number[]>()
    const arr = dsMap.get(e.dayOfWeek) ?? []
    arr.push(e.periodIdx)
    dsMap.set(e.dayOfWeek, arr)
    teacherDaySlots.set(e.teacherId, dsMap)
  }

  // Lab splits: group double-marked entries by (classSubjectId, day).
  let labSplits = 0
  const labByKey = new Map<string, RefineEntry[]>()
  for (const e of entries) {
    if (!e.isDoublePeriod) continue
    const key = `${e.classSubjectId}:${e.dayOfWeek}`
    const arr = labByKey.get(key) ?? []
    arr.push(e)
    labByKey.set(key, arr)
  }
  for (const arr of labByKey.values()) {
    if (arr.length === 1) { labSplits += 1; continue }
    if (arr.length === 2) {
      const idxs = arr.map(e => e.periodIdx).sort((a, b) => a - b)
      if (idxs[1] - idxs[0] !== 1) labSplits += 1
      continue
    }
    labSplits += arr.length % 2
  }

  let teacherDailyOverload = 0
  for (const dayMap of teacherDayCount.values()) for (const c of dayMap.values()) if (c > DAILY_CAP) teacherDailyOverload += c - DAILY_CAP
  let teacherWeeklyOverload = 0
  for (const c of teacherWeekCount.values()) if (c > WEEKLY_CAP) teacherWeeklyOverload += c - WEEKLY_CAP

  const loads = [...teacherWeekCount.values()]
  const mean = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0
  const workloadVariance = loads.length ? loads.reduce((a, b) => a + (b - mean) ** 2, 0) / loads.length : 0

  let teacherGapPeriods = 0
  for (const dsMap of teacherDaySlots.values()) {
    for (const idxs of dsMap.values()) {
      const sorted = [...idxs].sort((a, b) => a - b)
      const first = sorted[0], last = sorted[sorted.length - 1]
      const occSet = new Set(sorted)
      for (let p = first + 1; p < last; p++) if (!occSet.has(p)) teacherGapPeriods++
    }
  }

  const unpreferredSlot = entries.filter(e => e.notPreferred).length

  let forcedSameDayRepeat = 0
  const csDay = new Map<string, number>()
  for (const e of entries) {
    const key = `${e.classSubjectId}:${e.dayOfWeek}`
    csDay.set(key, (csDay.get(key) ?? 0) + 1)
  }
  for (const c of csDay.values()) if (c > 1) forcedSameDayRepeat += c - 1
  for (const arr of labByKey.values()) if (arr.length >= 2) forcedSameDayRepeat -= 1
  forcedSameDayRepeat = Math.max(0, forcedSameDayRepeat)

  let adjacentSameSubject = 0
  const byClassDay = new Map<string, RefineEntry[]>()
  for (const e of entries) {
    const key = `${e.classId}:${e.dayOfWeek}`
    const arr = byClassDay.get(key) ?? []
    arr.push(e)
    byClassDay.set(key, arr)
  }
  for (const arr of byClassDay.values()) {
    const sorted = [...arr].sort((a, b) => a.periodIdx - b.periodIdx)
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1]
      if (a.periodIdx + 1 === b.periodIdx && a.classSubjectId === b.classSubjectId && !(a.isDoublePeriod && b.isDoublePeriod)) adjacentSameSubject++
    }
  }

  const w = weights
  const major = labSplits * w.LAB_SPLIT + teacherDailyOverload * w.TEACHER_DAILY_OVERLOAD + teacherWeeklyOverload * w.TEACHER_WEEKLY_OVERLOAD
  const workload = workloadVariance * w.WORKLOAD_VARIANCE + teacherGapPeriods * w.TEACHER_GAPS
  const minor = unpreferredSlot * w.UNPREFERRED_SLOT + forcedSameDayRepeat * w.FORCED_SAME_DAY_REPEAT + adjacentSameSubject * w.ADJACENT_SAME_SUBJECT

  return {
    major: major * W_MAJOR, workload: workload * W_WORKLOAD, minor: minor * W_MINOR,
    total: major * W_MAJOR + workload * W_WORKLOAD + minor * W_MINOR,
    details: { labSplits, teacherDailyOverload, teacherWeeklyOverload, workloadVariance, teacherGapPeriods, unpreferredSlot, forcedSameDayRepeat, adjacentSameSubject },
  }
}

// ───────────────────────── hard-constraint safety (must never regress) ─────────────────────────

export function hardViolations(entries: RefineEntry[]): number {
  const teacherSlot = new Map<string, number>()
  const roomSlot = new Map<string, number>()
  const classSlot = new Map<string, number>()
  let violations = 0
  for (const e of entries) {
    const slot = `${e.dayOfWeek}:${e.periodIdx}`
    if (e.teacherId) { const k = `${e.teacherId}@${slot}`; teacherSlot.set(k, (teacherSlot.get(k) ?? 0) + 1) }
    if (e.roomId) { const k = `${e.roomId}@${slot}`; roomSlot.set(k, (roomSlot.get(k) ?? 0) + 1) }
    const ck = `${e.classId}@${slot}`; classSlot.set(ck, (classSlot.get(ck) ?? 0) + 1)
  }
  for (const c of teacherSlot.values()) if (c > 1) violations += c - 1
  for (const c of roomSlot.values()) if (c > 1) violations += c - 1
  for (const c of classSlot.values()) if (c > 1) violations += c - 1
  return violations
}

// ───────────────────────── moves (same 3 neighborhoods as the spike) ─────────────────────────
// Each move function validates hard feasibility (teacher/room/class slot occupancy) against the LIVE
// OccIndex before returning anything — an infeasible move is never even constructed, so hard constraints
// can never regress (T5 spec's explicit invariant; unit-tested in refinement.test.ts). They return a small
// `Change[]` describing exactly which entries move where, NOT a full rewritten entries array — this is
// what lets PenaltyState below score the move by touching only what actually changed.

function mulberry32(seed: number) {
  let a = seed
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Change { id: number; dayOfWeek: number; periodIdx: number; roomId: string | null }

interface OccIndex {
  teacherSlot: Map<string, Map<string, number>>
  roomSlot: Map<string, Map<string, number>>
  classSlot: Map<string, Map<string, number>>
}
const occupantAt = (idx: OccIndex, kind: keyof OccIndex, key: string, slot: string) => idx[kind].get(key)?.get(slot)

function tryRelocate(entries: RefineEntry[], idx: OccIndex, ctx: ProblemContext, rng: () => number): Change[] | null {
  const movable = entries.filter(e => !e.isDoublePeriod)
  if (!movable.length) return null
  const e = movable[Math.floor(rng() * movable.length)]
  const day = ctx.workingDays[Math.floor(rng() * ctx.workingDays.length)]
  const periods = ctx.periodsByDay.get(day)!
  const targetIdx = periods[Math.floor(rng() * periods.length)]
  if (day === e.dayOfWeek && targetIdx === e.periodIdx) return null
  const slot = `${day}:${targetIdx}`
  if (occupantAt(idx, 'classSlot', e.classId, slot) !== undefined) return null
  if (externalClassBusy(ctx, e.classId, slot)) return null
  if (e.teacherId && occupantAt(idx, 'teacherSlot', e.teacherId, slot) !== undefined) return null
  if (externalTeacherBusy(ctx, e.teacherId, slot)) return null
  let roomId = e.roomId
  if (e.roomId && ctx.labRoomIds.has(e.roomId)) {
    const alt = [...ctx.labRoomIds].find(r => occupantAt(idx, 'roomSlot', r, slot) === undefined && !externalRoomBusy(ctx, r, slot))
    if (!alt) return null
    roomId = alt
  } else if (e.roomId && externalRoomBusy(ctx, e.roomId, slot)) return null
  return [{ id: e.id, dayOfWeek: day, periodIdx: targetIdx, roomId }]
}

function trySwap(entries: RefineEntry[], idx: OccIndex, ctx: ProblemContext, rng: () => number): Change[] | null {
  const movable = entries.filter(e => !e.isDoublePeriod)
  if (movable.length < 2) return null
  const a = movable[Math.floor(rng() * movable.length)]
  const b = movable[Math.floor(rng() * movable.length)]
  if (a.id === b.id || (a.dayOfWeek === b.dayOfWeek && a.periodIdx === b.periodIdx)) return null
  const slotA = `${a.dayOfWeek}:${a.periodIdx}`, slotB = `${b.dayOfWeek}:${b.periodIdx}`
  if (a.classId !== b.classId) {
    if (occupantAt(idx, 'classSlot', a.classId, slotB) !== undefined) return null
    if (occupantAt(idx, 'classSlot', b.classId, slotA) !== undefined) return null
  }
  if (a.teacherId) { const occ = occupantAt(idx, 'teacherSlot', a.teacherId, slotB); if (occ !== undefined && occ !== b.id) return null }
  if (b.teacherId) { const occ = occupantAt(idx, 'teacherSlot', b.teacherId, slotA); if (occ !== undefined && occ !== a.id) return null }
  if (a.roomId) { const occ = occupantAt(idx, 'roomSlot', a.roomId, slotB); if (occ !== undefined && occ !== b.id) return null }
  if (b.roomId) { const occ = occupantAt(idx, 'roomSlot', b.roomId, slotA); if (occ !== undefined && occ !== a.id) return null }
  if (externalTeacherBusy(ctx, a.teacherId, slotB) || externalTeacherBusy(ctx, b.teacherId, slotA)) return null
  if (externalRoomBusy(ctx, a.roomId, slotB) || externalRoomBusy(ctx, b.roomId, slotA)) return null
  if (externalClassBusy(ctx, a.classId, slotB) || externalClassBusy(ctx, b.classId, slotA)) return null
  return [
    { id: a.id, dayOfWeek: b.dayOfWeek, periodIdx: b.periodIdx, roomId: a.roomId },
    { id: b.id, dayOfWeek: a.dayOfWeek, periodIdx: a.periodIdx, roomId: b.roomId },
  ]
}

function tryMoveLabBlock(entries: RefineEntry[], idx: OccIndex, ctx: ProblemContext, rng: () => number): Change[] | null {
  const doubles = entries.filter(e => e.isDoublePeriod)
  const byKey = new Map<string, RefineEntry[]>()
  for (const e of doubles) {
    const key = `${e.classId}:${e.classSubjectId}:${e.dayOfWeek}`
    const arr = byKey.get(key) ?? []; arr.push(e); byKey.set(key, arr)
  }
  const pairs = [...byKey.values()].filter(arr => arr.length === 2)
  if (!pairs.length) return null
  const halves = pairs[Math.floor(rng() * pairs.length)]
  const [h1] = halves
  const day = ctx.workingDays[Math.floor(rng() * ctx.workingDays.length)]
  const dayPairs = ctx.doublePairsByDay.get(day) ?? []
  if (!dayPairs.length) return null
  const [ta, tb] = dayPairs[Math.floor(rng() * dayPairs.length)]
  if (day === h1.dayOfWeek && [ta, tb].includes(h1.periodIdx)) return null
  const slotA = `${day}:${ta}`, slotB = `${day}:${tb}`
  if (occupantAt(idx, 'classSlot', h1.classId, slotA) !== undefined) return null
  if (occupantAt(idx, 'classSlot', h1.classId, slotB) !== undefined) return null
  if (externalClassBusy(ctx, h1.classId, slotA) || externalClassBusy(ctx, h1.classId, slotB)) return null
  if (h1.teacherId) {
    if (occupantAt(idx, 'teacherSlot', h1.teacherId, slotA) !== undefined) return null
    if (occupantAt(idx, 'teacherSlot', h1.teacherId, slotB) !== undefined) return null
    if (externalTeacherBusy(ctx, h1.teacherId, slotA) || externalTeacherBusy(ctx, h1.teacherId, slotB)) return null
  }
  let labRoom: string | null = null
  if (h1.roomId) {
    labRoom = [...ctx.labRoomIds].find(r =>
      occupantAt(idx, 'roomSlot', r, slotA) === undefined && occupantAt(idx, 'roomSlot', r, slotB) === undefined &&
      !externalRoomBusy(ctx, r, slotA) && !externalRoomBusy(ctx, r, slotB)) ?? null
    if (!labRoom) return null
  }
  return [
    { id: halves[0].id, dayOfWeek: day, periodIdx: ta, roomId: labRoom ?? halves[0].roomId },
    { id: halves[1].id, dayOfWeek: day, periodIdx: tb, roomId: labRoom ?? halves[1].roomId },
  ]
}

// ───────────────────────── PenaltyState: true incremental/delta scoring ─────────────────────────
// T0's fix #1, implemented for real (not a scoped-down full-rescore): a move touches at most 2 entries,
// which touch at most a handful of grouping keys (their old classSubject-day / class-day / teacher-day
// keys, and their prospective new ones). This engine recomputes ONLY those keys' contributions — never
// re-scans the whole entries set — for every one of the 6 penalty components that actually vary under a
// relocate/swap/lab-block move. Two components (teacherWeeklyOverload, workloadVariance) are PROVABLY
// invariant under these three move types (no entry's teacher changes and no entry is added/removed, only
// its day/period/room — so every teacher's total weekly period count is fixed for the run) and are
// computed once at construction, not touched by applyChange at all.
class PenaltyState {
  entries: Map<number, RefineEntry>
  private weights: Record<RefinementType, number>
  private notPreferredLookup: Set<string>
  idx: OccIndex = { teacherSlot: new Map(), roomSlot: new Map(), classSlot: new Map() }
  private teacherDayCount = new Map<string, Map<number, number>>()
  private teacherDaySlots = new Map<string, Map<number, Set<number>>>()
  private csDayGroup = new Map<string, Set<number>>() // key: classSubjectId:day
  private classDayGroup = new Map<string, Set<number>>() // key: classId:day
  // Dynamic-component running total, in raw (pre-tier-weight) units per component, tier-weighted on read.
  total = 0
  readonly invariantWeeklyOverloadWeighted: number
  readonly invariantVarianceWeighted: number

  constructor(entries: RefineEntry[], weights: Record<RefinementType, number>, notPreferredLookup: Set<string>) {
    this.weights = weights
    this.notPreferredLookup = notPreferredLookup
    this.entries = new Map(entries.map(e => [e.id, e]))
    for (const e of entries) this.index(e)

    // Invariants, computed once.
    let weeklyOverload = 0
    const weekCounts: number[] = []
    for (const dayMap of this.teacherDayCount.values()) {
      const week = [...dayMap.values()].reduce((a, b) => a + b, 0)
      weekCounts.push(week)
    }
    for (const w of weekCounts) if (w > WEEKLY_CAP) weeklyOverload += w - WEEKLY_CAP
    const mean = weekCounts.length ? weekCounts.reduce((a, b) => a + b, 0) / weekCounts.length : 0
    const variance = weekCounts.length ? weekCounts.reduce((a, b) => a + (b - mean) ** 2, 0) / weekCounts.length : 0
    this.invariantWeeklyOverloadWeighted = weeklyOverload * this.weights.TEACHER_WEEKLY_OVERLOAD * W_MAJOR
    this.invariantVarianceWeighted = variance * this.weights.WORKLOAD_VARIANCE * W_WORKLOAD

    // Dynamic components, computed once via the touched-key machinery (every key starts "touched").
    for (const key of this.csDayGroup.keys()) this.total += this.recomputeCsDay(key)
    for (const key of this.classDayGroup.keys()) this.total += this.recomputeClassDay(key)
    for (const teacherId of this.teacherDayCount.keys()) {
      for (const day of this.teacherDayCount.get(teacherId)!.keys()) {
        this.total += this.recomputeDailyOverload(teacherId, day)
        this.total += this.recomputeGap(teacherId, day)
      }
    }
    for (const e of entries) this.total += this.unpreferredContribution(e)
  }

  private index(e: RefineEntry) {
    const slot = `${e.dayOfWeek}:${e.periodIdx}`
    if (e.teacherId) { const inner = this.idx.teacherSlot.get(e.teacherId) ?? new Map(); inner.set(slot, e.id); this.idx.teacherSlot.set(e.teacherId, inner) }
    if (e.roomId) { const inner = this.idx.roomSlot.get(e.roomId) ?? new Map(); inner.set(slot, e.id); this.idx.roomSlot.set(e.roomId, inner) }
    { const inner = this.idx.classSlot.get(e.classId) ?? new Map(); inner.set(slot, e.id); this.idx.classSlot.set(e.classId, inner) }

    if (e.teacherId) {
      const dayMap = this.teacherDayCount.get(e.teacherId) ?? new Map<number, number>()
      dayMap.set(e.dayOfWeek, (dayMap.get(e.dayOfWeek) ?? 0) + 1)
      this.teacherDayCount.set(e.teacherId, dayMap)
      const dsMap = this.teacherDaySlots.get(e.teacherId) ?? new Map<number, Set<number>>()
      const set = dsMap.get(e.dayOfWeek) ?? new Set<number>()
      set.add(e.periodIdx); dsMap.set(e.dayOfWeek, set); this.teacherDaySlots.set(e.teacherId, dsMap)
    }
    const csKey = `${e.classSubjectId}:${e.dayOfWeek}`
    const csSet = this.csDayGroup.get(csKey) ?? new Set<number>(); csSet.add(e.id); this.csDayGroup.set(csKey, csSet)
    const clKey = `${e.classId}:${e.dayOfWeek}`
    const clSet = this.classDayGroup.get(clKey) ?? new Set<number>(); clSet.add(e.id); this.classDayGroup.set(clKey, clSet)
  }

  private deindex(e: RefineEntry) {
    const slot = `${e.dayOfWeek}:${e.periodIdx}`
    if (e.teacherId) this.idx.teacherSlot.get(e.teacherId)?.delete(slot)
    if (e.roomId) this.idx.roomSlot.get(e.roomId)?.delete(slot)
    this.idx.classSlot.get(e.classId)?.delete(slot)

    if (e.teacherId) {
      const dayMap = this.teacherDayCount.get(e.teacherId)
      if (dayMap) { const c = (dayMap.get(e.dayOfWeek) ?? 1) - 1; if (c <= 0) dayMap.delete(e.dayOfWeek); else dayMap.set(e.dayOfWeek, c) }
      this.teacherDaySlots.get(e.teacherId)?.get(e.dayOfWeek)?.delete(e.periodIdx)
    }
    const csKey = `${e.classSubjectId}:${e.dayOfWeek}`
    const csSet = this.csDayGroup.get(csKey); csSet?.delete(e.id); if (csSet && !csSet.size) this.csDayGroup.delete(csKey)
    const clKey = `${e.classId}:${e.dayOfWeek}`
    const clSet = this.classDayGroup.get(clKey); clSet?.delete(e.id); if (clSet && !clSet.size) this.classDayGroup.delete(clKey)
  }

  private unpreferredContribution(e: RefineEntry): number {
    if (!e.teacherId) return 0
    const key = `${e.teacherId}:${e.dayOfWeek}:${e.periodIdx}`
    return this.notPreferredLookup.has(key) ? this.weights.UNPREFERRED_SLOT * W_MINOR : 0
  }

  // Must match scoreFull's forcedSameDayRepeat/labSplits formulas EXACTLY (bit-for-bit, same subtraction
  // condition) — this is what a unit test (refinement.test.ts) cross-checks against a full recompute after
  // random move sequences, since any divergence here silently corrupts the SA acceptance decisions without
  // ever showing up as a hard-constraint violation. Earlier draft of this function gated the lab-pair
  // subtraction on adjacency, which scoreFull does NOT do (it subtracts 1 per lab-group unconditionally
  // whenever 2+ lab periods share the key) — that mismatch let SA "believe" it was improving when the true
  // scorer disagreed. Fixed to subtract unconditionally, exactly like scoreFull.
  private recomputeCsDay(key: string): number {
    const ids = this.csDayGroup.get(key)
    if (!ids || !ids.size) return 0
    // NOTE: a lone lab entry (size===1) contributes ZERO forcedSameDayRepeat but a real labSplits=1 — do
    // not early-return on size<=1 (an earlier version of this function did, which silently zeroed out a
    // genuine major-tier penalty for every "split entirely across two different days" lab session; caught
    // by refinement.test.ts's delta-vs-full-recompute cross-check).
    const labIds = [...ids].filter(id => this.entries.get(id)!.isDoublePeriod)
    let val = ids.size - 1
    if (labIds.length >= 2) val -= 1
    const forcedRepeat = Math.max(0, val)
    // Lab-split scoring shares the same key (classSubjectId:day) — a lone lab entry (odd count among
    // isDoublePeriod members) or a non-adjacent pair is a split.
    let labSplits = 0
    if (labIds.length === 1) labSplits = 1
    else if (labIds.length === 2) {
      const idxs = labIds.map(id => this.entries.get(id)!.periodIdx).sort((a, b) => a - b)
      if (idxs[1] - idxs[0] !== 1) labSplits = 1
    } else if (labIds.length >= 3) labSplits = labIds.length % 2
    return forcedRepeat * this.weights.FORCED_SAME_DAY_REPEAT * W_MINOR + labSplits * this.weights.LAB_SPLIT * W_MAJOR
  }

  private recomputeClassDay(key: string): number {
    const ids = this.classDayGroup.get(key)
    if (!ids || ids.size < 2) return 0
    const sorted = [...ids].map(id => this.entries.get(id)!).sort((a, b) => a.periodIdx - b.periodIdx)
    let adjacent = 0
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1]
      if (a.periodIdx + 1 === b.periodIdx && a.classSubjectId === b.classSubjectId && !(a.isDoublePeriod && b.isDoublePeriod)) adjacent++
    }
    return adjacent * this.weights.ADJACENT_SAME_SUBJECT * W_MINOR
  }

  private recomputeDailyOverload(teacherId: string, day: number): number {
    const c = this.teacherDayCount.get(teacherId)?.get(day) ?? 0
    return Math.max(0, c - DAILY_CAP) * this.weights.TEACHER_DAILY_OVERLOAD * W_MAJOR
  }

  private recomputeGap(teacherId: string, day: number): number {
    const slots = this.teacherDaySlots.get(teacherId)?.get(day)
    if (!slots || slots.size < 2) return 0
    const sorted = [...slots].sort((a, b) => a - b)
    const first = sorted[0], last = sorted[sorted.length - 1]
    let gaps = 0
    const set = new Set(sorted)
    for (let p = first + 1; p < last; p++) if (!set.has(p)) gaps++
    return gaps * this.weights.TEACHER_GAPS * W_WORKLOAD
  }

  // Applies a set of changes (already validated feasible by the move generator against `this.idx`) and
  // returns the resulting score delta — touching only the keys these specific entries belong to, before
  // and after. This is the incremental core: cost is O(|changes| * small-constant), independent of the
  // group's total entry count.
  applyChanges(changes: Change[]): number {
    const olds = changes.map(c => this.entries.get(c.id)!)
    const touchedCsKeys = new Set<string>()
    const touchedClKeys = new Set<string>()
    const touchedTeacherDays = new Set<string>() // "teacherId:day"
    for (const o of olds) {
      touchedCsKeys.add(`${o.classSubjectId}:${o.dayOfWeek}`)
      touchedClKeys.add(`${o.classId}:${o.dayOfWeek}`)
      if (o.teacherId) touchedTeacherDays.add(`${o.teacherId}:${o.dayOfWeek}`)
    }
    for (const c of changes) {
      const o = this.entries.get(c.id)!
      touchedCsKeys.add(`${o.classSubjectId}:${c.dayOfWeek}`)
      touchedClKeys.add(`${o.classId}:${c.dayOfWeek}`)
      if (o.teacherId) touchedTeacherDays.add(`${o.teacherId}:${c.dayOfWeek}`)
    }

    let before = 0
    for (const k of touchedCsKeys) before += this.recomputeCsDay(k)
    for (const k of touchedClKeys) before += this.recomputeClassDay(k)
    for (const td of touchedTeacherDays) { const [t, d] = td.split(':'); before += this.recomputeDailyOverload(t, Number(d)); before += this.recomputeGap(t, Number(d)) }
    for (const o of olds) before += this.unpreferredContribution(o)

    // Two-phase mutation: deindex EVERY changed entry's old position first, THEN index every new one.
    // A swap/lab-block move can have entry A's NEW slot equal entry B's OLD slot (that's the whole point
    // of a swap) — interleaving deindex(A)/index(A)/deindex(B)/index(B) per-entry corrupts the shared
    // `teacherDaySlots` Set and the occupancy `idx` maps, because index(A) at B's old slot briefly
    // overwrites/duplicates state that deindex(B) then wrongly deletes, permanently losing a period that
    // should still be occupied (by A). This was a real bug caught by refinement.test.ts's delta-vs-full-
    // recompute cross-check — the fix is this two-phase ordering, not per-entry interleaving.
    const updates = changes.map(c => {
      const old = this.entries.get(c.id)!
      return { old, updated: { ...old, dayOfWeek: c.dayOfWeek, periodIdx: c.periodIdx, roomId: c.roomId } as RefineEntry }
    })
    for (const { old } of updates) this.deindex(old)
    for (const { updated } of updates) { this.entries.set(updated.id, updated); this.index(updated) }

    let after = 0
    for (const k of touchedCsKeys) after += this.recomputeCsDay(k)
    for (const k of touchedClKeys) after += this.recomputeClassDay(k)
    for (const td of touchedTeacherDays) { const [t, d] = td.split(':'); after += this.recomputeDailyOverload(t, Number(d)); after += this.recomputeGap(t, Number(d)) }
    for (const c of changes) after += this.unpreferredContribution(this.entries.get(c.id)!)

    const delta = after - before
    this.total += delta
    return delta
  }

  revert(changes: Change[], originals: Change[]) {
    void changes
    this.applyChanges(originals)
  }

  fullTotal(): number {
    return this.total + this.invariantWeeklyOverloadWeighted + this.invariantVarianceWeighted
  }
}

// ───────────────────────── SA loop with delta scoring ─────────────────────────

export interface SAResult {
  best: RefineEntry[]
  scoreBefore: ScoreBreakdown
  scoreAfter: ScoreBreakdown
  iterations: number
  accepted: number
  elapsedMs: number
  hardBefore: number
  hardAfter: number
}

// `maxIterations` (optional, additive) — Phase T6's reproducibility requirement (phase-t6-sessions-jobs.md
// §3: "regenerate with the same snapshot, byte-identical output"). The default wall-clock budget loop below
// is intentionally NOT bit-reproducible across separate process runs even with the same seed: iteration
// COUNT and, worse, the per-iteration temperature (`elapsedFrac`, derived from real elapsed ms) both vary
// with CPU/scheduler jitter — confirmed empirically while building T6 (greedy placement alone hashes
// identically run-to-run; refined output does not, until this cap is supplied). When `maxIterations` is
// given, the loop and its temperature schedule switch from wall-clock-driven to iteration-count-driven —
// making the WHOLE run a pure function of (initial entries, ctx, seed, maxIterations), hence reproducible —
// while every existing caller (T5's own /auto-generate/refine endpoint, this file's own tests) omits it and
// gets EXACTLY the prior wall-clock behavior, byte-for-byte.
export function simulatedAnneal(initial: RefineEntry[], ctx: ProblemContext, budgetMs: number, seed: number, notPreferredLookup: Set<string> = new Set(), maxIterations?: number): SAResult {
  const rng = mulberry32(seed)
  const scoreBefore = scoreFull(initial, ctx.weights)
  const hardBefore = hardViolations(initial)

  const state = new PenaltyState(initial, ctx.weights, notPreferredLookup)
  let bestTotal = state.fullTotal()
  let bestSnapshot = new Map(state.entries)

  const startTemp = 500, endTemp = 0.5
  const start = Date.now()
  let iterations = 0, accepted = 0
  let currentTotal = bestTotal

  const keepGoing = () => (maxIterations !== undefined ? iterations < maxIterations : Date.now() - start < budgetMs)
  while (keepGoing()) {
    iterations++
    const entriesArr = [...state.entries.values()]
    const r = rng()
    let changes: Change[] | null
    if (r < 0.5) changes = trySwap(entriesArr, state.idx, ctx, rng)
    else if (r < 0.85) changes = tryRelocate(entriesArr, state.idx, ctx, rng)
    else changes = tryMoveLabBlock(entriesArr, state.idx, ctx, rng)
    if (!changes) continue

    const originals: Change[] = changes.map(c => { const e = state.entries.get(c.id)!; return { id: c.id, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, roomId: e.roomId } })
    const delta = state.applyChanges(changes)
    const newTotal = currentTotal + delta
    const elapsedFrac = maxIterations !== undefined ? Math.min(1, iterations / maxIterations) : Math.min(1, (Date.now() - start) / budgetMs)
    const temp = startTemp * Math.pow(endTemp / startTemp, elapsedFrac)
    const accept = delta <= 0 || rng() < Math.exp(-delta / temp)
    if (accept) {
      currentTotal = newTotal
      accepted++
      if (newTotal < bestTotal) { bestTotal = newTotal; bestSnapshot = new Map(state.entries) }
    } else {
      state.revert(changes, originals) // O(touched keys), not O(entries) — genuinely incremental undo too
    }
  }

  const best = [...bestSnapshot.values()]
  const scoreAfter = scoreFull(best, ctx.weights)
  return { best, scoreBefore, scoreAfter, iterations, accepted, elapsedMs: Date.now() - start, hardBefore, hardAfter: hardViolations(best) }
}

export { scoreFull }

// ───────────────────────── orchestration: decompose-by-cohort-group + drive SA per group ─────────────────────────
// See phase-t5-full-solver.md §2 / roadmap T0 result: "refinement should run per-cohort-group (per grade/
// department), not as one school-wide pass". Groups the draft by each entry's class's gradeId (the
// structural near-block-diagonal boundary T0 found — different grades essentially never share teachers/
// periods in this codebase's model) and runs one independent, independently-time-budgeted SA pass per
// group, never a single whole-draft pass.

export interface RefineDraftInput {
  termId: string
  draftEntries: { classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; subjectName: string; roomId?: string | null; teacherId?: string | null; isDoublePeriod?: boolean }[]
  preferenceProfileName?: string
  timeBudgetMsPerGroup: number
  seed?: number
  // Phase T6 reproducibility (see simulatedAnneal's own doc comment) — keyed by this function's own group
  // key (a gradeId, or 'ungrouped'). Omitted by every existing caller, which keeps the original wall-clock
  // SA behavior; TimetableGenerationJob's regenerate path passes the ORIGINAL run's own per-group iteration
  // counts back in here so the re-run is a pure function of the stored snapshot, not of wall-clock timing.
  iterationCapsByGroup?: Record<string, number>
}

export interface RefineGroupReport {
  groupKey: string
  gradeLabel: string
  entries: number
  iterations: number
  accepted: number
  elapsedMs: number
  hardBefore: number
  hardAfter: number
  scoreBefore: ScoreBreakdown
  scoreAfter: ScoreBreakdown
  improvementPct: number
}

export async function refineDraft(ctx: Ctx, input: RefineDraftInput) {
  if (!input.draftEntries.length) throw new Error('No draft entries to refine')

  const classIds = [...new Set(input.draftEntries.map(e => e.classId))]
  const classes = await prisma.class.findMany({ where: { id: { in: classIds }, schoolId: ctx.schoolId }, include: { grade: true } })
  const classById = new Map(classes.map(c => [c.id, c]))

  const rooms = await prisma.room.findMany({ where: { schoolId: ctx.schoolId, kind: 'lab' } })
  const labRoomIds = new Set(rooms.map(r => r.id))

  const teacherIds = [...new Set(input.draftEntries.map(e => e.teacherId).filter((t): t is string => !!t))]
  const availabilityRows = teacherIds.length
    ? await prisma.teacherAvailability.findMany({ where: { schoolId: ctx.schoolId, teacherId: { in: teacherIds }, status: 'NOT_PREFERRED' } })
    : []
  const notPreferredLookup = new Set(availabilityRows.map(a => `${a.teacherId}:${a.dayOfWeek}:${a.periodIdx}`))

  const weights = await effectiveRefinementWeights(ctx, input.preferenceProfileName)

  // Decompose by grade (the cohort-group boundary).
  const groups = new Map<string, typeof input.draftEntries>()
  for (const e of input.draftEntries) {
    const cls = classById.get(e.classId)
    const key = cls?.gradeId ?? 'ungrouped'
    const arr = groups.get(key) ?? []
    arr.push(e)
    groups.set(key, arr)
  }

  const groupReports: RefineGroupReport[] = []
  let seedCounter = input.seed ?? 1234

  // Cross-group-decomposed refinement means each group's SA pass has no visibility into other groups' own
  // entries — see ExternalOccupancy's doc comment above for why that's dangerous for a genuinely shared
  // teacher/room. `latest` tracks every group's CURRENT best-known entries (pre-refinement for groups not
  // yet processed, refined output for groups already done) so each group's external occupancy is always
  // built from the truest available picture of every other group at the moment it runs.
  const latest = new Map<string, typeof input.draftEntries[number]>()
  for (const e of input.draftEntries) latest.set(`${e.classId}:${e.dayOfWeek}:${e.periodIdx}`, e)
  const buildExternal = (excludeGradeId: string): ExternalOccupancy => {
    const teacherSlot = new Map<string, Set<string>>()
    const roomSlot = new Map<string, Set<string>>()
    for (const e of latest.values()) {
      const cls = classById.get(e.classId)
      if ((cls?.gradeId ?? 'ungrouped') === excludeGradeId) continue
      const slot = `${e.dayOfWeek}:${e.periodIdx}`
      if (e.teacherId) { const s = teacherSlot.get(e.teacherId) ?? new Set<string>(); s.add(slot); teacherSlot.set(e.teacherId, s) }
      if (e.roomId) { const s = roomSlot.get(e.roomId) ?? new Set<string>(); s.add(slot); roomSlot.set(e.roomId, s) }
    }
    return { teacherSlot, roomSlot }
  }

  for (const [gradeId, groupDraft] of groups) {
    const sampleClass = classById.get(groupDraft[0].classId)
    const template = await effectiveTemplate(ctx.schoolId, sampleClass?.periodTemplateId ?? null)
    const workingDays: number[] = []
    const periodsByDay = new Map<number, number[]>()
    const doublePairsByDay = new Map<number, [number, number][]>()
    if (template) {
      for (let day = 1; day <= 6; day++) {
        const resolved = await resolveForDay(ctx.schoolId, template.id, day)
        if (!resolved) continue
        const periods = serializePeriodTemplate(resolved).periods.filter(p => p.kind === 'class').sort((a, b) => a.idx - b.idx)
        if (!periods.length) continue
        workingDays.push(day)
        periodsByDay.set(day, periods.map(p => p.idx))
        const pairs: [number, number][] = []
        for (let i = 0; i < periods.length - 1; i++) if (periods[i + 1].start === periods[i].end) pairs.push([periods[i].idx, periods[i + 1].idx])
        doublePairsByDay.set(day, pairs)
      }
    }
    // Fallback: if no template resolves (shouldn't happen once generation has already run), derive
    // candidate slots from whatever days/periods the draft itself already uses, so refinement can still
    // run a same-day-swap-only pass rather than fail outright.
    if (!workingDays.length) {
      for (const e of groupDraft) {
        if (!periodsByDay.has(e.dayOfWeek)) { periodsByDay.set(e.dayOfWeek, []); workingDays.push(e.dayOfWeek) }
        periodsByDay.get(e.dayOfWeek)!.push(e.periodIdx)
      }
    }

    const refineEntries: RefineEntry[] = groupDraft.map((e, i) => ({
      id: i + 1,
      classId: e.classId,
      gradeId,
      dayOfWeek: e.dayOfWeek,
      periodIdx: e.periodIdx,
      classSubjectId: e.classSubjectId,
      subjectName: e.subjectName,
      roomId: e.roomId ?? null,
      teacherId: e.teacherId ?? null,
      isDoublePeriod: !!e.isDoublePeriod,
      notPreferred: false, // resolved dynamically via notPreferredLookup during SA, not cached here
    }))

    const external = buildExternal(gradeId)
    const problemCtx: ProblemContext = { workingDays, periodsByDay, doublePairsByDay, labRoomIds, weights, external }
    const result = simulatedAnneal(refineEntries, problemCtx, input.timeBudgetMsPerGroup, seedCounter++, notPreferredLookup, input.iterationCapsByGroup?.[gradeId])

    // Remove this group's OLD slot keys from `latest` and insert the refined ones, so the NEXT group's
    // external-occupancy snapshot reflects this group's actual output, not its pre-refinement placement.
    for (const e of groupDraft) latest.delete(`${e.classId}:${e.dayOfWeek}:${e.periodIdx}`)
    for (const r of result.best) {
      const original = groupDraft[r.id - 1]
      const updated = { ...original, dayOfWeek: r.dayOfWeek, periodIdx: r.periodIdx, roomId: r.roomId, teacherId: r.teacherId }
      latest.set(`${updated.classId}:${updated.dayOfWeek}:${updated.periodIdx}`, updated)
    }
    const improvementPct = result.scoreBefore.total > 0 ? 100 * (1 - result.scoreAfter.total / result.scoreBefore.total) : 0
    groupReports.push({
      groupKey: gradeId, gradeLabel: sampleClass?.grade.label ?? gradeId, entries: groupDraft.length,
      iterations: result.iterations, accepted: result.accepted, elapsedMs: result.elapsedMs,
      hardBefore: result.hardBefore, hardAfter: result.hardAfter,
      scoreBefore: result.scoreBefore, scoreAfter: result.scoreAfter, improvementPct,
    })
  }

  const refinedEntries = [...latest.values()]

  // A TRUE cross-group hard-constraint check on the fully merged, final draft — not a sum of each group's
  // own (necessarily group-local) hardBefore/hardAfter. This is what actually proves "zero violations
  // across the whole draft", closing the exact gap ExternalOccupancy exists to prevent in the first place.
  const globalViolations = (entries: typeof refinedEntries, key: 'teacherId' | 'roomId' | 'classId') => {
    const seen = new Map<string, number>()
    for (const e of entries) {
      const k = e[key]
      if (!k) continue
      const slot = `${k}@${e.dayOfWeek}:${e.periodIdx}`
      seen.set(slot, (seen.get(slot) ?? 0) + 1)
    }
    let v = 0
    for (const c of seen.values()) if (c > 1) v += c - 1
    return v
  }
  const hardViolationsAfter = globalViolations(refinedEntries, 'teacherId') + globalViolations(refinedEntries, 'roomId') + globalViolations(refinedEntries, 'classId')
  const hardViolationsBefore = globalViolations(input.draftEntries, 'teacherId') + globalViolations(input.draftEntries, 'roomId') + globalViolations(input.draftEntries, 'classId')

  const totalBefore = groupReports.reduce((a, g) => a + g.scoreBefore.total, 0)
  const totalAfter = groupReports.reduce((a, g) => a + g.scoreAfter.total, 0)
  await audit(ctx.schoolId, ctx.actorId, 'refine', 'timetable', input.termId, { totalBefore }, {
    totalAfter, groups: groupReports.length, entries: refinedEntries.length, hardViolationsAfter,
  })

  return {
    draftEntries: refinedEntries,
    groups: groupReports,
    scoreBefore: totalBefore,
    scoreAfter: totalAfter,
    improvementPct: totalBefore > 0 ? 100 * (1 - totalAfter / totalBefore) : 0,
    hardViolationsBefore,
    hardViolationsAfter,
  }
}
