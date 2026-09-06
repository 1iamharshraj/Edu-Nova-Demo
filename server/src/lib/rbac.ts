import type { Response, NextFunction } from 'express'
import type { AuthedRequest } from '../auth'
import type { Role } from '../userDefaults'

export const WRITE_ROLES: Role[] = ['admin', 'superadmin']

export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'Unauthorized' })
    if (!roles.includes(req.auth.role as Role)) return res.status(403).json({ error: 'Forbidden' })
    next()
  }
}

// Per-request context handed to services.
export interface Ctx { schoolId: string; actorId: string; role: Role }

export const ctxOf = (req: AuthedRequest): Ctx => ({
  schoolId: req.auth!.schoolId,
  actorId: req.auth!.userId,
  role: req.auth!.role as Role,
})
