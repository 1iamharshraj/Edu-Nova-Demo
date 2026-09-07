import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { STAFF_ROLES } from '../../lib/scope'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeVerification as ser } from './service'
import { submitBody, listQuery, rejectBody } from './schema'

// /api/verification — parent identity verification, decided by staff/admin. User.verified follows it.
export const verificationRouter = Router()
verificationRouter.use(requireAuth)
const staff = requireRole(...(STAFF_ROLES as any))

verificationRouter.get('/me', wrap(async (req, res) => {
  const row = await svc.mine(ctxOf(req as AuthedRequest))
  res.json({ item: row ? ser(row) : null })
}))

verificationRouter.post('/me', wrap(async (req, res) => {
  res.status(201).json({ item: ser(await svc.submit(ctxOf(req as AuthedRequest), validate(submitBody, req.body))) })
}))

verificationRouter.get('/', staff, wrap(async (req, res) => {
  res.json({ items: (await svc.list(ctxOf(req as AuthedRequest), validate(listQuery, req.query))).map(ser) })
}))

verificationRouter.post('/:id/verify', staff, wrap(async (req, res) => {
  res.json({ item: ser(await svc.decide(ctxOf(req as AuthedRequest), req.params.id, 'Verified')) })
}))

verificationRouter.post('/:id/reject', staff, wrap(async (req, res) => {
  const body = validate(rejectBody, req.body ?? {})
  res.json({ item: ser(await svc.decide(ctxOf(req as AuthedRequest), req.params.id, 'Rejected', body.note)) })
}))
