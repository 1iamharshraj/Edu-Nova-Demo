// Mirrors server/src/modules/staffConduct's contract: HR/admin-only conduct/performance/policy records
// against an employee. Deliberately NOT the student DisciplinaryCase model — different visibility (strictly
// admin/superadmin, never the employee or their manager). See .agents/edunova/static-demo-plan.md and
// phase-11-employee-management.md → A5.

import { route, requireRole, status, type ReqCtx } from '../router'
import { badRequest, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const EMPLOYEE_ROLES = ['teacher', 'staff', 'admin', 'superadmin']
const STATUSES = ['Reported', 'UnderReview', 'Resolved']

function nameOf(schoolId: string, id?: string | null): string | undefined {
  if (!id) return undefined
  return (table('User').find(u => u.id === id && u.schoolId === schoolId)?.name as string | undefined) ?? undefined
}

function serializeConduct(c: Row) {
  return {
    id: c.id, employeeId: c.employeeId, reportedById: c.reportedById, title: c.title, description: c.description,
    category: c.category, status: c.status, actionTaken: c.actionTaken ?? undefined, fileIds: (c.fileIds as string[] | undefined) ?? [],
    createdAt: c.createdAt, resolvedAt: c.resolvedAt ?? undefined, resolvedById: c.resolvedById ?? undefined,
    employeeName: nameOf(c.schoolId as string, c.employeeId as string), reportedByName: nameOf(c.schoolId as string, c.reportedById as string),
  }
}

route('GET', '/staff-conduct', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, 'admin', 'superadmin')
  const { employeeId } = ctx.query
  let rows = table('StaffConductRecord').filter(c => c.schoolId === actor.schoolId)
  if (employeeId) rows = rows.filter(c => c.employeeId === employeeId)
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializeConduct) }
})

route('GET', '/staff-conduct/:id', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, 'admin', 'superadmin')
  const row = table('StaffConductRecord').find(c => c.id === ctx.params.id && c.schoolId === actor.schoolId)
  if (!row) throw notFound('Staff conduct record')
  return { item: serializeConduct(row) }
})

route('POST', '/staff-conduct', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, 'admin', 'superadmin')
  const body = ctx.body as { employeeId?: string; title?: string; description?: string; category?: string; fileIds?: string[] }
  if (!body.employeeId) throw badRequest('employeeId is required')
  const employee = table('User').find(u => u.id === body.employeeId && u.schoolId === actor.schoolId && EMPLOYEE_ROLES.includes(u.role as string))
  if (!employee) throw notFound('Employee')
  if (!body.title?.trim() || !body.description?.trim() || !body.category) throw badRequest('title, description and category are required')
  const row: Row = {
    id: uid('staffconductrecord'), schoolId: actor.schoolId, employeeId: employee.id, reportedById: actor.userId,
    title: body.title.trim(), description: body.description.trim(), category: body.category, fileIds: body.fileIds ?? [],
    status: 'Reported', actionTaken: null, createdAt: nowIso(), resolvedAt: null, resolvedById: null,
  }
  const rows = table('StaffConductRecord')
  rows.push(row)
  saveTable('StaffConductRecord', rows)
  return status(201, { item: serializeConduct(row) })
})

// Reported -> UnderReview -> Resolved. Forward-only (no reopening a Resolved case, no skipping backward);
// jumping straight Reported -> Resolved is allowed (small cases don't always need a review step).
route('PATCH', '/staff-conduct/:id', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, 'admin', 'superadmin')
  const rows = table('StaffConductRecord')
  const idx = rows.findIndex(c => c.id === ctx.params.id && c.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Staff conduct record')
  const before = rows[idx]
  const body = ctx.body as { status?: string; actionTaken?: string }
  if (body.status) {
    if (!STATUSES.includes(body.status)) throw badRequest('Invalid status')
    const fromIdx = STATUSES.indexOf(before.status as string)
    const toIdx = STATUSES.indexOf(body.status)
    if (toIdx < fromIdx) throw badRequest(`Cannot move status backward from ${before.status} to ${body.status}`)
  }
  const resolving = body.status === 'Resolved' && before.status !== 'Resolved'
  rows[idx] = {
    ...before,
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.actionTaken !== undefined ? { actionTaken: body.actionTaken } : {}),
    ...(resolving ? { resolvedAt: nowIso(), resolvedById: actor.userId } : {}),
  }
  saveTable('StaffConductRecord', rows)
  return { item: serializeConduct(rows[idx]) }
})
