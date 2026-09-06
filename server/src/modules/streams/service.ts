import type { Stream } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { createStream, patchStream } from './schema'

export const serializeStream = (s: Stream) => ({ id: s.id, name: s.name })

export function list(ctx: Ctx) {
  return prisma.stream.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }, { name: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.stream.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Stream')
  return row
}

export async function create(ctx: Ctx, input: z.infer<typeof createStream>) {
  const row = await prisma.stream.create({ data: { schoolId: ctx.schoolId, ...input } })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'stream', row.id, undefined, serializeStream(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchStream>) {
  const before = await get(ctx, id)
  const row = await prisma.stream.update({ where: { id }, data: input })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'stream', id, serializeStream(before), serializeStream(row))
  return row
}

// Cascades CurriculumSubject rows; Class.streamId is set null (see schema).
export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.stream.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'stream', id, serializeStream(before))
}
