import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { assertViewClass, assertWriteClassSubject, canWriteClass, getClass, getClassSubject, getTerm, visibleStudentIds } from '../../lib/scope'
import { assertFileIds } from '../files/service'
import type { createHomework, patchHomework, listQuery, submitBody, gradeBody } from './schema'

export const homeworkInclude = {
  classSubject: { include: { subject: true } },
  submissions: { orderBy: { submittedAt: 'asc' } },
} satisfies Prisma.HomeworkInclude
export type HomeworkFull = Prisma.HomeworkGetPayload<{ include: typeof homeworkInclude }>

export const serializeSubmission = (s: HomeworkFull['submissions'][number]) => ({
  id: s.id, homeworkId: s.homeworkId, studentId: s.studentId, submittedAt: s.submittedAt.toISOString(),
  files: s.files, note: s.note ?? undefined, status: s.status, grade: s.grade ?? undefined, feedback: s.feedback ?? undefined,
})

// `submissionsFor`: null → all; ids → only those students'.
export const serializeHomework = (h: HomeworkFull, submissionsFor: string[] | null) => ({
  id: h.id,
  classSubjectId: h.classSubjectId,
  classId: h.classSubject.classId,
  subjectId: h.classSubject.subjectId,
  subjectName: h.classSubject.subject.name,
  title: h.title,
  description: h.description,
  dueDate: fmtDate(h.dueDate),
  createdById: h.createdById ?? undefined,
  attachments: h.attachments,
  createdAt: h.createdAt.toISOString(),
  submissions: h.submissions.filter(s => !submissionsFor || submissionsFor.includes(s.studentId)).map(serializeSubmission),
})

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.homework.findFirst({ where: { id, schoolId: ctx.schoolId }, include: homeworkInclude })
  if (!row) throw notFound('Homework')
  return row
}

// GET /?classId&termId — termId filters by due date inside the term.
export async function list(ctx: Ctx, q: z.infer<typeof listQuery>) {
  const cls = await getClass(ctx, q.classId)
  await assertViewClass(ctx, cls.id)
  const term = q.termId ? await getTerm(ctx, q.termId) : null
  const rows = await prisma.homework.findMany({
    where: { schoolId: ctx.schoolId, classSubject: { classId: cls.id }, dueDate: term ? { gte: term.startDate, lte: term.endDate } : undefined },
    include: homeworkInclude,
    orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
  })
  const only = ctx.role === 'student' || ctx.role === 'parent' ? await visibleStudentIds(ctx) : (await canWriteClass(ctx, cls.id)) ? null : []
  return rows.map(h => serializeHomework(h, only))
}

export async function create(ctx: Ctx, input: z.infer<typeof createHomework>) {
  const cs = await getClassSubject(ctx, input.classSubjectId)
  await assertWriteClassSubject(ctx, cs.id)
  await assertFileIds(ctx, input.attachments ?? [])
  const row = await prisma.homework.create({
    data: { schoolId: ctx.schoolId, classSubjectId: cs.id, title: input.title, description: input.description ?? '', dueDate: toDate(input.dueDate), createdById: ctx.actorId, attachments: input.attachments ?? [] },
    include: homeworkInclude,
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'homework', row.id, undefined, serializeHomework(row, []))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchHomework>) {
  const before = await get(ctx, id)
  await assertWriteClassSubject(ctx, before.classSubjectId)
  if (input.attachments) await assertFileIds(ctx, input.attachments)
  const row = await prisma.homework.update({
    where: { id },
    data: { title: input.title, description: input.description, dueDate: input.dueDate ? toDate(input.dueDate) : undefined, attachments: input.attachments },
    include: homeworkInclude,
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'homework', id, serializeHomework(before, []), serializeHomework(row, []))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await assertWriteClassSubject(ctx, before.classSubjectId)
  await prisma.homework.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'homework', id, serializeHomework(before, null))
}

// POST /:id/submit — student only; Late when submitted after the due date (end of that day, UTC).
export async function submit(ctx: Ctx, id: string, input: z.infer<typeof submitBody>) {
  if (ctx.role !== 'student') throw new HttpError(403, 'Only students submit homework')
  const hw = await get(ctx, id)
  const enrolled = await prisma.enrollment.findFirst({ where: { classId: hw.classSubject.classId, studentId: ctx.actorId, status: 'active' } })
  if (!enrolled) throw new HttpError(403, 'You are not enrolled in this class')
  await assertFileIds(ctx, input.files ?? [])
  const existing = hw.submissions.find(s => s.studentId === ctx.actorId)
  if (existing && (existing.status === 'Graded' || existing.status === 'Returned')) throw new HttpError(409, 'This submission has already been graded')
  const now = new Date()
  const deadline = new Date(hw.dueDate.getTime() + 24 * 60 * 60 * 1000)
  const status = now >= deadline ? 'Late' : 'Submitted'
  const row = await prisma.homeworkSubmission.upsert({
    where: { homeworkId_studentId: { homeworkId: id, studentId: ctx.actorId } },
    create: { homeworkId: id, studentId: ctx.actorId, files: input.files ?? [], note: input.note ?? null, status, submittedAt: now },
    update: { files: input.files ?? [], note: input.note === undefined ? undefined : input.note, status, submittedAt: now },
  })
  await audit(ctx.schoolId, ctx.actorId, existing ? 'resubmit' : 'submit', 'homeworkSubmission', row.id, existing ? serializeSubmission(existing) : undefined, serializeSubmission(row))
  return row
}

// PATCH /:id/submissions/:studentId — teacher grades; status defaults to Graded when a grade is given.
export async function grade(ctx: Ctx, id: string, studentId: string, input: z.infer<typeof gradeBody>) {
  const hw = await get(ctx, id)
  await assertWriteClassSubject(ctx, hw.classSubjectId)
  const before = hw.submissions.find(s => s.studentId === studentId)
  if (!before) throw notFound('Submission')
  const status = input.status ?? (input.grade ? 'Graded' : input.feedback !== undefined ? 'Returned' : before.status)
  const row = await prisma.homeworkSubmission.update({
    where: { id: before.id },
    data: { grade: input.grade === undefined ? undefined : input.grade, feedback: input.feedback === undefined ? undefined : input.feedback, status },
  })
  await audit(ctx.schoolId, ctx.actorId, 'grade', 'homeworkSubmission', row.id, serializeSubmission(before), serializeSubmission(row))
  return row
}
