import type { Prisma } from '@prisma/client'
import { toDate } from './lib/validate'

// Phase 6 demo data (leave, contracts, resignations, duties). Runs inside the same transaction as
// loadSampleData, after users/classes/enrollments already exist. See phase-6-hr.md → Sample data.

type Tx = Prisma.TransactionClient

export interface Phase6Args {
  schoolId: string
  userId: (seedId: string) => string
}

const DAY = 24 * 60 * 60 * 1000

// Inclusive day count between from/to, excluding Sundays — mirrors modules/leave/service.ts#countDays.
function countDays(from: Date, to: Date): number {
  let days = 0
  const d = new Date(from)
  while (d.getTime() <= to.getTime()) {
    if (d.getUTCDay() !== 0) days++
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}

// Contracts ported from makeContract() in src/lib/data.ts — the eleven contract-holders, all Active and
// signed by both sides (the legacy `signedBy: 'Dr. Leela Menon'` is folded into a single principal admin
// signature here for simplicity).
const CONTRACTS: { seedId: string; designation: string; department?: string }[] = [
  { seedId: 'u-t', designation: 'Senior Mathematics Teacher' },
  { seedId: 'u-t2', designation: 'Physics Teacher' },
  { seedId: 'u-t3', designation: 'Chemistry Teacher' },
  { seedId: 'u-t4', designation: 'English Teacher' },
  { seedId: 'u-t5', designation: 'Computer Science Teacher' },
  { seedId: 'u-t6', designation: 'Physical Education Teacher' },
  { seedId: 'u-st', designation: 'Office Superintendent', department: 'Administration' },
  { seedId: 'u-st2', designation: 'Accounts Officer', department: 'Finance' },
  { seedId: 'u-st3', designation: 'Admission Coordinator', department: 'Admissions' },
  { seedId: 'u-a', designation: 'School Administrator', department: 'Administration' },
  { seedId: 'u-sa', designation: 'Principal & Superadmin', department: 'Administration' },
]
const CONTRACT_TERMS = 'Standard Edkonic employment terms: 60-day notice period, 18 paid leave days per year, confidentiality and non-solicitation clauses.'

// Leave requests ported from the legacy `leaves` array — all "Student leave" filed by the parent for their ward.
const LEAVES: { student: string; parent: string; from: string; to: string; reason: string; approved?: string }[] = [
  { student: 'u-s', parent: 'u-p', from: '2026-04-21', to: '2026-04-22', reason: 'Family function in Kochi' }, // Pending
  { student: 'u-s', parent: 'u-p', from: '2026-01-09', to: '2026-01-09', reason: 'Dental appointment', approved: 'u-t' },
  { student: 'u-s2', parent: 'u-p2', from: '2026-04-15', to: '2026-04-16', reason: 'State-level debate' }, // Pending
  { student: 'u-s3', parent: 'u-p3', from: '2026-03-11', to: '2026-03-12', reason: 'Fever', approved: 'u-t2' },
]

const DUTIES: { title: string; eventTitle: string; due: string; assignee?: string; done: boolean }[] = [
  { title: 'Stage coordination', eventTitle: 'Annual Sports Day', due: '2026-04-02', assignee: 'u-t', done: true },
  { title: 'Quiz master — Senior finals', eventTitle: "Tech Fest '26", due: '2026-04-24', assignee: 'u-t2', done: false },
  { title: 'Judges liaison', eventTitle: 'Science Exhibition', due: '2026-02-26', assignee: 'u-t2', done: true },
]

export async function loadPhase6(tx: Tx, a: Phase6Args) {
  const { schoolId } = a

  // Leave types.
  await tx.leaveType.create({ data: { schoolId, name: 'Casual', daysPerYear: 12, appliesTo: 'staff' } })
  await tx.leaveType.create({ data: { schoolId, name: 'Sick', daysPerYear: 10, appliesTo: 'staff' } })
  const studentLeave = await tx.leaveType.create({ data: { schoolId, name: 'Student leave', daysPerYear: 0, appliesTo: 'student' } })

  // Leave requests.
  for (const l of LEAVES) {
    const from = toDate(l.from)
    const to = toDate(l.to)
    await tx.leaveRequest.create({
      data: {
        schoolId, requesterId: a.userId(l.parent), forUserId: a.userId(l.student), leaveTypeId: studentLeave.id,
        fromDate: from, toDate: to, days: countDays(from, to), reason: l.reason,
        status: l.approved ? 'Approved' : 'Pending',
        decidedById: l.approved ? a.userId(l.approved) : null,
        decidedAt: l.approved ? new Date(to.getTime() + DAY) : null,
      },
    })
  }

  // Contracts — Active, both signed.
  const principalId = a.userId('u-sa')
  for (const c of CONTRACTS) {
    const signedAt = toDate('2024-06-01')
    await tx.contract.create({
      data: {
        schoolId, userId: a.userId(c.seedId), designation: c.designation, department: c.department ?? null,
        startDate: signedAt, endDate: toDate('2027-05-31'), terms: CONTRACT_TERMS, status: 'Active',
        employeeSignedAt: signedAt, adminSignedAt: signedAt, adminSignedById: principalId,
      },
    })
  }

  // Resignation res1 — Rahul Verma (u-t4), Pending.
  await tx.resignation.create({
    data: {
      schoolId, userId: a.userId('u-t4'), reason: 'Relocating to another city for family commitments.',
      submittedAt: toDate('2026-03-20'), lastWorkingDate: toDate('2026-05-31'), status: 'Pending',
    },
  })

  // Duties from the legacy workAssign list.
  const createdById = a.userId('u-a')
  for (const d of DUTIES) {
    await tx.duty.create({
      data: {
        schoolId, title: d.title, eventTitle: d.eventTitle, eventDate: toDate(d.due),
        assigneeId: d.assignee ? a.userId(d.assignee) : null, createdById, status: d.done ? 'Done' : 'Assigned',
      },
    })
  }
}
