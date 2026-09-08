import type { Enrollment } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { syncUserTitle } from '../../lib/titleSync'
import { createEnrollment, patchEnrollment } from './schema'

export const serializeEnrollment = (e: Enrollment) => ({
  id: e.id,
  studentId: e.studentId,
  classId: e.classId,
  academicYearId: e.academicYearId,
  rollNo: e.rollNo ?? undefined,
  status: e.status,
})

export function list(ctx: Ctx) {
  return prisma.enrollment.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.enrollment.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Enrollment')
  return row
}

export async function assertStudent(ctx: Ctx, studentId: string) {
  const s = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId } })
  if (!s) throw notFound('Student')
  if (s.role !== 'student') throw new HttpError(400, 'studentId must reference a user with role student')
  return s
}

async function getClass(ctx: Ctx, classId: string) {
  const c = await prisma.class.findFirst({ where: { id: classId, schoolId: ctx.schoolId } })
  if (!c) throw notFound('Class')
  return c
}

export async function create(ctx: Ctx, input: z.infer<typeof createEnrollment>) {
  await assertStudent(ctx, input.studentId)
  const cls = await getClass(ctx, input.classId)
  const existing = await prisma.enrollment.findUnique({
    where: { studentId_academicYearId: { studentId: input.studentId, academicYearId: cls.academicYearId } },
  })
  if (existing) throw new HttpError(409, 'Student is already enrolled in this academic year (PATCH the enrollment to move)', { enrollmentId: existing.id })
  const row = await prisma.enrollment.create({
    data: {
      schoolId: ctx.schoolId,
      studentId: input.studentId,
      classId: cls.id,
      academicYearId: cls.academicYearId,
      rollNo: input.rollNo ?? null,
    },
  })
  await syncUserTitle([row.studentId])
  await audit(ctx.schoolId, ctx.actorId, 'create', 'enrollment', row.id, undefined, serializeEnrollment(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchEnrollment>) {
  const before = await get(ctx, id)
  const cls = input.classId ? await getClass(ctx, input.classId) : null
  const row = await prisma.enrollment.update({
    where: { id },
    data: {
      classId: cls?.id,
      academicYearId: cls?.academicYearId,
      rollNo: input.rollNo,
      status: input.status,
    },
  })
  await syncUserTitle([row.studentId])
  await audit(ctx.schoolId, ctx.actorId, 'update', 'enrollment', id, serializeEnrollment(before), serializeEnrollment(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.enrollment.delete({ where: { id } })
  await syncUserTitle([before.studentId])
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'enrollment', id, serializeEnrollment(before))
}
