import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { syncLegacyUserFields, usersTouchingClasses } from '../../lib/legacySync'
import { toClientUser } from '../../serialize'
import { serializeEnrollment } from '../enrollments/service'
import { createClass, patchClass } from './schema'

// Classes are always loaded with their board / grade / stream so the serializer can label them.
export const classInclude = { board: true, grade: true, stream: true } satisfies Prisma.ClassInclude
export type ClassWithRefs = Prisma.ClassGetPayload<{ include: typeof classInclude }>

export const serializeClass = (c: ClassWithRefs) => ({
  id: c.id,
  academicYearId: c.academicYearId,
  boardId: c.boardId,
  boardCode: c.board.code,
  gradeId: c.gradeId,
  grade: c.grade.label,
  streamId: c.streamId ?? undefined,
  stream: c.stream?.name ?? undefined,
  section: c.section,
  label: `${c.grade.label}-${c.section}`,
  classTeacherId: c.classTeacherId ?? undefined,
  capacity: c.capacity ?? undefined,
})

export function list(ctx: Ctx) {
  return prisma.class.findMany({
    where: { schoolId: ctx.schoolId },
    include: classInclude,
    orderBy: [{ createdAt: 'asc' }, { grade: { order: 'asc' } }, { section: 'asc' }],
  })
}

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.class.findFirst({ where: { id, schoolId: ctx.schoolId }, include: classInclude })
  if (!row) throw notFound('Class')
  return row
}

// Validates that a teacher id belongs to a `teacher` in this school (or is null to clear).
export async function assertTeacher(ctx: Ctx, teacherId: string | null | undefined) {
  if (!teacherId) return
  const t = await prisma.user.findFirst({ where: { id: teacherId, schoolId: ctx.schoolId } })
  if (!t) throw notFound('Teacher')
  if (t.role !== 'teacher') throw new HttpError(400, 'teacherId must reference a user with role teacher')
}

async function assertRefs(ctx: Ctx, input: { academicYearId?: string; boardId?: string; gradeId?: string; streamId?: string | null }) {
  const { schoolId } = ctx
  if (input.academicYearId && !(await prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId } }))) throw notFound('Academic year')
  if (input.boardId && !(await prisma.board.findFirst({ where: { id: input.boardId, schoolId } }))) throw notFound('Board')
  if (input.gradeId && !(await prisma.grade.findFirst({ where: { id: input.gradeId, schoolId } }))) throw notFound('Grade')
  if (input.streamId && !(await prisma.stream.findFirst({ where: { id: input.streamId, schoolId } }))) throw notFound('Stream')
}

// 409 with a readable message instead of the generic P2002 mapping.
async function assertUnique(ctx: Ctx, key: { academicYearId: string; boardId: string; gradeId: string; section: string }, exceptId?: string) {
  const dup = await prisma.class.findFirst({
    where: { schoolId: ctx.schoolId, ...key, ...(exceptId ? { id: { not: exceptId } } : {}) },
    include: classInclude,
  })
  if (dup) throw new HttpError(409, `Class ${dup.grade.label}-${dup.section} already exists for ${dup.board.code} in this academic year`, { classId: dup.id })
}

// Copies the class's curriculum (board + grade, rows with its stream or no stream) into ClassSubject.
// Adds missing rows only — never deletes or reassigns existing ones. Returns the number added.
export async function applyCurriculum(cls: ClassWithRefs): Promise<number> {
  const rows = await prisma.curriculumSubject.findMany({
    where: {
      schoolId: cls.schoolId,
      boardId: cls.boardId,
      gradeId: cls.gradeId,
      OR: [{ streamId: null }, ...(cls.streamId ? [{ streamId: cls.streamId }] : [])],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const existing = new Set((await prisma.classSubject.findMany({ where: { classId: cls.id }, select: { subjectId: true } })).map(r => r.subjectId))
  const missing = [...new Set(rows.map(r => r.subjectId))].filter(id => !existing.has(id))
  // Sequential so createdAt keeps curriculum order (matches how the rest of the lists are ordered).
  for (const subjectId of missing) {
    await prisma.classSubject.create({ data: { schoolId: cls.schoolId, classId: cls.id, subjectId, teacherId: null, periodsPerWeek: 5 } })
  }
  return missing.length
}

export async function create(ctx: Ctx, input: z.infer<typeof createClass>) {
  await assertRefs(ctx, input)
  await assertTeacher(ctx, input.classTeacherId)
  await assertUnique(ctx, { academicYearId: input.academicYearId, boardId: input.boardId, gradeId: input.gradeId, section: input.section })
  const row = await prisma.class.create({
    data: {
      schoolId: ctx.schoolId,
      academicYearId: input.academicYearId,
      boardId: input.boardId,
      gradeId: input.gradeId,
      streamId: input.streamId ?? null,
      section: input.section,
      classTeacherId: input.classTeacherId ?? null,
      capacity: input.capacity ?? null,
    },
    include: classInclude,
  })
  await applyCurriculum(row)
  if (row.classTeacherId) await syncLegacyUserFields([row.classTeacherId])
  await audit(ctx.schoolId, ctx.actorId, 'create', 'class', row.id, undefined, serializeClass(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchClass>) {
  const before = await get(ctx, id)
  await assertRefs(ctx, input)
  if ('classTeacherId' in input) await assertTeacher(ctx, input.classTeacherId)
  await assertUnique(ctx, {
    academicYearId: input.academicYearId ?? before.academicYearId,
    boardId: input.boardId ?? before.boardId,
    gradeId: input.gradeId ?? before.gradeId,
    section: input.section ?? before.section,
  }, id)
  const affected = await usersTouchingClasses([id])
  const row = await prisma.class.update({
    where: { id },
    data: {
      academicYearId: input.academicYearId,
      boardId: input.boardId,
      gradeId: input.gradeId,
      streamId: input.streamId,
      section: input.section,
      classTeacherId: input.classTeacherId,
      capacity: input.capacity,
    },
    include: classInclude,
  })
  await syncLegacyUserFields([...affected, row.classTeacherId ?? ''])
  await audit(ctx.schoolId, ctx.actorId, 'update', 'class', id, serializeClass(before), serializeClass(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  const affected = await usersTouchingClasses([id])
  await prisma.class.delete({ where: { id } })
  await syncLegacyUserFields(affected)
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'class', id, serializeClass(before))
}

// POST /classes/:id/sync-curriculum
export async function syncCurriculum(ctx: Ctx, id: string) {
  const row = await get(ctx, id)
  const added = await applyCurriculum(row)
  await audit(ctx.schoolId, ctx.actorId, 'sync-curriculum', 'class', id, undefined, { added })
  return { item: row, added }
}

export async function roster(ctx: Ctx, id: string) {
  await get(ctx, id)
  const rows = await prisma.enrollment.findMany({
    where: { classId: id, status: 'active' },
    include: { student: true },
    orderBy: [{ rollNo: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map(e => ({ user: toClientUser(e.student), enrollment: serializeEnrollment(e) }))
}
