import type { PeriodTemplate } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { createPeriodTemplate, patchPeriodTemplate, periodDef, createPeriodTemplateOverride, patchPeriodTemplateOverride } from './schema'

export type PeriodDef = z.infer<typeof periodDef>

export const serializePeriodTemplate = (t: PeriodTemplate) => ({
  id: t.id,
  name: t.name,
  isDefault: t.isDefault,
  periods: (t.periods as PeriodDef[]).slice().sort((a, b) => a.idx - b.idx),
})

// Phase T1 §5 — a day-specific override row, serialized separately from the base shape above so the base
// GET /period-templates response stays byte-identical to before this phase (see schema.prisma's
// PeriodTemplate comment for the base/override model).
export const serializePeriodTemplateOverride = (t: PeriodTemplate) => ({
  id: t.id,
  baseTemplateId: t.baseTemplateId,
  dayOfWeek: t.dayOfWeek,
  name: t.name,
  periods: (t.periods as PeriodDef[]).slice().sort((a, b) => a.idx - b.idx),
})

// BASE templates only (dayOfWeek null) — this is what Class.periodTemplateId picks from, and what every
// pre-T1 consumer (bootstrap, the class-creation picker, autogen) already expects. Override rows are
// fetched separately via listOverrides.
export function list(ctx: Ctx) {
  return prisma.periodTemplate.findMany({ where: { schoolId: ctx.schoolId, dayOfWeek: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
}

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.periodTemplate.findFirst({ where: { id, schoolId: ctx.schoolId, dayOfWeek: null } })
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

// Phase T1 §5 — the periods a class actually follows on a given day of week: the day-specific override for
// `baseTemplateId` if one exists, else the base template's own flat `periods`. Not called from any existing
// code path yet (T1 is data-model only, per the roadmap) — this is what T4/T6 generation will call.
export async function resolveForDay(schoolId: string, baseTemplateId: string, dayOfWeek: number) {
  const override = await prisma.periodTemplate.findFirst({ where: { schoolId, baseTemplateId, dayOfWeek } })
  if (override) return override
  return prisma.periodTemplate.findFirst({ where: { id: baseTemplateId, schoolId, dayOfWeek: null } })
}

export async function create(ctx: Ctx, input: z.infer<typeof createPeriodTemplate>) {
  const count = await prisma.periodTemplate.count({ where: { schoolId: ctx.schoolId, dayOfWeek: null } })
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
    // Overrides cascade automatically (onDelete: Cascade on baseTemplateId), but this reads more clearly
    // as an explicit step given the "add reset-cleanup for every new table" ground rule elsewhere.
    await tx.periodTemplate.deleteMany({ where: { baseTemplateId: id } })
    await tx.periodTemplate.delete({ where: { id } })
    if (before.isDefault) {
      // Keep the "exactly one default" invariant: promote the oldest remaining base template.
      const next = await tx.periodTemplate.findFirst({ where: { schoolId: ctx.schoolId, dayOfWeek: null }, orderBy: { createdAt: 'asc' } })
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

// ─────────────────────────────── Phase T1 §5 — day-of-week overrides ───────────────────────────────

export function listOverrides(ctx: Ctx, baseTemplateId: string) {
  return prisma.periodTemplate.findMany({ where: { schoolId: ctx.schoolId, baseTemplateId }, orderBy: [{ dayOfWeek: 'asc' }] })
}

async function getOverride(ctx: Ctx, id: string) {
  const row = await prisma.periodTemplate.findFirst({ where: { id, schoolId: ctx.schoolId, dayOfWeek: { not: null } } })
  if (!row) throw notFound('Period template override')
  return row
}

export async function createOverride(ctx: Ctx, input: z.infer<typeof createPeriodTemplateOverride>) {
  const base = await get(ctx, input.baseTemplateId) // throws 404 if missing or not a base template
  const dup = await prisma.periodTemplate.findFirst({ where: { schoolId: ctx.schoolId, baseTemplateId: base.id, dayOfWeek: input.dayOfWeek } })
  if (dup) throw new HttpError(409, `An override for day ${input.dayOfWeek} already exists on this template`, { overrideId: dup.id })
  const row = await prisma.periodTemplate.create({
    data: { schoolId: ctx.schoolId, name: input.name, periods: input.periods, baseTemplateId: base.id, dayOfWeek: input.dayOfWeek, isDefault: false },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'periodTemplateOverride', row.id, undefined, serializePeriodTemplateOverride(row))
  return row
}

export async function updateOverride(ctx: Ctx, id: string, input: z.infer<typeof patchPeriodTemplateOverride>) {
  const before = await getOverride(ctx, id)
  const row = await prisma.periodTemplate.update({ where: { id }, data: { name: input.name, periods: input.periods } })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'periodTemplateOverride', id, serializePeriodTemplateOverride(before), serializePeriodTemplateOverride(row))
  return row
}

export async function removeOverride(ctx: Ctx, id: string) {
  const before = await getOverride(ctx, id)
  await prisma.periodTemplate.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'periodTemplateOverride', id, serializePeriodTemplateOverride(before))
}
