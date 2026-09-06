import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createClass, patchClass } from './schema'

export const classesRouter = Router()
const write = requireRole(...WRITE_ROLES)

classesRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest))
  res.json({ items: items.map(svc.serializeClass) })
}))

classesRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createClass, req.body))
  res.status(201).json({ item: svc.serializeClass(item) })
}))

classesRouter.get('/:id/roster', wrap(async (req, res) => {
  res.json({ items: await svc.roster(ctxOf(req as AuthedRequest), req.params.id) })
}))

// Re-applies the class's curriculum to its ClassSubject rows (adds missing, never deletes).
classesRouter.post('/:id/sync-curriculum', write, wrap(async (req, res) => {
  const { item, added } = await svc.syncCurriculum(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializeClass(item), added })
}))

classesRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchClass, req.body))
  res.json({ item: svc.serializeClass(item) })
}))

classesRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
