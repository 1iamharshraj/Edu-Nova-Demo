import type { z } from 'zod'
import type { PermissionSlip, SlipResponse } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notify } from '../../lib/notify'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isAdmin, isStaff, teacherClassIds, wardClassIds, studentClassIds, isGuardianOf, activeClassOf, getClass } from '../../lib/scope'
import { toDate, fmtDate } from '../../lib/validate'
import type { createSlip, patchSlip, respondSlip, slipsQuery } from './schema'

// See phase-8-welfare.md → Rules ("Slips"). Create: teacher (own classes) / staff / admin — a teacher may
// not create a school-wide (classId omitted) slip. Respond: a parent per ward, requiring `verified` when
// `requiresVerifiedParent`. Tally: teacher (of that class) / staff / admin.

export const serializeSlip = (s: PermissionSlip) => ({
  id: s.id, title: s.title, detail: s.detail, dueDate: fmtDate(s.dueDate), classId: s.classId ?? undefined,
  createdById: s.createdById, requiresVerifiedParent: s.requiresVerifiedParent, createdAt: s.createdAt.toISOString(),
})

export const serializeResponse = (r: SlipResponse) => ({
  id: r.id, slipId: r.slipId, studentId: r.studentId, parentId: r.parentId, decision: r.decision,
  respondedAt: r.respondedAt.toISOString(), note: r.note ?? undefined,
})

async function relevantClassIds(ctx: Ctx): Promise<string[]> {
  if (ctx.role === 'student') return studentClassIds(ctx.actorId)
  if (ctx.role === 'parent') return wardClassIds(ctx)
  if (ctx.role === 'teacher') return teacherClassIds(ctx)
  return []
}

function canViewSlip(classIds: Set<string>, ctx: Ctx, slip: { classId: string | null }): boolean {
  if (isStaff(ctx)) return true
  if (slip.classId === null) return true
  return classIds.has(slip.classId)
}

export async function listSlips(ctx: Ctx, q: z.infer<typeof slipsQuery>) {
  const where: Record<string, unknown> = { schoolId: ctx.schoolId }
  if (q.classId) where.classId = q.classId
  const rows = await prisma.permissionSlip.findMany({ where, orderBy: { createdAt: 'desc' } })
  if (isStaff(ctx)) return rows.map(serializeSlip)
  const classIds = new Set(await relevantClassIds(ctx))
  return rows.filter(s => canViewSlip(classIds, ctx, s)).map(serializeSlip)
}

async function getVisible(ctx: Ctx, id: string) {
  const row = await prisma.permissionSlip.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Permission slip')
  const classIds = new Set(await relevantClassIds(ctx))
  if (!canViewSlip(classIds, ctx, row)) throw new HttpError(403, 'You cannot view this permission slip')
  return row
}

export async function createSlipSvc(ctx: Ctx, input: z.infer<typeof createSlip>) {
  if (ctx.role !== 'teacher' && !isStaff(ctx)) throw new HttpError(403, 'Only a teacher, staff or admin may create a permission slip')
  if (input.classId) {
    await getClass(ctx, input.classId)
    if (ctx.role === 'teacher' && !(await teacherClassIds(ctx)).includes(input.classId)) throw new HttpError(403, 'You do not teach this class')
  } else if (ctx.role === 'teacher') {
    throw new HttpError(403, 'A teacher must scope a permission slip to a class they teach')
  }
  const row = await prisma.permissionSlip.create({
    data: {
      schoolId: ctx.schoolId, title: input.title, detail: input.detail, dueDate: toDate(input.dueDate),
      classId: input.classId ?? null, createdById: ctx.actorId, requiresVerifiedParent: input.requiresVerifiedParent ?? true,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'permission-slip', row.id, undefined, { classId: row.classId, title: row.title })
  return row
}

async function getOwnedOrAdmin(ctx: Ctx, id: string) {
  const row = await prisma.permissionSlip.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Permission slip')
  if (row.createdById !== ctx.actorId && !isAdmin(ctx)) throw new HttpError(403, 'Only the creator or admin may modify this slip')
  return row
}

export async function updateSlip(ctx: Ctx, id: string, input: z.infer<typeof patchSlip>) {
  const before = await getOwnedOrAdmin(ctx, id)
  const row = await prisma.permissionSlip.update({
    where: { id },
    data: { title: input.title, detail: input.detail, dueDate: input.dueDate ? toDate(input.dueDate) : undefined, requiresVerifiedParent: input.requiresVerifiedParent },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'permission-slip', id, serializeSlip(before), serializeSlip(row))
  return row
}

export async function deleteSlip(ctx: Ctx, id: string) {
  const before = await getOwnedOrAdmin(ctx, id)
  await prisma.permissionSlip.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'permission-slip', id, serializeSlip(before))
}

export async function listResponses(ctx: Ctx, id: string) {
  const slip = await prisma.permissionSlip.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!slip) throw notFound('Permission slip')
  const allowedTeacher = ctx.role === 'teacher' && slip.classId && (await teacherClassIds(ctx)).includes(slip.classId)
  if (!isStaff(ctx) && !allowedTeacher) throw new HttpError(403, 'Only staff, admin, or the teacher of this class may see responses')
  const rows = await prisma.slipResponse.findMany({ where: { slipId: id }, orderBy: { respondedAt: 'desc' } })
  return rows.map(serializeResponse)
}

export async function respond(ctx: Ctx, id: string, input: z.infer<typeof respondSlip>) {
  if (ctx.role !== 'parent') throw new HttpError(403, 'Only a parent may respond to a permission slip')
  const slip = await prisma.permissionSlip.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!slip) throw notFound('Permission slip')
  if (!(await isGuardianOf(ctx, input.studentId))) throw new HttpError(403, 'That student is not your ward')

  if (slip.classId) {
    const enrollment = await activeClassOf(input.studentId)
    if (!enrollment || enrollment.classId !== slip.classId) throw new HttpError(403, 'This slip does not apply to that student’s class')
  }

  if (slip.requiresVerifiedParent) {
    const parent = await prisma.user.findFirst({ where: { id: ctx.actorId, schoolId: ctx.schoolId } })
    if (!parent?.verified) throw new HttpError(403, 'Your parent account must be verified before responding to this slip')
  }

  const row = await prisma.slipResponse.upsert({
    where: { slipId_studentId: { slipId: id, studentId: input.studentId } },
    create: { slipId: id, studentId: input.studentId, parentId: ctx.actorId, decision: input.decision, note: input.note ?? null },
    update: { decision: input.decision, note: input.note ?? null, respondedAt: new Date() },
  })
  await audit(ctx.schoolId, ctx.actorId, 'respond', 'permission-slip', id, undefined, { studentId: input.studentId, decision: input.decision })
  await notify(ctx.schoolId, slip.createdById, 'slip-response', `Response to "${slip.title}"`, `${input.decision}`, 'slips')
  return row
}
