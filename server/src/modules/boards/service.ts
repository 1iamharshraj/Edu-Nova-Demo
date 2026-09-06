import type { Board } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { syncLegacyUserFields, usersTouchingClasses } from '../../lib/legacySync'
import { createBoard, patchBoard } from './schema'

export const serializeBoard = (b: Board) => ({ id: b.id, name: b.name, code: b.code })

export function list(ctx: Ctx) {
  return prisma.board.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }, { code: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.board.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Board')
  return row
}

// Students of this board's classes carry `user.board` = code, so a code change / delete touches them.
async function classIdsOf(boardId: string) {
  const rows = await prisma.class.findMany({ where: { boardId }, select: { id: true } })
  return rows.map(r => r.id)
}

export async function create(ctx: Ctx, input: z.infer<typeof createBoard>) {
  const row = await prisma.board.create({ data: { schoolId: ctx.schoolId, ...input } })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'board', row.id, undefined, serializeBoard(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchBoard>) {
  const before = await get(ctx, id)
  const row = await prisma.board.update({ where: { id }, data: input })
  if (input.code && input.code !== before.code) await syncLegacyUserFields(await usersTouchingClasses(await classIdsOf(id)))
  await audit(ctx.schoolId, ctx.actorId, 'update', 'board', id, serializeBoard(before), serializeBoard(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  const affected = await usersTouchingClasses(await classIdsOf(id))
  await prisma.board.delete({ where: { id } })
  await syncLegacyUserFields(affected)
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'board', id, serializeBoard(before))
}
