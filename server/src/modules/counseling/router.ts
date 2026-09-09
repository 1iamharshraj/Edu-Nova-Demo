import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeCounselingRecord, serializeAnonymousReport } from './service'
import {
  createCounselingRecord, patchCounselingRecord, counselingQuery, counselingSettingsBody,
  createAnonymousReport, patchAnonymousReport, anonymousReportQuery,
} from './schema'

// Mounted at /api/safety (see app.ts) — the spec's endpoint paths are /api/safety/counseling-records and
// /api/safety/anonymous-reports, even though the CODE lives in its own modules/counseling/ folder (a
// separate module from modules/safety/ and modules/health/ on purpose — see service.ts header). Its RBAC
// is enforced almost entirely in the service (per-record, not per-route), because "counselor-only, plus
// opt-in oversight" cannot be expressed as a single requireRole() list the way staffConduct's flat
// admin/superadmin gate can.
export const counselingRouter = Router()
counselingRouter.use(requireAuth)

// CounselingRecord — every route requires auth; the service enforces the narrow visibility/ownership
// rule on top (see service.ts#canAccessCounselingRecord / #assertIsCounselor). Deliberately NOT gated by
// requireRole() here — a non-counselor staff/admin must get a clean 403 from the SAME check a counselor
// would pass, not be turned away earlier by a coarser role gate that could quietly diverge from it.
counselingRouter.get('/counseling-records', wrap(async (req, res) => {
  res.json({ items: await svc.listCounselingRecords(ctxOf(req as AuthedRequest), validate(counselingQuery, req.query)) })
}))
counselingRouter.post('/counseling-records', wrap(async (req, res) => {
  res.status(201).json({ item: serializeCounselingRecord(await svc.createCounselingRecordSvc(ctxOf(req as AuthedRequest), validate(createCounselingRecord, req.body))) })
}))
counselingRouter.get('/counseling-records/:id', wrap(async (req, res) => {
  res.json({ item: serializeCounselingRecord(await svc.getCounselingRecord(ctxOf(req as AuthedRequest), req.params.id)) })
}))
counselingRouter.patch('/counseling-records/:id', wrap(async (req, res) => {
  res.json({ item: serializeCounselingRecord(await svc.updateCounselingRecord(ctxOf(req as AuthedRequest), req.params.id, validate(patchCounselingRecord, req.body))) })
}))
counselingRouter.delete('/counseling-records/:id', wrap(async (req, res) => {
  await svc.deleteCounselingRecord(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// Admin-set oversight toggle (default off — see spec). admin/superadmin only.
counselingRouter.get('/counseling-settings', requireRole('admin', 'superadmin'), wrap(async (req, res) => {
  res.json({ item: await svc.getCounselingSettings(ctxOf(req as AuthedRequest)) })
}))
counselingRouter.patch('/counseling-settings', requireRole('admin', 'superadmin'), wrap(async (req, res) => {
  res.json({ item: await svc.setCounselingSettings(ctxOf(req as AuthedRequest), validate(counselingSettingsBody, req.body).oversightEnabled) })
}))

// AnonymousReport — POST open to any authenticated student/parent (service checks role; deliberately no
// requireRole() here either, so the 403 path for e.g. a teacher trying to submit runs through the exact
// same code as everything else in this module). GET/PATCH: counselor + admin/superadmin only.
counselingRouter.post('/anonymous-reports', wrap(async (req, res) => {
  res.status(201).json({ item: serializeAnonymousReport(await svc.createAnonymousReportSvc(ctxOf(req as AuthedRequest), validate(createAnonymousReport, req.body))) })
}))
counselingRouter.get('/anonymous-reports', wrap(async (req, res) => {
  res.json({ items: await svc.listAnonymousReports(ctxOf(req as AuthedRequest), validate(anonymousReportQuery, req.query)) })
}))
counselingRouter.get('/anonymous-reports/:id', wrap(async (req, res) => {
  res.json({ item: serializeAnonymousReport(await svc.getAnonymousReport(ctxOf(req as AuthedRequest), req.params.id)) })
}))
counselingRouter.patch('/anonymous-reports/:id', wrap(async (req, res) => {
  res.json({ item: serializeAnonymousReport(await svc.updateAnonymousReport(ctxOf(req as AuthedRequest), req.params.id, validate(patchAnonymousReport, req.body))) })
}))
