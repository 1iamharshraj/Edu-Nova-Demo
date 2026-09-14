// Mirrors server/src/modules/exams/{router,service,schema}.ts's contract for src/lib/hooks/useExams.ts /
// src/portal/modules/exams.tsx,hr.tsx,studentReport.tsx. Seating-plan generation and invigilation
// auto-assign are real (cheap, explainable) algorithms — round-robin interleaving and a load-spreading
// sort — not simulated, since neither is the expensive constraint-solving kind of "algorithmic" the plan
// calls out for simulation. PDF endpoints return `{}` so `fetchAuthed()` in api.ts synthesizes a
// placeholder download blob, same convention as modules/certificates.ts's `/pdf` route.

import { route, requireRole, status } from '../router'
import { badRequest, conflict, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { isStaff, rosterOf } from './examsAcademicsScope'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']

// ═══════════════════════════ seating plans ═══════════════════════════

function serializeSeatingPlan(p: Row) {
  const room = table('Room').find(r => r.id === p.roomId)
  const seats = table('ExamSeat').filter(s => s.planId === p.id).sort((a, b) => Number(a.seatNumber) - Number(b.seatNumber))
  return {
    id: p.id, assessmentIds: p.assessmentIds, date: p.date, roomId: p.roomId, roomName: room?.name, roomCapacity: room?.capacity ?? undefined,
    generatedAt: p.generatedAt, generatedById: p.generatedById ?? undefined,
    seats: seats.map(s => {
      const student = table('User').find(u => u.id === s.studentId)
      const assessment = table('Assessment').find(a => a.id === s.assessmentId)
      const cs = assessment ? table('ClassSubject').find(c => c.id === assessment.classSubjectId) : undefined
      const cls = cs ? table('Class').find(c => c.id === cs.classId) : undefined
      const grade = cls ? table('Grade').find(g => g.id === cls.gradeId) : undefined
      const subject = cs ? table('Subject').find(su => su.id === cs.subjectId) : undefined
      return { id: s.id, studentId: s.studentId, studentName: student?.name, seatNumber: s.seatNumber, assessmentId: s.assessmentId, classLabel: cls ? `${grade?.label ?? '?'}-${cls.section}` : undefined, subjectName: subject?.name }
    }),
  }
}

// Simple round-robin mixing rule (documented, explainable — the same "interleave the queues" idea the
// real backend uses), not a constraint solver: walks each assessment's roster queue in turn, skipping
// ahead to the next non-empty queue whose class+subject differs from the last seat placed.
function interleaveSeats(groups: { assessmentId: string; key: string; students: { id: string }[] }[]) {
  const queues = groups.map(g => ({ ...g, items: [...g.students] }))
  const total = queues.reduce((sum, q) => sum + q.items.length, 0)
  const result: { studentId: string; assessmentId: string }[] = []
  let lastKey: string | null = null, cursor = 0
  for (let n = 0; n < total; n++) {
    let chosen = -1
    for (let i = 0; i < queues.length; i++) {
      const idx = (cursor + i) % queues.length
      if (!queues[idx].items.length) continue
      if (queues[idx].key !== lastKey) { chosen = idx; break }
    }
    if (chosen === -1) chosen = queues.findIndex(q => q.items.length)
    const student = queues[chosen].items.shift()!
    result.push({ studentId: student.id, assessmentId: queues[chosen].assessmentId })
    lastKey = queues[chosen].key
    cursor = (chosen + 1) % queues.length
  }
  return result
}

route('POST', '/exams/seating-plans', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { assessmentIds, date, roomId } = ctx.body as { assessmentIds?: string[]; date?: string; roomId?: string }
  if (!assessmentIds?.length) throw badRequest('assessmentIds is required')
  if (!date) throw badRequest('date is required')
  if (!roomId) throw badRequest('roomId is required')
  const ids = [...new Set(assessmentIds)]
  const assessments = ids.map(id => { const a = table('Assessment').find(x => x.id === id && x.schoolId === actor.schoolId); if (!a) throw notFound('Assessment'); return a })
  const room = table('Room').find(r => r.id === roomId && r.schoolId === actor.schoolId)
  if (!room) throw notFound('Room')

  const groups = assessments.map(a => {
    const cs = table('ClassSubject').find(c => c.id === a.classSubjectId)!
    return { assessmentId: a.id as string, key: `${cs.classId}:${cs.subjectId}`, students: rosterOf(cs.classId as string) }
  })
  const total = groups.reduce((sum, g) => sum + g.students.length, 0)
  if (total === 0) throw badRequest('No enrolled students found for the given assessments')
  if (room.capacity != null && total > Number(room.capacity)) throw badRequest(`Room "${room.name}" capacity (${room.capacity}) is exceeded by ${total - Number(room.capacity)} student(s)`, { capacity: room.capacity, required: total })

  const seatOrder = interleaveSeats(groups)
  const plan: Row = { id: uid('examseatingplan'), schoolId: actor.schoolId, assessmentIds: ids, date, roomId: room.id, generatedAt: nowIso(), generatedById: actor.userId }
  const plans = table('ExamSeatingPlan'); plans.push(plan); saveTable('ExamSeatingPlan', plans)
  const seats = table('ExamSeat')
  seatOrder.forEach((s, i) => seats.push({ id: uid('examseat'), planId: plan.id, studentId: s.studentId, assessmentId: s.assessmentId, seatNumber: i + 1 } as Row))
  saveTable('ExamSeat', seats)
  return status(201, { item: serializeSeatingPlan(plan) })
})

route('GET', '/exams/seating-plans/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const plan = table('ExamSeatingPlan').find(p => p.id === ctx.params.id && p.schoolId === actor.schoolId)
  if (!plan) throw notFound('Exam seating plan')
  return { item: serializeSeatingPlan(plan) }
})

route('GET', '/exams/seating-plans/:id/pdf', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const plan = table('ExamSeatingPlan').find(p => p.id === ctx.params.id && p.schoolId === actor.schoolId)
  if (!plan) throw notFound('Exam seating plan')
  return {}
})

// ═══════════════════════════ invigilation ═══════════════════════════

function serializeDuty(d: Row) {
  return { id: d.id, assessmentId: d.assessmentId, roomId: d.roomId, teacherId: d.teacherId, date: d.date, status: d.status, createdAt: d.createdAt }
}

route('POST', '/exams/invigilation/auto-assign', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { assessmentIds, date } = ctx.body as { assessmentIds?: string[]; date?: string }
  if (!assessmentIds?.length) throw badRequest('assessmentIds is required')
  if (!date) throw badRequest('date is required')
  const ids = [...new Set(assessmentIds)]
  const assessments = ids.map(id => { const a = table('Assessment').find(x => x.id === id && x.schoolId === actor.schoolId); if (!a) throw notFound('Assessment'); return a })
  const termIds = new Set(assessments.map(a => a.termId))
  if (termIds.size > 1) throw badRequest('All assessments must belong to the same term')
  const termId = assessments[0].termId as string

  const examClassSubjectIds = assessments.map(a => a.classSubjectId as string)
  const examSubjectIds = new Set(examClassSubjectIds.map(id => table('ClassSubject').find(c => c.id === id)?.subjectId))
  const examTeacherIds = new Set(examClassSubjectIds.map(id => table('ClassSubject').find(c => c.id === id)?.teacherId).filter(Boolean))

  const teachers = table('User').filter(u => u.schoolId === actor.schoolId && u.role === 'teacher' && u.active !== false)
  const subjectTeacherIds = new Set(table('ClassSubject').filter(cs => examSubjectIds.has(cs.subjectId as string) && cs.teacherId).map(cs => cs.teacherId))
  const invigDuties = table('InvigilationDuty').filter(d => d.schoolId === actor.schoolId && d.date === date)
  const busyIds = new Set(invigDuties.map(d => d.teacherId))

  const dutiesThisTerm = table('InvigilationDuty').filter(d => d.schoolId === actor.schoolId && table('Assessment').find(a => a.id === d.assessmentId)?.termId === termId)
  const countMap = new Map<string, number>()
  for (const d of dutiesThisTerm) countMap.set(d.teacherId as string, (countMap.get(d.teacherId as string) ?? 0) + 1)

  const suggestions = teachers
    .filter(t => !examTeacherIds.has(t.id) && !subjectTeacherIds.has(t.id) && !busyIds.has(t.id))
    .map(t => ({ teacherId: t.id, name: t.name, currentDutyCount: countMap.get(t.id as string) ?? 0, otherPeriodsThatDay: 0 }))
    .sort((a, b) => a.currentDutyCount - b.currentDutyCount || String(a.name).localeCompare(String(b.name)))

  return { date, termId, assessmentIds: ids, suggestions }
})

route('GET', '/exams/invigilation', (ctx) => {
  const actor = requireRole(ctx, 'teacher', ...STAFF_ROLES)
  const { date, teacherId, assessmentId } = ctx.query
  let rows = table('InvigilationDuty').filter(d => d.schoolId === actor.schoolId)
  rows = rows.filter(d => (!isStaff(actor.role) ? d.teacherId === actor.userId : (teacherId ? d.teacherId === teacherId : true)))
  if (date) rows = rows.filter(d => d.date === date)
  if (assessmentId) rows = rows.filter(d => d.assessmentId === assessmentId)
  rows = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)))
  return { items: rows.map(serializeDuty) }
})

function assertRoomAssessmentTeacher(actor: { schoolId: string }, assessmentId: string, roomId: string, teacherId: string) {
  const assessment = table('Assessment').find(a => a.id === assessmentId && a.schoolId === actor.schoolId)
  if (!assessment) throw notFound('Assessment')
  const room = table('Room').find(r => r.id === roomId && r.schoolId === actor.schoolId)
  if (!room) throw notFound('Room')
  const teacher = table('User').find(u => u.id === teacherId && u.schoolId === actor.schoolId && u.role === 'teacher')
  if (!teacher) throw notFound('Teacher')
  return assessment
}

route('POST', '/exams/invigilation', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { assessmentId, roomId, teacherId, date } = ctx.body as { assessmentId?: string; roomId?: string; teacherId?: string; date?: string }
  if (!assessmentId || !roomId || !teacherId || !date) throw badRequest('assessmentId, roomId, teacherId and date are required')
  assertRoomAssessmentTeacher(actor, assessmentId, roomId, teacherId)
  const clash = table('InvigilationDuty').find(d => d.schoolId === actor.schoolId && d.teacherId === teacherId && d.date === date)
  if (clash) throw conflict('This teacher already has an invigilation duty on that date', { dutyId: clash.id })
  const row: Row = { id: uid('invigilationduty'), schoolId: actor.schoolId, assessmentId, roomId, teacherId, date, status: 'Assigned', createdAt: nowIso() }
  const rows = table('InvigilationDuty'); rows.push(row); saveTable('InvigilationDuty', rows)
  return status(201, { item: serializeDuty(row) })
})

route('PATCH', '/exams/invigilation/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('InvigilationDuty')
  const idx = rows.findIndex(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Invigilation duty')
  const body = ctx.body as { roomId?: string; teacherId?: string; date?: string; status?: string }
  if (body.roomId !== undefined || body.teacherId !== undefined) assertRoomAssessmentTeacher(actor, rows[idx].assessmentId as string, body.roomId ?? (rows[idx].roomId as string), body.teacherId ?? (rows[idx].teacherId as string))
  rows[idx] = { ...rows[idx], ...(body.roomId !== undefined ? { roomId: body.roomId } : {}), ...(body.teacherId !== undefined ? { teacherId: body.teacherId } : {}), ...(body.date !== undefined ? { date: body.date } : {}), ...(body.status !== undefined ? { status: body.status } : {}) }
  saveTable('InvigilationDuty', rows)
  return { item: serializeDuty(rows[idx]) }
})

route('DELETE', '/exams/invigilation/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('InvigilationDuty')
  const idx = rows.findIndex(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Invigilation duty')
  rows.splice(idx, 1)
  saveTable('InvigilationDuty', rows)
  return { ok: true }
})

route('POST', '/exams/invigilation/:id/confirm', (ctx) => {
  const actor = requireRole(ctx, 'teacher', ...STAFF_ROLES)
  const rows = table('InvigilationDuty')
  const idx = rows.findIndex(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Invigilation duty')
  if (!isStaff(actor.role) && actor.userId !== rows[idx].teacherId) throw badRequest('Only the assigned teacher may confirm this duty')
  if (rows[idx].status !== 'Assigned') throw conflict(`Duty is already ${rows[idx].status}`)
  rows[idx] = { ...rows[idx], status: 'Confirmed' }
  saveTable('InvigilationDuty', rows)
  return { item: serializeDuty(rows[idx]) }
})

// ═══════════════════════════ hall ticket ═══════════════════════════

route('GET', '/exams/hall-ticket/:studentId', (ctx) => {
  const actor = requireRole(ctx, 'student', 'parent', 'teacher', ...STAFF_ROLES)
  const { termId } = ctx.query
  if (!termId) throw badRequest('termId is required')
  const student = table('User').find(u => u.id === ctx.params.studentId && u.schoolId === actor.schoolId && u.role === 'student')
  if (!student) throw notFound('Student')
  const term = table('Term').find(t => t.id === termId && t.schoolId === actor.schoolId)
  if (!term) throw notFound('Term')
  return {}
})

// ═══════════════════════════ board-exam readiness ═══════════════════════════

const BEHIND_THRESHOLD_CHAPTERS = -1
const TREND_DROP_PP = 2

route('GET', '/exams/board-readiness', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { classId } = ctx.query
  if (!classId) throw badRequest('classId is required')
  const cls = table('Class').find(c => c.id === classId && c.schoolId === actor.schoolId)
  if (!cls) throw notFound('Class')

  const classSubjects = table('ClassSubject').filter(cs => cs.schoolId === actor.schoolId && cs.classId === classId)
  let subjectsBehind = 0
  for (const cs of classSubjects) {
    const curriculumSubject = table('CurriculumSubject').find(cur => cur.boardId === cls.boardId && cur.gradeId === cls.gradeId && (cur.streamId ?? null) === (cls.streamId ?? null) && cur.subjectId === cs.subjectId)
    if (!curriculumSubject) continue
    const chapters = table('SyllabusChapter').filter(c => c.curriculumSubjectId === curriculumSubject.id)
    const progress = table('ChapterProgress').filter(p => p.classSubjectId === cs.id)
    const byChapter = new Map(progress.map(p => [p.chapterId, p]))
    const actualDone = chapters.filter(ch => byChapter.get(ch.id)?.status === 'Done').length
    // Same "expected chapter from deliverable periods" idea as syllabus/pace, using a term-length rough
    // period budget rather than re-walking the calendar day by day — good enough for a class-level flag.
    const entries = table('TimetableEntry').filter(e => e.classSubjectId === cs.id)
    const roughPeriods = entries.length * 12
    let cumulative = 0, expectedDone = 0
    for (const ch of chapters.sort((a, b) => Number(a.order) - Number(b.order))) {
      if (cumulative + Number(ch.estimatedPeriods) <= roughPeriods) { cumulative += Number(ch.estimatedPeriods); expectedDone++ } else break
    }
    if (actualDone - expectedDone <= BEHIND_THRESHOLD_CHAPTERS) subjectsBehind++
  }

  const roster = rosterOf(classId)
  const regs = table('BoardRegistration').filter(r => r.schoolId === actor.schoolId && roster.some(s => s.id === r.studentId) && r.academicYearId === cls.academicYearId)
  const regByStudent = new Map(regs.map(r => [r.studentId, r]))

  const students = roster.map(s => {
    const sMarks = table('Mark').filter(m => m.studentId === s.id).map(m => {
      const a = table('Assessment').find(x => x.id === m.assessmentId)
      return { pct: a ? (Number(m.score) / Number(a.maxMarks)) * 100 : 0, date: a?.date as string | undefined }
    }).sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
    const avgScorePct = sMarks.length ? Math.round((sMarks.reduce((sum, m) => sum + m.pct, 0) / sMarks.length) * 10) / 10 : null
    let trendingDown = false
    if (sMarks.length >= 2) {
      const mid = Math.floor(sMarks.length / 2)
      const avg = (arr: typeof sMarks) => arr.reduce((sum, m) => sum + m.pct, 0) / arr.length
      trendingDown = avg(sMarks.slice(mid)) < avg(sMarks.slice(0, mid)) - TREND_DROP_PP
    }
    const reg = regByStudent.get(s.id)
    const registrationStatus = (reg?.status as string | undefined) ?? 'NotStarted'
    const needsAttention = subjectsBehind > 0 || trendingDown || !['Validated', 'SentToBoard'].includes(registrationStatus)
    return { studentId: s.id, name: s.name, rollNo: s.rollNo, avgScorePct, trendingDown, registrationStatus, needsAttention }
  })
  return { classId, subjectsBehind, subjectsTotal: classSubjects.length, students }
})
