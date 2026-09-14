// Mirrors server/src/modules/discipline's contract: the disciplinary committee's case list, status
// timeline (each transition writes a DisciplinaryNote) and evidence file attachments. See
// .agents/edunova/static-demo-plan.md and phase-8-welfare.md → "Discipline". Reporters: teacher (only for
// students in their own classes), staff or admin. Parents/students may only read their own/their ward's
// cases. Soft delete (deletedAt) is admin-only and always excluded from the list — the row and its notes
// survive for compliance, matching the real service exactly.

import { route, requireAuth, status, type Actor, type ReqCtx } from '../router'
import { badRequest, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']
const isStaff = (actor: Actor) => STAFF_ROLES.includes(actor.role)
const isAdmin = (actor: Actor) => actor.role === 'admin' || actor.role === 'superadmin'

function teacherClassIds(actor: Actor): Set<string> {
  const viaSubject = table('ClassSubject').filter(cs => cs.schoolId === actor.schoolId && cs.teacherId === actor.userId).map(cs => cs.classId as string)
  const viaClassTeacher = table('Class').filter(c => c.schoolId === actor.schoolId && c.classTeacherId === actor.userId).map(c => c.id)
  return new Set([...viaSubject, ...viaClassTeacher])
}

function activeClassOf(schoolId: string, studentId: string): Row | undefined {
  return table('Enrollment').find(e => e.schoolId === schoolId && e.studentId === studentId && e.status === 'active')
}

/** Every student a parent/student caller may see — a plain student sees only themself. */
function visibleStudentIds(actor: Actor): string[] {
  if (actor.role === 'student') return [actor.userId]
  if (actor.role === 'parent') return table('Guardian').filter(g => g.schoolId === actor.schoolId && g.parentId === actor.userId).map(g => g.studentId as string)
  return []
}

function nameOf(schoolId: string, id?: string | null): string | undefined {
  if (!id) return undefined
  return (table('User').find(u => u.id === id && u.schoolId === schoolId)?.name as string | undefined) ?? undefined
}

function serializeCase(c: Row) {
  return {
    id: c.id, studentId: c.studentId, classId: c.classId ?? undefined, title: c.title, description: c.description,
    reportedById: c.reportedById, witnesses: c.witnesses ?? undefined, fileIds: (c.fileIds as string[] | undefined) ?? [],
    status: c.status, hearingDate: c.hearingDate ?? undefined, decision: c.decision ?? undefined,
    actionTaken: c.actionTaken ?? undefined, appeal: c.appeal ?? undefined, relatedPeople: c.relatedPeople ?? undefined,
    deletedAt: c.deletedAt ?? undefined, createdAt: c.createdAt, updatedAt: c.updatedAt ?? undefined,
    studentName: nameOf(c.schoolId as string, c.studentId as string), reportedByName: nameOf(c.schoolId as string, c.reportedById as string),
  }
}

function serializeNote(n: Row) {
  return { id: n.id, caseId: n.caseId, authorId: n.authorId, body: n.body, createdAt: n.createdAt, authorName: nameOf(n.schoolId as string, n.authorId as string) }
}

route('GET', '/discipline', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const { studentId, classId } = ctx.query
  let rows = table('DisciplinaryCase').filter(c => c.schoolId === actor.schoolId && !c.deletedAt)
  if (studentId) rows = rows.filter(c => c.studentId === studentId)
  if (classId) rows = rows.filter(c => c.classId === classId)

  if (isStaff(actor)) {
    // no further restriction
  } else if (actor.role === 'teacher') {
    const allowed = teacherClassIds(actor)
    if (classId && !allowed.has(classId)) throw forbidden('You do not teach this class')
    rows = rows.filter(c => c.classId && allowed.has(c.classId as string))
  } else {
    const only = visibleStudentIds(actor)
    if (studentId && !only.includes(studentId)) throw forbidden(actor.role === 'parent' ? 'That student is not your ward' : 'You can only view your own cases')
    rows = rows.filter(c => only.includes(c.studentId as string))
  }
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializeCase) }
})

function getVisible(actor: Actor, id: string): Row {
  const row = table('DisciplinaryCase').find(c => c.id === id && c.schoolId === actor.schoolId)
  if (!row) throw notFound('Disciplinary case')
  if (isStaff(actor)) return row
  if (actor.role === 'teacher') {
    if (!row.classId || !teacherClassIds(actor).has(row.classId as string)) throw forbidden('You do not teach this class')
    return row
  }
  if (!visibleStudentIds(actor).includes(row.studentId as string)) throw forbidden('You cannot view this case')
  return row
}

function assertModify(actor: Actor, row: Row) {
  if (row.reportedById !== actor.userId && !isStaff(actor)) throw forbidden('Only the reporter or staff/admin may modify this case')
}

route('POST', '/discipline', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (actor.role !== 'teacher' && !isStaff(actor)) throw forbidden('Only a teacher, staff or admin may report a disciplinary case')
  const body = ctx.body as { studentId?: string; title?: string; description?: string; witnesses?: string; fileIds?: string[]; hearingDate?: string }
  if (!body.studentId) throw badRequest('studentId is required')
  const student = table('User').find(u => u.id === body.studentId && u.schoolId === actor.schoolId && u.role === 'student')
  if (!student) throw notFound('Student')
  if (!body.title?.trim() || !body.description?.trim()) throw badRequest('title and description are required')
  const enrollment = activeClassOf(actor.schoolId, body.studentId)
  if (actor.role === 'teacher') {
    if (!enrollment || !teacherClassIds(actor).has(enrollment.classId as string)) throw forbidden('You do not teach this student’s class')
  }
  const row: Row = {
    id: uid('disciplinarycase'), schoolId: actor.schoolId, studentId: body.studentId, classId: enrollment?.classId ?? null,
    title: body.title.trim(), description: body.description.trim(), reportedById: actor.userId, witnesses: body.witnesses ?? null,
    fileIds: body.fileIds ?? [], hearingDate: body.hearingDate ?? null, status: 'Reported',
    decision: null, actionTaken: null, appeal: null, relatedPeople: null, deletedAt: null, createdAt: nowIso(), updatedAt: nowIso(),
  }
  const rows = table('DisciplinaryCase')
  rows.push(row)
  saveTable('DisciplinaryCase', rows)
  return status(201, { item: serializeCase(row) })
})

route('PATCH', '/discipline/:id', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const before = table('DisciplinaryCase').find(c => c.id === ctx.params.id && c.schoolId === actor.schoolId && !c.deletedAt)
  if (!before) throw notFound('Disciplinary case')
  assertModify(actor, before)
  const body = ctx.body as Partial<{
    title: string; description: string; witnesses: string; fileIds: string[]; hearingDate: string
    decision: string; actionTaken: string; appeal: string; relatedPeople: string
  }>
  const rows = table('DisciplinaryCase')
  const idx = rows.findIndex(c => c.id === before.id)
  rows[idx] = { ...rows[idx], ...body, updatedAt: nowIso() }
  saveTable('DisciplinaryCase', rows)
  return { item: serializeCase(rows[idx]) }
})

const STATUS_CHAIN = ['Reported', 'Scheduled', 'Heard', 'Decision', 'Action Taken', 'Appealed', 'Closed']

route('POST', '/discipline/:id/status', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const before = table('DisciplinaryCase').find(c => c.id === ctx.params.id && c.schoolId === actor.schoolId && !c.deletedAt)
  if (!before) throw notFound('Disciplinary case')
  assertModify(actor, before)
  const body = ctx.body as { status?: string; note?: string; actionTaken?: string }
  if (!body.status || !STATUS_CHAIN.includes(body.status)) throw badRequest('A valid status is required')
  const rows = table('DisciplinaryCase')
  const idx = rows.findIndex(c => c.id === before.id)
  rows[idx] = { ...rows[idx], status: body.status, actionTaken: body.actionTaken ?? rows[idx].actionTaken, updatedAt: nowIso() }
  saveTable('DisciplinaryCase', rows)
  const noteRow: Row = {
    id: uid('disciplinarynote'), schoolId: actor.schoolId, caseId: before.id, authorId: actor.userId,
    body: body.note?.trim() ? `Status → ${body.status}: ${body.note.trim()}` : `Status → ${body.status}`, createdAt: nowIso(),
  }
  const notes = table('DisciplinaryNote')
  notes.push(noteRow)
  saveTable('DisciplinaryNote', notes)
  return { item: serializeCase(rows[idx]) }
})

route('POST', '/discipline/:id/notes', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const row = table('DisciplinaryCase').find(c => c.id === ctx.params.id && c.schoolId === actor.schoolId && !c.deletedAt)
  if (!row) throw notFound('Disciplinary case')
  assertModify(actor, row)
  const { body: noteBody } = ctx.body as { body?: string }
  if (!noteBody?.trim()) throw badRequest('body is required')
  const note: Row = { id: uid('disciplinarynote'), schoolId: actor.schoolId, caseId: row.id, authorId: actor.userId, body: noteBody.trim(), createdAt: nowIso() }
  const notes = table('DisciplinaryNote')
  notes.push(note)
  saveTable('DisciplinaryNote', notes)
  return status(201, { item: serializeNote(note) })
})

route('GET', '/discipline/:id/notes', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  getVisible(actor, ctx.params.id)
  const rows = table('DisciplinaryNote').filter(n => n.caseId === ctx.params.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  return { items: rows.map(serializeNote) }
})

route('DELETE', '/discipline/:id', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!isAdmin(actor)) throw forbidden('Only admin may delete a disciplinary case')
  const rows = table('DisciplinaryCase')
  const idx = rows.findIndex(c => c.id === ctx.params.id && c.schoolId === actor.schoolId && !c.deletedAt)
  if (idx === -1) throw notFound('Disciplinary case')
  rows[idx] = { ...rows[idx], deletedAt: nowIso() }
  saveTable('DisciplinaryCase', rows)
  return { ok: true }
})
