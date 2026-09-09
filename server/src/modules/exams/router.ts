import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { boardReadiness } from '../assessments/boardReadiness'
import {
  createSeatingPlan, autoAssignInvigilation, createInvigilationDuty, patchInvigilationDuty,
  invigilationQuery, hallTicketQuery, boardReadinessQuery,
} from './schema'

// /api/exams — see phase-25-exam-operations.md. Static paths are declared before any `/:id`.
export const examsRouter = Router()
examsRouter.use(requireAuth)

// ── item 1: seating plans ──

examsRouter.post('/seating-plans', wrap(async (req, res) => {
  const item = await svc.createSeatingPlanRow(ctxOf(req as AuthedRequest), validate(createSeatingPlan, req.body))
  res.status(201).json({ item: svc.serializeSeatingPlan(item) })
}))

examsRouter.get('/seating-plans/:id', wrap(async (req, res) => {
  const item = await svc.getSeatingPlanFull(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializeSeatingPlan(item) })
}))

examsRouter.get('/seating-plans/:id/pdf', wrap(async (req, res) => {
  const { bytes, name } = await svc.seatingPlanPdf(ctxOf(req as AuthedRequest), req.params.id)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.send(bytes)
}))

// ── item 2: invigilation ──

examsRouter.post('/invigilation/auto-assign', wrap(async (req, res) => {
  res.json(await svc.autoAssignInvigilationDuties(ctxOf(req as AuthedRequest), validate(autoAssignInvigilation, req.body)))
}))

examsRouter.get('/invigilation', wrap(async (req, res) => {
  const items = await svc.listInvigilationDuties(ctxOf(req as AuthedRequest), validate(invigilationQuery, req.query))
  res.json({ items: items.map(svc.serializeDuty) })
}))

examsRouter.post('/invigilation', wrap(async (req, res) => {
  const item = await svc.createInvigilationDutyRow(ctxOf(req as AuthedRequest), validate(createInvigilationDuty, req.body))
  res.status(201).json({ item: svc.serializeDuty(item) })
}))

examsRouter.patch('/invigilation/:id', wrap(async (req, res) => {
  const item = await svc.updateInvigilationDutyRow(ctxOf(req as AuthedRequest), req.params.id, validate(patchInvigilationDuty, req.body))
  res.json({ item: svc.serializeDuty(item) })
}))

examsRouter.delete('/invigilation/:id', wrap(async (req, res) => {
  await svc.removeInvigilationDutyRow(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

examsRouter.post('/invigilation/:id/confirm', wrap(async (req, res) => {
  const item = await svc.confirmInvigilationDuty(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializeDuty(item) })
}))

// ── item 3: hall ticket ──

examsRouter.get('/hall-ticket/:studentId', wrap(async (req, res) => {
  const q = validate(hallTicketQuery, req.query)
  const { bytes, name } = await svc.hallTicketPdf(ctxOf(req as AuthedRequest), req.params.studentId, q.termId)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.send(bytes)
}))

// ── item 4: board-exam readiness ──

examsRouter.get('/board-readiness', wrap(async (req, res) => {
  const q = validate(boardReadinessQuery, req.query)
  res.json(await boardReadiness(ctxOf(req as AuthedRequest), q.classId))
}))
