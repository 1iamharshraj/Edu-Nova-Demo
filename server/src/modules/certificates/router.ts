import fs from 'node:fs'
import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { HttpError, wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { STAFF_ROLES } from '../../lib/scope'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeCertificate } from './service'
import { createCertificate, listQuery } from './schema'

// /api/certificates — students/parents see their own; staff/admin issue directly (without an application).
export const certificatesRouter = Router()
certificatesRouter.use(requireAuth)

certificatesRouter.get('/', wrap(async (req, res) => {
  res.json({ items: (await svc.list(ctxOf(req as AuthedRequest), validate(listQuery, req.query))).map(serializeCertificate) })
}))

certificatesRouter.post('/', requireRole(...(STAFF_ROLES as any)), wrap(async (req, res) => {
  const body = validate(createCertificate, req.body)
  res.status(201).json({ item: serializeCertificate(await svc.issue(ctxOf(req as AuthedRequest), body.kind, body.studentId)) })
}))

certificatesRouter.get('/:id', wrap(async (req, res) => {
  res.json({ item: serializeCertificate(await svc.get(ctxOf(req as AuthedRequest), req.params.id)) })
}))

certificatesRouter.get('/:id/pdf', wrap(async (req, res) => {
  const { file, path } = await svc.pdfPath(ctxOf(req as AuthedRequest), req.params.id)
  if (!fs.existsSync(path)) throw new HttpError(404, 'Certificate PDF is missing on disk')
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`)
  await new Promise<void>((resolve, reject) => { fs.createReadStream(path).on('error', reject).on('end', () => resolve()).pipe(res) })
}))
