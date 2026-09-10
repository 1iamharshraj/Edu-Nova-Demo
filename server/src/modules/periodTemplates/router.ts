import { Router } from 'express'
import { wrap, HttpError } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import type { AuthedRequest } from '../../auth'
import * as svc from './service'
import { createPeriodTemplate, patchPeriodTemplate, createPeriodTemplateOverride, patchPeriodTemplateOverride } from './schema'

export const periodTemplatesRouter = Router()
const write = requireRole(...WRITE_ROLES)

periodTemplatesRouter.get('/', wrap(async (req, res) => {
  const items = await svc.list(ctxOf(req as AuthedRequest))
  res.json({ items: items.map(svc.serializePeriodTemplate) })
}))

periodTemplatesRouter.post('/', write, wrap(async (req, res) => {
  const item = await svc.create(ctxOf(req as AuthedRequest), validate(createPeriodTemplate, req.body))
  res.status(201).json({ item: svc.serializePeriodTemplate(item) })
}))

periodTemplatesRouter.post('/:id/set-default', write, wrap(async (req, res) => {
  const item = await svc.setDefault(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializePeriodTemplate(item) })
}))

periodTemplatesRouter.patch('/:id', write, wrap(async (req, res) => {
  const item = await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchPeriodTemplate, req.body))
  res.json({ item: svc.serializePeriodTemplate(item) })
}))

periodTemplatesRouter.delete('/:id', write, wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ─────────────────────────── Phase T1 §5 — day-of-week overrides (roadmap D7) ───────────────────────────

periodTemplatesRouter.get('/:id/overrides', wrap(async (req, res) => {
  const items = await svc.listOverrides(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ items: items.map(svc.serializePeriodTemplateOverride) })
}))

// GET /:id/resolve?dayOfWeek=6 → the periods that actually apply on that day (override if one exists,
// else the base template's own periods). Not called by any existing screen yet — for T4/T6.
periodTemplatesRouter.get('/:id/resolve', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const dayOfWeek = Number(req.query.dayOfWeek)
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 6) throw new HttpError(400, 'dayOfWeek must be an integer 1-6')
  await svc.get(ctx, req.params.id) // 404s if not a real base template in this school
  const row = await svc.resolveForDay(ctx.schoolId, req.params.id, dayOfWeek)
  res.json({ item: row ? svc.serializePeriodTemplateOverride(row) : null })
}))

periodTemplatesRouter.post('/overrides', write, wrap(async (req, res) => {
  const item = await svc.createOverride(ctxOf(req as AuthedRequest), validate(createPeriodTemplateOverride, req.body))
  res.status(201).json({ item: svc.serializePeriodTemplateOverride(item) })
}))

periodTemplatesRouter.patch('/overrides/:id', write, wrap(async (req, res) => {
  const item = await svc.updateOverride(ctxOf(req as AuthedRequest), req.params.id, validate(patchPeriodTemplateOverride, req.body))
  res.json({ item: svc.serializePeriodTemplateOverride(item) })
}))

periodTemplatesRouter.delete('/overrides/:id', write, wrap(async (req, res) => {
  await svc.removeOverride(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
