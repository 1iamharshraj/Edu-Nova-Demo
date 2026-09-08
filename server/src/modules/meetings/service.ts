import type { z } from 'zod'
import type { Meeting } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notify } from '../../lib/notify'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isAdmin, isStaff, visibleStudentIds } from '../../lib/scope'
import type { createMeeting, decideMeeting, meetingsQuery } from './schema'

// See phase-7-communication.md → /api/meetings and Rules → "Meetings". Requester: parent/student/teacher.
// `withUserId`: a teacher or admin — the party who decides. Link: on Scheduled, generate a Jitsi room
// unless MEET_PROVIDER=none.

const shortId = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase()
const jitsiLink = (schoolId: string, meetingId: string) =>
  process.env.MEET_PROVIDER === 'none' ? null : `https://meet.jit.si/edunova-${shortId(schoolId)}-${meetingId}`

export const serializeMeeting = (m: Meeting) => ({
  id: m.id, requesterId: m.requesterId, withUserId: m.withUserId, studentId: m.studentId ?? undefined,
  purpose: m.purpose, scheduledAt: m.scheduledAt.toISOString(), durationMin: m.durationMin, link: m.link ?? undefined,
  status: m.status, decidedById: m.decidedById ?? undefined, decidedAt: m.decidedAt?.toISOString(), note: m.note ?? undefined,
  createdAt: m.createdAt.toISOString(),
})

export async function listMeetings(ctx: Ctx, q: z.infer<typeof meetingsQuery>) {
  const where: Record<string, unknown> = { schoolId: ctx.schoolId, status: q.status }
  if (ctx.role === 'parent') {
    const wards = (await visibleStudentIds(ctx))!
    where.OR = [{ requesterId: ctx.actorId }, { studentId: { in: wards } }]
  } else if (ctx.role === 'student') {
    where.OR = [{ requesterId: ctx.actorId }, { studentId: ctx.actorId }]
  } else if (ctx.role === 'teacher') {
    where.OR = [{ requesterId: ctx.actorId }, { withUserId: ctx.actorId }]
  } else if (!isStaff(ctx)) {
    throw new HttpError(403, 'Forbidden')
  }
  // staff/admin/superadmin: all.
  const rows = await prisma.meeting.findMany({ where, orderBy: [{ scheduledAt: 'desc' }] })
  return rows.map(serializeMeeting)
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.meeting.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Meeting')
  return row
}

export async function createMeetingSvc(ctx: Ctx, input: z.infer<typeof createMeeting>) {
  if (!['parent', 'student', 'teacher'].includes(ctx.role)) throw new HttpError(403, 'Only parent, student or teacher may request a meeting')

  const withUser = await prisma.user.findFirst({ where: { id: input.withUserId, schoolId: ctx.schoolId } })
  if (!withUser) throw notFound('User')
  if (!['teacher', 'admin', 'superadmin'].includes(withUser.role)) throw new HttpError(400, 'You may only request a meeting with a teacher or admin')

  if (input.studentId) {
    if (ctx.role === 'parent') {
      const wards = (await visibleStudentIds(ctx))!
      if (!wards.includes(input.studentId)) throw new HttpError(403, 'That student is not your ward')
    } else if (ctx.role === 'student' && input.studentId !== ctx.actorId) {
      throw new HttpError(403, 'You may only request a meeting about yourself')
    }
  }

  const row = await prisma.meeting.create({
    data: {
      schoolId: ctx.schoolId, requesterId: ctx.actorId, withUserId: withUser.id,
      studentId: input.studentId ?? (ctx.role === 'student' ? ctx.actorId : null),
      purpose: input.purpose, scheduledAt: new Date(input.scheduledAt), durationMin: input.durationMin ?? 30,
      status: 'Requested',
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'meeting', row.id, undefined, serializeMeeting(row))
  await notify(ctx.schoolId, withUser.id, 'meeting', 'New meeting request', input.purpose, 'meet')
  return row
}

function assertDecidable(ctx: Ctx, row: Meeting) {
  if (row.withUserId !== ctx.actorId && !isAdmin(ctx)) throw new HttpError(403, 'Only the invited teacher/admin may decide this meeting')
  if (row.status !== 'Requested') throw new HttpError(409, `Meeting is already ${row.status.toLowerCase()}`)
}

export async function approve(ctx: Ctx, id: string, input: z.infer<typeof decideMeeting>) {
  const before = await get(ctx, id)
  assertDecidable(ctx, before)
  const row = await prisma.meeting.update({
    where: { id }, data: { status: 'Scheduled', decidedById: ctx.actorId, decidedAt: new Date(), note: input.note ?? null, link: jitsiLink(ctx.schoolId, id) },
  })
  await audit(ctx.schoolId, ctx.actorId, 'approve', 'meeting', id, serializeMeeting(before), serializeMeeting(row))
  await notify(ctx.schoolId, row.requesterId, 'meeting', 'Meeting scheduled', row.purpose, 'meet')
  return row
}

export async function decline(ctx: Ctx, id: string, input: z.infer<typeof decideMeeting>) {
  const before = await get(ctx, id)
  assertDecidable(ctx, before)
  const row = await prisma.meeting.update({
    where: { id }, data: { status: 'Declined', decidedById: ctx.actorId, decidedAt: new Date(), note: input.note ?? null },
  })
  await audit(ctx.schoolId, ctx.actorId, 'decline', 'meeting', id, serializeMeeting(before), serializeMeeting(row))
  await notify(ctx.schoolId, row.requesterId, 'meeting', 'Meeting declined', row.purpose, 'meet')
  return row
}

export async function cancel(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  if (!['Requested', 'Scheduled'].includes(before.status)) throw new HttpError(409, `Meeting is already ${before.status.toLowerCase()}`)
  if (before.requesterId !== ctx.actorId && before.withUserId !== ctx.actorId && !isAdmin(ctx)) throw new HttpError(403, 'You are not part of this meeting')
  const row = await prisma.meeting.update({ where: { id }, data: { status: 'Cancelled' } })
  await audit(ctx.schoolId, ctx.actorId, 'cancel', 'meeting', id, serializeMeeting(before), serializeMeeting(row))
  const other = ctx.actorId === row.requesterId ? row.withUserId : row.requesterId
  await notify(ctx.schoolId, other, 'meeting', 'Meeting cancelled', row.purpose, 'meet')
  return row
}

export async function complete(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  if (before.status !== 'Scheduled') throw new HttpError(409, `Meeting must be Scheduled to complete (is ${before.status})`)
  if (before.withUserId !== ctx.actorId && !isAdmin(ctx)) throw new HttpError(403, 'Only the invited teacher/admin may complete this meeting')
  const row = await prisma.meeting.update({ where: { id }, data: { status: 'Completed' } })
  await audit(ctx.schoolId, ctx.actorId, 'complete', 'meeting', id, serializeMeeting(before), serializeMeeting(row))
  return row
}
