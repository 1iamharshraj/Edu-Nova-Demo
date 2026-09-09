import type { NextFunction, Response } from 'express'
import { prisma } from '../../prisma'
import { HttpError } from '../../lib/errors'
import type { AuthedRequest } from '../../auth'

// Phase 28 — multi-school/group management. Deliberately NOT built on server/src/lib/rbac.ts's
// Ctx/requireRole(). That system resolves exactly one school per request (Ctx.schoolId, taken from the
// caller's own User.schoolId) and every other module in this app depends on it working exactly that way.
// Cross-school "group" access is a completely separate axis of authorization — "is this user a
// GroupAdmin/GroupViewer of THIS SchoolGroup" — with no relationship to the caller's own schoolId or role.
// So it gets its own, fully isolated middleware/ctx that only /api/group/* routes opt into. Nothing here
// is imported by, or modifies, server/src/lib/rbac.ts or server/src/lib/scope.ts.

export type GroupRole = 'GroupAdmin' | 'GroupViewer'

export interface GroupCtx {
  actorId: string
  groupId: string
  groupRole: GroupRole
}

export interface GroupAuthedRequest extends AuthedRequest {
  groupCtx?: GroupCtx
}

// Resolves + validates group membership without going anywhere near Ctx/requireRole(). Exported so it can
// also be called directly from a handler when the group id isn't known until a prior lookup happens.
export async function assertGroupAccess(actorId: string, groupId: string): Promise<GroupCtx> {
  const grant = await prisma.groupAdmin.findUnique({ where: { groupId_userId: { groupId, userId: actorId } } })
  // Deliberately a flat 403 whether the group id doesn't exist at all or the caller simply isn't a member
  // of it — never lets a non-member probe for which group ids exist.
  if (!grant) throw new HttpError(403, 'Forbidden — you are not a group admin/viewer of this school group')
  return { actorId, groupId, groupRole: grant.role as GroupRole }
}

// Express middleware wrapping assertGroupAccess for a route param. `paramName` defaults to 'groupId'
// (the read-only aggregation routes: /:groupId/schools, /:groupId/overview, /:groupId/school/:schoolId/
// drilldown) — pass 'id' for the /api/group/:id/admins management route, matching the spec's literal
// route paths.
export function requireGroupAccess(paramName = 'groupId') {
  return (req: GroupAuthedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) return next(new HttpError(401, 'Unauthorized'))
    const groupId = req.params[paramName]
    if (!groupId) return next(new HttpError(400, `Missing route param :${paramName}`))
    assertGroupAccess(req.auth.userId, groupId)
      .then(gctx => { req.groupCtx = gctx; next() })
      .catch(next)
  }
}

// Some mutations (granting admins) are restricted to full 'GroupAdmin' members — a 'GroupViewer' is
// read-only even within the group's own management surface.
export function assertGroupAdminRole(gctx: GroupCtx) {
  if (gctx.groupRole !== 'GroupAdmin') throw new HttpError(403, 'GroupAdmin role required (GroupViewer is read-only)')
}
