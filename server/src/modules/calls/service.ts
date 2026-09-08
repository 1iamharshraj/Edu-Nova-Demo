import type { z } from 'zod'
import type { CallLog } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isAdmin, isStaff, teacherClassIds, activeClassOf, visibleStudentIds } from '../../lib/scope'
import type { createCall, callsQuery } from './schema'

// See phase-8-welfare.md → Rules ("Call log"). Replaces the AI call simulation with a real call staff /
// teacher / admin logs after speaking with a parent. Read: staff/admin any; teacher for classes they
// teach; parent/student their own.

export const serializeCall = (c: CallLog) => ({
  id: c.id, studentId: c.studentId, parentId: c.parentId ?? undefined, byId: c.byId, reason: c.reason,
  summary: c.summary, outcome: c.outcome, calledAt: c.calledAt.toISOString(), durationMin: c.durationMin ?? undefined,
})

export async function listCalls(ctx: Ctx, q: z.infer<typeof callsQuery>) {
  const where: Record<string, unknown> = { schoolId: ctx.schoolId }
  if (q.studentId) where.studentId = q.studentId

  if (isStaff(ctx)) {
    // unrestricted
  } else if (ctx.role === 'teacher') {
    if (q.studentId) {
      const enrollment = await activeClassOf(q.studentId)
      if (!enrollment || !(await teacherClassIds(ctx)).includes(enrollment.classId)) throw new HttpError(403, 'You do not teach this student’s class')
    } else {
      const classIds = await teacherClassIds(ctx)
      const roster = await prisma.enrollment.findMany({ where: { classId: { in: classIds }, status: 'active' }, select: { studentId: true } })
      where.studentId = { in: roster.map(r => r.studentId) }
    }
  } else {
    const only = (await visibleStudentIds(ctx)) ?? []
    if (q.studentId && !only.includes(q.studentId)) throw new HttpError(403, ctx.role === 'parent' ? 'That student is not your ward' : 'You can only view your own calls')
    where.studentId = q.studentId ?? { in: only }
  }
  const rows = await prisma.callLog.findMany({ where, orderBy: { calledAt: 'desc' } })
  return rows.map(serializeCall)
}

export async function createCallSvc(ctx: Ctx, input: z.infer<typeof createCall>) {
  if (ctx.role !== 'teacher' && !isStaff(ctx)) throw new HttpError(403, 'Only a teacher, staff or admin may log a call')
  const student = await prisma.user.findFirst({ where: { id: input.studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')
  if (ctx.role === 'teacher') {
    const enrollment = await activeClassOf(input.studentId)
    if (!enrollment || !(await teacherClassIds(ctx)).includes(enrollment.classId)) throw new HttpError(403, 'You do not teach this student’s class')
  }
  let parentId = input.parentId ?? null
  if (parentId) {
    const guardian = await prisma.guardian.findUnique({ where: { parentId_studentId: { parentId, studentId: input.studentId } } })
    if (!guardian) throw new HttpError(400, 'That parent is not a guardian of this student')
  } else {
    const guardian = await prisma.guardian.findFirst({ where: { studentId: input.studentId } })
    parentId = guardian?.parentId ?? null
  }
  const row = await prisma.callLog.create({
    data: {
      schoolId: ctx.schoolId, studentId: input.studentId, parentId, byId: ctx.actorId, reason: input.reason,
      summary: input.summary, outcome: input.outcome, calledAt: input.calledAt ? new Date(input.calledAt) : new Date(),
      durationMin: input.durationMin,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'call-log', row.id, undefined, { studentId: row.studentId, reason: row.reason, outcome: row.outcome })
  return row
}

export async function deleteCall(ctx: Ctx, id: string) {
  const row = await prisma.callLog.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Call log')
  if (row.byId !== ctx.actorId && !isAdmin(ctx)) throw new HttpError(403, 'Only the recorder or admin may delete this call log')
  await prisma.callLog.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'call-log', id, serializeCall(row))
}
