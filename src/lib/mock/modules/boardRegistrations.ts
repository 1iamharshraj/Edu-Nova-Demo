// Mirrors server/src/modules/boardRegistrations's contract: scoped like the real module (student self,
// parent wards, teacher classes, staff/admin all), prefill-from-enrollment, validate/send state machine,
// and a marksheet "PDF" placeholder (no stored bytes in the static demo — see modules/certificates.ts's
// GET /:id/pdf for the same pattern).

import { route, requireAuth, requireRole, status, type Actor } from '../router'
import { badRequest, conflict, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']
const WRITE_ROLES = ['admin', 'superadmin']

function isStaff(role: string) {
  return STAFF_ROLES.includes(role)
}

function serializeBoardRegistration(r: Row) {
  return {
    id: r.id, studentId: r.studentId, boardId: r.boardId, academicYearId: r.academicYearId,
    registrationNo: r.registrationNo ?? undefined, rollNo: r.rollNo ?? undefined, nameOnCertificate: r.nameOnCertificate,
    dob: r.dob ?? undefined, affiliationNo: r.affiliationNo ?? undefined, status: r.status,
    validatedById: r.validatedById ?? undefined, validatedAt: r.validatedAt ?? undefined, sentAt: r.sentAt ?? undefined,
    mismatchNote: r.mismatchNote ?? undefined, createdAt: r.createdAt,
  }
}

function teacherClassIds(actor: Actor): string[] {
  return table('Class')
    .filter(c => c.schoolId === actor.schoolId && (c.classTeacherId === actor.userId || table('ClassSubject').some(cs => cs.classId === c.id && cs.teacherId === actor.userId)))
    .map(c => c.id)
}
function wardIdsOf(actor: Actor): string[] {
  return table('Guardian').filter(g => g.parentId === actor.userId && g.schoolId === actor.schoolId).map(g => g.studentId as string)
}
function enrollmentOf(studentId: string, academicYearId: string) {
  return table('Enrollment').find(e => e.studentId === studentId && e.academicYearId === academicYearId)
}
function canView(actor: Actor, reg: Row): boolean {
  if (isStaff(actor.role)) return true
  if (actor.role === 'teacher') {
    const enr = enrollmentOf(reg.studentId as string, reg.academicYearId as string)
    return !!enr && teacherClassIds(actor).includes(enr.classId as string)
  }
  if (actor.role === 'student') return reg.studentId === actor.userId
  if (actor.role === 'parent') return wardIdsOf(actor).includes(reg.studentId as string)
  return false
}
function assertWrite(actor: Actor, studentId: string, academicYearId: string) {
  if (isStaff(actor.role)) return
  if (actor.role === 'teacher') {
    const enr = enrollmentOf(studentId, academicYearId)
    if (!enr || !teacherClassIds(actor).includes(enr.classId as string)) throw forbidden('You do not teach this student')
    return
  }
  throw forbidden('Not permitted to edit this registration')
}

route('GET', '/board-registrations', (ctx) => {
  const actor = requireAuth(ctx)
  const { studentId, classId, status: st } = ctx.query
  let rows = table('BoardRegistration').filter(r => r.schoolId === actor.schoolId)
  if (st) rows = rows.filter(r => r.status === st)
  if (studentId) rows = rows.filter(r => r.studentId === studentId)
  if (classId) {
    const ids = new Set(table('Enrollment').filter(e => e.classId === classId).map(e => e.studentId))
    rows = rows.filter(r => ids.has(r.studentId))
  }
  rows = rows.filter(r => canView(actor, r)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  return { items: rows.map(serializeBoardRegistration) }
})

function resolveStudentAndYear(studentId: string, academicYearId: string | undefined, schoolId: string) {
  const student = table('User').find(u => u.id === studentId && u.role === 'student' && u.schoolId === schoolId)
  if (!student) throw notFound('Student')
  const year = academicYearId
    ? table('AcademicYear').find(y => y.id === academicYearId && y.schoolId === schoolId)
    : table('AcademicYear').find(y => y.schoolId === schoolId && y.isCurrent)
      ?? [...table('AcademicYear').filter(y => y.schoolId === schoolId)].sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))[0]
  if (!year) throw badRequest('No academic year exists')
  const enrollment = enrollmentOf(studentId, year.id as string)
  return { student, year, enrollment }
}

function createRow(actor: Actor, input: {
  studentId: string; boardId?: string; academicYearId?: string; registrationNo?: string | null; rollNo?: string | null
  nameOnCertificate?: string; dob?: string | null; affiliationNo?: string | null; status?: string; mismatchNote?: string | null
}): Row {
  const { student, year, enrollment } = resolveStudentAndYear(input.studentId, input.academicYearId, actor.schoolId)
  assertWrite(actor, student.id, year.id as string)
  const enrolledClass = enrollment ? table('Class').find(c => c.id === enrollment.classId) : undefined
  const boardId = input.boardId ?? (enrolledClass?.boardId as string | undefined)
  if (!boardId) throw badRequest('boardId is required when the student has no enrollment in that year')
  const board = table('Board').find(b => b.id === boardId && b.schoolId === actor.schoolId)
  if (!board) throw notFound('Board')
  const rows = table('BoardRegistration')
  const existing = rows.find(r => r.studentId === student.id && r.academicYearId === year.id)
  if (existing) throw conflict('A registration already exists for this student and year', { id: existing.id })
  const row: Row = {
    id: uid('boardregistration'), schoolId: actor.schoolId, studentId: student.id, boardId: board.id, academicYearId: year.id,
    registrationNo: input.registrationNo ?? null, rollNo: input.rollNo ?? (enrollment?.rollNo as string | undefined) ?? null,
    nameOnCertificate: input.nameOnCertificate ?? student.name, dob: input.dob ?? (student.dob as string | undefined) ?? null,
    affiliationNo: input.affiliationNo ?? null, status: input.status ?? 'Draft', validatedById: null, validatedAt: null, sentAt: null,
    mismatchNote: input.mismatchNote ?? null, createdAt: nowIso(), updatedAt: nowIso(),
  }
  rows.push(row)
  saveTable('BoardRegistration', rows)
  return row
}

route('POST', '/board-registrations/prefill', (ctx) => {
  const actor = requireAuth(ctx)
  const { studentId, academicYearId } = ctx.body as { studentId?: string; academicYearId?: string }
  if (!studentId) throw badRequest('studentId is required')
  const { student, year } = resolveStudentAndYear(studentId, academicYearId, actor.schoolId)
  assertWrite(actor, student.id, year.id as string)
  const existing = table('BoardRegistration').find(r => r.studentId === student.id && r.academicYearId === year.id)
  const row = existing ?? createRow(actor, { studentId: student.id, academicYearId: year.id as string })
  return { item: serializeBoardRegistration(row) }
})

route('POST', '/board-registrations', (ctx) => {
  const actor = requireAuth(ctx)
  const body = ctx.body as { studentId?: string } & Record<string, unknown>
  if (!body.studentId) throw badRequest('studentId is required')
  const row = createRow(actor, body as { studentId: string })
  return status(201, { item: serializeBoardRegistration(row) })
})

route('GET', '/board-registrations/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const row = table('BoardRegistration').find(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (!row) throw notFound('Board registration')
  if (!canView(actor, row)) throw forbidden('Not permitted to view this registration')
  return { item: serializeBoardRegistration(row) }
})

route('PATCH', '/board-registrations/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('BoardRegistration')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Board registration')
  const before = rows[idx]
  assertWrite(actor, before.studentId as string, before.academicYearId as string)
  if (before.status === 'SentToBoard' && !WRITE_ROLES.includes(actor.role)) throw conflict('Registration has already been sent to the board')
  const body = ctx.body as Partial<{ boardId: string; registrationNo: string | null; rollNo: string | null; nameOnCertificate: string; dob: string | null; affiliationNo: string | null; status: string; mismatchNote: string | null }>
  if (body.boardId) {
    const board = table('Board').find(b => b.id === body.boardId && b.schoolId === actor.schoolId)
    if (!board) throw notFound('Board')
  }
  const detailKeys = ['registrationNo', 'rollNo', 'nameOnCertificate', 'dob', 'affiliationNo', 'boardId'] as const
  const touched = detailKeys.some(k => (body as Record<string, unknown>)[k] !== undefined)
  const next: Row = { ...before, ...body, updatedAt: nowIso() }
  if (touched && !body.status && before.status === 'Validated') {
    next.status = 'Pending'
    next.validatedById = null
    next.validatedAt = null
  }
  rows[idx] = next
  saveTable('BoardRegistration', rows)
  return { item: serializeBoardRegistration(rows[idx]) }
})

route('DELETE', '/board-registrations/:id', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const rows = table('BoardRegistration')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Board registration')
  rows.splice(idx, 1)
  saveTable('BoardRegistration', rows)
  return { ok: true }
})

route('POST', '/board-registrations/:id/validate', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('BoardRegistration')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Board registration')
  const before = rows[idx]
  if (!isStaff(actor.role)) {
    const enr = enrollmentOf(before.studentId as string, before.academicYearId as string)
    if (actor.role !== 'teacher' || !enr || !teacherClassIds(actor).includes(enr.classId as string)) throw forbidden('Only the class teacher or the office can validate')
  }
  if (before.status === 'SentToBoard') throw conflict('Registration has already been sent to the board')
  const { mismatchNote } = ctx.body as { mismatchNote?: string | null }
  rows[idx] = { ...before, status: 'Validated', validatedById: actor.userId, validatedAt: nowIso(), mismatchNote: mismatchNote === undefined ? before.mismatchNote : mismatchNote, updatedAt: nowIso() }
  saveTable('BoardRegistration', rows)
  return { item: serializeBoardRegistration(rows[idx]) }
})

route('POST', '/board-registrations/:id/send', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const rows = table('BoardRegistration')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Board registration')
  if (rows[idx].status !== 'Validated') throw conflict('Registration must be validated before it is sent to the board')
  rows[idx] = { ...rows[idx], status: 'SentToBoard', sentAt: nowIso(), updatedAt: nowIso() }
  saveTable('BoardRegistration', rows)
  return { item: serializeBoardRegistration(rows[idx]) }
})

// No stored PDF bytes in the static demo — `fetchAuthed()` in api.ts synthesizes a placeholder blob for
// any JSON response without a `dataUrl` (see modules/certificates.ts's GET /:id/pdf for the same pattern).
route('GET', '/board-registrations/:id/marksheet', (ctx) => {
  const actor = requireAuth(ctx)
  const row = table('BoardRegistration').find(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (!row) throw notFound('Board registration')
  if (!canView(actor, row)) throw forbidden('Not permitted to view this registration')
  return {}
})
