import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeHomework, serializeSubmission } from './service'
import { createHomework, patchHomework, listQuery, submitBody, gradeBody } from './schema'

// /api/homework — teacher/staff/admin write within class scope; students submit; parents read wards'.
export const homeworkRouter = Router()
homeworkRouter.use(requireAuth)

homeworkRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.list(ctxOf(req as AuthedRequest), validate(listQuery, req.query)) })
}))

homeworkRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeHomework(await svc.create(ctxOf(req as AuthedRequest), validate(createHomework, req.body)), null) })
}))

homeworkRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeHomework(await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchHomework, req.body)), null) })
}))

homeworkRouter.delete('/:id', wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

homeworkRouter.post('/:id/submit', wrap(async (req, res) => {
  res.json({ item: serializeSubmission(await svc.submit(ctxOf(req as AuthedRequest), req.params.id, validate(submitBody, req.body ?? {}))) })
}))

homeworkRouter.patch('/:id/submissions/:studentId', wrap(async (req, res) => {
  res.json({ item: serializeSubmission(await svc.grade(ctxOf(req as AuthedRequest), req.params.id, req.params.studentId, validate(gradeBody, req.body))) })
}))
