import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createCurriculum, patchCurriculum, curriculumQuery } from './schema'

export const curriculumRouter = Router()
const write = requireRole(...WRITE_ROLES)

// GET /curriculum?boardId&gradeId&streamId — every filter optional.
curriculumRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest), validate(curriculumQuery, req.query))
  res.json({ items: items.map(svc.serializeCurriculum) })
}))

curriculumRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createCurriculum, req.body))
  res.status(201).json({ item: svc.serializeCurriculum(item) })
}))

curriculumRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchCurriculum, req.body))
  res.json({ item: svc.serializeCurriculum(item) })
}))

curriculumRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
