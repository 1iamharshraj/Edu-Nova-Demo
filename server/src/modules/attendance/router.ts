import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeSession, serializeStaff } from './service'
import { createSession, patchRecords, sessionsQuery, summaryQuery, staffBody, staffQuery, staffSummaryQuery } from './schema'

// /api/attendance — see phase-3-attendance-assessment.md. Class scope (class teacher / subject teacher /
// staff / admin) is enforced in the service; students and parents read their own rows only.
export const attendanceRouter = Router()
attendanceRouter.use(requireAuth)
const admin = requireRole(...WRITE_ROLES)
const staff = requireRole('staff', 'admin', 'superadmin')

attendanceRouter.get('/sessions', wrap(async (req, res) => {
  res.json({ items: await svc.listSessions(ctxOf(req as AuthedRequest), validate(sessionsQuery, req.query)) })
}))

attendanceRouter.post('/sessions', wrap(async (req, res) => {
  const { row, created } = await svc.upsertSession(ctxOf(req as AuthedRequest), validate(createSession, req.body))
  res.status(created ? 201 : 200).json({ item: serializeSession(row) })
}))

attendanceRouter.patch('/sessions/:id/records', wrap(async (req, res) => {
  const row = await svc.patchSessionRecords(ctxOf(req as AuthedRequest), req.params.id, validate(patchRecords, req.body))
  res.json({ item: serializeSession(row) })
}))

attendanceRouter.post('/sessions/:id/lock', wrap(async (req, res) => {
  res.json({ item: serializeSession(await svc.setLocked(ctxOf(req as AuthedRequest), req.params.id, true)) })
}))

attendanceRouter.post('/sessions/:id/unlock', admin, wrap(async (req, res) => {
  res.json({ item: serializeSession(await svc.setLocked(ctxOf(req as AuthedRequest), req.params.id, false)) })
}))

attendanceRouter.delete('/sessions/:id', admin, wrap(async (req, res) => {
  await svc.removeSession(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

attendanceRouter.get('/summary', wrap(async (req, res) => {
  res.json(await svc.summary(ctxOf(req as AuthedRequest), validate(summaryQuery, req.query)))
}))

// Staff attendance: GET is open to staff/admin (and a teacher for their own rows), POST staff/admin only.
attendanceRouter.get('/staff/summary', wrap(async (req, res) => {
  res.json(await svc.staffSummary(ctxOf(req as AuthedRequest), validate(staffSummaryQuery, req.query)))
}))

attendanceRouter.get('/staff', wrap(async (req, res) => {
  const rows = await svc.listStaff(ctxOf(req as AuthedRequest), validate(staffQuery, req.query))
  res.json({ items: rows.map(serializeStaff) })
}))

attendanceRouter.post('/staff', staff, wrap(async (req, res) => {
  res.json({ item: serializeStaff(await svc.markStaff(ctxOf(req as AuthedRequest), validate(staffBody, req.body))) })
}))
