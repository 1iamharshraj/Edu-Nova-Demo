import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { STAFF_ROLES, ADMIN_ROLES, isStaff } from '../../lib/scope'
import { validate } from '../../lib/validate'
import * as svc from './service'
import {
  createBook, patchBook, bookQuery, createCopy, patchCopy, copyQuery,
  issueLoan, returnLoan, fineUpdate, loanQuery, patchSettings,
} from './schema'

// /api/library — see phase-15-library.md.
// - books: everyone reads (catalog browse), staff/admin/superadmin write.
// - copies: staff/admin/superadmin only, both read and write (inventory management, not student-facing).
// - loans: issue/return/fine-status are staff/admin/superadmin only (a librarian does this at the desk,
//   not self-checkout); GET is open to everyone but self-scoped for non-staff (see service.ts#listLoans).
// - settings: staff/admin/superadmin read, admin/superadmin write.
export const libraryRouter = Router()
libraryRouter.use(requireAuth)

const staff = requireRole(...(STAFF_ROLES as any))
const admin = requireRole(...(ADMIN_ROLES as any))

// ---- books ----

libraryRouter.get('/books', wrap(async (req, res) => {
  res.json({ items: (await svc.listBooks(ctxOf(req as AuthedRequest), validate(bookQuery, req.query))).map(svc.serializeBookSummary) })
}))

libraryRouter.post('/books', staff, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeBookSummary(await svc.createBookRow(ctxOf(req as AuthedRequest), validate(createBook, req.body))) })
}))

libraryRouter.get('/books/:id', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const withCopies = isStaff(ctx)
  const row = await svc.getBook(ctx, req.params.id, withCopies)
  res.json({ item: withCopies ? svc.serializeBookDetail(row as any) : svc.serializeBookSummary(row as any) })
}))

libraryRouter.patch('/books/:id', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeBookSummary(await svc.updateBook(ctxOf(req as AuthedRequest), req.params.id, validate(patchBook, req.body))) })
}))

libraryRouter.delete('/books/:id', staff, wrap(async (req, res) => {
  await svc.removeBook(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ---- copies ----

libraryRouter.get('/copies', staff, wrap(async (req, res) => {
  res.json({ items: (await svc.listCopies(ctxOf(req as AuthedRequest), validate(copyQuery, req.query))).map(svc.serializeCopy) })
}))

libraryRouter.post('/copies', staff, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeCopy(await svc.createCopyRow(ctxOf(req as AuthedRequest), validate(createCopy, req.body))) })
}))

libraryRouter.get('/copies/:id', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeCopy(await svc.getCopy(ctxOf(req as AuthedRequest), req.params.id)) })
}))

libraryRouter.patch('/copies/:id', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeCopy(await svc.updateCopy(ctxOf(req as AuthedRequest), req.params.id, validate(patchCopy, req.body))) })
}))

libraryRouter.delete('/copies/:id', staff, wrap(async (req, res) => {
  await svc.removeCopy(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ---- loans ----

libraryRouter.get('/loans', wrap(async (req, res) => {
  res.json({ items: (await svc.listLoans(ctxOf(req as AuthedRequest), validate(loanQuery, req.query))).map(svc.serializeLoan) })
}))

libraryRouter.post('/loans', staff, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeLoan(await svc.issueLoanRow(ctxOf(req as AuthedRequest), validate(issueLoan, req.body))) })
}))

libraryRouter.get('/loans/:id', wrap(async (req, res) => {
  res.json({ item: svc.serializeLoan(await svc.getLoanForView(ctxOf(req as AuthedRequest), req.params.id)) })
}))

libraryRouter.post('/loans/:id/return', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeLoan(await svc.returnLoanRow(ctxOf(req as AuthedRequest), req.params.id, validate(returnLoan, req.body))) })
}))

libraryRouter.patch('/loans/:id/fine', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeLoan(await svc.updateFineStatus(ctxOf(req as AuthedRequest), req.params.id, validate(fineUpdate, req.body))) })
}))

// ---- settings ----

// GET is staff-readable (Issue & Returns needs the real loan-period/limit/fine-rate numbers, not a
// hardcoded frontend fallback) — only PATCH stays admin/superadmin-only.
libraryRouter.get('/settings', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeSettings(await svc.getSettings(ctxOf(req as AuthedRequest))) })
}))

libraryRouter.patch('/settings', admin, wrap(async (req, res) => {
  res.json({ item: svc.serializeSettings(await svc.updateSettings(ctxOf(req as AuthedRequest), validate(patchSettings, req.body))) })
}))
