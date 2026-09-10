import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createCapability, patchCapability } from './schema'

export const capabilitiesRouter = Router()
const write = requireRole(...WRITE_ROLES)

capabilitiesRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest))
  res.json({ items: items.map(svc.serializeCapability) })
}))

capabilitiesRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createCapability, req.body))
  res.status(201).json({ item: svc.serializeCapability(item) })
}))

// Seeds the default catalog (Physics/Chemistry/Biology/Computer Lab, Projector, Smart Board, Audio
// System) — skips codes that already exist, so it's safe to call more than once.
capabilitiesRouter.post('/seed-defaults', write, wrap(async (req, res) => {
  const added = await svc.seedDefaults(ctxOf(req as AuthedRequest))
  res.json({ added })
}))

capabilitiesRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchCapability, req.body))
  res.json({ item: svc.serializeCapability(item) })
}))

capabilitiesRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
