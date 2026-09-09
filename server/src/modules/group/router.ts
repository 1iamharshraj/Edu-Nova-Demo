import { Router } from 'express'
import { wrap, HttpError } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import { requireAuth, type AuthedRequest } from '../../auth'
import { requireGroupAccess, type GroupAuthedRequest } from './access'
import * as svc from './service'
import { createGroupBody, addSchoolBody, grantAdminBody, overviewQuery, drilldownQuery } from './schema'

// See phase-28-multi-school-group.md. Mounted at /api/group in src/app.ts.
//
// Every route below requires the ordinary bearer-token login (requireAuth). Beyond that, this module
// deliberately uses TWO independent, non-overlapping authorization checks — never both on the same route:
//   1. The existing single-school requireRole()/ctxOf() (server/src/lib/rbac.ts) — used only where the
//      action is inherently about ONE school the caller already administers (POST /, POST /:id/schools).
//   2. The new, fully separate requireGroupAccess() (./access.ts) — used everywhere the action is about a
//      SchoolGroup the caller has been explicitly granted GroupAdmin/GroupViewer on.
export const groupRouter = Router()
groupRouter.use(requireAuth)

// ── self-lookup: "am I a group member, and what group is my own school part of" — no group-specific
// access check needed, it only ever looks up the caller's own memberships/school. Powers the frontend's
// "Group" nav-item gate and the per-school admin's "which group is my school part of" indicator. ──
groupRouter.get('/mine', wrap(async (req, res) => {
  const auth = (req as AuthedRequest).auth!
  const result = await svc.myMemberships(auth.userId, auth.schoolId)
  res.json(result)
}))

// ── group + membership management — gated by the EXISTING single-school requireRole('superadmin'), not
// assertGroupAccess (the group doesn't have any admins yet at creation time). Platform-level action,
// documented limitation: restricted to a superadmin of ANY school (see service.ts#createGroup). ──
groupRouter.post('/', requireRole('superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const body = validate(createGroupBody, req.body)
  const group = await svc.createGroup(ctx.actorId, ctx.schoolId, body.name)
  res.status(201).json({ item: svc.serializeGroup(group) })
}))

// Adds the CALLER'S OWN school (ctx.schoolId) to the group — never an arbitrary schoolId — so a school
// only ever joins a group with its own superadmin's consent. If a body.schoolId is passed it must match.
groupRouter.post('/:id/schools', requireRole('superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const body = validate(addSchoolBody, req.body ?? {})
  if (body.schoolId && body.schoolId !== ctx.schoolId) {
    throw new HttpError(403, 'You can only add your own school to a group')
  }
  const school = await svc.addSchool(ctx, req.params.id)
  res.status(201).json({ item: { id: school.id, name: school.name, groupId: school.groupId } })
}))

// Group's existing admins only (assertGroupAdminRole inside svc.grantAdmin — a GroupViewer is read-only).
groupRouter.post('/:id/admins', requireGroupAccess('id'), wrap(async (req, res) => {
  const auth = (req as AuthedRequest).auth!
  const gctx = (req as GroupAuthedRequest).groupCtx!
  const body = validate(grantAdminBody, req.body)
  const row = await svc.grantAdmin(gctx, auth.schoolId, body)
  res.status(201).json({ item: svc.serializeGroupAdmin(row) })
}))

groupRouter.get('/:id/admins', requireGroupAccess('id'), wrap(async (req, res) => {
  const items = await svc.listAdmins(req.params.id)
  res.json({ items })
}))

// ── strictly read-only cross-campus aggregation — gated by requireGroupAccess (assertGroupAccess), not
// the existing role system at all. ──

groupRouter.get('/:groupId/schools', requireGroupAccess('groupId'), wrap(async (req, res) => {
  const items = await svc.listSchools(req.params.groupId)
  res.json({ items })
}))

groupRouter.get('/:groupId/overview', requireGroupAccess('groupId'), wrap(async (req, res) => {
  const gctx = (req as GroupAuthedRequest).groupCtx!
  const q = validate(overviewQuery, req.query)
  const result = await svc.overview(gctx.groupId, gctx.actorId, q.termId)
  res.json(result)
}))

groupRouter.get('/:groupId/school/:schoolId/drilldown', requireGroupAccess('groupId'), wrap(async (req, res) => {
  const gctx = (req as GroupAuthedRequest).groupCtx!
  const q = validate(drilldownQuery, req.query)
  const result = await svc.drilldown(gctx, req.params.schoolId, q)
  res.json(result)
}))
