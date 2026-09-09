import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { STAFF_ROLES } from '../../lib/scope'
import { validate } from '../../lib/validate'
import * as svc from './service'
import {
  serializeFeeHead, serializeFeeStructure, serializeInvoice, serializePayment, serializeReminder,
  serializeInstallmentPlan,
} from './service'
import {
  createFeeHead, patchFeeHead, createFeeStructure, patchFeeStructure, structuresQuery,
  createInvoice, patchInvoice, invoicesQuery, createPayment, paymentsQuery,
  gatewayOrder, gatewayConfirm, defaultersQuery, createReminder, summaryQuery,
  generateInvoicesBody, createInstallmentPlan, installmentPlanQuery,
} from './schema'

// /api/fees — see phase-5-finance.md. Staff/admin/superadmin write; parents/students read their own.
export const feesRouter = Router()
feesRouter.use(requireAuth)
const staff = requireRole(...(STAFF_ROLES as any))
// Teachers get read access to their own classes' defaulters (service.ts#defaulters scopes it) — see
// deep-audit-2026-09-08.md #8: nav + Overview tile already expect this, only the backend gate was missing.
const staffOrTeacher = requireRole('teacher', ...(STAFF_ROLES as any))

// ── heads ──
feesRouter.get('/heads', wrap(async (req, res) => {
  res.json({ items: (await svc.listHeads(ctxOf(req as AuthedRequest))).map(serializeFeeHead) })
}))
feesRouter.post('/heads', staff, wrap(async (req, res) => {
  res.status(201).json({ item: serializeFeeHead(await svc.createHead(ctxOf(req as AuthedRequest), validate(createFeeHead, req.body))) })
}))
feesRouter.patch('/heads/:id', staff, wrap(async (req, res) => {
  res.json({ item: serializeFeeHead(await svc.updateHead(ctxOf(req as AuthedRequest), req.params.id, validate(patchFeeHead, req.body))) })
}))
feesRouter.delete('/heads/:id', staff, wrap(async (req, res) => {
  await svc.removeHead(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ── structures ──
feesRouter.get('/structures', wrap(async (req, res) => {
  res.json({ items: (await svc.listStructures(ctxOf(req as AuthedRequest), validate(structuresQuery, req.query))).map(serializeFeeStructure) })
}))
feesRouter.post('/structures', staff, wrap(async (req, res) => {
  res.status(201).json({ item: serializeFeeStructure(await svc.createStructure(ctxOf(req as AuthedRequest), validate(createFeeStructure, req.body))) })
}))
feesRouter.patch('/structures/:id', staff, wrap(async (req, res) => {
  res.json({ item: serializeFeeStructure(await svc.updateStructure(ctxOf(req as AuthedRequest), req.params.id, validate(patchFeeStructure, req.body))) })
}))
feesRouter.delete('/structures/:id', staff, wrap(async (req, res) => {
  await svc.removeStructure(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
feesRouter.post('/structures/:id/generate', staff, wrap(async (req, res) => {
  res.status(201).json(await svc.generateInvoices(ctxOf(req as AuthedRequest), req.params.id, validate(generateInvoicesBody, req.body ?? {})))
}))

// ── installment plans (Phase 21 item 5) ──
feesRouter.get('/installment-plans', wrap(async (req, res) => {
  res.json({ items: (await svc.listInstallmentPlans(ctxOf(req as AuthedRequest), validate(installmentPlanQuery, req.query))).map(serializeInstallmentPlan) })
}))
feesRouter.post('/installment-plans', staff, wrap(async (req, res) => {
  res.status(201).json({ item: serializeInstallmentPlan(await svc.createInstallmentPlanRow(ctxOf(req as AuthedRequest), validate(createInstallmentPlan, req.body))) })
}))
feesRouter.delete('/installment-plans/:id', staff, wrap(async (req, res) => {
  await svc.removeInstallmentPlan(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ── invoices ──
feesRouter.get('/invoices', wrap(async (req, res) => {
  const { items, nextCursor } = await svc.listInvoices(ctxOf(req as AuthedRequest), validate(invoicesQuery, req.query))
  res.json({ items: items.map(serializeInvoice), nextCursor })
}))
feesRouter.post('/invoices', staff, wrap(async (req, res) => {
  res.status(201).json({ item: serializeInvoice(await svc.createInvoiceAdHoc(ctxOf(req as AuthedRequest), validate(createInvoice, req.body))) })
}))
feesRouter.get('/invoices/:id', wrap(async (req, res) => {
  res.json({ item: serializeInvoice(await svc.getInvoice(ctxOf(req as AuthedRequest), req.params.id)) })
}))
feesRouter.patch('/invoices/:id', wrap(async (req, res) => {
  res.json({ item: serializeInvoice(await svc.updateInvoice(ctxOf(req as AuthedRequest), req.params.id, validate(patchInvoice, req.body))) })
}))
feesRouter.get('/invoices/:id/receipt.pdf', wrap(async (req, res) => {
  const { bytes, name } = await svc.invoiceReceiptPdf(ctxOf(req as AuthedRequest), req.params.id)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.end(bytes)
}))

// ── payments ──
feesRouter.post('/payments', staff, wrap(async (req, res) => {
  res.status(201).json({ item: serializePayment(await svc.recordPayment(ctxOf(req as AuthedRequest), validate(createPayment, req.body))) })
}))
feesRouter.get('/payments', wrap(async (req, res) => {
  res.json({ items: (await svc.listPayments(ctxOf(req as AuthedRequest), validate(paymentsQuery, req.query))).map(serializePayment) })
}))
feesRouter.get('/payments/:id/receipt.pdf', wrap(async (req, res) => {
  const { bytes, name } = await svc.paymentReceiptPdf(ctxOf(req as AuthedRequest), req.params.id)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.end(bytes)
}))

// ── gateway (sandbox unless RAZORPAY_KEY_ID is set) ──
feesRouter.post('/gateway/order', wrap(async (req, res) => {
  res.json(await svc.gatewayOrderCreate(ctxOf(req as AuthedRequest), validate(gatewayOrder, req.body)))
}))
feesRouter.post('/gateway/confirm', wrap(async (req, res) => {
  const { payment, invoice } = await svc.gatewayConfirmPayment(ctxOf(req as AuthedRequest), validate(gatewayConfirm, req.body))
  res.status(201).json({ payment: serializePayment(payment), invoice: serializeInvoice(invoice) })
}))

// ── defaulters / reminders / summary ──
feesRouter.get('/defaulters', staffOrTeacher, wrap(async (req, res) => {
  res.json({ items: await svc.defaulters(ctxOf(req as AuthedRequest), validate(defaultersQuery, req.query)) })
}))
feesRouter.post('/reminders', staff, wrap(async (req, res) => {
  res.status(201).json({ item: serializeReminder(await svc.createReminderRow(ctxOf(req as AuthedRequest), validate(createReminder, req.body))) })
}))
feesRouter.get('/summary', staff, wrap(async (req, res) => {
  res.json(await svc.summary(ctxOf(req as AuthedRequest), validate(summaryQuery, req.query)))
}))
