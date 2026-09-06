import type { Grade } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { syncLegacyUserFields, usersTouchingClasses } from '../../lib/legacySync'
import { createGrade, patchGrade } from './schema'

export const serializeGrade = (g: Grade) => ({ id: g.id, label: g.label, order: g.order })

export function list(ctx: Ctx) {
  return prisma.grade.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.grade.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Grade')
  return row
}

// Class labels are `${grade.label}-${section}`, so a relabel / delete touches those classes' users.
async function classIdsOf(gradeId: string) {
  const rows = await prisma.class.findMany({ where: { gradeId }, select: { id: true } })
  return rows.map(r => r.id)
}

export async function create(ctx: Ctx, input: z.infer<typeof createGrade>) {
  let order = input.order
  if (order === undefined) {
    const max = await prisma.grade.aggregate({ where: { schoolId: ctx.schoolId }, _max: { order: true } })
    order = (max._max.order ?? 0) + 1
  }
  const row = await prisma.grade.create({ data: { schoolId: ctx.schoolId, label: input.label, order } })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'grade', row.id, undefined, serializeGrade(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchGrade>) {
  const before = await get(ctx, id)
  const row = await prisma.grade.update({ where: { id }, data: input })
  if (input.label && input.label !== before.label) await syncLegacyUserFields(await usersTouchingClasses(await classIdsOf(id)))
  await audit(ctx.schoolId, ctx.actorId, 'update', 'grade', id, serializeGrade(before), serializeGrade(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  const affected = await usersTouchingClasses(await classIdsOf(id))
  await prisma.grade.delete({ where: { id } })
  await syncLegacyUserFields(affected)
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'grade', id, serializeGrade(before))
}
