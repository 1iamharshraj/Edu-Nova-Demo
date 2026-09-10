import type { WorkingDayPattern } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { createWorkingDayPattern, patchWorkingDayPattern } from './schema'

export const serializeWorkingDayPattern = (p: WorkingDayPattern) => ({
  id: p.id,
  academicYearId: p.academicYearId,
  workingDays: p.workingDays as string[],
  saturdayPattern: p.saturdayPattern,
})

export function list(ctx: Ctx, filter?: { academicYearId?: string }) {
  return prisma.workingDayPattern.findMany({ where: { schoolId: ctx.schoolId, academicYearId: filter?.academicYearId }, orderBy: [{ createdAt: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.workingDayPattern.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Working day pattern')
  return row
}

// One row per (school, academic year) — see schema.prisma's @@unique([schoolId, academicYearId]).
export async function create(ctx: Ctx, input: z.infer<typeof createWorkingDayPattern>) {
  if (!(await prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId: ctx.schoolId } }))) throw notFound('Academic year')
  const dup = await prisma.workingDayPattern.findFirst({ where: { schoolId: ctx.schoolId, academicYearId: input.academicYearId } })
  if (dup) throw new HttpError(409, 'A working-day pattern already exists for this academic year — use PATCH to change it', { id: dup.id })
  const row = await prisma.workingDayPattern.create({
    data: { schoolId: ctx.schoolId, academicYearId: input.academicYearId, workingDays: input.workingDays, saturdayPattern: input.saturdayPattern },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'workingDayPattern', row.id, undefined, serializeWorkingDayPattern(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchWorkingDayPattern>) {
  const before = await get(ctx, id)
  const row = await prisma.workingDayPattern.update({ where: { id }, data: input })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'workingDayPattern', id, serializeWorkingDayPattern(before), serializeWorkingDayPattern(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.workingDayPattern.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'workingDayPattern', id, serializeWorkingDayPattern(before))
}
