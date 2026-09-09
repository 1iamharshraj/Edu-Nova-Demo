import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import {
  serializePickupPerson, serializePickupEvent, serializeVisitor,
} from './service'
import {
  createPickupPerson, patchPickupPerson, pickupPersonQuery,
  createPickupEvent, pickupEventQuery, verifyOtpBody,
  createVisitor, visitorQuery,
} from './schema'

// /api/safety — see phase-22-campus-safety.md → items 1-2. (Item 3's counseling-records/anonymous-reports
// routes are also mounted under /api/safety per the spec, but their code lives in modules/counseling/ —
// see that router's header.) RBAC here is the plain per-route requireRole/isStaff style, unlike
// counseling's per-record checks — items 1-2 have no "one specific person only" visibility rule.
export const safetyRouter = Router()
safetyRouter.use(requireAuth)

// ── Authorized pickup people ──
safetyRouter.get('/authorized-pickups', wrap(async (req, res) => {
  res.json({ items: await svc.listPickupPeople(ctxOf(req as AuthedRequest), validate(pickupPersonQuery, req.query)) })
}))
safetyRouter.post('/authorized-pickups', wrap(async (req, res) => {
  res.status(201).json({ item: serializePickupPerson(await svc.createPickupPersonSvc(ctxOf(req as AuthedRequest), validate(createPickupPerson, req.body))) })
}))
safetyRouter.patch('/authorized-pickups/:id', wrap(async (req, res) => {
  res.json({ item: serializePickupPerson(await svc.updatePickupPerson(ctxOf(req as AuthedRequest), req.params.id, validate(patchPickupPerson, req.body))) })
}))
safetyRouter.delete('/authorized-pickups/:id', wrap(async (req, res) => {
  await svc.deletePickupPerson(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ── Pickup events + OTP ──
safetyRouter.get('/pickup-events', wrap(async (req, res) => {
  res.json({ items: await svc.listPickupEvents(ctxOf(req as AuthedRequest), validate(pickupEventQuery, req.query)) })
}))
safetyRouter.post('/pickup-events', wrap(async (req, res) => {
  res.status(201).json({ item: serializePickupEvent(await svc.createPickupEventSvc(ctxOf(req as AuthedRequest), validate(createPickupEvent, req.body))) })
}))
safetyRouter.post('/pickup-events/:id/request-otp', wrap(async (req, res) => {
  res.json({ item: await svc.requestPickupOtp(ctxOf(req as AuthedRequest), req.params.id) })
}))
safetyRouter.post('/pickup-events/:id/verify-otp', wrap(async (req, res) => {
  res.json({ item: await svc.verifyPickupOtp(ctxOf(req as AuthedRequest), req.params.id, validate(verifyOtpBody, req.body).code) })
}))

// ── Visitors ──
safetyRouter.get('/visitors', wrap(async (req, res) => {
  res.json({ items: await svc.listVisitors(ctxOf(req as AuthedRequest), validate(visitorQuery, req.query)) })
}))
safetyRouter.post('/visitors', wrap(async (req, res) => {
  res.status(201).json({ item: serializeVisitor(await svc.checkInVisitor(ctxOf(req as AuthedRequest), validate(createVisitor, req.body))) })
}))
safetyRouter.post('/visitors/:id/checkout', wrap(async (req, res) => {
  res.json({ item: serializeVisitor(await svc.checkOutVisitor(ctxOf(req as AuthedRequest), req.params.id)) })
}))
