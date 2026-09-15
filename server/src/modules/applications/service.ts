import type { z } from 'zod'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { assertViewStudent, isRestricted, isStaff, visibleStudentIds } from '../../lib/scope'
import { syncUserTitle } from '../../lib/titleSync'
import { sendEmail, sendWhatsApp } from '../../lib/notify'
import { genPassword, makeEmail, uid } from '../../userDefaults'
import { assertFileIds } from '../files/service'
import * as certificates from '../certificates/service'
import * as alumni from '../alumni/service'
import * as admissionDocuments from '../admissionDocuments/service'
import type { createApplication, patchApplication, listQuery, approveBody, healthFlags as healthFlagsSchema } from './schema'

export const applicationInclude = {
  certificates: { select: { id: true } },
  priorSubjectScores: true,
} satisfies Prisma.ApplicationInclude
export type ApplicationFull = Prisma.ApplicationGetPayload<{ include: typeof applicationInclude }>

export interface GuardianInfo { name: string; phone?: string; email?: string; relation?: string }
export type HealthFlags = z.infer<typeof healthFlagsSchema>

export const serializeApplication = (a: ApplicationFull) => ({
  id: a.id,
  kind: a.kind,
  applicantName: a.applicantName,
  dob: a.dob ? fmtDate(a.dob) : undefined,
  gender: a.gender ?? undefined,
  guardian: (a.guardian as GuardianInfo | null) ?? undefined,
  targetClassId: a.targetClassId ?? undefined,
  targetBoardId: a.targetBoardId ?? undefined,
  studentId: a.studentId ?? undefined,
  documents: a.documents,
  status: a.status,
  notes: a.notes ?? undefined,
  submittedById: a.submittedById ?? undefined,
  decidedById: a.decidedById ?? undefined,
  decidedAt: a.decidedAt?.toISOString(),
  createdAt: a.createdAt.toISOString(),
  certificateId: a.certificates[0]?.id,
  // Part A additions
  previousSchoolName: a.previousSchoolName ?? undefined,
  previousBoardId: a.previousBoardId ?? undefined,
  lastGradeCompleted: a.lastGradeCompleted ?? undefined,
  priorSubjectScores: a.priorSubjectScores.map(s => ({ id: s.id, subjectName: s.subjectName, score: s.score, maxScore: s.maxScore })),
  declaredTrackPreference: a.declaredTrackPreference ?? undefined,
  siblingStudentId: a.siblingStudentId ?? undefined,
  admissionCategoryId: a.admissionCategoryId ?? undefined,
  admissionMode: a.admissionMode ?? undefined,
  healthFlags: (a.healthFlags as HealthFlags | null) ?? undefined,
  transportRequired: a.transportRequired,
  transportPreferredArea: a.transportPreferredArea ?? undefined,
  transportHandledAt: a.transportHandledAt?.toISOString(),
})

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.application.findFirst({ where: { id, schoolId: ctx.schoolId }, include: applicationInclude })
  if (!row) throw notFound('Application')
  if (isRestricted(ctx)) {
    const mine = row.submittedById === ctx.actorId || (row.studentId ? (await visibleStudentIds(ctx))!.includes(row.studentId) : false)
    if (!mine) throw new HttpError(403, 'Not your application')
  }
  return row
}

// staff/admin: all; student/parent: own (studentId among self/wards, or submitted by them).
export async function list(ctx: Ctx, q: z.infer<typeof listQuery>) {
  const only = await visibleStudentIds(ctx)
  return prisma.application.findMany({
    where: {
      schoolId: ctx.schoolId, kind: q.kind, status: q.status,
      ...(only ? { OR: [{ submittedById: ctx.actorId }, { studentId: { in: only } }] } : {}),
    },
    include: applicationInclude,
    orderBy: [{ createdAt: 'desc' }],
  })
}

async function assertTargets(ctx: Ctx, input: {
  targetClassId?: string | null; targetBoardId?: string | null; previousBoardId?: string | null
  admissionCategoryId?: string | null; siblingStudentId?: string | null
}) {
  if (input.targetClassId) {
    const cls = await prisma.class.findFirst({ where: { id: input.targetClassId, schoolId: ctx.schoolId } })
    if (!cls) throw notFound('Target class')
  }
  if (input.targetBoardId) {
    const b = await prisma.board.findFirst({ where: { id: input.targetBoardId, schoolId: ctx.schoolId } })
    if (!b) throw notFound('Target board')
  }
  if (input.previousBoardId) {
    const b = await prisma.board.findFirst({ where: { id: input.previousBoardId, schoolId: ctx.schoolId } })
    if (!b) throw notFound('Previous board')
  }
  if (input.admissionCategoryId) {
    const c = await prisma.admissionCategory.findFirst({ where: { id: input.admissionCategoryId, schoolId: ctx.schoolId } })
    if (!c) throw notFound('Admission category')
  }
  if (input.siblingStudentId) {
    const s = await prisma.user.findFirst({ where: { id: input.siblingStudentId, schoolId: ctx.schoolId, role: 'student' } })
    if (!s) throw notFound('Sibling student')
  }
}

export async function create(ctx: Ctx, input: z.infer<typeof createApplication>) {
  if (ctx.role === 'teacher') throw new HttpError(403, 'Teachers cannot file applications')
  if (input.kind === 'Admission' && isRestricted(ctx)) throw new HttpError(403, 'Admission applications are filed by the office')
  let applicantName = input.applicantName
  let dob = input.dob ?? null
  if (input.kind === 'Admission') {
    if (!applicantName) throw new HttpError(400, 'applicantName is required for an Admission application')
    if (!input.guardian) throw new HttpError(400, 'guardian is required for an Admission application')
  } else {
    if (!input.studentId) throw new HttpError(400, `studentId is required for a ${input.kind} application`)
    await assertViewStudent(ctx, input.studentId)
    const student = await prisma.user.findFirst({ where: { id: input.studentId, schoolId: ctx.schoolId, role: 'student' } })
    if (!student) throw notFound('Student')
    applicantName ??= student.name
    dob ??= student.dob ?? null
  }
  await assertTargets(ctx, input)
  await assertFileIds(ctx, input.documents ?? [])

  const row = await prisma.application.create({
    data: {
      schoolId: ctx.schoolId, kind: input.kind, applicantName: applicantName!, dob: dob ? toDate(dob) : null, gender: input.gender ?? null,
      guardian: input.guardian ?? undefined, targetClassId: input.targetClassId ?? null, targetBoardId: input.targetBoardId ?? null,
      studentId: input.kind === 'Admission' ? null : input.studentId, documents: input.documents ?? [], notes: input.notes ?? null, submittedById: ctx.actorId,
      previousSchoolName: input.previousSchoolName ?? null, previousBoardId: input.previousBoardId ?? null, lastGradeCompleted: input.lastGradeCompleted ?? null,
      declaredTrackPreference: input.declaredTrackPreference ?? null, siblingStudentId: input.siblingStudentId ?? null,
      admissionCategoryId: input.admissionCategoryId ?? null, admissionMode: input.admissionMode ?? null, healthFlags: input.healthFlags ?? undefined,
      transportRequired: input.transportRequired ?? false, transportPreferredArea: input.transportPreferredArea ?? null,
      priorSubjectScores: input.priorSubjectScores?.length
        ? { create: input.priorSubjectScores.map(s => ({ schoolId: ctx.schoolId, subjectName: s.subjectName, score: s.score, maxScore: s.maxScore })) }
        : undefined,
    },
    include: applicationInclude,
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'application', row.id, undefined, serializeApplication(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchApplication>) {
  const before = await get(ctx, id)
  if (!isStaff(ctx)) {
    if (before.submittedById !== ctx.actorId) throw new HttpError(403, 'Only the applicant can edit this application')
    if (before.status !== 'Pending') throw new HttpError(409, 'Application can no longer be edited')
  }
  await assertTargets(ctx, input)
  if (input.documents) await assertFileIds(ctx, input.documents)
  const row = await prisma.application.update({
    where: { id },
    data: {
      applicantName: input.applicantName, dob: input.dob === undefined ? undefined : input.dob ? toDate(input.dob) : null, gender: input.gender,
      guardian: input.guardian === undefined ? undefined : input.guardian ?? Prisma.JsonNull, targetClassId: input.targetClassId, targetBoardId: input.targetBoardId,
      documents: input.documents, notes: input.notes,
      previousSchoolName: input.previousSchoolName, previousBoardId: input.previousBoardId, lastGradeCompleted: input.lastGradeCompleted,
      declaredTrackPreference: input.declaredTrackPreference, siblingStudentId: input.siblingStudentId,
      admissionCategoryId: input.admissionCategoryId, admissionMode: input.admissionMode,
      healthFlags: input.healthFlags === undefined ? undefined : input.healthFlags ?? Prisma.JsonNull,
      transportRequired: input.transportRequired, transportPreferredArea: input.transportPreferredArea,
      priorSubjectScores: input.priorSubjectScores
        ? { deleteMany: {}, create: input.priorSubjectScores.map(s => ({ schoolId: ctx.schoolId, subjectName: s.subjectName, score: s.score, maxScore: s.maxScore })) }
        : undefined,
    },
    include: applicationInclude,
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'application', id, serializeApplication(before), serializeApplication(row))
  return row
}

// Siblings are already derivable via shared Guardian contact info — this is a lookup/suggestion, not a
// redundant stored relationship. Matches an existing active student whose Guardian.parent shares the
// declared guardian's phone or email. Staff can then set siblingStudentId explicitly via update() if
// they accept the suggestion.
export async function siblingSuggestions(ctx: Ctx, q: { phone?: string; email?: string }) {
  if (!q.phone && !q.email) return []
  const rows = await prisma.guardian.findMany({
    where: {
      schoolId: ctx.schoolId,
      parent: { OR: [q.phone ? { phone: q.phone } : undefined, q.email ? { email: q.email.toLowerCase() } : undefined].filter(Boolean) as Prisma.UserWhereInput[] },
      student: { enrollments: { some: { status: 'active' } } },
    },
    include: { student: { include: { enrollments: { where: { status: 'active' }, include: { class: { include: { grade: true } } }, take: 1 } } } },
    distinct: ['studentId'],
  })
  return rows.map(r => {
    const enr = r.student.enrollments[0]
    return { studentId: r.studentId, name: r.student.name, classLabel: enr ? `${enr.class.grade.label}-${enr.class.section}` : undefined }
  })
}

// ── Phase T2 Part A — transport-requirement staff to-do surface. On approval, if an admission declared
// transportRequired, it's surfaced here until staff either create the real StudentStopAssignment (Phase
// 12) or explicitly dismiss it — this module never auto-matches a stop from free text.
export async function transportTodos(ctx: Ctx) {
  const apps = await prisma.application.findMany({
    where: { schoolId: ctx.schoolId, kind: 'Admission', status: 'Approved', transportRequired: true, transportHandledAt: null, studentId: { not: null } },
    orderBy: [{ decidedAt: 'desc' }],
  })
  if (apps.length === 0) return []
  const studentIds = apps.map(a => a.studentId!)
  const assigned = new Set((await prisma.studentStopAssignment.findMany({ where: { schoolId: ctx.schoolId, studentId: { in: studentIds } }, select: { studentId: true } })).map(a => a.studentId))
  return apps.map(a => ({
    applicationId: a.id, studentId: a.studentId!, applicantName: a.applicantName, transportPreferredArea: a.transportPreferredArea ?? undefined,
    alreadyAssigned: assigned.has(a.studentId!),
  }))
}

export async function markTransportHandled(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  const row = await prisma.application.update({ where: { id }, data: { transportHandledAt: new Date() }, include: applicationInclude })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'application', id, { transportHandledAt: before.transportHandledAt }, { transportHandledAt: row.transportHandledAt })
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.application.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'application', id, serializeApplication(before))
}

function assertOpen(row: ApplicationFull) {
  if (row.status === 'Approved' || row.status === 'Declined') throw new HttpError(409, `Application is already ${row.status.toLowerCase()}`)
}

export async function verify(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  assertOpen(before)
  const row = await prisma.application.update({ where: { id }, data: { status: 'Verified' }, include: applicationInclude })
  await audit(ctx.schoolId, ctx.actorId, 'verify', 'application', id, serializeApplication(before), serializeApplication(row))
  return row
}

export async function decline(ctx: Ctx, id: string, notes?: string) {
  const before = await get(ctx, id)
  assertOpen(before)
  const row = await prisma.application.update({
    where: { id }, data: { status: 'Declined', notes: notes ?? before.notes, decidedById: ctx.actorId, decidedAt: new Date() }, include: applicationInclude,
  })
  await audit(ctx.schoolId, ctx.actorId, 'decline', 'application', id, serializeApplication(before), serializeApplication(row))
  return row
}

async function freeEmail(tx: Prisma.TransactionClient, wanted: string) {
  const [local, domain] = wanted.toLowerCase().split('@')
  for (let i = 0; i < 100; i++) {
    const email = i === 0 ? `${local}@${domain}` : `${local}${i + 1}@${domain}`
    if (!(await tx.user.findUnique({ where: { email } }))) return email
  }
  throw new HttpError(409, 'Could not allocate a unique email')
}

export interface Created { student: { id: string; email: string; password: string }; parent?: { id: string; email: string; password: string; existing?: boolean } }

// Admission approval: student User + Enrollment (next free roll number) + parent User (or an existing parent
// matched by email) + Guardian, all in one transaction. Credentials are returned once.
async function approveAdmission(ctx: Ctx, app: ApplicationFull): Promise<{ row: ApplicationFull; created: Created }> {
  if (!app.targetClassId) throw new HttpError(400, 'targetClassId must be set before an Admission can be approved')
  const cls = await prisma.class.findFirst({ where: { id: app.targetClassId, schoolId: ctx.schoolId }, include: { grade: true } })
  if (!cls) throw notFound('Target class')
  const guardian = (app.guardian ?? null) as GuardianInfo | null
  if (!guardian?.name) throw new HttpError(400, 'guardian must be set before an Admission can be approved')

  const studentPassword = genPassword()
  const parentPassword = genPassword()
  const [studentHash, parentHash] = await Promise.all([bcrypt.hash(studentPassword, 10), bcrypt.hash(parentPassword, 10)])

  const result = await prisma.$transaction(async tx => {
    const rolls = await tx.enrollment.findMany({ where: { classId: cls.id }, select: { rollNo: true } })
    const rollNo = String(rolls.reduce((m, r) => Math.max(m, Number(r.rollNo) || 0), 0) + 1)
    const hue = Math.floor(Math.random() * 360)

    const student = await tx.user.create({
      data: {
        id: uid('u-s'), schoolId: ctx.schoolId, role: 'student', name: app.applicantName, email: await freeEmail(tx, makeEmail(app.applicantName, 'student')),
        passwordHash: studentHash, mustChangePassword: true, title: `Class ${cls.grade.label}-${cls.section} · Roll ${rollNo}`, avatarHue: hue, verified: true,
        dob: app.dob ? fmtDate(app.dob) : null, joinDate: fmtDate(new Date()),
      },
    })
    await tx.enrollment.create({ data: { schoolId: ctx.schoolId, studentId: student.id, classId: cls.id, academicYearId: cls.academicYearId, rollNo } })

    let parent = guardian.email ? await tx.user.findFirst({ where: { email: guardian.email.toLowerCase(), schoolId: ctx.schoolId, role: 'parent' } }) : null
    const existing = !!parent
    if (!parent) {
      if (guardian.email && (await tx.user.findUnique({ where: { email: guardian.email.toLowerCase() } }))) {
        throw new HttpError(409, 'guardian.email belongs to a user who is not a parent of this school')
      }
      parent = await tx.user.create({
        data: {
          id: uid('u-p'), schoolId: ctx.schoolId, role: 'parent', name: guardian.name, email: guardian.email ? guardian.email.toLowerCase() : await freeEmail(tx, makeEmail(guardian.name, 'parent')),
          passwordHash: parentHash, mustChangePassword: true, title: `Parent of ${app.applicantName}`, avatarHue: (hue + 120) % 360, verified: false,
          phone: guardian.phone ?? null, joinDate: fmtDate(new Date()),
        },
      })
    }
    await tx.guardian.create({ data: { schoolId: ctx.schoolId, parentId: parent.id, studentId: student.id, relation: guardian.relation ?? 'parent' } })

    // Health handoff (Part A) — capture once at intake, hand off once here, in the same atomic
    // transaction as student creation. NOT a duplicate of HealthRecord: only the small structured intake
    // subset becomes seed rows; staff/nurse can expand on them normally afterward via modules/health.
    const flags = (app.healthFlags ?? null) as HealthFlags | null
    const healthRecordIds: string[] = []
    if (flags) {
      const now = fmtDate(new Date())
      if (flags.allergies) {
        const r = await tx.healthRecord.create({ data: { schoolId: ctx.schoolId, studentId: student.id, kind: 'Allergy', title: 'Reported at admission', detail: flags.allergies, date: toDate(now), addedById: ctx.actorId } })
        healthRecordIds.push(r.id)
      }
      if (flags.conditions) {
        const r = await tx.healthRecord.create({ data: { schoolId: ctx.schoolId, studentId: student.id, kind: 'Condition', title: 'Reported at admission', detail: flags.conditions, date: toDate(now), addedById: ctx.actorId } })
        healthRecordIds.push(r.id)
      }
      if (flags.bloodGroup) {
        const r = await tx.healthRecord.create({ data: { schoolId: ctx.schoolId, studentId: student.id, kind: 'Other', title: 'Blood group (from admission)', detail: `Blood group: ${flags.bloodGroup}`, date: toDate(now), addedById: ctx.actorId } })
        healthRecordIds.push(r.id)
      }
    }

    const row = await tx.application.update({
      where: { id: app.id }, data: { status: 'Approved', studentId: student.id, decidedById: ctx.actorId, decidedAt: new Date() }, include: applicationInclude,
    })
    return { row, student, parent, existing, healthRecordIds }
  })

  await syncUserTitle([result.student.id, result.parent.id])
  await audit(ctx.schoolId, ctx.actorId, 'create', 'user', result.student.id, undefined, { role: 'student', name: result.student.name, email: result.student.email, applicationId: app.id })
  if (!result.existing) await audit(ctx.schoolId, ctx.actorId, 'create', 'user', result.parent.id, undefined, { role: 'parent', name: result.parent.name, email: result.parent.email, applicationId: app.id })
  for (const id of result.healthRecordIds) await audit(ctx.schoolId, ctx.actorId, 'create', 'health-record', id, undefined, { studentId: result.student.id, applicationId: app.id, source: 'admission-intake' })

  // Credential delivery (Phase 9 — see phase-9-10-integrations-hardening.md → item 3). Best-effort;
  // the credentials are also returned in the API response for the admitting staff member to hand over.
  await sendEmail({
    to: result.student.email, subject: 'Your Edkonic student account',
    body: `Welcome to Edkonic, ${result.student.name}.\nLogin email: ${result.student.email}\nTemporary password: ${studentPassword}\nYou will be asked to set a new password on first login.`,
  })
  if (!result.existing) {
    const parentBody = `Welcome to Edkonic. An account has been created for you as guardian of ${app.applicantName}.\nLogin email: ${result.parent.email}\nTemporary password: ${parentPassword}\nYou will be asked to set a new password on first login.`
    await sendEmail({ to: result.parent.email, subject: 'Your Edkonic parent account', body: parentBody })
    // Phase 23 item 3: WhatsApp alongside email/SMS, same best-effort pattern — only when a phone is on file.
    if (result.parent.phone) await sendWhatsApp({ to: result.parent.phone, body: parentBody })
  }
  return {
    row: result.row,
    created: {
      student: { id: result.student.id, email: result.student.email, password: studentPassword },
      parent: result.existing ? { id: result.parent.id, email: result.parent.email, password: '', existing: true } : { id: result.parent.id, email: result.parent.email, password: parentPassword },
    },
  }
}

// `opts` (Phase 13): when approving a TC, staff may optionally set `convertToAlumni` to also create an
// AlumniProfile in the same action, instead of a separate later trip to the Alumni module — see
// phase-13-alumni.md and modules/alumni/service.ts#convertStudent for the conversion design. The
// enrollment has already been ended (status 'transferred') by the TC branch just above, so the alumni
// conversion is called with `endEnrollment: false` — it must not try to end it a second time (with a
// different status). Ignored for every other application kind; a duplicate conversion (e.g. a retry) is
// swallowed as a no-op rather than failing the whole approval, since the certificate has already issued.
export async function approve(ctx: Ctx, id: string, opts?: z.infer<typeof approveBody>) {
  const before = await get(ctx, id)
  assertOpen(before)
  let row: ApplicationFull
  let created: Created | undefined
  let alumniProfile: ReturnType<typeof alumni.serializeProfile> | undefined
  if (before.kind === 'Admission') {
    // Part B — completeness checklist can optionally hard-block approval (school-level setting). When
    // off (the default), approval proceeds with the checklist left open for post-enrollment follow-up.
    const check = await admissionDocuments.checklist(ctx, before.id)
    if (check.admissionDocumentsBlockApproval && !check.complete) {
      throw new HttpError(409, 'Required admission documents are missing', undefined, { missingRequired: check.missingRequired })
    }
    ;({ row, created } = await approveAdmission(ctx, before))
  } else {
    const studentId = before.studentId
    if (!studentId) throw new HttpError(400, 'Application has no student')
    if (before.kind === 'TC') {
      // Phase T2 Part B — TC-issuance document-return workflow. Resolved (and 409s, before any state
      // changes below, if unresolved) ahead of ending the enrollment/issuing the certificate — see
      // modules/admissionDocuments/service.ts#resolveHeldOriginalsForTc.
      await admissionDocuments.resolveHeldOriginalsForTc(ctx, studentId, opts?.documentReturns)
      await prisma.enrollment.updateMany({ where: { studentId, status: 'active' }, data: { status: 'transferred' } })
      await syncUserTitle([studentId])
    }
    row = await prisma.application.update({ where: { id }, data: { status: 'Approved', decidedById: ctx.actorId, decidedAt: new Date() }, include: applicationInclude })
    await certificates.issue(ctx, before.kind as 'TC' | 'Bonafide' | 'Character', studentId, id)
    row = await get(ctx, id)

    if (before.kind === 'TC' && opts?.convertToAlumni) {
      try {
        const { profile } = await alumni.convertStudent(ctx, { studentId, graduationYear: opts.alumniGraduationYear, endEnrollment: false })
        alumniProfile = alumni.serializeProfile(profile)
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 409)) throw e // already converted: harmless no-op
      }
    }
  }
  await audit(ctx.schoolId, ctx.actorId, 'approve', 'application', id, serializeApplication(before), serializeApplication(row))
  return { row, created, alumni: alumniProfile }
}
