import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import { serializeSubstitutionFull } from '../timetable/shared'
import * as svc from './service'
import { createSubstitution, substitutionQuery } from './schema'

export const substitutionsRouter = Router()
const write = requireRole(...WRITE_ROLES)

// GET /substitutions?date&teacherId&classId — every filter optional.
substitutionsRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest), validate(substitutionQuery, req.query))
  res.json({ items: items.map(serializeSubstitutionFull) })
}))

substitutionsRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createSubstitution, req.body))
  res.status(201).json({ item: serializeSubstitutionFull(item) })
}))

substitutionsRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
