// Mirrors server/src/modules/messages/{router,service}.ts (phase-7-communication.md). Conversations
// (DM/Group) + Participant (per-user lastReadAt) + Message. Allowed DM pairs, simplified from the real
// service's exact rule set but keeping its spirit: staff/admin may message anyone; parent<->teacher when
// the teacher teaches one of the parent's wards' classes; student<->teacher when the teacher teaches the
// student's class; teacher<->teacher always. Group conversations: created by teacher/staff/admin for a
// class (its roster's students + their guardians + the class's teachers).

import { route, requireAuth, status } from '../router'
import { notFound, forbidden, badRequest } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = new Set(['staff', 'admin', 'superadmin'])
const isStaff = (role: string) => STAFF_ROLES.has(role)

function studentClassIds(studentId: string): string[] {
  return table('Enrollment').filter(e => e.studentId === studentId && e.status === 'active').map(e => String(e.classId))
}
function wardClassIds(parentId: string): string[] {
  const wardIds = table('Guardian').filter(g => g.parentId === parentId).map(g => g.studentId)
  return [...new Set(wardIds.flatMap(id => studentClassIds(String(id))))]
}
function teacherClassIds(teacherId: string): string[] {
  const classTeacherOf = table('Class').filter(c => c.classTeacherId === teacherId).map(c => c.id)
  const teachingOf = table('ClassSubject').filter(cs => cs.teacherId === teacherId).map(cs => cs.classId)
  return [...new Set([...classTeacherOf, ...teachingOf].map(String))]
}

function canConverse(actor: { userId: string; role: string }, other: Row): boolean {
  if (other.id === actor.userId) return false
  if (isStaff(actor.role) || STAFF_ROLES.has(String(other.role))) return true
  if (actor.role === 'parent' && other.role === 'teacher') return wardClassIds(actor.userId).some(c => teacherClassIds(other.id as string).includes(c))
  if (actor.role === 'teacher' && other.role === 'parent') return wardClassIds(other.id as string).some(c => teacherClassIds(actor.userId).includes(c))
  if (actor.role === 'student' && other.role === 'teacher') return studentClassIds(actor.userId).some(c => teacherClassIds(other.id as string).includes(c))
  if (actor.role === 'teacher' && other.role === 'student') return studentClassIds(other.id as string).some(c => teacherClassIds(actor.userId).includes(c))
  if (actor.role === 'teacher' && other.role === 'teacher') return true
  return false
}

function classGroupParticipantIds(schoolId: string, classId: string): string[] {
  const studentIds = table('Enrollment').filter(e => e.schoolId === schoolId && e.classId === classId && e.status === 'active').map(e => String(e.studentId))
  const guardianIds = table('Guardian').filter(g => g.schoolId === schoolId && studentIds.includes(String(g.studentId))).map(g => String(g.parentId))
  const cls = table('Class').find(c => c.id === classId)
  const teacherIds = [
    ...(cls?.classTeacherId ? [String(cls.classTeacherId)] : []),
    ...table('ClassSubject').filter(cs => cs.classId === classId).map(cs => String(cs.teacherId)),
  ]
  return [...new Set([...studentIds, ...guardianIds, ...teacherIds])]
}

function participantsOf(conversationId: string) {
  return table('Participant').filter(p => p.conversationId === conversationId).map(p => {
    const u = table('User').find(x => x.id === p.userId)
    return { userId: p.userId, name: u?.name ?? 'Unknown', role: u?.role ?? 'staff', lastReadAt: p.lastReadAt ?? undefined }
  })
}

function serializeConversation(c: Row, actorId: string) {
  const participants = participantsOf(c.id)
  const messages = [...table('Message').filter(m => m.conversationId === c.id)].sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))
  const last = messages[0]
  const me = table('Participant').find(p => p.conversationId === c.id && p.userId === actorId)
  const unread = messages.filter(m => m.senderId !== actorId && (!me?.lastReadAt || String(m.sentAt) > String(me.lastReadAt))).length
  return {
    id: c.id, kind: c.kind, title: c.title ?? undefined, classId: c.classId ?? undefined, createdById: c.createdById,
    participants, lastMessage: last ? { id: last.id, body: last.body, senderId: last.senderId, sentAt: last.sentAt } : undefined,
    unread, createdAt: c.createdAt,
  }
}

function serializeMessage(m: Row) {
  const sender = table('User').find(u => u.id === m.senderId)
  return { id: m.id, conversationId: m.conversationId, body: m.body, fileIds: m.fileIds ?? [], sentAt: m.sentAt, sender: { id: m.senderId, name: sender?.name ?? 'Unknown', role: sender?.role ?? 'staff' } }
}

function getMembership(actor: { userId: string; schoolId: string }, conversationId: string) {
  const conv = table('Conversation').find(c => c.id === conversationId && c.schoolId === actor.schoolId)
  if (!conv) throw notFound('Conversation')
  const me = table('Participant').find(p => p.conversationId === conversationId && p.userId === actor.userId)
  if (!me) throw forbidden('You are not a participant in this conversation')
  return { conv, me }
}

// ───────────────────────── conversations ─────────────────────────

route('GET', '/messages/conversations', (ctx) => {
  const actor = requireAuth(ctx)
  const myConvIds = new Set(table('Participant').filter(p => p.userId === actor.userId).map(p => p.conversationId))
  const rows = table('Conversation').filter(c => c.schoolId === actor.schoolId && myConvIds.has(c.id))
  const items = rows.map(c => serializeConversation(c, actor.userId))
  items.sort((a, b) => String(b.lastMessage?.sentAt ?? b.createdAt).localeCompare(String(a.lastMessage?.sentAt ?? a.createdAt)))
  return { items }
})

route('POST', '/messages/conversations', (ctx) => {
  const actor = requireAuth(ctx)
  const b = ctx.body as { userIds?: string[]; classId?: string; title?: string }
  if (!!b.userIds === !!b.classId) throw badRequest('Provide exactly one of userIds or classId')

  if (b.classId) {
    if (actor.role !== 'teacher' && !isStaff(actor.role)) throw forbidden('Only a teacher, staff or admin may start a class group')
    const cls = table('Class').find(c => c.id === b.classId && c.schoolId === actor.schoolId)
    if (!cls) throw notFound('Class')
    if (actor.role === 'teacher' && !teacherClassIds(actor.userId).includes(b.classId)) throw forbidden('You do not teach this class')
    const grade = table('Grade').find(g => g.id === cls.gradeId)
    const memberIds = new Set([...classGroupParticipantIds(actor.schoolId, b.classId), actor.userId])
    const conv: Row = { id: uid('conv'), schoolId: actor.schoolId, kind: 'Group', title: b.title ?? `${grade?.label ?? ''}-${cls.section} class group`, classId: b.classId, createdById: actor.userId, createdAt: nowIso() }
    const convs = table('Conversation'); convs.push(conv); saveTable('Conversation', convs)
    const parts = table('Participant')
    for (const userId of memberIds) parts.push({ id: uid('part'), conversationId: conv.id, userId, lastReadAt: userId === actor.userId ? nowIso() : null, createdAt: nowIso() } as Row)
    saveTable('Participant', parts)
    return status(201, { item: serializeConversation(conv, actor.userId) })
  }

  const userIds = [...new Set(b.userIds!)].filter(id => id !== actor.userId)
  if (!userIds.length) throw badRequest('userIds must include at least one other user')
  const others = userIds.map(id => table('User').find(u => u.id === id && u.schoolId === actor.schoolId))
  if (others.some(o => !o)) throw notFound('User')
  for (const other of others as Row[]) {
    if (!canConverse(actor, other)) throw forbidden(`You are not allowed to message ${other.name}`)
  }

  if (userIds.length === 1) {
    const mine = new Set(table('Participant').filter(p => p.userId === actor.userId).map(p => p.conversationId))
    const theirs = new Set(table('Participant').filter(p => p.userId === userIds[0]).map(p => p.conversationId))
    const existingId = [...mine].find(id => theirs.has(id) && table('Conversation').find(c => c.id === id)?.kind === 'DM'
      && table('Participant').filter(p => p.conversationId === id).length === 2)
    if (existingId) {
      const existing = table('Conversation').find(c => c.id === existingId)!
      return { item: serializeConversation(existing, actor.userId) }
    }
  }

  const conv: Row = { id: uid('conv'), schoolId: actor.schoolId, kind: userIds.length === 1 ? 'DM' : 'Group', title: b.title ?? null, classId: null, createdById: actor.userId, createdAt: nowIso() }
  const convs = table('Conversation'); convs.push(conv); saveTable('Conversation', convs)
  const parts = table('Participant')
  for (const userId of [actor.userId, ...userIds]) parts.push({ id: uid('part'), conversationId: conv.id, userId, lastReadAt: userId === actor.userId ? nowIso() : null, createdAt: nowIso() } as Row)
  saveTable('Participant', parts)
  return status(201, { item: serializeConversation(conv, actor.userId) })
})

route('GET', '/messages/conversations/:id/messages', (ctx) => {
  const actor = requireAuth(ctx)
  getMembership(actor, ctx.params.id)
  const { before } = ctx.query
  let rows = table('Message').filter(m => m.conversationId === ctx.params.id)
  if (before) rows = rows.filter(m => String(m.sentAt) < before)
  rows = [...rows].sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)))
  return { items: rows.map(serializeMessage) }
})

route('POST', '/messages/conversations/:id/messages', (ctx) => {
  const actor = requireAuth(ctx)
  const { conv } = getMembership(actor, ctx.params.id)
  const b = ctx.body as { body: string; fileIds?: string[] }
  if (!b.body?.trim()) throw badRequest('body is required')
  const row: Row = { id: uid('msg'), conversationId: conv.id, senderId: actor.userId, body: b.body.trim(), fileIds: b.fileIds ?? [], sentAt: nowIso() }
  const rows = table('Message'); rows.push(row); saveTable('Message', rows)

  const payload = serializeMessage(row)
  const others = table('Participant').filter(p => p.conversationId === conv.id && p.userId !== actor.userId).map(p => p.userId)
  const notifs = table('Notification')
  for (const uidStr of others) {
    notifs.push({ id: uid('notif'), schoolId: actor.schoolId, userId: uidStr, kind: 'message', title: `New message from ${payload.sender.name}`, body: b.body.slice(0, 140), link: 'msgs', readAt: null, createdAt: nowIso() } as Row)
  }
  saveTable('Notification', notifs)

  return status(201, { item: payload })
})

route('POST', '/messages/conversations/:id/read', (ctx) => {
  const actor = requireAuth(ctx)
  const { me } = getMembership(actor, ctx.params.id)
  const rows = table('Participant')
  const idx = rows.findIndex(p => p.id === me.id)
  rows[idx] = { ...rows[idx], lastReadAt: nowIso() }
  saveTable('Participant', rows)
  return { ok: true }
})

// ───────────────────────── contacts ─────────────────────────

interface ContactRow { id: string; name: string; role: string; title?: string }
function groupByRole(users: ContactRow[]) {
  const seen = new Map<string, ContactRow>()
  for (const u of users) seen.set(u.id, u)
  const grouped: Record<string, ContactRow[]> = {}
  for (const u of seen.values()) (grouped[u.role] ??= []).push(u)
  for (const list of Object.values(grouped)) list.sort((a, b) => a.name.localeCompare(b.name))
  return grouped
}
function asContact(u: Row): ContactRow { return { id: u.id, name: String(u.name), role: String(u.role), title: u.title ? String(u.title) : undefined } }

route('GET', '/messages/contacts', (ctx) => {
  const actor = requireAuth(ctx)
  const base = table('User').filter(u => u.schoolId === actor.schoolId && u.id !== actor.userId && u.active !== false)
  const staffAdmin = base.filter(u => STAFF_ROLES.has(String(u.role))).map(asContact)

  if (isStaff(actor.role)) return { items: groupByRole(base.map(asContact)) }

  if (actor.role === 'parent' || actor.role === 'student') {
    const classIds = actor.role === 'parent' ? wardClassIds(actor.userId) : studentClassIds(actor.userId)
    const teachers = base.filter(u => u.role === 'teacher' && teacherClassIds(u.id).some(c => classIds.includes(c))).map(asContact)
    return { items: groupByRole([...teachers, ...staffAdmin]) }
  }

  if (actor.role === 'teacher') {
    const teachers = base.filter(u => u.role === 'teacher').map(asContact)
    const classIds = teacherClassIds(actor.userId)
    const studentIds = table('Enrollment').filter(e => e.schoolId === actor.schoolId && classIds.includes(String(e.classId)) && e.status === 'active').map(e => String(e.studentId))
    const students = base.filter(u => u.role === 'student' && studentIds.includes(u.id)).map(asContact)
    const parents = base.filter(u => u.role === 'parent' && table('Guardian').some(g => studentIds.includes(String(g.studentId)) && g.parentId === u.id)).map(asContact)
    return { items: groupByRole([...teachers, ...staffAdmin, ...students, ...parents]) }
  }

  return { items: groupByRole(staffAdmin) }
})
