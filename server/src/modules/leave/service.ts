import type { z } from 'zod'
import type { LeaveType, LeaveRequest } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { isAdmin, isStaff, visibleStudentIds } from '../../lib/scope'
import { notify, sendEmail, sendWhatsApp } from '../../lib/notify'
import * as subSvc from '../timetable/substitution'
import type { createLeaveType, patchLeaveType, createLeaveRequest, requestsQuery, decideBody, balanceQuery } from './schema'

// See phase-6-hr.md → /api/leave. "Student leave" = LeaveType.appliesTo "student" (or no leaveType at all when
// forUser is a student); "staff leave" = appliesTo "staff" (or no leaveType when forUser is teacher/staff/admin).

export const serializeLeaveType = (t: LeaveType) => ({
  id: t.id, name: t.name, daysPerYear: t.daysPerYear, appliesTo: t.appliesTo, createdAt: t.createdAt.toISOString(),
})

export const serializeLeaveRequest = (r: LeaveRequest) => ({
  id: r.id, requesterId: r.requesterId, forUserId: r.forUserId, leaveTypeId: r.leaveTypeId ?? undefined,
  fromDate: fmtDate(r.fromDate), toDate: fmtDate(r.toDate), days: r.days, reason: r.reason, status: r.status,
  decidedById: r.decidedById ?? undefined, decidedAt: r.decidedAt?.toISOString(), decisionNote: r.decisionNote ?? undefined,
  createdAt: r.createdAt.toISOString(),
})

// ─────────────────────────── leave types (admin) ───────────────────────────

export async function listTypes(ctx: Ctx) {
  return prisma.leaveType.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }] })
}

export async function createType(ctx: Ctx, input: z.infer<typeof createLeaveType>) {
  const row = await prisma.leaveType.create({ data: { schoolId: ctx.schoolId, name: input.name, daysPerYear: input.daysPerYear, appliesTo: input.appliesTo } })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'leaveType', row.id, undefined, serializeLeaveType(row))
  return row
}

async function getType(ctx: Ctx, id: string) {
  const row = await prisma.leaveType.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Leave type')
  return row
}

export async function updateType(ctx: Ctx, id: string, input: z.infer<typeof patchLeaveType>) {
  const before = await getType(ctx, id)
  const row = await prisma.leaveType.update({ where: { id }, data: { name: input.name, daysPerYear: input.daysPerYear, appliesTo: input.appliesTo } })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'leaveType', id, serializeLeaveType(before), serializeLeaveType(row))
  return row
}

export async function removeType(ctx: Ctx, id: string) {
  const before = await getType(ctx, id)
  await prisma.leaveType.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'leaveType', id, serializeLeaveType(before))
}

// ─────────────────────────── helpers ───────────────────────────

// Inclusive day count between fromDate/toDate, excluding Sundays.
function countDays(from: Date, to: Date): number {
  let days = 0
  const d = new Date(from)
  while (d.getTime() <= to.getTime()) {
    if (d.getUTCDay() !== 0) days++
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}

// Class ids a teacher teaches (class-teacher of, or holds a ClassSubject in).
async function teacherClassIds(ctx: Ctx): Promise<string[]> {
  const rows = await prisma.class.findMany({
    where: { schoolId: ctx.schoolId, OR: [{ classTeacherId: ctx.actorId }, { classSubjects: { some: { teacherId: ctx.actorId } } }] },
    select: { id: true },
  })
  return rows.map(c => c.id)
}

// The class-teacher of a student's currently active enrollment, or null.
async function classTeacherOfStudent(schoolId: string, studentId: string): Promise<string | null> {
  const enr = await prisma.enrollment.findFirst({
    where: { schoolId, studentId, status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: { class: { select: { classTeacherId: true } } },
  })
  return enr?.class.classTeacherId ?? null
}

// ─────────────────────────── requests ───────────────────────────

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.leaveRequest.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Leave request')
  return row
}

// student/parent: own/wards. teacher: own requests, or (scope=approvals) requests for students they teach.
// staff/admin/superadmin: all, regardless of scope.
export async function listRequests(ctx: Ctx, q: z.infer<typeof requestsQuery>) {
  const where: Record<string, unknown> = { schoolId: ctx.schoolId, status: q.status, forUserId: q.forUserId }

  if (ctx.role === 'student') {
    where.forUserId = q.forUserId ?? ctx.actorId
    if (where.forUserId !== ctx.actorId) throw new HttpError(403, 'You may only view your own leave requests')
  } else if (ctx.role === 'parent') {
    const wards = (await visibleStudentIds(ctx))!
    if (q.forUserId) {
      if (!wards.includes(q.forUserId)) throw new HttpError(403, 'That student is not your ward')
    } else {
      where.forUserId = { in: wards }
    }
  } else if (ctx.role === 'teacher') {
    if (q.scope === 'approvals') {
      const classIds = await teacherClassIds(ctx)
      const roster = classIds.length ? await prisma.enrollment.findMany({ where: { classId: { in: classIds }, status: 'active' }, select: { studentId: true } }) : []
      const studentIds = roster.map(r => r.studentId)
      where.forUserId = q.forUserId ? (studentIds.includes(q.forUserId) ? q.forUserId : '__none__') : { in: studentIds }
    } else if (q.forUserId) {
      if (q.forUserId !== ctx.actorId) throw new HttpError(403, 'You may only view your own leave requests')
      where.forUserId = ctx.actorId
    } else {
      where.OR = [{ requesterId: ctx.actorId }, { forUserId: ctx.actorId }]
    }
  } else if (!isStaff(ctx)) {
    throw new HttpError(403, 'Forbidden')
  }
  // staff/admin/superadmin: no extra restriction — see all.

  return prisma.leaveRequest.findMany({ where, orderBy: [{ createdAt: 'desc' }] })
}

export async function createRequest(ctx: Ctx, input: z.infer<typeof createLeaveRequest>) {
  const forUser = await prisma.user.findFirst({ where: { id: input.forUserId, schoolId: ctx.schoolId } })
  if (!forUser) throw notFound('User')

  // Authorisation: parent for a ward, student for self, teacher/staff/admin for self.
  if (ctx.role === 'parent') {
    const wards = (await visibleStudentIds(ctx))!
    if (!wards.includes(forUser.id)) throw new HttpError(403, 'That student is not your ward')
  } else if (forUser.id !== ctx.actorId) {
    throw new HttpError(403, 'You may only request leave for yourself')
  }

  const from = toDate(input.fromDate)
  const to = toDate(input.toDate)
  if (to.getTime() < from.getTime()) throw new HttpError(400, 'toDate must be on or after fromDate')

  let leaveType: LeaveType | null = null
  if (input.leaveTypeId) {
    leaveType = await prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, schoolId: ctx.schoolId } })
    if (!leaveType) throw notFound('Leave type')
    const expected = forUser.role === 'student' ? 'student' : 'staff'
    if (leaveType.appliesTo !== expected) throw new HttpError(400, `This leave type does not apply to a ${forUser.role === 'student' ? 'student' : 'staff member'}`)
  }

  const days = countDays(from, to)
  const row = await prisma.leaveRequest.create({
    data: {
      schoolId: ctx.schoolId, requesterId: ctx.actorId, forUserId: forUser.id, leaveTypeId: leaveType?.id ?? null,
      fromDate: from, toDate: to, days, reason: input.reason, status: 'Pending',
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'leaveRequest', row.id, undefined, serializeLeaveRequest(row))

  // Phase T9 §4 — chained absence: if this newly-absent person was themselves an accepted substitute
  // covering someone else's periods that overlap this new leave, that coverage is no longer real. No-op
  // (a single fast lookup) for every leave that isn't a teacher's own — never touches student/staff leave.
  await subSvc.detectAndHandleChainedAbsence(ctx, row)
  return row
}

function assertPending(row: LeaveRequest) {
  if (row.status === 'PENDING_SUBSTITUTION') {
    throw new HttpError(409, 'Leave request has a substitution request in flight — wait for it to be accepted/declined (or send a substitute request yourself) before deciding')
  }
  if (row.status !== 'Pending') throw new HttpError(409, `Leave request is already ${row.status.toLowerCase()}`)
}

// Approver: student leave → the student's class teacher, or staff/admin/superadmin.
// staff leave (forUser is teacher/staff/admin/superadmin) → admin/superadmin only.
async function assertCanDecide(ctx: Ctx, row: LeaveRequest) {
  const forUser = await prisma.user.findUniqueOrThrow({ where: { id: row.forUserId } })
  if (forUser.role === 'student') {
    if (isStaff(ctx)) return
    if (ctx.role === 'teacher' && (await classTeacherOfStudent(ctx.schoolId, forUser.id)) === ctx.actorId) return
    throw new HttpError(403, 'You are not authorised to decide this leave request')
  }
  if (isAdmin(ctx)) return
  throw new HttpError(403, 'Only admin/superadmin may decide staff leave requests')
}

// Notifies the requester (in-app + email — see phase-9-10-integrations-hardening.md → item 3) of a
// leave decision. Best-effort; never blocks the decision itself.
async function notifyDecision(ctx: Ctx, row: LeaveRequest, decision: 'Approved' | 'Declined') {
  const requester = await prisma.user.findUnique({ where: { id: row.requesterId } })
  if (!requester) return
  const title = `Leave request ${decision.toLowerCase()}`
  const body = `Your leave request for ${fmtDate(row.fromDate)}–${fmtDate(row.toDate)} was ${decision.toLowerCase()}.${row.decisionNote ? ` Note: ${row.decisionNote}` : ''}`
  await notify(ctx.schoolId, requester.id, 'leave', title, body)
  await sendEmail({ to: requester.email, subject: `EduNova — ${title}`, body })
  // Phase 23 item 3: WhatsApp alongside email, same best-effort pattern — only when a phone is on file.
  if (requester.phone) await sendWhatsApp({ to: requester.phone, body: `EduNova — ${title}\n${body}` })
}

export async function approve(ctx: Ctx, id: string, input: z.infer<typeof decideBody>) {
  const before = await get(ctx, id)
  assertPending(before)
  await assertCanDecide(ctx, before)
  const row = await prisma.leaveRequest.update({
    where: { id }, data: { status: 'Approved', decidedById: ctx.actorId, decidedAt: new Date(), decisionNote: input.note ?? null },
  })
  await audit(ctx.schoolId, ctx.actorId, 'approve', 'leaveRequest', id, serializeLeaveRequest(before), serializeLeaveRequest(row))
  await notifyDecision(ctx, row, 'Approved')

  // Phase T9 §4 — the substitution workflow's own second validation pass (accept-time was the first):
  // promotes any accepted substitute's hold from TENTATIVE to LOCKED, writes the real Substitution row(s),
  // and reports any period this absence touches that still has no coverage. No-op (one fast role lookup)
  // for every non-teacher leave — the critical regression guarantee. Attached as a non-enumerable-shaped
  // extra property rather than changed into `row`'s own return shape, so every existing caller of approve()
  // (and serializeLeaveRequest, which only reads its own explicit field list) is completely unaffected.
  const substitution = await subSvc.onLeaveApproved(ctx, row)
  return Object.assign(row, { _substitution: substitution })
}

export async function decline(ctx: Ctx, id: string, input: z.infer<typeof decideBody>) {
  const before = await get(ctx, id)
  // Unlike approve(), a decline is allowed straight through PENDING_SUBSTITUTION — declining the whole
  // leave makes any in-flight substitution round-trip moot, so it's cancelled rather than left blocking.
  if (before.status === 'PENDING_SUBSTITUTION') {
    await subSvc.cancelOutstandingSubstitutionRequests(ctx, before.id)
  } else {
    assertPending(before)
  }
  await assertCanDecide(ctx, before)
  const row = await prisma.leaveRequest.update({
    where: { id }, data: { status: 'Declined', decidedById: ctx.actorId, decidedAt: new Date(), decisionNote: input.note ?? null },
  })
  await audit(ctx.schoolId, ctx.actorId, 'decline', 'leaveRequest', id, serializeLeaveRequest(before), serializeLeaveRequest(row))
  await notifyDecision(ctx, row, 'Declined')
  return row
}

export async function cancel(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  assertPending(before)
  if (before.requesterId !== ctx.actorId) throw new HttpError(403, 'Only the requester may cancel this leave request')
  const row = await prisma.leaveRequest.update({ where: { id }, data: { status: 'Cancelled' } })
  await audit(ctx.schoolId, ctx.actorId, 'cancel', 'leaveRequest', id, serializeLeaveRequest(before), serializeLeaveRequest(row))
  return row
}

// ─────────────────────────── balance ───────────────────────────

export async function balance(ctx: Ctx, q: z.infer<typeof balanceQuery>) {
  const userId = q.userId ?? ctx.actorId
  if (userId !== ctx.actorId) {
    if (ctx.role === 'parent') {
      const wards = (await visibleStudentIds(ctx))!
      if (!wards.includes(userId)) throw new HttpError(403, 'That student is not your ward')
    } else if (!isStaff(ctx)) {
      throw new HttpError(403, 'You may only view your own leave balance')
    }
  }
  const user = await prisma.user.findFirst({ where: { id: userId, schoolId: ctx.schoolId } })
  if (!user) throw notFound('User')
  const appliesTo = user.role === 'student' ? 'student' : 'staff'
  const year = q.year ?? String(new Date().getUTCFullYear())
  const yearStart = toDate(`${year}-01-01`)
  const yearEnd = toDate(`${year}-12-31`)

  const [types, approved] = await Promise.all([
    prisma.leaveType.findMany({ where: { schoolId: ctx.schoolId, appliesTo } }),
    prisma.leaveRequest.findMany({
      where: { schoolId: ctx.schoolId, forUserId: userId, status: 'Approved', fromDate: { gte: yearStart, lte: yearEnd } },
    }),
  ])

  const usedByType = new Map<string, number>()
  for (const r of approved) {
    if (!r.leaveTypeId) continue
    usedByType.set(r.leaveTypeId, (usedByType.get(r.leaveTypeId) ?? 0) + r.days)
  }

  return {
    userId, year,
    items: types.map(t => {
      const used = usedByType.get(t.id) ?? 0
      const unlimited = t.daysPerYear === 0
      return { leaveTypeId: t.id, name: t.name, allowed: t.daysPerYear, used, remaining: unlimited ? null : t.daysPerYear - used }
    }),
  }
}
