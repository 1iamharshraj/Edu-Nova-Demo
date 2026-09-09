import { Router } from 'express'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import { requireAuth, type AuthedRequest } from '../../auth'
import * as svc from './service'
import {
  createChapter, patchChapter, chaptersQuery,
  createChapterResource, chapterResourcesQuery,
  patchProgress, progressQuery,
  createTarget, patchTarget, targetsQuery,
  paceQuery, coverageQuery,
} from './schema'

// See phase-18-syllabus-tracking.md → Endpoints.
export const syllabusRouter = Router()
syllabusRouter.use(requireAuth)

const staffWrite = requireRole('staff', 'admin', 'superadmin')

// ── chapters — staff/admin/superadmin write, everyone read ──

syllabusRouter.get('/chapters', wrap(async (req, res) => {
  const items = await svc.listChapters(ctxOf(req as AuthedRequest), validate(chaptersQuery, req.query))
  res.json({ items: items.map(svc.serializeChapter) })
}))

syllabusRouter.post('/chapters', staffWrite, wrap(async (req, res) => {
  const item = await svc.createChapterRow(ctxOf(req as AuthedRequest), validate(createChapter, req.body))
  res.status(201).json({ item: svc.serializeChapter(item) })
}))

syllabusRouter.patch('/chapters/:id', staffWrite, wrap(async (req, res) => {
  const item = await svc.updateChapterRow(ctxOf(req as AuthedRequest), req.params.id, validate(patchChapter, req.body))
  res.json({ item: svc.serializeChapter(item) })
}))

syllabusRouter.delete('/chapters/:id', staffWrite, wrap(async (req, res) => {
  await svc.removeChapterRow(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ── chapter resources — staff/admin/superadmin + the teachers of that curriculum-subject ──
// (write role gate is done inside the service since "teacher of this curriculum-subject" isn't a
// role-level check; requireAuth alone is enough here, service throws 403 as needed)

syllabusRouter.get('/chapter-resources', wrap(async (req, res) => {
  const q = validate(chapterResourcesQuery, req.query)
  if (!q.chapterId) return res.json({ items: [] })
  const items = await svc.listResources(ctxOf(req as AuthedRequest), q.chapterId)
  res.json({ items: items.map(svc.serializeResource) })
}))

syllabusRouter.post('/chapter-resources', wrap(async (req, res) => {
  const item = await svc.createResource(ctxOf(req as AuthedRequest), validate(createChapterResource, req.body))
  res.status(201).json({ item: svc.serializeResource(item) })
}))

syllabusRouter.delete('/chapter-resources/:id', wrap(async (req, res) => {
  await svc.removeResource(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ── progress — GET: anyone with class visibility. PATCH: assertWriteClassSubject (assigned teacher(s) +
// staff/admin/superadmin) — reused verbatim from server/src/lib/scope.ts, the Phase 10 audit fix. ──

syllabusRouter.get('/progress', wrap(async (req, res) => {
  const q = validate(progressQuery, req.query)
  const items = await svc.getProgress(ctxOf(req as AuthedRequest), q.classSubjectId)
  res.json({ items })
}))

syllabusRouter.patch('/progress/:classSubjectId/:chapterId', wrap(async (req, res) => {
  const row = await svc.patchProgressRow(ctxOf(req as AuthedRequest), req.params.classSubjectId, req.params.chapterId, validate(patchProgress, req.body))
  res.json({ item: svc.serializeProgress(row) })
}))

// ── term targets — staff/admin/superadmin only ──

syllabusRouter.get('/targets', staffWrite, wrap(async (req, res) => {
  const items = await svc.listTargets(ctxOf(req as AuthedRequest), validate(targetsQuery, req.query))
  res.json({ items: items.map(svc.serializeTarget) })
}))

syllabusRouter.post('/targets', staffWrite, wrap(async (req, res) => {
  const item = await svc.createTargetRow(ctxOf(req as AuthedRequest), validate(createTarget, req.body))
  res.status(201).json({ item: svc.serializeTarget(item) })
}))

syllabusRouter.patch('/targets/:id', staffWrite, wrap(async (req, res) => {
  const item = await svc.updateTargetRow(ctxOf(req as AuthedRequest), req.params.id, validate(patchTarget, req.body))
  res.json({ item: svc.serializeTarget(item) })
}))

syllabusRouter.delete('/targets/:id', staffWrite, wrap(async (req, res) => {
  await svc.removeTargetRow(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ── computed views ──

syllabusRouter.get('/pace/:classSubjectId', wrap(async (req, res) => {
  const result = await svc.computePace(ctxOf(req as AuthedRequest), req.params.classSubjectId, validate(paceQuery, req.query))
  res.json(result)
}))

syllabusRouter.get('/coverage/:classSubjectId', wrap(async (req, res) => {
  validate(coverageQuery, req.query)
  const items = await svc.computeCoverage(ctxOf(req as AuthedRequest), req.params.classSubjectId)
  res.json({ items })
}))
