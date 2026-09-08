import type { z } from 'zod'
import type { HealthRecord } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isAdmin, isStaff, isClassTeacherOfStudent, isGuardianOf, visibleStudentIds } from '../../lib/scope'
import { toDate, fmtDate } from '../../lib/validate'
import type { createHealthRecord, patchHealthRecord, healthQuery } from './schema'

// See phase-8-welfare.md → Rules ("Health"). Visible only to the student, their guardians, their class
// teacher, and staff/admin. Add: parent/student for self/ward, or staff/admin for anyone. Verify: staff/admin.

export const serializeHealth = (h: HealthRecord) => ({
  id: h.id, studentId: h.studentId, kind: h.kind, title: h.title, detail: h.detail, date: fmtDate(h.date),
  addedById: h.addedById, verifiedById: h.verifiedById ?? undefined, verifiedAt: h.verifiedAt?.toISOString(),
  fileIds: h.fileIds, createdAt: h.createdAt.toISOString(),
})

export async function canViewHealth(ctx: Ctx, studentId: string): Promise<boolean> {
  if (isStaff(ctx)) return true
  if (ctx.role === 'student') return ctx.actorId === studentId
  if (await isGuardianOf(ctx, studentId)) return true
  if (await isClassTeacherOfStudent(ctx, studentId)) return true
  return false
}

async function assertViewHealth(ctx: Ctx, studentId: string) {
  if (!(await canViewHealth(ctx, studentId))) throw new HttpError(403, 'You cannot view this student’s health records')
}

async function assertStudent(ctx: Ctx, studentId: string) {
  const row = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!row) throw notFound('Student')
  return row
}

export async function listHealth(ctx: Ctx, q: z.infer<typeof healthQuery>) {
  if (q.studentId) {
    await assertViewHealth(ctx, q.studentId)
    const rows = await prisma.healthRecord.findMany({ where: { schoolId: ctx.schoolId, studentId: q.studentId }, orderBy: { date: 'desc' } })
    return rows.map(serializeHealth)
  }
  const only = await visibleStudentIds(ctx)
  if (!only) throw new HttpError(400, 'studentId is required')
  const rows = await prisma.healthRecord.findMany({ where: { schoolId: ctx.schoolId, studentId: { in: only } }, orderBy: { date: 'desc' } })
  return rows.map(serializeHealth)
}

export async function createHealthRecordSvc(ctx: Ctx, input: z.infer<typeof createHealthRecord>) {
  await assertStudent(ctx, input.studentId)
  if (ctx.role === 'student') {
    if (ctx.actorId !== input.studentId) throw new HttpError(403, 'You may only add a health record for yourself')
  } else if (ctx.role === 'parent') {
    if (!(await isGuardianOf(ctx, input.studentId))) throw new HttpError(403, 'That student is not your ward')
  } else if (!isStaff(ctx)) {
    throw new HttpError(403, 'Only the student, a parent, or staff/admin may add a health record')
  }
  const row = await prisma.healthRecord.create({
    data: {
      schoolId: ctx.schoolId, studentId: input.studentId, kind: input.kind, title: input.title, detail: input.detail,
      date: toDate(input.date), addedById: ctx.actorId, fileIds: input.fileIds ?? [],
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'health-record', row.id, undefined, { studentId: row.studentId, kind: row.kind })
  return row
}

async function getOwned(ctx: Ctx, id: string) {
  const row = await prisma.healthRecord.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Health record')
  if (row.addedById !== ctx.actorId && !isAdmin(ctx) && !isStaff(ctx)) throw new HttpError(403, 'Only the author or staff/admin may modify this record')
  return row
}

export async function updateHealthRecord(ctx: Ctx, id: string, input: z.infer<typeof patchHealthRecord>) {
  const before = await getOwned(ctx, id)
  const row = await prisma.healthRecord.update({
    where: { id },
    data: { kind: input.kind, title: input.title, detail: input.detail, date: input.date ? toDate(input.date) : undefined, fileIds: input.fileIds },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'health-record', id, serializeHealth(before), serializeHealth(row))
  return row
}

export async function deleteHealthRecord(ctx: Ctx, id: string) {
  const before = await getOwned(ctx, id)
  await prisma.healthRecord.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'health-record', id, serializeHealth(before))
}

export async function verifyHealthRecord(ctx: Ctx, id: string) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may verify a health record')
  const before = await prisma.healthRecord.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Health record')
  const row = await prisma.healthRecord.update({ where: { id }, data: { verifiedById: ctx.actorId, verifiedAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'verify', 'health-record', id, serializeHealth(before), serializeHealth(row))
  return row
}
