import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createWorkingDayPattern, patchWorkingDayPattern } from './schema'

export const workingDayPatternsRouter = Router()
const write = requireRole(...WRITE_ROLES)

workingDayPatternsRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest), { academicYearId: req.query.academicYearId as string | undefined })
  res.json({ items: items.map(svc.serializeWorkingDayPattern) })
}))

workingDayPatternsRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createWorkingDayPattern, req.body))
  res.status(201).json({ item: svc.serializeWorkingDayPattern(item) })
}))

workingDayPatternsRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchWorkingDayPattern, req.body))
  res.json({ item: svc.serializeWorkingDayPattern(item) })
}))

workingDayPatternsRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
