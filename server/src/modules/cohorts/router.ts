import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createCohort, patchCohort } from './schema'

export const cohortsRouter = Router()
const write = requireRole(...WRITE_ROLES)

cohortsRouter.get('/', wrap(async (req, res) => {
  const filter = { academicYearId: req.query.academicYearId as string | undefined, type: req.query.type as string | undefined }
  const items = await svc.list(ctxOf(req as AuthedRequest), filter)
  res.json({ items: items.map(svc.serializeCohort) })
}))

cohortsRouter.get('/:id', wrap(async (req, res) => {
  const item = await svc.get(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializeCohort(item) })
}))

cohortsRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createCohort, req.body))
  res.status(201).json({ item: svc.serializeCohort(item) })
}))

cohortsRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchCohort, req.body))
  res.json({ item: svc.serializeCohort(item) })
}))

cohortsRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
