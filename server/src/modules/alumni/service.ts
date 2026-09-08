import type { z } from 'zod'
import type { AlumniProfile, AlumniEvent, AlumniEventRsvp, AlumniDonation } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { syncUserTitle } from '../../lib/titleSync'
import type {
  createProfile, patchProfile, profileQuery, convertStudentBody,
  createEvent, patchEvent, rsvpBody, createDonation, patchDonation, donationQuery,
} from './schema'

// See phase-13-alumni.md. Every write here is gated `requireRole('staff', 'admin', 'superadmin')` at the
// router (donations are staff/admin/superadmin for reads too, since they're financial data) — this
// service assumes that has already run.

// ───────────────────────── serialization ─────────────────────────

export const serializeProfile = (p: AlumniProfile) => ({
  id: p.id,
  studentUserId: p.studentUserId ?? undefined,
  name: p.name,
  email: p.email ?? undefined,
  phone: p.phone ?? undefined,
  graduationYear: p.graduationYear,
  lastClassLabel: p.lastClassLabel ?? undefined,
  currentOccupation: p.currentOccupation ?? undefined,
  currentOrganization: p.currentOrganization ?? undefined,
  currentCity: p.currentCity ?? undefined,
  linkedInUrl: p.linkedInUrl ?? undefined,
  notes: p.notes ?? undefined,
  convertedAt: p.convertedAt.toISOString(),
  convertedById: p.convertedById ?? undefined,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
})

export const serializeEvent = (e: AlumniEvent) => ({
  id: e.id,
  title: e.title,
  description: e.description ?? undefined,
  date: fmtDate(e.date),
  location: e.location ?? undefined,
  createdById: e.createdById ?? undefined,
  createdAt: e.createdAt.toISOString(),
})

export const serializeRsvp = (r: AlumniEventRsvp) => ({
  id: r.id,
  eventId: r.eventId,
  alumniId: r.alumniId,
  status: r.status,
  respondedAt: r.respondedAt.toISOString(),
})

export const serializeDonation = (d: AlumniDonation) => ({
  id: d.id,
  alumniId: d.alumniId,
  amount: d.amount,
  purpose: d.purpose ?? undefined,
  donatedAt: d.donatedAt.toISOString(),
  recordedById: d.recordedById ?? undefined,
  note: d.note ?? undefined,
  createdAt: d.createdAt.toISOString(),
})

// ───────────────────────── profiles ─────────────────────────

export async function listProfiles(ctx: Ctx, q: z.infer<typeof profileQuery>) {
  return prisma.alumniProfile.findMany({
    where: {
      schoolId: ctx.schoolId,
      graduationYear: q.graduationYear,
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: [{ graduationYear: 'desc' }, { name: 'asc' }],
  })
}

export async function getProfile(ctx: Ctx, id: string) {
  const row = await prisma.alumniProfile.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Alumni profile')
  return row
}

export async function donationsTotalFor(ctx: Ctx, alumniId: string) {
  const agg = await prisma.alumniDonation.aggregate({ where: { alumniId, schoolId: ctx.schoolId }, _sum: { amount: true } })
  return agg._sum.amount ?? 0
}

export async function createProfileRow(ctx: Ctx, input: z.infer<typeof createProfile>) {
  if (input.studentUserId) {
    const student = await prisma.user.findFirst({ where: { id: input.studentUserId, schoolId: ctx.schoolId } })
    if (!student) throw notFound('Student')
    const dup = await prisma.alumniProfile.findFirst({ where: { studentUserId: input.studentUserId, schoolId: ctx.schoolId } })
    if (dup) throw new HttpError(409, 'This student already has an alumni profile')
  }
  const row = await prisma.alumniProfile.create({
    data: {
      schoolId: ctx.schoolId, studentUserId: input.studentUserId ?? null, name: input.name, email: input.email ?? null, phone: input.phone ?? null,
      graduationYear: input.graduationYear, lastClassLabel: input.lastClassLabel ?? null, currentOccupation: input.currentOccupation ?? null,
      currentOrganization: input.currentOrganization ?? null, currentCity: input.currentCity ?? null, linkedInUrl: input.linkedInUrl ?? null,
      notes: input.notes ?? null, convertedById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'alumniProfile', row.id, undefined, serializeProfile(row))
  return row
}

export async function updateProfile(ctx: Ctx, id: string, input: z.infer<typeof patchProfile>) {
  const before = await getProfile(ctx, id)
  const row = await prisma.alumniProfile.update({
    where: { id },
    data: {
      name: input.name, email: input.email, phone: input.phone, graduationYear: input.graduationYear, lastClassLabel: input.lastClassLabel,
      currentOccupation: input.currentOccupation, currentOrganization: input.currentOrganization, currentCity: input.currentCity,
      linkedInUrl: input.linkedInUrl, notes: input.notes,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'alumniProfile', id, serializeProfile(before), serializeProfile(row))
  return row
}

export async function removeProfile(ctx: Ctx, id: string) {
  const before = await getProfile(ctx, id)
  await prisma.alumniProfile.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'alumniProfile', id, serializeProfile(before))
}

// ───────────────────────── student -> alumnus conversion ─────────────────────────
//
// Design decision (see the long comment on `model AlumniProfile` in schema.prisma for the full write-up):
// the student's User account is left untouched — role stays 'student', `active` stays true — matching how
// TC issuance (applications/service.ts `approve()`) already treats the account (it ends the active
// Enrollment but never flips role/active). This function ends the active Enrollment too, but with status
// 'graduated' (not 'transferred') when it is the one doing so — distinguishing "became an alumnus
// directly" from "transferred out via a TC", which already sets 'transferred' before this runs (see the
// `endEnrollment: false` path used by the TC-approval integration hook below).
export async function convertStudent(ctx: Ctx, input: z.infer<typeof convertStudentBody>) {
  const student = await prisma.user.findFirst({ where: { id: input.studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')

  const existing = await prisma.alumniProfile.findFirst({ where: { studentUserId: student.id, schoolId: ctx.schoolId } })
  if (existing) throw new HttpError(409, 'This student has already been converted to an alumnus')

  const enrollmentInclude = { class: { include: { grade: true, board: true } }, academicYear: true } as const
  const activeEnrollment = await prisma.enrollment.findFirst({
    where: { studentId: student.id, schoolId: ctx.schoolId, status: 'active' },
    include: enrollmentInclude,
    orderBy: [{ createdAt: 'desc' }],
  })
  const refEnrollment = activeEnrollment ?? await prisma.enrollment.findFirst({
    where: { studentId: student.id, schoolId: ctx.schoolId },
    include: enrollmentInclude,
    orderBy: [{ createdAt: 'desc' }],
  })

  const lastClassLabel = refEnrollment ? `${refEnrollment.class.grade.label}-${refEnrollment.class.section} ${refEnrollment.class.board.code}` : null
  const graduationYear = input.graduationYear ?? refEnrollment?.academicYear.endDate.getFullYear() ?? new Date().getFullYear()
  const endEnrollment = input.endEnrollment !== false

  const row = await prisma.$transaction(async tx => {
    if (endEnrollment) {
      await tx.enrollment.updateMany({ where: { studentId: student.id, schoolId: ctx.schoolId, status: 'active' }, data: { status: 'graduated' } })
    }
    return tx.alumniProfile.create({
      data: {
        schoolId: ctx.schoolId, studentUserId: student.id, name: student.name, email: student.email, phone: student.phone ?? null,
        graduationYear, lastClassLabel, currentOccupation: input.currentOccupation ?? null, currentOrganization: input.currentOrganization ?? null,
        currentCity: input.currentCity ?? null, linkedInUrl: input.linkedInUrl ?? null, notes: input.notes ?? null, convertedById: ctx.actorId,
      },
    })
  })
  if (endEnrollment) await syncUserTitle([student.id])
  await audit(ctx.schoolId, ctx.actorId, 'convert', 'alumniProfile', row.id, undefined, serializeProfile(row))
  return { profile: row, enrollmentEnded: endEnrollment && !!activeEnrollment }
}

// ───────────────────────── events ─────────────────────────

export async function listEvents(ctx: Ctx) {
  return prisma.alumniEvent.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ date: 'desc' }] })
}

export async function getEvent(ctx: Ctx, id: string) {
  const row = await prisma.alumniEvent.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Alumni event')
  return row
}

export async function createEventRow(ctx: Ctx, input: z.infer<typeof createEvent>) {
  const row = await prisma.alumniEvent.create({
    data: {
      schoolId: ctx.schoolId, title: input.title, description: input.description ?? null, date: toDate(input.date),
      location: input.location ?? null, createdById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'alumniEvent', row.id, undefined, serializeEvent(row))
  return row
}

export async function updateEvent(ctx: Ctx, id: string, input: z.infer<typeof patchEvent>) {
  const before = await getEvent(ctx, id)
  const row = await prisma.alumniEvent.update({
    where: { id },
    data: {
      title: input.title, description: input.description, date: input.date ? toDate(input.date) : undefined, location: input.location,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'alumniEvent', id, serializeEvent(before), serializeEvent(row))
  return row
}

export async function removeEvent(ctx: Ctx, id: string) {
  const before = await getEvent(ctx, id)
  await prisma.alumniEvent.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'alumniEvent', id, serializeEvent(before))
}

// ───────────────────────── rsvp ─────────────────────────
// Always entered BY staff on an alumnus's behalf — alumni have no portal login in this system.

export async function listRsvps(ctx: Ctx, eventId: string) {
  await getEvent(ctx, eventId)
  return prisma.alumniEventRsvp.findMany({ where: { eventId }, orderBy: [{ respondedAt: 'desc' }] })
}

export async function setRsvp(ctx: Ctx, eventId: string, input: z.infer<typeof rsvpBody>) {
  const event = await getEvent(ctx, eventId)
  const alumni = await prisma.alumniProfile.findFirst({ where: { id: input.alumniId, schoolId: ctx.schoolId } })
  if (!alumni) throw notFound('Alumni profile')

  const before = await prisma.alumniEventRsvp.findUnique({ where: { eventId_alumniId: { eventId: event.id, alumniId: alumni.id } } })
  const row = await prisma.alumniEventRsvp.upsert({
    where: { eventId_alumniId: { eventId: event.id, alumniId: alumni.id } },
    create: { eventId: event.id, alumniId: alumni.id, status: input.status },
    update: { status: input.status, respondedAt: new Date() },
  })
  await audit(ctx.schoolId, ctx.actorId, before ? 'update' : 'create', 'alumniEventRsvp', row.id, before ? serializeRsvp(before) : undefined, serializeRsvp(row))
  return row
}

// ───────────────────────── donations ─────────────────────────
// Manual record-keeping only (see schema.ts) — not a payment gateway.

export async function listDonations(ctx: Ctx, q: z.infer<typeof donationQuery>) {
  return prisma.alumniDonation.findMany({ where: { schoolId: ctx.schoolId, alumniId: q.alumniId }, orderBy: [{ donatedAt: 'desc' }] })
}

export async function getDonation(ctx: Ctx, id: string) {
  const row = await prisma.alumniDonation.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Donation')
  return row
}

export async function createDonationRow(ctx: Ctx, input: z.infer<typeof createDonation>) {
  const alumni = await prisma.alumniProfile.findFirst({ where: { id: input.alumniId, schoolId: ctx.schoolId } })
  if (!alumni) throw notFound('Alumni profile')
  const row = await prisma.alumniDonation.create({
    data: {
      schoolId: ctx.schoolId, alumniId: alumni.id, amount: input.amount, purpose: input.purpose ?? null,
      donatedAt: input.donatedAt ? toDate(input.donatedAt) : new Date(), note: input.note ?? null, recordedById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'alumniDonation', row.id, undefined, serializeDonation(row))
  return row
}

export async function updateDonation(ctx: Ctx, id: string, input: z.infer<typeof patchDonation>) {
  const before = await getDonation(ctx, id)
  const row = await prisma.alumniDonation.update({
    where: { id },
    data: {
      amount: input.amount, purpose: input.purpose, donatedAt: input.donatedAt ? toDate(input.donatedAt) : undefined, note: input.note,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'alumniDonation', id, serializeDonation(before), serializeDonation(row))
  return row
}

export async function removeDonation(ctx: Ctx, id: string) {
  const before = await getDonation(ctx, id)
  await prisma.alumniDonation.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'alumniDonation', id, serializeDonation(before))
}
