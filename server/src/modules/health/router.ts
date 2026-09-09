import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeHealth, serializeMedicationSchedule, serializeMedicationLog } from './service'
import { createHealthRecord, patchHealthRecord, healthQuery } from './schema'
import {
  createMedicationSchedule, patchMedicationSchedule, medicationScheduleQuery,
  createMedicationLog, medicationLogQuery,
} from './schema'

// /api/health — see phase-8-welfare.md.
export const healthRouter = Router()
healthRouter.use(requireAuth)

healthRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.listHealth(ctxOf(req as AuthedRequest), validate(healthQuery, req.query)) })
}))
healthRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeHealth(await svc.createHealthRecordSvc(ctxOf(req as AuthedRequest), validate(createHealthRecord, req.body))) })
}))
healthRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeHealth(await svc.updateHealthRecord(ctxOf(req as AuthedRequest), req.params.id, validate(patchHealthRecord, req.body))) })
}))
healthRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deleteHealthRecord(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
healthRouter.post('/:id/verify', wrap(async (req, res) => {
  res.json({ item: serializeHealth(await svc.verifyHealthRecord(ctxOf(req as AuthedRequest), req.params.id)) })
}))

// ── Phase 22 item 4: medication schedules + administration log ──
healthRouter.get('/medication-schedules', wrap(async (req, res) => {
  res.json({ items: await svc.listMedicationSchedules(ctxOf(req as AuthedRequest), validate(medicationScheduleQuery, req.query)) })
}))
healthRouter.post('/medication-schedules', wrap(async (req, res) => {
  res.status(201).json({ item: serializeMedicationSchedule(await svc.createMedicationScheduleSvc(ctxOf(req as AuthedRequest), validate(createMedicationSchedule, req.body))) })
}))
healthRouter.patch('/medication-schedules/:id', wrap(async (req, res) => {
  res.json({ item: serializeMedicationSchedule(await svc.updateMedicationSchedule(ctxOf(req as AuthedRequest), req.params.id, validate(patchMedicationSchedule, req.body))) })
}))
healthRouter.delete('/medication-schedules/:id', wrap(async (req, res) => {
  await svc.deleteMedicationSchedule(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
healthRouter.get('/medication-logs', wrap(async (req, res) => {
  res.json({ items: await svc.listMedicationLogs(ctxOf(req as AuthedRequest), validate(medicationLogQuery, req.query)) })
}))
healthRouter.post('/medication-logs', wrap(async (req, res) => {
  res.status(201).json({ item: serializeMedicationLog(await svc.createMedicationLogSvc(ctxOf(req as AuthedRequest), validate(createMedicationLog, req.body))) })
}))
