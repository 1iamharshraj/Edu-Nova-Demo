import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createTerm, patchTerm } from './schema'

export const termsRouter = Router()
const write = requireRole(...WRITE_ROLES)

termsRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest))
  res.json({ items: items.map(svc.serializeTerm) })
}))

termsRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createTerm, req.body))
  res.status(201).json({ item: svc.serializeTerm(item) })
}))

termsRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchTerm, req.body))
  res.json({ item: svc.serializeTerm(item) })
}))

termsRouter.post('/:id/set-current', write, wrap(async (req, res) => {
  const item = await svc.setCurrent(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializeTerm(item) })
}))

termsRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
