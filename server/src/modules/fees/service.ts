import type { z } from 'zod'
import type { Prisma, FeeHead, FeeStructure, FeeInvoice, Payment, FeeReminder } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { assertViewStudent, isStaff, visibleStudentIds } from '../../lib/scope'
import { paginate } from '../../lib/pagination'
import { drawFields, drawFooter, drawHeader, drawTable, fmtLong, renderToBuffer } from '../../lib/pdf'
import { sendEmail, sendSms } from '../../lib/notify'
import type {
  createFeeHead, patchFeeHead, createFeeStructure, patchFeeStructure, structuresQuery,
  createInvoice, patchInvoice, invoicesQuery, createPayment, paymentsQuery,
  gatewayOrder, gatewayConfirm, defaultersQuery, createReminder, summaryQuery,
} from './schema'

type Tx = Prisma.TransactionClient

// ─────────────────────────── serializers ───────────────────────────

export const serializeFeeHead = (h: FeeHead) => ({
  id: h.id, name: h.name, isRecurring: h.isRecurring, createdAt: h.createdAt.toISOString(),
})

export const serializeFeeStructure = (s: FeeStructure) => ({
  id: s.id, classId: s.classId, termId: s.termId, dueDate: fmtDate(s.dueDate),
  lines: s.lines as { feeHeadId: string; amount: number }[], createdAt: s.createdAt.toISOString(),
})

type InvoiceLine = { feeHeadId: string; name: string; amount: number }

export const serializeInvoice = (i: FeeInvoice & { payments?: Payment[]; reminders?: FeeReminder[] }) => {
  const paid = (i.payments ?? []).reduce((a, p) => a + p.amount, 0)
  return {
    id: i.id, studentId: i.studentId, feeStructureId: i.feeStructureId ?? undefined, termId: i.termId,
    lines: i.lines as InvoiceLine[], total: i.total, concession: i.concession, dueDate: fmtDate(i.dueDate),
    status: i.status, invoiceNo: i.invoiceNo, createdAt: i.createdAt.toISOString(),
    paid, balance: Math.max(0, i.total - i.concession - paid),
    ...(i.reminders ? { reminders: i.reminders.length } : {}),
  }
}

export const serializePayment = (p: Payment) => ({
  id: p.id, invoiceId: p.invoiceId, amount: p.amount, method: p.method, reference: p.reference ?? undefined,
  paidAt: p.paidAt.toISOString(), recordedById: p.recordedById ?? undefined, receiptNo: p.receiptNo, note: p.note ?? undefined,
})

export const serializeReminder = (r: FeeReminder) => ({
  id: r.id, invoiceId: r.invoiceId, sentById: r.sentById ?? undefined, channel: r.channel, sentAt: r.sentAt.toISOString(), note: r.note ?? undefined,
})

// ─────────────────────────── fee heads ───────────────────────────

export async function listHeads(ctx: Ctx) {
  return prisma.feeHead.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }] })
}

export async function createHead(ctx: Ctx, input: z.infer<typeof createFeeHead>) {
  const row = await prisma.feeHead.create({ data: { schoolId: ctx.schoolId, name: input.name, isRecurring: input.isRecurring ?? true } })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'feeHead', row.id, undefined, serializeFeeHead(row))
  return row
}

async function getHead(ctx: Ctx, id: string) {
  const row = await prisma.feeHead.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Fee head')
  return row
}

export async function updateHead(ctx: Ctx, id: string, input: z.infer<typeof patchFeeHead>) {
  const before = await getHead(ctx, id)
  const row = await prisma.feeHead.update({ where: { id }, data: { name: input.name, isRecurring: input.isRecurring } })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'feeHead', id, serializeFeeHead(before), serializeFeeHead(row))
  return row
}

export async function removeHead(ctx: Ctx, id: string) {
  const before = await getHead(ctx, id)
  await prisma.feeHead.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'feeHead', id, serializeFeeHead(before))
}

// ─────────────────────────── fee structures ───────────────────────────

async function validateLines(ctx: Ctx, lines: { feeHeadId: string; amount: number }[]) {
  const heads = await prisma.feeHead.findMany({ where: { schoolId: ctx.schoolId, id: { in: lines.map(l => l.feeHeadId) } } })
  if (heads.length !== new Set(lines.map(l => l.feeHeadId)).size) throw new HttpError(400, 'One or more feeHeadId are invalid')
  return new Map(heads.map(h => [h.id, h.name]))
}

export async function listStructures(ctx: Ctx, q: z.infer<typeof structuresQuery>) {
  return prisma.feeStructure.findMany({ where: { schoolId: ctx.schoolId, classId: q.classId, termId: q.termId }, orderBy: [{ createdAt: 'asc' }] })
}

async function getStructure(ctx: Ctx, id: string) {
  const row = await prisma.feeStructure.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Fee structure')
  return row
}

export async function createStructure(ctx: Ctx, input: z.infer<typeof createFeeStructure>) {
  const [cls, term] = await Promise.all([
    prisma.class.findFirst({ where: { id: input.classId, schoolId: ctx.schoolId } }),
    prisma.term.findFirst({ where: { id: input.termId, schoolId: ctx.schoolId } }),
  ])
  if (!cls) throw notFound('Class')
  if (!term) throw notFound('Term')
  await validateLines(ctx, input.lines)
  const existing = await prisma.feeStructure.findUnique({ where: { classId_termId: { classId: input.classId, termId: input.termId } } })
  if (existing) throw new HttpError(409, 'A fee structure already exists for this class and term', { id: existing.id })
  const row = await prisma.feeStructure.create({
    data: { schoolId: ctx.schoolId, classId: input.classId, termId: input.termId, dueDate: toDate(input.dueDate), lines: input.lines },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'feeStructure', row.id, undefined, serializeFeeStructure(row))
  return row
}

export async function updateStructure(ctx: Ctx, id: string, input: z.infer<typeof patchFeeStructure>) {
  const before = await getStructure(ctx, id)
  if (input.lines) await validateLines(ctx, input.lines)
  const row = await prisma.feeStructure.update({
    where: { id }, data: { dueDate: input.dueDate ? toDate(input.dueDate) : undefined, lines: input.lines },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'feeStructure', id, serializeFeeStructure(before), serializeFeeStructure(row))
  return row
}

export async function removeStructure(ctx: Ctx, id: string) {
  const before = await getStructure(ctx, id)
  await prisma.feeStructure.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'feeStructure', id, serializeFeeStructure(before))
}

// invoiceNo "INV/2026/0001" — sequential per school + issue year. Allocated inside the same transaction as
// the create so a batch generate doesn't collide with itself.
const invoiceNoFor = (seq: number) => `INV/${new Date().getUTCFullYear()}/${String(seq).padStart(4, '0')}`

// POST /structures/:id/generate — one invoice per active enrollment in the class; idempotent per structure
// (unique(studentId, feeStructureId) — students who already have one for this structure are skipped).
export async function generateInvoices(ctx: Ctx, structureId: string) {
  const structure = await getStructure(ctx, structureId)
  const heads = await prisma.feeHead.findMany({ where: { schoolId: ctx.schoolId, id: { in: (structure.lines as { feeHeadId: string; amount: number }[]).map(l => l.feeHeadId) } } })
  const headName = new Map(heads.map(h => [h.id, h.name]))
  const lines: InvoiceLine[] = (structure.lines as { feeHeadId: string; amount: number }[]).map(l => ({ feeHeadId: l.feeHeadId, name: headName.get(l.feeHeadId) ?? 'Fee', amount: l.amount }))
  const total = lines.reduce((a, l) => a + l.amount, 0)

  const roster = await prisma.enrollment.findMany({ where: { classId: structure.classId, status: 'active' }, select: { studentId: true } })
  const existing = await prisma.feeInvoice.findMany({ where: { feeStructureId: structureId }, select: { studentId: true } })
  const already = new Set(existing.map(e => e.studentId))
  const toCreate = roster.map(r => r.studentId).filter(id => !already.has(id))

  if (!toCreate.length) return { created: 0, skipped: roster.length }

  const result = await prisma.$transaction(async tx => {
    const base = `INV/${new Date().getUTCFullYear()}/`
    let count = await tx.feeInvoice.count({ where: { schoolId: ctx.schoolId, invoiceNo: { startsWith: base } } })
    const rows: FeeInvoice[] = []
    for (const studentId of toCreate) {
      count += 1
      const row = await tx.feeInvoice.create({
        data: {
          schoolId: ctx.schoolId, studentId, feeStructureId: structure.id, termId: structure.termId,
          lines, total, concession: 0, dueDate: structure.dueDate, status: 'Due', invoiceNo: invoiceNoFor(count),
        },
      })
      rows.push(row)
    }
    return rows
  }, { timeout: 30_000 })

  await audit(ctx.schoolId, ctx.actorId, 'generate-invoices', 'feeStructure', structureId, undefined, { created: result.length, skipped: roster.length - result.length })
  return { created: result.length, skipped: roster.length - result.length }
}

// ─────────────────────────── invoices ───────────────────────────

const invoiceInclude = { payments: true, reminders: true } satisfies Prisma.FeeInvoiceInclude

export async function getInvoice(ctx: Ctx, id: string) {
  const row = await prisma.feeInvoice.findFirst({ where: { id, schoolId: ctx.schoolId }, include: invoiceInclude })
  if (!row) throw notFound('Invoice')
  await assertViewStudent(ctx, row.studentId)
  return row
}

export async function listInvoices(ctx: Ctx, q: z.infer<typeof invoicesQuery>) {
  const only = await visibleStudentIds(ctx)
  if (q.studentId) await assertViewStudent(ctx, q.studentId)
  let studentIds = q.studentId ? [q.studentId] : only ?? undefined
  if (q.classId) {
    const enr = await prisma.enrollment.findMany({ where: { classId: q.classId, schoolId: ctx.schoolId, status: 'active' }, select: { studentId: true } })
    const ids = enr.map(e => e.studentId)
    studentIds = studentIds ? studentIds.filter(id => ids.includes(id)) : ids
  }
  const where = { schoolId: ctx.schoolId, termId: q.termId, status: q.status, studentId: studentIds ? { in: studentIds } : undefined }
  // Phase 10 §5: `?limit&cursor`. `defaultLimit: 200` is generous enough that no existing caller (which
  // never passed a limit and relied on getting everything) should be truncated in practice for a single
  // school/term/class filter; `nextCursor` lets a caller page further if it is.
  return paginate(
    args => prisma.feeInvoice.findMany({ where, include: invoiceInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...args }),
    { limit: q.limit, cursor: q.cursor, defaultLimit: 200, maxLimit: 500 },
  )
}

export async function createInvoiceAdHoc(ctx: Ctx, input: z.infer<typeof createInvoice>) {
  const student = await prisma.user.findFirst({ where: { id: input.studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')
  const term = await prisma.term.findFirst({ where: { id: input.termId, schoolId: ctx.schoolId } })
  if (!term) throw notFound('Term')
  const total = input.lines.reduce((a, l) => a + l.amount, 0)
  const row = await prisma.$transaction(async tx => {
    const base = `INV/${new Date().getUTCFullYear()}/`
    const count = await tx.feeInvoice.count({ where: { schoolId: ctx.schoolId, invoiceNo: { startsWith: base } } })
    return tx.feeInvoice.create({
      data: {
        schoolId: ctx.schoolId, studentId: input.studentId, termId: input.termId, lines: input.lines, total,
        concession: 0, dueDate: toDate(input.dueDate), status: 'Due', invoiceNo: `${base}${String(count + 1).padStart(4, '0')}`,
      },
      include: invoiceInclude,
    })
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'feeInvoice', row.id, undefined, serializeInvoice(row))
  return row
}

export async function updateInvoice(ctx: Ctx, id: string, input: z.infer<typeof patchInvoice>) {
  const before = await getInvoice(ctx, id)
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may edit an invoice')
  const row = await prisma.feeInvoice.update({
    where: { id },
    data: { concession: input.concession, dueDate: input.dueDate ? toDate(input.dueDate) : undefined, status: input.status },
    include: invoiceInclude,
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'feeInvoice', id, serializeInvoice(before), serializeInvoice(row))
  return row
}

// Recomputes status from payments unless the invoice was explicitly Waived.
async function recomputeStatus(tx: Tx, invoiceId: string) {
  const inv = await tx.feeInvoice.findUniqueOrThrow({ where: { id: invoiceId } })
  if (inv.status === 'Waived') return inv
  const agg = await tx.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } })
  const paid = agg._sum.amount ?? 0
  const due = inv.total - inv.concession
  const status = paid >= due && due > 0 ? 'Paid' : paid > 0 ? 'PartiallyPaid' : 'Due'
  if (status === inv.status) return inv
  return tx.feeInvoice.update({ where: { id: invoiceId }, data: { status } })
}

async function receiptPdfBytes(school: { name: string }, invoice: FeeInvoice, student: { name: string }, payments: Payment[], title: string) {
  const now = new Date()
  return renderToBuffer(async doc => {
    drawHeader(doc, { schoolName: school.name, title, serial: invoice.invoiceNo })
    drawFields(doc, [
      { label: 'Student', value: student.name },
      { label: 'Invoice no.', value: invoice.invoiceNo },
      { label: 'Due date', value: fmtDate(invoice.dueDate) },
      { label: 'Status', value: invoice.status },
    ])
    doc.moveDown(0.5)
    const lines = invoice.lines as InvoiceLine[]
    drawTable(doc, [{ label: 'Fee head', w: 4 }, { label: 'Amount', w: 2, align: 'right' }], lines.map(l => [l.name, `Rs. ${l.amount.toFixed(2)}`]))
    doc.moveDown(0.3)
    drawFields(doc, [
      { label: 'Total', value: `Rs. ${invoice.total.toFixed(2)}` },
      { label: 'Concession', value: `Rs. ${invoice.concession.toFixed(2)}` },
    ])
    doc.moveDown(0.5)
    doc.font('Helvetica-Bold').fontSize(11).text('Payments')
    doc.moveDown(0.2)
    if (payments.length) {
      drawTable(doc, [
        { label: 'Receipt no.', w: 3 }, { label: 'Date', w: 2 }, { label: 'Method', w: 2 }, { label: 'Amount', w: 2, align: 'right' },
      ], payments.map(p => [p.receiptNo, fmtDate(p.paidAt), p.method, `Rs. ${p.amount.toFixed(2)}`]))
    } else {
      doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text('No payments recorded yet.')
    }
    const paid = payments.reduce((a, p) => a + p.amount, 0)
    doc.moveDown(0.5)
    drawFields(doc, [{ label: 'Amount paid', value: `Rs. ${paid.toFixed(2)}` }, { label: 'Balance', value: `Rs. ${Math.max(0, invoice.total - invoice.concession - paid).toFixed(2)}` }])
    await drawFooter(doc, { issuedBy: school.name, issuedOn: fmtLong(now), qrText: `EduNova invoice ${invoice.invoiceNo} | ${student.name}` })
  })
}

export async function invoiceReceiptPdf(ctx: Ctx, id: string) {
  const inv = await getInvoice(ctx, id)
  const [school, student] = await Promise.all([
    prisma.school.findUniqueOrThrow({ where: { id: ctx.schoolId } }),
    prisma.user.findUniqueOrThrow({ where: { id: inv.studentId } }),
  ])
  const bytes = await receiptPdfBytes(school, inv, student, inv.payments, 'Fee Statement')
  return { bytes, name: `Invoice-${inv.invoiceNo.replace(/\//g, '-')}.pdf` }
}

// ─────────────────────────── payments ───────────────────────────

export async function recordPayment(ctx: Ctx, input: z.infer<typeof createPayment>) {
  const invoice = await prisma.feeInvoice.findFirst({ where: { id: input.invoiceId, schoolId: ctx.schoolId } })
  if (!invoice) throw notFound('Invoice')
  if (invoice.status === 'Waived') throw new HttpError(409, 'Invoice has been waived')
  const row = await prisma.$transaction(async tx => {
    const base = `RCPT/${new Date().getUTCFullYear()}/`
    const count = await tx.payment.count({ where: { schoolId: ctx.schoolId, receiptNo: { startsWith: base } } })
    const payment = await tx.payment.create({
      data: {
        schoolId: ctx.schoolId, invoiceId: invoice.id, amount: input.amount, method: input.method,
        reference: input.reference ?? null, recordedById: ctx.actorId, note: input.note ?? null,
        receiptNo: `${base}${String(count + 1).padStart(4, '0')}`,
      },
    })
    await recomputeStatus(tx, invoice.id)
    return payment
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'payment', row.id, undefined, serializePayment(row))
  return row
}

export async function listPayments(ctx: Ctx, q: z.infer<typeof paymentsQuery>) {
  const only = await visibleStudentIds(ctx)
  let invoiceIds: string[] | undefined
  if (q.studentId) {
    await assertViewStudent(ctx, q.studentId)
    const invs = await prisma.feeInvoice.findMany({ where: { schoolId: ctx.schoolId, studentId: q.studentId }, select: { id: true } })
    invoiceIds = invs.map(i => i.id)
  } else if (only) {
    const invs = await prisma.feeInvoice.findMany({ where: { schoolId: ctx.schoolId, studentId: { in: only } }, select: { id: true } })
    invoiceIds = invs.map(i => i.id)
  }
  if (q.invoiceId) {
    if (invoiceIds && !invoiceIds.includes(q.invoiceId)) return []
    invoiceIds = [q.invoiceId]
  }
  return prisma.payment.findMany({
    where: {
      schoolId: ctx.schoolId, invoiceId: invoiceIds ? { in: invoiceIds } : undefined,
      paidAt: q.from || q.to ? { gte: q.from ? toDate(q.from) : undefined, lte: q.to ? toDate(q.to) : undefined } : undefined,
    },
    orderBy: [{ paidAt: 'desc' }],
  })
}

export async function getPayment(ctx: Ctx, id: string) {
  const row = await prisma.payment.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Payment')
  const invoice = await prisma.feeInvoice.findFirstOrThrow({ where: { id: row.invoiceId } })
  await assertViewStudent(ctx, invoice.studentId)
  return row
}

export async function paymentReceiptPdf(ctx: Ctx, id: string) {
  const payment = await getPayment(ctx, id)
  const invoice = await prisma.feeInvoice.findFirstOrThrow({ where: { id: payment.invoiceId } })
  const [school, student] = await Promise.all([
    prisma.school.findUniqueOrThrow({ where: { id: ctx.schoolId } }),
    prisma.user.findUniqueOrThrow({ where: { id: invoice.studentId } }),
  ])
  const bytes = await receiptPdfBytes(school, invoice, student, [payment], 'Payment Receipt')
  return { bytes, name: `Receipt-${payment.receiptNo.replace(/\//g, '-')}.pdf` }
}

// ─────────────────────────── gateway (sandbox unless RAZORPAY_KEY_ID is set) ───────────────────────────

export async function gatewayOrderCreate(ctx: Ctx, input: z.infer<typeof gatewayOrder>) {
  const invoice = await prisma.feeInvoice.findFirst({ where: { id: input.invoiceId, schoolId: ctx.schoolId } })
  if (!invoice) throw notFound('Invoice')
  await assertViewStudent(ctx, invoice.studentId)
  if (invoice.status === 'Waived' || invoice.status === 'Paid') throw new HttpError(409, 'Invoice is not payable')
  const keyId = process.env.RAZORPAY_KEY_ID
  const orderId = `order_${Math.random().toString(36).slice(2, 12)}`
  if (keyId) {
    // Real Razorpay order creation would go here (test mode) — omitted, no live keys configured in this env.
    return { orderId, key: keyId, amount: input.amount }
  }
  return { sandbox: true, orderId, amount: input.amount }
}

export async function gatewayConfirmPayment(ctx: Ctx, input: z.infer<typeof gatewayConfirm>) {
  const invoice = await prisma.feeInvoice.findFirst({ where: { id: input.invoiceId, schoolId: ctx.schoolId } })
  if (!invoice) throw notFound('Invoice')
  await assertViewStudent(ctx, invoice.studentId)
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (keyId && keySecret) {
    const crypto = await import('node:crypto')
    const expected = crypto.createHmac('sha256', keySecret).update(`${input.orderId}|${input.paymentId ?? ''}`).digest('hex')
    if (expected !== input.signature) throw new HttpError(400, 'Payment signature verification failed')
  } // sandbox mode: no keys configured, accept the confirmation as-is.

  const row = await prisma.$transaction(async tx => {
    const base = `RCPT/${new Date().getUTCFullYear()}/`
    const count = await tx.payment.count({ where: { schoolId: ctx.schoolId, receiptNo: { startsWith: base } } })
    const payment = await tx.payment.create({
      data: {
        schoolId: ctx.schoolId, invoiceId: invoice.id, amount: input.amount, method: input.method,
        reference: input.orderId, recordedById: ctx.actorId, note: keyId ? 'Razorpay' : 'Sandbox gateway',
        receiptNo: `${base}${String(count + 1).padStart(4, '0')}`,
      },
    })
    await recomputeStatus(tx, invoice.id)
    return payment
  })
  await audit(ctx.schoolId, ctx.actorId, 'gateway-confirm', 'payment', row.id, undefined, serializePayment(row))
  const updated = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: invoiceInclude })
  return { payment: row, invoice: updated }
}

// ─────────────────────────── defaulters ───────────────────────────

export async function defaulters(ctx: Ctx, q: z.infer<typeof defaultersQuery>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Staff/admin only')
  const now = new Date()
  let studentIds: string[] | undefined
  if (q.classId) {
    const enr = await prisma.enrollment.findMany({ where: { classId: q.classId, schoolId: ctx.schoolId, status: 'active' }, select: { studentId: true } })
    studentIds = enr.map(e => e.studentId)
  }
  const invoices = await prisma.feeInvoice.findMany({
    where: {
      schoolId: ctx.schoolId, termId: q.termId, status: { in: ['Due', 'PartiallyPaid'] }, dueDate: { lt: now },
      studentId: studentIds ? { in: studentIds } : undefined,
    },
    include: { payments: true, reminders: true },
  })
  if (!invoices.length) return []

  const byStudent = new Map<string, typeof invoices>()
  for (const inv of invoices) byStudent.set(inv.studentId, [...(byStudent.get(inv.studentId) ?? []), inv])

  const students = await prisma.user.findMany({ where: { id: { in: [...byStudent.keys()] } } })
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: { in: [...byStudent.keys()] }, status: 'active' },
    include: { class: { include: { grade: true } } },
  })
  const enrByStudent = new Map(enrollments.map(e => [e.studentId, e]))
  const guardians = await prisma.guardian.findMany({ where: { studentId: { in: [...byStudent.keys()] } }, include: { parent: true } })
  const guardianByStudent = new Map<string, (typeof guardians)[number]>()
  for (const g of guardians) if (!guardianByStudent.has(g.studentId)) guardianByStudent.set(g.studentId, g)

  return students.map(s => {
    const invs = byStudent.get(s.id)!
    const outstanding = invs.reduce((a, i) => a + Math.max(0, i.total - i.concession - i.payments.reduce((x, p) => x + p.amount, 0)), 0)
    const oldestDue = invs.reduce<Date | null>((a, i) => (!a || i.dueDate < a ? i.dueDate : a), null)
    const reminders = invs.reduce((a, i) => a + i.reminders.length, 0)
    const enr = enrByStudent.get(s.id)
    const guardian = guardianByStudent.get(s.id)
    return {
      studentId: s.id, name: s.name, classLabel: enr ? `${enr.class.grade.label}-${enr.class.section}` : '—',
      parent: guardian ? { name: guardian.parent.name, phone: guardian.parent.phone ?? undefined, email: guardian.parent.email } : undefined,
      outstanding, oldestDue: oldestDue ? fmtDate(oldestDue) : undefined, reminders,
    }
  }).sort((a, b) => b.outstanding - a.outstanding)
}

// ─────────────────────────── reminders ───────────────────────────

export async function createReminderRow(ctx: Ctx, input: z.infer<typeof createReminder>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Staff/admin only')
  const invoice = await prisma.feeInvoice.findFirst({ where: { id: input.invoiceId, schoolId: ctx.schoolId } })
  if (!invoice) throw notFound('Invoice')
  const row = await prisma.feeReminder.create({
    data: { schoolId: ctx.schoolId, invoiceId: invoice.id, sentById: ctx.actorId, channel: input.channel, note: input.note ?? null },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'feeReminder', row.id, undefined, serializeReminder(row))

  // Outbound delivery (Phase 9 — see phase-9-10-integrations-hardening.md → item 3). Sent to the
  // student's guardian(s) when the channel calls for it; best-effort, never blocks the reminder record.
  if (input.channel === 'Email' || input.channel === 'SMS') {
    const balance = Math.max(0, invoice.total - invoice.concession)
    const [student, guardians] = await Promise.all([
      prisma.user.findUnique({ where: { id: invoice.studentId } }),
      prisma.guardian.findMany({ where: { studentId: invoice.studentId }, include: { parent: true } }),
    ])
    const recipients = guardians.length ? guardians.map(g => g.parent) : student ? [student] : []
    const body = `Fee reminder for ${student?.name ?? 'your ward'}: invoice ${invoice.invoiceNo} of ₹${balance} is due ${fmtDate(invoice.dueDate)}.${input.note ? ` Note: ${input.note}` : ''}`
    await Promise.all(recipients.map(r => input.channel === 'Email'
      ? (r.email && sendEmail({ to: r.email, subject: 'EduNova fee reminder', body }))
      : (r.phone && sendSms({ to: r.phone, body }))))
  }
  return row
}

// ─────────────────────────── summary ───────────────────────────

export async function summary(ctx: Ctx, q: z.infer<typeof summaryQuery>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Staff/admin only')
  const invoices = await prisma.feeInvoice.findMany({
    where: { schoolId: ctx.schoolId, termId: q.termId, status: { not: 'Waived' } },
    include: { payments: true },
  })
  const heads = await prisma.feeHead.findMany({ where: { schoolId: ctx.schoolId } })
  const headName = new Map(heads.map(h => [h.id, h.name]))

  let collected = 0, outstanding = 0, invoicedTotal = 0
  const byHead = new Map<string, { feeHeadId: string; name: string; invoiced: number; collected: number }>()

  for (const inv of invoices) {
    const paid = inv.payments.reduce((a, p) => a + p.amount, 0)
    const net = inv.total - inv.concession
    invoicedTotal += net
    collected += paid
    outstanding += Math.max(0, net - paid)
    const lines = inv.lines as InvoiceLine[]
    for (const l of lines) {
      const entry = byHead.get(l.feeHeadId) ?? { feeHeadId: l.feeHeadId, name: headName.get(l.feeHeadId) ?? l.name, invoiced: 0, collected: 0 }
      entry.invoiced += l.amount
      entry.collected += inv.total > 0 ? (l.amount / inv.total) * paid : 0
      byHead.set(l.feeHeadId, entry)
    }
  }

  return {
    collected: round2(collected), outstanding: round2(outstanding), invoiced: round2(invoicedTotal),
    byHead: [...byHead.values()].map(h => ({ ...h, invoiced: round2(h.invoiced), collected: round2(h.collected) })),
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100
