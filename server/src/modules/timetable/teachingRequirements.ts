import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { needsLab } from './autogen'
import type {
  createTeachingRequirement, patchTeachingRequirement, seedTeachingRequirementsBody, createTeachingAssignment,
} from './schema'

// ───────────────────────── Phase T4 §1 — TeachingRequirement ─────────────────────────
// A cohort's declared weekly teaching need per subject. See phase-t4-solver-core.md §1: the common case
// (a cohort = one auto-generated 1:1 section cohort) is functionally equivalent to today's implicit
// "ClassSubject needs N periods/week" — seedFromClassSubjects below migrates that existing data in.

export const serializeRequirement = (r: {
  id: string; schoolId: string; cohortId: string; subjectId: string; requiredPeriodsPerWeek: number
  sessionDuration: string; roomRequirement: string; specificRoomId: string | null; labDoubleAllowed: boolean
  assignmentMode?: string
}) => ({
  id: r.id,
  schoolId: r.schoolId,
  cohortId: r.cohortId,
  subjectId: r.subjectId,
  requiredPeriodsPerWeek: r.requiredPeriodsPerWeek,
  sessionDuration: r.sessionDuration,
  roomRequirement: r.roomRequirement,
  specificRoomId: r.specificRoomId ?? undefined,
  labDoubleAllowed: r.labDoubleAllowed,
  // Phase T5 §1 — which assignment mode resolves this requirement's teacher (defaults FIXED).
  assignmentMode: r.assignmentMode ?? 'FIXED',
})

export function list(ctx: Ctx, filter?: { cohortId?: string }) {
  return prisma.teachingRequirement.findMany({
    where: { schoolId: ctx.schoolId, cohortId: filter?.cohortId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.teachingRequirement.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Teaching requirement')
  return row
}

async function assertCohortAndSubject(ctx: Ctx, cohortId: string, subjectId: string, specificRoomId?: string | null) {
  if (!(await prisma.cohort.findFirst({ where: { id: cohortId, schoolId: ctx.schoolId } }))) throw notFound('Cohort')
  if (!(await prisma.subject.findFirst({ where: { id: subjectId, schoolId: ctx.schoolId } }))) throw notFound('Subject')
  if (specificRoomId && !(await prisma.room.findFirst({ where: { id: specificRoomId, schoolId: ctx.schoolId } }))) throw notFound('Room')
}

export async function create(ctx: Ctx, input: z.infer<typeof createTeachingRequirement>) {
  await assertCohortAndSubject(ctx, input.cohortId, input.subjectId, input.specificRoomId)
  const dup = await prisma.teachingRequirement.findFirst({ where: { cohortId: input.cohortId, subjectId: input.subjectId } })
  if (dup) throw new HttpError(409, 'A teaching requirement for this cohort and subject already exists', { requirementId: dup.id })
  const row = await prisma.teachingRequirement.create({
    data: {
      schoolId: ctx.schoolId,
      cohortId: input.cohortId,
      subjectId: input.subjectId,
      requiredPeriodsPerWeek: input.requiredPeriodsPerWeek,
      sessionDuration: input.sessionDuration,
      roomRequirement: input.roomRequirement,
      specificRoomId: input.specificRoomId ?? null,
      labDoubleAllowed: input.labDoubleAllowed,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'teachingRequirement', row.id, undefined, serializeRequirement(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchTeachingRequirement>) {
  const before = await get(ctx, id)
  const roomRequirement = input.roomRequirement ?? before.roomRequirement
  const specificRoomId = input.specificRoomId !== undefined ? input.specificRoomId : before.specificRoomId
  if (roomRequirement === 'SPECIFIC_ROOM' && !specificRoomId) {
    throw new HttpError(400, 'specificRoomId is required when roomRequirement is SPECIFIC_ROOM')
  }
  if (input.specificRoomId && !(await prisma.room.findFirst({ where: { id: input.specificRoomId, schoolId: ctx.schoolId } }))) throw notFound('Room')
  const row = await prisma.teachingRequirement.update({
    where: { id },
    data: {
      requiredPeriodsPerWeek: input.requiredPeriodsPerWeek,
      sessionDuration: input.sessionDuration,
      roomRequirement: input.roomRequirement,
      specificRoomId: input.specificRoomId !== undefined ? input.specificRoomId : undefined,
      labDoubleAllowed: input.labDoubleAllowed,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'teachingRequirement', id, serializeRequirement(before), serializeRequirement(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.teachingRequirement.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'teachingRequirement', id, serializeRequirement(before))
}

// Migrates existing ClassSubject.periodsPerWeek data into TeachingRequirement rows rather than asking a
// school to re-enter it (phase-t4-solver-core.md §1). Idempotent: skips (cohort, subject) pairs that
// already have a TeachingRequirement. Scoped to SECTION cohorts (the auto-generated 1:1 cohort per class,
// per roadmap D2) since that is exactly the population ClassSubject already describes; a school-defined
// cross-section cohort has no direct ClassSubject equivalent and is configured by hand instead.
export async function seedFromClassSubjects(ctx: Ctx, input: z.infer<typeof seedTeachingRequirementsBody>) {
  if (!(await prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId: ctx.schoolId } }))) throw notFound('Academic year')

  const cohorts = await prisma.cohort.findMany({
    where: {
      schoolId: ctx.schoolId,
      academicYearId: input.academicYearId,
      type: 'SECTION',
      ...(input.cohortId ? { id: input.cohortId } : {}),
    },
    include: { members: true },
  })
  if (input.cohortId && !cohorts.length) throw notFound('Cohort')

  let created = 0
  const createdRequirements: string[] = []
  for (const cohort of cohorts) {
    const classIds = cohort.members.map(m => m.classId)
    if (!classIds.length) continue
    const classSubjects = await prisma.classSubject.findMany({
      where: { classId: { in: classIds } },
      include: { subject: true },
    })
    // A SECTION cohort has exactly one member class, so this is a straight per-subject mapping.
    const bySubject = new Map<string, (typeof classSubjects)[number]>()
    for (const cs of classSubjects) if (!bySubject.has(cs.subjectId)) bySubject.set(cs.subjectId, cs)

    for (const [subjectId, cs] of bySubject) {
      const exists = await prisma.teachingRequirement.findFirst({ where: { cohortId: cohort.id, subjectId } })
      if (exists) continue
      const wantsLab = needsLab(cs.subject.name, cs.subject.code)
      const row = await prisma.teachingRequirement.create({
        data: {
          schoolId: ctx.schoolId,
          cohortId: cohort.id,
          subjectId,
          requiredPeriodsPerWeek: cs.periodsPerWeek,
          sessionDuration: wantsLab ? 'DOUBLE' : 'SINGLE',
          roomRequirement: wantsLab ? 'LAB_TYPE' : 'ANY',
          labDoubleAllowed: true,
        },
      })
      created++
      createdRequirements.push(row.id)
      // Seed the Fixed assignment too when the ClassSubject already names a teacher — matches what the
      // school already had configured (phase-t4-solver-core.md's live-verification requirement).
      if (cs.teacherId) {
        await prisma.teachingAssignment.create({
          data: {
            schoolId: ctx.schoolId,
            teachingRequirementId: row.id,
            teacherId: cs.teacherId,
            assignmentMode: 'FIXED',
            selectionReason: 'Seeded from existing ClassSubject assignment',
            createdBy: ctx.actorId,
          },
        })
      }
    }
  }

  await audit(ctx.schoolId, ctx.actorId, 'seed-from-class-subjects', 'teachingRequirement', input.academicYearId, undefined, {
    academicYearId: input.academicYearId, cohortId: input.cohortId, created,
  })
  return { created, requirementIds: createdRequirements }
}

// ───────────────────────── Phase T4 §2 — TeachingAssignment (Mode 1 Fixed only) ─────────────────────────

export const serializeAssignment = (a: {
  id: string; schoolId: string; teachingRequirementId: string; teacherId: string
  assignmentMode: string; selectionReason: string | null; createdAt: Date; createdBy: string
}) => ({
  id: a.id,
  schoolId: a.schoolId,
  teachingRequirementId: a.teachingRequirementId,
  teacherId: a.teacherId,
  assignmentMode: a.assignmentMode,
  selectionReason: a.selectionReason ?? undefined,
  createdAt: a.createdAt.toISOString(),
  createdBy: a.createdBy,
})

export function listAssignments(ctx: Ctx, filter?: { teachingRequirementId?: string }) {
  return prisma.teachingAssignment.findMany({
    where: { schoolId: ctx.schoolId, teachingRequirementId: filter?.teachingRequirementId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

export async function createAssignment(ctx: Ctx, input: z.infer<typeof createTeachingAssignment>) {
  const requirement = await prisma.teachingRequirement.findFirst({ where: { id: input.teachingRequirementId, schoolId: ctx.schoolId } })
  if (!requirement) throw notFound('Teaching requirement')
  const teacher = await prisma.user.findFirst({ where: { id: input.teacherId, schoolId: ctx.schoolId, role: 'teacher' } })
  if (!teacher) throw notFound('Teacher')
  const existing = await prisma.teachingAssignment.findUnique({ where: { teachingRequirementId: input.teachingRequirementId } })
  if (existing) {
    throw new HttpError(409, 'This requirement already has a Fixed assignment — delete it first to reassign (Pool mode arrives in a later phase)', { assignmentId: existing.id })
  }
  const row = await prisma.teachingAssignment.create({
    data: {
      schoolId: ctx.schoolId,
      teachingRequirementId: input.teachingRequirementId,
      teacherId: input.teacherId,
      assignmentMode: 'FIXED',
      selectionReason: input.selectionReason ?? null,
      createdBy: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'teachingAssignment', row.id, undefined, serializeAssignment(row))
  return row
}

export async function removeAssignment(ctx: Ctx, id: string) {
  const before = await prisma.teachingAssignment.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Teaching assignment')
  await prisma.teachingAssignment.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'teachingAssignment', id, serializeAssignment(before))
}
