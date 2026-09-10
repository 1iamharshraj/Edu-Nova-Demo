import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { effectiveTemplate, resolveForDay, serializePeriodTemplate } from '../periodTemplates/service'
import { markBusy, isBusy, type Occupancy } from './autogen'
import type { addPoolMember, setAvailabilityBody } from './schema'

// ───────────────────────── Phase T5 §1 — Assignment Modes 2-4 ─────────────────────────
// See phase-t5-full-solver.md §1. T4 shipped Mode 1 (FIXED) only — one admin-picked TeachingAssignment row
// per TeachingRequirement. This file adds the other three: POOL (admin-defined eligible set, workload
// tiebreak), RANDOM (random among T1 TeacherQualification-eligible teachers, still hard-constraint-safe),
// and OPTIMIZED (the real scoring selector using qualification/availability/workload/suitability/
// preference/conflict/band-affinity signals). All three *resolve* into the exact same TeachingAssignment
// row FIXED already used — solver.ts's `prisma.teachingAssignment.findUnique({ where: { teachingRequirementId } })`
// lookup needs zero changes to consume whichever mode produced the row.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const ASSIGNMENT_PREFERENCE_TYPES = [
  'QUALIFICATION_MATCH', 'AVAILABILITY_MATCH', 'WORKLOAD_BALANCE', 'CLASS_SUITABILITY',
  'TEACHER_PREFERENCE', 'CONFLICT_MINIMIZATION', 'BAND_AFFINITY',
] as const
export type AssignmentPreferenceType = (typeof ASSIGNMENT_PREFERENCE_TYPES)[number]

// T0 spike's own example weights, scaled into a 0-100-ish "assignment score" space (this is a selection
// heuristic, not the SA's staged objective — the W_HARD/MAJOR/WORKLOAD/MINOR separation is refinement.ts's
// concern, not this one). Seeded into Preference(scope='ASSIGNMENT') by seedAssignmentPreferenceDefaults.
export const DEFAULT_ASSIGNMENT_WEIGHTS: Record<AssignmentPreferenceType, number> = {
  QUALIFICATION_MATCH: 30,
  AVAILABILITY_MATCH: 15,
  WORKLOAD_BALANCE: 15,
  CLASS_SUITABILITY: 10,
  TEACHER_PREFERENCE: 10,
  CONFLICT_MINIMIZATION: 10,
  BAND_AFFINITY: 10,
}

// Verified band affinity outranks a teacher's own declared affinity (roadmap §1 / T5 spec) — a declared
// signal still counts, just discounted, since it's self-reported and not yet corroborated by T11's future
// evaluation engine.
const VERIFIED_AFFINITY_MULTIPLIER = 1.0
const DECLARED_AFFINITY_MULTIPLIER = 0.6
const AFFINITY_STRENGTH_SCORE: Record<string, number> = { STRONG: 1, MEDIUM: 0.5, NONE: 0 }

export async function seedAssignmentPreferenceDefaults(ctx: Ctx) {
  const existing = new Set((await prisma.preference.findMany({ where: { schoolId: ctx.schoolId, scope: 'ASSIGNMENT' } })).map(p => p.type))
  let added = 0
  for (const type of ASSIGNMENT_PREFERENCE_TYPES) {
    if (existing.has(type)) continue
    await prisma.preference.create({
      data: { schoolId: ctx.schoolId, type, scope: 'ASSIGNMENT', weight: DEFAULT_ASSIGNMENT_WEIGHTS[type], priority: 0, enabled: true },
    })
    added++
  }
  return added
}

async function assignmentWeights(ctx: Ctx): Promise<Record<string, number>> {
  const rows = await prisma.preference.findMany({ where: { schoolId: ctx.schoolId, scope: 'ASSIGNMENT', enabled: true } })
  const map: Record<string, number> = { ...DEFAULT_ASSIGNMENT_WEIGHTS }
  for (const r of rows) map[r.type] = r.weight
  return map
}

// ───────────────────────── TeacherAvailability (T1-promised, T5-delivered — see schema.prisma note) ─────────────────────────

export const serializeAvailability = (a: { id: string; teacherId: string; dayOfWeek: number; periodIdx: number; status: string }) => ({
  id: a.id, teacherId: a.teacherId, dayOfWeek: a.dayOfWeek, periodIdx: a.periodIdx, status: a.status,
})

export function listAvailability(ctx: Ctx, teacherId: string) {
  return prisma.teacherAvailability.findMany({ where: { schoolId: ctx.schoolId, teacherId }, orderBy: [{ dayOfWeek: 'asc' }, { periodIdx: 'asc' }] })
}

// Replaces the full set for one teacher (simplest correct semantics — mirrors service.ts#replaceGrid's
// own "replace the whole set" convention rather than a fiddly per-row PATCH).
export async function setAvailability(ctx: Ctx, input: z.infer<typeof setAvailabilityBody>) {
  const teacher = await prisma.user.findFirst({ where: { id: input.teacherId, schoolId: ctx.schoolId, role: 'teacher' } })
  if (!teacher) throw notFound('Teacher')
  const before = await listAvailability(ctx, input.teacherId)
  await prisma.$transaction(async tx => {
    await tx.teacherAvailability.deleteMany({ where: { schoolId: ctx.schoolId, teacherId: input.teacherId } })
    if (input.entries.length) {
      await tx.teacherAvailability.createMany({
        data: input.entries.map(e => ({ schoolId: ctx.schoolId, teacherId: input.teacherId, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, status: e.status })),
      })
    }
  })
  const after = await listAvailability(ctx, input.teacherId)
  await audit(ctx.schoolId, ctx.actorId, 'set-availability', 'teacherAvailability', input.teacherId, { count: before.length }, { count: after.length })
  return after
}

// ───────────────────────── TeachingAssignmentPool (Mode 2) ─────────────────────────

export const serializePoolMember = (p: { id: string; teachingRequirementId: string; teacherId: string }) => ({
  id: p.id, teachingRequirementId: p.teachingRequirementId, teacherId: p.teacherId,
})

export function listPool(ctx: Ctx, teachingRequirementId: string) {
  return prisma.teachingAssignmentPool.findMany({ where: { schoolId: ctx.schoolId, teachingRequirementId }, orderBy: { createdAt: 'asc' } })
}

export async function addToPool(ctx: Ctx, input: z.infer<typeof addPoolMember>) {
  const req = await prisma.teachingRequirement.findFirst({ where: { id: input.teachingRequirementId, schoolId: ctx.schoolId } })
  if (!req) throw notFound('Teaching requirement')
  const teacher = await prisma.user.findFirst({ where: { id: input.teacherId, schoolId: ctx.schoolId, role: 'teacher' } })
  if (!teacher) throw notFound('Teacher')
  const dup = await prisma.teachingAssignmentPool.findUnique({ where: { teachingRequirementId_teacherId: { teachingRequirementId: input.teachingRequirementId, teacherId: input.teacherId } } })
  if (dup) throw new HttpError(409, 'This teacher is already in the pool for this requirement')
  const row = await prisma.teachingAssignmentPool.create({ data: { schoolId: ctx.schoolId, teachingRequirementId: input.teachingRequirementId, teacherId: input.teacherId } })
  await audit(ctx.schoolId, ctx.actorId, 'add-to-pool', 'teachingAssignmentPool', row.id, undefined, serializePoolMember(row))
  return row
}

export async function removeFromPool(ctx: Ctx, id: string) {
  const before = await prisma.teachingAssignmentPool.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Pool member')
  await prisma.teachingAssignmentPool.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'remove-from-pool', 'teachingAssignmentPool', id, serializePoolMember(before))
}

export async function setAssignmentMode(ctx: Ctx, teachingRequirementId: string, mode: string) {
  const req = await prisma.teachingRequirement.findFirst({ where: { id: teachingRequirementId, schoolId: ctx.schoolId } })
  if (!req) throw notFound('Teaching requirement')
  const row = await prisma.teachingRequirement.update({ where: { id: teachingRequirementId }, data: { assignmentMode: mode } })
  await audit(ctx.schoolId, ctx.actorId, 'set-assignment-mode', 'teachingRequirement', teachingRequirementId, { assignmentMode: req.assignmentMode }, { assignmentMode: mode })
  return row
}

// ───────────────────────── eligibility + shared helpers ─────────────────────────

async function cohortGradeOrder(cohortId: string): Promise<number | null> {
  const cohort = await prisma.cohort.findUnique({ where: { id: cohortId }, include: { grade: true, members: { include: { class: { include: { grade: true } } }, take: 1 } } })
  if (!cohort) return null
  if (cohort.grade) return cohort.grade.order
  return cohort.members[0]?.class.grade.order ?? null
}

// T1 TeacherQualification scoped to subject + a grade level (Mode 3/4's eligibility universe, per spec).
async function qualifiedTeachers(ctx: Ctx, subjectId: string, gradeOrder: number | null) {
  return prisma.teacherQualification.findMany({
    where: {
      schoolId: ctx.schoolId,
      subjectId,
      ...(gradeOrder != null ? { gradeRangeMin: { lte: gradeOrder }, gradeRangeMax: { gte: gradeOrder } } : {}),
    },
    include: { teacher: { select: { id: true, name: true } } },
  })
}

async function currentWeeklyLoad(ctx: Ctx, termId: string, teacherId: string): Promise<number> {
  return prisma.timetableEntry.count({ where: { schoolId: ctx.schoolId, termId, teacherId } })
}

// Working periods for a cohort this term (same day-template resolution solver.ts does) — used for
// conflict-minimization scoring (how much of the cohort's own week is this teacher already busy in).
async function cohortWorkingSlots(ctx: Ctx, cohort: { members: { class: { periodTemplateId: string | null } }[] }): Promise<string[]> {
  const base = cohort.members[0]?.class.periodTemplateId ?? null
  const template = await effectiveTemplate(ctx.schoolId, base)
  if (!template) return []
  const slots: string[] = []
  for (let day = 1; day <= 6; day++) {
    const resolved = await resolveForDay(ctx.schoolId, template.id, day)
    if (!resolved) continue
    for (const p of serializePeriodTemplate(resolved).periods) if (p.kind === 'class') slots.push(`${day}:${p.idx}`)
  }
  return slots
}

// Dominant support/mid/advanced band among a cohort's currently-enrolled students, from the latest
// APPROVED T3 SectioningAssignment naming this cohort (roadmap: "T3 section band profiles"). Returns null
// (no data) rather than guessing — Mode 4's caller must render an honest "no band data" fallback message.
async function cohortDominantBand(ctx: Ctx, cohortId: string): Promise<string | null> {
  const assignments = await prisma.sectioningAssignment.findMany({
    where: { schoolId: ctx.schoolId, cohortId, band: { not: null }, version: { status: 'APPROVED' } },
    orderBy: { createdAt: 'desc' },
    select: { studentId: true, band: true, createdAt: true },
  })
  if (!assignments.length) return null
  const latestPerStudent = new Map<string, string>()
  for (const a of assignments) if (!latestPerStudent.has(a.studentId)) latestPerStudent.set(a.studentId, a.band!)
  const counts = new Map<string, number>()
  for (const band of latestPerStudent.values()) counts.set(band, (counts.get(band) ?? 0) + 1)
  let best: string | null = null
  let bestCount = -1
  for (const [band, count] of counts) if (count > bestCount) { best = band; bestCount = count }
  return best
}

// Band labels are school-editable free text (T3 PerformanceBand.label) — this maps a label onto the
// teacher affinity JSON's fixed 3-tier shape by substring, the same documented-heuristic convention this
// codebase already uses (see autogen.ts#needsLab). Falls back to 'mid' when no keyword matches, since a
// generic mid-tier assumption is safer than silently dropping the signal.
function bandLabelToAffinityTier(label: string): 'support' | 'mid' | 'advanced' {
  const l = label.toLowerCase()
  if (/supp|foundation|struggl|remedial|below/.test(l)) return 'support'
  if (/adv|top|merit|honou?rs|accel/.test(l)) return 'advanced'
  return 'mid'
}

interface ScoredCandidate {
  teacherId: string
  teacherName: string
  total: number
  breakdown: Record<string, number>
  reasonParts: string[]
}

async function scoreCandidate(
  ctx: Ctx,
  args: {
    teacherId: string; teacherName: string; subjectId: string; gradeOrder: number | null
    termId: string; weights: Record<string, number>
    workingSlots: string[]; busySlotsForTeacher: (teacherId: string) => Set<string>
    dominantBand: string | null; dominantBandLabel: string | null
  },
): Promise<ScoredCandidate> {
  const { teacherId, teacherName, subjectId, gradeOrder, termId, weights } = args
  const breakdown: Record<string, number> = {}
  const reasonParts: string[] = []

  // Qualification match
  const quals = await prisma.teacherQualification.findMany({ where: { schoolId: ctx.schoolId, teacherId, subjectId } })
  const bestQual = quals.find(q => gradeOrder == null || (q.gradeRangeMin <= gradeOrder && q.gradeRangeMax >= gradeOrder))
  if (bestQual) {
    const qScore = (bestQual.isPrimarySubject || bestQual.proficiency === 'PRIMARY') ? 1 : 0.6
    breakdown.QUALIFICATION_MATCH = weights.QUALIFICATION_MATCH * qScore
    reasonParts.push(`qualified (${bestQual.proficiency.toLowerCase()}${bestQual.isPrimarySubject ? ', primary subject' : ''})`)
  } else {
    breakdown.QUALIFICATION_MATCH = 0
    reasonParts.push('no declared qualification on file for this subject/grade')
  }

  // Availability: fewer UNAVAILABLE/NOT_PREFERRED slots this teacher has declared = more flexible.
  const availability = await prisma.teacherAvailability.findMany({ where: { schoolId: ctx.schoolId, teacherId } })
  const unavailable = availability.filter(a => a.status === 'UNAVAILABLE').length
  const notPreferred = availability.filter(a => a.status === 'NOT_PREFERRED').length
  const preferred = availability.filter(a => a.status === 'PREFERRED').length
  const availFrac = Math.max(0, 1 - (unavailable * 2 + notPreferred) / 20)
  breakdown.AVAILABILITY_MATCH = weights.AVAILABILITY_MATCH * availFrac
  if (unavailable || notPreferred) reasonParts.push(`${unavailable} unavailable + ${notPreferred} not-preferred slot(s) declared`)

  // Workload balance: lower current load this term scores higher (capped comparison, not absolute).
  const load = await currentWeeklyLoad(ctx, termId, teacherId)
  const WORKLOAD_CAP = 30
  const workloadScore = Math.max(0, 1 - load / WORKLOAD_CAP)
  breakdown.WORKLOAD_BALANCE = weights.WORKLOAD_BALANCE * workloadScore
  reasonParts.push(`current load ${load} periods/week`)

  // Class suitability: a tighter (more specialized) qualification grade range scores higher than a broad one.
  const suitability = bestQual ? Math.max(0.2, 1 - (bestQual.gradeRangeMax - bestQual.gradeRangeMin) / 12) : 0.3
  breakdown.CLASS_SUITABILITY = weights.CLASS_SUITABILITY * suitability

  // Teacher preference: PREFERRED-slot count is a direct positive signal (distinct from availability's
  // UNAVAILABLE/NOT_PREFERRED-avoidance framing above).
  const prefScore = Math.min(1, preferred / 10)
  breakdown.TEACHER_PREFERENCE = weights.TEACHER_PREFERENCE * prefScore
  if (preferred) reasonParts.push(`${preferred} preferred slot(s) declared`)

  // Conflict minimization: fraction of the cohort's own working week this teacher is already busy in
  // (existing entries this term, plus anything placed earlier in this same generation run).
  const busy = args.busySlotsForTeacher(teacherId)
  const busyInCohortWeek = args.workingSlots.filter(s => busy.has(s)).length
  const conflictScore = args.workingSlots.length ? Math.max(0, 1 - busyInCohortWeek / args.workingSlots.length) : 1
  breakdown.CONFLICT_MINIMIZATION = weights.CONFLICT_MINIMIZATION * conflictScore

  // Band affinity — VERIFIED > DECLARED, honest "no match" fallback when neither exists.
  if (args.dominantBand && args.dominantBandLabel) {
    const tier = bandLabelToAffinityTier(args.dominantBandLabel)
    const teacher = await prisma.user.findUnique({ where: { id: teacherId }, select: { declaredBandAffinity: true, verifiedBandAffinity: true } })
    const verified = (teacher?.verifiedBandAffinity as Record<string, string> | null) ?? null
    const declared = (teacher?.declaredBandAffinity as Record<string, string> | null) ?? null
    if (verified?.[tier]) {
      const strength = AFFINITY_STRENGTH_SCORE[verified[tier]] ?? 0
      breakdown.BAND_AFFINITY = weights.BAND_AFFINITY * strength * VERIFIED_AFFINITY_MULTIPLIER
      reasonParts.push(`verified ${tier}-band affinity: ${verified[tier].toLowerCase()}`)
    } else if (declared?.[tier]) {
      const strength = AFFINITY_STRENGTH_SCORE[declared[tier]] ?? 0
      breakdown.BAND_AFFINITY = weights.BAND_AFFINITY * strength * DECLARED_AFFINITY_MULTIPLIER
      reasonParts.push(`declared ${tier}-band affinity: ${declared[tier].toLowerCase()} (not yet verified)`)
    } else {
      breakdown.BAND_AFFINITY = 0
      reasonParts.push(`no ${tier}-band affinity declared`)
    }
  } else {
    breakdown.BAND_AFFINITY = 0
  }

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return { teacherId, teacherName, total, breakdown, reasonParts }
}

export interface ResolveOptions {
  // Live occupancy from an in-progress generation run (solver.ts), so conflict-minimization/hard-safety
  // reflects placements made earlier in THIS run, not just what's already committed to the DB.
  liveTeacherBusy?: Occupancy
}

// The actual Modes 2-4 selector. Writes (replaces) the requirement's single TeachingAssignment row.
// `termId` scopes the workload/conflict signals to one generation run's term (TeachingRequirement itself
// is cohort-scoped, not term-scoped, so this must be threaded in by the caller — solver.ts already has it
// on hand from the generation request; the standalone resolve endpoints require it explicitly).
export async function resolveAssignment(ctx: Ctx, teachingRequirementId: string, termId: string, opts: ResolveOptions = {}) {
  const req = await prisma.teachingRequirement.findFirst({ where: { id: teachingRequirementId, schoolId: ctx.schoolId }, include: { subject: true, cohort: { include: { grade: true, members: { include: { class: { include: { grade: true, periodTemplate: true } } } } } } } })
  if (!req) throw notFound('Teaching requirement')
  if (req.assignmentMode === 'FIXED') {
    const existing = await prisma.teachingAssignment.findUnique({ where: { teachingRequirementId } })
    if (!existing) throw new HttpError(400, 'This requirement is in FIXED mode — create a Teaching Assignment directly (POST /teaching-assignments) instead of resolving')
    return existing
  }

  const gradeOrder = await cohortGradeOrder(req.cohortId)
  const busySlotsForTeacher = (teacherId: string): Set<string> => {
    const live = opts.liveTeacherBusy?.get(teacherId)
    return live ?? new Set<string>()
  }

  let picked: { teacherId: string; teacherName: string; reason: string }

  if (req.assignmentMode === 'POOL') {
    const pool = await prisma.teachingAssignmentPool.findMany({ where: { schoolId: ctx.schoolId, teachingRequirementId }, include: { teacher: { select: { id: true, name: true } } } })
    if (!pool.length) throw new HttpError(400, `No teachers in the pool for "${req.subject.name}" — add at least one via POST /teaching-assignment-pool first`)
    const withLoad = await Promise.all(pool.map(async p => ({ p, load: await currentWeeklyLoad(ctx, termId, p.teacherId) })))
    withLoad.sort((a, b) => a.load - b.load)
    const best = withLoad[0]
    picked = {
      teacherId: best.p.teacherId,
      teacherName: best.p.teacher.name,
      reason: `Pool mode — selected ${best.p.teacher.name} from ${pool.length} eligible pool member(s), lowest current workload (${best.load} periods) as tiebreaker`,
    }
  } else if (req.assignmentMode === 'RANDOM') {
    const eligible = await qualifiedTeachers(ctx, req.subjectId, gradeOrder)
    if (!eligible.length) throw new HttpError(400, `No T1-qualified teacher found for "${req.subject.name}"${gradeOrder != null ? ` at grade level ${gradeOrder}` : ''} — add a Teacher Qualification first`)
    const idx = Math.floor(Math.random() * eligible.length)
    const chosen = eligible[idx]
    picked = {
      teacherId: chosen.teacherId,
      teacherName: chosen.teacher.name,
      reason: `Random mode — selected ${chosen.teacher.name} at random among ${eligible.length} qualification-eligible teacher(s) for "${req.subject.name}"`,
    }
  } else {
    // OPTIMIZED
    const eligible = await qualifiedTeachers(ctx, req.subjectId, gradeOrder)
    const candidates = eligible.length
      ? eligible.map(q => ({ id: q.teacherId, name: q.teacher.name }))
      : (await prisma.user.findMany({ where: { schoolId: ctx.schoolId, role: 'teacher' }, select: { id: true, name: true }, take: 50 }))
    if (!candidates.length) throw new HttpError(400, `No teacher available at all to score for "${req.subject.name}"`)
    const weights = await assignmentWeights(ctx)
    const workingSlots = await cohortWorkingSlots(ctx, req.cohort)
    const dominantBand = await cohortDominantBand(ctx, req.cohortId)
    const bandRow = dominantBand ? await prisma.performanceBand.findFirst({ where: { schoolId: ctx.schoolId, label: dominantBand } }) : null
    const scored = await Promise.all(candidates.map(c => scoreCandidate(ctx, {
      teacherId: c.id, teacherName: c.name, subjectId: req.subjectId, gradeOrder, termId,
      weights, workingSlots, busySlotsForTeacher, dominantBand, dominantBandLabel: bandRow?.label ?? dominantBand,
    })))
    scored.sort((a, b) => b.total - a.total)
    const winner = scored[0]
    const noQualified = !eligible.length
    const noBandMatch = !dominantBand || winner.breakdown.BAND_AFFINITY === 0
    const reasonHead = noQualified
      ? `Optimized mode — no T1-qualified teacher on file for "${req.subject.name}"; best-fit by other signals: ${winner.teacherName}`
      : `Optimized mode — selected ${winner.teacherName} (score ${winner.total.toFixed(1)} of ${scored.length} candidate(s))`
    const bandNote = noBandMatch
      ? 'no band-affinity match — best-fit by other signals'
      : `band-affinity matched (${winner.reasonParts.find(r => r.includes('band affinity')) ?? 'affinity considered'})`
    picked = {
      teacherId: winner.teacherId,
      teacherName: winner.teacherName,
      reason: `${reasonHead}: ${winner.reasonParts.filter(r => !r.includes('band affinity')).join(', ')}; ${bandNote}.`,
    }
  }

  const existing = await prisma.teachingAssignment.findUnique({ where: { teachingRequirementId } })
  const row = existing
    ? await prisma.teachingAssignment.update({
        where: { teachingRequirementId },
        data: { teacherId: picked.teacherId, assignmentMode: req.assignmentMode, selectionReason: picked.reason, createdBy: ctx.actorId },
      })
    : await prisma.teachingAssignment.create({
        data: { schoolId: ctx.schoolId, teachingRequirementId, teacherId: picked.teacherId, assignmentMode: req.assignmentMode, selectionReason: picked.reason, createdBy: ctx.actorId },
      })
  await audit(ctx.schoolId, ctx.actorId, `resolve-assignment-${req.assignmentMode.toLowerCase()}`, 'teachingAssignment', row.id, existing ? { teacherId: existing.teacherId } : undefined, { teacherId: row.teacherId, reason: picked.reason })
  return row
}

export async function resolveAssignmentsForCohorts(ctx: Ctx, cohortIds: string[], termId: string) {
  const requirements = await prisma.teachingRequirement.findMany({ where: { schoolId: ctx.schoolId, cohortId: { in: cohortIds }, assignmentMode: { not: 'FIXED' } } })
  const results: { teachingRequirementId: string; teacherId: string; selectionReason: string | null }[] = []
  for (const req of requirements) {
    const row = await resolveAssignment(ctx, req.id, termId)
    results.push({ teachingRequirementId: req.id, teacherId: row.teacherId, selectionReason: row.selectionReason })
  }
  return { resolved: results.length, items: results }
}

// Re-exported so solver.ts can build the same "day:idx"-format occupancy this file expects, without a
// circular import back to autogen.ts at the call site.
export { markBusy, isBusy, DAY_NAMES }
