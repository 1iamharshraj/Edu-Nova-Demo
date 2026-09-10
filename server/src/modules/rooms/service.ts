import { Prisma, type Room } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { createRoom, patchRoom, setRoomCapabilities } from './schema'

export const roomInclude = { capabilities: { include: { capability: true } } } satisfies Prisma.RoomInclude
export type RoomWithCapabilities = Prisma.RoomGetPayload<{ include: typeof roomInclude }>

export const serializeRoom = (r: Room | RoomWithCapabilities) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  capacity: r.capacity ?? undefined,
  ...('capabilities' in r ? { capabilityIds: r.capabilities.map(c => c.capabilityId) } : {}),
})

export function list(ctx: Ctx) {
  return prisma.room.findMany({ where: { schoolId: ctx.schoolId }, include: roomInclude, orderBy: [{ createdAt: 'asc' }, { name: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.room.findFirst({ where: { id, schoolId: ctx.schoolId }, include: roomInclude })
  if (!row) throw notFound('Room')
  return row
}

async function assertCapabilities(ctx: Ctx, capabilityIds: string[]) {
  if (!capabilityIds.length) return
  const rows = await prisma.capability.findMany({ where: { id: { in: capabilityIds }, schoolId: ctx.schoolId } })
  if (rows.length !== new Set(capabilityIds).size) throw notFound('Capability')
}

export async function create(ctx: Ctx, input: z.infer<typeof createRoom>) {
  const { capabilityIds, ...rest } = input
  if (capabilityIds) await assertCapabilities(ctx, capabilityIds)
  const row = await prisma.room.create({
    data: { schoolId: ctx.schoolId, ...rest, capabilities: capabilityIds ? { create: capabilityIds.map(capabilityId => ({ capabilityId })) } : undefined },
    include: roomInclude,
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'room', row.id, undefined, serializeRoom(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchRoom>) {
  const before = await get(ctx, id)
  const { capabilityIds, ...rest } = input
  if (capabilityIds) await assertCapabilities(ctx, capabilityIds)
  const row = await prisma.$transaction(async tx => {
    if (capabilityIds) {
      await tx.roomCapability.deleteMany({ where: { roomId: id } })
      if (capabilityIds.length) await tx.roomCapability.createMany({ data: capabilityIds.map(capabilityId => ({ roomId: id, capabilityId })) })
    }
    return tx.room.update({ where: { id }, data: rest, include: roomInclude })
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'room', id, serializeRoom(before), serializeRoom(row))
  return row
}

// PUT /rooms/:id/capabilities — a dedicated set-replace endpoint for the capability multi-select UI, so it
// doesn't need to resend the room's other fields just to change capabilities.
export async function setCapabilities(ctx: Ctx, id: string, input: z.infer<typeof setRoomCapabilities>) {
  const before = await get(ctx, id)
  await assertCapabilities(ctx, input.capabilityIds)
  const row = await prisma.$transaction(async tx => {
    await tx.roomCapability.deleteMany({ where: { roomId: id } })
    if (input.capabilityIds.length) await tx.roomCapability.createMany({ data: input.capabilityIds.map(capabilityId => ({ roomId: id, capabilityId })) })
    return tx.room.findUniqueOrThrow({ where: { id }, include: roomInclude })
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'room', id, serializeRoom(before), serializeRoom(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.room.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'room', id, serializeRoom(before))
}
