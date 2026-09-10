import type { z } from 'zod'
import type { LeaveRequest, SubstitutionRequest, SubstitutionPolicy } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { toDate, fmtDate } from '../../lib/validate'
import { isAdmin } from '../../lib/scope'
import { assertTeacher } from '../classes/service'
import { activeTypes } from './constraints'
import { create as createManualSubstitution } from '../substitutions/service'
import { classLabel } from './shared'
import type {
  patchSubstitutionPolicyBody, substitutionFinderBody, createSubstitutionRequestBody, decideSubstitutionRequestBody,
} from './schema'

// ───────────────────────── Phase T9 — Substitution Workflow ─────────────────────────
// See .agents/edunova/phase-t9-substitution.md and roadmap D6. Read schema.prisma's own T9 doc comment
// first (SubstitutionPolicy / SubstitutionRequest / PeriodHold, and the PeriodHold-vs-TimetableLock design
// note) — this file is the Finder + request/accept/decline + leave-approval + chained-absence machinery
// that reads/writes those tables.
//
// Design note on "timetable patched via T8's what-if engine" (from the phase spec's flow description): a
// substitution covers a specific CALENDAR DATE, not a recurring weekly slot — applying T8's what-if engine
// (which patches a TimetableVersion's recurring template) would incorrectly make the substitute the
// PERMANENT teacher for that slot every week going forward, which is wrong for what is, in the overwhelming
// common case, a short one-off absence. The actual "patch" this module applies on approval is a real
// Substitution row (Phase 2's existing one-off-exception model, reused via ../substitutions/service.ts#create
// — not reimplemented) — precisely the primitive this codebase already has for "this one date, this one
// period, a different teacher." What-if genuinely IS the right tool for the "no candidate / declined, and
// this is a longer-running absence that should restructure the recurring timetable itself" case — this
// module surfaces a ready-to-submit whatIfBody (TEACHER_UNAVAILABLE event) for that case rather than
// auto-triggering a permanent version publish behind an admin's back; see `buildWhatIfSuggestion` below.
// Documented here and in the phase's final report as a deliberate, reasoned deviation from the literal
// wording, not an oversight.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const weekdayOf = (d: Date) => d.getUTCDay() // matches substitutions/service.ts's own convention

// ───────────────────────── SubstitutionPolicy (D6) ─────────────────────────

const POLICY_DEFAULTS = {
  mode: 'TEACHER_INITIATED' as const,
  minNoticeHoursForSubstitution: 12,
  allowCrossSubject: false,
  maxWeeklySubstitutePeriods: 30,
  tentativeHoldExpiryMinutes: 240,
}

export const serializePolicy = (p: SubstitutionPolicy | null, schoolId: string) => ({
  schoolId,
  mode: p?.mode ?? POLICY_DEFAULTS.mode,
  minNoticeHoursForSubstitution: p?.minNoticeHoursForSubstitution ?? POLICY_DEFAULTS.minNoticeHoursForSubstitution,
  allowCrossSubject: p?.allowCrossSubject ?? POLICY_DEFAULTS.allowCrossSubject,
  maxWeeklySubstitutePeriods: p?.maxWeeklySubstitutePeriods ?? POLICY_DEFAULTS.maxWeeklySubstitutePeriods,
  tentativeHoldExpiryMinutes: p?.tentativeHoldExpiryMinutes ?? POLICY_DEFAULTS.tentativeHoldExpiryMinutes,
  configured: !!p,
})

export async function getPolicy(ctx: Ctx) {
  const row = await prisma.substitutionPolicy.findUnique({ where: { schoolId: ctx.schoolId } })
  return serializePolicy(row, ctx.schoolId)
}

interface EffectivePolicy { mode: string; minNoticeHoursForSubstitution: number; allowCrossSubject: boolean; maxWeeklySubstitutePeriods: number; tentativeHoldExpiryMinutes: number }

// Internal — the raw effective values (not the serialized wire shape), used by every check below.
async function effectivePolicy(ctx: Ctx): Promise<EffectivePolicy> {
  const row = await prisma.substitutionPolicy.findUnique({ where: { schoolId: ctx.schoolId } })
  return {
    mode: row?.mode ?? POLICY_DEFAULTS.mode,
    minNoticeHoursForSubstitution: row?.minNoticeHoursForSubstitution ?? POLICY_DEFAULTS.minNoticeHoursForSubstitution,
    allowCrossSubject: row?.allowCrossSubject ?? POLICY_DEFAULTS.allowCrossSubject,
    maxWeeklySubstitutePeriods: row?.maxWeeklySubstitutePeriods ?? POLICY_DEFAULTS.maxWeeklySubstitutePeriods,
    tentativeHoldExpiryMinutes: row?.tentativeHoldExpiryMinutes ?? POLICY_DEFAULTS.tentativeHoldExpiryMinutes,
  }
}

export async function upsertPolicy(ctx: Ctx, input: z.infer<typeof patchSubstitutionPolicyBody>) {
  const before = await prisma.substitutionPolicy.findUnique({ where: { schoolId: ctx.schoolId } })
  const row = await prisma.substitutionPolicy.upsert({
    where: { schoolId: ctx.schoolId },
    create: { schoolId: ctx.schoolId, ...POLICY_DEFAULTS, ...input },
    update: { ...input },
  })
  await audit(ctx.schoolId, ctx.actorId, before ? 'update' : 'create', 'substitutionPolicy', row.id, before ? serializePolicy(before, ctx.schoolId) : undefined, serializePolicy(row, ctx.schoolId))
  return serializePolicy(row, ctx.schoolId)
}

// ───────────────────────── ranking weights (T5 Preference-table pattern, scope='SUBSTITUTION') ─────────────────────────

export const SUBSTITUTION_PREFERENCE_TYPES = [
  'QUALIFICATION_MATCH', 'SAME_SUBJECT', 'AVAILABILITY_FIT', 'WORKLOAD_HEADROOM',
  'AVOIDS_CONSECUTIVE_LOAD', 'PREFERENCE', 'CLASS_SUITABILITY',
] as const
type SubPrefType = (typeof SUBSTITUTION_PREFERENCE_TYPES)[number]

// Exactly the phase spec's default weight table (§2): qualification 40 / same subject 20 / availability fit
// 15 / workload headroom 10 / avoids-consecutive-load 5 / preference 5 / class suitability 5 (sums to 100).
export const DEFAULT_SUBSTITUTION_WEIGHTS: Record<SubPrefType, number> = {
  QUALIFICATION_MATCH: 40,
  SAME_SUBJECT: 20,
  AVAILABILITY_FIT: 15,
  WORKLOAD_HEADROOM: 10,
  AVOIDS_CONSECUTIVE_LOAD: 5,
  PREFERENCE: 5,
  CLASS_SUITABILITY: 5,
}

export async function seedSubstitutionPreferenceDefaults(ctx: Ctx) {
  const existing = new Set((await prisma.preference.findMany({ where: { schoolId: ctx.schoolId, scope: 'SUBSTITUTION' } })).map(p => p.type))
  let added = 0
  for (const type of SUBSTITUTION_PREFERENCE_TYPES) {
    if (existing.has(type)) continue
    await prisma.preference.create({ data: { schoolId: ctx.schoolId, type, scope: 'SUBSTITUTION', weight: DEFAULT_SUBSTITUTION_WEIGHTS[type], priority: 0, enabled: true } })
    added++
  }
  return added
}

async function substitutionWeights(ctx: Ctx): Promise<Record<string, number>> {
  const rows = await prisma.preference.findMany({ where: { schoolId: ctx.schoolId, scope: 'SUBSTITUTION', enabled: true } })
  const map: Record<string, number> = { ...DEFAULT_SUBSTITUTION_WEIGHTS }
  for (const r of rows) map[r.type] = r.weight
  return map
}

// ───────────────────────── resolving a leave's own covered periods ─────────────────────────

export interface SubPeriod {
  date: string; dayOfWeek: number; periodIdx: number; timetableEntryId: string
  classId: string; classLabel: string; classSubjectId: string; subjectId: string; subjectName: string
  termId: string; roomId: string | null; gradeOrder: number
}

async function termForDate(schoolId: string, date: Date) {
  return prisma.term.findFirst({ where: { schoolId, startDate: { lte: date }, endDate: { gte: date } } })
}

// Every real teaching period the given teacher's own TimetableEntry names, across every calendar date in
// [fromDate, toDate] (Sundays excluded, matching leave/service.ts#countDays' own convention). Empty for a
// teacher with no timetabled periods across the whole range, and ALWAYS empty for a non-teacher — this is
// exactly what makes the critical regression requirement (staff/non-teaching leave keeps working unchanged)
// true by construction: nothing downstream of this function ever runs for such a leave.
export async function resolveLeavePeriods(ctx: Ctx, leave: { forUserId: string; fromDate: Date; toDate: Date }): Promise<SubPeriod[]> {
  const forUser = await prisma.user.findUnique({ where: { id: leave.forUserId } })
  if (!forUser || forUser.role !== 'teacher') return []

  const periods: SubPeriod[] = []
  const d = new Date(leave.fromDate)
  while (d.getTime() <= leave.toDate.getTime()) {
    const dow = weekdayOf(d)
    if (dow !== 0) {
      const term = await termForDate(ctx.schoolId, d)
      if (term) {
        const entries = await prisma.timetableEntry.findMany({
          where: { schoolId: ctx.schoolId, termId: term.id, teacherId: leave.forUserId, dayOfWeek: dow },
          include: { class: { include: { grade: true } }, classSubject: { include: { subject: true } } },
        })
        for (const e of entries) {
          periods.push({
            date: fmtDate(d), dayOfWeek: dow, periodIdx: e.periodIdx, timetableEntryId: e.id,
            classId: e.classId, classLabel: classLabel(e.class), classSubjectId: e.classSubjectId,
            subjectId: e.classSubject.subjectId, subjectName: e.classSubject.subject.name,
            termId: term.id, roomId: e.roomId, gradeOrder: e.class.grade.order,
          })
        }
      }
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return periods
}

// ───────────────────────── hard eligibility + soft ranking (§2 — the Finder) ─────────────────────────

async function currentWeeklyLoad(ctx: Ctx, termId: string, teacherId: string): Promise<number> {
  return prisma.timetableEntry.count({ where: { schoolId: ctx.schoolId, termId, teacherId } })
}

export interface FinderCandidate { teacherId: string; teacherName: string; total: number; breakdown: Record<string, number>; reasons: string[] }
export interface FinderExcluded { teacherId: string; teacherName: string; reasons: string[] }
export interface FinderPeriodResult { period: SubPeriod; candidates: FinderCandidate[]; excluded: FinderExcluded[] }

// Hard-constraint eligibility for ONE candidate at ONE period — reuses T4's Constraint Builder (activeTypes)
// to decide whether teacher-collision is even an active rule for this school, exactly like whatif.ts's own
// `enforceTeacherCollision` gate, plus the same TeacherQualification/TeacherAvailability/TimetableEntry
// primitives every other T4/T5/T8 file queries directly (see this file's top doc comment).
async function hardEligibility(
  ctx: Ctx, candidateId: string, period: SubPeriod,
  opts: { allowCrossSubject: boolean; enforceTeacherCollision: boolean; maxWeeklySubstitutePeriods: number },
): Promise<{ ok: boolean; reasons: string[] }> {
  const reasons: string[] = []
  const date = toDate(period.date)

  if (opts.enforceTeacherCollision) {
    const ownPeriod = await prisma.timetableEntry.findFirst({ where: { schoolId: ctx.schoolId, termId: period.termId, teacherId: candidateId, dayOfWeek: period.dayOfWeek, periodIdx: period.periodIdx } })
    if (ownPeriod) reasons.push('has their own regular period at that time')
  }
  const activeHold = await prisma.periodHold.findFirst({ where: { schoolId: ctx.schoolId, teacherId: candidateId, date, periodIdx: period.periodIdx, releasedAt: null } })
  if (activeHold) reasons.push('already tentatively/confirmed held for another substitution at that period')
  const existingCover = await prisma.substitution.findFirst({ where: { schoolId: ctx.schoolId, date, substituteTeacherId: candidateId, timetableEntry: { periodIdx: period.periodIdx } } })
  if (existingCover) reasons.push('already covering another class at that period on that date')
  const ownLeave = await prisma.leaveRequest.findFirst({ where: { schoolId: ctx.schoolId, forUserId: candidateId, status: 'Approved', fromDate: { lte: date }, toDate: { gte: date } } })
  if (ownLeave) reasons.push('is themselves on approved leave that date')
  const availability = await prisma.teacherAvailability.findFirst({ where: { schoolId: ctx.schoolId, teacherId: candidateId, dayOfWeek: period.dayOfWeek, periodIdx: period.periodIdx } })
  if (availability?.status === 'UNAVAILABLE') reasons.push('declared unavailable at that period')

  const quals = await prisma.teacherQualification.findMany({ where: { schoolId: ctx.schoolId, teacherId: candidateId, subjectId: period.subjectId } })
  const bestQual = quals.find(q => q.gradeRangeMin <= period.gradeOrder && q.gradeRangeMax >= period.gradeOrder)
  if (!bestQual && !opts.allowCrossSubject) reasons.push(`not qualified for "${period.subjectName}" at this grade level (cross-subject substitution disabled)`)

  const load = await currentWeeklyLoad(ctx, period.termId, candidateId)
  if (load >= opts.maxWeeklySubstitutePeriods) reasons.push(`current load (${load}) is at/over the school's substitution workload cap (${opts.maxWeeklySubstitutePeriods})`)

  return { ok: reasons.length === 0, reasons }
}

async function scoreCandidate(ctx: Ctx, candidateId: string, candidateName: string, period: SubPeriod, weights: Record<string, number>): Promise<FinderCandidate> {
  const breakdown: Record<string, number> = {}
  const reasons: string[] = []

  const quals = await prisma.teacherQualification.findMany({ where: { schoolId: ctx.schoolId, teacherId: candidateId, subjectId: period.subjectId } })
  const bestQual = quals.find(q => q.gradeRangeMin <= period.gradeOrder && q.gradeRangeMax >= period.gradeOrder)
  const qScore = bestQual ? ((bestQual.isPrimarySubject || bestQual.proficiency === 'PRIMARY') ? 1 : 0.6) : 0.3
  breakdown.QUALIFICATION_MATCH = weights.QUALIFICATION_MATCH * qScore
  reasons.push(bestQual ? `qualified (${bestQual.proficiency.toLowerCase()}${bestQual.isPrimarySubject ? ', primary subject' : ''})` : 'no declared qualification — scored as a cross-subject substitute')

  const teachesSubjectElsewhere = await prisma.classSubject.findFirst({ where: { schoolId: ctx.schoolId, teacherId: candidateId, subjectId: period.subjectId } })
  breakdown.SAME_SUBJECT = weights.SAME_SUBJECT * (teachesSubjectElsewhere ? 1 : 0.4)

  const availability = await prisma.teacherAvailability.findFirst({ where: { schoolId: ctx.schoolId, teacherId: candidateId, dayOfWeek: period.dayOfWeek, periodIdx: period.periodIdx } })
  const availScore = availability?.status === 'PREFERRED' ? 1 : availability?.status === 'NOT_PREFERRED' ? 0.3 : 0.8
  breakdown.AVAILABILITY_FIT = weights.AVAILABILITY_FIT * availScore
  if (availability) reasons.push(`declared ${availability.status.toLowerCase()} at that exact slot`)

  const load = await currentWeeklyLoad(ctx, period.termId, candidateId)
  const SCORE_NORMALIZATION_CAP = 30 // purely for headroom-score normalization; the hard workload cap is policy.maxWeeklySubstitutePeriods, enforced in hardEligibility
  breakdown.WORKLOAD_HEADROOM = weights.WORKLOAD_HEADROOM * Math.max(0, 1 - load / SCORE_NORMALIZATION_CAP)
  reasons.push(`current load ${load} periods/week`)

  const sameDayEntries = await prisma.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, termId: period.termId, teacherId: candidateId, dayOfWeek: period.dayOfWeek } })
  const consecutiveRun = sameDayEntries.filter(e => Math.abs(e.periodIdx - period.periodIdx) <= 3).length + 1
  breakdown.AVOIDS_CONSECUTIVE_LOAD = weights.AVOIDS_CONSECUTIVE_LOAD * (consecutiveRun >= 4 ? 0.3 : 1)

  breakdown.PREFERENCE = weights.PREFERENCE * (availability?.status === 'PREFERRED' ? 1 : 0.5)

  const suitability = bestQual ? Math.max(0.2, 1 - (bestQual.gradeRangeMax - bestQual.gradeRangeMin) / 12) : 0.3
  breakdown.CLASS_SUITABILITY = weights.CLASS_SUITABILITY * suitability

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return { teacherId: candidateId, teacherName: candidateName, total, breakdown, reasons }
}

export async function findCandidatesForPeriod(ctx: Ctx, originalTeacherId: string, period: SubPeriod): Promise<FinderPeriodResult> {
  await expireStaleHolds(ctx)
  const policy = await effectivePolicy(ctx)
  const active = await activeTypes(ctx)
  const enforceTeacherCollision = active.has('TEACHER_COLLISION')
  const weights = await substitutionWeights(ctx)

  const teachers = await prisma.user.findMany({ where: { schoolId: ctx.schoolId, role: 'teacher', active: true, id: { not: originalTeacherId } }, select: { id: true, name: true } })
  const candidates: FinderCandidate[] = []
  const excluded: FinderExcluded[] = []
  for (const t of teachers) {
    const elig = await hardEligibility(ctx, t.id, period, { allowCrossSubject: policy.allowCrossSubject, enforceTeacherCollision, maxWeeklySubstitutePeriods: policy.maxWeeklySubstitutePeriods })
    if (!elig.ok) { excluded.push({ teacherId: t.id, teacherName: t.name, reasons: elig.reasons }); continue }
    candidates.push(await scoreCandidate(ctx, t.id, t.name, period, weights))
  }
  candidates.sort((a, b) => b.total - a.total)
  return { period, candidates, excluded }
}

export async function findCandidates(ctx: Ctx, input: z.infer<typeof substitutionFinderBody>): Promise<{ periods: FinderPeriodResult[]; originalTeacherId: string }> {
  let originalTeacherId: string
  let periods: SubPeriod[]
  if (input.leaveRequestId) {
    const leave = await prisma.leaveRequest.findFirst({ where: { id: input.leaveRequestId, schoolId: ctx.schoolId } })
    if (!leave) throw notFound('Leave request')
    originalTeacherId = leave.forUserId
    periods = await resolveLeavePeriods(ctx, leave)
  } else {
    originalTeacherId = input.teacherId!
    const raw = input.periods!
    const entries = await prisma.timetableEntry.findMany({
      where: { schoolId: ctx.schoolId, id: { in: raw.map(p => p.timetableEntryId) } },
      include: { class: { include: { grade: true } }, classSubject: { include: { subject: true } } },
    })
    const byId = new Map(entries.map(e => [e.id, e]))
    periods = raw.map(p => {
      const e = byId.get(p.timetableEntryId)
      if (!e) throw notFound('Timetable entry')
      return {
        date: p.date, dayOfWeek: p.dayOfWeek, periodIdx: e.periodIdx, timetableEntryId: e.id,
        classId: e.classId, classLabel: classLabel(e.class), classSubjectId: e.classSubjectId,
        subjectId: e.classSubject.subjectId, subjectName: e.classSubject.subject.name,
        termId: e.termId, roomId: e.roomId, gradeOrder: e.class.grade.order,
      }
    })
  }
  const results = await Promise.all(periods.map(p => findCandidatesForPeriod(ctx, originalTeacherId, p)))
  return { periods: results, originalTeacherId }
}

// ───────────────────────── SubstitutionRequest — send / accept / decline ─────────────────────────

export const serializeRequest = (r: SubstitutionRequest) => ({
  id: r.id,
  leaveRequestId: r.leaveRequestId,
  originalTeacherId: r.originalTeacherId,
  substituteTeacherId: r.substituteTeacherId,
  periods: r.periods as unknown as SubPeriod[],
  status: r.status,
  mode: r.mode,
  score: r.score ?? undefined,
  isOverride: r.isOverride,
  overrideNote: r.overrideNote ?? undefined,
  sentById: r.sentById,
  sentAt: r.sentAt.toISOString(),
  decidedById: r.decidedById ?? undefined,
  acceptedAt: r.acceptedAt?.toISOString(),
  declinedAt: r.declinedAt?.toISOString(),
  expiredAt: r.expiredAt?.toISOString(),
  createdAt: r.createdAt.toISOString(),
})

export async function listRequests(ctx: Ctx, filter?: { leaveRequestId?: string; substituteTeacherId?: string; status?: string }) {
  return prisma.substitutionRequest.findMany({ where: { schoolId: ctx.schoolId, ...filter }, orderBy: [{ createdAt: 'desc' }] })
}

async function getRequest(ctx: Ctx, id: string) {
  const row = await prisma.substitutionRequest.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Substitution request')
  return row
}

// Places (or confirms) a TENTATIVE hold for every period, enforcing the race-condition guard: a substitute
// may not hold two overlapping (teacher, date, period) slots from two DIFFERENT SubstitutionRequests at
// once. Returns the created hold rows.
async function placeTentativeHolds(ctx: Ctx, requestId: string, substituteTeacherId: string, periods: SubPeriod[], tentativeHoldExpiryMinutes: number) {
  const expiresAt = new Date(Date.now() + tentativeHoldExpiryMinutes * 60_000)
  const created = []
  for (const p of periods) {
    const date = toDate(p.date)
    const clashing = await prisma.periodHold.findFirst({
      where: { schoolId: ctx.schoolId, teacherId: substituteTeacherId, date, periodIdx: p.periodIdx, releasedAt: null, sourceSubstitutionRequestId: { not: requestId } },
    })
    if (clashing) {
      throw new HttpError(409, `${p.date} period ${p.periodIdx}: this teacher already holds another substitution at that period`, undefined, { conflictingHoldId: clashing.id })
    }
    const existingForThisRequest = await prisma.periodHold.findFirst({ where: { schoolId: ctx.schoolId, sourceSubstitutionRequestId: requestId, date, periodIdx: p.periodIdx, releasedAt: null } })
    if (existingForThisRequest) { created.push(existingForThisRequest); continue }
    created.push(await prisma.periodHold.create({
      data: { schoolId: ctx.schoolId, teacherId: substituteTeacherId, date, dayOfWeek: p.dayOfWeek, periodIdx: p.periodIdx, termId: p.termId, holdType: 'TENTATIVE', sourceSubstitutionRequestId: requestId, expiresAt },
    }))
  }
  return created
}

async function assertPeriodsMatchLeave(ctx: Ctx, leave: LeaveRequest, periods: z.infer<typeof createSubstitutionRequestBody>['periods']) {
  for (const p of periods) {
    const date = toDate(p.date)
    if (date.getTime() < leave.fromDate.getTime() || date.getTime() > leave.toDate.getTime()) {
      throw new HttpError(400, `${p.date} is outside this leave request's date range`)
    }
    if (weekdayOf(date) !== p.dayOfWeek) throw new HttpError(400, `${p.date} is not weekday ${p.dayOfWeek}`)
    const entry = await prisma.timetableEntry.findFirst({ where: { id: p.timetableEntryId, schoolId: ctx.schoolId, teacherId: leave.forUserId, dayOfWeek: p.dayOfWeek, periodIdx: p.periodIdx } })
    if (!entry) throw new HttpError(400, `Timetable entry ${p.timetableEntryId} does not belong to this leave's teacher at day ${p.dayOfWeek} period ${p.periodIdx}`)
  }
}

// POST /substitution-requests — §1/§5: TEACHER_INITIATED/HYBRID with sufficient notice creates a SENT
// request awaiting the substitute's own accept/decline; ADMIN_ASSIGNED mode OR insufficient notice
// (§5's minimum-notice routing straight to emergency assignment) creates the request already ACCEPTED —
// there is no teacher-to-teacher round-trip in either case.
export async function createSubstitutionRequest(ctx: Ctx, input: z.infer<typeof createSubstitutionRequestBody>) {
  await expireStaleHolds(ctx)
  const leave = await prisma.leaveRequest.findFirst({ where: { id: input.leaveRequestId, schoolId: ctx.schoolId } })
  if (!leave) throw notFound('Leave request')
  const forUser = await prisma.user.findUnique({ where: { id: leave.forUserId } })
  if (!forUser || forUser.role !== 'teacher') throw new HttpError(400, 'This leave request is not for a teacher with timetabled periods')
  if (!['Pending', 'PENDING_SUBSTITUTION'].includes(leave.status)) throw new HttpError(409, `Leave request is already ${leave.status.toLowerCase()}`)

  await assertTeacher(ctx, input.substituteTeacherId)
  if (input.substituteTeacherId === leave.forUserId) throw new HttpError(400, 'Substitute must differ from the absent teacher')
  await assertPeriodsMatchLeave(ctx, leave, input.periods)

  const policy = await effectivePolicy(ctx)
  const noticeHours = (leave.fromDate.getTime() - Date.now()) / 3_600_000
  const emergency = noticeHours < policy.minNoticeHoursForSubstitution
  let mode: string
  let skipRoundTrip: boolean
  if (emergency) {
    if (!isAdmin(ctx)) throw new HttpError(403, `Less than ${policy.minNoticeHoursForSubstitution}h notice — an admin must assign a substitute directly (emergency assignment)`)
    mode = 'EMERGENCY'; skipRoundTrip = true
  } else if (policy.mode === 'ADMIN_ASSIGNED') {
    if (!isAdmin(ctx)) throw new HttpError(403, 'This school\'s substitution policy is ADMIN_ASSIGNED — only an admin may assign a substitute')
    mode = 'ADMIN_ASSIGNED'; skipRoundTrip = true
  } else {
    if (ctx.actorId !== leave.forUserId && !isAdmin(ctx)) throw new HttpError(403, 'Only the absent teacher (or an admin) may send a substitution request')
    mode = policy.mode // TEACHER_INITIATED | HYBRID
    skipRoundTrip = false
  }

  // Re-verify hard eligibility at send time (fresh — the Finder run that surfaced this candidate may be
  // stale by now). A HARD failure is never overridable (§4: admin override is soft-constraint-only); a
  // soft-ranked-low candidate can still be forced through with `override` + a mandatory audit note.
  const active = await activeTypes(ctx)
  const enforceTeacherCollision = active.has('TEACHER_COLLISION')
  const periodRefs: SubPeriod[] = []
  for (const p of input.periods) {
    const entry = await prisma.timetableEntry.findUniqueOrThrow({ where: { id: p.timetableEntryId }, include: { class: { include: { grade: true } }, classSubject: { include: { subject: true } } } })
    const period: SubPeriod = {
      date: p.date, dayOfWeek: p.dayOfWeek, periodIdx: p.periodIdx, timetableEntryId: entry.id,
      classId: entry.classId, classLabel: classLabel(entry.class), classSubjectId: entry.classSubjectId,
      subjectId: entry.classSubject.subjectId, subjectName: entry.classSubject.subject.name,
      termId: entry.termId, roomId: entry.roomId, gradeOrder: entry.class.grade.order,
    }
    periodRefs.push(period)
    const elig = await hardEligibility(ctx, input.substituteTeacherId, period, { allowCrossSubject: policy.allowCrossSubject, enforceTeacherCollision, maxWeeklySubstitutePeriods: policy.maxWeeklySubstitutePeriods })
    if (!elig.ok) {
      if (!input.override || !isAdmin(ctx)) {
        throw new HttpError(409, `${p.date} period ${p.periodIdx}: candidate is not hard-eligible (${elig.reasons.join('; ')})`, undefined, { reasons: elig.reasons })
      }
      // Admin override is soft-constraint-only (§4) — a genuinely hard failure (collision, active hold,
      // own approved leave) is never overridable; only a qualification/cross-subject-style gap is.
      const hardReasons = elig.reasons.filter(r => !r.includes('not qualified'))
      if (hardReasons.length) throw new HttpError(409, `${p.date} period ${p.periodIdx}: cannot override a hard constraint (${hardReasons.join('; ')})`, undefined, { reasons: hardReasons })
    }
  }

  const now = new Date()
  const row = await prisma.substitutionRequest.create({
    data: {
      schoolId: ctx.schoolId, leaveRequestId: leave.id, originalTeacherId: leave.forUserId, substituteTeacherId: input.substituteTeacherId,
      periods: periodRefs as unknown as object, status: skipRoundTrip ? 'ACCEPTED' : 'SENT', mode,
      isOverride: input.override, overrideNote: input.override ? input.overrideNote : null,
      sentById: ctx.actorId,
      ...(skipRoundTrip ? { decidedById: ctx.actorId, acceptedAt: now } : {}),
    },
  })

  if (skipRoundTrip) {
    await placeTentativeHolds(ctx, row.id, input.substituteTeacherId, periodRefs, policy.tentativeHoldExpiryMinutes)
  } else if (leave.status === 'Pending') {
    await prisma.leaveRequest.update({ where: { id: leave.id }, data: { status: 'PENDING_SUBSTITUTION' } })
  }

  await audit(ctx.schoolId, ctx.actorId, 'send', 'substitutionRequest', row.id, undefined, serializeRequest(row))
  return row
}

// POST /substitution-requests/:id/accept — §4/§3: the substitute accepts, placing the TENTATIVE hold (race
// guard enforced inside placeTentativeHolds) and re-validating hard eligibility a SECOND time (accept-time,
// the first of the spec's required two validation passes — the second is at publish/leave-approval time).
export async function acceptSubstitutionRequest(ctx: Ctx, id: string) {
  await expireStaleHolds(ctx)
  const row = await getRequest(ctx, id)
  if (row.status !== 'SENT') throw new HttpError(409, `Substitution request is already ${row.status.toLowerCase()}`)
  if (ctx.actorId !== row.substituteTeacherId && !isAdmin(ctx)) throw new HttpError(403, 'Only the invited substitute (or an admin) may accept this request')

  const policy = await effectivePolicy(ctx)
  const active = await activeTypes(ctx)
  const enforceTeacherCollision = active.has('TEACHER_COLLISION')
  const periods = row.periods as unknown as SubPeriod[]
  for (const p of periods) {
    const elig = await hardEligibility(ctx, row.substituteTeacherId, p, { allowCrossSubject: policy.allowCrossSubject, enforceTeacherCollision, maxWeeklySubstitutePeriods: policy.maxWeeklySubstitutePeriods })
    if (!elig.ok && !row.isOverride) throw new HttpError(409, `${p.date} period ${p.periodIdx}: no longer eligible (${elig.reasons.join('; ')})`, undefined, { reasons: elig.reasons })
  }

  await placeTentativeHolds(ctx, row.id, row.substituteTeacherId, periods, policy.tentativeHoldExpiryMinutes)
  const updated = await prisma.substitutionRequest.update({ where: { id: row.id }, data: { status: 'ACCEPTED', acceptedAt: new Date(), decidedById: ctx.actorId } })

  const leave = await prisma.leaveRequest.findUnique({ where: { id: row.leaveRequestId } })
  if (leave?.status === 'PENDING_SUBSTITUTION') {
    const stillOutstanding = await prisma.substitutionRequest.count({ where: { leaveRequestId: leave.id, status: 'SENT' } })
    if (!stillOutstanding) await prisma.leaveRequest.update({ where: { id: leave.id }, data: { status: 'Pending' } })
  }

  await audit(ctx.schoolId, ctx.actorId, 'accept', 'substitutionRequest', row.id, { status: row.status }, serializeRequest(updated))
  return updated
}

export async function declineSubstitutionRequest(ctx: Ctx, id: string, note?: string) {
  const row = await getRequest(ctx, id)
  if (row.status !== 'SENT') throw new HttpError(409, `Substitution request is already ${row.status.toLowerCase()}`)
  if (ctx.actorId !== row.substituteTeacherId && !isAdmin(ctx)) throw new HttpError(403, 'Only the invited substitute (or an admin) may decline this request')

  const updated = await prisma.substitutionRequest.update({ where: { id: row.id }, data: { status: 'DECLINED', declinedAt: new Date(), decidedById: ctx.actorId, overrideNote: note ?? row.overrideNote } })

  const leave = await prisma.leaveRequest.findUnique({ where: { id: row.leaveRequestId } })
  if (leave?.status === 'PENDING_SUBSTITUTION') {
    const stillOutstanding = await prisma.substitutionRequest.count({ where: { leaveRequestId: leave.id, status: 'SENT' } })
    if (!stillOutstanding) await prisma.leaveRequest.update({ where: { id: leave.id }, data: { status: 'Pending' } })
  }

  await audit(ctx.schoolId, ctx.actorId, 'decline', 'substitutionRequest', row.id, { status: row.status }, serializeRequest(updated))
  return updated
}

// Called from leave/service.ts#decline() when the leave being declined is still PENDING_SUBSTITUTION — a
// decline makes any in-flight SENT request moot rather than leaving it dangling. Any request already
// ACCEPTED (with a real TENTATIVE hold) is also released — the substitute is freed, not left holding a slot
// for a leave that will never be approved.
export async function cancelOutstandingSubstitutionRequests(ctx: Ctx, leaveRequestId: string) {
  const outstanding = await prisma.substitutionRequest.findMany({ where: { schoolId: ctx.schoolId, leaveRequestId, status: { in: ['SENT', 'ACCEPTED'] } } })
  if (!outstanding.length) return 0
  const now = new Date()
  await prisma.$transaction([
    prisma.periodHold.updateMany({ where: { schoolId: ctx.schoolId, sourceSubstitutionRequestId: { in: outstanding.map(r => r.id) }, releasedAt: null }, data: { releasedAt: now } }),
    prisma.substitutionRequest.updateMany({ where: { id: { in: outstanding.map(r => r.id) } }, data: { status: 'EXPIRED', expiredAt: now } }),
  ])
  await audit(ctx.schoolId, ctx.actorId, 'cancel-on-leave-decline', 'leaveRequest', leaveRequestId, undefined, { cancelled: outstanding.length })
  return outstanding.length
}

// ───────────────────────── tentative-hold auto-expiry (lazy, opportunistic — see schema.prisma's doc comment) ─────────────────────────

export async function expireStaleHolds(ctx: Ctx) {
  const now = new Date()
  const stale = await prisma.periodHold.findMany({ where: { schoolId: ctx.schoolId, holdType: 'TENTATIVE', releasedAt: null, expiresAt: { lte: now } } })
  if (!stale.length) return 0
  const requestIds = [...new Set(stale.map(h => h.sourceSubstitutionRequestId).filter((x): x is string => !!x))]
  await prisma.$transaction([
    prisma.periodHold.updateMany({ where: { id: { in: stale.map(h => h.id) } }, data: { releasedAt: now } }),
    ...(requestIds.length ? [prisma.substitutionRequest.updateMany({ where: { id: { in: requestIds }, status: 'ACCEPTED' }, data: { status: 'EXPIRED', expiredAt: now } })] : []),
  ])
  await audit(ctx.schoolId, ctx.actorId, 'expire-stale-holds', 'periodHold', ctx.schoolId, undefined, { expired: stale.length, requestsExpired: requestIds.length })
  return stale.length
}

// ───────────────────────── leave-approval integration (§4) ─────────────────────────

export interface WhatIfSuggestion { versionHint: string; changeEvent: { type: 'TEACHER_UNAVAILABLE'; teacherId: string; slots: { dayOfWeek: number; periodIdx: number }[] } }
export interface UncoveredPeriod { period: SubPeriod; reasons: string[] }
export interface SubstitutionApprovalResult { covered: SubPeriod[]; uncovered: UncoveredPeriod[]; substitutionIds: string[]; whatIfSuggestion?: WhatIfSuggestion }

// Called from leave/service.ts#approve() right after a teacher's LeaveRequest flips to Approved. No-op
// (fast, zero extra queries beyond the one role/request lookup) whenever this leave never touched a
// teaching period — the critical regression guarantee for staff/non-teaching leave.
export async function onLeaveApproved(ctx: Ctx, leave: LeaveRequest): Promise<SubstitutionApprovalResult | undefined> {
  const forUser = await prisma.user.findUnique({ where: { id: leave.forUserId } })
  if (!forUser || forUser.role !== 'teacher') return undefined
  const accepted = await prisma.substitutionRequest.findMany({ where: { schoolId: ctx.schoolId, leaveRequestId: leave.id, status: 'ACCEPTED' } })
  const allPeriods = await resolveLeavePeriods(ctx, leave)
  if (!accepted.length && !allPeriods.length) return undefined

  const covered: SubPeriod[] = []
  const uncovered: UncoveredPeriod[] = []
  const substitutionIds: string[] = []
  const coveredKeys = new Set<string>()

  const active = await activeTypes(ctx)
  const enforceTeacherCollision = active.has('TEACHER_COLLISION')
  const policy = await effectivePolicy(ctx)

  for (const req of accepted) {
    const periods = req.periods as unknown as SubPeriod[]
    for (const p of periods) {
      // §4 — validation runs a SECOND time here (publish/approval time), independent of the accept-time
      // check above, before the hold is ever promoted to LOCKED or a real Substitution row is written.
      const elig = await hardEligibility(ctx, req.substituteTeacherId, p, { allowCrossSubject: policy.allowCrossSubject, enforceTeacherCollision, maxWeeklySubstitutePeriods: policy.maxWeeklySubstitutePeriods })
      // The candidate's own hold is one of the "reasons" a fresh eligibility check would otherwise flag
      // (it collides with itself) — exclude that specific self-hold from re-validation.
      const realReasons = elig.reasons.filter(r => !r.includes('already tentatively/confirmed held'))
      if (realReasons.length && !req.isOverride) {
        uncovered.push({ period: p, reasons: realReasons })
        continue
      }
      try {
        const sub = await createManualSubstitution(ctx, { timetableEntryId: p.timetableEntryId, date: p.date, substituteTeacherId: req.substituteTeacherId, reason: `Substitution workflow — leave ${leave.id}` })
        substitutionIds.push(sub.id)
        covered.push(p)
        coveredKeys.add(`${p.date}:${p.periodIdx}`)
      } catch (err) {
        uncovered.push({ period: p, reasons: [err instanceof HttpError ? err.message : 'Could not create the substitution record'] })
      }
    }
    // Promote every hold this request placed from TENTATIVE to LOCKED — D6's core invariant: only real once
    // the leave is actually approved, never before.
    await prisma.periodHold.updateMany({ where: { schoolId: ctx.schoolId, sourceSubstitutionRequestId: req.id, releasedAt: null }, data: { holdType: 'LOCKED', expiresAt: null } })
  }

  // Any period the absence touches that no ACCEPTED substitution ever covered (no candidates found, or
  // declined) — the "clear explanation" the spec asks for, plus a ready-to-submit what-if suggestion for
  // the admin to explicitly opt into (see this file's top doc comment for why it's surfaced, not auto-run).
  for (const p of allPeriods) {
    const key = `${p.date}:${p.periodIdx}`
    if (coveredKeys.has(key)) continue
    if (uncovered.some(u => u.period.timetableEntryId === p.timetableEntryId && u.period.date === p.date)) continue
    const finderResult = await findCandidatesForPeriod(ctx, leave.forUserId, p)
    const reasons = finderResult.candidates.length
      ? ['A candidate was found but no substitution request was ever sent/accepted for this period']
      : summarizeExclusionReasons(finderResult.excluded)
    uncovered.push({ period: p, reasons })
  }

  const whatIfSuggestion: WhatIfSuggestion | undefined = uncovered.length
    ? { versionHint: 'Submit against the PUBLISHED TimetableVersion governing this teacher\'s classes', changeEvent: { type: 'TEACHER_UNAVAILABLE', teacherId: leave.forUserId, slots: uncovered.map(u => ({ dayOfWeek: u.period.dayOfWeek, periodIdx: u.period.periodIdx })) } }
    : undefined

  await audit(ctx.schoolId, ctx.actorId, 'apply-on-approval', 'leaveRequest', leave.id, undefined, { covered: covered.length, uncovered: uncovered.length, substitutionIds })
  return { covered, uncovered, substitutionIds, whatIfSuggestion }
}

function summarizeExclusionReasons(excluded: FinderExcluded[]): string[] {
  if (!excluded.length) return ['No teachers at all evaluated for this period']
  const buckets = { busy: 0, unqualified: 0, workload: 0, other: 0 }
  for (const e of excluded) {
    if (e.reasons.some(r => r.includes('own regular period') || r.includes('held') || r.includes('covering another') || r.includes('own approved leave') || r.includes('unavailable'))) buckets.busy++
    else if (e.reasons.some(r => r.includes('not qualified'))) buckets.unqualified++
    else if (e.reasons.some(r => r.includes('workload cap'))) buckets.workload++
    else buckets.other++
  }
  const parts: string[] = []
  if (buckets.busy) parts.push(`${buckets.busy} busy/unavailable`)
  if (buckets.unqualified) parts.push(`${buckets.unqualified} not qualified`)
  if (buckets.workload) parts.push(`${buckets.workload} over workload cap`)
  if (buckets.other) parts.push(`${buckets.other} excluded for other reasons`)
  return [`No eligible candidate found among ${excluded.length} teacher(s) evaluated: ${parts.join(', ')}`]
}

// ───────────────────────── chained absence (§4) ─────────────────────────

export interface ChainedAbsenceInfo { backfillOf: { substitutionRequestId: string; leaveRequestId: string }[] }

// Called from leave/service.ts#createRequest() right after a new LeaveRequest is created. If the person now
// going on leave was themselves an ACCEPTED substitute covering some other teacher's periods that overlap
// this new absence, that coverage is no longer real — flags it (audit + return value) and releases the
// no-longer-valid hold(s)/request(s) so the ORIGINAL absence's periods correctly re-surface as uncovered
// (re-entering this same flow) rather than silently still showing as "covered" once this happens.
export async function detectAndHandleChainedAbsence(ctx: Ctx, newLeave: LeaveRequest): Promise<ChainedAbsenceInfo | undefined> {
  const overlapping = await prisma.substitutionRequest.findMany({
    where: { schoolId: ctx.schoolId, substituteTeacherId: newLeave.forUserId, status: { in: ['ACCEPTED'] } },
  })
  const affected = overlapping.filter(r => (r.periods as unknown as SubPeriod[]).some(p => { const t = toDate(p.date).getTime(); return t >= newLeave.fromDate.getTime() && t <= newLeave.toDate.getTime() }))
  if (!affected.length) return undefined

  const now = new Date()
  for (const req of affected) {
    await prisma.periodHold.updateMany({ where: { schoolId: ctx.schoolId, sourceSubstitutionRequestId: req.id, releasedAt: null }, data: { releasedAt: now } })
    await prisma.substitutionRequest.update({ where: { id: req.id }, data: { status: 'EXPIRED', expiredAt: now } })
  }
  const backfillOf = affected.map(r => ({ substitutionRequestId: r.id, leaveRequestId: r.leaveRequestId }))
  await audit(ctx.schoolId, ctx.actorId, 'chained-absence-backfill', 'leaveRequest', newLeave.id, undefined, { backfillOf, note: 'These substitution commitments are no longer valid — the substitute is now themselves absent; the original leave\'s periods re-enter the substitution flow as uncovered.' })
  return { backfillOf }
}

export { DAY_NAMES }
