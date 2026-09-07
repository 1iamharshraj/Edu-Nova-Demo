import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { toDate } from './lib/validate'
import * as certificates from './modules/certificates/service'

// Phase 4 sample data: the old seed `applications` (ap1–ap5) and `boardDetails` (u-s…u-s4) ported into the
// Application / BoardRegistration tables, plus parent verification records (Nisha Sharma verified, the other
// parents pending). Runs inside the sample-data transaction; `issueSeedCertificates` runs after it.

type Tx = Prisma.TransactionClient

export interface Phase4Args {
  schoolId: string
  yearId: string
  boardIds: Map<string, string>
  classIds: Map<string, string>
  userId: (seedId: string) => string
}

// ap5 was a "Disciplinary" case in the old blob — not an application kind any more; ported as a Character
// certificate request so the seed keeps five rows. ap3's student (Dev Nambiar, IX-C) never existed in the seed.
const APPLICATIONS = [
  { id: 'ap1', kind: 'Admission', applicantName: 'Nived Pillai', dob: '2016-08-12', gender: 'M', notes: 'Grade V · Sibling of IX-B student; documents verified.', date: '2026-03-28', status: 'Pending', guardian: { name: 'Priya Pillai', relation: 'mother', phone: '+91 98470 11223', email: 'parent.priya.pillai@edunova.in' } },
  { id: 'ap2', kind: 'Admission', applicantName: 'Zoya Sheikh', dob: '2013-11-02', gender: 'F', notes: 'Grade VIII · Transfer from Delhi; awaiting mark sheets.', date: '2026-03-25', status: 'Pending', guardian: { name: 'Imran Sheikh', relation: 'father', phone: '+91 98470 33445', email: 'parent.imran.sheikh@edunova.in' } },
  { id: 'ap3', kind: 'TC', applicantName: 'Dev Nambiar', notes: 'IX-C · Family relocating to Dubai in June.', date: '2026-03-22', status: 'Pending' },
  { id: 'ap4', kind: 'Bonafide', applicantName: 'Aarav Sharma', notes: 'Required for passport application.', date: '2026-03-18', status: 'Approved', studentId: 'u-s', submittedBy: 'u-p', decidedBy: 'u-st' },
  { id: 'ap5', kind: 'Character', applicantName: 'Rohan Gupta', notes: 'Lab equipment misuse; parent meet requested. Character certificate requested by the parent.', date: '2026-03-15', status: 'Pending', studentId: 'u-s4', submittedBy: 'u-p4' },
] as const

const BOARD_DETAILS = [
  { studentId: 'u-s', name: 'Aarav Kumar Sharma', board: 'CBSE', registrationNo: 'CBSE2024X12345', dob: '2010-03-15', rollNo: 'X-A-12', affiliationNo: '930001', status: 'Validated', validatedAt: '2026-03-10' },
  { studentId: 'u-s2', name: 'Diya Patel', board: 'CBSE', registrationNo: 'CBSE2024X12346', dob: '2010-06-22', rollNo: 'X-A-04', affiliationNo: '930001', status: 'Pending' },
  { studentId: 'u-s3', name: 'Kabir Singh', board: 'Matric', registrationNo: 'MAT2024X98765', dob: '2010-01-08', rollNo: 'X-B-07', status: 'SentToBoard', validatedAt: '2025-12-10', sentAt: '2025-12-15' },
  { studentId: 'u-s4', name: 'Rohan Gupta', board: 'CBSE', registrationNo: 'CBSE2024X12347', dob: '2010-09-30', rollNo: 'X-B-15', affiliationNo: '930001', status: 'Draft' },
] as const

const PARENTS = [
  { id: 'u-p', status: 'Verified', verifiedAt: '2026-01-12' },
  { id: 'u-p2', status: 'Pending' },
  { id: 'u-p3', status: 'Pending' },
  { id: 'u-p4', status: 'Pending' },
] as const

export async function loadPhase4(tx: Tx, a: Phase4Args) {
  const { schoolId } = a
  const office = a.userId('u-st')
  const classTeacher = a.userId('u-t')

  for (const ap of APPLICATIONS) {
    const decided = (ap.status as string) === 'Approved' || (ap.status as string) === 'Declined'
    await tx.application.create({
      data: {
        id: ap.id, schoolId, kind: ap.kind, applicantName: ap.applicantName,
        dob: 'dob' in ap ? toDate(ap.dob) : null, gender: 'gender' in ap ? ap.gender : null,
        guardian: 'guardian' in ap ? ap.guardian : undefined,
        studentId: 'studentId' in ap ? a.userId(ap.studentId) : null,
        submittedById: 'submittedBy' in ap ? a.userId(ap.submittedBy) : office,
        status: ap.status, notes: ap.notes, createdAt: toDate(ap.date),
        decidedById: decided && 'decidedBy' in ap ? a.userId(ap.decidedBy) : null,
        decidedAt: decided ? toDate(ap.date) : null,
      },
    })
  }

  for (const d of BOARD_DETAILS) {
    const validated = d.status === 'Validated' || d.status === 'SentToBoard'
    await tx.boardRegistration.create({
      data: {
        schoolId, studentId: a.userId(d.studentId), boardId: a.boardIds.get(d.board)!, academicYearId: a.yearId,
        registrationNo: d.registrationNo, rollNo: d.rollNo, nameOnCertificate: d.name, dob: toDate(d.dob),
        affiliationNo: 'affiliationNo' in d ? d.affiliationNo : null, status: d.status,
        validatedById: validated ? classTeacher : null, validatedAt: validated && 'validatedAt' in d ? toDate(d.validatedAt) : null,
        sentAt: 'sentAt' in d ? toDate(d.sentAt) : null,
      },
    })
  }

  for (const p of PARENTS) {
    const parentId = a.userId(p.id)
    const verified = p.status === 'Verified'
    await tx.parentVerification.create({
      data: { schoolId, parentId, method: 'Document', status: p.status, verifiedById: verified ? office : null, verifiedAt: verified && 'verifiedAt' in p ? toDate(p.verifiedAt) : null },
    })
    await tx.user.update({ where: { id: parentId }, data: { verified } })
  }
}

// Approved seed applications get a real certificate PDF (needs the committed rows, so runs after the transaction).
export async function issueSeedCertificates(schoolId: string, userId: (seedId: string) => string) {
  const ctx = { schoolId, actorId: userId('u-st'), role: 'staff' as const }
  const approved = await prisma.application.findMany({ where: { schoolId, status: 'Approved', kind: { in: ['TC', 'Bonafide', 'Character'] }, studentId: { not: null }, certificates: { none: {} } } })
  for (const ap of approved) await certificates.issue(ctx, ap.kind as 'TC' | 'Bonafide' | 'Character', ap.studentId!, ap.id)
}
