// Mirrors server/src/modules/reviews/{router,service}.ts → A3 (phase-11-employee-management.md).
// Workflow: Draft (reviewer/HR create + edit) -> Shared (employee can see it, add employeeComments) ->
// Acknowledged (locked). The reviewer/HR can see a review at every stage; the employee only once Shared
// or Acknowledged.

import { route, requireAuth, status } from '../router'
import { notFound, forbidden, badRequest, conflict } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const ADMIN_ROLES = new Set(['admin', 'superadmin'])
const EMPLOYEE_ROLES = new Set(['teacher', 'staff', 'admin', 'superadmin'])
const isAdmin = (role: string) => ADMIN_ROLES.has(role)

type Relation = 'self' | 'manager' | 'admin'

function relationTo(actor: { userId: string; role: string; schoolId: string }, employeeId: string): Relation {
  if (isAdmin(actor.role)) return 'admin'
  if (actor.userId === employeeId) return 'self'
  const employee = table('User').find(u => u.id === employeeId && u.schoolId === actor.schoolId)
  if (employee?.reportsTo === actor.userId) return 'manager'
  throw forbidden('You are not permitted to view this employee’s reviews')
}

function directReportIds(actor: { userId: string; schoolId: string }): string[] {
  return table('User').filter(u => u.schoolId === actor.schoolId && u.reportsTo === actor.userId).map(u => u.id)
}

function serializeReview(r: Row) {
  const employee = table('User').find(u => u.id === r.employeeId)
  const reviewer = table('User').find(u => u.id === r.reviewerId)
  return {
    id: r.id, employeeId: r.employeeId, reviewerId: r.reviewerId, cycle: r.cycle, periodStart: r.periodStart, periodEnd: r.periodEnd,
    overallRating: r.overallRating, strengths: r.strengths, areasForImprovement: r.areasForImprovement, goals: r.goals,
    employeeComments: r.employeeComments ?? undefined, status: r.status, createdAt: r.createdAt, sharedAt: r.sharedAt ?? undefined,
    acknowledgedAt: r.acknowledgedAt ?? undefined, employeeName: employee?.name, reviewerName: reviewer?.name,
  }
}

function getReviewRow(actor: { userId: string; role: string; schoolId: string }, id: string) {
  const row = table('PerformanceReview').find(r => r.id === id && r.schoolId === actor.schoolId)
  if (!row) throw notFound('Performance review')
  const relation = relationTo(actor, String(row.employeeId))
  if (relation === 'self' && row.status === 'Draft') throw forbidden('This review has not been shared with you yet')
  return row
}

function assertReviewerOrAdmin(actor: { userId: string; role: string }, row: Row) {
  if (isAdmin(actor.role) || actor.userId === row.reviewerId) return
  throw forbidden('Only the reviewer or HR/admin may edit this review')
}

route('GET', '/reviews', (ctx) => {
  const actor = requireAuth(ctx)
  const { employeeId } = ctx.query
  let rows: Row[]
  if (employeeId) {
    const relation = relationTo(actor, employeeId)
    rows = table('PerformanceReview').filter(r => r.schoolId === actor.schoolId && r.employeeId === employeeId && (relation === 'self' ? r.status !== 'Draft' : true))
  } else if (isAdmin(actor.role)) {
    rows = table('PerformanceReview').filter(r => r.schoolId === actor.schoolId)
  } else {
    const reports = directReportIds(actor)
    rows = table('PerformanceReview').filter(r => r.schoolId === actor.schoolId && (
      (r.employeeId === actor.userId && r.status !== 'Draft') || reports.includes(String(r.employeeId)) || r.reviewerId === actor.userId
    ))
  }
  rows = [...rows].sort((a, b) => String(b.periodStart).localeCompare(String(a.periodStart)) || String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializeReview) }
})

route('POST', '/reviews', (ctx) => {
  const actor = requireAuth(ctx)
  const b = ctx.body as { employeeId: string; cycle: string; periodStart: string; periodEnd: string; overallRating: number; strengths: string; areasForImprovement: string; goals: string }
  const employee = table('User').find(u => u.id === b.employeeId && u.schoolId === actor.schoolId && EMPLOYEE_ROLES.has(String(u.role)))
  if (!employee) throw notFound('Employee')
  if (!isAdmin(actor.role) && employee.reportsTo !== actor.userId) throw forbidden('Only HR/admin or the employee’s manager may create a review')
  if (b.periodEnd < b.periodStart) throw badRequest('periodEnd cannot be before periodStart')
  const row: Row = { id: uid('review'), schoolId: actor.schoolId, employeeId: employee.id, reviewerId: actor.userId, cycle: b.cycle, periodStart: b.periodStart, periodEnd: b.periodEnd, overallRating: b.overallRating, strengths: b.strengths, areasForImprovement: b.areasForImprovement, goals: b.goals, employeeComments: null, status: 'Draft', createdAt: nowIso(), sharedAt: null, acknowledgedAt: null }
  const rows = table('PerformanceReview'); rows.push(row); saveTable('PerformanceReview', rows)
  return status(201, { item: serializeReview(row) })
})

route('GET', '/reviews/:id', (ctx) => {
  const actor = requireAuth(ctx)
  return { item: serializeReview(getReviewRow(actor, ctx.params.id)) }
})

route('PATCH', '/reviews/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('PerformanceReview')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Performance review')
  const before = rows[idx]
  assertReviewerOrAdmin(actor, before)
  if (before.status !== 'Draft') throw conflict('Only a Draft review may be edited')
  const b = ctx.body as Partial<{ cycle: string; periodStart: string; periodEnd: string; overallRating: number; strengths: string; areasForImprovement: string; goals: string }>
  if (b.periodStart && b.periodEnd && b.periodEnd < b.periodStart) throw badRequest('periodEnd cannot be before periodStart')
  rows[idx] = { ...before, ...b, updatedAt: nowIso() }
  saveTable('PerformanceReview', rows)
  return { item: serializeReview(rows[idx]) }
})

route('POST', '/reviews/:id/share', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('PerformanceReview')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Performance review')
  const before = rows[idx]
  assertReviewerOrAdmin(actor, before)
  if (before.status !== 'Draft') throw conflict(`Review is already ${String(before.status).toLowerCase()}`)
  rows[idx] = { ...before, status: 'Shared', sharedAt: nowIso() }
  saveTable('PerformanceReview', rows)

  const notifs = table('Notification')
  notifs.push({ id: uid('notif'), schoolId: actor.schoolId, userId: before.employeeId, kind: 'review', title: 'A performance review has been shared with you', body: `${before.cycle} review is ready for your comments.`, link: 'reviews', readAt: null, createdAt: nowIso() } as Row)
  saveTable('Notification', notifs)

  return { item: serializeReview(rows[idx]) }
})

route('PATCH', '/reviews/:id/comments', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('PerformanceReview')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Performance review')
  const before = rows[idx]
  if (before.employeeId !== actor.userId) throw forbidden('Only the reviewed employee may add comments')
  if (before.status !== 'Shared') throw conflict(`Comments can only be added while the review is Shared (currently ${before.status})`)
  const { employeeComments } = ctx.body as { employeeComments: string }
  rows[idx] = { ...before, employeeComments }
  saveTable('PerformanceReview', rows)
  return { item: serializeReview(rows[idx]) }
})

route('POST', '/reviews/:id/acknowledge', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('PerformanceReview')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Performance review')
  const before = rows[idx]
  if (before.employeeId !== actor.userId) throw forbidden('Only the reviewed employee may acknowledge this review')
  if (before.status !== 'Shared') throw conflict(`Review must be Shared before it can be acknowledged (currently ${before.status})`)
  const { employeeComments } = ctx.body as { employeeComments?: string }
  rows[idx] = { ...before, status: 'Acknowledged', acknowledgedAt: nowIso(), employeeComments: employeeComments ?? before.employeeComments }
  saveTable('PerformanceReview', rows)
  return { item: serializeReview(rows[idx]) }
})
