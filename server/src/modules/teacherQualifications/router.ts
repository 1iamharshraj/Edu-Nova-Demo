import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createTeacherQualification, patchTeacherQualification } from './schema'

export const teacherQualificationsRouter = Router()
const write = requireRole(...WRITE_ROLES)

// ?teacherId= for the per-teacher qualifications editor on the teacher profile/People screen.
teacherQualificationsRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest), { teacherId: req.query.teacherId as string | undefined })
  res.json({ items: items.map(svc.serializeTeacherQualification) })
}))

teacherQualificationsRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createTeacherQualification, req.body))
  res.status(201).json({ item: svc.serializeTeacherQualification(item) })
}))

teacherQualificationsRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchTeacherQualification, req.body))
  res.json({ item: svc.serializeTeacherQualification(item) })
}))

teacherQualificationsRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
