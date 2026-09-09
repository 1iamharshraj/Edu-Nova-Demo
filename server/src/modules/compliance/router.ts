import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { udiseExportQuery } from './schema'

// /api/compliance — see phase-29-india-compliance-offline.md → Part A. Admin/superadmin only:
// this generates a school-data export used to speed up MANUAL UDISE+ form-filling — it never talks
// to any government system. See service.ts#EXPORT_DISCLAIMER, repeated in every response.
export const complianceRouter = Router()
complianceRouter.use(requireAuth)
const adminOnly = requireRole('admin', 'superadmin')

complianceRouter.get('/udise-export', adminOnly, wrap(async (req, res) => {
  const q = validate(udiseExportQuery, req.query)
  const exp = await svc.generateAndAudit(ctxOf(req as AuthedRequest), q)

  if (q.format === 'csv') {
    const csv = svc.toCsv(exp)
    const name = `udise-export-${exp.academicYear.label}-${exp.mappingVersion}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `${req.query.download === 'false' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`)
    res.send(csv)
    return
  }

  res.json({ item: exp, summary: svc.summarize(exp) })
}))
