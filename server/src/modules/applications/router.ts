import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { STAFF_ROLES } from '../../lib/scope'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeApplication } from './service'
import { createApplication, patchApplication, listQuery, declineBody } from './schema'

// /api/applications — admissions pipeline + TC / Bonafide / Character requests.
export const applicationsRouter = Router()
applicationsRouter.use(requireAuth)
const staff = requireRole(...(STAFF_ROLES as any))

applicationsRouter.get('/', wrap(async (req, res) => {
  res.json({ items: (await svc.list(ctxOf(req as AuthedRequest), validate(listQuery, req.query))).map(serializeApplication) })
}))

applicationsRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeApplication(await svc.create(ctxOf(req as AuthedRequest), validate(createApplication, req.body))) })
}))

applicationsRouter.get('/:id', wrap(async (req, res) => {
  res.json({ item: serializeApplication(await svc.get(ctxOf(req as AuthedRequest), req.params.id)) })
}))

applicationsRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeApplication(await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchApplication, req.body))) })
}))

applicationsRouter.post('/:id/verify', staff, wrap(async (req, res) => {
  res.json({ item: serializeApplication(await svc.verify(ctxOf(req as AuthedRequest), req.params.id)) })
}))

applicationsRouter.post('/:id/approve', staff, wrap(async (req, res) => {
  const { row, created } = await svc.approve(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: serializeApplication(row), ...(created ? { created } : {}) })
}))

applicationsRouter.post('/:id/decline', staff, wrap(async (req, res) => {
  const body = validate(declineBody, req.body ?? {})
  res.json({ item: serializeApplication(await svc.decline(ctxOf(req as AuthedRequest), req.params.id, body.notes)) })
}))

applicationsRouter.delete('/:id', requireRole(...WRITE_ROLES), wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
