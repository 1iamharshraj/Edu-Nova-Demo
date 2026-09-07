import type { z } from 'zod'
import type { BoardRegistration } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { assertViewStudent, canWriteClass, isAdmin, isStaff, visibleStudentIds } from '../../lib/scope'
import { drawFields, drawFooter, drawHeader, drawTable, fmtLong, renderToBuffer } from '../../lib/pdf'
import { reportCard } from '../assessments/reports'
import type { createBoardRegistration, patchBoardRegistration, listQuery } from './schema'

export const serializeBoardRegistration = (r: BoardRegistration) => ({
  id: r.id,
  studentId: r.studentId,
  boardId: r.boardId,
  academicYearId: r.academicYearId,
  registrationNo: r.registrationNo ?? undefined,
  rollNo: r.rollNo ?? undefined,
  nameOnCertificate: r.nameOnCertificate,
  dob: r.dob ? fmtDate(r.dob) : undefined,
  affiliationNo: r.affiliationNo ?? undefined,
  status: r.status,
  validatedById: r.validatedById ?? undefined,
  validatedAt: r.validatedAt?.toISOString(),
  sentAt: r.sentAt?.toISOString(),
  mismatchNote: r.mismatchNote ?? undefined,
  createdAt: r.createdAt.toISOString(),
})

const enrollmentInclude = { class: { include: { grade: true, board: true } }, academicYear: true } as const

// The student's enrollment for the registration's academic year (any status; TC'd students keep theirs).
async function enrollmentOf(studentId: string, academicYearId: string) {
  return prisma.enrollment.findUnique({ where: { studentId_academicYearId: { studentId, academicYearId } }, include: enrollmentInclude })
}

// Teachers see registrations of classes they teach; students/parents self/wards; staff/admin all.
async function canView(ctx: Ctx, reg: BoardRegistration) {
  if (isStaff(ctx)) return true
  if (ctx.role === 'teacher') {
    const enr = await enrollmentOf(reg.studentId, reg.academicYearId)
    return enr ? canWriteClass(ctx, enr.classId) : false
  }
  return (await visibleStudentIds(ctx))!.includes(reg.studentId)
}

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.boardRegistration.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Board registration')
  if (!(await canView(ctx, row))) throw new HttpError(403, 'Not permitted to view this registration')
  return row
}

export async function list(ctx: Ctx, q: z.infer<typeof listQuery>) {
  const only = await visibleStudentIds(ctx)
  let studentIds: string[] | undefined = only ?? undefined
  if (ctx.role === 'teacher') {
    const classes = await prisma.class.findMany({
      where: { schoolId: ctx.schoolId, OR: [{ classTeacherId: ctx.actorId }, { classSubjects: { some: { teacherId: ctx.actorId } } }] },
      select: { id: true },
    })
    const enr = await prisma.enrollment.findMany({ where: { classId: { in: classes.map(c => c.id) } }, select: { studentId: true } })
    studentIds = [...new Set(enr.map(e => e.studentId))]
  }
  if (q.classId) {
    const enr = await prisma.enrollment.findMany({ where: { classId: q.classId, schoolId: ctx.schoolId }, select: { studentId: true } })
    const ids = enr.map(e => e.studentId)
    studentIds = studentIds ? studentIds.filter(id => ids.includes(id)) : ids
  }
  if (q.studentId) {
    if (studentIds && !studentIds.includes(q.studentId)) return []
    studentIds = [q.studentId]
  }
  return prisma.boardRegistration.findMany({
    where: { schoolId: ctx.schoolId, status: q.status, studentId: studentIds ? { in: studentIds } : undefined },
    orderBy: [{ createdAt: 'asc' }],
  })
}

async function resolveStudent(ctx: Ctx, studentId: string, academicYearId?: string) {
  const student = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')
  const year = academicYearId
    ? await prisma.academicYear.findFirst({ where: { id: academicYearId, schoolId: ctx.schoolId } })
    : (await prisma.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true } })) ?? (await prisma.academicYear.findFirst({ where: { schoolId: ctx.schoolId }, orderBy: { startDate: 'desc' } }))
  if (!year) throw new HttpError(400, 'No academic year exists')
  const enrollment = await enrollmentOf(studentId, year.id)
  return { student, year, enrollment }
}

async function assertWrite(ctx: Ctx, studentId: string, academicYearId: string) {
  if (isStaff(ctx)) return
  if (ctx.role === 'teacher') {
    const enr = await enrollmentOf(studentId, academicYearId)
    if (!enr || !(await canWriteClass(ctx, enr.classId))) throw new HttpError(403, 'You do not teach this student')
    return
  }
  await assertViewStudent(ctx, studentId)
}

export async function create(ctx: Ctx, input: z.infer<typeof createBoardRegistration>) {
  const { student, year, enrollment } = await resolveStudent(ctx, input.studentId, input.academicYearId)
  await assertWrite(ctx, student.id, year.id)
  const boardId = input.boardId ?? enrollment?.class.boardId
  if (!boardId) throw new HttpError(400, 'boardId is required when the student has no enrollment in that year')
  const board = await prisma.board.findFirst({ where: { id: boardId, schoolId: ctx.schoolId } })
  if (!board) throw notFound('Board')
  const existing = await prisma.boardRegistration.findUnique({ where: { studentId_academicYearId: { studentId: student.id, academicYearId: year.id } } })
  if (existing) throw new HttpError(409, 'A registration already exists for this student and year', { id: existing.id })

  const row = await prisma.boardRegistration.create({
    data: {
      schoolId: ctx.schoolId, studentId: student.id, boardId: board.id, academicYearId: year.id,
      registrationNo: input.registrationNo ?? null, rollNo: input.rollNo ?? enrollment?.rollNo ?? null,
      nameOnCertificate: input.nameOnCertificate ?? student.name, dob: input.dob ? toDate(input.dob) : student.dob ? toDate(student.dob) : null,
      affiliationNo: input.affiliationNo ?? null, status: input.status ?? 'Draft', mismatchNote: input.mismatchNote ?? null,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'boardRegistration', row.id, undefined, serializeBoardRegistration(row))
  return row
}

// POST /prefill { studentId } — returns the existing registration for that year, or builds a Draft from the
// enrollment (board, roll number) and the profile (name, DOB).
export async function prefill(ctx: Ctx, studentId: string, academicYearId?: string) {
  const { student, year } = await resolveStudent(ctx, studentId, academicYearId)
  await assertWrite(ctx, student.id, year.id)
  const existing = await prisma.boardRegistration.findUnique({ where: { studentId_academicYearId: { studentId: student.id, academicYearId: year.id } } })
  if (existing) return existing
  return create(ctx, { studentId: student.id, academicYearId: year.id })
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchBoardRegistration>) {
  const before = await get(ctx, id)
  await assertWrite(ctx, before.studentId, before.academicYearId)
  if (before.status === 'SentToBoard' && !isAdmin(ctx)) throw new HttpError(409, 'Registration has already been sent to the board')
  if (input.boardId) {
    const board = await prisma.board.findFirst({ where: { id: input.boardId, schoolId: ctx.schoolId } })
    if (!board) throw notFound('Board')
  }
  // Editing details after validation drops it back to Pending so it gets re-checked.
  const detailKeys = ['registrationNo', 'rollNo', 'nameOnCertificate', 'dob', 'affiliationNo', 'boardId'] as const
  const touched = detailKeys.some(k => input[k] !== undefined)
  const row = await prisma.boardRegistration.update({
    where: { id },
    data: {
      boardId: input.boardId, registrationNo: input.registrationNo, rollNo: input.rollNo, nameOnCertificate: input.nameOnCertificate,
      dob: input.dob === undefined ? undefined : input.dob ? toDate(input.dob) : null, affiliationNo: input.affiliationNo, mismatchNote: input.mismatchNote,
      status: input.status ?? (touched && before.status === 'Validated' ? 'Pending' : undefined),
      ...(touched && before.status === 'Validated' && !input.status ? { validatedById: null, validatedAt: null } : {}),
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'boardRegistration', id, serializeBoardRegistration(before), serializeBoardRegistration(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.boardRegistration.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'boardRegistration', id, serializeBoardRegistration(before))
}

// Teacher of the student's class, or staff/admin.
export async function validateReg(ctx: Ctx, id: string, mismatchNote?: string | null) {
  const before = await get(ctx, id)
  if (!isStaff(ctx)) {
    const enr = await enrollmentOf(before.studentId, before.academicYearId)
    if (ctx.role !== 'teacher' || !enr || !(await canWriteClass(ctx, enr.classId))) throw new HttpError(403, 'Only the class teacher or the office can validate')
  }
  if (before.status === 'SentToBoard') throw new HttpError(409, 'Registration has already been sent to the board')
  const row = await prisma.boardRegistration.update({
    where: { id }, data: { status: 'Validated', validatedById: ctx.actorId, validatedAt: new Date(), mismatchNote: mismatchNote === undefined ? undefined : mismatchNote },
  })
  await audit(ctx.schoolId, ctx.actorId, 'validate', 'boardRegistration', id, serializeBoardRegistration(before), serializeBoardRegistration(row))
  return row
}

export async function send(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  if (before.status !== 'Validated') throw new HttpError(409, 'Registration must be validated before it is sent to the board')
  const row = await prisma.boardRegistration.update({ where: { id }, data: { status: 'SentToBoard', sentAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'send', 'boardRegistration', id, serializeBoardRegistration(before), serializeBoardRegistration(row))
  return row
}

// GET /:id/marksheet?termId — Phase 3 report card + registration details as a PDF (not stored).
export async function marksheetPdf(ctx: Ctx, id: string, termId: string) {
  const reg = await get(ctx, id)
  const term = await prisma.term.findFirst({ where: { id: termId, schoolId: ctx.schoolId } })
  if (!term) throw notFound('Term')
  // Teachers of the class may print marksheets too; reportCard's own check only restricts students/parents.
  const card = await reportCard(ctx, reg.studentId, termId)
  const [school, board, year, issuer] = await Promise.all([
    prisma.school.findUniqueOrThrow({ where: { id: ctx.schoolId } }),
    prisma.board.findFirst({ where: { id: reg.boardId } }),
    prisma.academicYear.findFirst({ where: { id: reg.academicYearId } }),
    prisma.user.findUniqueOrThrow({ where: { id: ctx.actorId } }),
  ])
  const now = new Date()
  const bytes = await renderToBuffer(async doc => {
    drawHeader(doc, { schoolName: school.name, title: 'Statement of Marks', subtitle: `${board?.name ?? 'Board'} · ${term.name} · ${year?.label ?? ''}`, serial: reg.registrationNo ?? undefined })
    drawFields(doc, [
      { label: 'Name on certificate', value: reg.nameOnCertificate },
      { label: 'Registration no.', value: reg.registrationNo ?? '—' },
      { label: 'Roll number', value: reg.rollNo ?? card.rollNo ?? '—' },
      { label: 'Class', value: card.classLabel ?? '—' },
      { label: 'Date of birth', value: reg.dob ? fmtDate(reg.dob) : '—' },
      { label: 'Affiliation no.', value: reg.affiliationNo ?? '—' },
      { label: 'Registration status', value: reg.status },
    ])
    doc.moveDown(1)
    const rows = card.subjects.map(s => [s.subject, s.assessments.map(a => `${a.name}: ${a.score ?? '—'}/${a.maxMarks}`).join('  '), String(s.total), String(s.max), `${s.pct}%`, s.grade ?? '—'])
    if (!rows.length) rows.push(['No published assessments for this term', '', '', '', '', ''])
    drawTable(doc, [
      { label: 'Subject', w: 3 }, { label: 'Assessments', w: 6 }, { label: 'Total', w: 1.4, align: 'right' }, { label: 'Max', w: 1.2, align: 'right' }, { label: '%', w: 1.2, align: 'right' }, { label: 'Grade', w: 1.2, align: 'center' },
    ], rows)
    doc.moveDown(0.5)
    drawFields(doc, [
      { label: 'Aggregate', value: `${card.overall.total} / ${card.overall.max}  (${card.overall.pct}%)` },
      { label: 'Overall grade', value: card.overall.grade ?? '—' },
      { label: 'Rank in class', value: card.overall.rank ? `${card.overall.rank} of ${card.overall.classSize}` : '—' },
      { label: 'Grade scale', value: card.scale?.name ?? '—' },
    ])
    await drawFooter(doc, { issuedBy: issuer.name, issuedOn: fmtLong(now), qrText: `EduNova marksheet | ${reg.nameOnCertificate} | ${reg.registrationNo ?? reg.id} | ${term.name}` })
  })
  return { bytes, name: `Marksheet-${reg.nameOnCertificate.replace(/\s+/g, '_')}-${term.name.replace(/\s+/g, '_')}.pdf` }
}
