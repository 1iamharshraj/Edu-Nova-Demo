// Mirrors server/src/modules/activities's contract (router.ts/service.ts, read in full via
// `git show feature/backend-api:server/src/modules/activities/...` — this directory doesn't exist in the
// working tree). Create/edit: staff/admin. Delete: admin only. Register: students/teachers/etc per
// `forRoles`; full capacity → Waitlisted. Cancelling a Registered slot promotes the earliest Waitlisted
// registration to Registered (the real service does this inside a Serializable transaction to survive a
// concurrent-request race; this mock is single-threaded JS, so a plain synchronous count-then-write is
// already race-free). See .agents/edunova/static-demo-plan.md and phase-8-welfare.md.

import { route, requireAuth, requireRole, status, type Actor, type ReqCtx } from '../router'
import { badRequest, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']
const isStaff = (actor: Actor) => STAFF_ROLES.includes(actor.role)
const isAdmin = (actor: Actor) => actor.role === 'admin' || actor.role === 'superadmin'

const ACTIVITY_KINDS = ['club', 'house', 'exc', 'event', 'faculty', 'track']
const ACTIVITY_ROLES = ['student', 'parent', 'teacher', 'staff', 'admin']

function registeredCount(activityId: string): number {
  return table('ActivityRegistration').filter(r => r.activityId === activityId && r.status === 'Registered').length
}

function serializeActivity(a: Row, actor: Actor | null) {
  const registered = registeredCount(a.id)
  const mine = actor ? table('ActivityRegistration').find(r => r.activityId === a.id && r.userId === actor.userId) : undefined
  return {
    id: a.id, kind: a.kind, title: a.title, description: a.description, capacity: a.capacity ?? undefined,
    opensAt: a.opensAt ?? undefined, closesAt: a.closesAt ?? undefined, forRoles: a.forRoles,
    createdById: a.createdById, createdAt: a.createdAt, trackCohortId: a.trackCohortId ?? undefined,
    registered, myStatus: mine && mine.status !== 'Cancelled' ? mine.status : undefined,
  }
}

function serializeRegistration(r: Row) {
  const user = table('User').find(u => u.id === r.userId)
  return {
    id: r.id, activityId: r.activityId, userId: r.userId, registeredAt: r.registeredAt, status: r.status,
    userName: user?.name as string | undefined, userRole: user?.role as string | undefined,
  }
}

route('GET', '/activities', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const { kind } = ctx.query
  let rows = table('Activity').filter(a => a.schoolId === actor.schoolId)
  if (kind) rows = rows.filter(a => a.kind === kind)
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(a => serializeActivity(a, actor)) }
})

function getActivity(actor: Actor, id: string): Row {
  const row = table('Activity').find(a => a.id === id && a.schoolId === actor.schoolId)
  if (!row) throw notFound('Activity')
  return row
}

route('POST', '/activities', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const body = ctx.body as {
    kind?: string; title?: string; description?: string; capacity?: number; opensAt?: string; closesAt?: string
    forRoles?: string[]; trackCohortId?: string
  }
  if (!body.kind || !ACTIVITY_KINDS.includes(body.kind)) throw badRequest('A valid kind is required')
  if (!body.title?.trim()) throw badRequest('title is required')
  if (!body.description?.trim()) throw badRequest('description is required')
  const forRoles = (body.forRoles ?? []).filter(r => ACTIVITY_ROLES.includes(r))
  if (forRoles.length === 0) throw badRequest('forRoles must include at least one valid role')
  const row: Row = {
    id: uid('activity'), schoolId: actor.schoolId, kind: body.kind, title: body.title.trim(), description: body.description.trim(),
    capacity: body.capacity ?? undefined, opensAt: body.opensAt ?? undefined, closesAt: body.closesAt ?? undefined,
    forRoles, createdById: actor.userId, trackCohortId: body.trackCohortId ?? null, createdAt: nowIso(),
  }
  const rows = table('Activity')
  rows.push(row)
  saveTable('Activity', rows)
  return status(201, { item: serializeActivity(row, actor) })
})

route('PATCH', '/activities/:id', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const before = getActivity(actor, ctx.params.id)
  const body = ctx.body as Partial<{
    title: string; description: string; capacity: number | null; opensAt: string | null; closesAt: string | null
    forRoles: string[]; trackCohortId: string | null
  }>
  const rows = table('Activity')
  const idx = rows.findIndex(a => a.id === before.id)
  rows[idx] = {
    ...rows[idx],
    title: body.title?.trim() ?? rows[idx].title,
    description: body.description?.trim() ?? rows[idx].description,
    capacity: body.capacity === undefined ? rows[idx].capacity : (body.capacity ?? undefined),
    opensAt: body.opensAt === undefined ? rows[idx].opensAt : (body.opensAt ?? undefined),
    closesAt: body.closesAt === undefined ? rows[idx].closesAt : (body.closesAt ?? undefined),
    forRoles: body.forRoles ?? rows[idx].forRoles,
    trackCohortId: body.trackCohortId === undefined ? rows[idx].trackCohortId : body.trackCohortId,
    updatedAt: nowIso(),
  }
  saveTable('Activity', rows)
  return { item: serializeActivity(rows[idx], actor) }
})

route('DELETE', '/activities/:id', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!isAdmin(actor)) throw forbidden('Only admin may delete an activity')
  const before = getActivity(actor, ctx.params.id)
  const rows = table('Activity')
  const idx = rows.findIndex(a => a.id === before.id)
  rows.splice(idx, 1)
  saveTable('Activity', rows)
  // Registrations for a deleted activity have no home left in the UI — drop them along with it.
  saveTable('ActivityRegistration', table('ActivityRegistration').filter(r => r.activityId !== before.id))
  return { ok: true }
})

route('POST', '/activities/:id/register', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const activity = getActivity(actor, ctx.params.id)
  const forRoles = (activity.forRoles as string[] | undefined) ?? []
  if (!forRoles.includes(actor.role)) throw forbidden('This activity is not open to your role')
  if (activity.closesAt && new Date(String(activity.closesAt)) < new Date()) throw badRequest('Registration for this activity has closed')

  const regs = table('ActivityRegistration')
  const existing = regs.find(r => r.activityId === activity.id && r.userId === actor.userId)
  if (existing && existing.status !== 'Cancelled') return status(201, { item: serializeRegistration(existing) })

  const count = registeredCount(activity.id)
  const capacity = activity.capacity as number | undefined
  const newStatus = capacity && count >= capacity ? 'Waitlisted' : 'Registered'
  let row: Row
  if (existing) {
    existing.status = newStatus
    existing.registeredAt = nowIso()
    row = existing
  } else {
    row = { id: uid('activityreg'), schoolId: actor.schoolId, activityId: activity.id, userId: actor.userId, registeredAt: nowIso(), status: newStatus }
    regs.push(row)
  }
  saveTable('ActivityRegistration', regs)
  return status(201, { item: serializeRegistration(row) })
})

route('POST', '/activities/:id/cancel', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const activity = getActivity(actor, ctx.params.id)
  const regs = table('ActivityRegistration')
  const existing = regs.find(r => r.activityId === activity.id && r.userId === actor.userId)
  if (!existing || existing.status === 'Cancelled') throw notFound('Registration')
  const wasRegistered = existing.status === 'Registered'
  existing.status = 'Cancelled'

  if (wasRegistered) {
    // Promote the earliest Waitlisted registration to Registered — a seat just opened up.
    const waitlisted = regs
      .filter(r => r.activityId === activity.id && r.status === 'Waitlisted')
      .sort((a, b) => String(a.registeredAt).localeCompare(String(b.registeredAt)))[0]
    if (waitlisted) waitlisted.status = 'Registered'
  }
  saveTable('ActivityRegistration', regs)
  return { item: serializeRegistration(existing) }
})

route('GET', '/activities/:id/registrations', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor)) throw forbidden('Only staff/admin may view registrations')
  const activity = getActivity(actor, ctx.params.id)
  const rows = table('ActivityRegistration')
    .filter(r => r.activityId === activity.id)
    .sort((a, b) => String(a.registeredAt).localeCompare(String(b.registeredAt)))
  return { items: rows.map(serializeRegistration) }
})
