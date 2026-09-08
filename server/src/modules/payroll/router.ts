import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeSalaryStructure, serializePayslip } from './service'
import { upsertSalaryStructure, runBody, payslipsQuery } from './schema'

// /api/payroll — see phase-5-finance.md. Admin/superadmin write; employees read their own.
export const payrollRouter = Router()
payrollRouter.use(requireAuth)

payrollRouter.get('/structures/:userId', wrap(async (req, res) => {
  res.json({ item: serializeSalaryStructure(await svc.getStructure(ctxOf(req as AuthedRequest), req.params.userId)) })
}))
payrollRouter.put('/structures/:userId', wrap(async (req, res) => {
  res.json({ item: serializeSalaryStructure(await svc.upsertStructure(ctxOf(req as AuthedRequest), req.params.userId, validate(upsertSalaryStructure, req.body))) })
}))

payrollRouter.post('/run', wrap(async (req, res) => {
  res.status(201).json(await svc.run(ctxOf(req as AuthedRequest), validate(runBody, req.body)))
}))

payrollRouter.get('/payslips', wrap(async (req, res) => {
  res.json({ items: (await svc.listPayslips(ctxOf(req as AuthedRequest), validate(payslipsQuery, req.query))).map(serializePayslip) })
}))
payrollRouter.patch('/payslips/:id/mark-paid', wrap(async (req, res) => {
  res.json({ item: serializePayslip(await svc.markPaid(ctxOf(req as AuthedRequest), req.params.id)) })
}))
payrollRouter.get('/payslips/:id.pdf', wrap(async (req, res) => {
  const { bytes, name } = await svc.payslipPdf(ctxOf(req as AuthedRequest), req.params.id)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.end(bytes)
}))
