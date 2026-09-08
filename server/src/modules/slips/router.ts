import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeSlip } from './service'
import { createSlip, patchSlip, respondSlip, slipsQuery } from './schema'

// /api/slips — see phase-8-welfare.md.
export const slipsRouter = Router()
slipsRouter.use(requireAuth)

slipsRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.listSlips(ctxOf(req as AuthedRequest), validate(slipsQuery, req.query)) })
}))
slipsRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeSlip(await svc.createSlipSvc(ctxOf(req as AuthedRequest), validate(createSlip, req.body))) })
}))
slipsRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeSlip(await svc.updateSlip(ctxOf(req as AuthedRequest), req.params.id, validate(patchSlip, req.body))) })
}))
slipsRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deleteSlip(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
slipsRouter.get('/:id/responses', wrap(async (req, res) => {
  res.json({ items: await svc.listResponses(ctxOf(req as AuthedRequest), req.params.id) })
}))
slipsRouter.post('/:id/respond', wrap(async (req, res) => {
  res.status(201).json({ item: await svc.respond(ctxOf(req as AuthedRequest), req.params.id, validate(respondSlip, req.body)) })
}))
