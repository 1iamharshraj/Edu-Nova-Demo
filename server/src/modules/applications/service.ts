import type { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { assertViewStudent, isRestricted, isStaff, visibleStudentIds } from '../../lib/scope'
import { syncLegacyUserFields } from '../../lib/legacySync'
import { makeEmail, uid } from '../../userDefaults'
import { assertFileIds } from '../files/service'
import * as certificates from '../certificates/service'
import type { createApplication, patchApplication, listQuery } from './schema'

export const applicationInclude = { certificates: { select: { id: true } } } satisfies Prisma.ApplicationInclude
export type ApplicationFull = Prisma.ApplicationGetPayload<{ include: typeof applicationInclude }>

export interface GuardianInfo { name: string; phone?: string; email?: string; relation?: string }

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

async function assertTargets(ctx: Ctx, input: { targetClassId?: string | null; targetBoardId?: string | null }) {
  if (input.targetClassId) {
    const cls = await prisma.class.findFirst({ where: { id: input.targetClassId, schoolId: ctx.schoolId } })
    if (!cls) throw notFound('Target class')
  }
  if (input.targetBoardId) {
    const b = await prisma.board.findFirst({ where: { id: input.targetBoardId, schoolId: ctx.schoolId } })
    if (!b) throw notFound('Target board')
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
    },
    include: applicationInclude,
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'application', id, serializeApplication(before), serializeApplication(row))
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

const genPassword = () => crypto.randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8) + '2k'

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

    const row = await tx.application.update({
      where: { id: app.id }, data: { status: 'Approved', studentId: student.id, decidedById: ctx.actorId, decidedAt: new Date() }, include: applicationInclude,
    })
    return { row, student, parent, existing }
  })

  await syncLegacyUserFields([result.student.id, result.parent.id])
  await audit(ctx.schoolId, ctx.actorId, 'create', 'user', result.student.id, undefined, { role: 'student', name: result.student.name, email: result.student.email, applicationId: app.id })
  if (!result.existing) await audit(ctx.schoolId, ctx.actorId, 'create', 'user', result.parent.id, undefined, { role: 'parent', name: result.parent.name, email: result.parent.email, applicationId: app.id })
  return {
    row: result.row,
    created: {
      student: { id: result.student.id, email: result.student.email, password: studentPassword },
      parent: result.existing ? { id: result.parent.id, email: result.parent.email, password: '', existing: true } : { id: result.parent.id, email: result.parent.email, password: parentPassword },
    },
  }
}

export async function approve(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  assertOpen(before)
  let row: ApplicationFull
  let created: Created | undefined
  if (before.kind === 'Admission') {
    ;({ row, created } = await approveAdmission(ctx, before))
  } else {
    const studentId = before.studentId
    if (!studentId) throw new HttpError(400, 'Application has no student')
    if (before.kind === 'TC') {
      await prisma.enrollment.updateMany({ where: { studentId, status: 'active' }, data: { status: 'transferred' } })
      await syncLegacyUserFields([studentId])
    }
    row = await prisma.application.update({ where: { id }, data: { status: 'Approved', decidedById: ctx.actorId, decidedAt: new Date() }, include: applicationInclude })
    await certificates.issue(ctx, before.kind as 'TC' | 'Bonafide' | 'Character', studentId, id)
    row = await get(ctx, id)
  }
  await audit(ctx.schoolId, ctx.actorId, 'approve', 'application', id, serializeApplication(before), serializeApplication(row))
  return { row, created }
}
