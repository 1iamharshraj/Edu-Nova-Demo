import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import { requireAuth, type AuthedRequest } from '../../auth'
import * as svc from './service'
import {
  recomputeBody, riskSnapshotsQuery, lostTimeQuery, teacherWorkloadQuery,
  patchAnalyticsSettings, homeworkLoadQuery, substituteSuggestionsQuery,
} from './schema'

// See phase-19-early-warning-analytics.md → Endpoints, all mounted at /api/analytics.
export const analyticsRouter = Router()
analyticsRouter.use(requireAuth)

const staffWrite = requireRole('staff', 'admin', 'superadmin')
const teacherPlus = requireRole('teacher', 'staff', 'admin', 'superadmin')
const adminOnly = requireRole('admin', 'superadmin')

// ── item 1 — student risk scoring ──

analyticsRouter.post('/risk-snapshots/recompute', staffWrite, wrap(async (req, res) => {
  const rows = await svc.recompute(ctxOf(req as AuthedRequest), validate(recomputeBody, req.body))
  res.json({ items: rows.map(svc.serializeSnapshot) })
}))

analyticsRouter.get('/risk-snapshots', teacherPlus, wrap(async (req, res) => {
  const items = await svc.listRiskSnapshots(ctxOf(req as AuthedRequest), validate(riskSnapshotsQuery, req.query))
  res.json({ items })
}))

// ── item 2 — lost instructional time report ──

analyticsRouter.get('/lost-time', staffWrite, wrap(async (req, res) => {
  res.json(await svc.lostTimeReport(ctxOf(req as AuthedRequest), validate(lostTimeQuery, req.query)))
}))

// ── item 3 — teacher workload balancing ──

analyticsRouter.get('/teacher-workload', teacherPlus, wrap(async (req, res) => {
  res.json(await svc.teacherWorkload(ctxOf(req as AuthedRequest), validate(teacherWorkloadQuery, req.query)))
}))

// Lightweight single-teacher lookup for the Timetable Builder's inline warning banner.
analyticsRouter.get('/teacher-workload/:teacherId', teacherPlus, wrap(async (req, res) => {
  const termId = typeof req.query.termId === 'string' ? req.query.termId : undefined
  res.json(await svc.teacherWorkloadFor(ctxOf(req as AuthedRequest), req.params.teacherId, termId))
}))

analyticsRouter.get('/settings', teacherPlus, wrap(async (req, res) => {
  res.json({ item: svc.serializeSettings(await svc.getOrCreateAnalyticsSettings(ctxOf(req as AuthedRequest))) })
}))

analyticsRouter.patch('/settings', adminOnly, wrap(async (req, res) => {
  res.json({ item: svc.serializeSettings(await svc.updateAnalyticsSettings(ctxOf(req as AuthedRequest), validate(patchAnalyticsSettings, req.body))) })
}))

// ── item 4 — homework load regulation ──

analyticsRouter.get('/homework-load', teacherPlus, wrap(async (req, res) => {
  res.json(await svc.homeworkLoad(ctxOf(req as AuthedRequest), validate(homeworkLoadQuery, req.query)))
}))

// ── item 5 — smart substitute suggestion ──

analyticsRouter.get('/substitute-suggestions', teacherPlus, wrap(async (req, res) => {
  res.json(await svc.substituteSuggestions(ctxOf(req as AuthedRequest), validate(substituteSuggestionsQuery, req.query)))
}))
