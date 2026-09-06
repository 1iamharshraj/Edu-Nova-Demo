import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createGuardian } from './schema'

export const guardiansRouter = Router()
const write = requireRole(...WRITE_ROLES)

guardiansRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest))
  res.json({ items: items.map(svc.serializeGuardian) })
}))

guardiansRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createGuardian, req.body))
  res.status(201).json({ item: svc.serializeGuardian(item) })
}))

guardiansRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
