import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeActivity, serializeRegistration } from './service'
import { createActivity, patchActivity, activitiesQuery } from './schema'

// /api/activities — see phase-8-welfare.md.
export const activitiesRouter = Router()
activitiesRouter.use(requireAuth)

activitiesRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.listActivities(ctxOf(req as AuthedRequest), validate(activitiesQuery, req.query)) })
}))
activitiesRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeActivity(await svc.createActivitySvc(ctxOf(req as AuthedRequest), validate(createActivity, req.body))) })
}))
activitiesRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeActivity(await svc.updateActivity(ctxOf(req as AuthedRequest), req.params.id, validate(patchActivity, req.body))) })
}))
activitiesRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deleteActivity(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
activitiesRouter.post('/:id/register', wrap(async (req, res) => {
  res.status(201).json({ item: serializeRegistration(await svc.register(ctxOf(req as AuthedRequest), req.params.id)) })
}))
activitiesRouter.post('/:id/cancel', wrap(async (req, res) => {
  res.json({ item: serializeRegistration(await svc.cancelRegistration(ctxOf(req as AuthedRequest), req.params.id)) })
}))
activitiesRouter.get('/:id/registrations', wrap(async (req, res) => {
  res.json({ items: await svc.listRegistrations(ctxOf(req as AuthedRequest), req.params.id) })
}))
