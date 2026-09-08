import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeContract, serializeResignation, serializeDuty } from './service'
import {
  createContract, patchContract, contractsQuery, endContractBody,
  createResignation, resignationsQuery, decideResignationBody,
  createDuty, patchDuty, dutiesQuery,
} from './schema'

// /api/hr — see phase-6-hr.md.
export const hrRouter = Router()
hrRouter.use(requireAuth)

// ── contracts ──
hrRouter.get('/contracts', wrap(async (req, res) => {
  res.json({ items: (await svc.listContracts(ctxOf(req as AuthedRequest), validate(contractsQuery, req.query))).map(serializeContract) })
}))
hrRouter.post('/contracts', wrap(async (req, res) => {
  res.status(201).json({ item: serializeContract(await svc.createContractRow(ctxOf(req as AuthedRequest), validate(createContract, req.body))) })
}))
// Registered before the generic `/:id` route below — path-to-regexp's `:id` otherwise happily swallows
// the literal ".pdf" suffix too (unlike `/invoices/:id/receipt.pdf` elsewhere, there is no `/` to stop it).
hrRouter.get('/contracts/:id.pdf', wrap(async (req, res) => {
  const { bytes, name } = await svc.contractPdf(ctxOf(req as AuthedRequest), req.params.id)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.end(bytes)
}))
hrRouter.get('/contracts/:id', wrap(async (req, res) => {
  res.json({ item: serializeContract(await svc.getContract(ctxOf(req as AuthedRequest), req.params.id)) })
}))
hrRouter.patch('/contracts/:id', wrap(async (req, res) => {
  res.json({ item: serializeContract(await svc.updateContract(ctxOf(req as AuthedRequest), req.params.id, validate(patchContract, req.body))) })
}))
hrRouter.post('/contracts/:id/sign', wrap(async (req, res) => {
  res.json({ item: serializeContract(await svc.signContract(ctxOf(req as AuthedRequest), req.params.id)) })
}))
hrRouter.post('/contracts/:id/end', wrap(async (req, res) => {
  res.json({ item: serializeContract(await svc.endContract(ctxOf(req as AuthedRequest), req.params.id, validate(endContractBody, req.body))) })
}))

// ── resignations ──
hrRouter.get('/resignations', wrap(async (req, res) => {
  res.json({ items: (await svc.listResignations(ctxOf(req as AuthedRequest), validate(resignationsQuery, req.query))).map(serializeResignation) })
}))
hrRouter.post('/resignations', wrap(async (req, res) => {
  res.status(201).json({ item: serializeResignation(await svc.submitResignation(ctxOf(req as AuthedRequest), validate(createResignation, req.body))) })
}))
hrRouter.post('/resignations/:id/approve', wrap(async (req, res) => {
  res.json({ item: serializeResignation(await svc.approveResignation(ctxOf(req as AuthedRequest), req.params.id, validate(decideResignationBody, req.body))) })
}))
hrRouter.post('/resignations/:id/decline', wrap(async (req, res) => {
  res.json({ item: serializeResignation(await svc.declineResignation(ctxOf(req as AuthedRequest), req.params.id, validate(decideResignationBody, req.body))) })
}))
hrRouter.post('/resignations/:id/withdraw', wrap(async (req, res) => {
  res.json({ item: serializeResignation(await svc.withdrawResignation(ctxOf(req as AuthedRequest), req.params.id)) })
}))

// ── duties ──
hrRouter.get('/duties', wrap(async (req, res) => {
  res.json({ items: (await svc.listDuties(ctxOf(req as AuthedRequest), validate(dutiesQuery, req.query))).map(serializeDuty) })
}))
hrRouter.post('/duties', wrap(async (req, res) => {
  res.status(201).json({ item: serializeDuty(await svc.createDutyRow(ctxOf(req as AuthedRequest), validate(createDuty, req.body))) })
}))
hrRouter.patch('/duties/:id', wrap(async (req, res) => {
  res.json({ item: serializeDuty(await svc.updateDuty(ctxOf(req as AuthedRequest), req.params.id, validate(patchDuty, req.body))) })
}))
hrRouter.delete('/duties/:id', wrap(async (req, res) => {
  await svc.removeDuty(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
