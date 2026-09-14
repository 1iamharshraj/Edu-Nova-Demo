// Mirrors server/src/modules/meetings/{router,service,schema}.ts's contract for src/portal/modules/meetings.tsx.
// Requester: parent/student/teacher. `withUserId`: a teacher or admin — the party who decides.

import { route, requireAuth, status } from '../router'
import { badRequest, conflict, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { isAdmin, isStaff, visibleStudentIds } from './examsAcademicsScope'
import type { Actor } from '../router'

const shortId = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase()
const jitsiLink = (schoolId: string, meetingId: string) => `https://meet.jit.si/edunova-${shortId(schoolId)}-${meetingId}`

function serializeMeeting(m: Row) {
  return { id: m.id, requesterId: m.requesterId, withUserId: m.withUserId, studentId: m.studentId ?? undefined, purpose: m.purpose, scheduledAt: m.scheduledAt, durationMin: m.durationMin, link: m.link ?? undefined, status: m.status, decidedById: m.decidedById ?? undefined, decidedAt: m.decidedAt ?? undefined, note: m.note ?? undefined, createdAt: m.createdAt }
}

route('GET', '/meetings', (ctx) => {
  const actor = requireAuth(ctx)
  const { status: st } = ctx.query
  let rows = table('Meeting').filter(m => m.schoolId === actor.schoolId)
  if (actor.role === 'parent') {
    const wards = visibleStudentIds(actor) ?? []
    rows = rows.filter(m => m.requesterId === actor.userId || wards.includes(m.studentId as string))
  } else if (actor.role === 'student') {
    rows = rows.filter(m => m.requesterId === actor.userId || m.studentId === actor.userId)
  } else if (actor.role === 'teacher') {
    rows = rows.filter(m => m.requesterId === actor.userId || m.withUserId === actor.userId)
  } else if (!isStaff(actor.role)) {
    throw forbidden('Forbidden')
  }
  if (st) rows = rows.filter(m => m.status === st)
  rows = [...rows].sort((a, b) => String(b.scheduledAt).localeCompare(String(a.scheduledAt)))
  return { items: rows.map(serializeMeeting) }
})

route('POST', '/meetings', (ctx) => {
  const actor = requireAuth(ctx)
  if (!['parent', 'student', 'teacher'].includes(actor.role)) throw forbidden('Only parent, student or teacher may request a meeting')
  const body = ctx.body as { withUserId?: string; studentId?: string; purpose?: string; scheduledAt?: string; durationMin?: number }
  if (!body.withUserId) throw badRequest('withUserId is required')
  const withUser = table('User').find(u => u.id === body.withUserId && u.schoolId === actor.schoolId)
  if (!withUser) throw notFound('User')
  if (!['teacher', 'admin', 'superadmin'].includes(withUser.role as string)) throw badRequest('You may only request a meeting with a teacher or admin')
  if (!body.purpose?.trim()) throw badRequest('purpose is required')
  if (!body.scheduledAt) throw badRequest('scheduledAt is required')

  if (body.studentId) {
    if (actor.role === 'parent') {
      const wards = visibleStudentIds(actor) ?? []
      if (!wards.includes(body.studentId)) throw forbidden('That student is not your ward')
    } else if (actor.role === 'student' && body.studentId !== actor.userId) {
      throw forbidden('You may only request a meeting about yourself')
    }
  }
  const row: Row = {
    id: uid('meeting'), schoolId: actor.schoolId, requesterId: actor.userId, withUserId: withUser.id,
    studentId: body.studentId ?? (actor.role === 'student' ? actor.userId : null),
    purpose: body.purpose, scheduledAt: body.scheduledAt, durationMin: body.durationMin ?? 30, link: null, status: 'Requested',
    decidedById: null, decidedAt: null, note: null, createdAt: nowIso(),
  }
  const rows = table('Meeting'); rows.push(row); saveTable('Meeting', rows)
  return status(201, { item: serializeMeeting(row) })
})

function getMeeting(actor: Actor, id: string): Row {
  const row = table('Meeting').find(m => m.id === id && m.schoolId === actor.schoolId)
  if (!row) throw notFound('Meeting')
  return row
}
function assertDecidable(actor: Actor, row: Row) {
  if (row.withUserId !== actor.userId && !isAdmin(actor.role)) throw forbidden('Only the invited teacher/admin may decide this meeting')
  if (row.status !== 'Requested') throw conflict(`Meeting is already ${String(row.status).toLowerCase()}`)
}

route('POST', '/meetings/:id/approve', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getMeeting(actor, ctx.params.id)
  assertDecidable(actor, before)
  const { note } = (ctx.body ?? {}) as { note?: string }
  const rows = table('Meeting'); const idx = rows.findIndex(m => m.id === before.id)
  rows[idx] = { ...rows[idx], status: 'Scheduled', decidedById: actor.userId, decidedAt: nowIso(), note: note ?? null, link: jitsiLink(actor.schoolId, before.id) }
  saveTable('Meeting', rows)
  return { item: serializeMeeting(rows[idx]) }
})

route('POST', '/meetings/:id/decline', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getMeeting(actor, ctx.params.id)
  assertDecidable(actor, before)
  const { note } = (ctx.body ?? {}) as { note?: string }
  const rows = table('Meeting'); const idx = rows.findIndex(m => m.id === before.id)
  rows[idx] = { ...rows[idx], status: 'Declined', decidedById: actor.userId, decidedAt: nowIso(), note: note ?? null }
  saveTable('Meeting', rows)
  return { item: serializeMeeting(rows[idx]) }
})

route('POST', '/meetings/:id/cancel', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getMeeting(actor, ctx.params.id)
  if (!['Requested', 'Scheduled'].includes(before.status as string)) throw conflict(`Meeting is already ${String(before.status).toLowerCase()}`)
  if (before.requesterId !== actor.userId && before.withUserId !== actor.userId && !isAdmin(actor.role)) throw forbidden('You are not part of this meeting')
  const rows = table('Meeting'); const idx = rows.findIndex(m => m.id === before.id)
  rows[idx] = { ...rows[idx], status: 'Cancelled' }
  saveTable('Meeting', rows)
  return { item: serializeMeeting(rows[idx]) }
})

route('POST', '/meetings/:id/complete', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getMeeting(actor, ctx.params.id)
  if (before.status !== 'Scheduled') throw conflict(`Meeting must be Scheduled to complete (is ${before.status})`)
  if (before.withUserId !== actor.userId && !isAdmin(actor.role)) throw forbidden('Only the invited teacher/admin may complete this meeting')
  const rows = table('Meeting'); const idx = rows.findIndex(m => m.id === before.id)
  rows[idx] = { ...rows[idx], status: 'Completed' }
  saveTable('Meeting', rows)
  return { item: serializeMeeting(rows[idx]) }
})
