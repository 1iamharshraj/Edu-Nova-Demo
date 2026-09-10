import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import {
  createBand, patchBand, createTemplate, patchTemplate, generateBody, approveBody, moveBody,
  createRule, patchRule, trackRegisterBody, exceptionsQuery,
} from './schema'

// /api/sectioning — see phase-t3-sectioning-engine.md. This module places real students into real
// sections/tracks, so every mutation is gated to WRITE_ROLES (admin/superadmin) except track
// self-registration, which is open to the student it registers (staff/admin may register on a student's
// behalf — enforced inside svc.trackRegister).
export const sectioningRouter = Router()
sectioningRouter.use(requireAuth)
const write = requireRole(...WRITE_ROLES)

// ── Bands ──
sectioningRouter.get('/bands', wrap(async (req, res) => {
  const items = await svc.listBands(ctxOf(req as AuthedRequest), req.query.academicYearId as string | undefined)
  res.json({ items: items.map(svc.serializeBand) })
}))
sectioningRouter.post('/bands', write, wrap(async (req, res) => {
  const item = await svc.createBandSvc(ctxOf(req as AuthedRequest), validate(createBand, req.body))
  res.status(201).json({ item: svc.serializeBand(item) })
}))
sectioningRouter.patch('/bands/:id', write, wrap(async (req, res) => {
  const item = await svc.updateBand(ctxOf(req as AuthedRequest), req.params.id, validate(patchBand, req.body))
  res.json({ item: svc.serializeBand(item) })
}))
sectioningRouter.delete('/bands/:id', write, wrap(async (req, res) => {
  await svc.removeBand(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ── Templates ──
sectioningRouter.get('/templates', wrap(async (req, res) => {
  const items = await svc.listTemplates(ctxOf(req as AuthedRequest), {
    academicYearId: req.query.academicYearId as string | undefined, gradeId: req.query.gradeId as string | undefined,
  })
  res.json({ items: items.map(svc.serializeTemplate) })
}))
sectioningRouter.post('/templates', write, wrap(async (req, res) => {
  const item = await svc.createTemplateSvc(ctxOf(req as AuthedRequest), validate(createTemplate, req.body))
  res.status(201).json({ item: svc.serializeTemplate(item) })
}))
sectioningRouter.patch('/templates/:id', write, wrap(async (req, res) => {
  const item = await svc.updateTemplateSvc(ctxOf(req as AuthedRequest), req.params.id, validate(patchTemplate, req.body))
  res.json({ item: svc.serializeTemplate(item) })
}))
sectioningRouter.delete('/templates/:id', write, wrap(async (req, res) => {
  await svc.removeTemplate(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ── Generation / versions / approval / moves ──
sectioningRouter.post('/templates/:id/generate', write, wrap(async (req, res) => {
  const body = validate(generateBody, req.body ?? {})
  const item = await svc.generateDraft(ctxOf(req as AuthedRequest), req.params.id, body.scopeCohortId)
  res.status(201).json({ item: svc.serializeVersion(item) })
}))
sectioningRouter.get('/templates/:id/versions', wrap(async (req, res) => {
  const items = await svc.listVersions(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ items: items.map(svc.serializeVersion) })
}))
sectioningRouter.get('/versions/:id', wrap(async (req, res) => {
  const item = await svc.getVersion(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializeVersion(item) })
}))
sectioningRouter.post('/versions/:id/approve', write, wrap(async (req, res) => {
  const body = validate(approveBody, req.body ?? {})
  const item = await svc.approveVersion(ctxOf(req as AuthedRequest), req.params.id, !!body.force)
  res.json({ item: svc.serializeVersion(item) })
}))
sectioningRouter.post('/moves', write, wrap(async (req, res) => {
  const item = await svc.moveStudent(ctxOf(req as AuthedRequest), validate(moveBody, req.body))
  res.status(201).json({ item })
}))

// ── Track eligibility rules ──
sectioningRouter.get('/track-eligibility-rules', wrap(async (req, res) => {
  const items = await svc.listRules(ctxOf(req as AuthedRequest), req.query.trackActivityId as string | undefined)
  res.json({ items: items.map(svc.serializeRule) })
}))
sectioningRouter.post('/track-eligibility-rules', write, wrap(async (req, res) => {
  const item = await svc.createRuleSvc(ctxOf(req as AuthedRequest), validate(createRule, req.body))
  res.status(201).json({ item: svc.serializeRule(item) })
}))
sectioningRouter.patch('/track-eligibility-rules/:id', write, wrap(async (req, res) => {
  const item = await svc.updateRuleSvc(ctxOf(req as AuthedRequest), req.params.id, validate(patchRule, req.body))
  res.json({ item: svc.serializeRule(item) })
}))
sectioningRouter.delete('/track-eligibility-rules/:id', write, wrap(async (req, res) => {
  await svc.removeRule(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ── Track registration (Stage 1) + exceptions report ──
sectioningRouter.post('/tracks/:activityId/register', wrap(async (req, res) => {
  const body = validate(trackRegisterBody, req.body ?? {})
  const result = await svc.trackRegister(ctxOf(req as AuthedRequest), req.params.activityId, body)
  res.status(201).json(result)
}))
sectioningRouter.get('/track-eligibility-exceptions', wrap(async (req, res) => {
  const q = validate(exceptionsQuery, req.query)
  const items = await svc.exceptionsReport(ctxOf(req as AuthedRequest), q)
  res.json({ items })
}))
