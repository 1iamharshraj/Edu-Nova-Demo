import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeHighlight } from './service'
import { createHighlight, patchHighlight } from './schema'

// /api/highlights — see phase-9-10-integrations-hardening.md → item 2.
export const highlightsRouter = Router()
highlightsRouter.use(requireAuth)

highlightsRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.listHighlights(ctxOf(req as AuthedRequest)) })
}))
highlightsRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeHighlight(await svc.createHighlightSvc(ctxOf(req as AuthedRequest), validate(createHighlight, req.body))) })
}))
highlightsRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeHighlight(await svc.updateHighlight(ctxOf(req as AuthedRequest), req.params.id, validate(patchHighlight, req.body))) })
}))
highlightsRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deleteHighlight(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
