import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { getTerm } from './service'
import { commitDraftEntries } from './autogen'
import type { createElectiveBlockBody, electiveChoiceBody } from './schema'

// ───────────────────────── Phase T6 §1b — ElectiveBlock ─────────────────────────
// See phase-t6-sessions-jobs.md §1. A grade-wide reserved slot where N parallel elective offerings run
// simultaneously so students can choose between them without a clash. NOT a SharedSession (which merges
// cohorts into one session) — the inverse: one slot, multiple parallel sessions, students individually
// bucketed by choice. Each offering gets its own ELECTIVE-type Cohort (student-level membership via
// CohortMembership, populated from ElectiveChoice below — the same Activity/registration→CohortMembership
// shape T3's track pipeline uses, reused here for the elective-choice case) + TeachingRequirement +
// TeachingAssignment (FIXED, named teacher) + TimetableSession locked to the block's exact day/period.

const sessionDurationOfDuration = (n: number) => (n >= 3 ? 'TRIPLE' : n === 2 ? 'DOUBLE' : 'SINGLE')

export const serializeOffering = (o: {
  id: string; electiveBlockId: string; teachingRequirementId: string; sessionId: string | null; capacity: number | null
  teachingRequirement?: { subjectId: string; cohortId: string }
  choices?: { studentId: string; status: string }[]
}) => ({
  id: o.id,
  electiveBlockId: o.electiveBlockId,
  teachingRequirementId: o.teachingRequirementId,
  subjectId: o.teachingRequirement?.subjectId,
  cohortId: o.teachingRequirement?.cohortId,
  sessionId: o.sessionId ?? undefined,
  capacity: o.capacity ?? undefined,
  registered: (o.choices ?? []).filter(c => c.status === 'Registered').length,
  choices: (o.choices ?? []).map(c => ({ studentId: c.studentId, status: c.status })),
})

export const serializeBlock = (b: {
  id: string; schoolId: string; termId: string; gradeId: string; name: string
  dayOfWeek: number; periodIdx: number; durationPeriods: number; createdAt: Date
  offerings?: Parameters<typeof serializeOffering>[0][]
}) => ({
  id: b.id, schoolId: b.schoolId, termId: b.termId, gradeId: b.gradeId, name: b.name,
  dayOfWeek: b.dayOfWeek, periodIdx: b.periodIdx, durationPeriods: b.durationPeriods,
  createdAt: b.createdAt.toISOString(),
  offerings: (b.offerings ?? []).map(serializeOffering),
})

const blockInclude = { offerings: { include: { teachingRequirement: true, choices: true } } } as const

export function listBlocks(ctx: Ctx, filter?: { termId?: string; gradeId?: string }) {
  return prisma.electiveBlock.findMany({
    where: { schoolId: ctx.schoolId, termId: filter?.termId, gradeId: filter?.gradeId },
    include: blockInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

export async function getBlock(ctx: Ctx, id: string) {
  const row = await prisma.electiveBlock.findFirst({ where: { id, schoolId: ctx.schoolId }, include: blockInclude })
  if (!row) throw notFound('Elective block')
  return row
}

export async function createElectiveBlock(ctx: Ctx, input: z.infer<typeof createElectiveBlockBody>) {
  const term = await getTerm(ctx, input.termId)
  const grade = await prisma.grade.findFirst({ where: { id: input.gradeId, schoolId: ctx.schoolId } })
  if (!grade) throw notFound('Grade')

  const subjectIds = input.offerings.map(o => o.subjectId)
  const subjects = await prisma.subject.findMany({ where: { id: { in: subjectIds }, schoolId: ctx.schoolId } })
  if (subjects.length !== new Set(subjectIds).size) throw notFound('Subject')
  const teacherIds = [...new Set(input.offerings.map(o => o.teacherId))]
  const teachers = await prisma.user.findMany({ where: { id: { in: teacherIds }, schoolId: ctx.schoolId, role: 'teacher' } })
  if (teachers.length !== teacherIds.length) throw notFound('Teacher')
  // A teacher can't run two parallel offerings in the same block — same hard conflict the generic conflict
  // engine would catch at commit time anyway, but worth failing fast/clearly here at declaration time.
  const dup = input.offerings.map(o => o.teacherId).find((t, i, arr) => arr.indexOf(t) !== i)
  if (dup) throw new HttpError(400, 'The same teacher cannot run two parallel offerings in one elective block')

  const periods = Array.from({ length: input.durationPeriods }, (_, i) => input.periodIdx + i)
  for (const o of input.offerings) {
    const busy = await prisma.timetableEntry.findFirst({ where: { schoolId: ctx.schoolId, termId: term.id, dayOfWeek: input.dayOfWeek, periodIdx: { in: periods }, teacherId: o.teacherId } })
    if (busy) throw new HttpError(409, `A teacher assigned to this block is already booked at day ${input.dayOfWeek} period ${busy.periodIdx}`, undefined, { conflicts: [{ rule: 'teacher', entryId: busy.id, classId: busy.classId, dayOfWeek: busy.dayOfWeek, periodIdx: busy.periodIdx, teacherId: o.teacherId }] })
    if (o.roomId) {
      const roomBusy = await prisma.timetableEntry.findFirst({ where: { schoolId: ctx.schoolId, termId: term.id, dayOfWeek: input.dayOfWeek, periodIdx: { in: periods }, roomId: o.roomId } })
      if (roomBusy) throw new HttpError(409, `A room assigned to this block is already booked at day ${input.dayOfWeek} period ${roomBusy.periodIdx}`, undefined, { conflicts: [{ rule: 'room', entryId: roomBusy.id, classId: roomBusy.classId, dayOfWeek: roomBusy.dayOfWeek, periodIdx: roomBusy.periodIdx, roomId: o.roomId }] })
    }
  }

  const block = await prisma.$transaction(async tx => {
    const row = await tx.electiveBlock.create({
      data: { schoolId: ctx.schoolId, termId: term.id, gradeId: input.gradeId, name: input.name, dayOfWeek: input.dayOfWeek, periodIdx: input.periodIdx, durationPeriods: input.durationPeriods, createdById: ctx.actorId },
    })

    for (const o of input.offerings) {
      const subject = subjects.find(s => s.id === o.subjectId)!
      const cohort = await tx.cohort.create({
        data: { schoolId: ctx.schoolId, academicYearId: term.academicYearId, name: `${input.name}: ${subject.name}`, gradeId: input.gradeId, type: 'ELECTIVE', autoGenerated: false },
      })
      const requirement = await tx.teachingRequirement.create({
        data: {
          schoolId: ctx.schoolId, cohortId: cohort.id, subjectId: o.subjectId,
          requiredPeriodsPerWeek: input.durationPeriods, sessionDuration: sessionDurationOfDuration(input.durationPeriods),
          roomRequirement: o.roomId ? 'SPECIFIC_ROOM' : 'ANY', specificRoomId: o.roomId ?? null, labDoubleAllowed: false,
        },
      })
      const assignment = await tx.teachingAssignment.create({
        data: { schoolId: ctx.schoolId, teachingRequirementId: requirement.id, teacherId: o.teacherId, assignmentMode: 'FIXED', selectionReason: `Elective offering — ${input.name}`, createdBy: ctx.actorId },
      })
      const session = await tx.timetableSession.create({
        data: {
          schoolId: ctx.schoolId, termId: term.id, subjectId: o.subjectId, teachingAssignmentId: assignment.id,
          teacherId: o.teacherId, roomId: o.roomId ?? null, sessionType: 'ACTIVITY', durationPeriods: input.durationPeriods,
          isSplittable: false, createdById: ctx.actorId,
        },
      })
      await tx.timetableSessionEntry.createMany({ data: periods.map(p => ({ sessionId: session.id, dayOfWeek: input.dayOfWeek, periodIdx: p })) })
      await tx.sessionCohort.create({ data: { sessionId: session.id, cohortId: cohort.id } })
      await tx.sessionRequirement.create({ data: { sessionId: session.id, teachingRequirementId: requirement.id } })
      await tx.electiveOffering.create({ data: { electiveBlockId: row.id, teachingRequirementId: requirement.id, sessionId: session.id, capacity: o.capacity ?? null } })
    }
    return row
  })

  await audit(ctx.schoolId, ctx.actorId, 'create', 'electiveBlock', block.id, undefined, { gradeId: input.gradeId, offerings: input.offerings.length, dayOfWeek: input.dayOfWeek, periodIdx: input.periodIdx })
  return getBlock(ctx, block.id)
}

// POST /elective-blocks/:id/choices — a student picks one offering. Mirrors T3's Activity/registration
// pattern: a confirmed choice writes both an ElectiveChoice row (the registration itself) AND a
// CohortMembership row (the offering's own ELECTIVE cohort — resolved through the offering's
// TeachingRequirement), so the offering's cohort membership is real and queryable, not implied.
export async function chooseElective(ctx: Ctx, blockId: string, input: z.infer<typeof electiveChoiceBody>) {
  const block = await getBlock(ctx, blockId)
  const offering = block.offerings.find(o => o.id === input.offeringId)
  if (!offering) throw notFound('Elective offering')
  const student = await prisma.user.findFirst({ where: { id: input.studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')

  // A student may only be registered for one offering per block (they physically can't be in two rooms at
  // once during the same slot) — enforce it as a real, explicit rule rather than leaving it implicit.
  const already = await prisma.electiveChoice.findFirst({ where: { electiveOffering: { electiveBlockId: blockId }, studentId: input.studentId, status: 'Registered' } })
  if (already && already.electiveOfferingId !== input.offeringId) throw new HttpError(409, 'This student is already registered for a different offering in this block', { electiveOfferingId: already.electiveOfferingId })

  const registeredCount = offering.choices.filter(c => c.status === 'Registered').length
  const status = offering.capacity && registeredCount >= offering.capacity ? 'Waitlisted' : 'Registered'

  const choice = await prisma.$transaction(async tx => {
    const row = await tx.electiveChoice.upsert({
      where: { electiveOfferingId_studentId: { electiveOfferingId: input.offeringId, studentId: input.studentId } },
      create: { electiveOfferingId: input.offeringId, studentId: input.studentId, status },
      update: { status },
    })
    if (status === 'Registered') {
      const req = await tx.teachingRequirement.findUnique({ where: { id: offering.teachingRequirementId } })
      if (req) {
        await tx.cohortMembership.upsert({
          where: { cohortId_studentId: { cohortId: req.cohortId, studentId: input.studentId } },
          create: { schoolId: ctx.schoolId, cohortId: req.cohortId, studentId: input.studentId },
          update: {},
        })
      }
    }
    return row
  })

  await audit(ctx.schoolId, ctx.actorId, 'choose', 'electiveChoice', choice.id, undefined, { blockId, offeringId: input.offeringId, studentId: input.studentId, status })
  return { id: choice.id, offeringId: input.offeringId, studentId: input.studentId, status }
}

// POST /elective-blocks/:id/commit — materializes the block. Each individual offering's session is real
// (its own teacher/room/period, queryable via GET /sessions), but TimetableEntry is per-(class, day, period)
// — a single class can't hold N simultaneous subject rows for N parallel offerings its students scattered
// across. So the block materializes ONE generic placeholder TimetableEntry per base class of the grade (a
// find-or-create "Elective Block" Subject/ClassSubject, teacherId/roomId left null — the row just marks the
// slot as reserved for every existing TimetableEntry consumer), while the authoritative per-offering/
// per-student schedule stays in TimetableSession/ElectiveOffering/ElectiveChoice, queryable via
// GET /elective-blocks/:id. Documented scope decision — see this phase's final report.
export async function commitElectiveBlock(ctx: Ctx, id: string, mode: 'fill-empty' | 'full-regenerate') {
  const block = await getBlock(ctx, id)
  const term = await getTerm(ctx, block.termId)
  const classes = await prisma.class.findMany({ where: { schoolId: ctx.schoolId, gradeId: block.gradeId, academicYearId: term.academicYearId } })
  if (!classes.length) throw new HttpError(400, 'No classes found in this grade for this term\'s academic year')

  let placeholderSubject = await prisma.subject.findFirst({ where: { schoolId: ctx.schoolId, code: 'ELECTIVE_BLOCK' } })
  if (!placeholderSubject) {
    placeholderSubject = await prisma.subject.create({ data: { schoolId: ctx.schoolId, name: 'Elective Block', code: 'ELECTIVE_BLOCK', color: '#8b5cf6' } })
  }

  const draft: { classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId: null; teacherId: null }[] = []
  for (const cls of classes) {
    let cs = await prisma.classSubject.findUnique({ where: { classId_subjectId: { classId: cls.id, subjectId: placeholderSubject.id } } })
    if (!cs) cs = await prisma.classSubject.create({ data: { schoolId: ctx.schoolId, classId: cls.id, subjectId: placeholderSubject.id, teacherId: null, periodsPerWeek: block.durationPeriods } })
    for (let i = 0; i < block.durationPeriods; i++) {
      draft.push({ classId: cls.id, dayOfWeek: block.dayOfWeek, periodIdx: block.periodIdx + i, classSubjectId: cs.id, roomId: null, teacherId: null })
    }
  }

  const result = await commitDraftEntries(ctx, term, mode, draft)
  await prisma.timetableSession.updateMany({ where: { electiveOffering: { electiveBlockId: id } }, data: { committedAt: new Date() } })
  return result
}
