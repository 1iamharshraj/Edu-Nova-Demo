import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { subscribeBody, unsubscribeBody } from './schema'

// /api/push — see phase-9-10-integrations-hardening.md → item 4 (PWA push).
export const pushRouter = Router()

// Public: the frontend needs this before it knows whether push is even configured, ahead of login in some flows.
pushRouter.get('/vapid-public-key', (_req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY ?? null })
})

pushRouter.use(requireAuth)

pushRouter.post('/subscribe', wrap(async (req, res) => {
  res.status(201).json(await svc.subscribe(ctxOf(req as AuthedRequest), validate(subscribeBody, req.body)))
}))
pushRouter.delete('/subscribe', wrap(async (req, res) => {
  await svc.unsubscribe(ctxOf(req as AuthedRequest), validate(unsubscribeBody, req.body))
  res.json({ ok: true })
}))
