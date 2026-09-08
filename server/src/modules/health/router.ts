import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeHealth } from './service'
import { createHealthRecord, patchHealthRecord, healthQuery } from './schema'

// /api/health — see phase-8-welfare.md.
export const healthRouter = Router()
healthRouter.use(requireAuth)

healthRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.listHealth(ctxOf(req as AuthedRequest), validate(healthQuery, req.query)) })
}))
healthRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeHealth(await svc.createHealthRecordSvc(ctxOf(req as AuthedRequest), validate(createHealthRecord, req.body))) })
}))
healthRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeHealth(await svc.updateHealthRecord(ctxOf(req as AuthedRequest), req.params.id, validate(patchHealthRecord, req.body))) })
}))
healthRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deleteHealthRecord(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
healthRouter.post('/:id/verify', wrap(async (req, res) => {
  res.json({ item: serializeHealth(await svc.verifyHealthRecord(ctxOf(req as AuthedRequest), req.params.id)) })
}))
