import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { toDate } from './lib/validate'

// Phase 19 demo data (early warning & teaching analytics). Runs inside the same transaction as
// loadSampleData, after Phase 3 (attendance/marks/homework), Phase 5 (fees) and Phase 8 (discipline)
// already exist — this loader deliberately SKEWS a couple of students' existing rows (rather than
// creating a parallel data set) so `POST /api/analytics/risk-snapshots/recompute` produces a genuinely
// "at risk" student and a genuinely "healthy" one, not two students who happen to differ by accident.
// See phase-19-early-warning-analytics.md → Sample data.
//
// Chosen students (both already exist from earlier phases, no new users needed):
//  - Kabir Singh (u-s3, X-B) — the "at risk" student. Already a full fee defaulter from Phase 5
//    (PAY_PLAN 'none' → 3 overdue term invoices, ₹1,74,000 total). This loader adds: degraded Term 3
//    attendance (~50% present), a declining Term 3 marks trend (unit test → mid term → term exam
//    override), 4 unsubmitted homework items due late in Term 3, and two fresh OPEN disciplinary cases
//    (Phase 8's dc2 for this student is already Closed, so it doesn't count toward "open").
//  - Aarav Sharma (u-s, X-A) — the "healthy" student. Already the reference student for Phase 3's mark
//    generator (highest, improving marks by construction) and has ~95% attendance from his deterministic
//    day pattern. This loader adds 4 homework items submitted on time, so his only nonzero factor is the
//    small fee balance already on his invoices from Phase 5 (PAY_PLAN 'exceptLab' — under the ₹20,000
//    hardship tier, so it stays the smaller of the two fee-flag tiers).

type Tx = Prisma.TransactionClient

export interface Phase19Args {
  schoolId: string
  classIds: Map<string, string> // label → Class.id
  classSubjects: Map<string, { id: string; teacherId: string | null }> // `${classLabel}:${subjectId}`
  userId: (seedId: string) => string
}

const id = () => crypto.randomUUID().replace(/-/g, '')

export async function loadPhase19(tx: Tx, a: Phase19Args) {
  const { schoolId } = a
  const kabir = a.userId('u-s3')
  const aarav = a.userId('u-s')
  const classBId = a.classIds.get('X-B')!

  // ── Kabir: degrade Term 3 attendance to ~50% present (every other X-B session this term). ──
  const kabirRecords = await tx.attendanceRecord.findMany({
    where: { studentId: kabir, session: { schoolId, classId: classBId, date: { gte: toDate('2026-02-01'), lte: toDate('2026-05-31') } } },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  await Promise.all(kabirRecords.map((r, i) => tx.attendanceRecord.update({ where: { id: r.id }, data: { status: i % 2 === 0 ? 'A' : 'P' } })))

  // ── Kabir: override every Term 3 mark into a declining trend (early assessments strong, later ones
  // weak) — the spec's explicit "90%→70% is a bigger signal than a steady 65%" case, made concrete. ──
  const kabirMarks = await tx.mark.findMany({
    where: { studentId: kabir, assessment: { schoolId, termId: 't3' } },
    include: { assessment: { select: { maxMarks: true, date: true } } },
  })
  kabirMarks.sort((x, y) => (x.assessment.date?.getTime() ?? 0) - (y.assessment.date?.getTime() ?? 0))
  const n = kabirMarks.length
  await Promise.all(kabirMarks.map((m, i) => {
    const frac = i < n / 3 ? 0.85 : i < (2 * n) / 3 ? 0.5 : 0.22
    return tx.mark.update({ where: { id: m.id }, data: { score: Math.round(m.assessment.maxMarks * frac) } })
  }))

  // ── Kabir: 4 unsubmitted homework items due in the last weeks of Term 3 (the analytics "recent
  // overdue" window). No HomeworkSubmission row is created for him — an overdue item by construction. ──
  const hwDefs: { subjectKey: string; title: string; due: string }[] = [
    { subjectKey: 'math', title: 'Arithmetic Progressions — practice set 4', due: '2026-05-08' },
    { subjectKey: 'phy', title: 'Electricity numericals — chapter 12', due: '2026-05-14' },
    { subjectKey: 'chem', title: 'Metals and Non-metals — reactivity chart', due: '2026-05-20' },
    { subjectKey: 'eng', title: 'Essay redraft — final submission', due: '2026-05-26' },
  ]
  for (const h of hwDefs) {
    const cs = a.classSubjects.get(`X-B:${h.subjectKey}`)
    if (!cs) continue
    await tx.homework.create({
      data: { schoolId, classSubjectId: cs.id, title: h.title, description: '', dueDate: toDate(h.due), createdById: cs.teacherId, attachments: [] },
    })
  }

  // ── Kabir: two fresh OPEN disciplinary cases (Phase 8's dc2 for him is already Closed). ──
  const meera = a.userId('u-t') // class teacher / Mathematics
  await tx.disciplinaryCase.create({
    data: {
      id: id(), schoolId, studentId: kabir, classId: classBId, title: 'Repeated late arrival',
      description: 'Arrived over 30 minutes late to morning assembly on four occasions this month.',
      reportedById: meera, status: 'Reported', createdAt: new Date('2026-05-04T09:00:00.000Z'),
    },
  })
  await tx.disciplinaryCase.create({
    data: {
      id: id(), schoolId, studentId: kabir, classId: classBId, title: 'Disruptive behaviour in class',
      description: 'Repeated talking-back and disruption during Physics period despite warnings.',
      reportedById: meera, status: 'Scheduled', hearingDate: toDate('2026-05-25'), createdAt: new Date('2026-05-18T11:00:00.000Z'),
    },
  })

  // ── Aarav: 4 homework items in the same window, all submitted on or before the due date — the
  // "healthy" counterpart to Kabir's overdue set, so the comparison isn't attendance/marks/fees alone. ──
  const hwDefsHealthy: { subjectKey: string; title: string; due: string }[] = [
    { subjectKey: 'math', title: 'Arithmetic Progressions — practice set 4', due: '2026-05-08' },
    { subjectKey: 'phy', title: 'Electricity numericals — chapter 12', due: '2026-05-14' },
    { subjectKey: 'eng', title: 'Essay redraft — final submission', due: '2026-05-26' },
    { subjectKey: 'cs', title: 'Python file-handling extension', due: '2026-05-20' },
  ]
  for (const h of hwDefsHealthy) {
    const cs = a.classSubjects.get(`X-A:${h.subjectKey}`)
    if (!cs) continue
    const hw = await tx.homework.create({
      data: { schoolId, classSubjectId: cs.id, title: h.title, description: '', dueDate: toDate(h.due), createdById: cs.teacherId, attachments: [] },
    })
    await tx.homeworkSubmission.create({
      data: { homeworkId: hw.id, studentId: aarav, submittedAt: new Date(`${h.due}T08:00:00.000Z`), status: 'Submitted', files: [] },
    })
  }
}
