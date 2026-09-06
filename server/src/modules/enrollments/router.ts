import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createEnrollment, patchEnrollment } from './schema'

export const enrollmentsRouter = Router()
const write = requireRole(...WRITE_ROLES)

enrollmentsRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest))
  res.json({ items: items.map(svc.serializeEnrollment) })
}))

enrollmentsRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createEnrollment, req.body))
  res.status(201).json({ item: svc.serializeEnrollment(item) })
}))

enrollmentsRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchEnrollment, req.body))
  res.json({ item: svc.serializeEnrollment(item) })
}))

enrollmentsRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
