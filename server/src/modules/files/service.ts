import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { File as FileRow } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isAdmin } from '../../lib/scope'

// Bytes live under server/uploads/<schoolId>/<fileId> (gitignored); the DB row carries metadata + sha256.
export const UPLOAD_ROOT = path.resolve(__dirname, '../../../uploads')
export const MAX_FILE_BYTES = 10 * 1024 * 1024

// Allowed extensions → the canonical mime we serve them with.
export const ALLOWED: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
}

export const extOf = (name: string) => path.extname(name).slice(1).toLowerCase()

export const serializeFile = (f: FileRow) => ({
  id: f.id,
  uploaderId: f.uploaderId ?? undefined,
  name: f.name,
  mime: f.mime,
  size: f.size,
  sha256: f.sha256,
  createdAt: f.createdAt.toISOString(),
})

export const absPath = (f: { path: string }) => path.join(UPLOAD_ROOT, f.path)

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.file.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('File')
  return row
}

// Every id must be a file of this school. Used by homework attachments / submissions.
export async function assertFileIds(ctx: Ctx, ids: string[]) {
  const unique = [...new Set(ids)]
  if (!unique.length) return
  const found = await prisma.file.count({ where: { id: { in: unique }, schoolId: ctx.schoolId } })
  if (found !== unique.length) throw new HttpError(400, 'One or more file ids do not exist', { files: unique })
}

// Records a file multer has already written to `tmpPath`; moves it to its final slot under the school folder.
export async function register(ctx: Ctx, upload: { originalname: string; mimetype: string; size: number; path: string }) {
  const ext = extOf(upload.originalname)
  const mime = ALLOWED[ext]
  if (!mime) {
    await fs.promises.rm(upload.path, { force: true })
    throw new HttpError(400, `File type .${ext || '?'} is not allowed`, { allowed: Object.keys(ALLOWED) })
  }
  const id = crypto.randomUUID().replace(/-/g, '')
  const rel = path.join(ctx.schoolId, id)
  const dest = path.join(UPLOAD_ROOT, rel)
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  await fs.promises.rename(upload.path, dest)

  const hash = crypto.createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(dest).on('data', c => hash.update(c)).on('end', () => resolve()).on('error', reject)
  })
  const row = await prisma.file.create({
    data: { id, schoolId: ctx.schoolId, uploaderId: ctx.actorId, name: path.basename(upload.originalname), mime, size: upload.size, path: rel, sha256: hash.digest('hex') },
  })
  await audit(ctx.schoolId, ctx.actorId, 'upload', 'file', row.id, undefined, serializeFile(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const row = await get(ctx, id)
  if (row.uploaderId !== ctx.actorId && !isAdmin(ctx)) throw new HttpError(403, 'Only the uploader or an admin can delete this file')
  await prisma.file.delete({ where: { id } })
  await fs.promises.rm(absPath(row), { force: true })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'file', id, serializeFile(row))
}

// Removes every stored file of a school (admin reset).
export async function purgeSchoolFiles(schoolId: string) {
  await fs.promises.rm(path.join(UPLOAD_ROOT, schoolId), { recursive: true, force: true })
}
