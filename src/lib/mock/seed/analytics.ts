// Seed fragment for Phase 19: early warning & teaching analytics — AnalyticsSettings (the school-wide
// high-load threshold) and a handful of pre-computed StudentRiskSnapshot rows for the current term (t3),
// one per core-seeded student, spanning Low/Medium/High so the "Students at Risk" screen and its risk-
// level filter have something to show immediately (before anyone clicks Recompute). Contribution numbers
// below are hand-computed against the exact weighted formula in modules/analytics.ts (attendance 35pts /
// marks trend 20pts / marks absolute 10pts / homework 15pts / discipline 10pts / fee 10pts, see that
// file's doc comment) so the "Why?" breakdown the UI renders is internally consistent, not just a random
// score. See .agents/edunova/static-demo-plan.md.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'
import { addSeedFragment } from './index'

export function seedAnalytics(db: Collections) {
  db.AnalyticsSettings = [
    { id: 'aset-demo', schoolId: SCHOOL_ID, highLoadThreshold: 30, updatedAt: '2026-09-01T00:00:00.000Z' } as Row,
  ]

  const factors = (attendance: number, trend: number, absolute: number, homework: number, discipline: number, fee: number) => ([
    { factor: 'Attendance shortfall', weight: 35, contribution: attendance },
    { factor: 'Marks decline (trend)', weight: 20, contribution: trend },
    { factor: 'Marks absolute level', weight: 10, contribution: absolute },
    { factor: 'Homework overdue', weight: 15, contribution: homework },
    { factor: 'Open discipline cases', weight: 10, contribution: discipline },
    { factor: 'Fee overdue (flag, tiered not linear)', weight: 10, contribution: fee },
  ])

  db.StudentRiskSnapshot = [
    // Ravi Kumar (class-10a) — healthy across the board.
    {
      id: 'risk-s1-t3', schoolId: SCHOOL_ID, studentId: 'u-s1', termId: 't3', classId: 'class-10a',
      computedAt: '2026-09-10T09:00:00.000Z', attendancePct: 88, avgMarksPct: 90,
      homeworkOverdueCount: 0, feeOverdueAmount: 0, openDisciplineCaseCount: 0,
      riskScore: 1, riskLevel: 'Low', factors: factors(1.2, 0, 0, 0, 0, 0),
    } as Row,
    // Ananya Singh (class-10a) — slipping: attendance + marks trend + one overdue-homework pattern + a discipline case + a mid-size fee balance.
    {
      id: 'risk-s2-t3', schoolId: SCHOOL_ID, studentId: 'u-s2', termId: 't3', classId: 'class-10a',
      computedAt: '2026-09-10T09:00:00.000Z', attendancePct: 70, avgMarksPct: 55,
      homeworkOverdueCount: 3, feeOverdueAmount: 12_000, openDisciplineCaseCount: 1,
      riskScore: 44, riskLevel: 'Medium', factors: factors(11.7, 12.5, 0.8, 9, 5, 5),
    } as Row,
    // Karthik Reddy (class-10b) — multiple compounding red flags.
    {
      id: 'risk-s3-t3', schoolId: SCHOOL_ID, studentId: 'u-s3', termId: 't3', classId: 'class-10b',
      computedAt: '2026-09-10T09:00:00.000Z', attendancePct: 55, avgMarksPct: 40,
      homeworkOverdueCount: 5, feeOverdueAmount: 25_000, openDisciplineCaseCount: 2,
      riskScore: 76, riskLevel: 'High', factors: factors(20.4, 17.5, 3.3, 15, 10, 10),
    } as Row,
    // Divya Sharma (class-9a) — no signal at all.
    {
      id: 'risk-s4-t3', schoolId: SCHOOL_ID, studentId: 'u-s4', termId: 't3', classId: 'class-9a',
      computedAt: '2026-09-10T09:00:00.000Z', attendancePct: 96, avgMarksPct: 88,
      homeworkOverdueCount: 0, feeOverdueAmount: 0, openDisciplineCaseCount: 0,
      riskScore: 0, riskLevel: 'Low', factors: factors(0, 0, 0, 0, 0, 0),
    } as Row,
  ]
}

addSeedFragment(seedAnalytics)
