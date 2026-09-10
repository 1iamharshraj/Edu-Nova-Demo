import type { Capability } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { createCapability, patchCapability } from './schema'

export const serializeCapability = (c: Capability) => ({ id: c.id, name: c.name, code: c.code })

export function list(ctx: Ctx) {
  return prisma.capability.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.capability.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Capability')
  return row
}

async function assertUniqueCode(ctx: Ctx, code: string, exceptId?: string) {
  const dup = await prisma.capability.findFirst({ where: { schoolId: ctx.schoolId, code, ...(exceptId ? { id: { not: exceptId } } : {}) } })
  if (dup) throw new HttpError(409, `Capability code "${code}" already exists`, { capabilityId: dup.id })
}

export async function create(ctx: Ctx, input: z.infer<typeof createCapability>) {
  await assertUniqueCode(ctx, input.code)
  const row = await prisma.capability.create({ data: { schoolId: ctx.schoolId, ...input } })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'capability', row.id, undefined, serializeCapability(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchCapability>) {
  const before = await get(ctx, id)
  if (input.code) await assertUniqueCode(ctx, input.code, id)
  const row = await prisma.capability.update({ where: { id }, data: input })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'capability', id, serializeCapability(before), serializeCapability(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.capability.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'capability', id, serializeCapability(before))
}

// Default catalog, seeded on demand (POST /capabilities/seed-defaults) — mirrors phase-t1's suggested
// starter set. Skips codes that already exist so it's safe to call more than once.
export const DEFAULT_CAPABILITIES: Array<{ name: string; code: string }> = [
  { name: 'Physics Lab', code: 'PHYSICS_LAB' },
  { name: 'Chemistry Lab', code: 'CHEMISTRY_LAB' },
  { name: 'Biology Lab', code: 'BIOLOGY_LAB' },
  { name: 'Computer Lab', code: 'COMPUTER_LAB' },
  { name: 'Projector', code: 'PROJECTOR' },
  { name: 'Smart Board', code: 'SMART_BOARD' },
  { name: 'Audio System', code: 'AUDIO_SYSTEM' },
]

export async function seedDefaults(ctx: Ctx) {
  const existing = new Set((await list(ctx)).map(c => c.code))
  const missing = DEFAULT_CAPABILITIES.filter(c => !existing.has(c.code))
  for (const c of missing) await create(ctx, c)
  return missing.length
}
