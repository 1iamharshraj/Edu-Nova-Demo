import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import { periodTemplatesRouter } from '../periodTemplates/router'
import { substitutionsRouter } from '../substitutions/router'
import * as svc from './service'
import { serializeEntry } from './shared'
import { putEntries, copyBody, publishBody, gridQuery, termQuery, meQuery } from './schema'

// Everything under /api/timetable (see phase-2-timetable.md). Reads: any authenticated role, with the
// per-role visibility rules applied in the service; writes: admin | superadmin.
export const timetableRouter = Router()
timetableRouter.use(requireAuth)
const write = requireRole(...WRITE_ROLES)

timetableRouter.use('/period-templates', periodTemplatesRouter)
timetableRouter.use('/substitutions', substitutionsRouter)

// GET /?classId&termId → { template, entries, published, publishedAt? }
timetableRouter.get('/', wrap(async (req, res) => {
  const q = validate(gridQuery, req.query)
  res.json(await svc.getGrid(ctxOf(req as AuthedRequest), q.classId, q.termId))
}))

timetableRouter.get('/me', wrap(async (req, res) => {
  res.json(await svc.me(ctxOf(req as AuthedRequest), validate(meQuery, req.query)))
}))

timetableRouter.get('/teacher/:userId', wrap(async (req, res) => {
  const q = validate(termQuery, req.query)
  res.json(await svc.teacherView(ctxOf(req as AuthedRequest), req.params.userId, q.termId))
}))

// Replaces the whole class×term grid in one validated transaction.
timetableRouter.put('/entries', write, wrap(async (req, res) => {
  const items = await svc.replaceGrid(ctxOf(req as AuthedRequest), validate(putEntries, req.body))
  res.json({ items: items.map(serializeEntry) })
}))

timetableRouter.delete('/entries/:id', write, wrap(async (req, res) => {
  await svc.removeEntry(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

timetableRouter.post('/copy', write, wrap(async (req, res) => {
  res.json(await svc.copy(ctxOf(req as AuthedRequest), validate(copyBody, req.body)))
}))

timetableRouter.post('/publish', write, wrap(async (req, res) => {
  res.json({ item: await svc.publish(ctxOf(req as AuthedRequest), validate(publishBody, req.body)) })
}))
