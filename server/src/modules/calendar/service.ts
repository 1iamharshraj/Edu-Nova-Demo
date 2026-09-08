import type { z } from 'zod'
import type { CalendarEvent } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import { fmtDate, toDate } from '../../lib/validate'
import type { Ctx } from '../../lib/rbac'
import { isStaff, teacherClassIds, wardClassIds, studentClassIds, getClass, getTerm } from '../../lib/scope'
import type { createEvent, patchEvent, eventsQuery } from './schema'

// See phase-7-communication.md → /api/calendar. GET is audience-filtered (School = everyone, Class =
// that class's students/parents/teachers, staff/admin see all). Writes: staff/admin only.

export const serializeEvent = (e: CalendarEvent) => ({
  id: e.id, title: e.title, date: fmtDate(e.date), endDate: e.endDate ? fmtDate(e.endDate) : undefined,
  type: e.type, audience: e.audience, classId: e.classId ?? undefined, termId: e.termId ?? undefined, createdById: e.createdById,
})

export async function listEvents(ctx: Ctx, q: z.infer<typeof eventsQuery>) {
  const where: Record<string, unknown> = { schoolId: ctx.schoolId }
  if (q.termId) where.termId = q.termId
  if (q.from || q.to) where.date = { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) }

  const rows = await prisma.calendarEvent.findMany({ where, orderBy: [{ date: 'asc' }] })
  if (isStaff(ctx)) return rows.map(serializeEvent)

  let classIds: string[] = []
  if (ctx.role === 'student') classIds = await studentClassIds(ctx.actorId)
  else if (ctx.role === 'parent') classIds = await wardClassIds(ctx)
  else if (ctx.role === 'teacher') classIds = await teacherClassIds(ctx)

  const visible = rows.filter(e => e.audience === 'School' || (e.audience === 'Class' && classIds.includes(e.classId!)))
  return visible.map(serializeEvent)
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.calendarEvent.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Calendar event')
  return row
}

export async function createEventSvc(ctx: Ctx, input: z.infer<typeof createEvent>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may create calendar events')
  if (input.audience === 'Class') await getClass(ctx, input.classId!)
  if (input.termId) await getTerm(ctx, input.termId)
  const row = await prisma.calendarEvent.create({
    data: {
      schoolId: ctx.schoolId, title: input.title, date: toDate(input.date), endDate: input.endDate ? toDate(input.endDate) : null,
      type: input.type, audience: input.audience, classId: input.audience === 'Class' ? input.classId : null,
      termId: input.termId ?? null, createdById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'calendarEvent', row.id, undefined, serializeEvent(row))
  return row
}

export async function updateEvent(ctx: Ctx, id: string, input: z.infer<typeof patchEvent>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may edit calendar events')
  const before = await get(ctx, id)
  if (input.audience === 'Class' && input.classId) await getClass(ctx, input.classId)
  if (input.termId) await getTerm(ctx, input.termId)
  const row = await prisma.calendarEvent.update({
    where: { id },
    data: {
      title: input.title, date: input.date ? toDate(input.date) : undefined, endDate: input.endDate ? toDate(input.endDate) : undefined,
      type: input.type, audience: input.audience, classId: input.audience ? (input.audience === 'Class' ? input.classId : null) : input.classId,
      termId: input.termId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'calendarEvent', id, serializeEvent(before), serializeEvent(row))
  return row
}

export async function deleteEvent(ctx: Ctx, id: string) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may delete calendar events')
  const before = await get(ctx, id)
  await prisma.calendarEvent.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'calendarEvent', id, serializeEvent(before))
}
