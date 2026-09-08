import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { ADMIN_ROLES } from '../../lib/scope'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeLeaveType, serializeLeaveRequest } from './service'
import { createLeaveType, patchLeaveType, createLeaveRequest, requestsQuery, decideBody, balanceQuery } from './schema'

// /api/leave — see phase-6-hr.md.
export const leaveRouter = Router()
leaveRouter.use(requireAuth)
const admin = requireRole(...(ADMIN_ROLES as any))

// ── leave types (admin) ──
leaveRouter.get('/types', wrap(async (req, res) => {
  res.json({ items: (await svc.listTypes(ctxOf(req as AuthedRequest))).map(serializeLeaveType) })
}))
leaveRouter.post('/types', admin, wrap(async (req, res) => {
  res.status(201).json({ item: serializeLeaveType(await svc.createType(ctxOf(req as AuthedRequest), validate(createLeaveType, req.body))) })
}))
leaveRouter.patch('/types/:id', admin, wrap(async (req, res) => {
  res.json({ item: serializeLeaveType(await svc.updateType(ctxOf(req as AuthedRequest), req.params.id, validate(patchLeaveType, req.body))) })
}))
leaveRouter.delete('/types/:id', admin, wrap(async (req, res) => {
  await svc.removeType(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ── requests ──
leaveRouter.get('/requests', wrap(async (req, res) => {
  res.json({ items: (await svc.listRequests(ctxOf(req as AuthedRequest), validate(requestsQuery, req.query))).map(serializeLeaveRequest) })
}))
leaveRouter.post('/requests', wrap(async (req, res) => {
  res.status(201).json({ item: serializeLeaveRequest(await svc.createRequest(ctxOf(req as AuthedRequest), validate(createLeaveRequest, req.body))) })
}))
leaveRouter.post('/requests/:id/approve', wrap(async (req, res) => {
  res.json({ item: serializeLeaveRequest(await svc.approve(ctxOf(req as AuthedRequest), req.params.id, validate(decideBody, req.body))) })
}))
leaveRouter.post('/requests/:id/decline', wrap(async (req, res) => {
  res.json({ item: serializeLeaveRequest(await svc.decline(ctxOf(req as AuthedRequest), req.params.id, validate(decideBody, req.body))) })
}))
leaveRouter.post('/requests/:id/cancel', wrap(async (req, res) => {
  res.json({ item: serializeLeaveRequest(await svc.cancel(ctxOf(req as AuthedRequest), req.params.id)) })
}))

// ── balance ──
leaveRouter.get('/balance', wrap(async (req, res) => {
  res.json(await svc.balance(ctxOf(req as AuthedRequest), validate(balanceQuery, req.query)))
}))
