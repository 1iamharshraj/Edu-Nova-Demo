import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createRoom, patchRoom, setRoomCapabilities } from './schema'

export const roomsRouter = Router()
const write = requireRole(...WRITE_ROLES)

roomsRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest))
  res.json({ items: items.map(svc.serializeRoom) })
}))

roomsRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createRoom, req.body))
  res.status(201).json({ item: svc.serializeRoom(item) })
}))

roomsRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchRoom, req.body))
  res.json({ item: svc.serializeRoom(item) })
}))

// Phase T1 §2 — dedicated set-replace endpoint for the capability multi-select on the Room admin screen.
roomsRouter.put('/:id/capabilities', write, wrap(async (req, res) => {
  const item = await svc.setCapabilities(ctxOf(req as AuthedRequest), req.params.id, validate(setRoomCapabilities, req.body))
  res.json({ item: svc.serializeRoom(item) })
}))

roomsRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
