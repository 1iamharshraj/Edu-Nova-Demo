import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeHousePoints } from './service'
import { createHousePoints, leaderboardQuery, ledgerQuery } from './schema'

// /api/culture — see phase-27-culture-engagement.md.
export const cultureRouter = Router()
cultureRouter.use(requireAuth)

// ── house points ──
cultureRouter.post('/house-points', wrap(async (req, res) => {
  res.status(201).json({ item: serializeHousePoints(await svc.awardHousePoints(ctxOf(req as AuthedRequest), validate(createHousePoints, req.body))) })
}))
cultureRouter.get('/house-points/leaderboard', wrap(async (req, res) => {
  res.json({ items: await svc.leaderboard(ctxOf(req as AuthedRequest), validate(leaderboardQuery, req.query)) })
}))
cultureRouter.get('/house-points', wrap(async (req, res) => {
  res.json({ items: await svc.ledger(ctxOf(req as AuthedRequest), validate(ledgerQuery, req.query)) })
}))

// ── student portfolio ──
cultureRouter.get('/portfolio/:studentId', wrap(async (req, res) => {
  res.json({ item: await svc.studentPortfolio(ctxOf(req as AuthedRequest), req.params.studentId) })
}))
cultureRouter.get('/portfolio/:studentId/export', wrap(async (req, res) => {
  const { bytes, name } = await svc.portfolioPdf(ctxOf(req as AuthedRequest), req.params.studentId)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Content-Disposition', `${req.query.download === 'false' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.end(bytes)
}))
