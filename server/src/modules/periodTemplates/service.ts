import type { PeriodTemplate } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { createPeriodTemplate, patchPeriodTemplate, periodDef } from './schema'

export type PeriodDef = z.infer<typeof periodDef>

export const serializePeriodTemplate = (t: PeriodTemplate) => ({
  id: t.id,
  name: t.name,
  isDefault: t.isDefault,
  periods: (t.periods as PeriodDef[]).slice().sort((a, b) => a.idx - b.idx),
})

export function list(ctx: Ctx) {
  return prisma.periodTemplate.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
}

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.periodTemplate.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Period template')
  return row
}

// The template a class actually uses: its own override, else the school default, else null.
export async function effectiveTemplate(schoolId: string, periodTemplateId?: string | null) {
  if (periodTemplateId) {
    const own = await prisma.periodTemplate.findFirst({ where: { id: periodTemplateId, schoolId } })
    if (own) return own
  }
  return prisma.periodTemplate.findFirst({ where: { schoolId, isDefault: true }, orderBy: { createdAt: 'asc' } })
}

export async function create(ctx: Ctx, input: z.infer<typeof createPeriodTemplate>) {
  const count = await prisma.periodTemplate.count({ where: { schoolId: ctx.schoolId } })
  const isDefault = count === 0 || !!input.isDefault
  const row = await prisma.$transaction(async tx => {
    if (isDefault) await tx.periodTemplate.updateMany({ where: { schoolId: ctx.schoolId, isDefault: true }, data: { isDefault: false } })
    return tx.periodTemplate.create({ data: { schoolId: ctx.schoolId, name: input.name, periods: input.periods, isDefault } })
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'periodTemplate', row.id, undefined, serializePeriodTemplate(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchPeriodTemplate>) {
  const before = await get(ctx, id)
  if (input.isDefault === false && before.isDefault) throw new HttpError(400, 'Set another template as default instead of unsetting this one')
  const row = await prisma.$transaction(async tx => {
    if (input.isDefault) await tx.periodTemplate.updateMany({ where: { schoolId: ctx.schoolId, isDefault: true, id: { not: id } }, data: { isDefault: false } })
    return tx.periodTemplate.update({ where: { id }, data: { name: input.name, periods: input.periods, isDefault: input.isDefault } })
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'periodTemplate', id, serializePeriodTemplate(before), serializePeriodTemplate(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  if (before.isDefault) {
    const inUse = await prisma.timetableEntry.count({ where: { schoolId: ctx.schoolId } })
    if (inUse) throw new HttpError(409, 'Cannot delete the default period template while timetable entries exist', { entries: inUse })
  }
  await prisma.$transaction(async tx => {
    await tx.periodTemplate.delete({ where: { id } })
    if (before.isDefault) {
      // Keep the "exactly one default" invariant: promote the oldest remaining template.
      const next = await tx.periodTemplate.findFirst({ where: { schoolId: ctx.schoolId }, orderBy: { createdAt: 'asc' } })
      if (next) await tx.periodTemplate.update({ where: { id: next.id }, data: { isDefault: true } })
    }
  })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'periodTemplate', id, serializePeriodTemplate(before))
}

export async function setDefault(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  const row = await prisma.$transaction(async tx => {
    await tx.periodTemplate.updateMany({ where: { schoolId: ctx.schoolId, isDefault: true }, data: { isDefault: false } })
    return tx.periodTemplate.update({ where: { id }, data: { isDefault: true } })
  })
  await audit(ctx.schoolId, ctx.actorId, 'set-default', 'periodTemplate', id, serializePeriodTemplate(before), serializePeriodTemplate(row))
  return row
}
