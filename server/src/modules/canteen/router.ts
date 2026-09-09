import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { topUpBody, purchaseBody, transactionsQuery } from './schema'

// /api/canteen — see phase-30-canteen-wallet.md. Every route is scoped inside service.ts (self/guardian,
// staff/admin, canteen counter staff via plain `staff` — see service.ts's role-granularity note); no
// router-level requireRole() gate beyond requireAuth, matching how fees/service.ts's gateway endpoints
// self-scope via assertViewStudent rather than a blanket role gate.
export const canteenRouter = Router()
canteenRouter.use(requireAuth)

canteenRouter.post('/wallets/:studentId/topup', wrap(async (req, res) => {
  const result = await svc.topUp(ctxOf(req as AuthedRequest), req.params.studentId, validate(topUpBody, req.body))
  res.status(201).json(result)
}))

canteenRouter.post('/wallets/:studentId/purchase', wrap(async (req, res) => {
  const result = await svc.purchase(ctxOf(req as AuthedRequest), req.params.studentId, validate(purchaseBody, req.body))
  res.status(201).json(result)
}))

canteenRouter.get('/wallets/:studentId', wrap(async (req, res) => {
  res.json(await svc.getWalletSummary(ctxOf(req as AuthedRequest), req.params.studentId))
}))

canteenRouter.get('/wallets/:studentId/transactions', wrap(async (req, res) => {
  res.json(await svc.listTransactions(ctxOf(req as AuthedRequest), req.params.studentId, validate(transactionsQuery, req.query)))
}))

// Item 6 — admin reconciliation view: sum of all wallet balances vs. the Canteen Wallet Liability GL
// account balance. admin/superadmin only (enforced in service.ts).
canteenRouter.get('/reconciliation', wrap(async (req, res) => {
  res.json(await svc.reconciliation(ctxOf(req as AuthedRequest)))
}))
