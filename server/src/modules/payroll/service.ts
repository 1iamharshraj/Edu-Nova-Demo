import type { z } from 'zod'
import type { SalaryStructure, Payslip } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { toDate, fmtDate } from '../../lib/validate'
import { isAdmin } from '../../lib/scope'
import { drawFields, drawFooter, drawHeader, drawTable, fmtLong, renderToBuffer } from '../../lib/pdf'
import { logChange } from '../employmentHistory/service'
import { postPayrollAutoEntry } from '../accounting/service'
import type { upsertSalaryStructure, runBody, payslipsQuery } from './schema'

type LineItem = { name: string; amount: number }

export const serializeSalaryStructure = (s: SalaryStructure) => ({
  id: s.id, userId: s.userId, basic: s.basic, allowances: s.allowances as LineItem[], deductions: s.deductions as LineItem[],
  effectiveFrom: fmtDate(s.effectiveFrom), createdAt: s.createdAt.toISOString(),
})

export const serializePayslip = (p: Payslip) => ({
  id: p.id, userId: p.userId, month: p.month, basic: p.basic, allowances: p.allowances as LineItem[], deductions: p.deductions as LineItem[],
  gross: p.gross, net: p.net, status: p.status, paidAt: p.paidAt?.toISOString(), paidById: p.paidById ?? undefined,
  slipNo: p.slipNo, createdAt: p.createdAt.toISOString(),
})

const PAYROLL_ROLES = ['teacher', 'staff', 'admin', 'superadmin']

function assertSelfOrAdmin(ctx: Ctx, userId: string) {
  if (isAdmin(ctx) || ctx.actorId === userId) return
  throw new HttpError(403, 'You may only view your own payroll records')
}

export async function getStructure(ctx: Ctx, userId: string) {
  assertSelfOrAdmin(ctx, userId)
  const row = await prisma.salaryStructure.findFirst({ where: { userId, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Salary structure')
  return row
}

export async function upsertStructure(ctx: Ctx, userId: string, input: z.infer<typeof upsertSalaryStructure>) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  const user = await prisma.user.findFirst({ where: { id: userId, schoolId: ctx.schoolId, role: { in: PAYROLL_ROLES } } })
  if (!user) throw notFound('Employee')
  const before = await prisma.salaryStructure.findFirst({ where: { userId, schoolId: ctx.schoolId } })
  const row = await prisma.salaryStructure.upsert({
    where: { userId },
    create: { schoolId: ctx.schoolId, userId, basic: input.basic, allowances: input.allowances, deductions: input.deductions, effectiveFrom: toDate(input.effectiveFrom) },
    update: { basic: input.basic, allowances: input.allowances, deductions: input.deductions, effectiveFrom: toDate(input.effectiveFrom) },
  })
  await audit(ctx.schoolId, ctx.actorId, before ? 'update' : 'create', 'salaryStructure', row.id, before ? serializeSalaryStructure(before) : undefined, serializeSalaryStructure(row))
  // A4 — permanent, queryable raise history alongside the current-value-only SalaryStructure row (the
  // upsert-overwrite behaviour above is unchanged; only the log is new). Best-effort, never blocks the write.
  if (!before) {
    await logChange(ctx.schoolId, userId, 'Salary', null, String(input.basic), ctx.actorId, 'Initial salary structure')
  } else if (before.basic !== input.basic) {
    await logChange(ctx.schoolId, userId, 'Salary', String(before.basic), String(input.basic), ctx.actorId)
  }
  return row
}

const sum = (items: LineItem[]) => items.reduce((a, i) => a + i.amount, 0)
const slipNoFor = (seq: number) => `PAY/${new Date().getUTCFullYear()}/${String(seq).padStart(4, '0')}`

// POST /run { month } — one Payslip per user with a SalaryStructure (idempotent via unique(userId, month)).
export async function run(ctx: Ctx, input: z.infer<typeof runBody>) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  const structures = await prisma.salaryStructure.findMany({ where: { schoolId: ctx.schoolId } })
  if (!structures.length) return { created: 0, skipped: 0 }
  const existing = await prisma.payslip.findMany({ where: { schoolId: ctx.schoolId, month: input.month }, select: { userId: true } })
  const already = new Set(existing.map(e => e.userId))
  const toCreate = structures.filter(s => !already.has(s.userId))
  if (!toCreate.length) return { created: 0, skipped: structures.length }

  const rows = await prisma.$transaction(async tx => {
    const base = `PAY/${new Date().getUTCFullYear()}/`
    let count = await tx.payslip.count({ where: { schoolId: ctx.schoolId, slipNo: { startsWith: base } } })
    const created: Payslip[] = []
    for (const s of toCreate) {
      const allowances = s.allowances as LineItem[]
      const deductions = s.deductions as LineItem[]
      const gross = s.basic + sum(allowances)
      const net = gross - sum(deductions)
      count += 1
      created.push(await tx.payslip.create({
        data: {
          schoolId: ctx.schoolId, userId: s.userId, month: input.month, basic: s.basic, allowances, deductions,
          gross, net, status: 'Generated', slipNo: slipNoFor(count),
        },
      }))
    }
    return created
  }, { timeout: 30_000 })

  await audit(ctx.schoolId, ctx.actorId, 'run', 'payroll', input.month, undefined, { created: rows.length, skipped: structures.length - rows.length })
  return { created: rows.length, skipped: structures.length - rows.length }
}

export async function listPayslips(ctx: Ctx, q: z.infer<typeof payslipsQuery>) {
  const userId = isAdmin(ctx) ? q.userId : ctx.actorId
  if (q.userId && !isAdmin(ctx) && q.userId !== ctx.actorId) throw new HttpError(403, 'You may only view your own payslips')
  return prisma.payslip.findMany({ where: { schoolId: ctx.schoolId, userId, month: q.month }, orderBy: [{ month: 'desc' }] })
}

export async function getPayslip(ctx: Ctx, id: string) {
  const row = await prisma.payslip.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Payslip')
  assertSelfOrAdmin(ctx, row.userId)
  return row
}

export async function markPaid(ctx: Ctx, id: string) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  const before = await prisma.payslip.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Payslip')
  const row = await prisma.payslip.update({ where: { id }, data: { status: 'Paid', paidAt: new Date(), paidById: ctx.actorId } })
  await audit(ctx.schoolId, ctx.actorId, 'mark-paid', 'payslip', id, serializePayslip(before), serializePayslip(row))
  // Phase 17 — best-effort ledger auto-post (Debit Salary Expense / Credit Bank); never blocks or rolls
  // back the payroll payment itself, see accounting/service.ts#postPayrollAutoEntry.
  await postPayrollAutoEntry(ctx, row)
  return row
}

export async function payslipPdf(ctx: Ctx, id: string) {
  const slip = await getPayslip(ctx, id)
  const [school, user] = await Promise.all([
    prisma.school.findUniqueOrThrow({ where: { id: ctx.schoolId } }),
    prisma.user.findUniqueOrThrow({ where: { id: slip.userId } }),
  ])
  const now = new Date()
  const allowances = slip.allowances as LineItem[]
  const deductions = slip.deductions as LineItem[]
  const bytes = await renderToBuffer(async doc => {
    drawHeader(doc, { schoolName: school.name, title: 'Payslip', subtitle: slip.month, serial: slip.slipNo })
    drawFields(doc, [
      { label: 'Employee', value: user.name },
      { label: 'Employee ID', value: user.employeeId ?? '—' },
      { label: 'Designation', value: user.designation ?? user.title },
      { label: 'Month', value: slip.month },
      { label: 'Status', value: slip.status },
    ])
    doc.moveDown(0.5)
    const rows = [['Basic', `Rs. ${slip.basic.toFixed(2)}`], ...allowances.map(a => [a.name, `Rs. ${a.amount.toFixed(2)}`])]
    drawTable(doc, [{ label: 'Earnings', w: 4 }, { label: 'Amount', w: 2, align: 'right' }], rows)
    doc.moveDown(0.3)
    if (deductions.length) drawTable(doc, [{ label: 'Deductions', w: 4 }, { label: 'Amount', w: 2, align: 'right' }], deductions.map(d => [d.name, `Rs. ${d.amount.toFixed(2)}`]))
    doc.moveDown(0.5)
    drawFields(doc, [
      { label: 'Gross', value: `Rs. ${slip.gross.toFixed(2)}` },
      { label: 'Net pay', value: `Rs. ${slip.net.toFixed(2)}` },
    ])
    await drawFooter(doc, { issuedBy: school.name, issuedOn: fmtLong(now), qrText: `EduNova payslip ${slip.slipNo} | ${user.name} | ${slip.month}` })
  })
  return { bytes, name: `Payslip-${slip.slipNo.replace(/\//g, '-')}.pdf` }
}
