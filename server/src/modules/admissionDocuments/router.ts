import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { STAFF_ROLES } from '../../lib/scope'
import { validate } from '../../lib/validate'
import * as svc from './service'
import {
  createAdmissionCategory, patchAdmissionCategory, createRequiredDocumentType, patchRequiredDocumentType,
  createSubmittedDocument, patchSubmittedDocument, returnDocumentBody, lostDocumentBody, documentQuery,
  recordsReportQuery, admissionSettingsBody,
} from './schema'

// /api/admission-documents — Phase T2 Part B: RequiredDocumentType/AdmissionCategory catalogs,
// SubmittedDocument (digital + physical custody), completeness checklist, records report. Staff/admin
// only throughout — matches the existing Applications module's RBAC (STAFF_ROLES).
export const admissionDocumentsRouter = Router()
admissionDocumentsRouter.use(requireAuth)
const staff = requireRole(...(STAFF_ROLES as any))

// ── AdmissionCategory ──
admissionDocumentsRouter.get('/categories', staff, wrap(async (req, res) => {
  res.json({ items: (await svc.listCategories(ctxOf(req as AuthedRequest))).map(svc.serializeCategory) })
}))
admissionDocumentsRouter.post('/categories', staff, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeCategory(await svc.createCategory(ctxOf(req as AuthedRequest), validate(createAdmissionCategory, req.body))) })
}))
admissionDocumentsRouter.patch('/categories/:id', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeCategory(await svc.updateCategory(ctxOf(req as AuthedRequest), req.params.id, validate(patchAdmissionCategory, req.body))) })
}))
admissionDocumentsRouter.post('/categories/seed-defaults', staff, wrap(async (req, res) => {
  res.json({ added: await svc.seedDefaultCategories(ctxOf(req as AuthedRequest)) })
}))

// ── RequiredDocumentType ──
admissionDocumentsRouter.get('/types', staff, wrap(async (req, res) => {
  res.json({ items: (await svc.listDocTypes(ctxOf(req as AuthedRequest))).map(svc.serializeDocType) })
}))
admissionDocumentsRouter.post('/types', staff, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeDocType(await svc.createDocType(ctxOf(req as AuthedRequest), validate(createRequiredDocumentType, req.body))) })
}))
admissionDocumentsRouter.patch('/types/:id', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeDocType(await svc.updateDocType(ctxOf(req as AuthedRequest), req.params.id, validate(patchRequiredDocumentType, req.body))) })
}))
admissionDocumentsRouter.post('/types/seed-defaults', staff, wrap(async (req, res) => {
  res.json({ added: await svc.seedDefaultDocTypes(ctxOf(req as AuthedRequest)) })
}))

// ── AdmissionSettings ──
admissionDocumentsRouter.get('/settings', staff, wrap(async (req, res) => {
  res.json(await svc.getSettings(ctxOf(req as AuthedRequest)))
}))
admissionDocumentsRouter.patch('/settings', staff, wrap(async (req, res) => {
  const body = validate(admissionSettingsBody, req.body)
  res.json(await svc.setSettings(ctxOf(req as AuthedRequest), body.admissionDocumentsBlockApproval))
}))

// ── SubmittedDocument ──
admissionDocumentsRouter.get('/', staff, wrap(async (req, res) => {
  res.json({ items: (await svc.listSubmittedDocuments(ctxOf(req as AuthedRequest), validate(documentQuery, req.query))).map(svc.serializeSubmittedDocument) })
}))
admissionDocumentsRouter.post('/', staff, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeSubmittedDocument(await svc.submitDocument(ctxOf(req as AuthedRequest), validate(createSubmittedDocument, req.body))) })
}))
admissionDocumentsRouter.patch('/:id', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeSubmittedDocument(await svc.updateSubmittedDocument(ctxOf(req as AuthedRequest), req.params.id, validate(patchSubmittedDocument, req.body))) })
}))
admissionDocumentsRouter.post('/:id/return', staff, wrap(async (req, res) => {
  const body = validate(returnDocumentBody, req.body)
  res.json({ item: svc.serializeSubmittedDocument(await svc.returnDocument(ctxOf(req as AuthedRequest), req.params.id, body.returnedTo, body.returnReason)) })
}))
admissionDocumentsRouter.post('/:id/lost', staff, wrap(async (req, res) => {
  const body = validate(lostDocumentBody, req.body ?? {})
  res.json({ item: svc.serializeSubmittedDocument(await svc.markLost(ctxOf(req as AuthedRequest), req.params.id, body.reason)) })
}))
admissionDocumentsRouter.delete('/:id', staff, wrap(async (req, res) => {
  await svc.removeSubmittedDocument(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ── Completeness checklist ──
admissionDocumentsRouter.get('/checklist/:applicationId', staff, wrap(async (req, res) => {
  res.json(await svc.checklist(ctxOf(req as AuthedRequest), req.params.applicationId))
}))

// ── TC-issuance document-return checklist (preview only — resolution happens via POST /applications/:id/approve) ──
admissionDocumentsRouter.get('/tc-return-checklist/:studentId', staff, wrap(async (req, res) => {
  const held = await svc.heldOriginals(ctxOf(req as AuthedRequest), req.params.studentId)
  res.json({
    studentId: req.params.studentId,
    heldOriginals: held.map(h => ({
      id: h.id, name: h.requiredDocumentType?.name ?? 'Document', physicalLocationRoom: h.physicalLocationRoom,
      physicalLocationShelf: h.physicalLocationShelf, physicalLocationFolder: h.physicalLocationFolder, receivedDate: h.receivedDate,
    })),
    blocksIssuance: held.length > 0,
  })
}))

// ── Records report (physical custody, staff/records-room facing) ──
admissionDocumentsRouter.get('/records-report', staff, wrap(async (req, res) => {
  res.json({ items: await svc.recordsReport(ctxOf(req as AuthedRequest), validate(recordsReportQuery, req.query)) })
}))
