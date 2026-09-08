import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { toDate } from './lib/validate'
import { UPLOAD_ROOT } from './modules/files/service'

// Phase 11 demo data (employee IDs, reportsTo, performance reviews, staff conduct, employee documents).
// Runs inside the same transaction as loadSampleData, after users/contracts already exist. See
// phase-11-employee-management.md → sample-data notes in each section (A1/A2/A3/A5/A6).

type Tx = Prisma.TransactionClient

export interface Phase11Args {
  schoolId: string
  userId: (seedId: string) => string
}

// A1 — a handful of employee IDs (not every employee — demonstrates the format, not exhaustive backfill).
// Format matches nextEmployeeId() in routes/users.ts: "EMP-<joinYear>-<4-digit sequence>".
const EMPLOYEE_IDS: { seedId: string; employeeId: string }[] = [
  { seedId: 'u-sa', employeeId: 'EMP-2018-0001' },
  { seedId: 'u-a', employeeId: 'EMP-2019-0001' },
  { seedId: 'u-st', employeeId: 'EMP-2020-0001' },
  { seedId: 'u-t2', employeeId: 'EMP-2020-0002' },
  { seedId: 'u-t', employeeId: 'EMP-2021-0001' },
  { seedId: 'u-t3', employeeId: 'EMP-2021-0002' },
]

// A2 — one small reporting tree: principal <- admin <- {teachers, office staff}.
const REPORTS_TO: { seedId: string; managerSeedId: string }[] = [
  { seedId: 'u-a', managerSeedId: 'u-sa' },
  { seedId: 'u-t', managerSeedId: 'u-a' },
  { seedId: 'u-t2', managerSeedId: 'u-a' },
  { seedId: 'u-t3', managerSeedId: 'u-a' },
  { seedId: 'u-st', managerSeedId: 'u-a' },
]

async function seedTextFile(tx: Tx, schoolId: string, uploaderId: string, name: string, text: string) {
  const bytes = Buffer.from(text, 'utf8')
  const id = crypto.randomUUID().replace(/-/g, '')
  const rel = path.join(schoolId, id)
  const dest = path.join(UPLOAD_ROOT, rel)
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  await fs.promises.writeFile(dest, bytes)
  return tx.file.create({
    data: { id, schoolId, uploaderId, name, mime: 'text/plain', size: bytes.length, path: rel, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
  })
}

export async function loadPhase11(tx: Tx, a: Phase11Args) {
  const { schoolId } = a
  const uid = a.userId

  // ── A1: employee IDs ──
  for (const e of EMPLOYEE_IDS) {
    await tx.user.update({ where: { id: uid(e.seedId) }, data: { employeeId: e.employeeId } })
  }

  // ── A2: reportsTo ──
  for (const r of REPORTS_TO) {
    await tx.user.update({ where: { id: uid(r.seedId) }, data: { reportsTo: uid(r.managerSeedId) } })
  }

  // ── A3: performance reviews — one Acknowledged (full history), one Shared (awaiting employee
  // comment), one Draft. All authored by the admin (u-a), who is also each employee's manager per A2. ──
  await tx.performanceReview.create({
    data: {
      schoolId, employeeId: uid('u-t'), reviewerId: uid('u-a'), cycle: '2025 Annual',
      periodStart: toDate('2025-06-01'), periodEnd: toDate('2026-01-31'), overallRating: 5,
      strengths: 'Consistently strong exam results in X-A; mentors newer teachers well; led the algebra gamification initiative.',
      areasForImprovement: 'Could delegate more of the Olympiad coaching load to avoid burnout during exam season.',
      goals: 'Pilot the gamified curriculum in two more sections next term; co-present at the NCERT summit.',
      employeeComments: 'Thank you — I would like support finding a co-coach for the Olympiad batch next term.',
      status: 'Acknowledged', createdAt: toDate('2026-02-05'), sharedAt: toDate('2026-02-06'), acknowledgedAt: toDate('2026-02-10'),
    },
  })
  await tx.performanceReview.create({
    data: {
      schoolId, employeeId: uid('u-t2'), reviewerId: uid('u-a'), cycle: '2025 Annual',
      periodStart: toDate('2025-06-01'), periodEnd: toDate('2026-01-31'), overallRating: 4,
      strengths: 'Well-prepared lab sessions; good rapport with X-B students.',
      areasForImprovement: 'Assessment turnaround time has slipped a few times this term.',
      goals: 'Return marked assessments within 5 working days consistently.',
      status: 'Shared', createdAt: toDate('2026-02-05'), sharedAt: toDate('2026-02-08'),
    },
  })
  await tx.performanceReview.create({
    data: {
      schoolId, employeeId: uid('u-t3'), reviewerId: uid('u-a'), cycle: '2026 Mid-Year',
      periodStart: toDate('2026-02-01'), periodEnd: toDate('2026-05-31'), overallRating: 4,
      strengths: 'Draft in progress.', areasForImprovement: 'Draft in progress.', goals: 'Draft in progress.',
      status: 'Draft', createdAt: toDate('2026-04-01'),
    },
  })

  // ── A5: one staff conduct record — HR/admin only, reported by the admin. ──
  await tx.staffConductRecord.create({
    data: {
      schoolId, employeeId: uid('u-t4'), reportedById: uid('u-a'), title: 'Repeated late arrivals',
      description: 'Clocked in more than 20 minutes late on four occasions this month; parents have raised it at pickup.',
      category: 'Attendance', status: 'UnderReview', createdAt: toDate('2026-04-08'),
    },
  })

  // ── A6: a couple of labeled employee documents for the class-teacher u-t (Meera Krishnan). ──
  const uploaderId = uid('u-a')
  const idProof = await seedTextFile(tx, schoolId, uploaderId, 'aadhaar-meera-krishnan.txt', 'Aadhaar card copy (placeholder demo content) — Meera Krishnan.')
  const degree = await seedTextFile(tx, schoolId, uploaderId, 'bed-degree-meera-krishnan.txt', 'B.Ed degree certificate (placeholder demo content) — Meera Krishnan.')
  await tx.employeeDocument.create({ data: { schoolId, userId: uid('u-t'), fileId: idProof.id, label: 'ID proof (Aadhaar)', uploadedById: uploaderId } })
  await tx.employeeDocument.create({ data: { schoolId, userId: uid('u-t'), fileId: degree.id, label: 'B.Ed degree certificate', uploadedById: uploaderId } })
}
