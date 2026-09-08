import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import * as svc from './service'

// /api/reports — see phase-8-welfare.md.
export const reportsRouter = Router()
reportsRouter.use(requireAuth)

reportsRouter.get('/student/:id', wrap(async (req, res) => {
  res.json(await svc.studentDossier(ctxOf(req as AuthedRequest), req.params.id))
}))
