import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { z } from 'zod'
import type { AuthorizedPickupPerson, PickupEvent, Visitor } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isStaff, isGuardianOf } from '../../lib/scope'
import { assertFileIds } from '../files/service'
import { sendEmail, sendSms, sendWhatsApp, notify } from '../../lib/notify'
import type {
  createPickupPerson, patchPickupPerson, pickupPersonQuery,
  createPickupEvent, pickupEventQuery,
} from './schema'
import type { createVisitor, visitorQuery } from './schema'

// See phase-22-campus-safety.md → items 1-2.

// ── Item 1a: AuthorizedPickupPerson ───────────────────────────────────────────────────────────────────

export const serializePickupPerson = (p: AuthorizedPickupPerson) => ({
  id: p.id, studentId: p.studentId, name: p.name, relation: p.relation, phone: p.phone,
  photoFileId: p.photoFileId ?? undefined, active: p.active, addedById: p.addedById, createdAt: p.createdAt.toISOString(),
})

async function assertStudent(ctx: Ctx, studentId: string) {
  const row = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!row) throw notFound('Student')
  return row
}

// Parent for their own ward, staff/admin for any student.
async function assertManagePickupPeople(ctx: Ctx, studentId: string) {
  if (isStaff(ctx)) return
  if (ctx.role === 'parent' && (await isGuardianOf(ctx, studentId))) return
  throw new HttpError(403, 'You may only manage authorized pickup people for your own ward')
}

export async function listPickupPeople(ctx: Ctx, q: z.infer<typeof pickupPersonQuery>) {
  if (q.studentId) {
    await assertManagePickupPeople(ctx, q.studentId)
    return (await prisma.authorizedPickupPerson.findMany({ where: { schoolId: ctx.schoolId, studentId: q.studentId }, orderBy: { createdAt: 'desc' } })).map(serializePickupPerson)
  }
  if (isStaff(ctx)) return (await prisma.authorizedPickupPerson.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { createdAt: 'desc' } })).map(serializePickupPerson)
  if (ctx.role === 'parent') {
    const wards = await prisma.guardian.findMany({ where: { parentId: ctx.actorId }, select: { studentId: true } })
    return (await prisma.authorizedPickupPerson.findMany({ where: { schoolId: ctx.schoolId, studentId: { in: wards.map(w => w.studentId) } }, orderBy: { createdAt: 'desc' } })).map(serializePickupPerson)
  }
  throw new HttpError(400, 'studentId is required')
}

export async function createPickupPersonSvc(ctx: Ctx, input: z.infer<typeof createPickupPerson>) {
  await assertStudent(ctx, input.studentId)
  await assertManagePickupPeople(ctx, input.studentId)
  if (input.photoFileId) await assertFileIds(ctx, [input.photoFileId])
  const row = await prisma.authorizedPickupPerson.create({
    data: {
      schoolId: ctx.schoolId, studentId: input.studentId, name: input.name, relation: input.relation,
      phone: input.phone, photoFileId: input.photoFileId ?? null, addedById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'authorizedPickupPerson', row.id, undefined, serializePickupPerson(row))
  return row
}

async function getOwnedPickupPerson(ctx: Ctx, id: string) {
  const row = await prisma.authorizedPickupPerson.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Authorized pickup person')
  await assertManagePickupPeople(ctx, row.studentId)
  return row
}

export async function updatePickupPerson(ctx: Ctx, id: string, input: z.infer<typeof patchPickupPerson>) {
  const before = await getOwnedPickupPerson(ctx, id)
  if (input.photoFileId) await assertFileIds(ctx, [input.photoFileId])
  const row = await prisma.authorizedPickupPerson.update({
    where: { id },
    data: { name: input.name, relation: input.relation, phone: input.phone, photoFileId: input.photoFileId, active: input.active },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'authorizedPickupPerson', id, serializePickupPerson(before), serializePickupPerson(row))
  return row
}

export async function deletePickupPerson(ctx: Ctx, id: string) {
  const before = await getOwnedPickupPerson(ctx, id)
  await prisma.authorizedPickupPerson.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'authorizedPickupPerson', id, serializePickupPerson(before))
}

// ── Item 1b: PickupEvent + OTP ────────────────────────────────────────────────────────────────────────

export const serializePickupEvent = (e: PickupEvent) => ({
  id: e.id, studentId: e.studentId, pickedUpByName: e.pickedUpByName, pickedUpByRelation: e.pickedUpByRelation,
  pickupType: e.pickupType, otpRequired: e.otpRequired, approvedByOtp: e.approvedByOtp,
  otpExpiresAt: e.otpExpiresAt?.toISOString(), otpVerifiedAt: e.otpVerifiedAt?.toISOString(),
  status: e.status, recordedById: e.recordedById, recordedAt: e.recordedAt.toISOString(),
})

const OTP_TTL_MS = 10 * 60 * 1000
const MAX_OTP_ATTEMPTS = 5

// Staff/admin/gate-role — there is no dedicated "security/gate" role in this codebase yet (see
// phase-22-campus-safety.md §1: "check if a dedicated security/gate role exists; if not, use staff and
// note this as a role-granularity limitation worth a future dedicated role"). Using plain `staff` means
// EVERY staff account can log pickups school-wide, not just gate/reception staff — a coarser grant than
// ideal; a follow-up phase should add a dedicated role or a per-user "gate duty" flag (mirroring
// User.isCounselor) if that turns out to matter in practice.
export async function listPickupEvents(ctx: Ctx, q: z.infer<typeof pickupEventQuery>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may view the pickup log')
  const where: Record<string, unknown> = { schoolId: ctx.schoolId }
  if (q.studentId) where.studentId = q.studentId
  if (q.status) where.status = q.status
  if (q.date) {
    const start = new Date(`${q.date}T00:00:00.000Z`)
    const end = new Date(`${q.date}T23:59:59.999Z`)
    where.recordedAt = { gte: start, lte: end }
  }
  const rows = await prisma.pickupEvent.findMany({ where, orderBy: { recordedAt: 'desc' } })
  return rows.map(serializePickupEvent)
}

export async function createPickupEventSvc(ctx: Ctx, input: z.infer<typeof createPickupEvent>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may log a pickup')
  await assertStudent(ctx, input.studentId)
  const pickupType = input.pickupType ?? 'Regular'
  let otpRequired = pickupType === 'EarlyOrUnlisted'
  if (!otpRequired) {
    const listed = await prisma.authorizedPickupPerson.findFirst({
      where: { schoolId: ctx.schoolId, studentId: input.studentId, active: true, name: { equals: input.pickedUpByName, mode: 'insensitive' } },
    })
    if (!listed) otpRequired = true
  }
  const row = await prisma.pickupEvent.create({
    data: {
      schoolId: ctx.schoolId, studentId: input.studentId, pickedUpByName: input.pickedUpByName, pickedUpByRelation: input.pickedUpByRelation,
      pickupType, otpRequired, status: otpRequired ? 'PendingOtp' : 'Completed', recordedById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'pickupEvent', row.id, undefined, serializePickupEvent(row))
  return row
}

async function getPickupEvent(ctx: Ctx, id: string) {
  const row = await prisma.pickupEvent.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Pickup event')
  return row
}

// Sends a short-lived OTP to every guardian of the student — reuses modules/lib/notify.ts's existing
// email/SMS provider abstraction; no new delivery infrastructure. Best-effort: notify()/sendEmail/sendSms
// never throw, so a delivery hiccup doesn't block the gate-staff flow (the OTP is still recorded and
// verifiable — staff can read it back via other means, e.g. calling the parent, in a real deployment).
export async function requestPickupOtp(ctx: Ctx, id: string) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may request a pickup OTP')
  const row = await getPickupEvent(ctx, id)
  if (!row.otpRequired) throw new HttpError(400, 'This pickup does not require OTP approval')
  if (row.approvedByOtp) throw new HttpError(409, 'This pickup has already been OTP-verified')
  const code = String(crypto.randomInt(100000, 999999))
  const otpCodeHash = await bcrypt.hash(code, 10)
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS)
  const updated = await prisma.pickupEvent.update({
    where: { id }, data: { otpCodeHash, otpExpiresAt, otpAttempts: 0, status: 'PendingOtp' },
  })
  const guardians = await prisma.guardian.findMany({ where: { studentId: row.studentId }, include: { parent: true } })
  const student = await prisma.user.findUnique({ where: { id: row.studentId }, select: { name: true } })
  const body = `Edkonic: OTP ${code} to approve pickup of ${student?.name ?? 'your child'} by ${row.pickedUpByName} (${row.pickedUpByRelation}). Valid ${OTP_TTL_MS / 60000} min.`
  await Promise.all(guardians.flatMap(g => [
    sendEmail({ to: g.parent.email, subject: 'Pickup approval code', body }),
    g.parent.phone ? sendSms({ to: g.parent.phone, body }) : Promise.resolve(),
    // Phase 23 item 3: WhatsApp alongside email/SMS, same best-effort pattern.
    g.parent.phone ? sendWhatsApp({ to: g.parent.phone, body }) : Promise.resolve(),
    notify(ctx.schoolId, g.parentId, 'pickup-otp', 'Pickup approval needed', body),
  ]))
  await audit(ctx.schoolId, ctx.actorId, 'request-otp', 'pickupEvent', id)
  // Same convention as /api/auth/forgot's devResetUrl: outside production, the code is also handed back
  // directly (never in production — production relies solely on the email/SMS delivery above).
  return { ...serializePickupEvent(updated), ...(process.env.NODE_ENV !== 'production' ? { devCode: code } : {}) }
}

export async function verifyPickupOtp(ctx: Ctx, id: string, code: string) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may verify a pickup OTP')
  const row = await getPickupEvent(ctx, id)
  if (!row.otpRequired) throw new HttpError(400, 'This pickup does not require OTP approval')
  if (row.approvedByOtp) throw new HttpError(409, 'This pickup has already been OTP-verified')
  if (!row.otpCodeHash || !row.otpExpiresAt) throw new HttpError(400, 'No OTP has been requested for this pickup yet')
  if (row.otpExpiresAt.getTime() < Date.now()) {
    // Expired without verification — flag it explicitly rather than leaving it silently pending forever
    // (spec: "clearly flagged, not silently allowed through").
    const flagged = await prisma.pickupEvent.update({ where: { id }, data: { status: 'Flagged' } })
    await audit(ctx.schoolId, ctx.actorId, 'otp-expired', 'pickupEvent', id)
    throw new HttpError(410, 'OTP has expired; this pickup is now flagged for review', undefined, { item: serializePickupEvent(flagged) })
  }
  if (row.otpAttempts >= MAX_OTP_ATTEMPTS) {
    const flagged = await prisma.pickupEvent.update({ where: { id }, data: { status: 'Flagged' } })
    await audit(ctx.schoolId, ctx.actorId, 'otp-locked', 'pickupEvent', id)
    throw new HttpError(429, 'Too many incorrect attempts; this pickup is now flagged for review', undefined, { item: serializePickupEvent(flagged) })
  }
  const ok = await bcrypt.compare(code, row.otpCodeHash)
  if (!ok) {
    await prisma.pickupEvent.update({ where: { id }, data: { otpAttempts: { increment: 1 } } })
    throw new HttpError(400, 'Incorrect code')
  }
  const row2 = await prisma.pickupEvent.update({
    where: { id }, data: { approvedByOtp: true, otpVerifiedAt: new Date(), status: 'Completed', otpCodeHash: null },
  })
  await audit(ctx.schoolId, ctx.actorId, 'verify-otp', 'pickupEvent', id, undefined, { status: row2.status })
  return serializePickupEvent(row2)
}

// ── Item 2: Visitor ────────────────────────────────────────────────────────────────────────────────────

export const serializeVisitor = (v: Visitor) => ({
  id: v.id, name: v.name, phone: v.phone, purpose: v.purpose, hostUserId: v.hostUserId ?? undefined,
  checkInAt: v.checkInAt.toISOString(), checkOutAt: v.checkOutAt?.toISOString(), badgeNo: v.badgeNo ?? undefined,
  recordedById: v.recordedById,
})

export async function listVisitors(ctx: Ctx, q: z.infer<typeof visitorQuery>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may view visitors')
  const where: Record<string, unknown> = { schoolId: ctx.schoolId }
  if (q.onCampus === 'true') where.checkOutAt = null
  else if (q.onCampus === 'false') where.checkOutAt = { not: null }
  if (q.date) {
    const start = new Date(`${q.date}T00:00:00.000Z`)
    const end = new Date(`${q.date}T23:59:59.999Z`)
    where.checkInAt = { gte: start, lte: end }
  }
  const rows = await prisma.visitor.findMany({ where, orderBy: { checkInAt: 'desc' } })
  return rows.map(serializeVisitor)
}

export async function checkInVisitor(ctx: Ctx, input: z.infer<typeof createVisitor>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may check in a visitor')
  if (input.hostUserId) {
    const host = await prisma.user.findFirst({ where: { id: input.hostUserId, schoolId: ctx.schoolId } })
    if (!host) throw notFound('Host user')
  }
  const row = await prisma.visitor.create({
    data: {
      schoolId: ctx.schoolId, name: input.name, phone: input.phone, purpose: input.purpose,
      hostUserId: input.hostUserId ?? null, badgeNo: input.badgeNo ?? null, recordedById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'check-in', 'visitor', row.id, undefined, serializeVisitor(row))
  return row
}

export async function checkOutVisitor(ctx: Ctx, id: string) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may check out a visitor')
  const before = await prisma.visitor.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Visitor')
  if (before.checkOutAt) throw new HttpError(409, 'This visitor has already checked out')
  const row = await prisma.visitor.update({ where: { id }, data: { checkOutAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'check-out', 'visitor', id, serializeVisitor(before), serializeVisitor(row))
  return row
}
