import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeMeeting } from './service'
import { createMeeting, decideMeeting, meetingsQuery } from './schema'

// /api/meetings — see phase-7-communication.md.
export const meetingsRouter = Router()
meetingsRouter.use(requireAuth)

meetingsRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.listMeetings(ctxOf(req as AuthedRequest), validate(meetingsQuery, req.query)) })
}))
meetingsRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeMeeting(await svc.createMeetingSvc(ctxOf(req as AuthedRequest), validate(createMeeting, req.body))) })
}))
meetingsRouter.post('/:id/approve', wrap(async (req, res) => {
  res.json({ item: serializeMeeting(await svc.approve(ctxOf(req as AuthedRequest), req.params.id, validate(decideMeeting, req.body))) })
}))
meetingsRouter.post('/:id/decline', wrap(async (req, res) => {
  res.json({ item: serializeMeeting(await svc.decline(ctxOf(req as AuthedRequest), req.params.id, validate(decideMeeting, req.body))) })
}))
meetingsRouter.post('/:id/cancel', wrap(async (req, res) => {
  res.json({ item: serializeMeeting(await svc.cancel(ctxOf(req as AuthedRequest), req.params.id)) })
}))
meetingsRouter.post('/:id/complete', wrap(async (req, res) => {
  res.json({ item: serializeMeeting(await svc.complete(ctxOf(req as AuthedRequest), req.params.id)) })
}))
