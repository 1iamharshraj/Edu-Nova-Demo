import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import * as svc from './service'
import { serializeHistoryEntry } from './service'

// /api/employment-history — see phase-11-employee-management.md → A4. Read-only from the client's
// perspective: entries are written internally by routes/users.ts and modules/payroll/service.ts.
export const employmentHistoryRouter = Router()
employmentHistoryRouter.use(requireAuth)

employmentHistoryRouter.get('/:userId', wrap(async (req, res) => {
  const items = (await svc.listHistory(ctxOf(req as AuthedRequest), req.params.userId)).map(serializeHistoryEntry)
  res.json({ items })
}))
