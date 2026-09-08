import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeEvent } from './service'
import { createEvent, patchEvent, eventsQuery } from './schema'

// /api/calendar — see phase-7-communication.md.
export const calendarRouter = Router()
calendarRouter.use(requireAuth)

calendarRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.listEvents(ctxOf(req as AuthedRequest), validate(eventsQuery, req.query)) })
}))
calendarRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeEvent(await svc.createEventSvc(ctxOf(req as AuthedRequest), validate(createEvent, req.body))) })
}))
calendarRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeEvent(await svc.updateEvent(ctxOf(req as AuthedRequest), req.params.id, validate(patchEvent, req.body))) })
}))
calendarRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deleteEvent(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
