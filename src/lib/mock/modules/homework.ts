// Mirrors server/src/modules/homework/{router,service,schema}.ts's contract for src/lib/hooks (via
// src/portal/modules/classroom.tsx, actions.tsx's HomeworkMod). Teacher/staff/admin write within class
// scope; students submit their own work; parents/students only ever see their own submission rows.

import { route, requireAuth, status } from '../router'
import { badRequest, conflict, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { assertViewClass, assertWriteClassSubject, getClass, getTerm, isStaff, teacherClassIds, visibleStudentIds } from './examsAcademicsScope'

function serializeSubmission(s: Row) {
  return { id: s.id, homeworkId: s.homeworkId, studentId: s.studentId, submittedAt: s.submittedAt, files: s.files ?? [], note: s.note ?? undefined, status: s.status, grade: s.grade ?? undefined, feedback: s.feedback ?? undefined }
}
function serializeHomework(h: Row, submissionsFor: string[] | null) {
  const cs = table('ClassSubject').find(c => c.id === h.classSubjectId)
  const subject = cs ? table('Subject').find(s => s.id === cs.subjectId) : undefined
  const submissions = table('HomeworkSubmission').filter(s => s.homeworkId === h.id && (!submissionsFor || submissionsFor.includes(s.studentId as string)))
  return {
    id: h.id, classSubjectId: h.classSubjectId, classId: cs?.classId, subjectId: cs?.subjectId, subjectName: subject?.name,
    title: h.title, description: h.description, dueDate: h.dueDate, createdById: h.createdById ?? undefined, attachments: h.attachments ?? [],
    createdAt: h.createdAt, submissions: submissions.map(serializeSubmission),
  }
}

function getHomework(schoolId: string, id: string): Row {
  const row = table('Homework').find(h => h.id === id && h.schoolId === schoolId)
  if (!row) throw notFound('Homework')
  return row
}

route('GET', '/homework', (ctx) => {
  const actor = requireAuth(ctx)
  const { classId, termId } = ctx.query
  if (!classId) throw badRequest('classId is required')
  const cls = getClass(actor, classId)
  assertViewClass(actor, cls.id as string)
  const term = termId ? getTerm(actor, termId) : null
  let rows = table('Homework').filter(h => h.schoolId === actor.schoolId && table('ClassSubject').find(c => c.id === h.classSubjectId)?.classId === cls.id)
  if (term) rows = rows.filter(h => String(h.dueDate) >= String(term.startDate) && String(h.dueDate) <= String(term.endDate))
  rows = [...rows].sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate)) || String(b.createdAt).localeCompare(String(a.createdAt)))
  const restricted = actor.role === 'student' || actor.role === 'parent'
  const canWrite = isStaff(actor.role) || (actor.role === 'teacher' && teacherClassIds(actor.userId).includes(cls.id as string))
  const only = restricted ? visibleStudentIds(actor) : canWrite ? null : []
  return { items: rows.map(h => serializeHomework(h, only)) }
})

route('POST', '/homework', (ctx) => {
  const actor = requireAuth(ctx)
  const body = ctx.body as { classSubjectId?: string; title?: string; description?: string; dueDate?: string; attachments?: string[] }
  if (!body.classSubjectId) throw badRequest('classSubjectId is required')
  const cs = table('ClassSubject').find(c => c.id === body.classSubjectId && c.schoolId === actor.schoolId)
  if (!cs) throw notFound('Class subject')
  assertWriteClassSubject(actor, cs.id as string)
  if (!body.title?.trim()) throw badRequest('title is required')
  if (!body.dueDate) throw badRequest('dueDate is required')
  const row: Row = { id: uid('homework'), schoolId: actor.schoolId, classSubjectId: cs.id, title: body.title.trim(), description: body.description ?? '', dueDate: body.dueDate, createdById: actor.userId, attachments: body.attachments ?? [], createdAt: nowIso() }
  const rows = table('Homework'); rows.push(row); saveTable('Homework', rows)
  return status(201, { item: serializeHomework(row, []) })
})

route('PATCH', '/homework/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getHomework(actor.schoolId, ctx.params.id)
  assertWriteClassSubject(actor, before.classSubjectId as string)
  const body = ctx.body as { title?: string; description?: string; dueDate?: string; attachments?: string[] }
  const rows = table('Homework'); const idx = rows.findIndex(h => h.id === before.id)
  rows[idx] = { ...rows[idx], ...(body.title !== undefined ? { title: body.title } : {}), ...(body.description !== undefined ? { description: body.description } : {}), ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}), ...(body.attachments !== undefined ? { attachments: body.attachments } : {}) }
  saveTable('Homework', rows)
  return { item: serializeHomework(rows[idx], []) }
})

route('DELETE', '/homework/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getHomework(actor.schoolId, ctx.params.id)
  assertWriteClassSubject(actor, before.classSubjectId as string)
  const rows = table('Homework'); const idx = rows.findIndex(h => h.id === before.id)
  rows.splice(idx, 1)
  saveTable('Homework', rows)
  saveTable('HomeworkSubmission', table('HomeworkSubmission').filter(s => s.homeworkId !== before.id))
  return { ok: true }
})

route('POST', '/homework/:id/submit', (ctx) => {
  const actor = requireAuth(ctx)
  if (actor.role !== 'student') throw badRequest('Only students submit homework')
  const hw = getHomework(actor.schoolId, ctx.params.id)
  const cs = table('ClassSubject').find(c => c.id === hw.classSubjectId)!
  const enrolled = table('Enrollment').some(e => e.classId === cs.classId && e.studentId === actor.userId && e.status === 'active')
  if (!enrolled) throw badRequest('You are not enrolled in this class')
  const body = ctx.body as { files?: string[]; note?: string | null }
  const existing = table('HomeworkSubmission').find(s => s.homeworkId === hw.id && s.studentId === actor.userId)
  if (existing && (existing.status === 'Graded' || existing.status === 'Returned')) throw conflict('This submission has already been graded')
  const now = new Date()
  const deadline = new Date(`${hw.dueDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000
  const subStatus = now.getTime() >= deadline ? 'Late' : 'Submitted'
  const rows = table('HomeworkSubmission')
  const idx = rows.findIndex(s => s.homeworkId === hw.id && s.studentId === actor.userId)
  const row: Row = { id: existing?.id ?? uid('homeworksubmission'), homeworkId: hw.id, studentId: actor.userId, submittedAt: now.toISOString(), files: body.files ?? [], note: body.note ?? null, status: subStatus, grade: existing?.grade, feedback: existing?.feedback }
  if (idx === -1) rows.push(row); else rows[idx] = row
  saveTable('HomeworkSubmission', rows)
  return { item: serializeSubmission(row) }
})

route('PATCH', '/homework/:id/submissions/:studentId', (ctx) => {
  const actor = requireAuth(ctx)
  const hw = getHomework(actor.schoolId, ctx.params.id)
  assertWriteClassSubject(actor, hw.classSubjectId as string)
  const rows = table('HomeworkSubmission')
  const idx = rows.findIndex(s => s.homeworkId === hw.id && s.studentId === ctx.params.studentId)
  if (idx === -1) throw notFound('Submission')
  const body = ctx.body as { grade?: string | null; feedback?: string | null; status?: string }
  const subStatus = body.status ?? (body.grade ? 'Graded' : body.feedback !== undefined ? 'Returned' : rows[idx].status)
  rows[idx] = { ...rows[idx], ...(body.grade !== undefined ? { grade: body.grade } : {}), ...(body.feedback !== undefined ? { feedback: body.feedback } : {}), status: subStatus }
  saveTable('HomeworkSubmission', rows)
  return { item: serializeSubmission(rows[idx]) }
})
