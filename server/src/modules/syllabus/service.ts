import type { z } from 'zod'
import type { SyllabusChapter, ChapterProgress, TermSyllabusTarget, ChapterResource } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { isStaff, assertWriteClassSubject, assertViewClass, getClassSubject } from '../../lib/scope'
import type {
  createChapter, patchChapter, chaptersQuery,
  createChapterResource,
  patchProgress,
  createTarget, patchTarget, targetsQuery,
  paceQuery,
} from './schema'

// See phase-18-syllabus-tracking.md. Syllabus lives on CurriculumSubject; ChapterProgress is per
// ClassSubject so sections of the same board/grade/subject can diverge in pace.

export const serializeChapter = (c: SyllabusChapter) => ({
  id: c.id,
  curriculumSubjectId: c.curriculumSubjectId,
  order: c.order,
  title: c.title,
  estimatedPeriods: c.estimatedPeriods,
  examWeightagePct: c.examWeightagePct ?? undefined,
})

export const serializeProgress = (p: ChapterProgress) => ({
  id: p.id,
  classSubjectId: p.classSubjectId,
  chapterId: p.chapterId,
  status: p.status as 'NotStarted' | 'InProgress' | 'Done',
  startedAt: p.startedAt ? fmtDate(p.startedAt) : undefined,
  completedAt: p.completedAt ? fmtDate(p.completedAt) : undefined,
  notes: p.notes ?? undefined,
  updatedById: p.updatedById,
  updatedAt: p.updatedAt.toISOString(),
})

export const serializeTarget = (t: TermSyllabusTarget) => ({
  id: t.id,
  curriculumSubjectId: t.curriculumSubjectId,
  termId: t.termId,
  targetChapterId: t.targetChapterId,
  classId: t.classId ?? undefined,
})

export const serializeResource = (r: ChapterResource) => ({
  id: r.id,
  chapterId: r.chapterId,
  fileId: r.fileId,
  label: r.label,
  uploadedById: r.uploadedById,
  createdAt: r.createdAt.toISOString(),
})

async function getCurriculumSubject(ctx: Ctx, id: string) {
  const row = await prisma.curriculumSubject.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Curriculum subject')
  return row
}

async function getChapter(ctx: Ctx, id: string) {
  const row = await prisma.syllabusChapter.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Syllabus chapter')
  return row
}

// A teacher "teaches" a curriculum-subject if they hold a ClassSubject for that subject in any class
// matching the curriculum-subject's board/grade/stream, anywhere in the school. Used to gate the shared
// chapter-resource library (spec: "visible to every teacher who teaches that curriculum-subject anywhere
// in the school") — deliberately narrower than the class-subject-scoped write check reused below.
async function teachesCurriculumSubject(ctx: Ctx, curriculumSubjectId: string): Promise<boolean> {
  if (ctx.role !== 'teacher') return false
  const cs = await prisma.curriculumSubject.findFirst({ where: { id: curriculumSubjectId, schoolId: ctx.schoolId } })
  if (!cs) return false
  const hit = await prisma.classSubject.findFirst({
    where: {
      schoolId: ctx.schoolId,
      subjectId: cs.subjectId,
      teacherId: ctx.actorId,
      class: { boardId: cs.boardId, gradeId: cs.gradeId, streamId: cs.streamId },
    },
    select: { id: true },
  })
  return !!hit
}

// ═══════════════════════════ chapters ═══════════════════════════
// Write: staff/admin/superadmin (per phase-18 spec §Endpoints — chapters CRUD). Read: everyone authenticated.

export function listChapters(ctx: Ctx, filter: z.infer<typeof chaptersQuery> = {}) {
  return prisma.syllabusChapter.findMany({
    where: { schoolId: ctx.schoolId, curriculumSubjectId: filter.curriculumSubjectId },
    orderBy: [{ curriculumSubjectId: 'asc' }, { order: 'asc' }],
  })
}

export async function createChapterRow(ctx: Ctx, input: z.infer<typeof createChapter>) {
  await getCurriculumSubject(ctx, input.curriculumSubjectId)
  const dupe = await prisma.syllabusChapter.findFirst({ where: { curriculumSubjectId: input.curriculumSubjectId, order: input.order } })
  if (dupe) throw new HttpError(409, `Chapter order ${input.order} is already used in this curriculum subject`, { chapterId: dupe.id })
  const row = await prisma.syllabusChapter.create({
    data: {
      schoolId: ctx.schoolId,
      curriculumSubjectId: input.curriculumSubjectId,
      order: input.order,
      title: input.title,
      estimatedPeriods: input.estimatedPeriods,
      examWeightagePct: input.examWeightagePct ?? null,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'syllabusChapter', row.id, undefined, serializeChapter(row))
  return row
}

export async function updateChapterRow(ctx: Ctx, id: string, input: z.infer<typeof patchChapter>) {
  const before = await getChapter(ctx, id)
  if (input.order !== undefined && input.order !== before.order) {
    const dupe = await prisma.syllabusChapter.findFirst({ where: { curriculumSubjectId: before.curriculumSubjectId, order: input.order, id: { not: id } } })
    if (dupe) throw new HttpError(409, `Chapter order ${input.order} is already used in this curriculum subject`, { chapterId: dupe.id })
  }
  const row = await prisma.syllabusChapter.update({
    where: { id },
    data: { order: input.order, title: input.title, estimatedPeriods: input.estimatedPeriods, examWeightagePct: input.examWeightagePct },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'syllabusChapter', id, serializeChapter(before), serializeChapter(row))
  return row
}

export async function removeChapterRow(ctx: Ctx, id: string) {
  const before = await getChapter(ctx, id)
  await prisma.syllabusChapter.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'syllabusChapter', id, serializeChapter(before))
}

// ═══════════════════════════ chapter resources ═══════════════════════════
// Write: staff/admin/superadmin, plus a teacher who teaches the chapter's curriculum-subject anywhere in
// the school. Read: same set (this is a teacher tool, not a student-facing library).

async function assertResourceAccess(ctx: Ctx, curriculumSubjectId: string) {
  if (isStaff(ctx)) return
  if (await teachesCurriculumSubject(ctx, curriculumSubjectId)) return
  throw new HttpError(403, 'You do not teach this curriculum subject')
}

export async function listResources(ctx: Ctx, chapterId: string) {
  const chapter = await getChapter(ctx, chapterId)
  await assertResourceAccess(ctx, chapter.curriculumSubjectId)
  return prisma.chapterResource.findMany({ where: { chapterId }, orderBy: [{ createdAt: 'desc' }] })
}

export async function createResource(ctx: Ctx, input: z.infer<typeof createChapterResource>) {
  const chapter = await getChapter(ctx, input.chapterId)
  await assertResourceAccess(ctx, chapter.curriculumSubjectId)
  const file = await prisma.file.findFirst({ where: { id: input.fileId, schoolId: ctx.schoolId } })
  if (!file) throw notFound('File')
  const row = await prisma.chapterResource.create({
    data: { schoolId: ctx.schoolId, chapterId: input.chapterId, fileId: input.fileId, label: input.label, uploadedById: ctx.actorId },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'chapterResource', row.id, undefined, serializeResource(row))
  return row
}

export async function removeResource(ctx: Ctx, id: string) {
  const row = await prisma.chapterResource.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { chapter: true } })
  if (!row) throw notFound('Chapter resource')
  await assertResourceAccess(ctx, row.chapter.curriculumSubjectId)
  await prisma.chapterResource.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'chapterResource', id, serializeResource(row))
}

// ═══════════════════════════ progress ═══════════════════════════
// GET: anyone with class visibility (staff/admin/superadmin, the assigned teacher, or a student/parent
// enrolled in the class). PATCH: reuses assertWriteClassSubject verbatim — see phase-18 spec + Phase 10
// audit fix (server/src/lib/scope.ts) — the exact bug class this must not reintroduce.

async function assertViewClassSubject(ctx: Ctx, classSubjectId: string) {
  const cs = await getClassSubject(ctx, classSubjectId)
  await assertViewClass(ctx, cs.classId)
  return cs
}

// Chapters of the class-subject's curriculum-subject, joined with any existing progress row (untouched
// chapters read as NotStarted with no row).
export async function getProgress(ctx: Ctx, classSubjectId: string) {
  const cs = await assertViewClassSubject(ctx, classSubjectId)
  const curriculumSubject = await prisma.curriculumSubject.findFirst({
    where: { schoolId: ctx.schoolId, boardId: cs.class.boardId, gradeId: cs.class.gradeId, streamId: cs.class.streamId, subjectId: cs.subjectId },
  })
  if (!curriculumSubject) return []
  const [chapters, progress] = await Promise.all([
    prisma.syllabusChapter.findMany({ where: { curriculumSubjectId: curriculumSubject.id }, orderBy: { order: 'asc' } }),
    prisma.chapterProgress.findMany({ where: { classSubjectId } }),
  ])
  const byChapter = new Map(progress.map(p => [p.chapterId, p]))
  return chapters.map(ch => {
    const p = byChapter.get(ch.id)
    return {
      chapter: serializeChapter(ch),
      progress: p ? serializeProgress(p) : { classSubjectId, chapterId: ch.id, status: 'NotStarted' as const, updatedById: undefined, updatedAt: undefined },
    }
  })
}

export async function patchProgressRow(ctx: Ctx, classSubjectId: string, chapterId: string, input: z.infer<typeof patchProgress>) {
  await assertWriteClassSubject(ctx, classSubjectId)
  const chapter = await getChapter(ctx, chapterId)
  const before = await prisma.chapterProgress.findUnique({ where: { classSubjectId_chapterId: { classSubjectId, chapterId } } })

  const data: { status?: string; notes?: string | null; startedAt?: Date | null; completedAt?: Date | null; updatedById: string } = { updatedById: ctx.actorId }
  if (input.status !== undefined) data.status = input.status
  if (input.notes !== undefined) data.notes = input.notes
  if (input.startedAt !== undefined) data.startedAt = input.startedAt ? toDate(input.startedAt) : null
  if (input.completedAt !== undefined) data.completedAt = input.completedAt ? toDate(input.completedAt) : null
  // Sensible defaults when only `status` is flipped and the caller didn't set the date explicitly.
  if (input.status === 'InProgress' && input.startedAt === undefined && !before?.startedAt) data.startedAt = new Date()
  if (input.status === 'Done' && input.completedAt === undefined && !before?.completedAt) data.completedAt = new Date()

  const row = await prisma.chapterProgress.upsert({
    where: { classSubjectId_chapterId: { classSubjectId, chapterId } },
    create: { schoolId: ctx.schoolId, classSubjectId, chapterId: chapter.id, status: data.status ?? 'NotStarted', notes: data.notes, startedAt: data.startedAt, completedAt: data.completedAt, updatedById: ctx.actorId },
    update: data,
  })
  await audit(ctx.schoolId, ctx.actorId, before ? 'update' : 'create', 'chapterProgress', row.id, before ? serializeProgress(before) : undefined, serializeProgress(row))
  return row
}

// ═══════════════════════════ term targets ═══════════════════════════
// staff/admin/superadmin only, per spec.

export function listTargets(ctx: Ctx, filter: z.infer<typeof targetsQuery> = {}) {
  return prisma.termSyllabusTarget.findMany({
    where: { schoolId: ctx.schoolId, curriculumSubjectId: filter.curriculumSubjectId, termId: filter.termId, classId: filter.classId },
    orderBy: [{ createdAt: 'asc' }],
  })
}

export async function createTargetRow(ctx: Ctx, input: z.infer<typeof createTarget>) {
  await getCurriculumSubject(ctx, input.curriculumSubjectId)
  const term = await prisma.term.findFirst({ where: { id: input.termId, schoolId: ctx.schoolId } })
  if (!term) throw notFound('Term')
  const chapter = await prisma.syllabusChapter.findFirst({ where: { id: input.targetChapterId, schoolId: ctx.schoolId, curriculumSubjectId: input.curriculumSubjectId } })
  if (!chapter) throw new HttpError(400, 'targetChapterId must belong to this curriculum subject')
  const classId = input.classId ?? null
  if (classId) {
    const cls = await prisma.class.findFirst({ where: { id: classId, schoolId: ctx.schoolId } })
    if (!cls) throw notFound('Class')
  }
  const existing = await prisma.termSyllabusTarget.findFirst({ where: { schoolId: ctx.schoolId, curriculumSubjectId: input.curriculumSubjectId, termId: input.termId, classId } })
  if (existing) throw new HttpError(409, 'A target already exists for this curriculum subject / term / class', { targetId: existing.id })
  const row = await prisma.termSyllabusTarget.create({
    data: { schoolId: ctx.schoolId, curriculumSubjectId: input.curriculumSubjectId, termId: input.termId, targetChapterId: input.targetChapterId, classId },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'termSyllabusTarget', row.id, undefined, serializeTarget(row))
  return row
}

async function getTarget(ctx: Ctx, id: string) {
  const row = await prisma.termSyllabusTarget.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Term syllabus target')
  return row
}

export async function updateTargetRow(ctx: Ctx, id: string, input: z.infer<typeof patchTarget>) {
  const before = await getTarget(ctx, id)
  if (input.targetChapterId) {
    const chapter = await prisma.syllabusChapter.findFirst({ where: { id: input.targetChapterId, schoolId: ctx.schoolId, curriculumSubjectId: before.curriculumSubjectId } })
    if (!chapter) throw new HttpError(400, 'targetChapterId must belong to this curriculum subject')
  }
  const row = await prisma.termSyllabusTarget.update({ where: { id }, data: { targetChapterId: input.targetChapterId } })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'termSyllabusTarget', id, serializeTarget(before), serializeTarget(row))
  return row
}

export async function removeTargetRow(ctx: Ctx, id: string) {
  const before = await getTarget(ctx, id)
  await prisma.termSyllabusTarget.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'termSyllabusTarget', id, serializeTarget(before))
}

// ═══════════════════════════ expected pace ═══════════════════════════
// See phase-18-syllabus-tracking.md → Computed views → Expected pace / Lost-periods count.
//
// scheduledPeriodsSoFar: every TimetableEntry slot for this class-subject that recurred on the calendar
// between the term's startDate and `asOf` (inclusive), regardless of whether it was actually deliverable.
// lostPeriods: the subset of those that were NOT deliverable, split by cause:
//   - holiday: a CalendarEvent(type: 'holiday', audience School or this Class) lands on that date.
//   - teacherAbsence: the entry's teacher (entry.teacherId, falling back to the ClassSubject's teacherId)
//     has StaffAttendance.status 'A' or an Approved LeaveRequest covering that date, AND no Substitution
//     exists for that (timetableEntry, date) pair. A Substitution means someone else covered the period —
//     documented assumption (spec §3c): the schema has no "did this period actually run" flag on
//     Substitution, so every Substitution row is treated as a period that DID run (with a different
//     teacher), and only genuinely uncovered absences count as lost.
// deliverablePeriods = scheduledPeriodsSoFar - lostPeriods.total. Chapters' estimatedPeriods are walked in
// `order` to find how many periods "should" have been used up by now → the expected current chapter.

const DOW_JS_TO_SCHOOL: Record<number, number | null> = { 0: null, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 } // Sun has no periods

function addDays(d: Date, n: number) { return new Date(d.getTime() + n * 86_400_000) }

export async function computePace(ctx: Ctx, classSubjectId: string, input: z.infer<typeof paceQuery>) {
  const cs = await assertViewClassSubject(ctx, classSubjectId)

  const term = input.termId
    ? await prisma.term.findFirst({ where: { id: input.termId, schoolId: ctx.schoolId } })
    : await prisma.term.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true } })
  if (!term) throw new HttpError(400, 'No current term set — pass ?termId= or mark a term current')

  const asOfDate = input.asOf ? toDate(input.asOf) : new Date(`${fmtDate(new Date())}T00:00:00.000Z`)
  const rangeEnd = asOfDate < term.endDate ? asOfDate : term.endDate
  if (rangeEnd < term.startDate) {
    return {
      classSubjectId, curriculumSubjectId: null, termId: term.id, asOf: fmtDate(asOfDate),
      scheduledPeriodsSoFar: 0, lostPeriods: { holiday: 0, teacherAbsence: 0, total: 0 }, deliverablePeriods: 0,
      expected: null, actual: null, paceDeltaChapters: 0,
    }
  }

  const [entries, curriculumSubject] = await Promise.all([
    prisma.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, classSubjectId, termId: term.id } }),
    prisma.curriculumSubject.findFirst({ where: { schoolId: ctx.schoolId, boardId: cs.class.boardId, gradeId: cs.class.gradeId, streamId: cs.class.streamId, subjectId: cs.subjectId } }),
  ])

  const entriesByDow = new Map<number, typeof entries>()
  for (const e of entries) entriesByDow.set(e.dayOfWeek, [...(entriesByDow.get(e.dayOfWeek) ?? []), e])

  if (!entries.length) {
    return {
      classSubjectId, curriculumSubjectId: curriculumSubject?.id ?? null, termId: term.id, asOf: fmtDate(asOfDate),
      scheduledPeriodsSoFar: 0, lostPeriods: { holiday: 0, teacherAbsence: 0, total: 0 }, deliverablePeriods: 0,
      expected: null, actual: await actualProgressSummary(classSubjectId, curriculumSubject?.id), paceDeltaChapters: 0,
    }
  }

  // Preload holidays and the assigned teacher's absence/leave/substitution data for the whole range once.
  const [holidays, subsForEntries] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { schoolId: ctx.schoolId, type: 'holiday', date: { gte: term.startDate, lte: rangeEnd }, OR: [{ audience: 'School' }, { audience: 'Class', classId: cs.classId }] },
      select: { date: true },
    }),
    prisma.substitution.findMany({ where: { schoolId: ctx.schoolId, timetableEntryId: { in: entries.map(e => e.id) }, date: { gte: term.startDate, lte: rangeEnd } }, select: { timetableEntryId: true, date: true } }),
  ])
  const holidaySet = new Set(holidays.map(h => fmtDate(h.date)))
  const subKey = (entryId: string, date: string) => `${entryId}|${date}`
  const subSet = new Set(subsForEntries.map(s => subKey(s.timetableEntryId, fmtDate(s.date))))

  const teacherIds = [...new Set(entries.map(e => e.teacherId ?? cs.teacherId).filter((t): t is string => !!t))]
  const [absences, leaves] = teacherIds.length
    ? await Promise.all([
      prisma.staffAttendance.findMany({ where: { schoolId: ctx.schoolId, userId: { in: teacherIds }, status: 'A', date: { gte: term.startDate, lte: rangeEnd } }, select: { userId: true, date: true } }),
      prisma.leaveRequest.findMany({ where: { schoolId: ctx.schoolId, forUserId: { in: teacherIds }, status: 'Approved', fromDate: { lte: rangeEnd }, toDate: { gte: term.startDate } }, select: { forUserId: true, fromDate: true, toDate: true } }),
    ])
    : [[], []]
  const absentOn = new Set(absences.map(a => `${a.userId}|${fmtDate(a.date)}`))
  const isOnApprovedLeave = (userId: string, d: Date) => leaves.some(l => l.forUserId === userId && d >= l.fromDate && d <= l.toDate)

  let scheduledPeriodsSoFar = 0
  let lostHoliday = 0
  let lostTeacherAbsence = 0

  for (let d = term.startDate; d <= rangeEnd; d = addDays(d, 1)) {
    const schoolDow = DOW_JS_TO_SCHOOL[d.getUTCDay()]
    if (schoolDow == null) continue
    const todaysEntries = entriesByDow.get(schoolDow)
    if (!todaysEntries?.length) continue
    const dateStrVal = fmtDate(d)
    const isHoliday = holidaySet.has(dateStrVal)
    for (const e of todaysEntries) {
      scheduledPeriodsSoFar++
      if (isHoliday) { lostHoliday++; continue }
      const teacherId = e.teacherId ?? cs.teacherId
      if (!teacherId) continue
      const covered = subSet.has(subKey(e.id, dateStrVal))
      if (covered) continue
      if (absentOn.has(`${teacherId}|${dateStrVal}`) || isOnApprovedLeave(teacherId, d)) lostTeacherAbsence++
    }
  }

  const lostTotal = lostHoliday + lostTeacherAbsence
  const deliverablePeriods = Math.max(0, scheduledPeriodsSoFar - lostTotal)

  let expected: { chaptersCompleted: number; currentChapterId: string | null; currentChapterTitle: string | null; currentChapterOrder: number | null } | null = null
  if (curriculumSubject) {
    const chapters = await prisma.syllabusChapter.findMany({ where: { curriculumSubjectId: curriculumSubject.id }, orderBy: { order: 'asc' } })
    let cumulative = 0
    let chaptersCompleted = 0
    let current: SyllabusChapter | null = null
    for (const ch of chapters) {
      if (cumulative + ch.estimatedPeriods <= deliverablePeriods) {
        cumulative += ch.estimatedPeriods
        chaptersCompleted++
      } else {
        current = ch
        break
      }
    }
    expected = {
      chaptersCompleted,
      currentChapterId: current?.id ?? null,
      currentChapterTitle: current?.title ?? null,
      currentChapterOrder: current?.order ?? null,
    }
  }

  const actual = await actualProgressSummary(classSubjectId, curriculumSubject?.id)
  const paceDeltaChapters = expected && actual ? actual.chaptersCompleted - expected.chaptersCompleted : 0

  return {
    classSubjectId,
    curriculumSubjectId: curriculumSubject?.id ?? null,
    termId: term.id,
    asOf: fmtDate(asOfDate),
    scheduledPeriodsSoFar,
    lostPeriods: { holiday: lostHoliday, teacherAbsence: lostTeacherAbsence, total: lostTotal },
    deliverablePeriods,
    expected,
    actual,
    paceDeltaChapters,
  }
}

async function actualProgressSummary(classSubjectId: string, curriculumSubjectId?: string) {
  if (!curriculumSubjectId) return null
  const [chapters, progress] = await Promise.all([
    prisma.syllabusChapter.findMany({ where: { curriculumSubjectId }, orderBy: { order: 'asc' } }),
    prisma.chapterProgress.findMany({ where: { classSubjectId } }),
  ])
  const byChapter = new Map(progress.map(p => [p.chapterId, p]))
  const chaptersCompleted = chapters.filter(ch => byChapter.get(ch.id)?.status === 'Done').length
  const current = chapters.find(ch => byChapter.get(ch.id)?.status !== 'Done') ?? null
  return {
    chaptersCompleted,
    currentChapterId: current?.id ?? null,
    currentChapterOrder: current?.order ?? null,
  }
}

// ═══════════════════════════ coverage vs. learning ═══════════════════════════
// For chapters marked Done with at least one linked, published Assessment on this class-subject, show the
// class average score alongside the completion date.

export async function computeCoverage(ctx: Ctx, classSubjectId: string) {
  await assertViewClassSubject(ctx, classSubjectId)
  const cs = await getClassSubject(ctx, classSubjectId)
  const curriculumSubject = await prisma.curriculumSubject.findFirst({
    where: { schoolId: ctx.schoolId, boardId: cs.class.boardId, gradeId: cs.class.gradeId, streamId: cs.class.streamId, subjectId: cs.subjectId },
  })
  if (!curriculumSubject) return []

  const [chapters, progress, assessments] = await Promise.all([
    prisma.syllabusChapter.findMany({ where: { curriculumSubjectId: curriculumSubject.id }, orderBy: { order: 'asc' } }),
    prisma.chapterProgress.findMany({ where: { classSubjectId, status: 'Done' } }),
    prisma.assessment.findMany({ where: { schoolId: ctx.schoolId, classSubjectId, publishedAt: { not: null } }, include: { marks: true } }),
  ])
  const progressByChapter = new Map(progress.map(p => [p.chapterId, p]))

  return chapters
    .filter(ch => progressByChapter.has(ch.id))
    .map(ch => {
      const p = progressByChapter.get(ch.id)!
      const linked = assessments.filter(a => a.chapterIds.includes(ch.id))
      const assessmentSummaries = linked.map(a => {
        const scored = a.marks
        const avgPct = scored.length ? (scored.reduce((sum, m) => sum + m.score, 0) / scored.length / a.maxMarks) * 100 : null
        return { assessmentId: a.id, name: a.name, maxMarks: a.maxMarks, studentsGraded: scored.length, avgScorePct: avgPct != null ? Math.round(avgPct * 10) / 10 : null }
      })
      return {
        chapterId: ch.id,
        chapterTitle: ch.title,
        chapterOrder: ch.order,
        completedAt: p.completedAt ? fmtDate(p.completedAt) : undefined,
        assessments: assessmentSummaries,
      }
    })
}
