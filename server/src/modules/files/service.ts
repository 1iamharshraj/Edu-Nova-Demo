import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fromFile as fileTypeFromFile } from 'file-type'
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

// Content-sniffing (Phase 10 §4): the declared extension is only ever a hint from the client, so it is
// re-checked against the file's actual magic bytes after upload — an executable renamed to `.jpg` (or any
// other extension swap) is rejected even though multer's extension-based `fileFilter` already let it
// through. `file-type` returns `undefined` for formats with no magic-number signature (plain text is the
// only one we allow), so `.txt` gets a lighter heuristic instead: reject it if it sniffs as a *known*
// binary format, or contains NUL/control bytes that plain text would not.
const SNIFF_MIME: Partial<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

async function looksLikeBinary(dest: string): Promise<boolean> {
  const fh = await fs.promises.open(dest, 'r')
  try {
    const buf = Buffer.alloc(4096)
    const { bytesRead } = await fh.read(buf, 0, 4096, 0)
    for (let i = 0; i < bytesRead; i++) {
      const b = buf[i]
      // NUL or a control byte other than tab/newline/carriage-return is not something real text contains.
      if (b === 0 || (b < 7) || (b > 13 && b < 32 && b !== 27)) return true
    }
    return false
  } finally {
    await fh.close()
  }
}

async function assertContentMatchesExtension(dest: string, ext: string) {
  const detected = await fileTypeFromFile(dest)
  if (ext === 'txt') {
    if (detected || (await looksLikeBinary(dest))) {
      throw new HttpError(400, 'File content does not look like plain text — the extension does not match the actual file type', { declaredExt: ext, detectedMime: detected?.mime ?? null })
    }
    return
  }
  const expected = SNIFF_MIME[ext]
  if (!detected || detected.mime !== expected) {
    throw new HttpError(400, `File content does not match its .${ext} extension`, { declaredExt: ext, expectedMime: expected, detectedMime: detected?.mime ?? null })
  }
}

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

  try {
    await assertContentMatchesExtension(dest, ext)
  } catch (err) {
    await fs.promises.rm(dest, { force: true })
    throw err
  }

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
