import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { audit } from '../../lib/audit'
import * as svc from './service'

// /api/parents — see phase-23-parent-experience.md. Item 1: the combined multi-ward "family" view for a
// parent. Item 2: a manually-triggerable daily digest (no scheduler infrastructure exists in this
// codebase — see service.ts's comment above sendAllDigests for the production-deployment note).
export const parentsRouter = Router()
parentsRouter.use(requireAuth)

const parentOnly = requireRole('parent')
const adminOrSuper = requireRole('admin', 'superadmin')

// GET /api/parents/me/family-summary — every ward's today's-attendance, this-week's-homework, total fee
// due, next 3 upcoming calendar events (combined across all wards), and core-subject syllabus pace.
parentsRouter.get('/me/family-summary', parentOnly, wrap(async (req, res) => {
  res.json(await svc.familySummary(ctxOf(req as AuthedRequest)))
}))

// POST /api/parents/digest/send-now — admin/superadmin only, for testing/manual trigger. Sends (or skips
// if already sent today) the daily digest to every parent in the school. Real daily delivery needs an
// external scheduler calling this endpoint once a day — see service.ts's production note.
parentsRouter.post('/digest/send-now', adminOrSuper, wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const result = await svc.sendAllDigests(ctx)
  await audit(ctx.schoolId, ctx.actorId, 'send-now', 'parentDigest', ctx.schoolId, undefined, { total: result.total, sent: result.sent, skipped: result.skipped })
  res.json(result)
}))
