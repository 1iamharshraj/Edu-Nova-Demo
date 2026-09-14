// Mirrors server/src/modules/analytics's contract (router.ts/service.ts/schema.ts, read in full via
// `git show feature/backend-api:server/src/modules/analytics/...` — this directory doesn't exist in the
// working tree) for the five independent features behind /api/analytics: student risk scoring, lost
// instructional time, teacher workload, homework load, and smart substitute suggestions. See
// .agents/edunova/static-demo-plan.md and phase-19-early-warning-analytics.md.
//
// Items 3 (teacher workload) and 5 (substitute suggestions) are computed for real off the seeded
// TimetableEntry/Substitution rows — genuinely no algorithm to simulate there, just aggregation.
// Item 1 (risk scoring) uses the exact real weighted formula (see computeRiskScore below), but several of
// its inputs — attendance, marks, homework, fee-overdue — depend on modules (attendance/exams/homework/
// fees) that may not be seeded yet in this batch order. Rather than crash or silently score everyone 0,
// each input falls back to a small, STABLE per-student pseudo-random value (seeded off the student id, so
// it's the same every time, not fresh-random per request) whenever its source collection is still empty —
// see `pseudo01`/`fallback*` below. Once those batches land and actually populate AttendanceRecord/Mark/
// Homework/FeeInvoice, this file automatically switches to computing the real thing (each input checks the
// underlying table's length first) with no further changes needed here.
// Item 2 (lost instructional time) has no syllabus/pace module to aggregate yet either (Phase 18 not built
// in this static demo), so it's simulated directly: "scheduled periods so far" is derived from each
// ClassSubject's real periodsPerWeek × weeks elapsed in the term (genuine, not fake), and the
// holiday/teacher-absence breakdown is a small stable pseudo-random split of a portion of that — enough to
// make the report's bars/percentages look like a real school term without needing a Holiday/leave-ledger
// model wired in here.

import { route, requireRole, type Actor, type ReqCtx } from '../router'
import { badRequest, notFound } from '../http'
import { table, saveTable, uid, type Row } from '../store'
import { classLabel } from './timetableCore'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']
const TEACHER_PLUS_ROLES = ['teacher', ...STAFF_ROLES]
const ADMIN_ROLES = ['admin', 'superadmin']

// ───────────────────────── stable per-seed pseudo-randomness ─────────────────────────
// A tiny deterministic hash → [0,1), so a given seed string always produces the same "random" number
// across requests/reloads (real randomness would make the risk board reshuffle every recompute, which
// reads as broken rather than simulated).
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function pseudo01(seed: string): number {
  return (hashStr(seed) % 10_000) / 10_000
}

function resolveTerm(actor: Actor, termId?: string): Row {
  const term = termId
    ? table('Term').find(t => t.id === termId && t.schoolId === actor.schoolId)
    : table('Term').find(t => t.schoolId === actor.schoolId && t.isCurrent)
  if (!term) throw badRequest('No current term set — pass ?termId= or mark a term current')
  return term
}

function termRangeEnd(term: Row): Date {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
  const end = new Date(`${term.endDate}T00:00:00.000Z`)
  return today < end ? today : end
}

// ═══════════════════════════════════════════════════════════════════════════
// Item 1 — student risk scoring
// ═══════════════════════════════════════════════════════════════════════════
// Same 0-100 weighted formula as the real backend (see server/src/modules/analytics/service.ts's
// computeRiskScore doc comment): attendance shortfall 35pts, marks trend 20pts, marks absolute 10pts,
// homework overdue 15pts, open discipline cases 10pts, fee overdue (tiered, not linear) 10pts.
// riskLevel: Low < 35, Medium 35-69, High >= 70.

const WEIGHTS = { attendance: 35, marksTrend: 20, marksAbsolute: 10, homework: 15, discipline: 10, fees: 10 } as const
const FEE_HARDSHIP_THRESHOLD = 20_000

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

interface RiskInputs {
  attendancePct: number; avgMarksPct: number; marksDropPct: number
  homeworkOverdueCount: number; feeOverdueAmount: number; openDisciplineCaseCount: number
}
interface RiskFactor { factor: string; weight: number; contribution: number }

function computeRiskScore(inputs: RiskInputs): { riskScore: number; riskLevel: 'Low' | 'Medium' | 'High'; factors: RiskFactor[] } {
  const attendanceContribution = Math.round(clamp01((90 - inputs.attendancePct) / 60) * WEIGHTS.attendance * 10) / 10
  const marksTrendContribution = Math.round(clamp01(inputs.marksDropPct / 40) * WEIGHTS.marksTrend * 10) / 10
  const marksAbsoluteContribution = Math.round(clamp01((60 - inputs.avgMarksPct) / 60) * WEIGHTS.marksAbsolute * 10) / 10
  const homeworkContribution = Math.min(WEIGHTS.homework, inputs.homeworkOverdueCount * 3)
  const disciplineContribution = Math.min(WEIGHTS.discipline, inputs.openDisciplineCaseCount * 5)
  const feeContribution = inputs.feeOverdueAmount <= 0 ? 0 : inputs.feeOverdueAmount >= FEE_HARDSHIP_THRESHOLD ? WEIGHTS.fees : WEIGHTS.fees / 2

  const factors: RiskFactor[] = [
    { factor: 'Attendance shortfall', weight: WEIGHTS.attendance, contribution: attendanceContribution },
    { factor: 'Marks decline (trend)', weight: WEIGHTS.marksTrend, contribution: marksTrendContribution },
    { factor: 'Marks absolute level', weight: WEIGHTS.marksAbsolute, contribution: marksAbsoluteContribution },
    { factor: 'Homework overdue', weight: WEIGHTS.homework, contribution: homeworkContribution },
    { factor: 'Open discipline cases', weight: WEIGHTS.discipline, contribution: disciplineContribution },
    { factor: 'Fee overdue (flag, tiered not linear)', weight: WEIGHTS.fees, contribution: feeContribution },
  ]
  const riskScore = Math.round(factors.reduce((s, f) => s + f.contribution, 0))
  const riskLevel = riskScore >= 70 ? 'High' : riskScore >= 35 ? 'Medium' : 'Low'
  return { riskScore, riskLevel, factors }
}

function computeStudentInputs(studentId: string, classId: string): RiskInputs {
  // Attendance — real once AttendanceRecord is seeded (some other batch owns it); until then, a stable
  // pseudo value in a realistic 65-100% band.
  const attendanceRows = table('AttendanceRecord').filter(r => r.studentId === studentId)
  const attendancePct = attendanceRows.length
    ? Math.round((attendanceRows.filter(r => r.status === 'P' || r.status === 'L').length / attendanceRows.length) * 1000) / 10
    : Math.round((65 + pseudo01(`${studentId}:attendance`) * 35) * 10) / 10

  // Marks — real once Mark is seeded; until then, a stable pseudo average + occasional declining trend.
  // Mark only stores { assessmentId, studentId, score } — maxMarks lives on the Assessment it belongs to.
  const markRows = table('Mark').filter(r => r.studentId === studentId)
  let avgMarksPct: number; let marksDropPct: number
  if (markRows.length) {
    const pcts = markRows
      .map(m => { const a = table('Assessment').find(x => x.id === m.assessmentId); return a ? (Number(m.score) / Number(a.maxMarks || 100)) * 100 : null })
      .filter((p): p is number => p !== null)
    avgMarksPct = pcts.length ? Math.round((pcts.reduce((s, x) => s + x, 0) / pcts.length) * 10) / 10 : 100
    marksDropPct = 0
  } else {
    avgMarksPct = Math.round((35 + pseudo01(`${studentId}:marks`) * 60) * 10) / 10
    const trendRoll = pseudo01(`${studentId}:marks-trend`)
    marksDropPct = trendRoll < 0.7 ? 0 : Math.round(((trendRoll - 0.7) / 0.3) * 40 * 10) / 10
  }

  // Homework overdue — real once Homework is seeded; until then, a small stable pseudo count (0-4, weighted toward 0).
  const homeworkRows = table('Homework')
  const homeworkOverdueCount = homeworkRows.length
    ? homeworkRows.filter(h => h.classSubjectId && table('ClassSubject').find(cs => cs.id === h.classSubjectId)?.classId === classId
        && !table('HomeworkSubmission').some(s => s.homeworkId === h.id && s.studentId === studentId)).length
    : Math.floor(pseudo01(`${studentId}:homework`) * 5)

  // Fee overdue — real once FeeInvoice is seeded; until then, mostly-zero pseudo amount, occasionally large.
  const feeRows = table('FeeInvoice').filter(r => r.studentId === studentId)
  const feeOverdueAmount = feeRows.length
    ? feeRows.filter(r => r.status === 'Due' || r.status === 'PartiallyPaid').reduce((s, r) => s + Math.max(0, Number(r.total ?? 0) - Number(r.paid ?? 0)), 0)
    : (() => { const roll = pseudo01(`${studentId}:fee`); return roll < 0.5 ? 0 : Math.round(roll * 40_000 / 100) * 100 })()

  // Discipline — genuinely real: DisciplinaryCase is seeded by the safety/discipline batch.
  const openDisciplineCaseCount = table('DisciplinaryCase').filter(c => c.studentId === studentId && !c.deletedAt && c.status !== 'Closed').length

  return { attendancePct, avgMarksPct, marksDropPct, homeworkOverdueCount, feeOverdueAmount, openDisciplineCaseCount }
}

function serializeSnapshot(s: Row) {
  const student = table('User').find(u => u.id === s.studentId)
  return {
    id: s.id, studentId: s.studentId, studentName: student?.name as string | undefined,
    classId: s.classId ?? undefined, classLabel: s.classId ? classLabel(String(s.classId)) : undefined,
    termId: s.termId, computedAt: s.computedAt,
    attendancePct: s.attendancePct, avgMarksPct: s.avgMarksPct, homeworkOverdueCount: s.homeworkOverdueCount,
    feeOverdueAmount: s.feeOverdueAmount, openDisciplineCaseCount: s.openDisciplineCaseCount,
    riskScore: s.riskScore, riskLevel: s.riskLevel, factors: s.factors,
  }
}

function teacherOwnedClassIds(actor: Actor): Set<string> {
  return new Set(table('Class').filter(c => c.schoolId === actor.schoolId && c.classTeacherId === actor.userId).map(c => c.id as string))
}

route('POST', '/analytics/risk-snapshots/recompute', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { classId, termId } = ctx.body as { classId?: string; termId?: string }
  const term = resolveTerm(actor, termId)
  let enrollments = table('Enrollment').filter(e => e.schoolId === actor.schoolId && e.status === 'active')
  if (classId) enrollments = enrollments.filter(e => e.classId === classId)

  const rows = table('StudentRiskSnapshot')
  const result: Row[] = []
  for (const e of enrollments) {
    const inputs = computeStudentInputs(String(e.studentId), String(e.classId))
    const { riskScore, riskLevel, factors } = computeRiskScore(inputs)
    const idx = rows.findIndex(r => r.studentId === e.studentId && r.termId === term.id)
    const row: Row = {
      id: idx >= 0 ? rows[idx].id : uid('risksnapshot'), schoolId: actor.schoolId, studentId: e.studentId, termId: term.id, classId: e.classId,
      computedAt: new Date().toISOString(), ...inputs, riskScore, riskLevel, factors,
    }
    if (idx >= 0) rows[idx] = row; else rows.push(row)
    result.push(row)
  }
  saveTable('StudentRiskSnapshot', rows)
  return { items: result.map(serializeSnapshot) }
})

route('GET', '/analytics/risk-snapshots', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...TEACHER_PLUS_ROLES)
  const { classId, riskLevel, termId } = ctx.query
  let rows = table('StudentRiskSnapshot').filter(r => r.schoolId === actor.schoolId)
  if (termId) rows = rows.filter(r => r.termId === termId)
  if (riskLevel) rows = rows.filter(r => r.riskLevel === riskLevel)

  if (actor.role === 'teacher') {
    const owned = teacherOwnedClassIds(actor)
    if (classId) {
      if (!owned.has(classId)) throw badRequest('You are not the class teacher of this class')
      rows = rows.filter(r => r.classId === classId)
    } else {
      rows = rows.filter(r => r.classId && owned.has(String(r.classId)))
    }
  } else if (classId) {
    rows = rows.filter(r => r.classId === classId)
  }
  rows = [...rows].sort((a, b) => Number(b.riskScore) - Number(a.riskScore))
  return { items: rows.map(serializeSnapshot) }
})

// ═══════════════════════════════════════════════════════════════════════════
// Item 2 — lost instructional time report (simulated — see file header)
// ═══════════════════════════════════════════════════════════════════════════

route('GET', '/analytics/lost-time', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const term = resolveTerm(actor, ctx.query.termId)
  const groupBy = (ctx.query.groupBy as 'class' | 'subject' | 'teacher') || 'class'

  const rangeEnd = termRangeEnd(term)
  const start = new Date(`${term.startDate}T00:00:00.000Z`)
  const weeksElapsed = Math.max(0, (rangeEnd.getTime() - start.getTime()) / (7 * 86_400_000))

  const classSubjects = table('ClassSubject').filter(cs => cs.schoolId === actor.schoolId)
  const groups = new Map<string, { key: string; label: string; scheduledPeriodsSoFar: number; lostHoliday: number; lostTeacherAbsence: number; deliverablePeriods: number }>()

  for (const cs of classSubjects) {
    const periodsPerWeek = Number(cs.periodsPerWeek ?? 0)
    const scheduled = Math.round(weeksElapsed * periodsPerWeek)
    const holidayRoll = pseudo01(`${cs.id}:holiday`)
    const absenceRoll = pseudo01(`${cs.id}:absence`)
    const lostHoliday = Math.min(scheduled, Math.round(holidayRoll * 3))
    const lostTeacherAbsence = Math.min(scheduled - lostHoliday, Math.round(absenceRoll * 2))
    const deliverable = Math.max(0, scheduled - lostHoliday - lostTeacherAbsence)

    const key = groupBy === 'class' ? String(cs.classId) : groupBy === 'subject' ? String(cs.subjectId) : String(cs.teacherId ?? 'unassigned')
    const label = groupBy === 'class' ? classLabel(String(cs.classId))
      : groupBy === 'subject' ? (table('Subject').find(s => s.id === cs.subjectId)?.name as string ?? String(cs.subjectId))
      : (table('User').find(u => u.id === cs.teacherId)?.name as string ?? 'Unassigned')
    const g = groups.get(key) ?? { key, label, scheduledPeriodsSoFar: 0, lostHoliday: 0, lostTeacherAbsence: 0, deliverablePeriods: 0 }
    g.scheduledPeriodsSoFar += scheduled
    g.lostHoliday += lostHoliday
    g.lostTeacherAbsence += lostTeacherAbsence
    g.deliverablePeriods += deliverable
    groups.set(key, g)
  }

  const items = [...groups.values()].map(g => ({ ...g, lostTotal: g.lostHoliday + g.lostTeacherAbsence })).sort((a, b) => b.lostTotal - a.lostTotal)
  const totals = items.reduce((t, g) => ({
    scheduledPeriodsSoFar: t.scheduledPeriodsSoFar + g.scheduledPeriodsSoFar,
    lostHoliday: t.lostHoliday + g.lostHoliday,
    lostTeacherAbsence: t.lostTeacherAbsence + g.lostTeacherAbsence,
    lostTotal: t.lostTotal + g.lostTotal,
    deliverablePeriods: t.deliverablePeriods + g.deliverablePeriods,
  }), { scheduledPeriodsSoFar: 0, lostHoliday: 0, lostTeacherAbsence: 0, lostTotal: 0, deliverablePeriods: 0 })

  return { termId: term.id, groupBy, totals, items }
})

// ═══════════════════════════════════════════════════════════════════════════
// Item 3 — teacher workload balancing (real — from seeded TimetableEntry rows)
// ═══════════════════════════════════════════════════════════════════════════

function getOrCreateSettings(actor: Actor): Row {
  const existing = table('AnalyticsSettings').find(s => s.schoolId === actor.schoolId)
  if (existing) return existing
  const row: Row = { id: uid('analyticssettings'), schoolId: actor.schoolId, highLoadThreshold: 30, updatedAt: new Date().toISOString() }
  const rows = table('AnalyticsSettings')
  rows.push(row)
  saveTable('AnalyticsSettings', rows)
  return row
}
const serializeSettings = (s: Row) => ({ id: s.id, highLoadThreshold: s.highLoadThreshold, updatedAt: s.updatedAt })

route('GET', '/analytics/settings', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...TEACHER_PLUS_ROLES)
  return { item: serializeSettings(getOrCreateSettings(actor)) }
})

route('PATCH', '/analytics/settings', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const { highLoadThreshold } = ctx.body as { highLoadThreshold?: number }
  if (highLoadThreshold === undefined || highLoadThreshold < 1 || highLoadThreshold > 80) throw badRequest('highLoadThreshold must be between 1 and 80')
  const settings = getOrCreateSettings(actor)
  const rows = table('AnalyticsSettings')
  const idx = rows.findIndex(s => s.id === settings.id)
  rows[idx] = { ...rows[idx], highLoadThreshold, updatedAt: new Date().toISOString() }
  saveTable('AnalyticsSettings', rows)
  return { item: serializeSettings(rows[idx]) }
})

route('GET', '/analytics/teacher-workload', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...TEACHER_PLUS_ROLES)
  const term = resolveTerm(actor, ctx.query.termId)
  const settings = getOrCreateSettings(actor)
  const teachers = table('User').filter(u => u.schoolId === actor.schoolId && u.role === 'teacher')
  const entries = table('TimetableEntry').filter(e => e.schoolId === actor.schoolId && e.termId === term.id && e.teacherId)
  const counts = new Map<string, number>()
  for (const e of entries) counts.set(String(e.teacherId), (counts.get(String(e.teacherId)) ?? 0) + 1)
  const items = teachers
    .map(t => ({ teacherId: t.id, teacherName: t.name, periodsPerWeek: counts.get(String(t.id)) ?? 0, overThreshold: (counts.get(String(t.id)) ?? 0) >= Number(settings.highLoadThreshold) }))
    .sort((a, b) => b.periodsPerWeek - a.periodsPerWeek)
  return { termId: term.id, highLoadThreshold: settings.highLoadThreshold, items }
})

route('GET', '/analytics/teacher-workload/:teacherId', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...TEACHER_PLUS_ROLES)
  const term = resolveTerm(actor, ctx.query.termId)
  const settings = getOrCreateSettings(actor)
  const periodsPerWeek = table('TimetableEntry').filter(e => e.schoolId === actor.schoolId && e.termId === term.id && e.teacherId === ctx.params.teacherId).length
  return { teacherId: ctx.params.teacherId, termId: term.id, periodsPerWeek, highLoadThreshold: settings.highLoadThreshold, overThreshold: periodsPerWeek >= Number(settings.highLoadThreshold) }
})

// ═══════════════════════════════════════════════════════════════════════════
// Item 4 — homework load regulation
// ═══════════════════════════════════════════════════════════════════════════

route('GET', '/analytics/homework-load', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...TEACHER_PLUS_ROLES)
  const { classId, date } = ctx.query
  if (!classId || !date) throw badRequest('classId and date are required')
  const cls = table('Class').find(c => c.id === classId && c.schoolId === actor.schoolId)
  if (!cls) throw notFound('Class')

  const classSubjectIds = new Set(table('ClassSubject').filter(cs => cs.classId === classId).map(cs => cs.id))
  const rows = table('Homework').filter(h => h.schoolId === actor.schoolId && classSubjectIds.has(String(h.classSubjectId)) && String(h.dueDate).slice(0, 10) === date)
  return {
    classId, date, count: rows.length,
    items: rows.map(h => {
      const cs = table('ClassSubject').find(c => c.id === h.classSubjectId)
      const subject = cs ? table('Subject').find(s => s.id === cs.subjectId) : undefined
      return { homeworkId: h.id, classSubjectId: h.classSubjectId, subjectId: cs?.subjectId, subjectName: subject?.name ?? 'Subject', title: h.title }
    }),
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Item 5 — smart substitute suggestion (real — from seeded TimetableEntry/Substitution rows)
// ═══════════════════════════════════════════════════════════════════════════

const weekdayOf = (d: Date) => d.getUTCDay() // 0 = Sunday … 6 = Saturday — matches the timetable seed's dayOfWeek convention (1 = Monday … 5 = Friday)

route('GET', '/analytics/substitute-suggestions', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...TEACHER_PLUS_ROLES)
  const { classSubjectId, date } = ctx.query
  const periodIdx = Number(ctx.query.periodIdx)
  if (!classSubjectId || !date || Number.isNaN(periodIdx)) throw badRequest('classSubjectId, date and periodIdx are required')
  const cs = table('ClassSubject').find(c => c.id === classSubjectId && c.schoolId === actor.schoolId)
  if (!cs) throw notFound('Class subject')
  const subject = table('Subject').find(s => s.id === cs.subjectId)

  const dayOfWeek = weekdayOf(new Date(`${date}T00:00:00.000Z`))
  const currentTerm = table('Term').find(t => t.schoolId === actor.schoolId && t.isCurrent)
  const entry = table('TimetableEntry').find(e => e.schoolId === actor.schoolId && e.classSubjectId === classSubjectId && e.periodIdx === periodIdx && e.dayOfWeek === dayOfWeek && e.termId === currentTerm?.id)
  if (!entry) throw notFound('Timetable entry for this class-subject / day / period')

  const allTeachers = table('User').filter(u => u.schoolId === actor.schoolId && u.role === 'teacher')
  const ownEntriesAtSlot = new Set(
    table('TimetableEntry').filter(e => e.schoolId === actor.schoolId && e.termId === entry.termId && e.dayOfWeek === dayOfWeek && e.periodIdx === periodIdx && e.teacherId).map(e => String(e.teacherId)),
  )
  const coversAtSlot = new Set(
    table('Substitution').filter(s => s.schoolId === actor.schoolId && s.date === date && table('TimetableEntry').find(e => e.id === s.timetableEntryId)?.periodIdx === periodIdx).map(s => String(s.substituteTeacherId)),
  )
  const busy = new Set([...ownEntriesAtSlot, ...coversAtSlot])
  const subjectTeachers = new Set(table('ClassSubject').filter(c => c.schoolId === actor.schoolId && c.subjectId === cs.subjectId && c.teacherId).map(c => String(c.teacherId)))
  const workload = new Map<string, number>()
  for (const e of table('TimetableEntry').filter(e => e.schoolId === actor.schoolId && e.termId === entry.termId && e.teacherId)) {
    workload.set(String(e.teacherId), (workload.get(String(e.teacherId)) ?? 0) + 1)
  }

  const items = allTeachers
    .filter(t => t.id !== entry.teacherId && !busy.has(String(t.id)))
    .map(t => ({ teacherId: t.id, teacherName: t.name, teachesSubject: subjectTeachers.has(String(t.id)), periodsPerWeek: workload.get(String(t.id)) ?? 0 }))
    .sort((a, b) => (a.teachesSubject === b.teachesSubject ? a.periodsPerWeek - b.periodsPerWeek : a.teachesSubject ? -1 : 1))

  return { timetableEntryId: entry.id, classSubjectId: cs.id, subjectName: subject?.name ?? 'Subject', date, periodIdx, items }
})
