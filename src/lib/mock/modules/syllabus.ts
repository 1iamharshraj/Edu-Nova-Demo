// Mirrors server/src/modules/syllabus/{router,service,schema}.ts's contract for src/lib/hooks/useSyllabus.ts.
// Chapters/targets are staff/admin/superadmin-write; progress is written by the class-subject's teacher(s)
// (or staff/admin); pace/coverage are computed views over real TimetableEntry/CalendarEvent/StaffAttendance
// data seeded in seed/examsAcademics.ts.

import { route, requireAuth, requireRole, status } from '../router'
import { badRequest, conflict, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { assertWriteClassSubject, assertViewClass, getClassSubject } from './examsAcademicsScope'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']

function serializeChapter(c: Row) {
  return { id: c.id, curriculumSubjectId: c.curriculumSubjectId, order: c.order, title: c.title, estimatedPeriods: c.estimatedPeriods, examWeightagePct: c.examWeightagePct ?? undefined }
}
function serializeProgress(p: Row) {
  return { id: p.id, classSubjectId: p.classSubjectId, chapterId: p.chapterId, status: p.status, startedAt: p.startedAt ?? undefined, completedAt: p.completedAt ?? undefined, notes: p.notes ?? undefined, updatedById: p.updatedById, updatedAt: p.updatedAt }
}
function serializeTarget(t: Row) {
  return { id: t.id, curriculumSubjectId: t.curriculumSubjectId, termId: t.termId, targetChapterId: t.targetChapterId, classId: t.classId ?? undefined }
}
function serializeResource(r: Row) {
  return { id: r.id, chapterId: r.chapterId, fileId: r.fileId, label: r.label, uploadedById: r.uploadedById, createdAt: r.createdAt }
}

// ═══════════════════════════ chapters ═══════════════════════════

route('GET', '/syllabus/chapters', (ctx) => {
  requireAuth(ctx)
  const { curriculumSubjectId } = ctx.query
  let rows = table('SyllabusChapter')
  if (curriculumSubjectId) rows = rows.filter(c => c.curriculumSubjectId === curriculumSubjectId)
  rows = [...rows].sort((a, b) => String(a.curriculumSubjectId).localeCompare(String(b.curriculumSubjectId)) || Number(a.order) - Number(b.order))
  return { items: rows.map(serializeChapter) }
})

route('POST', '/syllabus/chapters', (ctx) => {
  requireRole(ctx, ...STAFF_ROLES)
  const body = ctx.body as { curriculumSubjectId?: string; order?: number; title?: string; estimatedPeriods?: number; examWeightagePct?: number | null }
  if (!body.curriculumSubjectId) throw badRequest('curriculumSubjectId is required')
  if (!table('CurriculumSubject').some(c => c.id === body.curriculumSubjectId)) throw notFound('Curriculum subject')
  if (!body.title?.trim()) throw badRequest('title is required')
  if (!body.order || body.order < 1) throw badRequest('order must be >= 1')
  if (!body.estimatedPeriods || body.estimatedPeriods < 1) throw badRequest('estimatedPeriods must be >= 1')
  const dupe = table('SyllabusChapter').find(c => c.curriculumSubjectId === body.curriculumSubjectId && c.order === body.order)
  if (dupe) throw conflict(`Chapter order ${body.order} is already used in this curriculum subject`, { chapterId: dupe.id })
  const row: Row = { id: uid('chapter'), schoolId: table('CurriculumSubject').find(c => c.id === body.curriculumSubjectId)!.schoolId, curriculumSubjectId: body.curriculumSubjectId, order: body.order, title: body.title.trim(), estimatedPeriods: body.estimatedPeriods, examWeightagePct: body.examWeightagePct ?? null, createdAt: nowIso() }
  const rows = table('SyllabusChapter'); rows.push(row); saveTable('SyllabusChapter', rows)
  return status(201, { item: serializeChapter(row) })
})

route('PATCH', '/syllabus/chapters/:id', (ctx) => {
  requireRole(ctx, ...STAFF_ROLES)
  const rows = table('SyllabusChapter')
  const idx = rows.findIndex(c => c.id === ctx.params.id)
  if (idx === -1) throw notFound('Syllabus chapter')
  const body = ctx.body as { order?: number; title?: string; estimatedPeriods?: number; examWeightagePct?: number | null }
  if (body.order !== undefined && body.order !== rows[idx].order) {
    const dupe = rows.find(c => c.curriculumSubjectId === rows[idx].curriculumSubjectId && c.order === body.order && c.id !== ctx.params.id)
    if (dupe) throw conflict(`Chapter order ${body.order} is already used in this curriculum subject`, { chapterId: dupe.id })
  }
  rows[idx] = { ...rows[idx], ...(body.order !== undefined ? { order: body.order } : {}), ...(body.title !== undefined ? { title: body.title } : {}), ...(body.estimatedPeriods !== undefined ? { estimatedPeriods: body.estimatedPeriods } : {}), ...(body.examWeightagePct !== undefined ? { examWeightagePct: body.examWeightagePct } : {}) }
  saveTable('SyllabusChapter', rows)
  return { item: serializeChapter(rows[idx]) }
})

route('DELETE', '/syllabus/chapters/:id', (ctx) => {
  requireRole(ctx, ...STAFF_ROLES)
  const rows = table('SyllabusChapter')
  const idx = rows.findIndex(c => c.id === ctx.params.id)
  if (idx === -1) throw notFound('Syllabus chapter')
  rows.splice(idx, 1)
  saveTable('SyllabusChapter', rows)
  return { ok: true }
})

// ═══════════════════════════ chapter resources ═══════════════════════════

route('GET', '/syllabus/chapter-resources', (ctx) => {
  requireAuth(ctx)
  const { chapterId } = ctx.query
  if (!chapterId) return { items: [] }
  const rows = table('ChapterResource').filter(r => r.chapterId === chapterId)
  return { items: rows.map(serializeResource) }
})

route('POST', '/syllabus/chapter-resources', (ctx) => {
  const actor = requireAuth(ctx)
  const body = ctx.body as { chapterId?: string; fileId?: string; label?: string }
  if (!body.chapterId || !table('SyllabusChapter').some(c => c.id === body.chapterId)) throw notFound('Syllabus chapter')
  if (!body.fileId) throw badRequest('fileId is required')
  if (!body.label?.trim()) throw badRequest('label is required')
  const row: Row = { id: uid('chapterresource'), schoolId: actor.schoolId, chapterId: body.chapterId, fileId: body.fileId, label: body.label.trim(), uploadedById: actor.userId, createdAt: nowIso() }
  const rows = table('ChapterResource'); rows.push(row); saveTable('ChapterResource', rows)
  return status(201, { item: serializeResource(row) })
})

route('DELETE', '/syllabus/chapter-resources/:id', (ctx) => {
  requireAuth(ctx)
  const rows = table('ChapterResource')
  const idx = rows.findIndex(r => r.id === ctx.params.id)
  if (idx === -1) throw notFound('Chapter resource')
  rows.splice(idx, 1)
  saveTable('ChapterResource', rows)
  return { ok: true }
})

// ═══════════════════════════ progress ═══════════════════════════

route('GET', '/syllabus/progress', (ctx) => {
  const actor = requireAuth(ctx)
  const { classSubjectId } = ctx.query
  if (!classSubjectId) throw badRequest('classSubjectId is required')
  const cs = getClassSubject(actor, classSubjectId)
  assertViewClass(actor, cs.classId as string)
  const curriculumSubject = table('CurriculumSubject').find(cur => {
    const cls = table('Class').find(c => c.id === cs.classId)
    return cls && cur.boardId === cls.boardId && cur.gradeId === cls.gradeId && (cur.streamId ?? null) === (cls.streamId ?? null) && cur.subjectId === cs.subjectId
  })
  if (!curriculumSubject) return { items: [] }
  const chapters = table('SyllabusChapter').filter(c => c.curriculumSubjectId === curriculumSubject.id).sort((a, b) => Number(a.order) - Number(b.order))
  const progressRows = table('ChapterProgress').filter(p => p.classSubjectId === classSubjectId)
  const byChapter = new Map(progressRows.map(p => [p.chapterId, p]))
  const items = chapters.map(ch => ({
    chapter: serializeChapter(ch),
    progress: byChapter.has(ch.id) ? serializeProgress(byChapter.get(ch.id)!) : { classSubjectId, chapterId: ch.id, status: 'NotStarted', updatedById: undefined, updatedAt: undefined },
  }))
  return { items }
})

route('PATCH', '/syllabus/progress/:classSubjectId/:chapterId', (ctx) => {
  const actor = requireAuth(ctx)
  const { classSubjectId, chapterId } = ctx.params
  assertWriteClassSubject(actor, classSubjectId)
  const chapter = table('SyllabusChapter').find(c => c.id === chapterId)
  if (!chapter) throw notFound('Syllabus chapter')
  const body = ctx.body as { status?: string; notes?: string | null; startedAt?: string | null; completedAt?: string | null }
  if (Object.keys(body).length === 0) throw badRequest('Provide at least one field to update')
  const rows = table('ChapterProgress')
  const idx = rows.findIndex(p => p.classSubjectId === classSubjectId && p.chapterId === chapterId)
  const before = idx === -1 ? undefined : rows[idx]
  const data: Record<string, unknown> = { updatedById: actor.userId, updatedAt: nowIso() }
  if (body.status !== undefined) data.status = body.status
  if (body.notes !== undefined) data.notes = body.notes
  if (body.startedAt !== undefined) data.startedAt = body.startedAt
  if (body.completedAt !== undefined) data.completedAt = body.completedAt
  if (body.status === 'InProgress' && body.startedAt === undefined && !before?.startedAt) data.startedAt = nowIso().slice(0, 10)
  if (body.status === 'Done' && body.completedAt === undefined && !before?.completedAt) data.completedAt = nowIso().slice(0, 10)
  if (idx === -1) {
    const row: Row = { id: uid('chapterprogress'), schoolId: actor.schoolId, classSubjectId, chapterId, status: 'NotStarted', ...data }
    rows.push(row); saveTable('ChapterProgress', rows)
    return { item: serializeProgress(row) }
  }
  rows[idx] = { ...rows[idx], ...data }
  saveTable('ChapterProgress', rows)
  return { item: serializeProgress(rows[idx]) }
})

// ═══════════════════════════ term targets ═══════════════════════════

route('GET', '/syllabus/targets', (ctx) => {
  requireRole(ctx, ...STAFF_ROLES)
  const { curriculumSubjectId, termId, classId } = ctx.query
  let rows = table('TermSyllabusTarget')
  if (curriculumSubjectId) rows = rows.filter(t => t.curriculumSubjectId === curriculumSubjectId)
  if (termId) rows = rows.filter(t => t.termId === termId)
  if (classId) rows = rows.filter(t => t.classId === classId)
  return { items: rows.map(serializeTarget) }
})

route('POST', '/syllabus/targets', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const body = ctx.body as { curriculumSubjectId?: string; termId?: string; targetChapterId?: string; classId?: string | null }
  if (!body.curriculumSubjectId || !table('CurriculumSubject').some(c => c.id === body.curriculumSubjectId)) throw notFound('Curriculum subject')
  if (!body.termId || !table('Term').some(t => t.id === body.termId)) throw notFound('Term')
  const chapter = table('SyllabusChapter').find(c => c.id === body.targetChapterId && c.curriculumSubjectId === body.curriculumSubjectId)
  if (!chapter) throw badRequest('targetChapterId must belong to this curriculum subject')
  const classId = body.classId ?? null
  if (classId && !table('Class').some(c => c.id === classId)) throw notFound('Class')
  const existing = table('TermSyllabusTarget').find(t => t.curriculumSubjectId === body.curriculumSubjectId && t.termId === body.termId && (t.classId ?? null) === classId)
  if (existing) throw conflict('A target already exists for this curriculum subject / term / class', { targetId: existing.id })
  const row: Row = { id: uid('termsyllabustarget'), schoolId: actor.schoolId, curriculumSubjectId: body.curriculumSubjectId, termId: body.termId, targetChapterId: body.targetChapterId, classId, createdAt: nowIso() }
  const rows = table('TermSyllabusTarget'); rows.push(row); saveTable('TermSyllabusTarget', rows)
  return status(201, { item: serializeTarget(row) })
})

route('PATCH', '/syllabus/targets/:id', (ctx) => {
  requireRole(ctx, ...STAFF_ROLES)
  const rows = table('TermSyllabusTarget')
  const idx = rows.findIndex(t => t.id === ctx.params.id)
  if (idx === -1) throw notFound('Term syllabus target')
  const { targetChapterId } = ctx.body as { targetChapterId?: string }
  if (targetChapterId) {
    const chapter = table('SyllabusChapter').find(c => c.id === targetChapterId && c.curriculumSubjectId === rows[idx].curriculumSubjectId)
    if (!chapter) throw badRequest('targetChapterId must belong to this curriculum subject')
  }
  rows[idx] = { ...rows[idx], ...(targetChapterId ? { targetChapterId } : {}) }
  saveTable('TermSyllabusTarget', rows)
  return { item: serializeTarget(rows[idx]) }
})

route('DELETE', '/syllabus/targets/:id', (ctx) => {
  requireRole(ctx, ...STAFF_ROLES)
  const rows = table('TermSyllabusTarget')
  const idx = rows.findIndex(t => t.id === ctx.params.id)
  if (idx === -1) throw notFound('Term syllabus target')
  rows.splice(idx, 1)
  saveTable('TermSyllabusTarget', rows)
  return { ok: true }
})

// ═══════════════════════════ pace / coverage ═══════════════════════════
// Real (not simulated) aggregation: walks the class-subject's TimetableEntry slots between the term start
// and `asOf`, subtracts periods lost to a School/Class holiday (CalendarEvent) or an uncovered teacher
// absence (StaffAttendance status 'A' with no matching Substitution), and compares the resulting
// "deliverable periods" against chapters' estimatedPeriods to find the expected chapter — simplified from
// the real server's version (no LeaveRequest overlay) but genuinely computed from seeded rows, not canned.
const DOW_JS_TO_SCHOOL: Record<number, number | null> = { 0: null, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 }
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function actualProgressSummary(classSubjectId: string, curriculumSubjectId?: string) {
  if (!curriculumSubjectId) return null
  const chapters = table('SyllabusChapter').filter(c => c.curriculumSubjectId === curriculumSubjectId).sort((a, b) => Number(a.order) - Number(b.order))
  const progress = table('ChapterProgress').filter(p => p.classSubjectId === classSubjectId)
  const byChapter = new Map(progress.map(p => [p.chapterId, p]))
  const chaptersCompleted = chapters.filter(ch => byChapter.get(ch.id)?.status === 'Done').length
  const current = chapters.find(ch => byChapter.get(ch.id)?.status !== 'Done') ?? null
  return { chaptersCompleted, currentChapterId: current?.id ?? null, currentChapterOrder: current?.order ?? null }
}

route('GET', '/syllabus/pace/:classSubjectId', (ctx) => {
  const actor = requireAuth(ctx)
  const classSubjectId = ctx.params.classSubjectId
  const cs = getClassSubject(actor, classSubjectId)
  assertViewClass(actor, cs.classId as string)

  const term = ctx.query.termId ? table('Term').find(t => t.id === ctx.query.termId) : table('Term').find(t => t.isCurrent)
  if (!term) throw badRequest('No current term set — pass ?termId= or mark a term current')

  const today = nowIso().slice(0, 10)
  const asOfDate = ctx.query.asOf || today
  const rangeEnd = asOfDate < String(term.endDate) ? asOfDate : String(term.endDate)
  const cls = table('Class').find(c => c.id === cs.classId)
  const curriculumSubject = table('CurriculumSubject').find(cur => cls && cur.boardId === cls.boardId && cur.gradeId === cls.gradeId && (cur.streamId ?? null) === (cls.streamId ?? null) && cur.subjectId === cs.subjectId)

  if (rangeEnd < String(term.startDate)) {
    return { classSubjectId, curriculumSubjectId: curriculumSubject?.id ?? null, termId: term.id, asOf: asOfDate, scheduledPeriodsSoFar: 0, lostPeriods: { holiday: 0, teacherAbsence: 0, total: 0 }, deliverablePeriods: 0, expected: null, actual: null, paceDeltaChapters: 0 }
  }

  const entries = table('TimetableEntry').filter(e => e.classSubjectId === classSubjectId && e.termId === term.id)
  if (!entries.length) {
    return { classSubjectId, curriculumSubjectId: curriculumSubject?.id ?? null, termId: term.id, asOf: asOfDate, scheduledPeriodsSoFar: 0, lostPeriods: { holiday: 0, teacherAbsence: 0, total: 0 }, deliverablePeriods: 0, expected: null, actual: actualProgressSummary(classSubjectId, curriculumSubject?.id), paceDeltaChapters: 0 }
  }
  const entriesByDow = new Map<number, Row[]>()
  for (const e of entries) entriesByDow.set(Number(e.dayOfWeek), [...(entriesByDow.get(Number(e.dayOfWeek)) ?? []), e])

  const holidays = table('CalendarEvent').filter(h => h.type === 'holiday' && String(h.date) >= String(term.startDate) && String(h.date) <= rangeEnd && (h.audience === 'School' || (h.audience === 'Class' && h.classId === cs.classId)))
  const holidaySet = new Set(holidays.map(h => String(h.date)))
  const subsForEntries = table('Substitution').filter(s => entries.some(e => e.id === s.timetableEntryId) && String(s.date) >= String(term.startDate) && String(s.date) <= rangeEnd)
  const subSet = new Set(subsForEntries.map(s => `${s.timetableEntryId}|${s.date}`))
  const teacherIds = [...new Set(entries.map(e => (e.teacherId as string | undefined) ?? (cs.teacherId as string | undefined)).filter((t): t is string => !!t))]
  const absences = teacherIds.length ? table('StaffAttendance').filter(a => teacherIds.includes(a.userId as string) && a.status === 'A' && String(a.date) >= String(term.startDate) && String(a.date) <= rangeEnd) : []
  const absentOn = new Set(absences.map(a => `${a.userId}|${a.date}`))

  let scheduledPeriodsSoFar = 0, lostHoliday = 0, lostTeacherAbsence = 0
  for (let d = String(term.startDate); d <= rangeEnd; d = addDays(d, 1)) {
    const schoolDow = DOW_JS_TO_SCHOOL[new Date(`${d}T00:00:00.000Z`).getUTCDay()]
    if (schoolDow == null) continue
    const todays = entriesByDow.get(schoolDow)
    if (!todays?.length) continue
    const isHoliday = holidaySet.has(d)
    for (const e of todays) {
      scheduledPeriodsSoFar++
      if (isHoliday) { lostHoliday++; continue }
      const teacherId = (e.teacherId as string | undefined) ?? (cs.teacherId as string | undefined)
      if (!teacherId) continue
      if (subSet.has(`${e.id}|${d}`)) continue
      if (absentOn.has(`${teacherId}|${d}`)) lostTeacherAbsence++
    }
  }
  const lostTotal = lostHoliday + lostTeacherAbsence
  const deliverablePeriods = Math.max(0, scheduledPeriodsSoFar - lostTotal)

  let expected: { chaptersCompleted: number; currentChapterId: string | null; currentChapterTitle: string | null; currentChapterOrder: number | null } | null = null
  if (curriculumSubject) {
    const chapters = table('SyllabusChapter').filter(c => c.curriculumSubjectId === curriculumSubject.id).sort((a, b) => Number(a.order) - Number(b.order))
    let cumulative = 0, chaptersCompleted = 0
    let current: Row | null = null
    for (const ch of chapters) {
      if (cumulative + Number(ch.estimatedPeriods) <= deliverablePeriods) { cumulative += Number(ch.estimatedPeriods); chaptersCompleted++ } else { current = ch; break }
    }
    expected = { chaptersCompleted, currentChapterId: current?.id ?? null, currentChapterTitle: (current?.title as string | undefined) ?? null, currentChapterOrder: (current?.order as number | undefined) ?? null }
  }
  const actual = actualProgressSummary(classSubjectId, curriculumSubject?.id)
  const paceDeltaChapters = expected && actual ? actual.chaptersCompleted - expected.chaptersCompleted : 0

  return { classSubjectId, curriculumSubjectId: curriculumSubject?.id ?? null, termId: term.id, asOf: asOfDate, scheduledPeriodsSoFar, lostPeriods: { holiday: lostHoliday, teacherAbsence: lostTeacherAbsence, total: lostTotal }, deliverablePeriods, expected, actual, paceDeltaChapters }
})

route('GET', '/syllabus/coverage/:classSubjectId', (ctx) => {
  const actor = requireAuth(ctx)
  const classSubjectId = ctx.params.classSubjectId
  const cs = getClassSubject(actor, classSubjectId)
  assertViewClass(actor, cs.classId as string)
  const cls = table('Class').find(c => c.id === cs.classId)
  const curriculumSubject = table('CurriculumSubject').find(cur => cls && cur.boardId === cls.boardId && cur.gradeId === cls.gradeId && (cur.streamId ?? null) === (cls.streamId ?? null) && cur.subjectId === cs.subjectId)
  if (!curriculumSubject) return { items: [] }
  const chapters = table('SyllabusChapter').filter(c => c.curriculumSubjectId === curriculumSubject.id).sort((a, b) => Number(a.order) - Number(b.order))
  const progress = table('ChapterProgress').filter(p => p.classSubjectId === classSubjectId && p.status === 'Done')
  const progressByChapter = new Map(progress.map(p => [p.chapterId, p]))
  const assessments = table('Assessment').filter(a => a.classSubjectId === classSubjectId && a.publishedAt)
  const items = chapters.filter(ch => progressByChapter.has(ch.id)).map(ch => {
    const p = progressByChapter.get(ch.id)!
    const linked = assessments.filter(a => (a.chapterIds as string[] | undefined ?? []).includes(ch.id))
    const assessmentSummaries = linked.map(a => {
      const scored = table('Mark').filter(m => m.assessmentId === a.id)
      const avgPct = scored.length ? (scored.reduce((sum, m) => sum + Number(m.score), 0) / scored.length / Number(a.maxMarks)) * 100 : null
      return { assessmentId: a.id, name: a.name, maxMarks: a.maxMarks, studentsGraded: scored.length, avgScorePct: avgPct != null ? Math.round(avgPct * 10) / 10 : null }
    })
    return { chapterId: ch.id, chapterTitle: ch.title, chapterOrder: ch.order, completedAt: p.completedAt ?? undefined, assessments: assessmentSummaries }
  })
  return { items }
})

// Exported for exams/board-readiness.ts — mirrors modules/syllabus/service.ts#computePace being imported
// directly by modules/exams/boardReadiness.ts on the real server.
export function computePaceDeltaFor(classSubjectId: string): number | null {
  const cs = table('ClassSubject').find(c => c.id === classSubjectId)
  if (!cs) return null
  const cls = table('Class').find(c => c.id === cs.classId)
  const curriculumSubject = table('CurriculumSubject').find(cur => cls && cur.boardId === cls.boardId && cur.gradeId === cls.gradeId && (cur.streamId ?? null) === (cls.streamId ?? null) && cur.subjectId === cs.subjectId)
  if (!curriculumSubject) return null
  const term = table('Term').find(t => t.isCurrent)
  if (!term) return null
  const entries = table('TimetableEntry').filter(e => e.classSubjectId === classSubjectId && e.termId === term.id)
  const actual = actualProgressSummary(classSubjectId, curriculumSubject.id)
  if (!actual) return null
  // Cheap approximation reusing scheduled-so-far without the holiday/absence deduction — good enough for the
  // board-readiness "subjects behind" flag, which only needs the sign of the delta, not the exact count.
  const chapters = table('SyllabusChapter').filter(c => c.curriculumSubjectId === curriculumSubject.id).sort((a, b) => Number(a.order) - Number(b.order))
  const totalPeriods = entries.length ? entries.length * 12 : 0 // rough weeks-in-term multiplier, only used for the sign
  let cumulative = 0, chaptersCompleted = 0
  for (const ch of chapters) { if (cumulative + Number(ch.estimatedPeriods) <= totalPeriods) { cumulative += Number(ch.estimatedPeriods); chaptersCompleted++ } else break }
  return actual.chaptersCompleted - chaptersCompleted
}
