import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { requireAuth, type AuthedRequest } from '../../auth'
import { HttpError, wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import * as svc from './service'
import { ALLOWED, MAX_FILE_BYTES, UPLOAD_ROOT, absPath, extOf, serializeFile } from './service'

// /api/files — multipart upload (field `file`), streaming download, metadata, delete. Any member of the
// school may upload and read; delete is uploader-or-admin.
export const filesRouter = Router()
filesRouter.use(requireAuth)

const tmpDir = path.join(UPLOAD_ROOT, '.tmp')
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { fs.mkdir(tmpDir, { recursive: true }, err => cb(err, tmpDir)) },
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED[extOf(file.originalname)]) return cb(null, true)
    cb(new HttpError(400, `File type .${extOf(file.originalname) || '?'} is not allowed`, { allowed: Object.keys(ALLOWED) }))
  },
})

filesRouter.post('/', (req, res, next) => {
  upload.single('file')(req, res, err => {
    if (err instanceof multer.MulterError) {
      return next(new HttpError(400, err.code === 'LIMIT_FILE_SIZE' ? `File exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB` : err.message, { code: err.code }))
    }
    next(err)
  })
}, wrap(async (req, res) => {
  const file = (req as AuthedRequest & { file?: Express.Multer.File }).file
  if (!file) throw new HttpError(400, 'Missing multipart field "file"')
  const row = await svc.register(ctxOf(req as AuthedRequest), file)
  res.status(201).json({ item: serializeFile(row) })
}))

filesRouter.get('/:id/meta', wrap(async (req, res) => {
  res.json({ item: serializeFile(await svc.get(ctxOf(req as AuthedRequest), req.params.id)) })
}))

filesRouter.get('/:id', wrap(async (req, res) => {
  const row = await svc.get(ctxOf(req as AuthedRequest), req.params.id)
  const full = absPath(row)
  if (!fs.existsSync(full)) throw new HttpError(404, 'File contents are missing on disk')
  const disposition = req.query.download ? 'attachment' : 'inline'
  res.setHeader('Content-Type', row.mime)
  res.setHeader('Content-Length', String(row.size))
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(row.name)}`)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(full).on('error', reject).on('end', () => resolve()).pipe(res)
  })
}))

filesRouter.delete('/:id', wrap(async (req, res) => {
  await svc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
