// Mirrors server/src/modules/highlights/{router,service,schema}.ts's contract for
// src/portal/modules/social.tsx (Event Highlights CMS). Audience-scoped like CalendarEvent/Post: School =
// everyone, Class = that class's students/parents/teachers. Writes: staff/admin/superadmin only.

import { route, requireAuth, status } from '../router'
import { badRequest, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { isStaff, studentClassIds, teacherClassIds, wardClassIds, getClass } from './examsAcademicsScope'
import type { Actor } from '../router'

function serializeHighlight(h: Row) {
  return { id: h.id, title: h.title, url: h.url, thumbnailFileId: h.thumbnailFileId ?? undefined, audience: h.audience, classId: h.classId ?? undefined, publishedAt: h.publishedAt, createdById: h.createdById, createdAt: h.createdAt }
}

route('GET', '/highlights', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = [...table('Highlight').filter(h => h.schoolId === actor.schoolId)].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
  if (isStaff(actor.role)) return { items: rows.map(serializeHighlight) }
  let classIds: string[] = []
  if (actor.role === 'student') classIds = studentClassIds(actor.userId)
  else if (actor.role === 'parent') classIds = wardClassIds(actor)
  else if (actor.role === 'teacher') classIds = teacherClassIds(actor.userId)
  return { items: rows.filter(h => h.audience === 'School' || (h.audience === 'Class' && classIds.includes(h.classId as string))).map(serializeHighlight) }
})

function getHighlight(actor: Actor, id: string): Row {
  const row = table('Highlight').find(h => h.id === id && h.schoolId === actor.schoolId)
  if (!row) throw notFound('Highlight')
  return row
}

route('POST', '/highlights', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may create highlights')
  const body = ctx.body as { title?: string; url?: string; thumbnailFileId?: string; audience?: string; classId?: string; publishedAt?: string }
  if (!body.title?.trim()) throw badRequest('title is required')
  if (!body.url?.trim()) throw badRequest('url is required')
  if (!['School', 'Class'].includes(body.audience ?? '')) throw badRequest('audience must be School or Class')
  if (body.audience === 'Class') {
    if (!body.classId) throw badRequest('classId is required for Class audience')
    getClass(actor, body.classId)
  }
  if (body.thumbnailFileId && !table('File').some(f => f.id === body.thumbnailFileId)) throw badRequest('Unknown thumbnailFileId')
  const row: Row = { id: uid('highlight'), schoolId: actor.schoolId, title: body.title.trim(), url: body.url.trim(), thumbnailFileId: body.thumbnailFileId ?? null, audience: body.audience, classId: body.audience === 'Class' ? body.classId : null, publishedAt: body.publishedAt ?? nowIso(), createdById: actor.userId, createdAt: nowIso() }
  const rows = table('Highlight'); rows.push(row); saveTable('Highlight', rows)
  return status(201, { item: serializeHighlight(row) })
})

route('PATCH', '/highlights/:id', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may edit highlights')
  const before = getHighlight(actor, ctx.params.id)
  const body = ctx.body as { title?: string; url?: string; thumbnailFileId?: string | null; audience?: string; classId?: string | null; publishedAt?: string }
  if (body.audience === 'Class' && body.classId) getClass(actor, body.classId)
  if (body.thumbnailFileId && !table('File').some(f => f.id === body.thumbnailFileId)) throw badRequest('Unknown thumbnailFileId')
  const audience = body.audience ?? before.audience
  const rows = table('Highlight'); const idx = rows.findIndex(h => h.id === before.id)
  rows[idx] = {
    ...rows[idx],
    ...(body.title !== undefined ? { title: body.title } : {}), ...(body.url !== undefined ? { url: body.url } : {}),
    ...(body.thumbnailFileId !== undefined ? { thumbnailFileId: body.thumbnailFileId } : {}),
    ...(body.audience !== undefined ? { audience: body.audience } : {}),
    classId: audience === 'Class' ? (body.classId ?? before.classId) : (body.audience ? null : body.classId ?? before.classId),
    ...(body.publishedAt !== undefined ? { publishedAt: body.publishedAt } : {}),
  }
  saveTable('Highlight', rows)
  return { item: serializeHighlight(rows[idx]) }
})

route('DELETE', '/highlights/:id', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may delete highlights')
  const before = getHighlight(actor, ctx.params.id)
  const rows = table('Highlight'); const idx = rows.findIndex(h => h.id === before.id)
  rows.splice(idx, 1)
  saveTable('Highlight', rows)
  return { ok: true }
})
