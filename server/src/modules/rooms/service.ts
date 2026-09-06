import type { Room } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { createRoom, patchRoom } from './schema'

export const serializeRoom = (r: Room) => ({ id: r.id, name: r.name, kind: r.kind, capacity: r.capacity ?? undefined })

export function list(ctx: Ctx) {
  return prisma.room.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }, { name: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.room.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Room')
  return row
}

export async function create(ctx: Ctx, input: z.infer<typeof createRoom>) {
  const row = await prisma.room.create({ data: { schoolId: ctx.schoolId, ...input } })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'room', row.id, undefined, serializeRoom(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchRoom>) {
  const before = await get(ctx, id)
  const row = await prisma.room.update({ where: { id }, data: input })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'room', id, serializeRoom(before), serializeRoom(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.room.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'room', id, serializeRoom(before))
}
