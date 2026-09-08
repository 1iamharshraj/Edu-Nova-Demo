import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeCall } from './service'
import { createCall, callsQuery } from './schema'

// /api/calls — see phase-8-welfare.md.
export const callsRouter = Router()
callsRouter.use(requireAuth)

callsRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.listCalls(ctxOf(req as AuthedRequest), validate(callsQuery, req.query)) })
}))
callsRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeCall(await svc.createCallSvc(ctxOf(req as AuthedRequest), validate(createCall, req.body))) })
}))
callsRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deleteCall(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
