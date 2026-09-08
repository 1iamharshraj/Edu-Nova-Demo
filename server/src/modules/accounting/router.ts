import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { createAccount, patchAccount, accountQuery, createJournalEntry, journalQuery, trialBalanceQuery, profitAndLossQuery, balanceSheetQuery } from './schema'

// /api/accounting — see phase-17-accounting.md. Every route here is admin/superadmin only: this is
// sensitive financial data, and manual journal entries / the chart of accounts are exactly the kind of
// thing that should not be staff-editable.
export const accountingRouter = Router()
accountingRouter.use(requireAuth)

const write = requireRole('admin', 'superadmin')

// ───────────────────────── chart of accounts ─────────────────────────

accountingRouter.get('/accounts', write, wrap(async (req, res) => {
  res.json({ items: (await svc.listAccounts(ctxOf(req as AuthedRequest), validate(accountQuery, req.query))).map(svc.serializeAccount) })
}))

accountingRouter.post('/accounts', write, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeAccount(await svc.createAccountRow(ctxOf(req as AuthedRequest), validate(createAccount, req.body))) })
}))

accountingRouter.patch('/accounts/:id', write, wrap(async (req, res) => {
  res.json({ item: svc.serializeAccount(await svc.updateAccountRow(ctxOf(req as AuthedRequest), req.params.id, validate(patchAccount, req.body))) })
}))

accountingRouter.delete('/accounts/:id', write, wrap(async (req, res) => {
  await svc.removeAccountRow(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ───────────────────────── journal entries ─────────────────────────

accountingRouter.get('/journal-entries', write, wrap(async (req, res) => {
  const { items, nextCursor } = await svc.listEntries(ctxOf(req as AuthedRequest), validate(journalQuery, req.query))
  res.json({ items: items.map(svc.serializeEntry), nextCursor })
}))

accountingRouter.post('/journal-entries', write, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeEntry(await svc.createManualEntry(ctxOf(req as AuthedRequest), validate(createJournalEntry, req.body))) })
}))

accountingRouter.get('/journal-entries/:id', write, wrap(async (req, res) => {
  res.json({ item: svc.serializeEntry(await svc.getEntry(ctxOf(req as AuthedRequest), req.params.id)) })
}))

// ───────────────────────── reports ─────────────────────────

accountingRouter.get('/reports/trial-balance', write, wrap(async (req, res) => {
  res.json(await svc.trialBalance(ctxOf(req as AuthedRequest), validate(trialBalanceQuery, req.query)))
}))

accountingRouter.get('/reports/profit-and-loss', write, wrap(async (req, res) => {
  res.json(await svc.profitAndLoss(ctxOf(req as AuthedRequest), validate(profitAndLossQuery, req.query)))
}))

accountingRouter.get('/reports/balance-sheet', write, wrap(async (req, res) => {
  res.json(await svc.balanceSheet(ctxOf(req as AuthedRequest), validate(balanceSheetQuery, req.query)))
}))
