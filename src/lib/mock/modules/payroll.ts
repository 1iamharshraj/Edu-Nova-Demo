// Mirrors server/src/modules/payroll/{router,schema,service}.ts's contract for the endpoints
// src/lib/hooks (used inline from src/portal/modules/finance.tsx, no dedicated usePayroll.ts) calls:
// GET/PUT salary structure, POST a payroll run, list payslips, mark one paid (auto-posts to the ledger
// via modules/accounting.ts), and a PDF placeholder download.

import { route, requireAuth, requireRole } from '../router'
import { badRequest, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { postPayrollAutoEntry } from './accounting'

const ADMIN_ROLES = ['admin', 'superadmin']
const PAYROLL_ROLES = ['teacher', 'staff', 'admin', 'superadmin']

type LineItem = { name: string; amount: number }

function isAdmin(role: string) { return ADMIN_ROLES.includes(role) }
function assertSelfOrAdmin(actorId: string, role: string, userId: string) {
  if (isAdmin(role) || actorId === userId) return
  throw badRequest('You may only view your own payroll records')
}

function serializeStructure(s: Row) {
  return { id: s.id, userId: s.userId, basic: s.basic, allowances: s.allowances, deductions: s.deductions, effectiveFrom: s.effectiveFrom, createdAt: s.createdAt }
}
function serializePayslip(p: Row) {
  return {
    id: p.id, userId: p.userId, month: p.month, basic: p.basic, allowances: p.allowances, deductions: p.deductions,
    gross: p.gross, net: p.net, status: p.status, paidAt: p.paidAt ?? undefined, paidById: p.paidById ?? undefined, slipNo: p.slipNo,
  }
}

const sum = (items: LineItem[]) => items.reduce((a, i) => a + i.amount, 0)

route('GET', '/payroll/structures/:userId', (ctx) => {
  const actor = requireAuth(ctx)
  assertSelfOrAdmin(actor.userId, actor.role, ctx.params.userId)
  const row = table('SalaryStructure').find(s => s.userId === ctx.params.userId && s.schoolId === actor.schoolId)
  if (!row) throw notFound('Salary structure')
  return { item: serializeStructure(row) }
})

route('PUT', '/payroll/structures/:userId', (ctx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const user = table('User').find(u => u.id === ctx.params.userId && u.schoolId === actor.schoolId && PAYROLL_ROLES.includes(String(u.role)))
  if (!user) throw notFound('Employee')
  const body = ctx.body as { basic: number; allowances?: LineItem[]; deductions?: LineItem[]; effectiveFrom: string }
  const rows = table('SalaryStructure')
  const idx = rows.findIndex(s => s.userId === ctx.params.userId && s.schoolId === actor.schoolId)
  const data = { basic: body.basic, allowances: body.allowances ?? [], deductions: body.deductions ?? [], effectiveFrom: body.effectiveFrom }
  let row: Row
  if (idx === -1) {
    row = { id: uid('salstruct'), schoolId: actor.schoolId, userId: ctx.params.userId, createdAt: nowIso(), ...data }
    rows.push(row)
  } else {
    row = { ...rows[idx], ...data }
    rows[idx] = row
  }
  saveTable('SalaryStructure', rows)
  return { item: serializeStructure(row) }
})

route('POST', '/payroll/run', (ctx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const body = ctx.body as { month: string }
  if (!/^\d{4}-\d{2}$/.test(body.month ?? '')) throw badRequest('Expected YYYY-MM')
  const structures = table('SalaryStructure').filter(s => s.schoolId === actor.schoolId)
  if (!structures.length) return { created: 0, skipped: 0 }
  const already = new Set(table('Payslip').filter(p => p.schoolId === actor.schoolId && p.month === body.month).map(p => p.userId))
  const toCreate = structures.filter(s => !already.has(s.userId))
  if (!toCreate.length) return { created: 0, skipped: structures.length }

  const base = `PAY/${new Date().getUTCFullYear()}/`
  let count = table('Payslip').filter(p => p.schoolId === actor.schoolId && String(p.slipNo).startsWith(base)).length
  const rows = table('Payslip')
  for (const s of toCreate) {
    const allowances = (s.allowances as LineItem[] | undefined) ?? []
    const deductions = (s.deductions as LineItem[] | undefined) ?? []
    const gross = Number(s.basic) + sum(allowances)
    const net = gross - sum(deductions)
    count += 1
    rows.push({
      id: uid('payslip'), schoolId: actor.schoolId, userId: s.userId, month: body.month, basic: s.basic,
      allowances, deductions, gross, net, status: 'Generated', slipNo: `${base}${String(count).padStart(4, '0')}`, createdAt: nowIso(),
    })
  }
  saveTable('Payslip', rows)
  return { created: toCreate.length, skipped: structures.length - toCreate.length }
})

route('GET', '/payroll/payslips', (ctx) => {
  const actor = requireAuth(ctx)
  const wantUserId = isAdmin(actor.role) ? ctx.query.userId : actor.userId
  if (ctx.query.userId && !isAdmin(actor.role) && ctx.query.userId !== actor.userId) throw badRequest('You may only view your own payslips')
  let rows = table('Payslip').filter(p => p.schoolId === actor.schoolId)
  if (wantUserId) rows = rows.filter(p => p.userId === wantUserId)
  if (ctx.query.month) rows = rows.filter(p => p.month === ctx.query.month)
  rows = [...rows].sort((a, b) => String(b.month).localeCompare(String(a.month)))
  return { items: rows.map(serializePayslip) }
})

route('PATCH', '/payroll/payslips/:id/mark-paid', (ctx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const rows = table('Payslip')
  const idx = rows.findIndex(p => p.id === ctx.params.id && p.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Payslip')
  if (rows[idx].status === 'Paid') return { item: serializePayslip(rows[idx]) }
  const paidAt = nowIso()
  rows[idx] = { ...rows[idx], status: 'Paid', paidAt, paidById: actor.userId }
  saveTable('Payslip', rows)
  postPayrollAutoEntry(actor.schoolId, actor.userId, { id: String(rows[idx].id), net: Number(rows[idx].net), paidAt })
  return { item: serializePayslip(rows[idx]) }
})

// GET /payroll/payslips/:id.pdf — no real PDF renderer in the browser; downloadPath() (src/lib/api.ts)
// falls back to a placeholder blob whenever the response carries no `dataUrl`, same convention as
// modules/files.ts's downloadFile().
route('GET', '/payroll/payslips/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const raw = ctx.params.id
  if (!raw.endsWith('.pdf')) throw notFound('Payslip')
  const id = raw.slice(0, -4)
  const row = table('Payslip').find(p => p.id === id && p.schoolId === actor.schoolId)
  if (!row) throw notFound('Payslip')
  assertSelfOrAdmin(actor.userId, actor.role, String(row.userId))
  return {}
})
