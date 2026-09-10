import type { TeacherQualification } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { createTeacherQualification, patchTeacherQualification } from './schema'

export const serializeTeacherQualification = (q: TeacherQualification) => ({
  id: q.id,
  teacherId: q.teacherId,
  subjectId: q.subjectId,
  gradeRangeMin: q.gradeRangeMin,
  gradeRangeMax: q.gradeRangeMax,
  proficiency: q.proficiency,
  isPrimarySubject: q.isPrimarySubject,
})

export function list(ctx: Ctx, filter?: { teacherId?: string }) {
  return prisma.teacherQualification.findMany({
    where: { schoolId: ctx.schoolId, teacherId: filter?.teacherId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.teacherQualification.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Teacher qualification')
  return row
}

async function assertTeacher(ctx: Ctx, teacherId: string) {
  const t = await prisma.user.findFirst({ where: { id: teacherId, schoolId: ctx.schoolId } })
  if (!t) throw notFound('Teacher')
  if (t.role !== 'teacher') throw new HttpError(400, 'teacherId must reference a user with role teacher')
}

async function assertSubject(ctx: Ctx, subjectId: string) {
  if (!(await prisma.subject.findFirst({ where: { id: subjectId, schoolId: ctx.schoolId } }))) throw notFound('Subject')
}

export async function create(ctx: Ctx, input: z.infer<typeof createTeacherQualification>) {
  await assertTeacher(ctx, input.teacherId)
  await assertSubject(ctx, input.subjectId)
  const row = await prisma.teacherQualification.create({
    data: {
      schoolId: ctx.schoolId,
      teacherId: input.teacherId,
      subjectId: input.subjectId,
      gradeRangeMin: input.gradeRangeMin,
      gradeRangeMax: input.gradeRangeMax,
      proficiency: input.proficiency,
      isPrimarySubject: input.isPrimarySubject ?? false,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'teacherQualification', row.id, undefined, serializeTeacherQualification(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchTeacherQualification>) {
  const before = await get(ctx, id)
  const min = input.gradeRangeMin ?? before.gradeRangeMin
  const max = input.gradeRangeMax ?? before.gradeRangeMax
  if (min > max) throw new HttpError(400, 'gradeRangeMin must be <= gradeRangeMax')
  const row = await prisma.teacherQualification.update({ where: { id }, data: input })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'teacherQualification', id, serializeTeacherQualification(before), serializeTeacherQualification(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.teacherQualification.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'teacherQualification', id, serializeTeacherQualification(before))
}
