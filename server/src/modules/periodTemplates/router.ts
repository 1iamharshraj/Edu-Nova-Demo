import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createPeriodTemplate, patchPeriodTemplate } from './schema'

export const periodTemplatesRouter = Router()
const write = requireRole(...WRITE_ROLES)

periodTemplatesRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest))
  res.json({ items: items.map(svc.serializePeriodTemplate) })
}))

periodTemplatesRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createPeriodTemplate, req.body))
  res.status(201).json({ item: svc.serializePeriodTemplate(item) })
}))

periodTemplatesRouter.post('/:id/set-default', write, wrap(async (req, res) => {
  const item = await svc.setDefault(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializePeriodTemplate(item) })
}))

periodTemplatesRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchPeriodTemplate, req.body))
  res.json({ item: svc.serializePeriodTemplate(item) })
}))

periodTemplatesRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
