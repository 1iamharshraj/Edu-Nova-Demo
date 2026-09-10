import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { getTerm } from './service'
import { commitDraftEntries } from './autogen'
import type { createSharedSessionBody, commitSessionsBody } from './schema'

// ───────────────────────── Phase T6 §1 — TimetableSession / SharedSession ─────────────────────────
// See phase-t6-sessions-jobs.md §1. A SharedSession is a TimetableSession with 2+ SessionCohort rows: it
// satisfies EVERY linked cohort's own TeachingRequirement for that slot in ONE session, not two independent
// sessions that happen to share a slot. Materialization (materializeSession, below) writes one TimetableEntry
// per underlying Class every linked cohort touches, all tagged with this session's id — which is what lets
// the EXISTING conflict engine (service.ts#validateGrid) recognize the shared rows as non-colliding (see
// that file's `sameSession` check) while still catching a genuine double-booking elsewhere.

export const serializeSession = (s: {
  id: string; schoolId: string; termId: string; subjectId: string; teachingAssignmentId: string | null
  teacherId: string | null; roomId: string | null; sessionType: string; durationPeriods: number
  isSplittable: boolean; jobId: string | null; committedAt: Date | null; createdAt: Date
  entries?: { dayOfWeek: number; periodIdx: number }[]
  cohorts?: { cohortId: string }[]
  requirements?: { teachingRequirementId: string }[]
}) => ({
  id: s.id,
  schoolId: s.schoolId,
  termId: s.termId,
  subjectId: s.subjectId,
  teachingAssignmentId: s.teachingAssignmentId ?? undefined,
  teacherId: s.teacherId ?? undefined,
  roomId: s.roomId ?? undefined,
  sessionType: s.sessionType,
  durationPeriods: s.durationPeriods,
  isSplittable: s.isSplittable,
  jobId: s.jobId ?? undefined,
  committed: !!s.committedAt,
  committedAt: s.committedAt?.toISOString(),
  createdAt: s.createdAt.toISOString(),
  entries: (s.entries ?? []).map(e => ({ dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx })),
  cohortIds: (s.cohorts ?? []).map(c => c.cohortId),
  requirementIds: (s.requirements ?? []).map(r => r.teachingRequirementId),
  isShared: (s.cohorts ?? []).length > 1,
})

const sessionInclude = { entries: true, cohorts: true, requirements: true } as const

export function listSessions(ctx: Ctx, filter?: { termId?: string; cohortId?: string }) {
  return prisma.timetableSession.findMany({
    where: { schoolId: ctx.schoolId, termId: filter?.termId, cohorts: filter?.cohortId ? { some: { cohortId: filter.cohortId } } : undefined },
    include: sessionInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

export async function getSession(ctx: Ctx, id: string) {
  const row = await prisma.timetableSession.findFirst({ where: { id, schoolId: ctx.schoolId }, include: sessionInclude })
  if (!row) throw notFound('Timetable session')
  return row
}

// Contiguous day-of-week periods starting at periodIdx, one TimetableSessionEntry per period.
function periodRun(periodIdx: number, durationPeriods: number): number[] {
  return Array.from({ length: durationPeriods }, (_, i) => periodIdx + i)
}

export async function createSharedSession(ctx: Ctx, input: z.infer<typeof createSharedSessionBody>) {
  const term = await getTerm(ctx, input.termId)

  const requirements = await prisma.teachingRequirement.findMany({
    where: { id: { in: input.requirementIds }, schoolId: ctx.schoolId },
    include: { cohort: true, subject: true, assignments: true },
  })
  if (requirements.length !== input.requirementIds.length) throw notFound('Teaching requirement')

  const cohortIds = new Set(requirements.map(r => r.cohortId))
  if (cohortIds.size !== requirements.length) throw new HttpError(400, 'Each requirement must belong to a distinct cohort — a SharedSession links 2+ different cohorts, not two requirements on the same one')
  const subjectIds = new Set(requirements.map(r => r.subjectId))
  if (subjectIds.size !== 1) throw new HttpError(400, 'All linked requirements must be for the same subject — a SharedSession materializes one subject into every underlying class')
  for (const c of requirements.map(r => r.cohort)) {
    if (c.academicYearId !== term.academicYearId) throw new HttpError(400, `Cohort "${c.name}" does not belong to this term's academic year`)
  }

  const teacherId = input.teacherId ?? requirements[0].assignments[0]?.teacherId ?? null
  if (!teacherId) throw new HttpError(400, 'No teacherId given and the first requirement has no Fixed assignment to infer one from')
  const teacher = await prisma.user.findFirst({ where: { id: teacherId, schoolId: ctx.schoolId, role: 'teacher' } })
  if (!teacher) throw notFound('Teacher')
  if (input.roomId && !(await prisma.room.findFirst({ where: { id: input.roomId, schoolId: ctx.schoolId } }))) throw notFound('Room')

  const periods = periodRun(input.periodIdx, input.durationPeriods)

  // Lightweight pre-check against already-COMMITTED entries (mirrors what a fresh draft generation would
  // see) — the authoritative check is still validateGrid at commit time (see commitSessions below); this
  // just gives an earlier, friendlier error for the common case of double-booking an obviously busy teacher/
  // room at declaration time, before any entries are written.
  const slotWhere = { schoolId: ctx.schoolId, termId: term.id, dayOfWeek: input.dayOfWeek, periodIdx: { in: periods } }
  if (teacherId) {
    const busy = await prisma.timetableEntry.findFirst({ where: { ...slotWhere, teacherId } })
    if (busy) throw new HttpError(409, `${teacher.name} is already booked at day ${input.dayOfWeek} period ${busy.periodIdx}`, undefined, { conflicts: [{ rule: 'teacher', entryId: busy.id, classId: busy.classId, dayOfWeek: busy.dayOfWeek, periodIdx: busy.periodIdx, teacherId }] })
  }
  if (input.roomId) {
    const busy = await prisma.timetableEntry.findFirst({ where: { ...slotWhere, roomId: input.roomId } })
    if (busy) throw new HttpError(409, `That room is already booked at day ${input.dayOfWeek} period ${busy.periodIdx}`, undefined, { conflicts: [{ rule: 'room', entryId: busy.id, classId: busy.classId, dayOfWeek: busy.dayOfWeek, periodIdx: busy.periodIdx, roomId: input.roomId }] })
  }

  const session = await prisma.$transaction(async tx => {
    const row = await tx.timetableSession.create({
      data: {
        schoolId: ctx.schoolId, termId: term.id, subjectId: requirements[0].subjectId,
        teachingAssignmentId: requirements[0].assignments[0]?.id ?? null,
        teacherId, roomId: input.roomId ?? null, sessionType: input.sessionType, durationPeriods: input.durationPeriods,
        isSplittable: false, createdById: ctx.actorId,
      },
    })
    await tx.timetableSessionEntry.createMany({ data: periods.map(p => ({ sessionId: row.id, dayOfWeek: input.dayOfWeek, periodIdx: p })) })
    await tx.sessionCohort.createMany({ data: [...cohortIds].map(cohortId => ({ sessionId: row.id, cohortId })) })
    await tx.sessionRequirement.createMany({ data: requirements.map(r => ({ sessionId: row.id, teachingRequirementId: r.id })) })
    return row
  })

  await audit(ctx.schoolId, ctx.actorId, 'create-shared-session', 'timetableSession', session.id, undefined, {
    cohortIds: [...cohortIds], subjectId: requirements[0].subjectId, teacherId, dayOfWeek: input.dayOfWeek, periodIdx: input.periodIdx, durationPeriods: input.durationPeriods,
  })
  return getSession(ctx, session.id)
}

// Resolves a session into the flat per-class draft-entry rows D3 requires: one TimetableEntry per
// underlying Class every linked cohort touches, all sharing this session's teacher/room/period, tagged with
// sessionId so validateGrid's collision check recognizes them as siblings, not a conflict.
export async function materializeSession(ctx: Ctx, sessionId: string) {
  const session = await prisma.timetableSession.findFirst({
    where: { id: sessionId, schoolId: ctx.schoolId },
    include: { entries: true, cohorts: { include: { cohort: { include: { members: true } } } } },
  })
  if (!session) throw notFound('Timetable session')
  if (!session.cohorts.length) throw new HttpError(400, 'Session has no linked cohort')

  const classIds = new Set<string>()
  for (const sc of session.cohorts) for (const m of sc.cohort.members) classIds.add(m.classId)
  if (!classIds.size) throw new HttpError(400, 'None of this session\'s linked cohorts have member classes (CohortClass) to materialize into')

  const draft: { classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId: string | null; teacherId: string | null; sessionId: string }[] = []
  for (const classId of classIds) {
    let cs = await prisma.classSubject.findUnique({ where: { classId_subjectId: { classId, subjectId: session.subjectId } } })
    if (!cs) {
      cs = await prisma.classSubject.create({
        data: { schoolId: ctx.schoolId, classId, subjectId: session.subjectId, teacherId: session.teacherId, periodsPerWeek: session.durationPeriods },
      })
    }
    for (const e of session.entries) {
      draft.push({ classId, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: cs.id, roomId: session.roomId, teacherId: session.teacherId, sessionId: session.id })
    }
  }
  return draft
}

// POST /sessions/commit — the formalized version of D3's materialization: reads the TimetableSession layer
// (instead of a caller-supplied flat draft) and writes via the EXACT SAME primitive T4's commit always used
// (autogen.ts#commitDraftEntries -> service.ts#replaceGrid/validateGrid) — same validation, same audit
// action, same full-regenerate stale-row pre-pass. The existing /auto-generate/commit endpoint is untouched.
export async function commitSessions(ctx: Ctx, input: z.infer<typeof commitSessionsBody>) {
  const term = await getTerm(ctx, input.termId)
  const allEntries: Awaited<ReturnType<typeof materializeSession>> = []
  for (const sessionId of input.sessionIds) allEntries.push(...await materializeSession(ctx, sessionId))
  const result = await commitDraftEntries(ctx, term, input.mode, allEntries)
  await prisma.timetableSession.updateMany({ where: { id: { in: input.sessionIds }, schoolId: ctx.schoolId }, data: { committedAt: new Date() } })
  return result
}

export async function removeSession(ctx: Ctx, id: string) {
  const row = await prisma.timetableSession.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Timetable session')
  if (row.committedAt) throw new HttpError(400, 'This session has already been committed — remove its TimetableEntry rows via the normal timetable editor instead')
  await prisma.timetableSession.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'timetableSession', id, undefined)
}
