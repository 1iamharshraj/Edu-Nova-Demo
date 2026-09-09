import type { z } from 'zod'
import type { AnalyticsSettings, StudentRiskSnapshot } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate } from '../../lib/validate'
import { isStaff } from '../../lib/scope'
import { classLabel } from '../timetable/shared'
import { computePace } from '../syllabus/service'
import type {
  recomputeBody, riskSnapshotsQuery, lostTimeQuery, teacherWorkloadQuery,
  patchAnalyticsSettings, homeworkLoadQuery, substituteSuggestionsQuery,
} from './schema'

// See phase-19-early-warning-analytics.md. Five independent features sharing one module folder — only
// item 1 (risk snapshots) needs a persisted model; items 2-5 are pure computed queries over existing data.

async function resolveTerm(ctx: Ctx, termId?: string) {
  const term = termId
    ? await prisma.term.findFirst({ where: { id: termId, schoolId: ctx.schoolId } })
    : await prisma.term.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true } })
  if (!term) throw new HttpError(400, 'No current term set — pass ?termId= or mark a term current')
  return term
}

// The date range a "so far this term" computation should look at — clipped to today so a term that ends
// in the future doesn't get credited with periods/homework/marks that haven't happened yet (mirrors
// syllabus/service.ts#computePace's asOf handling).
function termRangeEnd(term: { startDate: Date; endDate: Date }) {
  const today = new Date(`${fmtDate(new Date())}T00:00:00.000Z`)
  return today < term.endDate ? today : term.endDate
}

// ═══════════════════════════════════════════════════════════════════════════
// Item 1 — student risk scoring
// ═══════════════════════════════════════════════════════════════════════════
//
// ── Scoring formula (0-100, higher = more at-risk) ──────────────────────────
// Five inputs, each converted to a 0-1 "severity" and multiplied by a fixed point budget. The budgets
// total 100 and were chosen so a class teacher can sanity-check the number at a glance:
//
//   Attendance shortfall     35 pts  — the single strongest predictor of disengagement. A student at or
//                                       above 90% attendance this term contributes 0; below that, severity
//                                       scales linearly down to 0% (worst case, full 35 pts) at 30%
//                                       attendance. Chosen because 90% is the informal "watch this"
//                                       threshold most schools already use informally.
//   Marks decline (trend)    20 pts  — compares the average % score of this term's earlier assessments
//                                       vs. its later ones (not just the current average) per the spec's
//                                       explicit instruction: a 90%→70% slide is a bigger signal than a
//                                       steady 65%. A 40-point-or-more drop maxes this out; no drop (or an
//                                       improving trend) contributes 0.
//   Marks absolute level     10 pts  — a smaller, separate weight so a student who has ALWAYS been
//                                       struggling (no trend, because there was never a "before") still
//                                       shows up. Severity scales from 0 at 60% average down to full at 0%.
//   Homework overdue          15 pts  — count of homework items due in the last 30 days with no submission
//                                       from this student, 3 pts each, capped at 5 items (15 pts). Linear
//                                       and small-weight — a couple of missed submissions is normal, a
//                                       pattern of five+ is not.
//   Open discipline cases     10 pts  — 5 pts per open (non-Closed) DisciplinaryCase, capped at 2 cases.
//   Fee overdue (flag)        10 pts  — deliberately TIERED, not linear with amount, per the spec: a family
//                                       being behind on fees isn't an academic risk signal on its own, so
//                                       it gets the smallest weight and only two tiers — 0 (nothing
//                                       overdue), 5 (some amount overdue), 10 (overdue AND above a "this is
//                                       a real financial-hardship signal" threshold of ₹20,000, roughly one
//                                       term's tuition). A ₹200 overdue library-style top-up and a
//                                       ₹1,50,000 unpaid balance should NOT contribute the same amount.
//
// riskLevel thresholds: Low < 35, Medium 35-69, High >= 70 — chosen so the top ~1/3 of the point budget
// (fee+discipline+part of homework alone) can't push a student past Low on its own; High realistically
// requires a genuine academic signal (attendance or marks) plus at least one other factor.
const WEIGHTS = {
  attendance: 35,
  marksTrend: 20,
  marksAbsolute: 10,
  homework: 15,
  discipline: 10,
  fees: 10,
} as const

const FEE_OVERDUE_HARDSHIP_THRESHOLD = 20_000
const HOMEWORK_WINDOW_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

export interface RiskInputs {
  attendancePct: number
  avgMarksPct: number
  marksDropPct: number // positive = declining (earlier avg minus later avg)
  homeworkOverdueCount: number
  feeOverdueAmount: number
  openDisciplineCaseCount: number
}

export interface RiskFactor { factor: string; weight: number; contribution: number }

export function computeRiskScore(inputs: RiskInputs): { riskScore: number; riskLevel: 'Low' | 'Medium' | 'High'; factors: RiskFactor[] } {
  const attendanceSeverity = clamp01((90 - inputs.attendancePct) / 60) // 0 at 90%, 1 at <=30%
  const attendanceContribution = Math.round(attendanceSeverity * WEIGHTS.attendance * 10) / 10

  const marksTrendSeverity = clamp01(inputs.marksDropPct / 40) // 0 at no drop, 1 at 40+ pt drop
  const marksTrendContribution = Math.round(marksTrendSeverity * WEIGHTS.marksTrend * 10) / 10

  const marksAbsoluteSeverity = clamp01((60 - inputs.avgMarksPct) / 60) // 0 at 60%, 1 at 0%
  const marksAbsoluteContribution = Math.round(marksAbsoluteSeverity * WEIGHTS.marksAbsolute * 10) / 10

  const homeworkContribution = Math.min(WEIGHTS.homework, inputs.homeworkOverdueCount * 3)

  const disciplineContribution = Math.min(WEIGHTS.discipline, inputs.openDisciplineCaseCount * 5)

  const feeContribution = inputs.feeOverdueAmount <= 0 ? 0 : inputs.feeOverdueAmount >= FEE_OVERDUE_HARDSHIP_THRESHOLD ? WEIGHTS.fees : WEIGHTS.fees / 2

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

export const serializeSnapshot = (s: StudentRiskSnapshot & { student?: { name: string }; class?: { section: string; grade: { label: string } } | null }) => ({
  id: s.id,
  studentId: s.studentId,
  studentName: s.student?.name,
  classId: s.classId ?? undefined,
  classLabel: s.class ? classLabel(s.class) : undefined,
  termId: s.termId,
  computedAt: s.computedAt.toISOString(),
  attendancePct: s.attendancePct,
  avgMarksPct: s.avgMarksPct,
  homeworkOverdueCount: s.homeworkOverdueCount,
  feeOverdueAmount: s.feeOverdueAmount,
  openDisciplineCaseCount: s.openDisciplineCaseCount,
  riskScore: s.riskScore,
  riskLevel: s.riskLevel as 'Low' | 'Medium' | 'High',
  factors: s.factors as unknown as RiskFactor[],
})

async function computeStudentInputs(ctx: Ctx, studentId: string, classId: string, term: { id: string; startDate: Date; endDate: Date }): Promise<RiskInputs> {
  const rangeEnd = termRangeEnd(term)

  // Attendance: present (P/L) / all non-holiday sessions for this student's class this term so far.
  const attendanceRecords = await prisma.attendanceRecord.findMany({
    where: { studentId, status: { not: 'H' }, session: { schoolId: ctx.schoolId, classId, date: { gte: term.startDate, lte: rangeEnd } } },
    select: { status: true },
  })
  const attendancePct = attendanceRecords.length
    ? Math.round((attendanceRecords.filter(r => r.status === 'P' || r.status === 'L').length / attendanceRecords.length) * 1000) / 10
    : 100 // no sessions recorded yet this term — no penalty, nothing to judge

  // Marks: every Mark for this student on assessments in this term, chronological by assessment date.
  const marks = await prisma.mark.findMany({
    where: { studentId, assessment: { schoolId: ctx.schoolId, termId: term.id } },
    include: { assessment: { select: { date: true, maxMarks: true, createdAt: true } } },
  })
  const pcts = marks
    .map(m => ({ pct: (m.score / m.assessment.maxMarks) * 100, date: m.assessment.date ?? m.assessment.createdAt }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0)
  const avgMarksPct = pcts.length ? Math.round(avg(pcts.map(p => p.pct)) * 10) / 10 : 100 // no marks yet — no penalty
  let marksDropPct = 0
  if (pcts.length >= 2) {
    const mid = Math.ceil(pcts.length / 2)
    const early = avg(pcts.slice(0, mid).map(p => p.pct))
    const late = avg(pcts.slice(mid).map(p => p.pct))
    marksDropPct = Math.max(0, Math.round((early - late) * 10) / 10)
  }

  // Homework overdue: due in the last HOMEWORK_WINDOW_DAYS (capped at rangeEnd), no submission from this
  // student, across this class's class-subjects. A recent window, not all-time, so a student isn't
  // penalised forever for a single old miss.
  const windowStart = new Date(rangeEnd.getTime() - HOMEWORK_WINDOW_DAYS * DAY_MS)
  const classSubjectIds = (await prisma.classSubject.findMany({ where: { schoolId: ctx.schoolId, classId }, select: { id: true } })).map(cs => cs.id)
  const homeworkOverdueCount = classSubjectIds.length
    ? await prisma.homework.count({
      where: {
        schoolId: ctx.schoolId,
        classSubjectId: { in: classSubjectIds },
        dueDate: { gte: windowStart, lte: rangeEnd },
        submissions: { none: { studentId } },
      },
    })
    : 0

  // Fee overdue: sum of (total - concession - paid) across every Due/PartiallyPaid invoice past its due
  // date, regardless of term (an outstanding balance from an earlier term is still outstanding).
  const overdueInvoices = await prisma.feeInvoice.findMany({
    where: { schoolId: ctx.schoolId, studentId, status: { in: ['Due', 'PartiallyPaid'] }, dueDate: { lte: rangeEnd } },
    include: { payments: { select: { amount: true } } },
  })
  const feeOverdueAmount = Math.round(overdueInvoices.reduce((sum, inv) => {
    const paid = inv.payments.reduce((s, p) => s + p.amount, 0)
    return sum + Math.max(0, inv.total - inv.concession - paid)
  }, 0))

  const openDisciplineCaseCount = await prisma.disciplinaryCase.count({
    where: { schoolId: ctx.schoolId, studentId, deletedAt: null, status: { not: 'Closed' } },
  })

  return { attendancePct, avgMarksPct, marksDropPct, homeworkOverdueCount, feeOverdueAmount, openDisciplineCaseCount }
}

export async function recompute(ctx: Ctx, input: z.infer<typeof recomputeBody>) {
  const term = await resolveTerm(ctx, input.termId)
  const enrollments = await prisma.enrollment.findMany({
    where: { schoolId: ctx.schoolId, status: 'active', academicYear: { isCurrent: true }, classId: input.classId },
    select: { studentId: true, classId: true },
  })

  const rows: StudentRiskSnapshot[] = []
  for (const e of enrollments) {
    const inputs = await computeStudentInputs(ctx, e.studentId, e.classId, term)
    const { riskScore, riskLevel, factors } = computeRiskScore(inputs)
    const row = await prisma.studentRiskSnapshot.upsert({
      where: { studentId_termId: { studentId: e.studentId, termId: term.id } },
      create: {
        schoolId: ctx.schoolId, studentId: e.studentId, termId: term.id, classId: e.classId,
        attendancePct: inputs.attendancePct, avgMarksPct: inputs.avgMarksPct,
        homeworkOverdueCount: inputs.homeworkOverdueCount, feeOverdueAmount: inputs.feeOverdueAmount,
        openDisciplineCaseCount: inputs.openDisciplineCaseCount, riskScore, riskLevel, factors: factors as object[],
      },
      update: {
        classId: e.classId, computedAt: new Date(),
        attendancePct: inputs.attendancePct, avgMarksPct: inputs.avgMarksPct,
        homeworkOverdueCount: inputs.homeworkOverdueCount, feeOverdueAmount: inputs.feeOverdueAmount,
        openDisciplineCaseCount: inputs.openDisciplineCaseCount, riskScore, riskLevel, factors: factors as object[],
      },
    })
    rows.push(row)
  }

  await audit(ctx.schoolId, ctx.actorId, 'recompute', 'studentRiskSnapshot', input.classId ?? ctx.schoolId, undefined, { count: rows.length, classId: input.classId ?? null, termId: term.id })
  return rows
}

export async function listRiskSnapshots(ctx: Ctx, filter: z.infer<typeof riskSnapshotsQuery>) {
  const where: Record<string, unknown> = { schoolId: ctx.schoolId, termId: filter.termId, riskLevel: filter.riskLevel }

  if (ctx.role === 'teacher') {
    const owned = await prisma.class.findMany({ where: { schoolId: ctx.schoolId, classTeacherId: ctx.actorId }, select: { id: true } })
    const ownedIds = owned.map(c => c.id)
    if (filter.classId) {
      if (!ownedIds.includes(filter.classId)) throw new HttpError(403, 'You are not the class teacher of this class')
      where.classId = filter.classId
    } else {
      where.classId = { in: ownedIds }
    }
  } else {
    where.classId = filter.classId
  }

  const rows = await prisma.studentRiskSnapshot.findMany({
    where,
    include: { student: { select: { name: true } }, class: { include: { grade: true } } },
    orderBy: [{ riskScore: 'desc' }],
  })
  return rows.map(serializeSnapshot)
}

// ═══════════════════════════════════════════════════════════════════════════
// Item 2 — lost instructional time report (aggregates Phase 18's per-class-subject pace/lost-periods
// computation — server/src/modules/syllabus/service.ts#computePace — rather than reimplementing it).
// ═══════════════════════════════════════════════════════════════════════════

export async function lostTimeReport(ctx: Ctx, filter: z.infer<typeof lostTimeQuery>) {
  const term = await resolveTerm(ctx, filter.termId)
  const classSubjects = await prisma.classSubject.findMany({
    where: { schoolId: ctx.schoolId },
    include: { class: { include: { grade: true } }, subject: true, teacher: { select: { id: true, name: true } } },
  })

  const paces = await Promise.all(classSubjects.map(async cs => ({ cs, pace: await computePace(ctx, cs.id, { termId: term.id }) })))

  const groups = new Map<string, { key: string; label: string; scheduledPeriodsSoFar: number; lostHoliday: number; lostTeacherAbsence: number; deliverablePeriods: number }>()
  for (const { cs, pace } of paces) {
    const key = filter.groupBy === 'class' ? cs.classId : filter.groupBy === 'subject' ? cs.subjectId : (cs.teacherId ?? 'unassigned')
    const label = filter.groupBy === 'class' ? classLabel(cs.class) : filter.groupBy === 'subject' ? cs.subject.name : (cs.teacher?.name ?? 'Unassigned')
    const g = groups.get(key) ?? { key, label, scheduledPeriodsSoFar: 0, lostHoliday: 0, lostTeacherAbsence: 0, deliverablePeriods: 0 }
    g.scheduledPeriodsSoFar += pace.scheduledPeriodsSoFar
    g.lostHoliday += pace.lostPeriods.holiday
    g.lostTeacherAbsence += pace.lostPeriods.teacherAbsence
    g.deliverablePeriods += pace.deliverablePeriods
    groups.set(key, g)
  }

  const items = [...groups.values()]
    .map(g => ({
      ...g,
      lostTotal: g.lostHoliday + g.lostTeacherAbsence,
    }))
    .sort((a, b) => b.lostTotal - a.lostTotal)

  const totals = items.reduce((t, g) => ({
    scheduledPeriodsSoFar: t.scheduledPeriodsSoFar + g.scheduledPeriodsSoFar,
    lostHoliday: t.lostHoliday + g.lostHoliday,
    lostTeacherAbsence: t.lostTeacherAbsence + g.lostTeacherAbsence,
    lostTotal: t.lostTotal + g.lostTotal,
    deliverablePeriods: t.deliverablePeriods + g.deliverablePeriods,
  }), { scheduledPeriodsSoFar: 0, lostHoliday: 0, lostTeacherAbsence: 0, lostTotal: 0, deliverablePeriods: 0 })

  return { termId: term.id, groupBy: filter.groupBy, totals, items }
}

// ═══════════════════════════════════════════════════════════════════════════
// Item 3 — teacher workload balancing
// ═══════════════════════════════════════════════════════════════════════════

export async function getOrCreateAnalyticsSettings(ctx: Ctx): Promise<AnalyticsSettings> {
  const existing = await prisma.analyticsSettings.findUnique({ where: { schoolId: ctx.schoolId } })
  if (existing) return existing
  try {
    return await prisma.analyticsSettings.create({ data: { schoolId: ctx.schoolId } })
  } catch {
    return prisma.analyticsSettings.findUniqueOrThrow({ where: { schoolId: ctx.schoolId } })
  }
}

export const serializeSettings = (s: AnalyticsSettings) => ({ id: s.id, highLoadThreshold: s.highLoadThreshold, updatedAt: s.updatedAt.toISOString() })

export async function updateAnalyticsSettings(ctx: Ctx, input: z.infer<typeof patchAnalyticsSettings>) {
  const before = await getOrCreateAnalyticsSettings(ctx)
  const row = await prisma.analyticsSettings.update({ where: { schoolId: ctx.schoolId }, data: { highLoadThreshold: input.highLoadThreshold } })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'analyticsSettings', row.id, serializeSettings(before), serializeSettings(row))
  return row
}

// Periods/week for every teacher, from real TimetableEntry rows for the given term.
export async function teacherWorkload(ctx: Ctx, filter: z.infer<typeof teacherWorkloadQuery>) {
  const term = await resolveTerm(ctx, filter.termId)
  const settings = await getOrCreateAnalyticsSettings(ctx)

  const [teachers, entries] = await Promise.all([
    prisma.user.findMany({ where: { schoolId: ctx.schoolId, role: 'teacher' }, select: { id: true, name: true } }),
    prisma.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, termId: term.id, teacherId: { not: null } }, select: { teacherId: true } }),
  ])
  const counts = new Map<string, number>()
  for (const e of entries) counts.set(e.teacherId!, (counts.get(e.teacherId!) ?? 0) + 1)

  const items = teachers
    .map(t => ({ teacherId: t.id, teacherName: t.name, periodsPerWeek: counts.get(t.id) ?? 0, overThreshold: (counts.get(t.id) ?? 0) >= settings.highLoadThreshold }))
    .sort((a, b) => b.periodsPerWeek - a.periodsPerWeek)

  return { termId: term.id, highLoadThreshold: settings.highLoadThreshold, items }
}

// Used by the Timetable Builder to warn inline when assigning a teacher near/over the threshold — a
// lighter-weight lookup than the full report above, for one teacher.
export async function teacherWorkloadFor(ctx: Ctx, teacherId: string, termId?: string) {
  const term = await resolveTerm(ctx, termId)
  const settings = await getOrCreateAnalyticsSettings(ctx)
  const periodsPerWeek = await prisma.timetableEntry.count({ where: { schoolId: ctx.schoolId, termId: term.id, teacherId } })
  return { teacherId, termId: term.id, periodsPerWeek, highLoadThreshold: settings.highLoadThreshold, overThreshold: periodsPerWeek >= settings.highLoadThreshold }
}

// ═══════════════════════════════════════════════════════════════════════════
// Item 4 — homework load regulation
// ═══════════════════════════════════════════════════════════════════════════

export async function homeworkLoad(ctx: Ctx, filter: z.infer<typeof homeworkLoadQuery>) {
  const cls = await prisma.class.findFirst({ where: { id: filter.classId, schoolId: ctx.schoolId } })
  if (!cls) throw notFound('Class')

  const rows = await prisma.homework.findMany({
    where: { schoolId: ctx.schoolId, dueDate: new Date(`${filter.date}T00:00:00.000Z`), classSubject: { classId: filter.classId } },
    include: { classSubject: { include: { subject: true } } },
    orderBy: { createdAt: 'asc' },
  })

  return {
    classId: filter.classId,
    date: filter.date,
    count: rows.length,
    items: rows.map(h => ({ homeworkId: h.id, classSubjectId: h.classSubjectId, subjectId: h.classSubject.subjectId, subjectName: h.classSubject.subject.name, title: h.title })),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Item 5 — smart substitute suggestion
// ═══════════════════════════════════════════════════════════════════════════

const weekdayOf = (d: Date) => d.getUTCDay() // 0 = Sunday … 6 = Saturday, matches substitutions/service.ts

export async function substituteSuggestions(ctx: Ctx, filter: z.infer<typeof substituteSuggestionsQuery>) {
  const cs = await prisma.classSubject.findFirst({ where: { id: filter.classSubjectId, schoolId: ctx.schoolId }, include: { subject: true } })
  if (!cs) throw notFound('Class subject')

  const date = new Date(`${filter.date}T00:00:00.000Z`)
  const dayOfWeek = weekdayOf(date)

  const entry = await prisma.timetableEntry.findFirst({
    where: { schoolId: ctx.schoolId, classSubjectId: filter.classSubjectId, periodIdx: filter.periodIdx, dayOfWeek, term: { isCurrent: true } },
  })
  if (!entry) throw notFound('Timetable entry for this class-subject / day / period')

  const [allTeachers, ownEntriesAtSlot, coversAtSlot, subjectTeacherLinks, workloadEntries] = await Promise.all([
    prisma.user.findMany({ where: { schoolId: ctx.schoolId, role: 'teacher' }, select: { id: true, name: true } }),
    prisma.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, termId: entry.termId, dayOfWeek, periodIdx: filter.periodIdx, teacherId: { not: null } }, select: { teacherId: true } }),
    prisma.substitution.findMany({ where: { schoolId: ctx.schoolId, date, timetableEntry: { dayOfWeek, periodIdx: filter.periodIdx } }, select: { substituteTeacherId: true } }),
    prisma.classSubject.findMany({ where: { schoolId: ctx.schoolId, subjectId: cs.subjectId, teacherId: { not: null } }, select: { teacherId: true } }),
    prisma.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, termId: entry.termId, teacherId: { not: null } }, select: { teacherId: true } }),
  ])

  const busy = new Set([...ownEntriesAtSlot.map(e => e.teacherId!), ...coversAtSlot.map(s => s.substituteTeacherId)])
  const subjectTeachers = new Set(subjectTeacherLinks.map(l => l.teacherId!))
  const workload = new Map<string, number>()
  for (const e of workloadEntries) workload.set(e.teacherId!, (workload.get(e.teacherId!) ?? 0) + 1)

  const items = allTeachers
    .filter(t => t.id !== entry.teacherId && !busy.has(t.id))
    .map(t => ({ teacherId: t.id, teacherName: t.name, teachesSubject: subjectTeachers.has(t.id), periodsPerWeek: workload.get(t.id) ?? 0 }))
    .sort((a, b) => (a.teachesSubject === b.teachesSubject ? a.periodsPerWeek - b.periodsPerWeek : a.teachesSubject ? -1 : 1))

  return { timetableEntryId: entry.id, classSubjectId: cs.id, subjectName: cs.subject.name, date: filter.date, periodIdx: filter.periodIdx, items }
}
