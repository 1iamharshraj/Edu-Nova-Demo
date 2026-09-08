import type { ClassSubject } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { syncUserTitle } from '../../lib/titleSync'
import { assertTeacher } from '../classes/service'
import { createClassSubject, patchClassSubject } from './schema'

export const serializeClassSubject = (cs: ClassSubject) => ({
  id: cs.id,
  classId: cs.classId,
  subjectId: cs.subjectId,
  teacherId: cs.teacherId ?? undefined,
  periodsPerWeek: cs.periodsPerWeek,
})

export function list(ctx: Ctx) {
  return prisma.classSubject.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.classSubject.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Class subject')
  return row
}

async function assertRefs(ctx: Ctx, classId?: string, subjectId?: string) {
  if (classId && !(await prisma.class.findFirst({ where: { id: classId, schoolId: ctx.schoolId } }))) throw notFound('Class')
  if (subjectId && !(await prisma.subject.findFirst({ where: { id: subjectId, schoolId: ctx.schoolId } }))) throw notFound('Subject')
}

export async function create(ctx: Ctx, input: z.infer<typeof createClassSubject>) {
  await assertRefs(ctx, input.classId, input.subjectId)
  await assertTeacher(ctx, input.teacherId)
  const row = await prisma.classSubject.create({
    data: {
      schoolId: ctx.schoolId,
      classId: input.classId,
      subjectId: input.subjectId,
      teacherId: input.teacherId ?? null,
      periodsPerWeek: input.periodsPerWeek,
    },
  })
  if (row.teacherId) await syncUserTitle([row.teacherId])
  await audit(ctx.schoolId, ctx.actorId, 'create', 'classSubject', row.id, undefined, serializeClassSubject(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchClassSubject>) {
  const before = await get(ctx, id)
  await assertRefs(ctx, input.classId, input.subjectId)
  if ('teacherId' in input) await assertTeacher(ctx, input.teacherId)
  const row = await prisma.classSubject.update({ where: { id }, data: input })
  await syncUserTitle([before.teacherId ?? '', row.teacherId ?? ''])
  await audit(ctx.schoolId, ctx.actorId, 'update', 'classSubject', id, serializeClassSubject(before), serializeClassSubject(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.classSubject.delete({ where: { id } })
  if (before.teacherId) await syncUserTitle([before.teacherId])
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'classSubject', id, serializeClassSubject(before))
}
