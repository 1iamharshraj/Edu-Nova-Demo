import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeConduct } from './service'
import { createConduct, patchConduct, conductQuery } from './schema'

// /api/staff-conduct — see phase-11-employee-management.md → A5. Strictly HR/admin/superadmin: not the
// employee's manager, not the employee themselves, no plain 'staff' access either.
export const staffConductRouter = Router()
staffConductRouter.use(requireAuth, requireRole('admin', 'superadmin'))

staffConductRouter.get('/', wrap(async (req, res) => {
  res.json({ items: (await svc.listConduct(ctxOf(req as AuthedRequest), validate(conductQuery, req.query))).map(serializeConduct) })
}))
staffConductRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeConduct(await svc.createConductRow(ctxOf(req as AuthedRequest), validate(createConduct, req.body))) })
}))
staffConductRouter.get('/:id', wrap(async (req, res) => {
  res.json({ item: serializeConduct(await svc.getConduct(ctxOf(req as AuthedRequest), req.params.id)) })
}))
staffConductRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeConduct(await svc.updateConduct(ctxOf(req as AuthedRequest), req.params.id, validate(patchConduct, req.body))) })
}))
