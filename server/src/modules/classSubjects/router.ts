import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createClassSubject, patchClassSubject } from './schema'

export const classSubjectsRouter = Router()
const write = requireRole(...WRITE_ROLES)

classSubjectsRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest))
  res.json({ items: items.map(svc.serializeClassSubject) })
}))

classSubjectsRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createClassSubject, req.body))
  res.status(201).json({ item: svc.serializeClassSubject(item) })
}))

classSubjectsRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchClassSubject, req.body))
  res.json({ item: svc.serializeClassSubject(item) })
}))

classSubjectsRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
