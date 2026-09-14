// T9 — Substitution workflow: policy, the Substitute Finder, substitution requests (send/accept/decline),
// and the tentative-hold expiry sweep. See server/src/modules/timetable/substitution.ts (read in full
// before writing this file) for the real hard-eligibility/scoring logic this mirrors.
//
// Per the batch instructions: real hard-constraint filtering (qualification, availability, collision,
// existing holds) is genuinely implemented — it's cheap. The weighted score is a simplified version of the
// real 7-factor formula (same factor names, same rough weight distribution) rather than the exact formula,
// but always returns a `breakdown`/`reasons[]` so the UI's explainable-ranking pattern still holds.

import { route, requireAuth, requireRole, status } from '../router'
import { table, uid, nowIso, SCHOOL_ID, type Row } from '../store'
import { badRequest, notFound, conflict } from '../http'
import { classLabel } from './timetableCore'

const WRITE_ROLES = ['admin', 'superadmin']
const POLICY_DEFAULTS = { mode: 'TEACHER_INITIATED', minNoticeHoursForSubstitution: 12, allowCrossSubject: false, maxWeeklySubstitutePeriods: 30, tentativeHoldExpiryMinutes: 240 }

function effectivePolicy() {
  const row = table('SubstitutionPolicy').find(r => r.schoolId === SCHOOL_ID)
  return { ...POLICY_DEFAULTS, ...(row ?? {}) }
}
function serializePolicy() {
  const row = table('SubstitutionPolicy').find(r => r.schoolId === SCHOOL_ID)
  return { schoolId: SCHOOL_ID, ...POLICY_DEFAULTS, ...(row ?? {}), configured: !!row }
}

route('GET', '/timetable/substitution-policy', (ctx) => { requireAuth(ctx); return { item: serializePolicy() } })
route('PUT', '/timetable/substitution-policy', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const rows = table('SubstitutionPolicy')
  const idx = rows.findIndex(r => r.schoolId === SCHOOL_ID)
  const merged = { ...POLICY_DEFAULTS, ...(idx >= 0 ? rows[idx] : {}), ...(ctx.body as object) }
  const row: Row = { id: idx >= 0 ? rows[idx].id : uid('subpolicy'), schoolId: SCHOOL_ID, ...merged }
  if (idx >= 0) rows[idx] = row; else rows.push(row)
  return { item: serializePolicy() }
})

const SUBSTITUTION_PREF_TYPES = ['QUALIFICATION_MATCH', 'SAME_SUBJECT', 'AVAILABILITY_FIT', 'WORKLOAD_HEADROOM', 'AVOIDS_CONSECUTIVE_LOAD', 'PREFERENCE', 'CLASS_SUITABILITY']
const DEFAULT_SUB_WEIGHTS: Record<string, number> = { QUALIFICATION_MATCH: 40, SAME_SUBJECT: 20, AVAILABILITY_FIT: 15, WORKLOAD_HEADROOM: 10, AVOIDS_CONSECUTIVE_LOAD: 5, PREFERENCE: 5, CLASS_SUITABILITY: 5 }

route('POST', '/timetable/substitution-preferences/seed-defaults', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const existing = new Set(table('Preference').filter(r => r.scope === 'SUBSTITUTION').map(r => r.type))
  let added = 0
  for (const type of SUBSTITUTION_PREF_TYPES) {
    if (existing.has(type)) continue
    table('Preference').push({ id: uid('pref'), schoolId: SCHOOL_ID, type, scope: 'SUBSTITUTION', weight: DEFAULT_SUB_WEIGHTS[type], priority: 0, enabled: true, parameters: {} } as Row)
    added++
  }
  return { added }
})
function substitutionWeights(): Record<string, number> {
  const map = { ...DEFAULT_SUB_WEIGHTS }
  for (const r of table('Preference').filter(p => p.scope === 'SUBSTITUTION' && p.enabled)) map[String(r.type)] = Number(r.weight)
  return map
}

// ───────────────────────── stale tentative-hold expiry (lazy, opportunistic) ─────────────────────────

route('POST', '/timetable/substitution-holds/expire-stale', (ctx) => { requireRole(ctx, ...WRITE_ROLES); return { expired: expireStaleHolds() } })
function expireStaleHolds(): number {
  const now = Date.now()
  const stale = table('PeriodHold').filter(h => h.holdType === 'TENTATIVE' && !h.releasedAt && h.expiresAt && new Date(String(h.expiresAt)).getTime() <= now)
  for (const h of stale) h.releasedAt = nowIso()
  const requestIds = new Set(stale.map(h => h.sourceSubstitutionRequestId).filter(Boolean))
  for (const r of table('SubstitutionRequest').filter(r => requestIds.has(r.id) && r.status === 'ACCEPTED')) { r.status = 'EXPIRED'; r.expiredAt = nowIso() }
  return stale.length
}

// ───────────────────────── Substitute Finder — real hard eligibility, simplified explainable scoring ─────────────────────────

interface SubPeriod { date: string; dayOfWeek: number; periodIdx: number; timetableEntryId: string; classId: string; classLabel: string; classSubjectId: string; subjectId: string; subjectName: string; termId: string; roomId: string | null; gradeOrder: number }

function periodFromEntry(entryId: string, date: string, dayOfWeek: number): SubPeriod | null {
  const e = table('TimetableEntry').find(r => r.id === entryId)
  if (!e) return null
  const cs = table('ClassSubject').find(r => r.id === e.classSubjectId)
  const subject = cs ? table('Subject').find(s => s.id === cs.subjectId) : undefined
  const cls = table('Class').find(c => c.id === e.classId)
  const grade = cls ? table('Grade').find(g => g.id === cls.gradeId) : undefined
  return {
    date, dayOfWeek, periodIdx: Number(e.periodIdx), timetableEntryId: e.id, classId: String(e.classId), classLabel: classLabel(String(e.classId)),
    classSubjectId: String(e.classSubjectId), subjectId: String(cs?.subjectId ?? ''), subjectName: subject?.name as string ?? 'Subject',
    termId: String(e.termId), roomId: (e.roomId as string) ?? null, gradeOrder: Number(grade?.order ?? 0),
  }
}

function currentWeeklyLoad(termId: string, teacherId: string): number {
  return table('TimetableEntry').filter(e => e.termId === termId && e.teacherId === teacherId).length
}

function hardEligibility(candidateId: string, period: SubPeriod, opts: { allowCrossSubject: boolean; maxWeeklySubstitutePeriods: number }): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const ownPeriod = table('TimetableEntry').find(e => e.termId === period.termId && e.teacherId === candidateId && e.dayOfWeek === period.dayOfWeek && e.periodIdx === period.periodIdx)
  if (ownPeriod) reasons.push('has their own regular period at that time')
  const activeHold = table('PeriodHold').find(h => h.teacherId === candidateId && h.date === period.date && h.periodIdx === period.periodIdx && !h.releasedAt)
  if (activeHold) reasons.push('already tentatively/confirmed held for another substitution at that period')
  const existingCover = table('Substitution').find(s => s.substituteTeacherId === candidateId && s.date === period.date && table('TimetableEntry').find(e => e.id === s.timetableEntryId)?.periodIdx === period.periodIdx)
  if (existingCover) reasons.push('already covering another class at that period on that date')
  const availability = table('TeacherAvailability').find(a => a.teacherId === candidateId && a.dayOfWeek === period.dayOfWeek && a.periodIdx === period.periodIdx)
  if (availability?.status === 'UNAVAILABLE') reasons.push('declared unavailable at that period')
  const quals = table('TeacherQualification').filter(q => q.teacherId === candidateId && q.subjectId === period.subjectId)
  const bestQual = quals.find(q => Number(q.gradeRangeMin) <= period.gradeOrder && Number(q.gradeRangeMax) >= period.gradeOrder)
  if (!bestQual && !opts.allowCrossSubject) reasons.push(`not qualified for "${period.subjectName}" at this grade level (cross-subject substitution disabled)`)
  const load = currentWeeklyLoad(period.termId, candidateId)
  if (load >= opts.maxWeeklySubstitutePeriods) reasons.push(`current load (${load}) is at/over the school's substitution workload cap (${opts.maxWeeklySubstitutePeriods})`)
  return { ok: reasons.length === 0, reasons }
}

function scoreCandidate(candidateId: string, candidateName: string, period: SubPeriod, weights: Record<string, number>) {
  const breakdown: Record<string, number> = {}
  const reasons: string[] = []
  const quals = table('TeacherQualification').filter(q => q.teacherId === candidateId && q.subjectId === period.subjectId)
  const bestQual = quals.find(q => Number(q.gradeRangeMin) <= period.gradeOrder && Number(q.gradeRangeMax) >= period.gradeOrder)
  const qScore = bestQual ? (bestQual.isPrimarySubject || bestQual.proficiency === 'PRIMARY' ? 1 : 0.6) : 0.3
  breakdown.QUALIFICATION_MATCH = weights.QUALIFICATION_MATCH * qScore
  reasons.push(bestQual ? `qualified (${String(bestQual.proficiency).toLowerCase()}${bestQual.isPrimarySubject ? ', primary subject' : ''})` : 'no declared qualification — scored as a cross-subject substitute')

  const teachesElsewhere = table('ClassSubject').find(cs => cs.teacherId === candidateId && cs.subjectId === period.subjectId)
  breakdown.SAME_SUBJECT = weights.SAME_SUBJECT * (teachesElsewhere ? 1 : 0.4)

  const availability = table('TeacherAvailability').find(a => a.teacherId === candidateId && a.dayOfWeek === period.dayOfWeek && a.periodIdx === period.periodIdx)
  const availScore = availability?.status === 'PREFERRED' ? 1 : availability?.status === 'NOT_PREFERRED' ? 0.3 : 0.8
  breakdown.AVAILABILITY_FIT = weights.AVAILABILITY_FIT * availScore
  if (availability) reasons.push(`declared ${String(availability.status).toLowerCase()} at that exact slot`)

  const load = currentWeeklyLoad(period.termId, candidateId)
  breakdown.WORKLOAD_HEADROOM = weights.WORKLOAD_HEADROOM * Math.max(0, 1 - load / 30)
  reasons.push(`current load ${load} periods/week`)

  const sameDayCount = table('TimetableEntry').filter(e => e.termId === period.termId && e.teacherId === candidateId && e.dayOfWeek === period.dayOfWeek).length
  breakdown.AVOIDS_CONSECUTIVE_LOAD = weights.AVOIDS_CONSECUTIVE_LOAD * (sameDayCount + 1 >= 4 ? 0.3 : 1)
  breakdown.PREFERENCE = weights.PREFERENCE * (availability?.status === 'PREFERRED' ? 1 : 0.5)
  const suitability = bestQual ? Math.max(0.2, 1 - (Number(bestQual.gradeRangeMax) - Number(bestQual.gradeRangeMin)) / 12) : 0.3
  breakdown.CLASS_SUITABILITY = weights.CLASS_SUITABILITY * suitability

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return { teacherId: candidateId, teacherName: candidateName, total, breakdown, reasons }
}

function findCandidatesForPeriod(originalTeacherId: string, period: SubPeriod) {
  expireStaleHolds()
  const policy = effectivePolicy()
  const weights = substitutionWeights()
  const teachers = table('User').filter(u => u.role === 'teacher' && u.active !== false && u.id !== originalTeacherId)
  const candidates: ReturnType<typeof scoreCandidate>[] = []
  const excluded: Array<{ teacherId: string; teacherName: string; reasons: string[] }> = []
  for (const t of teachers) {
    const elig = hardEligibility(String(t.id), period, policy)
    if (!elig.ok) { excluded.push({ teacherId: String(t.id), teacherName: t.name as string, reasons: elig.reasons }); continue }
    candidates.push(scoreCandidate(String(t.id), t.name as string, period, weights))
  }
  candidates.sort((a, b) => b.total - a.total)
  return { period, candidates, excluded }
}

route('POST', '/timetable/substitution-finder', (ctx) => {
  requireAuth(ctx)
  const { leaveRequestId, periods: rawPeriods, teacherId } = ctx.body as { leaveRequestId?: string; periods?: Array<{ date: string; dayOfWeek: number; periodIdx: number; timetableEntryId: string }>; teacherId?: string }
  let originalTeacherId: string; let periods: SubPeriod[]
  if (leaveRequestId) {
    // No LeaveRequest table in this batch (owned by HR/leave) — a caller must pass periods+teacherId
    // directly when no matching leave row exists in this demo's data.
    throw badRequest('This demo does not resolve leaveRequestId — pass teacherId and periods directly')
  } else {
    if (!teacherId || !rawPeriods?.length) throw badRequest('Either leaveRequestId, or both teacherId and periods, is required')
    originalTeacherId = teacherId
    periods = rawPeriods.map(p => periodFromEntry(p.timetableEntryId, p.date, p.dayOfWeek)).filter((p): p is SubPeriod => !!p)
  }
  const results = periods.map(p => findCandidatesForPeriod(originalTeacherId, p))
  return { periods: results, originalTeacherId }
})

// ───────────────────────── SubstitutionRequest — send / accept / decline ─────────────────────────

route('GET', '/timetable/substitution-requests', (ctx) => {
  requireAuth(ctx)
  const { leaveRequestId, substituteTeacherId, status: st } = ctx.query
  return { items: table('SubstitutionRequest').filter(r => (!leaveRequestId || r.leaveRequestId === leaveRequestId) && (!substituteTeacherId || r.substituteTeacherId === substituteTeacherId) && (!st || r.status === st)) }
})

route('POST', '/timetable/substitution-requests', (ctx) => {
  const actor = requireAuth(ctx)
  const { leaveRequestId, substituteTeacherId, periods, override, overrideNote } = ctx.body as { leaveRequestId: string; substituteTeacherId: string; periods: Array<{ date: string; dayOfWeek: number; periodIdx: number; timetableEntryId: string }>; override?: boolean; overrideNote?: string }
  if (!periods?.length) throw badRequest('periods is required')
  const substitute = table('User').find(u => u.id === substituteTeacherId && u.role === 'teacher')
  if (!substitute) throw notFound('Teacher')

  const policy = effectivePolicy()
  const periodRefs: SubPeriod[] = []
  for (const p of periods) {
    const period = periodFromEntry(p.timetableEntryId, p.date, p.dayOfWeek)
    if (!period) throw notFound('Timetable entry')
    periodRefs.push(period)
    const elig = hardEligibility(substituteTeacherId, period, policy)
    if (!elig.ok) {
      const hardReasons = elig.reasons.filter(r => !r.includes('not qualified'))
      if (!override || hardReasons.length) throw conflict(`${p.date} period ${p.periodIdx}: candidate is not hard-eligible (${elig.reasons.join('; ')})`, { reasons: elig.reasons })
    }
  }
  const isAdminActor = ['admin', 'superadmin'].includes(actor.role)
  const skipRoundTrip = policy.mode === 'ADMIN_ASSIGNED' && isAdminActor
  const row: Row = {
    id: uid('sr'), schoolId: SCHOOL_ID, leaveRequestId, originalTeacherId: (ctx.body as { originalTeacherId?: string }).originalTeacherId ?? actor.userId,
    substituteTeacherId, periods: periodRefs, status: skipRoundTrip ? 'ACCEPTED' : 'SENT', mode: skipRoundTrip ? 'ADMIN_ASSIGNED' : policy.mode,
    score: undefined, isOverride: !!override, overrideNote: override ? overrideNote : undefined,
    sentById: actor.userId, sentAt: nowIso(), decidedById: skipRoundTrip ? actor.userId : undefined, acceptedAt: skipRoundTrip ? nowIso() : undefined,
    declinedAt: undefined, expiredAt: undefined, createdAt: nowIso(),
  }
  table('SubstitutionRequest').push(row)
  if (skipRoundTrip) placeTentativeHolds(row.id, substituteTeacherId, periodRefs, policy.tentativeHoldExpiryMinutes)
  return status(201, { item: row })
})

function placeTentativeHolds(requestId: string, substituteTeacherId: string, periods: SubPeriod[], expiryMinutes: number) {
  const expiresAt = new Date(Date.now() + expiryMinutes * 60_000).toISOString()
  for (const p of periods) {
    const clashing = table('PeriodHold').find(h => h.teacherId === substituteTeacherId && h.date === p.date && h.periodIdx === p.periodIdx && !h.releasedAt && h.sourceSubstitutionRequestId !== requestId)
    if (clashing) throw conflict(`${p.date} period ${p.periodIdx}: this teacher already holds another substitution at that period`, { conflictingHoldId: clashing.id })
    const already = table('PeriodHold').find(h => h.sourceSubstitutionRequestId === requestId && h.date === p.date && h.periodIdx === p.periodIdx && !h.releasedAt)
    if (already) continue
    table('PeriodHold').push({ id: uid('ph'), schoolId: SCHOOL_ID, teacherId: substituteTeacherId, date: p.date, dayOfWeek: p.dayOfWeek, periodIdx: p.periodIdx, termId: p.termId, holdType: 'TENTATIVE', sourceSubstitutionRequestId: requestId, expiresAt, releasedAt: undefined } as Row)
  }
}

route('POST', '/timetable/substitution-requests/:id/accept', (ctx) => {
  const actor = requireAuth(ctx)
  expireStaleHolds()
  const row = table('SubstitutionRequest').find(r => r.id === ctx.params.id)
  if (!row) throw notFound('Substitution request')
  if (row.status !== 'SENT') throw conflict(`Substitution request is already ${String(row.status).toLowerCase()}`)
  const policy = effectivePolicy()
  for (const p of row.periods as SubPeriod[]) {
    const elig = hardEligibility(String(row.substituteTeacherId), p, policy)
    if (!elig.ok && !row.isOverride) throw conflict(`${p.date} period ${p.periodIdx}: no longer eligible (${elig.reasons.join('; ')})`, { reasons: elig.reasons })
  }
  placeTentativeHolds(row.id, String(row.substituteTeacherId), row.periods as SubPeriod[], policy.tentativeHoldExpiryMinutes)
  row.status = 'ACCEPTED'; row.acceptedAt = nowIso(); row.decidedById = actor.userId
  return { item: row }
})

// ───────────────────────── legacy Phase 2 quick-assign — bare `POST /substitutions` ─────────────────────────
// Pre-T9 "just pick a substitute for one period" flow, called directly from the plain Timetable module (not
// the T9 request/accept workflow above) — a simple, real one-off Substitution row, no policy/eligibility
// gating (matches the real server/src/modules/substitutions/service.ts#create it mirrors).
route('POST', '/substitutions', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES, 'teacher')
  const { timetableEntryId, date, substituteTeacherId, reason } = ctx.body as { timetableEntryId: string; date: string; substituteTeacherId: string; reason?: string }
  const entry = table('TimetableEntry').find(e => e.id === timetableEntryId)
  if (!entry) throw notFound('Timetable entry')
  const substitute = table('User').find(u => u.id === substituteTeacherId && u.role === 'teacher')
  if (!substitute) throw notFound('Teacher')
  const row: Row = { id: uid('sub'), schoolId: SCHOOL_ID, timetableEntryId, date, substituteTeacherId, reason: reason ?? undefined, createdAt: nowIso() }
  table('Substitution').push(row)
  return status(201, { item: row })
})

route('POST', '/timetable/substitution-requests/:id/decline', (ctx) => {
  const actor = requireAuth(ctx)
  const row = table('SubstitutionRequest').find(r => r.id === ctx.params.id)
  if (!row) throw notFound('Substitution request')
  if (row.status !== 'SENT') throw conflict(`Substitution request is already ${String(row.status).toLowerCase()}`)
  const { note } = ctx.body as { note?: string }
  row.status = 'DECLINED'; row.declinedAt = nowIso(); row.decidedById = actor.userId
  if (note) row.overrideNote = note
  return { item: row }
})
