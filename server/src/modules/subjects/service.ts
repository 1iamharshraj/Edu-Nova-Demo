import type { Subject } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { syncLegacyUserFields } from '../../lib/legacySync'
import { createSubject, patchSubject } from './schema'

export const serializeSubject = (s: Subject) => ({ id: s.id, name: s.name, code: s.code, color: s.color })

export function list(ctx: Ctx) {
  return prisma.subject.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.subject.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Subject')
  return row
}

async function teachersOf(subjectId: string) {
  const rows = await prisma.classSubject.findMany({ where: { subjectId }, select: { teacherId: true } })
  return rows.map(r => r.teacherId).filter((x): x is string => !!x)
}

export async function create(ctx: Ctx, input: z.infer<typeof createSubject>) {
  const row = await prisma.subject.create({ data: { schoolId: ctx.schoolId, ...input } })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'subject', row.id, undefined, serializeSubject(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchSubject>) {
  const before = await get(ctx, id)
  const row = await prisma.subject.update({ where: { id }, data: input })
  if (input.name && input.name !== before.name) await syncLegacyUserFields(await teachersOf(id))
  await audit(ctx.schoolId, ctx.actorId, 'update', 'subject', id, serializeSubject(before), serializeSubject(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  const affected = await teachersOf(id)
  await prisma.subject.delete({ where: { id } })
  await syncLegacyUserFields(affected)
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'subject', id, serializeSubject(before))
}
