import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { STAFF_ROLES, ADMIN_ROLES } from '../../lib/scope'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeScholarship, serializeAward } from './service'
import { createScholarship, patchScholarship, scholarshipQuery, createAward, awardQuery, rejectAward } from './schema'

// /api/scholarships — see phase-21-financial-intelligence.md item 4. Scholarship *programs* (the
// catalog) are defined/edited by admin/superadmin only (financial policy); staff/admin/superadmin may
// propose an award against one; only admin/superadmin may approve or reject it. A parent/student may
// only ever see their own child's/their own awards (enforced in service.ts, not just the router).
//
// `/awards*` routes are registered before the generic `/:id` scholarship route below so the literal
// segment "awards" is never swallowed by the `:id` param route (Express matches route registrations in
// order, not by specificity) — e.g. GET /awards must hit the awards list handler, not
// getScholarship(ctx, "awards").
export const scholarshipsRouter = Router()
scholarshipsRouter.use(requireAuth)

const adminWrite = requireRole(...(ADMIN_ROLES as any))
const staffWrite = requireRole(...(STAFF_ROLES as any))

// ── awards ──
scholarshipsRouter.get('/awards', wrap(async (req, res) => {
  res.json({ items: (await svc.listAwards(ctxOf(req as AuthedRequest), validate(awardQuery, req.query))).map(serializeAward) })
}))
scholarshipsRouter.post('/awards', staffWrite, wrap(async (req, res) => {
  res.status(201).json({ item: serializeAward(await svc.proposeAward(ctxOf(req as AuthedRequest), validate(createAward, req.body))) })
}))
scholarshipsRouter.get('/awards/:id', wrap(async (req, res) => {
  res.json({ item: serializeAward(await svc.getAward(ctxOf(req as AuthedRequest), req.params.id)) })
}))
scholarshipsRouter.post('/awards/:id/approve', adminWrite, wrap(async (req, res) => {
  res.json({ item: serializeAward(await svc.approveAward(ctxOf(req as AuthedRequest), req.params.id)) })
}))
scholarshipsRouter.post('/awards/:id/reject', adminWrite, wrap(async (req, res) => {
  res.json({ item: serializeAward(await svc.rejectAwardRow(ctxOf(req as AuthedRequest), req.params.id, validate(rejectAward, req.body ?? {}))) })
}))

// ── scholarships (programs) ──
scholarshipsRouter.get('/', staffWrite, wrap(async (req, res) => {
  res.json({ items: (await svc.listScholarships(ctxOf(req as AuthedRequest), validate(scholarshipQuery, req.query))).map(serializeScholarship) })
}))
scholarshipsRouter.post('/', adminWrite, wrap(async (req, res) => {
  res.status(201).json({ item: serializeScholarship(await svc.createScholarshipRow(ctxOf(req as AuthedRequest), validate(createScholarship, req.body))) })
}))
scholarshipsRouter.get('/:id', staffWrite, wrap(async (req, res) => {
  res.json({ item: serializeScholarship(await svc.getScholarship(ctxOf(req as AuthedRequest), req.params.id)) })
}))
scholarshipsRouter.patch('/:id', adminWrite, wrap(async (req, res) => {
  res.json({ item: serializeScholarship(await svc.updateScholarshipRow(ctxOf(req as AuthedRequest), req.params.id, validate(patchScholarship, req.body))) })
}))
scholarshipsRouter.delete('/:id', adminWrite, wrap(async (req, res) => {
  await svc.removeScholarshipRow(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
