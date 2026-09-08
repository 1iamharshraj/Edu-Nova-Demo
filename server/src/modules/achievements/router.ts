import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeAchievement } from './service'
import { createAchievement, patchAchievement, achievementsQuery } from './schema'

// /api/achievements — see phase-8-welfare.md.
export const achievementsRouter = Router()
achievementsRouter.use(requireAuth)

achievementsRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.listAchievements(ctxOf(req as AuthedRequest), validate(achievementsQuery, req.query)) })
}))
achievementsRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeAchievement(await svc.createAchievementSvc(ctxOf(req as AuthedRequest), validate(createAchievement, req.body))) })
}))
achievementsRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeAchievement(await svc.updateAchievement(ctxOf(req as AuthedRequest), req.params.id, validate(patchAchievement, req.body))) })
}))
achievementsRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deleteAchievement(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
achievementsRouter.post('/:id/verify', wrap(async (req, res) => {
  res.json({ item: serializeAchievement(await svc.verifyAchievement(ctxOf(req as AuthedRequest), req.params.id)) })
}))
