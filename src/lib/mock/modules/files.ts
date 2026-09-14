// Static-demo stand-in for /api/files. No real storage — see api.ts's uploadFile()/fetchAuthed() notes.

import { route, requireAuth } from '../router'
import { notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

route('POST', '/files', (ctx) => {
  const actor = requireAuth(ctx)
  const { name, size, mimeType, dataUrl } = ctx.body as { name?: string; size?: number; mimeType?: string; dataUrl?: string }
  const rows = table('File')
  // Matches src/lib/data.ts's FileRec exactly (id, uploaderId, name, mime, size, createdAt) — `dataUrl`
  // is an extra field only this mock reads back (see fetchAuthed in api.ts).
  const row: Row = {
    id: uid('file'), schoolId: actor.schoolId, name: name ?? 'file', size: size ?? 0,
    mime: mimeType ?? 'application/octet-stream', uploaderId: actor.userId, createdAt: nowIso(), dataUrl,
  }
  rows.push(row)
  saveTable('File', rows)
  return { item: row }
})

route('GET', '/files/:id', (ctx) => {
  requireAuth(ctx)
  const row = table('File').find(f => f.id === ctx.params.id)
  if (!row) throw notFound('File')
  return row
})
