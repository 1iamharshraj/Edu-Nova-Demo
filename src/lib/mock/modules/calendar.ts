// Mirrors server/src/modules/calendar/{router,service,schema}.ts's contract for src/portal/modules/office.tsx.
// GET is audience-filtered (School = everyone; Class = that class's students/parents/teachers; staff/admin
// see all); writes are staff/admin only.

import { route, requireAuth, status } from '../router'
import { badRequest, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { isStaff, studentClassIds, teacherClassIds, wardClassIds, getClass, getTerm } from './examsAcademicsScope'
import type { Actor } from '../router'

function serializeEvent(e: Row) {
  return { id: e.id, title: e.title, date: e.date, endDate: e.endDate ?? undefined, type: e.type, audience: e.audience, classId: e.classId ?? undefined, termId: e.termId ?? undefined, createdById: e.createdById }
}

route('GET', '/calendar', (ctx) => {
  const actor = requireAuth(ctx)
  const { termId, from, to } = ctx.query
  let rows = table('CalendarEvent').filter(e => e.schoolId === actor.schoolId)
  if (termId) rows = rows.filter(e => e.termId === termId)
  if (from) rows = rows.filter(e => String(e.date) >= from)
  if (to) rows = rows.filter(e => String(e.date) <= to)
  rows = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  if (isStaff(actor.role)) return { items: rows.map(serializeEvent) }
  let classIds: string[] = []
  if (actor.role === 'student') classIds = studentClassIds(actor.userId)
  else if (actor.role === 'parent') classIds = wardClassIds(actor)
  else if (actor.role === 'teacher') classIds = teacherClassIds(actor.userId)
  const visible = rows.filter(e => e.audience === 'School' || (e.audience === 'Class' && classIds.includes(e.classId as string)))
  return { items: visible.map(serializeEvent) }
})

function getEvent(actor: Actor, id: string): Row {
  const row = table('CalendarEvent').find(e => e.id === id && e.schoolId === actor.schoolId)
  if (!row) throw notFound('Calendar event')
  return row
}

route('POST', '/calendar', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may create calendar events')
  const body = ctx.body as { title?: string; date?: string; endDate?: string; type?: string; audience?: string; classId?: string; termId?: string }
  if (!body.title?.trim()) throw badRequest('title is required')
  if (!body.date) throw badRequest('date is required')
  if (!['holiday', 'exam', 'event'].includes(body.type ?? '')) throw badRequest('type must be holiday, exam or event')
  if (!['School', 'Class'].includes(body.audience ?? '')) throw badRequest('audience must be School or Class')
  if (body.audience === 'Class') {
    if (!body.classId) throw badRequest('classId is required for Class audience')
    getClass(actor, body.classId)
  }
  if (body.termId) getTerm(actor, body.termId)
  const row: Row = { id: uid('calendarevent'), schoolId: actor.schoolId, title: body.title.trim(), date: body.date, endDate: body.endDate ?? null, type: body.type, audience: body.audience, classId: body.audience === 'Class' ? body.classId : null, termId: body.termId ?? null, createdById: actor.userId, createdAt: nowIso() }
  const rows = table('CalendarEvent'); rows.push(row); saveTable('CalendarEvent', rows)
  return status(201, { item: serializeEvent(row) })
})

route('PATCH', '/calendar/:id', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may edit calendar events')
  const before = getEvent(actor, ctx.params.id)
  const body = ctx.body as { title?: string; date?: string; endDate?: string; type?: string; audience?: string; classId?: string; termId?: string }
  if (body.audience === 'Class' && body.classId) getClass(actor, body.classId)
  if (body.termId) getTerm(actor, body.termId)
  const rows = table('CalendarEvent'); const idx = rows.findIndex(e => e.id === before.id)
  rows[idx] = {
    ...rows[idx],
    ...(body.title !== undefined ? { title: body.title } : {}), ...(body.date !== undefined ? { date: body.date } : {}), ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
    ...(body.type !== undefined ? { type: body.type } : {}),
    ...(body.audience !== undefined ? { audience: body.audience, classId: body.audience === 'Class' ? (body.classId ?? rows[idx].classId) : null } : (body.classId !== undefined ? { classId: body.classId } : {})),
    ...(body.termId !== undefined ? { termId: body.termId } : {}),
  }
  saveTable('CalendarEvent', rows)
  return { item: serializeEvent(rows[idx]) }
})

route('DELETE', '/calendar/:id', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may delete calendar events')
  const before = getEvent(actor, ctx.params.id)
  const rows = table('CalendarEvent'); const idx = rows.findIndex(e => e.id === before.id)
  rows.splice(idx, 1)
  saveTable('CalendarEvent', rows)
  return { ok: true }
})
