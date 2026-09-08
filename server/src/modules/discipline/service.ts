import type { z } from 'zod'
import type { DisciplinaryCase, DisciplinaryNote } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notify } from '../../lib/notify'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isAdmin, isStaff, teacherClassIds, wardClassIds, activeClassOf, visibleStudentIds } from '../../lib/scope'
import { toDate, fmtDate } from '../../lib/validate'
import type { createCase, patchCase, setStatus, addNote, disciplineQuery } from './schema'

// See phase-8-welfare.md → Rules ("Discipline"). Reporters: teacher (only for students in their classes) /
// staff / admin. Parents/students read own. Soft delete (deletedAt) by admin only — always excluded from
// the default list, but the row (and its audit trail) survive for compliance.

export const serializeCase = (c: DisciplinaryCase) => ({
  id: c.id, studentId: c.studentId, classId: c.classId ?? undefined, title: c.title, description: c.description,
  reportedById: c.reportedById, witnesses: c.witnesses ?? undefined, fileIds: c.fileIds, status: c.status,
  hearingDate: c.hearingDate ? fmtDate(c.hearingDate) : undefined, decision: c.decision ?? undefined,
  actionTaken: c.actionTaken ?? undefined, appeal: c.appeal ?? undefined, relatedPeople: c.relatedPeople ?? undefined,
  deletedAt: c.deletedAt?.toISOString(), createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
})

export const serializeNote = (n: DisciplinaryNote) => ({ id: n.id, caseId: n.caseId, authorId: n.authorId, body: n.body, createdAt: n.createdAt.toISOString() })

export async function listCases(ctx: Ctx, q: z.infer<typeof disciplineQuery>) {
  const where: Record<string, unknown> = { schoolId: ctx.schoolId, deletedAt: null }
  if (q.studentId) where.studentId = q.studentId
  if (q.classId) where.classId = q.classId

  if (isStaff(ctx)) {
    // no further restriction
  } else if (ctx.role === 'teacher') {
    where.classId = q.classId ? q.classId : { in: await teacherClassIds(ctx) }
    if (q.classId && !(await teacherClassIds(ctx)).includes(q.classId)) throw new HttpError(403, 'You do not teach this class')
  } else {
    const only = (await visibleStudentIds(ctx)) ?? []
    if (q.studentId && !only.includes(q.studentId)) throw new HttpError(403, ctx.role === 'parent' ? 'That student is not your ward' : 'You can only view your own cases')
    where.studentId = q.studentId ?? { in: only }
  }
  const rows = await prisma.disciplinaryCase.findMany({ where, orderBy: { createdAt: 'desc' } })
  return rows.map(serializeCase)
}

async function getVisible(ctx: Ctx, id: string) {
  const row = await prisma.disciplinaryCase.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Disciplinary case')
  if (isStaff(ctx)) return row
  if (ctx.role === 'teacher') {
    if (!row.classId || !(await teacherClassIds(ctx)).includes(row.classId)) throw new HttpError(403, 'You do not teach this class')
    return row
  }
  const only = (await visibleStudentIds(ctx)) ?? []
  if (!only.includes(row.studentId)) throw new HttpError(403, 'You cannot view this case')
  return row
}

export async function createCaseSvc(ctx: Ctx, input: z.infer<typeof createCase>) {
  if (ctx.role !== 'teacher' && !isStaff(ctx)) throw new HttpError(403, 'Only a teacher, staff or admin may report a disciplinary case')
  const student = await prisma.user.findFirst({ where: { id: input.studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')
  const enrollment = await activeClassOf(input.studentId)
  if (ctx.role === 'teacher') {
    if (!enrollment || !(await teacherClassIds(ctx)).includes(enrollment.classId)) throw new HttpError(403, 'You do not teach this student’s class')
  }
  const row = await prisma.disciplinaryCase.create({
    data: {
      schoolId: ctx.schoolId, studentId: input.studentId, classId: enrollment?.classId ?? null, title: input.title,
      description: input.description, reportedById: ctx.actorId, witnesses: input.witnesses ?? null,
      fileIds: input.fileIds ?? [], hearingDate: input.hearingDate ? toDate(input.hearingDate) : null, status: 'Reported',
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'disciplinary-case', row.id, undefined, { studentId: row.studentId, title: row.title })
  return row
}

function assertModify(ctx: Ctx, row: DisciplinaryCase) {
  if (row.reportedById !== ctx.actorId && !isStaff(ctx)) throw new HttpError(403, 'Only the reporter or staff/admin may modify this case')
}

export async function updateCase(ctx: Ctx, id: string, input: z.infer<typeof patchCase>) {
  const before = await prisma.disciplinaryCase.findFirst({ where: { id, schoolId: ctx.schoolId, deletedAt: null } })
  if (!before) throw notFound('Disciplinary case')
  assertModify(ctx, before)
  const row = await prisma.disciplinaryCase.update({
    where: { id },
    data: {
      title: input.title, description: input.description, witnesses: input.witnesses, fileIds: input.fileIds,
      hearingDate: input.hearingDate ? toDate(input.hearingDate) : undefined, decision: input.decision,
      actionTaken: input.actionTaken, appeal: input.appeal, relatedPeople: input.relatedPeople,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'disciplinary-case', id, serializeCase(before), serializeCase(row))
  return row
}

export async function setCaseStatus(ctx: Ctx, id: string, input: z.infer<typeof setStatus>) {
  const before = await prisma.disciplinaryCase.findFirst({ where: { id, schoolId: ctx.schoolId, deletedAt: null } })
  if (!before) throw notFound('Disciplinary case')
  assertModify(ctx, before)
  const [row] = await prisma.$transaction([
    prisma.disciplinaryCase.update({ where: { id }, data: { status: input.status } }),
    prisma.disciplinaryNote.create({ data: { caseId: id, authorId: ctx.actorId, body: input.note?.trim() ? `Status → ${input.status}: ${input.note}` : `Status → ${input.status}` } }),
  ])
  await audit(ctx.schoolId, ctx.actorId, 'status', 'disciplinary-case', id, { status: before.status }, { status: input.status })
  await notify(ctx.schoolId, before.studentId, 'discipline', 'Case update', `${before.title}: ${input.status}`, 'disc')
  return row
}

export async function addCaseNote(ctx: Ctx, id: string, input: z.infer<typeof addNote>) {
  const row = await prisma.disciplinaryCase.findFirst({ where: { id, schoolId: ctx.schoolId, deletedAt: null } })
  if (!row) throw notFound('Disciplinary case')
  assertModify(ctx, row)
  const note = await prisma.disciplinaryNote.create({ data: { caseId: id, authorId: ctx.actorId, body: input.body } })
  await audit(ctx.schoolId, ctx.actorId, 'note', 'disciplinary-case', id, undefined, { body: input.body })
  return note
}

export async function listCaseNotes(ctx: Ctx, id: string) {
  await getVisible(ctx, id)
  const rows = await prisma.disciplinaryNote.findMany({ where: { caseId: id }, orderBy: { createdAt: 'asc' } })
  return rows.map(serializeNote)
}

export async function deleteCase(ctx: Ctx, id: string) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Only admin may delete a disciplinary case')
  const before = await prisma.disciplinaryCase.findFirst({ where: { id, schoolId: ctx.schoolId, deletedAt: null } })
  if (!before) throw notFound('Disciplinary case')
  const row = await prisma.disciplinaryCase.update({ where: { id }, data: { deletedAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'disciplinary-case', id, serializeCase(before), serializeCase(row))
}
