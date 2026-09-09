import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import * as scales from './gradeScales'
import * as reports from './reports'
import { serializeAssessment } from './service'
import { serializeGradeScale } from './gradeScales'
import { createAssessment, patchAssessment, putMarks, listQuery, createGradeScale, patchGradeScale, reportCardQuery, ranksQuery, reportCardRemarkBody } from './schema'

// /api/assessments — class scope for writes is checked in the service (class teacher / subject teacher /
// staff / admin). Grade scales are admin-managed. Static paths are declared before `/:id`.
export const assessmentsRouter = Router()
assessmentsRouter.use(requireAuth)
const admin = requireRole(...WRITE_ROLES)

assessmentsRouter.get('/grade-scales', wrap(async (req, res) => {
  res.json({ items: (await scales.list(ctxOf(req as AuthedRequest))).map(serializeGradeScale) })
}))
assessmentsRouter.post('/grade-scales', admin, wrap(async (req, res) => {
  res.status(201).json({ item: serializeGradeScale(await scales.create(ctxOf(req as AuthedRequest), validate(createGradeScale, req.body))) })
}))
assessmentsRouter.patch('/grade-scales/:id', admin, wrap(async (req, res) => {
  res.json({ item: serializeGradeScale(await scales.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchGradeScale, req.body))) })
}))
assessmentsRouter.delete('/grade-scales/:id', admin, wrap(async (req, res) => {
  await scales.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

assessmentsRouter.get('/report-card', wrap(async (req, res) => {
  const q = validate(reportCardQuery, req.query)
  res.json(await reports.reportCard(ctxOf(req as AuthedRequest), q.studentId, q.termId))
}))

assessmentsRouter.get('/ranks', wrap(async (req, res) => {
  const q = validate(ranksQuery, req.query)
  res.json(await reports.ranks(ctxOf(req as AuthedRequest), q.classId, q.termId))
}))

// Phase 20 item 3 — save the (optionally AI-drafted-then-edited, see POST /api/ai/draft-remark) overall
// report-card remark for a student's term. Static path, declared before `/:id` like the other report-card
// routes above.
assessmentsRouter.put('/report-card/remark', wrap(async (req, res) => {
  res.json(await reports.setReportCardRemark(ctxOf(req as AuthedRequest), validate(reportCardRemarkBody, req.body)))
}))

assessmentsRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.list(ctxOf(req as AuthedRequest), validate(listQuery, req.query)) })
}))

assessmentsRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeAssessment(await svc.create(ctxOf(req as AuthedRequest), validate(createAssessment, req.body)), null) })
}))

assessmentsRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeAssessment(await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchAssessment, req.body)), null) })
}))

assessmentsRouter.delete('/:id', wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

assessmentsRouter.put('/:id/marks', wrap(async (req, res) => {
  res.json({ item: serializeAssessment(await svc.putMarksFor(ctxOf(req as AuthedRequest), req.params.id, validate(putMarks, req.body)), null) })
}))

assessmentsRouter.post('/:id/publish', wrap(async (req, res) => {
  res.json({ item: serializeAssessment(await svc.setPublished(ctxOf(req as AuthedRequest), req.params.id, true), null) })
}))

assessmentsRouter.post('/:id/unpublish', wrap(async (req, res) => {
  res.json({ item: serializeAssessment(await svc.setPublished(ctxOf(req as AuthedRequest), req.params.id, false), null) })
}))
