import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeBoardRegistration as ser } from './service'
import { createBoardRegistration, patchBoardRegistration, listQuery, prefillBody, validateBody, marksheetQuery } from './schema'

// /api/board-registrations — scoped like the old MarksheetMod (student self, parent wards, teacher classes,
// staff/admin all). Static paths before `/:id`.
export const boardRegistrationsRouter = Router()
boardRegistrationsRouter.use(requireAuth)

boardRegistrationsRouter.get('/', wrap(async (req, res) => {
  res.json({ items: (await svc.list(ctxOf(req as AuthedRequest), validate(listQuery, req.query))).map(ser) })
}))

boardRegistrationsRouter.post('/prefill', wrap(async (req, res) => {
  const body = validate(prefillBody, req.body)
  res.json({ item: ser(await svc.prefill(ctxOf(req as AuthedRequest), body.studentId, body.academicYearId)) })
}))

boardRegistrationsRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: ser(await svc.create(ctxOf(req as AuthedRequest), validate(createBoardRegistration, req.body))) })
}))

boardRegistrationsRouter.get('/:id', wrap(async (req, res) => {
  res.json({ item: ser(await svc.get(ctxOf(req as AuthedRequest), req.params.id)) })
}))

boardRegistrationsRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: ser(await svc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchBoardRegistration, req.body))) })
}))

boardRegistrationsRouter.delete('/:id', requireRole(...WRITE_ROLES), wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

boardRegistrationsRouter.post('/:id/validate', wrap(async (req, res) => {
  const body = validate(validateBody, req.body ?? {})
  res.json({ item: ser(await svc.validateReg(ctxOf(req as AuthedRequest), req.params.id, body.mismatchNote)) })
}))

boardRegistrationsRouter.post('/:id/send', requireRole(...WRITE_ROLES), wrap(async (req, res) => {
  res.json({ item: ser(await svc.send(ctxOf(req as AuthedRequest), req.params.id)) })
}))

boardRegistrationsRouter.get('/:id/marksheet', wrap(async (req, res) => {
  const q = validate(marksheetQuery, req.query)
  const { bytes, name } = await svc.marksheetPdf(ctxOf(req as AuthedRequest), req.params.id, q.termId)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.end(bytes)
}))
