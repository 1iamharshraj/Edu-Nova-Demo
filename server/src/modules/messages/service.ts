import type { z } from 'zod'
import type { User } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notify } from '../../lib/notify'
import { sendToUsers, isConnected } from '../../lib/realtime'
import { HttpError, notFound } from '../../lib/errors'
import { paginate } from '../../lib/pagination'
import type { Ctx } from '../../lib/rbac'
import { isStaff, getClass, teacherClassIds, wardClassIds, studentClassIds, classesTaughtBy, rosterOf } from '../../lib/scope'
import type { createConversation, messagesQuery, createMessage } from './schema'

// See phase-7-communication.md → /api/messages and Rules → "Conversations". Allowed DM pairs: parent ↔
// teacher of a ward's class (incl. class teacher) or staff/admin; student ↔ own teachers; teacher ↔
// teacher/staff/admin; staff/admin ↔ anyone. Group conversations: created by teacher/staff/admin for a
// class (all guardians + students of the class + class teachers).

const CONV_INCLUDE = { participants: { include: { user: { select: { id: true, name: true, role: true } } } } }

// Whether ctx.actorId may open/use a DM with `other`.
export async function canConverse(ctx: Ctx, other: User): Promise<boolean> {
  if (other.id === ctx.actorId) return false
  if (isStaff(ctx) || ['staff', 'admin', 'superadmin'].includes(other.role)) return true
  if (ctx.role === 'parent' && other.role === 'teacher') {
    const wards = await wardClassIds(ctx)
    return (await classesTaughtBy(ctx.schoolId, other.id)).some(c => wards.includes(c))
  }
  if (ctx.role === 'teacher' && other.role === 'parent') {
    const mine = await teacherClassIds(ctx)
    const theirWards = await prisma.guardian.findMany({ where: { parentId: other.id }, select: { studentId: true } })
    for (const w of theirWards) {
      if ((await studentClassIds(w.studentId)).some(c => mine.includes(c))) return true
    }
    return false
  }
  if (ctx.role === 'student' && other.role === 'teacher') {
    const mine = await studentClassIds(ctx.actorId)
    return (await classesTaughtBy(ctx.schoolId, other.id)).some(c => mine.includes(c))
  }
  if (ctx.role === 'teacher' && other.role === 'student') {
    const mine = await teacherClassIds(ctx)
    return (await studentClassIds(other.id)).some(c => mine.includes(c))
  }
  if (ctx.role === 'teacher' && other.role === 'teacher') return true
  return false
}

async function classGroupParticipantIds(schoolId: string, classId: string): Promise<string[]> {
  const roster = await rosterOf(classId)
  const studentIds = roster.map(r => r.id)
  const [guardians, teachers] = await Promise.all([
    prisma.guardian.findMany({ where: { studentId: { in: studentIds } }, select: { parentId: true } }),
    prisma.user.findMany({ where: { schoolId, OR: [{ classTeacherOf: { some: { id: classId } } }, { teaching: { some: { classId } } }] }, select: { id: true } }),
  ])
  return [...new Set([...studentIds, ...guardians.map(g => g.parentId), ...teachers.map(t => t.id)])]
}

export async function listConversations(ctx: Ctx) {
  const rows = await prisma.conversation.findMany({
    where: { participants: { some: { userId: ctx.actorId } }, schoolId: ctx.schoolId },
    include: { ...CONV_INCLUDE, messages: { orderBy: { sentAt: 'desc' }, take: 1 } },
    orderBy: { createdAt: 'desc' },
  })
  const out = []
  for (const c of rows) {
    const me = c.participants.find(p => p.userId === ctx.actorId)!
    const unread = await prisma.message.count({
      where: { conversationId: c.id, senderId: { not: ctx.actorId }, sentAt: me.lastReadAt ? { gt: me.lastReadAt } : undefined },
    })
    out.push({
      id: c.id, kind: c.kind, title: c.title ?? undefined, classId: c.classId ?? undefined,
      participants: c.participants.map(p => ({ userId: p.userId, name: p.user.name, role: p.user.role, lastReadAt: p.lastReadAt?.toISOString() })),
      lastMessage: c.messages[0] ? { id: c.messages[0].id, body: c.messages[0].body, senderId: c.messages[0].senderId, sentAt: c.messages[0].sentAt.toISOString() } : undefined,
      unread,
      createdAt: c.createdAt.toISOString(),
    })
  }
  return out.sort((a, b) => (b.lastMessage?.sentAt ?? b.createdAt).localeCompare(a.lastMessage?.sentAt ?? a.createdAt))
}

async function getMembership(ctx: Ctx, conversationId: string) {
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, schoolId: ctx.schoolId }, include: CONV_INCLUDE })
  if (!conv) throw notFound('Conversation')
  const me = conv.participants.find(p => p.userId === ctx.actorId)
  if (!me) throw new HttpError(403, 'You are not a participant in this conversation')
  return { conv, me }
}

export async function createConversationSvc(ctx: Ctx, input: z.infer<typeof createConversation>) {
  if (input.classId) {
    if (ctx.role !== 'teacher' && !isStaff(ctx)) throw new HttpError(403, 'Only a teacher, staff or admin may start a class group')
    const cls = await getClass(ctx, input.classId)
    if (ctx.role === 'teacher' && !(await teacherClassIds(ctx)).includes(input.classId)) throw new HttpError(403, 'You do not teach this class')
    const memberIds = new Set([...(await classGroupParticipantIds(ctx.schoolId, input.classId)), ctx.actorId])
    const conv = await prisma.conversation.create({
      data: {
        schoolId: ctx.schoolId, kind: 'Group', classId: input.classId, createdById: ctx.actorId,
        title: input.title ?? `${cls.grade.label}-${cls.section} class group`,
        participants: { create: [...memberIds].map(userId => ({ userId })) },
      },
      include: CONV_INCLUDE,
    })
    await audit(ctx.schoolId, ctx.actorId, 'create', 'conversation', conv.id, undefined, { kind: 'Group', classId: input.classId })
    return conv
  }

  const userIds = [...new Set(input.userIds!)].filter(id => id !== ctx.actorId)
  if (!userIds.length) throw new HttpError(400, 'userIds must include at least one other user')

  const others = await prisma.user.findMany({ where: { id: { in: userIds }, schoolId: ctx.schoolId } })
  if (others.length !== userIds.length) throw notFound('User')
  for (const other of others) {
    if (!(await canConverse(ctx, other))) throw new HttpError(403, `You are not allowed to message ${other.name}`)
  }

  if (userIds.length === 1) {
    // Reuse an existing DM between exactly these two users rather than creating a duplicate.
    const existing = await prisma.conversation.findFirst({
      where: {
        schoolId: ctx.schoolId, kind: 'DM',
        AND: [{ participants: { some: { userId: ctx.actorId } } }, { participants: { some: { userId: userIds[0] } } }],
      },
      include: CONV_INCLUDE,
    })
    if (existing && existing.participants.length === 2) return existing
  }

  const conv = await prisma.conversation.create({
    data: {
      schoolId: ctx.schoolId, kind: userIds.length === 1 ? 'DM' : 'Group', title: input.title ?? null, createdById: ctx.actorId,
      participants: { create: [ctx.actorId, ...userIds].map(userId => ({ userId })) },
    },
    include: CONV_INCLUDE,
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'conversation', conv.id, undefined, { kind: conv.kind, userIds })
  return conv
}

// `before` (date-based, oldest-first UI paging — pre-existing) and `cursor`/`limit` (id-based, Phase 10)
// compose: both narrow the same "older than X" window. `nextCursor` is the oldest fetched message's id,
// ready to pass back as `cursor` for the next page further into history.
export async function listMessages(ctx: Ctx, conversationId: string, q: z.infer<typeof messagesQuery>) {
  await getMembership(ctx, conversationId)
  const where = { conversationId, ...(q.before ? { sentAt: { lt: new Date(q.before) } } : {}) }
  const { items, nextCursor } = await paginate(
    args => prisma.message.findMany({
      where,
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      include: { sender: { select: { id: true, name: true, role: true } } },
      ...args,
    }),
    { limit: q.limit, cursor: q.cursor, defaultLimit: 50 },
  )
  return { items: items.reverse().map(serializeMessage), nextCursor }
}

export const serializeMessage = (m: { id: string; conversationId: string; body: string; fileIds: string[]; sentAt: Date; sender: { id: string; name: string; role: string } }) => ({
  id: m.id, conversationId: m.conversationId, body: m.body, fileIds: m.fileIds, sentAt: m.sentAt.toISOString(), sender: m.sender,
})

export async function sendMessage(ctx: Ctx, conversationId: string, input: z.infer<typeof createMessage>) {
  const { conv } = await getMembership(ctx, conversationId)
  const row = await prisma.message.create({
    data: { conversationId, senderId: ctx.actorId, body: input.body, fileIds: input.fileIds ?? [] },
    include: { sender: { select: { id: true, name: true, role: true } } },
  })
  const payload = serializeMessage(row)
  const others = conv.participants.map(p => p.userId).filter(id => id !== ctx.actorId)
  sendToUsers(others, { type: 'message', payload })
  for (const uid of others) {
    if (!isConnected(uid)) await notify(ctx.schoolId, uid, 'message', `New message from ${payload.sender.name}`, input.body.slice(0, 140), 'msgs')
  }
  return payload
}

export async function markRead(ctx: Ctx, conversationId: string) {
  const { me } = await getMembership(ctx, conversationId)
  await prisma.participant.update({ where: { id: me.id }, data: { lastReadAt: new Date() } })
  return { ok: true }
}

// ── contacts: people the caller may start a conversation with, grouped by role ──

export async function listContacts(ctx: Ctx) {
  const baseWhere = { schoolId: ctx.schoolId, id: { not: ctx.actorId }, active: true }
  const staffAdmin = await prisma.user.findMany({ where: { ...baseWhere, role: { in: ['staff', 'admin', 'superadmin'] } }, select: { id: true, name: true, role: true, title: true } })

  if (isStaff(ctx)) {
    const everyoneElse = await prisma.user.findMany({ where: baseWhere, select: { id: true, name: true, role: true, title: true } })
    return groupByRole(everyoneElse)
  }

  if (ctx.role === 'parent' || ctx.role === 'student') {
    const classIds = ctx.role === 'parent' ? await wardClassIds(ctx) : await studentClassIds(ctx.actorId)
    const teachers = classIds.length
      ? await prisma.user.findMany({
          where: { schoolId: ctx.schoolId, role: 'teacher', OR: [{ classTeacherOf: { some: { id: { in: classIds } } } }, { teaching: { some: { classId: { in: classIds } } } }] },
          select: { id: true, name: true, role: true, title: true },
        })
      : []
    return groupByRole([...teachers, ...staffAdmin])
  }

  if (ctx.role === 'teacher') {
    const classIds = await teacherClassIds(ctx)
    const teachers = await prisma.user.findMany({ where: { schoolId: ctx.schoolId, role: 'teacher', id: { not: ctx.actorId } }, select: { id: true, name: true, role: true, title: true } })
    const students = classIds.length
      ? await prisma.user.findMany({ where: { schoolId: ctx.schoolId, role: 'student', enrollments: { some: { classId: { in: classIds }, status: 'active' } } }, select: { id: true, name: true, role: true, title: true } })
      : []
    const studentIds = students.map(s => s.id)
    const parents = studentIds.length
      ? await prisma.user.findMany({ where: { schoolId: ctx.schoolId, role: 'parent', wardLinks: { some: { studentId: { in: studentIds } } } }, select: { id: true, name: true, role: true, title: true } })
      : []
    return groupByRole([...teachers, ...staffAdmin, ...students, ...parents])
  }

  return groupByRole(staffAdmin)
}

function groupByRole(users: { id: string; name: string; role: string; title: string }[]) {
  const seen = new Map<string, { id: string; name: string; role: string; title: string }>()
  for (const u of users) seen.set(u.id, u)
  const grouped: Record<string, { id: string; name: string; role: string; title: string }[]> = {}
  for (const u of seen.values()) (grouped[u.role] ??= []).push(u)
  for (const list of Object.values(grouped)) list.sort((a, b) => a.name.localeCompare(b.name))
  return grouped
}
