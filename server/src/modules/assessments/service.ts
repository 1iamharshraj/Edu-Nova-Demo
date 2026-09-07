import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { assertOnRoster, assertViewClass, assertWriteClass, canWriteClass, getClass, getClassSubject, getTerm, visibleStudentIds } from '../../lib/scope'
import type { createAssessment, patchAssessment, putMarks, listQuery } from './schema'

export const assessmentInclude = {
  classSubject: { include: { subject: true } },
  marks: { orderBy: { studentId: 'asc' } },
} satisfies Prisma.AssessmentInclude
export type AssessmentFull = Prisma.AssessmentGetPayload<{ include: typeof assessmentInclude }>

export const serializeMark = (m: { id: string; studentId: string; score: number; remark: string | null }) => ({
  id: m.id, studentId: m.studentId, score: m.score, remark: m.remark ?? undefined,
})

// `marksFor`: null → all marks; [] → none; ids → only those students.
export const serializeAssessment = (a: AssessmentFull, marksFor: string[] | null) => ({
  id: a.id,
  classSubjectId: a.classSubjectId,
  classId: a.classSubject.classId,
  subjectId: a.classSubject.subjectId,
  subjectName: a.classSubject.subject.name,
  termId: a.termId,
  name: a.name,
  maxMarks: a.maxMarks,
  weight: a.weight,
  date: a.date ? fmtDate(a.date) : undefined,
  publishedAt: a.publishedAt?.toISOString(),
  marks: a.marks.filter(m => !marksFor || marksFor.includes(m.studentId)).map(serializeMark),
})

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.assessment.findFirst({ where: { id, schoolId: ctx.schoolId }, include: assessmentInclude })
  if (!row) throw notFound('Assessment')
  return row
}

// GET /?classSubjectId&termId | ?classId&termId — visibility per role applied here.
export async function list(ctx: Ctx, q: z.infer<typeof listQuery>) {
  const term = await getTerm(ctx, q.termId)
  const classId = q.classSubjectId ? (await getClassSubject(ctx, q.classSubjectId)).classId : (await getClass(ctx, q.classId!)).id
  await assertViewClass(ctx, classId)
  const restricted = ctx.role === 'student' || ctx.role === 'parent'
  const rows = await prisma.assessment.findMany({
    where: {
      schoolId: ctx.schoolId, termId: term.id,
      classSubjectId: q.classSubjectId,
      classSubject: q.classSubjectId ? undefined : { classId },
      publishedAt: restricted ? { not: null } : undefined,
    },
    include: assessmentInclude,
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  })
  // Teachers outside the class's scope see the assessments but nobody's marks.
  const marksFor = restricted ? await visibleStudentIds(ctx) : (await canWriteClass(ctx, classId)) ? null : []
  return rows.map(a => serializeAssessment(a, marksFor))
}

export async function create(ctx: Ctx, input: z.infer<typeof createAssessment>) {
  const cs = await getClassSubject(ctx, input.classSubjectId)
  const term = await getTerm(ctx, input.termId)
  if (cs.class.academicYearId !== term.academicYearId) throw new HttpError(400, 'Term does not belong to the class’s academic year')
  await assertWriteClass(ctx, cs.classId)
  const row = await prisma.assessment.create({
    data: { schoolId: ctx.schoolId, classSubjectId: cs.id, termId: term.id, name: input.name, maxMarks: input.maxMarks, weight: input.weight ?? 1, date: input.date ? toDate(input.date) : null },
    include: assessmentInclude,
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'assessment', row.id, undefined, serializeAssessment(row, []))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchAssessment>) {
  const before = await get(ctx, id)
  await assertWriteClass(ctx, before.classSubject.classId)
  if (input.maxMarks !== undefined) {
    const over = before.marks.filter(m => m.score > input.maxMarks!)
    if (over.length) throw new HttpError(400, `maxMarks ${input.maxMarks} is below ${over.length} existing score(s)`, { studentId: over.map(m => m.studentId) })
  }
  const row = await prisma.assessment.update({
    where: { id },
    data: { name: input.name, maxMarks: input.maxMarks, weight: input.weight, date: input.date === undefined ? undefined : input.date ? toDate(input.date) : null },
    include: assessmentInclude,
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'assessment', id, serializeAssessment(before, []), serializeAssessment(row, []))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await assertWriteClass(ctx, before.classSubject.classId)
  await prisma.assessment.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'assessment', id, serializeAssessment(before, null))
}

// PUT /:id/marks — upsert by (assessment, student); every score must be ≤ maxMarks.
export async function putMarksFor(ctx: Ctx, id: string, input: z.infer<typeof putMarks>) {
  const before = await get(ctx, id)
  await assertWriteClass(ctx, before.classSubject.classId)
  const ids = input.marks.map(m => m.studentId)
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Duplicate studentId in marks')
  await assertOnRoster(before.classSubject.classId, ids)
  const over = input.marks.filter(m => m.score > before.maxMarks)
  if (over.length) throw new HttpError(400, `score must be ≤ maxMarks (${before.maxMarks})`, { studentId: over.map(m => m.studentId) })

  await prisma.$transaction(async tx => {
    for (const m of input.marks) {
      await tx.mark.upsert({
        where: { assessmentId_studentId: { assessmentId: id, studentId: m.studentId } },
        create: { assessmentId: id, studentId: m.studentId, score: m.score, remark: m.remark ?? null },
        update: { score: m.score, remark: m.remark === undefined ? undefined : m.remark },
      })
    }
  })
  const row = await get(ctx, id)
  await audit(ctx.schoolId, ctx.actorId, 'put-marks', 'assessment', id, { marks: before.marks.map(serializeMark) }, { marks: row.marks.map(serializeMark) })
  return row
}

export async function setPublished(ctx: Ctx, id: string, published: boolean) {
  const before = await get(ctx, id)
  await assertWriteClass(ctx, before.classSubject.classId)
  const row = await prisma.assessment.update({ where: { id }, data: { publishedAt: published ? new Date() : null }, include: assessmentInclude })
  await audit(ctx.schoolId, ctx.actorId, published ? 'publish' : 'unpublish', 'assessment', id, { publishedAt: before.publishedAt }, { publishedAt: row.publishedAt })
  return row
}
