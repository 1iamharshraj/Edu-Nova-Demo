import type { Term } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import { fmtDate, toDate } from '../../lib/validate'
import type { Ctx } from '../../lib/rbac'
import { createTerm, patchTerm } from './schema'

export const serializeTerm = (t: Term) => ({
  id: t.id,
  academicYearId: t.academicYearId,
  name: t.name,
  startDate: fmtDate(t.startDate),
  endDate: fmtDate(t.endDate),
  isCurrent: t.isCurrent,
})

export function list(ctx: Ctx) {
  return prisma.term.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }] })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.term.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Term')
  return row
}

async function assertYear(ctx: Ctx, academicYearId: string) {
  const y = await prisma.academicYear.findFirst({ where: { id: academicYearId, schoolId: ctx.schoolId } })
  if (!y) throw notFound('Academic year')
}

export async function create(ctx: Ctx, input: z.infer<typeof createTerm>) {
  await assertYear(ctx, input.academicYearId)
  // A school always has an active term once it has one: the first term created becomes current.
  const hasCurrent = await prisma.term.count({ where: { schoolId: ctx.schoolId, isCurrent: true } })
  const row = await prisma.term.create({
    data: {
      schoolId: ctx.schoolId,
      academicYearId: input.academicYearId,
      name: input.name,
      startDate: toDate(input.startDate),
      endDate: toDate(input.endDate),
      isCurrent: hasCurrent === 0,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'term', row.id, undefined, serializeTerm(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchTerm>) {
  const before = await get(ctx, id)
  if (input.academicYearId) await assertYear(ctx, input.academicYearId)
  const row = await prisma.term.update({
    where: { id },
    data: {
      academicYearId: input.academicYearId,
      name: input.name,
      startDate: input.startDate ? toDate(input.startDate) : undefined,
      endDate: input.endDate ? toDate(input.endDate) : undefined,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'term', id, serializeTerm(before), serializeTerm(row))
  return row
}

export async function setCurrent(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  const [, row] = await prisma.$transaction([
    prisma.term.updateMany({ where: { schoolId: ctx.schoolId, isCurrent: true }, data: { isCurrent: false } }),
    prisma.term.update({ where: { id }, data: { isCurrent: true } }),
  ])
  await audit(ctx.schoolId, ctx.actorId, 'set-current', 'term', id, serializeTerm(before), serializeTerm(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.term.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'term', id, serializeTerm(before))
}
