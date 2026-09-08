import type { z } from 'zod'
import type { StaffConductRecord } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { assertFileIds } from '../files/service'
import { EMPLOYEE_ROLES } from '../../userDefaults'
import { CONDUCT_STATUSES } from './schema'
import type { createConduct, patchConduct, conductQuery } from './schema'

// See phase-11-employee-management.md → A5. Deliberately NOT the student DisciplinaryCase model
// (different visibility rules/actors — see that module). Every endpoint here is gated
// `requireRole('admin', 'superadmin')` at the router — this service assumes that has already run, so it
// does not re-check isAdmin/isStaff itself; it is strictly more restrictive than the employee's manager
// or the employee themselves (a deliberate, more restrictive default than student discipline — see the
// Phase 11 server report for the rationale and how to revisit it).

export const serializeConduct = (c: StaffConductRecord) => ({
  id: c.id,
  employeeId: c.employeeId,
  reportedById: c.reportedById,
  title: c.title,
  description: c.description,
  category: c.category,
  status: c.status,
  actionTaken: c.actionTaken ?? undefined,
  fileIds: c.fileIds,
  createdAt: c.createdAt.toISOString(),
  resolvedAt: c.resolvedAt?.toISOString(),
  resolvedById: c.resolvedById ?? undefined,
})

export async function listConduct(ctx: Ctx, q: z.infer<typeof conductQuery>) {
  return prisma.staffConductRecord.findMany({
    where: { schoolId: ctx.schoolId, employeeId: q.employeeId },
    orderBy: [{ createdAt: 'desc' }],
  })
}

export async function getConduct(ctx: Ctx, id: string) {
  const row = await prisma.staffConductRecord.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Staff conduct record')
  return row
}

export async function createConductRow(ctx: Ctx, input: z.infer<typeof createConduct>) {
  const employee = await prisma.user.findFirst({ where: { id: input.employeeId, schoolId: ctx.schoolId, role: { in: EMPLOYEE_ROLES } } })
  if (!employee) throw notFound('Employee')
  if (input.fileIds?.length) await assertFileIds(ctx, input.fileIds)
  const row = await prisma.staffConductRecord.create({
    data: {
      schoolId: ctx.schoolId, employeeId: employee.id, reportedById: ctx.actorId, title: input.title,
      description: input.description, category: input.category, fileIds: input.fileIds ?? [], status: 'Reported',
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'staffConductRecord', row.id, undefined, serializeConduct(row))
  return row
}

// Reported -> UnderReview -> Resolved. Forward-only (no reopening a Resolved case, no skipping backward);
// jumping straight Reported -> Resolved is allowed (small cases don't always need a review step).
export async function updateConduct(ctx: Ctx, id: string, input: z.infer<typeof patchConduct>) {
  const before = await prisma.staffConductRecord.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Staff conduct record')
  if (input.status) {
    const fromIdx = CONDUCT_STATUSES.indexOf(before.status as (typeof CONDUCT_STATUSES)[number])
    const toIdx = CONDUCT_STATUSES.indexOf(input.status)
    if (toIdx < fromIdx) throw new HttpError(409, `Cannot move status backward from ${before.status} to ${input.status}`)
  }
  const resolving = input.status === 'Resolved' && before.status !== 'Resolved'
  const row = await prisma.staffConductRecord.update({
    where: { id },
    data: {
      status: input.status, actionTaken: input.actionTaken,
      ...(resolving ? { resolvedAt: new Date(), resolvedById: ctx.actorId } : {}),
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'staffConductRecord', id, serializeConduct(before), serializeConduct(row))
  return row
}
