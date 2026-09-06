import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createYear, patchYear } from './schema'

export const yearsRouter = Router()
const write = requireRole(...WRITE_ROLES)

yearsRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest))
  res.json({ items: items.map(svc.serializeYear) })
}))

yearsRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createYear, req.body))
  res.status(201).json({ item: svc.serializeYear(item) })
}))

yearsRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchYear, req.body))
  res.json({ item: svc.serializeYear(item) })
}))

yearsRouter.post('/:id/set-current', write, wrap(async (req, res) => {
  const item = await svc.setCurrent(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializeYear(item) })
}))

yearsRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
