// Mirrors server/src/modules/hr/{router,schema,service}.ts's contract for the endpoints
// src/lib/hooks/useHr.ts + src/portal/modules/hr.tsx + src/pages/portal/ContractDetail.tsx call:
// contracts (list/get/create/update/sign/end/pdf), resignations (list/submit/approve/decline/withdraw),
// duties (list/create/update/delete).

import { route, requireAuth, requireRole } from '../router'
import { badRequest, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const EMPLOYEE_ROLES = ['teacher', 'staff', 'admin', 'superadmin']
const ADMIN_ROLES = ['admin', 'superadmin']

function isAdmin(role: string) { return ADMIN_ROLES.includes(role) }
function isStaff(role: string) { return ['staff', ...ADMIN_ROLES].includes(role) }
function assertSelfOrAdmin(actorId: string, role: string, userId: string) {
  if (isAdmin(role) || actorId === userId) return
  throw badRequest('You may only view your own HR records')
}

function serializeContract(c: Row) {
  return {
    id: c.id, userId: c.userId, designation: c.designation, department: c.department ?? undefined,
    startDate: c.startDate, endDate: c.endDate ?? undefined, terms: c.terms, status: c.status,
    employeeSignedAt: c.employeeSignedAt ?? undefined, adminSignedAt: c.adminSignedAt ?? undefined,
    adminSignedById: c.adminSignedById ?? undefined, endedAt: c.endedAt ?? undefined, endReason: c.endReason ?? undefined,
    pdfFileId: c.pdfFileId ?? undefined, createdAt: c.createdAt,
    userName: (table('User').find(u => u.id === c.userId)?.name as string | undefined),
  }
}

function serializeResignation(r: Row) {
  const submittedAt = new Date(String(r.submittedAt)).getTime()
  const lastWorkingDate = new Date(String(r.lastWorkingDate)).getTime()
  return {
    id: r.id, userId: r.userId, reason: r.reason, submittedAt: r.submittedAt, lastWorkingDate: r.lastWorkingDate,
    status: r.status, decidedById: r.decidedById ?? undefined, decidedAt: r.decidedAt ?? undefined, notes: r.notes ?? undefined,
    noticeMet: Math.round((lastWorkingDate - submittedAt) / 86_400_000) >= 30,
    userName: (table('User').find(u => u.id === r.userId)?.name as string | undefined),
  }
}

function serializeDuty(d: Row) {
  return {
    id: d.id, title: d.title, eventTitle: d.eventTitle, eventDate: d.eventDate, assigneeId: d.assigneeId ?? undefined,
    createdById: d.createdById, status: d.status, notes: d.notes ?? undefined,
    assigneeName: d.assigneeId ? (table('User').find(u => u.id === d.assigneeId)?.name as string | undefined) : undefined,
  }
}

// ═══════════════════════════ contracts ═══════════════════════════

route('GET', '/hr/contracts', (ctx) => {
  const actor = requireAuth(ctx)
  if (ctx.query.userId) assertSelfOrAdmin(actor.userId, actor.role, ctx.query.userId)
  const userId = isAdmin(actor.role) ? ctx.query.userId : actor.userId
  let rows = table('Contract').filter(c => c.schoolId === actor.schoolId)
  if (userId) rows = rows.filter(c => c.userId === userId)
  if (ctx.query.status) rows = rows.filter(c => c.status === ctx.query.status)
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializeContract) }
})

route('POST', '/hr/contracts', (ctx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const body = ctx.body as { userId: string; designation: string; department?: string; startDate: string; endDate?: string; terms: string }
  const user = table('User').find(u => u.id === body.userId && u.schoolId === actor.schoolId && EMPLOYEE_ROLES.includes(String(u.role)))
  if (!user) throw notFound('Employee')
  const row: Row = {
    id: uid('contract'), schoolId: actor.schoolId, userId: body.userId, designation: body.designation, department: body.department ?? null,
    startDate: body.startDate, endDate: body.endDate ?? null, terms: body.terms, status: 'Draft', createdAt: nowIso(),
  }
  const rows = table('Contract'); rows.push(row); saveTable('Contract', rows)
  return { item: serializeContract(row) }
})

// A single route handles both `GET /hr/contracts/:id` and the PDF download `GET /hr/contracts/:id.pdf`
// (the router matches by segment count, so both land here) — downloadPath() in src/lib/api.ts falls back
// to a placeholder blob whenever the JSON body carries no `dataUrl`, same convention as modules/files.ts.
route('GET', '/hr/contracts/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const raw = ctx.params.id
  const wantsPdf = raw.endsWith('.pdf')
  const id = wantsPdf ? raw.slice(0, -4) : raw
  const row = table('Contract').find(c => c.id === id && c.schoolId === actor.schoolId)
  if (!row) throw notFound('Contract')
  assertSelfOrAdmin(actor.userId, actor.role, String(row.userId))
  return wantsPdf ? {} : { item: serializeContract(row) }
})

route('PATCH', '/hr/contracts/:id', (ctx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const rows = table('Contract')
  const idx = rows.findIndex(c => c.id === ctx.params.id && c.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Contract')
  if (rows[idx].status !== 'Draft') throw badRequest('Only a Draft contract may be edited')
  const body = ctx.body as Partial<{ designation: string; department: string; startDate: string; endDate: string | null; terms: string }>
  rows[idx] = { ...rows[idx], ...body }
  saveTable('Contract', rows)
  return { item: serializeContract(rows[idx]) }
})

route('POST', '/hr/contracts/:id/sign', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('Contract')
  const idx = rows.findIndex(c => c.id === ctx.params.id && c.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Contract')
  const before = rows[idx]
  if (before.status === 'Ended') throw badRequest('Contract has ended')
  const isEmployee = actor.userId === before.userId
  if (!isEmployee && !isAdmin(actor.role)) throw badRequest('Only the employee or an admin may sign this contract')
  const data: Partial<Row> = {}
  if (isEmployee) {
    if (before.employeeSignedAt) throw badRequest('You have already signed this contract')
    data.employeeSignedAt = nowIso()
  } else {
    if (before.adminSignedAt) throw badRequest('This contract has already been admin-signed')
    data.adminSignedAt = nowIso()
    data.adminSignedById = actor.userId
  }
  const employeeSignedAt = data.employeeSignedAt ?? before.employeeSignedAt
  const adminSignedAt = data.adminSignedAt ?? before.adminSignedAt
  if (employeeSignedAt && adminSignedAt) data.status = 'Active'
  rows[idx] = { ...before, ...data }
  saveTable('Contract', rows)
  return { item: serializeContract(rows[idx]) }
})

route('POST', '/hr/contracts/:id/end', (ctx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const rows = table('Contract')
  const idx = rows.findIndex(c => c.id === ctx.params.id && c.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Contract')
  if (rows[idx].status === 'Ended') throw badRequest('Contract has already ended')
  const body = ctx.body as { reason: string }
  rows[idx] = { ...rows[idx], status: 'Ended', endedAt: nowIso(), endReason: body.reason }
  saveTable('Contract', rows)
  return { item: serializeContract(rows[idx]) }
})

// ═══════════════════════════ resignations ═══════════════════════════

route('GET', '/hr/resignations', (ctx) => {
  const actor = requireAuth(ctx)
  const userId = isAdmin(actor.role) ? undefined : actor.userId
  let rows = table('Resignation').filter(r => r.schoolId === actor.schoolId)
  if (userId) rows = rows.filter(r => r.userId === userId)
  rows = [...rows].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))
  return { items: rows.map(serializeResignation) }
})

route('POST', '/hr/resignations', (ctx) => {
  const actor = requireAuth(ctx)
  if (!EMPLOYEE_ROLES.includes(actor.role)) throw badRequest('Only employees may submit a resignation')
  const existing = table('Resignation').find(r => r.schoolId === actor.schoolId && r.userId === actor.userId && r.status === 'Pending')
  if (existing) throw badRequest('You already have a pending resignation')
  const body = ctx.body as { reason: string; lastWorkingDate: string }
  const row: Row = {
    id: uid('resignation'), schoolId: actor.schoolId, userId: actor.userId, reason: body.reason,
    submittedAt: nowIso(), lastWorkingDate: body.lastWorkingDate, status: 'Pending',
  }
  const rows = table('Resignation'); rows.push(row); saveTable('Resignation', rows)
  return { item: serializeResignation(row) }
})

function assertResignationPending(row: Row) {
  if (row.status !== 'Pending') throw badRequest(`Resignation is already ${String(row.status).toLowerCase()}`)
}

route('POST', '/hr/resignations/:id/approve', (ctx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const rows = table('Resignation')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Resignation')
  assertResignationPending(rows[idx])
  const body = ctx.body as { notes?: string }
  const before = rows[idx]
  rows[idx] = { ...before, status: 'Approved', decidedById: actor.userId, decidedAt: nowIso(), notes: body.notes ?? null }
  saveTable('Resignation', rows)

  const contracts = table('Contract')
  let changed = false
  for (let i = 0; i < contracts.length; i++) {
    if (contracts[i].schoolId === actor.schoolId && contracts[i].userId === before.userId && ['Draft', 'Active'].includes(String(contracts[i].status))) {
      contracts[i] = { ...contracts[i], status: 'Ended', endedAt: nowIso(), endReason: 'Resignation approved' }
      changed = true
    }
  }
  if (changed) saveTable('Contract', contracts)

  if (new Date(String(before.lastWorkingDate)).getTime() <= Date.now()) {
    const users = table('User')
    const uidx = users.findIndex(u => u.id === before.userId)
    if (uidx !== -1) { users[uidx] = { ...users[uidx], active: false }; saveTable('User', users) }
  }
  return { item: serializeResignation(rows[idx]) }
})

route('POST', '/hr/resignations/:id/decline', (ctx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const rows = table('Resignation')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Resignation')
  assertResignationPending(rows[idx])
  const body = ctx.body as { notes?: string }
  rows[idx] = { ...rows[idx], status: 'Declined', decidedById: actor.userId, decidedAt: nowIso(), notes: body.notes ?? null }
  saveTable('Resignation', rows)
  return { item: serializeResignation(rows[idx]) }
})

route('POST', '/hr/resignations/:id/withdraw', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('Resignation')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Resignation')
  if (rows[idx].userId !== actor.userId) throw badRequest('Only the employee may withdraw their own resignation')
  assertResignationPending(rows[idx])
  rows[idx] = { ...rows[idx], status: 'Withdrawn' }
  saveTable('Resignation', rows)
  return { item: serializeResignation(rows[idx]) }
})

// ═══════════════════════════ duties ═══════════════════════════

route('GET', '/hr/duties', (ctx) => {
  const actor = requireAuth(ctx)
  let rows = table('Duty').filter(d => d.schoolId === actor.schoolId)
  if (isStaff(actor.role)) {
    if (ctx.query.assigneeId) rows = rows.filter(d => d.assigneeId === ctx.query.assigneeId)
  } else {
    if (ctx.query.assigneeId && ctx.query.assigneeId !== actor.userId) throw badRequest('You may only view your own duties')
    rows = rows.filter(d => d.assigneeId === actor.userId)
  }
  rows = [...rows].sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate)))
  return { items: rows.map(serializeDuty) }
})

route('POST', '/hr/duties', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw badRequest('Staff/admin only')
  const body = ctx.body as { title: string; eventTitle: string; eventDate: string; assigneeId?: string; notes?: string }
  if (body.assigneeId && !table('User').find(u => u.id === body.assigneeId && u.schoolId === actor.schoolId)) throw notFound('Assignee')
  const row: Row = {
    id: uid('duty'), schoolId: actor.schoolId, title: body.title, eventTitle: body.eventTitle, eventDate: body.eventDate,
    assigneeId: body.assigneeId ?? null, createdById: actor.userId, notes: body.notes ?? null, status: 'Assigned', createdAt: nowIso(),
  }
  const rows = table('Duty'); rows.push(row); saveTable('Duty', rows)
  return { item: serializeDuty(row) }
})

route('PATCH', '/hr/duties/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('Duty')
  const idx = rows.findIndex(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Duty')
  const before = rows[idx]
  const body = ctx.body as Partial<{ title: string; eventTitle: string; eventDate: string; assigneeId: string | null; notes: string; status: string }>
  if (!isStaff(actor.role)) {
    if (before.assigneeId !== actor.userId) throw badRequest('You may only update your own duty')
    const keys = Object.keys(body)
    if (keys.some(k => k !== 'status') || body.status !== 'Done') throw badRequest('You may only mark this duty Done')
    rows[idx] = { ...before, status: 'Done' }
    saveTable('Duty', rows)
    return { item: serializeDuty(rows[idx]) }
  }
  if (body.assigneeId !== undefined && body.assigneeId && !table('User').find(u => u.id === body.assigneeId && u.schoolId === actor.schoolId)) throw notFound('Assignee')
  rows[idx] = { ...before, ...body }
  saveTable('Duty', rows)
  return { item: serializeDuty(rows[idx]) }
})

route('DELETE', '/hr/duties/:id', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw badRequest('Staff/admin only')
  const rows = table('Duty')
  const idx = rows.findIndex(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Duty')
  rows.splice(idx, 1)
  saveTable('Duty', rows)
  return { ok: true }
})
