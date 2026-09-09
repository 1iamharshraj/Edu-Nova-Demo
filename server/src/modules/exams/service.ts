import type { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { isStaff, rosterOf, assertViewStudent, getClass } from '../../lib/scope'
import { classLabel } from '../timetable/shared'
import { drawFields, drawFooter, drawHeader, drawTable, fmtLong, renderToBuffer } from '../../lib/pdf'
import { absPath } from '../files/service'
import fs from 'node:fs'
import type { createSeatingPlan, createInvigilationDuty, patchInvigilationDuty, autoAssignInvigilation, invigilationQuery } from './schema'

// See phase-25-exam-operations.md, items 1-3. `Assessment` carries only a `date` (no period/time field),
// so every "same slot" / "free that period" check in this module operates at day granularity — documented
// once here (also noted in schema.prisma) rather than at each call site.

// ═══════════════════════════ item 1: seating plans ═══════════════════════════

const seatingPlanInclude = {
  room: true,
  seats: {
    include: { student: { select: { id: true, name: true } }, assessment: { include: { classSubject: { include: { subject: true, class: { include: { grade: true } } } } } } },
    orderBy: { seatNumber: 'asc' as const },
  },
} satisfies Prisma.ExamSeatingPlanInclude
type PlanFull = Prisma.ExamSeatingPlanGetPayload<{ include: typeof seatingPlanInclude }>

export const serializeSeatingPlan = (p: PlanFull) => ({
  id: p.id,
  assessmentIds: p.assessmentIds,
  date: fmtDate(p.date),
  roomId: p.roomId,
  roomName: p.room.name,
  roomCapacity: p.room.capacity ?? undefined,
  generatedAt: p.generatedAt.toISOString(),
  generatedById: p.generatedById ?? undefined,
  seats: p.seats.map(s => ({
    id: s.id,
    studentId: s.studentId,
    studentName: s.student.name,
    seatNumber: s.seatNumber,
    assessmentId: s.assessmentId,
    classLabel: classLabel(s.assessment.classSubject.class),
    subjectName: s.assessment.classSubject.subject.name,
  })),
})

async function getSeatingPlan(ctx: Ctx, id: string) {
  const row = await prisma.examSeatingPlan.findFirst({ where: { id, schoolId: ctx.schoolId }, include: seatingPlanInclude })
  if (!row) throw notFound('Exam seating plan')
  return row
}

// Simple, explainable round-robin: walks the per-assessment queues in turn, skipping ahead to the next
// non-empty queue whose class+subject differs from the last seat placed so adjacent seats are (where the
// numbers allow it) never the same paper — a straightforward hand-marking-style mixing rule, not a
// constraint solver.
function interleaveSeats(groups: { assessmentId: string; key: string; students: { id: string }[] }[]) {
  const queues = groups.map(g => ({ ...g, items: [...g.students] }))
  const total = queues.reduce((sum, q) => sum + q.items.length, 0)
  const result: { studentId: string; assessmentId: string }[] = []
  let lastKey: string | null = null
  let cursor = 0
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

export async function createSeatingPlanRow(ctx: Ctx, input: z.infer<typeof createSeatingPlan>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Staff/admin only')
  const ids = [...new Set(input.assessmentIds)]
  const assessments = await prisma.assessment.findMany({
    where: { id: { in: ids }, schoolId: ctx.schoolId },
    include: { classSubject: { include: { subject: true, class: { include: { grade: true } } } } },
  })
  if (assessments.length !== ids.length) throw notFound('Assessment')
  const room = await prisma.room.findFirst({ where: { id: input.roomId, schoolId: ctx.schoolId } })
  if (!room) throw notFound('Room')

  const groups = await Promise.all(assessments.map(async a => ({
    assessmentId: a.id,
    key: `${a.classSubject.classId}:${a.classSubject.subjectId}`,
    students: await rosterOf(a.classSubject.classId),
  })))
  const total = groups.reduce((sum, g) => sum + g.students.length, 0)
  if (total === 0) throw new HttpError(400, 'No enrolled students found for the given assessments')
  if (room.capacity != null && total > room.capacity) {
    throw new HttpError(400, `Room "${room.name}" capacity (${room.capacity}) is exceeded by ${total - room.capacity} student(s)`, { capacity: room.capacity, required: total })
  }

  const seatOrder = interleaveSeats(groups)

  const row = await prisma.$transaction(async tx => {
    const plan = await tx.examSeatingPlan.create({
      data: { schoolId: ctx.schoolId, assessmentIds: ids, date: toDate(input.date), roomId: room.id, generatedById: ctx.actorId },
    })
    await tx.examSeat.createMany({
      data: seatOrder.map((s, i) => ({ planId: plan.id, studentId: s.studentId, assessmentId: s.assessmentId, seatNumber: i + 1 })),
    })
    return plan
  })
  const full = await getSeatingPlan(ctx, row.id)
  await audit(ctx.schoolId, ctx.actorId, 'create', 'examSeatingPlan', row.id, undefined, { assessmentIds: ids, roomId: room.id, date: input.date, seats: seatOrder.length })
  return full
}

export async function getSeatingPlanFull(ctx: Ctx, id: string) {
  return getSeatingPlan(ctx, id)
}

export async function seatingPlanPdf(ctx: Ctx, id: string) {
  const plan = await getSeatingPlan(ctx, id)
  const school = await prisma.school.findUniqueOrThrow({ where: { id: ctx.schoolId } })
  const now = new Date()
  const bytes = await renderToBuffer(async doc => {
    drawHeader(doc, { schoolName: school.name, title: 'Exam Seating Chart', subtitle: `${plan.room.name} · ${fmtDate(plan.date)}` })
    const rows = plan.seats.map(s => [String(s.seatNumber), s.student.name, classLabel(s.assessment.classSubject.class), s.assessment.classSubject.subject.name])
    drawTable(doc, [
      { label: 'Seat', w: 1, align: 'right' }, { label: 'Student', w: 4 }, { label: 'Class', w: 2 }, { label: 'Subject', w: 3 },
    ], rows)
    await drawFooter(doc, { issuedBy: school.name, issuedOn: fmtLong(now), qrText: `EduNova seating plan ${plan.id} | ${plan.room.name} | ${fmtDate(plan.date)}` })
  })
  return { bytes, name: `Seating-${plan.room.name.replace(/\s+/g, '-')}-${fmtDate(plan.date)}.pdf` }
}

// ═══════════════════════════ item 2: invigilation ═══════════════════════════

export const serializeDuty = (d: {
  id: string; assessmentId: string; roomId: string; teacherId: string; date: Date; status: string; createdAt: Date
}) => ({
  id: d.id, assessmentId: d.assessmentId, roomId: d.roomId, teacherId: d.teacherId,
  date: fmtDate(d.date), status: d.status, createdAt: d.createdAt.toISOString(),
})

const DOW_JS_TO_SCHOOL: Record<number, number | null> = { 0: null, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 }

// POST /invigilation/auto-assign — suggestion only, never commits a row. Ranks free, eligible teachers by
// their current invigilation-duty load this term so it spreads across the staff.
export async function autoAssignInvigilationDuties(ctx: Ctx, input: z.infer<typeof autoAssignInvigilation>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Staff/admin only')
  const ids = [...new Set(input.assessmentIds)]
  const assessments = await prisma.assessment.findMany({
    where: { id: { in: ids }, schoolId: ctx.schoolId },
    include: { classSubject: true },
  })
  if (assessments.length !== ids.length) throw notFound('Assessment')
  const termIds = new Set(assessments.map(a => a.termId))
  if (termIds.size > 1) throw new HttpError(400, 'All assessments must belong to the same term')
  const termId = assessments[0].termId

  const examClassIds = new Set(assessments.map(a => a.classSubject.classId))
  const examSubjectIds = [...new Set(assessments.map(a => a.classSubject.subjectId))]
  const examTeacherIds = new Set(assessments.map(a => a.classSubject.teacherId).filter((t): t is string => !!t))

  const dateObj = toDate(input.date)
  const schoolDow = DOW_JS_TO_SCHOOL[dateObj.getUTCDay()]

  const [teachers, subjectTeachers, duties, invigDuties] = await Promise.all([
    prisma.user.findMany({ where: { schoolId: ctx.schoolId, role: 'teacher', active: true }, select: { id: true, name: true } }),
    prisma.classSubject.findMany({ where: { schoolId: ctx.schoolId, subjectId: { in: examSubjectIds }, teacherId: { not: null } }, select: { teacherId: true } }),
    prisma.duty.findMany({ where: { schoolId: ctx.schoolId, eventDate: dateObj, assigneeId: { not: null } }, select: { assigneeId: true } }),
    prisma.invigilationDuty.findMany({ where: { schoolId: ctx.schoolId, date: dateObj }, select: { teacherId: true } }),
  ])
  // Teachers who already teach one of the examined subjects anywhere in school — avoid a teacher
  // invigilating their own subject's exam.
  const subjectTeacherIds = new Set(subjectTeachers.map(cs => cs.teacherId!))
  const busyIds = new Set([...duties.map(d => d.assigneeId!), ...invigDuties.map(d => d.teacherId)])

  // "Free that period": since Assessment has no periodIdx there is no reliable way to tell whether a
  // teacher's regular period actually overlaps the exam slot, and in practice a school's regular
  // timetable is largely suspended for exam days anyway — so a teacher having *some* other class that
  // weekday is not treated as a hard exclusion (that would, in a school where every subject is taught by
  // one teacher across every class — exactly this school's seed data — exclude every teacher and leave
  // zero suggestions). Instead it is folded into the ranking as a lighter-schedule-first tiebreaker
  // alongside the current-term invigilation-duty count, which does the actual load-spreading the spec asks for.
  let timetableLoad = new Map<string, number>()
  if (schoolDow != null) {
    const entries = await prisma.timetableEntry.findMany({
      where: { schoolId: ctx.schoolId, termId, dayOfWeek: schoolDow, teacherId: { not: null }, classId: { notIn: [...examClassIds] } },
      select: { teacherId: true },
    })
    for (const e of entries) timetableLoad.set(e.teacherId!, (timetableLoad.get(e.teacherId!) ?? 0) + 1)
  }

  const dutiesThisTerm = await prisma.invigilationDuty.findMany({ where: { schoolId: ctx.schoolId, assessment: { termId } }, select: { teacherId: true } })
  const countMap = new Map<string, number>()
  for (const d of dutiesThisTerm) countMap.set(d.teacherId, (countMap.get(d.teacherId) ?? 0) + 1)

  const suggestions = teachers
    .filter(t => !examTeacherIds.has(t.id) && !subjectTeacherIds.has(t.id) && !busyIds.has(t.id))
    .map(t => ({ teacherId: t.id, name: t.name, currentDutyCount: countMap.get(t.id) ?? 0, otherPeriodsThatDay: timetableLoad.get(t.id) ?? 0 }))
    .sort((a, b) => a.currentDutyCount - b.currentDutyCount || a.otherPeriodsThatDay - b.otherPeriodsThatDay || a.name.localeCompare(b.name))

  return { date: input.date, termId, assessmentIds: ids, suggestions }
}

async function assertRoomAssessmentTeacher(ctx: Ctx, assessmentId: string, roomId: string, teacherId: string) {
  const assessment = await prisma.assessment.findFirst({ where: { id: assessmentId, schoolId: ctx.schoolId } })
  if (!assessment) throw notFound('Assessment')
  const room = await prisma.room.findFirst({ where: { id: roomId, schoolId: ctx.schoolId } })
  if (!room) throw notFound('Room')
  const teacher = await prisma.user.findFirst({ where: { id: teacherId, schoolId: ctx.schoolId, role: 'teacher' } })
  if (!teacher) throw notFound('Teacher')
  return assessment
}

export async function listInvigilationDuties(ctx: Ctx, q: z.infer<typeof invigilationQuery>) {
  const where = {
    schoolId: ctx.schoolId,
    date: q.date ? toDate(q.date) : undefined,
    teacherId: isStaff(ctx) ? q.teacherId : ctx.actorId,
    assessmentId: q.assessmentId,
  }
  return prisma.invigilationDuty.findMany({ where, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] })
}

async function getDuty(ctx: Ctx, id: string) {
  const row = await prisma.invigilationDuty.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Invigilation duty')
  return row
}

export async function createInvigilationDutyRow(ctx: Ctx, input: z.infer<typeof createInvigilationDuty>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Staff/admin only')
  await assertRoomAssessmentTeacher(ctx, input.assessmentId, input.roomId, input.teacherId)
  const date = toDate(input.date)
  const clash = await prisma.invigilationDuty.findFirst({ where: { schoolId: ctx.schoolId, teacherId: input.teacherId, date } })
  if (clash) throw new HttpError(409, 'This teacher already has an invigilation duty on that date', { dutyId: clash.id })
  const dutyClash = await prisma.duty.findFirst({ where: { schoolId: ctx.schoolId, assigneeId: input.teacherId, eventDate: date } })
  if (dutyClash) throw new HttpError(409, 'This teacher already has another duty on that date', { dutyId: dutyClash.id })
  const row = await prisma.invigilationDuty.create({
    data: { schoolId: ctx.schoolId, assessmentId: input.assessmentId, roomId: input.roomId, teacherId: input.teacherId, date, status: 'Assigned' },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'invigilationDuty', row.id, undefined, serializeDuty(row))
  return row
}

export async function updateInvigilationDutyRow(ctx: Ctx, id: string, input: z.infer<typeof patchInvigilationDuty>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Staff/admin only')
  const before = await getDuty(ctx, id)
  if (input.roomId !== undefined || input.teacherId !== undefined) {
    await assertRoomAssessmentTeacher(ctx, before.assessmentId, input.roomId ?? before.roomId, input.teacherId ?? before.teacherId)
  }
  const row = await prisma.invigilationDuty.update({
    where: { id },
    data: {
      roomId: input.roomId, teacherId: input.teacherId, date: input.date ? toDate(input.date) : undefined, status: input.status,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'invigilationDuty', id, serializeDuty(before), serializeDuty(row))
  return row
}

export async function removeInvigilationDutyRow(ctx: Ctx, id: string) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Staff/admin only')
  const before = await getDuty(ctx, id)
  await prisma.invigilationDuty.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'invigilationDuty', id, serializeDuty(before))
}

// POST /:id/confirm — the assigned teacher confirms their own duty (staff/admin may also confirm on their behalf).
export async function confirmInvigilationDuty(ctx: Ctx, id: string) {
  const before = await getDuty(ctx, id)
  if (!isStaff(ctx) && ctx.actorId !== before.teacherId) throw new HttpError(403, 'Only the assigned teacher may confirm this duty')
  if (before.status !== 'Assigned') throw new HttpError(409, `Duty is already ${before.status}`)
  const row = await prisma.invigilationDuty.update({ where: { id }, data: { status: 'Confirmed' } })
  await audit(ctx.schoolId, ctx.actorId, 'confirm', 'invigilationDuty', id, serializeDuty(before), serializeDuty(row))
  return row
}

// ═══════════════════════════ item 3: hall ticket ═══════════════════════════

export async function hallTicketPdf(ctx: Ctx, studentId: string, termId: string) {
  await assertViewStudent(ctx, studentId)
  const student = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')
  const term = await prisma.term.findFirst({ where: { id: termId, schoolId: ctx.schoolId } })
  if (!term) throw notFound('Term')
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, academicYearId: term.academicYearId },
    include: { class: { include: { grade: true, board: true } } },
    orderBy: { createdAt: 'desc' },
  })
  if (!enrollment) throw new HttpError(400, 'Student has no enrollment in that term’s academic year')
  await getClass(ctx, enrollment.classId)

  const [boardReg, assessments, school] = await Promise.all([
    prisma.boardRegistration.findUnique({ where: { studentId_academicYearId: { studentId, academicYearId: term.academicYearId } } }),
    prisma.assessment.findMany({
      where: { schoolId: ctx.schoolId, termId: term.id, classSubject: { classId: enrollment.classId }, date: { not: null } },
      include: { classSubject: { include: { subject: true } } },
      orderBy: [{ date: 'asc' }],
    }),
    prisma.school.findUniqueOrThrow({ where: { id: ctx.schoolId } }),
  ])

  const seats = await prisma.examSeat.findMany({
    where: { studentId, assessmentId: { in: assessments.map(a => a.id) } },
    include: { plan: { include: { room: true } } },
  })
  const seatByAssessment = new Map(seats.map(s => [s.assessmentId, s]))

  let photoPath: string | null = null
  if (student.photoFileId) {
    const photo = await prisma.file.findFirst({ where: { id: student.photoFileId, schoolId: ctx.schoolId } })
    if (photo) {
      const p = absPath(photo)
      if (fs.existsSync(p)) photoPath = p
    }
  }

  const now = new Date()
  const bytes = await renderToBuffer(async doc => {
    drawHeader(doc, { schoolName: school.name, title: 'Hall Ticket / Admit Card', subtitle: `${term.name} · ${classLabel(enrollment.class)}` })
    if (photoPath) {
      const y = doc.y
      try { doc.image(photoPath, doc.page.margins.left, y, { width: 100, height: 100, fit: [100, 100] }) } catch { /* unreadable image — skip */ }
      doc.y = y + 112
    }
    drawFields(doc, [
      { label: 'Student name', value: student.name },
      { label: 'Roll number', value: enrollment.rollNo ?? '—' },
      { label: 'Class', value: classLabel(enrollment.class) },
      { label: 'Board', value: enrollment.class.board.name },
      { label: 'Board registration no.', value: boardReg?.registrationNo ?? '—' },
      { label: 'Date of birth', value: student.dob ?? '—' },
    ])
    doc.moveDown(1)
    const rows = assessments.map(a => {
      const seat = seatByAssessment.get(a.id)
      return [a.classSubject.subject.name, a.name, a.date ? fmtDate(a.date) : '—', seat ? seat.plan.room.name : '—', seat ? String(seat.seatNumber) : '—']
    })
    if (!rows.length) rows.push(['No scheduled assessments for this term', '', '', '', ''])
    drawTable(doc, [
      { label: 'Subject', w: 2.5 }, { label: 'Assessment', w: 2.5 }, { label: 'Date', w: 1.5 }, { label: 'Room', w: 1.5 }, { label: 'Seat', w: 1, align: 'right' },
    ], rows)
    await drawFooter(doc, { issuedBy: school.name, issuedOn: fmtLong(now), qrText: `EduNova hall ticket | ${student.name} | ${term.name}` })
  })
  return { bytes, name: `HallTicket-${student.name.replace(/\s+/g, '-')}-${term.name.replace(/\s+/g, '-')}.pdf` }
}
