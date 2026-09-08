import type { z } from 'zod'
import type { PerformanceReview } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { isAdmin } from '../../lib/scope'
import { EMPLOYEE_ROLES } from '../../userDefaults'
import type { createReview, patchReview, acknowledgeBody, employeeCommentsBody, reviewsQuery } from './schema'

// See phase-11-employee-management.md → A3.
//
// Workflow: Draft (reviewer/HR create + edit) -> Shared (employee can now see it and add
// employeeComments) -> Acknowledged (locked for both sides). The reviewer/HR can see a review at every
// stage; the employee only once it is Shared or Acknowledged.

export const serializeReview = (r: PerformanceReview) => ({
  id: r.id,
  employeeId: r.employeeId,
  reviewerId: r.reviewerId,
  cycle: r.cycle,
  periodStart: fmtDate(r.periodStart),
  periodEnd: fmtDate(r.periodEnd),
  overallRating: r.overallRating,
  strengths: r.strengths,
  areasForImprovement: r.areasForImprovement,
  goals: r.goals,
  employeeComments: r.employeeComments ?? undefined,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  sharedAt: r.sharedAt?.toISOString(),
  acknowledgedAt: r.acknowledgedAt?.toISOString(),
})

// 'self' (own review, Shared/Acknowledged only), 'manager' (their direct report — full visibility, same
// as HR), or 'admin' (HR/admin — full visibility, any employee). Throws if none apply.
type Relation = 'self' | 'manager' | 'admin'

async function relationTo(ctx: Ctx, employeeId: string): Promise<Relation> {
  if (isAdmin(ctx)) return 'admin'
  if (ctx.actorId === employeeId) return 'self'
  const employee = await prisma.user.findFirst({ where: { id: employeeId, schoolId: ctx.schoolId }, select: { reportsTo: true } })
  if (employee?.reportsTo === ctx.actorId) return 'manager'
  throw new HttpError(403, 'You are not permitted to view this employee’s reviews')
}

async function directReportIds(ctx: Ctx): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { schoolId: ctx.schoolId, reportsTo: ctx.actorId }, select: { id: true } })
  return rows.map(r => r.id)
}

export async function getReview(ctx: Ctx, id: string) {
  const row = await prisma.performanceReview.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Performance review')
  const relation = await relationTo(ctx, row.employeeId)
  if (relation === 'self' && row.status === 'Draft') throw new HttpError(403, 'This review has not been shared with you yet')
  return row
}

export async function listReviews(ctx: Ctx, q: z.infer<typeof reviewsQuery>) {
  if (q.employeeId) {
    const relation = await relationTo(ctx, q.employeeId)
    return prisma.performanceReview.findMany({
      where: { schoolId: ctx.schoolId, employeeId: q.employeeId, status: relation === 'self' ? { not: 'Draft' } : undefined },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    })
  }
  if (isAdmin(ctx)) {
    return prisma.performanceReview.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }] })
  }
  const reports = await directReportIds(ctx)
  return prisma.performanceReview.findMany({
    where: {
      schoolId: ctx.schoolId,
      OR: [
        { employeeId: ctx.actorId, status: { not: 'Draft' } },
        ...(reports.length ? [{ employeeId: { in: reports } }] : []),
        { reviewerId: ctx.actorId },
      ],
    },
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
  })
}

export async function createReviewRow(ctx: Ctx, input: z.infer<typeof createReview>) {
  const employee = await prisma.user.findFirst({ where: { id: input.employeeId, schoolId: ctx.schoolId, role: { in: EMPLOYEE_ROLES } } })
  if (!employee) throw notFound('Employee')
  if (!isAdmin(ctx) && employee.reportsTo !== ctx.actorId) {
    throw new HttpError(403, 'Only HR/admin or the employee’s manager may create a review')
  }
  if (input.periodEnd < input.periodStart) throw new HttpError(400, 'periodEnd cannot be before periodStart')
  const row = await prisma.performanceReview.create({
    data: {
      schoolId: ctx.schoolId, employeeId: employee.id, reviewerId: ctx.actorId, cycle: input.cycle,
      periodStart: toDate(input.periodStart), periodEnd: toDate(input.periodEnd), overallRating: input.overallRating,
      strengths: input.strengths, areasForImprovement: input.areasForImprovement, goals: input.goals, status: 'Draft',
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'performanceReview', row.id, undefined, serializeReview(row))
  return row
}

function assertReviewerOrAdmin(ctx: Ctx, row: PerformanceReview) {
  if (isAdmin(ctx) || ctx.actorId === row.reviewerId) return
  throw new HttpError(403, 'Only the reviewer or HR/admin may edit this review')
}

export async function updateReview(ctx: Ctx, id: string, input: z.infer<typeof patchReview>) {
  const before = await prisma.performanceReview.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Performance review')
  assertReviewerOrAdmin(ctx, before)
  if (before.status !== 'Draft') throw new HttpError(409, 'Only a Draft review may be edited')
  if (input.periodStart && input.periodEnd && input.periodEnd < input.periodStart) throw new HttpError(400, 'periodEnd cannot be before periodStart')
  const row = await prisma.performanceReview.update({
    where: { id },
    data: {
      cycle: input.cycle, periodStart: input.periodStart ? toDate(input.periodStart) : undefined,
      periodEnd: input.periodEnd ? toDate(input.periodEnd) : undefined, overallRating: input.overallRating,
      strengths: input.strengths, areasForImprovement: input.areasForImprovement, goals: input.goals,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'performanceReview', id, serializeReview(before), serializeReview(row))
  return row
}

export async function shareReview(ctx: Ctx, id: string) {
  const before = await prisma.performanceReview.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Performance review')
  assertReviewerOrAdmin(ctx, before)
  if (before.status !== 'Draft') throw new HttpError(409, `Review is already ${before.status.toLowerCase()}`)
  const row = await prisma.performanceReview.update({ where: { id }, data: { status: 'Shared', sharedAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'share', 'performanceReview', id, serializeReview(before), serializeReview(row))
  return row
}

// Employee-only: add/replace their own comments while the review is Shared (not yet Acknowledged).
export async function addEmployeeComments(ctx: Ctx, id: string, input: z.infer<typeof employeeCommentsBody>) {
  const before = await prisma.performanceReview.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Performance review')
  if (before.employeeId !== ctx.actorId) throw new HttpError(403, 'Only the reviewed employee may add comments')
  if (before.status !== 'Shared') throw new HttpError(409, `Comments can only be added while the review is Shared (currently ${before.status})`)
  const row = await prisma.performanceReview.update({ where: { id }, data: { employeeComments: input.employeeComments } })
  await audit(ctx.schoolId, ctx.actorId, 'comment', 'performanceReview', id, serializeReview(before), serializeReview(row))
  return row
}

// Employee-only: locks the review. May optionally carry final employeeComments in the same call.
export async function acknowledgeReview(ctx: Ctx, id: string, input: z.infer<typeof acknowledgeBody>) {
  const before = await prisma.performanceReview.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Performance review')
  if (before.employeeId !== ctx.actorId) throw new HttpError(403, 'Only the reviewed employee may acknowledge this review')
  if (before.status !== 'Shared') throw new HttpError(409, `Review must be Shared before it can be acknowledged (currently ${before.status})`)
  const row = await prisma.performanceReview.update({
    where: { id },
    data: { status: 'Acknowledged', acknowledgedAt: new Date(), employeeComments: input.employeeComments ?? before.employeeComments },
  })
  await audit(ctx.schoolId, ctx.actorId, 'acknowledge', 'performanceReview', id, serializeReview(before), serializeReview(row))
  return row
}
