import type { CurriculumSubject } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { createCurriculum, patchCurriculum, curriculumQuery } from './schema'

export const serializeCurriculum = (c: CurriculumSubject) => ({
  id: c.id,
  boardId: c.boardId,
  gradeId: c.gradeId,
  streamId: c.streamId ?? undefined,
  subjectId: c.subjectId,
  kind: c.kind,
  textbook: c.textbook ?? undefined,
  syllabusRef: c.syllabusRef ?? undefined,
})

export function list(ctx: Ctx, filter: z.infer<typeof curriculumQuery> = {}) {
  return prisma.curriculumSubject.findMany({
    where: { schoolId: ctx.schoolId, boardId: filter.boardId, gradeId: filter.gradeId, streamId: filter.streamId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.curriculumSubject.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Curriculum row')
  return row
}

async function assertRefs(ctx: Ctx, input: { boardId: string; gradeId: string; streamId?: string | null; subjectId: string }) {
  const { schoolId } = ctx
  if (!(await prisma.board.findFirst({ where: { id: input.boardId, schoolId } }))) throw notFound('Board')
  if (!(await prisma.grade.findFirst({ where: { id: input.gradeId, schoolId } }))) throw notFound('Grade')
  if (input.streamId && !(await prisma.stream.findFirst({ where: { id: input.streamId, schoolId } }))) throw notFound('Stream')
  if (!(await prisma.subject.findFirst({ where: { id: input.subjectId, schoolId } }))) throw notFound('Subject')
}

export async function create(ctx: Ctx, input: z.infer<typeof createCurriculum>) {
  await assertRefs(ctx, input)
  const streamId = input.streamId ?? null
  // Uniqueness lives here rather than in the DB: Postgres treats NULL streamIds as distinct.
  const existing = await prisma.curriculumSubject.findFirst({
    where: { schoolId: ctx.schoolId, boardId: input.boardId, gradeId: input.gradeId, streamId, subjectId: input.subjectId },
  })
  if (existing) throw new HttpError(409, 'This subject is already in the curriculum for that board / grade / stream', { curriculumId: existing.id })
  const row = await prisma.curriculumSubject.create({
    data: {
      schoolId: ctx.schoolId,
      boardId: input.boardId,
      gradeId: input.gradeId,
      streamId,
      subjectId: input.subjectId,
      kind: input.kind,
      textbook: input.textbook ?? null,
      syllabusRef: input.syllabusRef ?? null,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'curriculumSubject', row.id, undefined, serializeCurriculum(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchCurriculum>) {
  const before = await get(ctx, id)
  const row = await prisma.curriculumSubject.update({ where: { id }, data: input })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'curriculumSubject', id, serializeCurriculum(before), serializeCurriculum(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.curriculumSubject.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'curriculumSubject', id, serializeCurriculum(before))
}
