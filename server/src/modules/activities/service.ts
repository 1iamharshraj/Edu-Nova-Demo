import type { z } from 'zod'
import type { Activity, ActivityRegistration } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notify } from '../../lib/notify'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isAdmin, isStaff } from '../../lib/scope'
import type { createActivity, patchActivity, activitiesQuery } from './schema'

// See phase-8-welfare.md → Rules ("Activities") and Endpoints. Create/edit: staff/admin. Register:
// students/teachers (per `forRoles`); full capacity → Waitlisted. Cancelling a Registered slot promotes
// the earliest Waitlisted registration to Registered — undocumented in the spec ("your call, document it")
// but the natural behaviour for a capacity-gated sign-up and what RegistrationsMod's UI expects.

export const serializeActivity = (a: Activity, registered?: number) => ({
  id: a.id, kind: a.kind, title: a.title, description: a.description, capacity: a.capacity ?? undefined,
  opensAt: a.opensAt?.toISOString(), closesAt: a.closesAt?.toISOString(), forRoles: a.forRoles,
  createdById: a.createdById, createdAt: a.createdAt.toISOString(),
  registered,
})

export const serializeRegistration = (r: ActivityRegistration) => ({
  id: r.id, activityId: r.activityId, userId: r.userId, registeredAt: r.registeredAt.toISOString(), status: r.status,
})

const registeredCount = (activityId: string) => prisma.activityRegistration.count({ where: { activityId, status: 'Registered' } })

// Activities have no single sidebar module — each `kind` is its own registration screen (see
// src/lib/data.ts's ActivityKind and Portal.tsx's modulesFor). Map to the real id so the waitlist
// notification's deep link actually resolves for the recipient.
const ACTIVITY_LINK: Record<string, string> = { club: 'ffcs', house: 'iha', exc: 'exc', event: 'events', faculty: 'freg' }

export async function listActivities(ctx: Ctx, q: z.infer<typeof activitiesQuery>) {
  const rows = await prisma.activity.findMany({ where: { schoolId: ctx.schoolId, kind: q.kind }, orderBy: { createdAt: 'desc' } })
  return Promise.all(rows.map(async a => {
    const [registered, mine] = await Promise.all([
      registeredCount(a.id),
      prisma.activityRegistration.findUnique({ where: { activityId_userId: { activityId: a.id, userId: ctx.actorId } } }),
    ])
    return { ...serializeActivity(a, registered), myStatus: mine && mine.status !== 'Cancelled' ? mine.status : undefined }
  }))
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.activity.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Activity')
  return row
}

export async function createActivitySvc(ctx: Ctx, input: z.infer<typeof createActivity>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may create an activity')
  const row = await prisma.activity.create({
    data: {
      schoolId: ctx.schoolId, kind: input.kind, title: input.title, description: input.description, capacity: input.capacity,
      opensAt: input.opensAt ? new Date(input.opensAt) : null, closesAt: input.closesAt ? new Date(input.closesAt) : null,
      forRoles: input.forRoles, createdById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'activity', row.id, undefined, { kind: row.kind, title: row.title })
  return row
}

export async function updateActivity(ctx: Ctx, id: string, input: z.infer<typeof patchActivity>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may edit an activity')
  const before = await get(ctx, id)
  const row = await prisma.activity.update({
    where: { id },
    data: {
      title: input.title, description: input.description, capacity: input.capacity,
      opensAt: input.opensAt === undefined ? undefined : input.opensAt ? new Date(input.opensAt) : null,
      closesAt: input.closesAt === undefined ? undefined : input.closesAt ? new Date(input.closesAt) : null,
      forRoles: input.forRoles,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'activity', id, serializeActivity(before), serializeActivity(row))
  return row
}

export async function deleteActivity(ctx: Ctx, id: string) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Only admin may delete an activity')
  const before = await get(ctx, id)
  await prisma.activity.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'activity', id, serializeActivity(before))
}

export async function register(ctx: Ctx, id: string) {
  const activity = await get(ctx, id)
  if (!activity.forRoles.includes(ctx.role)) throw new HttpError(403, 'This activity is not open to your role')
  if (activity.closesAt && activity.closesAt < new Date()) throw new HttpError(409, 'Registration for this activity has closed')

  const existing = await prisma.activityRegistration.findUnique({ where: { activityId_userId: { activityId: id, userId: ctx.actorId } } })
  if (existing && existing.status !== 'Cancelled') return existing

  const status = activity.capacity && (await registeredCount(id)) >= activity.capacity ? 'Waitlisted' : 'Registered'
  const row = existing
    ? await prisma.activityRegistration.update({ where: { id: existing.id }, data: { status, registeredAt: new Date() } })
    : await prisma.activityRegistration.create({ data: { activityId: id, userId: ctx.actorId, status } })
  await audit(ctx.schoolId, ctx.actorId, 'register', 'activity', id, undefined, { status })
  return row
}

export async function cancelRegistration(ctx: Ctx, id: string) {
  const activity = await get(ctx, id)
  const existing = await prisma.activityRegistration.findUnique({ where: { activityId_userId: { activityId: id, userId: ctx.actorId } } })
  if (!existing || existing.status === 'Cancelled') throw notFound('Registration')
  const wasRegistered = existing.status === 'Registered'
  const row = await prisma.activityRegistration.update({ where: { id: existing.id }, data: { status: 'Cancelled' } })
  await audit(ctx.schoolId, ctx.actorId, 'cancel', 'activity', id, { status: existing.status }, { status: 'Cancelled' })

  if (wasRegistered) {
    const next = await prisma.activityRegistration.findFirst({ where: { activityId: id, status: 'Waitlisted' }, orderBy: { registeredAt: 'asc' } })
    if (next) {
      await prisma.activityRegistration.update({ where: { id: next.id }, data: { status: 'Registered' } })
      await audit(ctx.schoolId, ctx.actorId, 'promote', 'activity', id, { userId: next.userId, status: 'Waitlisted' }, { userId: next.userId, status: 'Registered' })
      await notify(activity.schoolId, next.userId, 'activity', 'You’re off the waitlist', activity.title, ACTIVITY_LINK[activity.kind] ?? 'activities')
    }
  }
  return row
}

export async function listRegistrations(ctx: Ctx, id: string) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may view registrations')
  await get(ctx, id)
  const rows = await prisma.activityRegistration.findMany({ where: { activityId: id }, orderBy: { registeredAt: 'asc' } })
  return rows.map(serializeRegistration)
}
