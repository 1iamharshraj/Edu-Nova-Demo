import type { Guardian } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { syncUserTitle } from '../../lib/titleSync'
import { assertStudent } from '../enrollments/service'
import { createGuardian } from './schema'

export const serializeGuardian = (g: Guardian) => ({
  id: g.id,
  parentId: g.parentId,
  studentId: g.studentId,
  relation: g.relation,
})

export function list(ctx: Ctx) {
  return prisma.guardian.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.guardian.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Guardian')
  return row
}

export async function assertParent(ctx: Ctx, parentId: string) {
  const p = await prisma.user.findFirst({ where: { id: parentId, schoolId: ctx.schoolId } })
  if (!p) throw notFound('Parent')
  if (p.role !== 'parent') throw new HttpError(400, 'parentId must reference a user with role parent')
  return p
}

export async function create(ctx: Ctx, input: z.infer<typeof createGuardian>) {
  await assertParent(ctx, input.parentId)
  await assertStudent(ctx, input.studentId)
  const row = await prisma.guardian.create({ data: { schoolId: ctx.schoolId, ...input } })
  await syncUserTitle([row.studentId, row.parentId])
  await audit(ctx.schoolId, ctx.actorId, 'create', 'guardian', row.id, undefined, serializeGuardian(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.guardian.delete({ where: { id } })
  await syncUserTitle([before.studentId, before.parentId])
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'guardian', id, serializeGuardian(before))
}
