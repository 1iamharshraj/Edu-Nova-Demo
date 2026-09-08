import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeCase } from './service'
import { createCase, patchCase, setStatus, addNote, disciplineQuery } from './schema'

// /api/discipline — see phase-8-welfare.md.
export const disciplineRouter = Router()
disciplineRouter.use(requireAuth)

disciplineRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.listCases(ctxOf(req as AuthedRequest), validate(disciplineQuery, req.query)) })
}))
disciplineRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeCase(await svc.createCaseSvc(ctxOf(req as AuthedRequest), validate(createCase, req.body))) })
}))
disciplineRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeCase(await svc.updateCase(ctxOf(req as AuthedRequest), req.params.id, validate(patchCase, req.body))) })
}))
disciplineRouter.post('/:id/status', wrap(async (req, res) => {
  res.json({ item: serializeCase(await svc.setCaseStatus(ctxOf(req as AuthedRequest), req.params.id, validate(setStatus, req.body))) })
}))
disciplineRouter.post('/:id/notes', wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeNote(await svc.addCaseNote(ctxOf(req as AuthedRequest), req.params.id, validate(addNote, req.body))) })
}))
disciplineRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deleteCase(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
