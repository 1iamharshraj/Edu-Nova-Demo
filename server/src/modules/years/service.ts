import type { AcademicYear } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import { fmtDate, toDate } from '../../lib/validate'
import type { Ctx } from '../../lib/rbac'
import { syncLegacyUserFields, usersTouchingClasses } from '../../lib/legacySync'
import { createYear, patchYear } from './schema'

export const serializeYear = (y: AcademicYear) => ({
  id: y.id,
  label: y.label,
  startDate: fmtDate(y.startDate),
  endDate: fmtDate(y.endDate),
  isCurrent: y.isCurrent,
})

export function list(ctx: Ctx) {
  return prisma.academicYear.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.academicYear.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Academic year')
  return row
}

export async function create(ctx: Ctx, input: z.infer<typeof createYear>) {
  const count = await prisma.academicYear.count({ where: { schoolId: ctx.schoolId } })
  const row = await prisma.academicYear.create({
    data: {
      schoolId: ctx.schoolId,
      label: input.label,
      startDate: toDate(input.startDate),
      endDate: toDate(input.endDate),
      isCurrent: count === 0,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'year', row.id, undefined, serializeYear(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchYear>) {
  const before = await get(ctx, id)
  const row = await prisma.academicYear.update({
    where: { id },
    data: {
      label: input.label,
      startDate: input.startDate ? toDate(input.startDate) : undefined,
      endDate: input.endDate ? toDate(input.endDate) : undefined,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'year', id, serializeYear(before), serializeYear(row))
  return row
}

export async function setCurrent(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  const [, row] = await prisma.$transaction([
    prisma.academicYear.updateMany({ where: { schoolId: ctx.schoolId, isCurrent: true }, data: { isCurrent: false } }),
    prisma.academicYear.update({ where: { id }, data: { isCurrent: true } }),
  ])
  // Which enrollment counts as "current" changed for every student in the school.
  const classes = await prisma.class.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true } })
  await syncLegacyUserFields(await usersTouchingClasses(classes.map(c => c.id)))
  await audit(ctx.schoolId, ctx.actorId, 'set-current', 'year', id, serializeYear(before), serializeYear(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  const classes = await prisma.class.findMany({ where: { academicYearId: id }, select: { id: true } })
  const affected = await usersTouchingClasses(classes.map(c => c.id))
  await prisma.academicYear.delete({ where: { id } })
  await syncLegacyUserFields(affected)
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'year', id, serializeYear(before))
}
