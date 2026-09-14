// Mirrors server/src/modules/safety's contract: authorized pickup people + the daily pickup log with
// OTP verification (Phase 22 item 1), and the visitor front desk (Phase 22 item 2). See
// .agents/edunova/static-demo-plan.md and phase-22-campus-safety.md. Counseling records and anonymous
// reports are also mounted under /safety per the real router, but that code lives in modules/counseling.ts
// (mirrors the real backend's own modules/counseling/ split — see that file's header).

import { route, requireAuth, status, type Actor, type ReqCtx } from '../router'
import { MockHttpError, badRequest, conflict, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']
const isStaff = (actor: Actor) => STAFF_ROLES.includes(actor.role)

const OTP_TTL_MS = 10 * 60 * 1000
const MAX_OTP_ATTEMPTS = 5

function isGuardianOf(actor: Actor, studentId: string): boolean {
  return table('Guardian').some(g => g.schoolId === actor.schoolId && g.parentId === actor.userId && g.studentId === studentId)
}

function assertStudent(actor: Actor, studentId: string): Row {
  const row = table('User').find(u => u.id === studentId && u.schoolId === actor.schoolId && u.role === 'student')
  if (!row) throw notFound('Student')
  return row
}

/* ═══════════════════════════ AuthorizedPickupPerson ═══════════════════════════ */

function serializePickupPerson(p: Row) {
  return {
    id: p.id, studentId: p.studentId, name: p.name, relation: p.relation, phone: p.phone,
    photoFileId: p.photoFileId ?? undefined, addedById: p.addedById, active: p.active !== false, createdAt: p.createdAt,
  }
}

function assertManagePickupPeople(actor: Actor, studentId: string) {
  if (isStaff(actor)) return
  if (actor.role === 'parent' && isGuardianOf(actor, studentId)) return
  throw forbidden('You may only manage authorized pickup people for your own ward')
}

route('GET', '/safety/authorized-pickups', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const { studentId } = ctx.query
  if (studentId) {
    assertManagePickupPeople(actor, studentId)
    return { items: table('AuthorizedPickupPerson').filter(p => p.schoolId === actor.schoolId && p.studentId === studentId).map(serializePickupPerson) }
  }
  if (isStaff(actor)) return { items: table('AuthorizedPickupPerson').filter(p => p.schoolId === actor.schoolId).map(serializePickupPerson) }
  if (actor.role === 'parent') {
    const wardIds = new Set(table('Guardian').filter(g => g.schoolId === actor.schoolId && g.parentId === actor.userId).map(g => g.studentId))
    return { items: table('AuthorizedPickupPerson').filter(p => p.schoolId === actor.schoolId && wardIds.has(p.studentId)).map(serializePickupPerson) }
  }
  throw badRequest('studentId is required')
})

route('POST', '/safety/authorized-pickups', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const body = ctx.body as { studentId?: string; name?: string; relation?: string; phone?: string; photoFileId?: string }
  if (!body.studentId) throw badRequest('studentId is required')
  assertStudent(actor, body.studentId)
  assertManagePickupPeople(actor, body.studentId)
  if (!body.name?.trim() || !body.relation?.trim() || !body.phone?.trim()) throw badRequest('name, relation and phone are required')
  const row: Row = {
    id: uid('authorizedpickupperson'), schoolId: actor.schoolId, studentId: body.studentId, name: body.name.trim(),
    relation: body.relation.trim(), phone: body.phone.trim(), photoFileId: body.photoFileId ?? null, addedById: actor.userId,
    active: true, createdAt: nowIso(),
  }
  const rows = table('AuthorizedPickupPerson')
  rows.push(row)
  saveTable('AuthorizedPickupPerson', rows)
  return status(201, { item: serializePickupPerson(row) })
})

function getOwnedPickupPerson(actor: Actor, id: string): Row {
  const row = table('AuthorizedPickupPerson').find(p => p.id === id && p.schoolId === actor.schoolId)
  if (!row) throw notFound('Authorized pickup person')
  assertManagePickupPeople(actor, row.studentId as string)
  return row
}

route('PATCH', '/safety/authorized-pickups/:id', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  getOwnedPickupPerson(actor, ctx.params.id)
  const body = ctx.body as { name?: string; relation?: string; phone?: string; photoFileId?: string | null; active?: boolean }
  const rows = table('AuthorizedPickupPerson')
  const idx = rows.findIndex(p => p.id === ctx.params.id)
  rows[idx] = {
    ...rows[idx],
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.relation !== undefined ? { relation: body.relation } : {}),
    ...(body.phone !== undefined ? { phone: body.phone } : {}),
    ...(body.photoFileId !== undefined ? { photoFileId: body.photoFileId } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
  }
  saveTable('AuthorizedPickupPerson', rows)
  return { item: serializePickupPerson(rows[idx]) }
})

route('DELETE', '/safety/authorized-pickups/:id', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  getOwnedPickupPerson(actor, ctx.params.id)
  const rows = table('AuthorizedPickupPerson')
  const idx = rows.findIndex(p => p.id === ctx.params.id)
  rows.splice(idx, 1)
  saveTable('AuthorizedPickupPerson', rows)
  return { ok: true }
})

/* ═══════════════════════════ PickupEvent + OTP ═══════════════════════════ */

function serializePickupEvent(e: Row) {
  return {
    id: e.id, studentId: e.studentId, pickedUpByName: e.pickedUpByName, pickedUpByRelation: e.pickedUpByRelation,
    pickupType: e.pickupType, otpRequired: !!e.otpRequired, approvedByOtp: !!e.approvedByOtp,
    otpExpiresAt: e.otpExpiresAt ?? undefined, otpVerifiedAt: e.otpVerifiedAt ?? undefined,
    status: e.status, recordedById: e.recordedById, recordedAt: e.recordedAt,
  }
}

route('GET', '/safety/pickup-events', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor)) throw forbidden('Only staff/admin may view the pickup log')
  const { studentId, status: st, date } = ctx.query
  let rows = table('PickupEvent').filter(e => e.schoolId === actor.schoolId)
  if (studentId) rows = rows.filter(e => e.studentId === studentId)
  if (st) rows = rows.filter(e => e.status === st)
  if (date) rows = rows.filter(e => String(e.recordedAt).slice(0, 10) === date)
  rows = [...rows].sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))
  return { items: rows.map(serializePickupEvent) }
})

route('POST', '/safety/pickup-events', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor)) throw forbidden('Only staff/admin may log a pickup')
  const body = ctx.body as { studentId?: string; pickedUpByName?: string; pickedUpByRelation?: string; pickupType?: 'Regular' | 'EarlyOrUnlisted' }
  if (!body.studentId) throw badRequest('studentId is required')
  assertStudent(actor, body.studentId)
  if (!body.pickedUpByName?.trim() || !body.pickedUpByRelation?.trim()) throw badRequest('pickedUpByName and pickedUpByRelation are required')
  const pickupType = body.pickupType ?? 'Regular'
  let otpRequired = pickupType === 'EarlyOrUnlisted'
  if (!otpRequired) {
    const listed = table('AuthorizedPickupPerson').some(p =>
      p.schoolId === actor.schoolId && p.studentId === body.studentId && p.active !== false
      && String(p.name).toLowerCase() === body.pickedUpByName!.trim().toLowerCase())
    if (!listed) otpRequired = true
  }
  const row: Row = {
    id: uid('pickupevent'), schoolId: actor.schoolId, studentId: body.studentId, pickedUpByName: body.pickedUpByName.trim(),
    pickedUpByRelation: body.pickedUpByRelation.trim(), pickupType, otpRequired, approvedByOtp: false,
    otpExpiresAt: null, otpVerifiedAt: null, otpCode: null, otpAttempts: 0,
    status: otpRequired ? 'PendingOtp' : 'Completed', recordedById: actor.userId, recordedAt: nowIso(),
  }
  const rows = table('PickupEvent')
  rows.push(row)
  saveTable('PickupEvent', rows)
  return status(201, { item: serializePickupEvent(row) })
})

function getPickupEvent(actor: Actor, id: string): Row {
  const row = table('PickupEvent').find(e => e.id === id && e.schoolId === actor.schoolId)
  if (!row) throw notFound('Pickup event')
  return row
}

// Demo note: the real backend hashes the OTP and sends it by email/SMS/WhatsApp (best-effort delivery,
// never blocking). There's no delivery channel in a static demo, so the code is always handed back
// directly in the response (`devCode`) — same convention the real server uses outside production.
route('POST', '/safety/pickup-events/:id/request-otp', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor)) throw forbidden('Only staff/admin may request a pickup OTP')
  const row = getPickupEvent(actor, ctx.params.id)
  if (!row.otpRequired) throw badRequest('This pickup does not require OTP approval')
  if (row.approvedByOtp) throw conflict('This pickup has already been OTP-verified')
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const rows = table('PickupEvent')
  const idx = rows.findIndex(e => e.id === row.id)
  rows[idx] = { ...rows[idx], otpCode: code, otpExpiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(), otpAttempts: 0, status: 'PendingOtp' }
  saveTable('PickupEvent', rows)
  return { item: { ...serializePickupEvent(rows[idx]), devCode: code } }
})

route('POST', '/safety/pickup-events/:id/verify-otp', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor)) throw forbidden('Only staff/admin may verify a pickup OTP')
  const row = getPickupEvent(actor, ctx.params.id)
  const { code } = ctx.body as { code?: string }
  if (!row.otpRequired) throw badRequest('This pickup does not require OTP approval')
  if (row.approvedByOtp) throw conflict('This pickup has already been OTP-verified')
  if (!row.otpCode || !row.otpExpiresAt) throw badRequest('No OTP has been requested for this pickup yet')
  const rows = table('PickupEvent')
  const idx = rows.findIndex(e => e.id === row.id)
  if (new Date(String(row.otpExpiresAt)).getTime() < Date.now()) {
    rows[idx] = { ...rows[idx], status: 'Flagged' }
    saveTable('PickupEvent', rows)
    throw new MockHttpError(410, 'OTP has expired; this pickup is now flagged for review', undefined, { item: serializePickupEvent(rows[idx]) })
  }
  if (Number(row.otpAttempts ?? 0) >= MAX_OTP_ATTEMPTS) {
    rows[idx] = { ...rows[idx], status: 'Flagged' }
    saveTable('PickupEvent', rows)
    throw new MockHttpError(429, 'Too many incorrect attempts; this pickup is now flagged for review', undefined, { item: serializePickupEvent(rows[idx]) })
  }
  if (!code || String(row.otpCode) !== code.trim()) {
    rows[idx] = { ...rows[idx], otpAttempts: Number(rows[idx].otpAttempts ?? 0) + 1 }
    saveTable('PickupEvent', rows)
    throw badRequest('Incorrect code')
  }
  rows[idx] = { ...rows[idx], approvedByOtp: true, otpVerifiedAt: nowIso(), status: 'Completed', otpCode: null }
  saveTable('PickupEvent', rows)
  return { item: serializePickupEvent(rows[idx]) }
})

/* ═══════════════════════════ Visitor ═══════════════════════════ */

function serializeVisitor(v: Row) {
  return {
    id: v.id, name: v.name, phone: v.phone, purpose: v.purpose, hostUserId: v.hostUserId ?? undefined,
    checkInAt: v.checkInAt, checkOutAt: v.checkOutAt ?? undefined, badgeNo: v.badgeNo ?? undefined, recordedById: v.recordedById,
  }
}

route('GET', '/safety/visitors', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor)) throw forbidden('Only staff/admin may view visitors')
  const { date, onCampus } = ctx.query
  let rows = table('Visitor').filter(v => v.schoolId === actor.schoolId)
  if (onCampus === 'true') rows = rows.filter(v => v.checkOutAt == null)
  else if (onCampus === 'false') rows = rows.filter(v => v.checkOutAt != null)
  if (date) rows = rows.filter(v => String(v.checkInAt).slice(0, 10) === date)
  rows = [...rows].sort((a, b) => String(b.checkInAt).localeCompare(String(a.checkInAt)))
  return { items: rows.map(serializeVisitor) }
})

route('POST', '/safety/visitors', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor)) throw forbidden('Only staff/admin may check in a visitor')
  const body = ctx.body as { name?: string; phone?: string; purpose?: string; hostUserId?: string; badgeNo?: string }
  if (!body.name?.trim() || !body.phone?.trim() || !body.purpose?.trim()) throw badRequest('name, phone and purpose are required')
  if (body.hostUserId && !table('User').some(u => u.id === body.hostUserId && u.schoolId === actor.schoolId)) throw notFound('Host user')
  const row: Row = {
    id: uid('visitor'), schoolId: actor.schoolId, name: body.name.trim(), phone: body.phone.trim(), purpose: body.purpose.trim(),
    hostUserId: body.hostUserId ?? null, badgeNo: body.badgeNo?.trim() ?? null, checkInAt: nowIso(), checkOutAt: null, recordedById: actor.userId,
  }
  const rows = table('Visitor')
  rows.push(row)
  saveTable('Visitor', rows)
  return status(201, { item: serializeVisitor(row) })
})

route('POST', '/safety/visitors/:id/checkout', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor)) throw forbidden('Only staff/admin may check out a visitor')
  const rows = table('Visitor')
  const idx = rows.findIndex(v => v.id === ctx.params.id && v.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Visitor')
  if (rows[idx].checkOutAt) throw conflict('This visitor has already checked out')
  rows[idx] = { ...rows[idx], checkOutAt: nowIso() }
  saveTable('Visitor', rows)
  return { item: serializeVisitor(rows[idx]) }
})
