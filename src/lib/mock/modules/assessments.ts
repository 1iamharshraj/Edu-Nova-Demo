// Mirrors server/src/modules/assessments/{router,service,gradeScales,reports,schema}.ts's contract for
// src/lib/hooks/useExams.ts / src/portal/modules/classroom.tsx,aiTools.tsx. Grade scales are admin-managed;
// assessments/marks are written by the class-subject's teacher(s) or staff/admin; report-card/ranks are
// real aggregations over seeded Assessment/Mark rows.

import { route, requireAuth, requireRole, status } from '../router'
import { badRequest, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { isStaff, assertWriteClassSubject, assertViewClass, assertViewStudent, assertOnRoster, enrollmentFor, getClass, getClassSubject, getTerm, isClassTeacherOfStudent, rosterOf, teacherClassIds, visibleStudentIds } from './examsAcademicsScope'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']

// ═══════════════════════════ grade scales ═══════════════════════════

function serializeGradeScale(g: Row) {
  const bands = [...(g.bands as Array<{ min: number; grade: string; points?: number }>)].sort((a, b) => b.min - a.min)
  return { id: g.id, name: g.name, boardId: g.boardId ?? undefined, bands }
}

const DEFAULT_BANDS = [
  { min: 91, grade: 'A1', points: 10 }, { min: 81, grade: 'A2', points: 9 }, { min: 71, grade: 'B1', points: 8 }, { min: 61, grade: 'B2', points: 7 },
  { min: 51, grade: 'C1', points: 6 }, { min: 41, grade: 'C2', points: 5 }, { min: 33, grade: 'D', points: 4 }, { min: 0, grade: 'E', points: 0 },
]
function gradeFor(bands: Array<{ min: number; grade: string; points?: number }>, pct: number) {
  const sorted = [...bands].sort((a, b) => b.min - a.min)
  const hit = sorted.find(b => pct >= b.min) ?? sorted[sorted.length - 1]
  return { grade: hit.grade, points: hit.points }
}
function scaleForBoard(schoolId: string, boardId: string | null | undefined): { id?: string; name: string; bands: Array<{ min: number; grade: string; points?: number }> } {
  if (boardId) {
    const own = table('GradeScale').filter(g => g.schoolId === schoolId && g.boardId === boardId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0]
    if (own) return { id: own.id as string, name: own.name as string, bands: own.bands as never }
  }
  const any = table('GradeScale').filter(g => g.schoolId === schoolId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0]
  if (any) return { id: any.id as string, name: any.name as string, bands: any.bands as never }
  return { name: 'Default (CBSE 8-point)', bands: DEFAULT_BANDS }
}

route('GET', '/assessments/grade-scales', (ctx) => {
  const actor = requireAuth(ctx)
  return { items: table('GradeScale').filter(g => g.schoolId === actor.schoolId).map(serializeGradeScale) }
})
route('POST', '/assessments/grade-scales', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const body = ctx.body as { name?: string; boardId?: string | null; bands?: Array<{ min: number; grade: string; points?: number }> }
  if (!body.name?.trim()) throw badRequest('name is required')
  if (!body.bands?.length) throw badRequest('bands must have at least one entry')
  const row: Row = { id: uid('gradescale'), schoolId: actor.schoolId, name: body.name.trim(), boardId: body.boardId ?? null, bands: body.bands, createdAt: nowIso() }
  const rows = table('GradeScale'); rows.push(row); saveTable('GradeScale', rows)
  return status(201, { item: serializeGradeScale(row) })
})
route('PATCH', '/assessments/grade-scales/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('GradeScale')
  const idx = rows.findIndex(g => g.id === ctx.params.id && g.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Grade scale')
  const body = ctx.body as { name?: string; boardId?: string | null; bands?: Array<{ min: number; grade: string; points?: number }> }
  rows[idx] = { ...rows[idx], ...(body.name !== undefined ? { name: body.name } : {}), ...(body.boardId !== undefined ? { boardId: body.boardId } : {}), ...(body.bands !== undefined ? { bands: body.bands } : {}) }
  saveTable('GradeScale', rows)
  return { item: serializeGradeScale(rows[idx]) }
})
route('DELETE', '/assessments/grade-scales/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('GradeScale')
  const idx = rows.findIndex(g => g.id === ctx.params.id && g.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Grade scale')
  rows.splice(idx, 1)
  saveTable('GradeScale', rows)
  return { ok: true }
})

// ═══════════════════════════ assessments + marks ═══════════════════════════

function serializeMark(m: Row) {
  return { id: m.id, studentId: m.studentId, score: m.score, remark: m.remark ?? undefined }
}
function serializeAssessment(a: Row, marksFor: string[] | null) {
  const cs = table('ClassSubject').find(c => c.id === a.classSubjectId)
  const subject = cs ? table('Subject').find(s => s.id === cs.subjectId) : undefined
  const marks = table('Mark').filter(m => m.assessmentId === a.id && (!marksFor || marksFor.includes(m.studentId as string)))
  return {
    id: a.id, classSubjectId: a.classSubjectId, classId: cs?.classId, subjectId: cs?.subjectId, subjectName: subject?.name,
    termId: a.termId, name: a.name, maxMarks: a.maxMarks, weight: a.weight, date: a.date ?? undefined,
    publishedAt: a.publishedAt ?? undefined, marks: marks.map(serializeMark),
  }
}

route('GET', '/assessments', (ctx) => {
  const actor = requireAuth(ctx)
  const { termId, classSubjectId, classId } = ctx.query
  if (!termId) throw badRequest('termId is required')
  const term = getTerm(actor, termId)
  const resolvedClassId = classSubjectId ? (getClassSubject(actor, classSubjectId).classId as string) : (classId ? getClass(actor, classId).id as string : undefined)
  if (!resolvedClassId) throw badRequest('Provide classSubjectId or classId')
  assertViewClass(actor, resolvedClassId)
  const restricted = actor.role === 'student' || actor.role === 'parent'
  let rows = table('Assessment').filter(a => a.schoolId === actor.schoolId && a.termId === term.id)
  rows = classSubjectId ? rows.filter(a => a.classSubjectId === classSubjectId) : rows.filter(a => table('ClassSubject').find(c => c.id === a.classSubjectId)?.classId === resolvedClassId)
  if (restricted) rows = rows.filter(a => !!a.publishedAt)
  rows = [...rows].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.createdAt).localeCompare(String(b.createdAt)))
  const canWrite = isStaff(actor.role) || (actor.role === 'teacher' && teacherClassIds(actor.userId).includes(resolvedClassId))
  const marksFor = restricted ? visibleStudentIds(actor) : canWrite ? null : []
  return { items: rows.map(a => serializeAssessment(a, marksFor)) }
})

route('POST', '/assessments', (ctx) => {
  const actor = requireAuth(ctx)
  const body = ctx.body as { classSubjectId?: string; termId?: string; name?: string; maxMarks?: number; weight?: number; date?: string | null }
  if (!body.classSubjectId) throw badRequest('classSubjectId is required')
  const cs = getClassSubject(actor, body.classSubjectId)
  if (!body.termId) throw badRequest('termId is required')
  const term = getTerm(actor, body.termId)
  assertWriteClassSubject(actor, cs.id as string)
  if (!body.name?.trim()) throw badRequest('name is required')
  if (!body.maxMarks || body.maxMarks <= 0) throw badRequest('maxMarks must be positive')
  const row: Row = { id: uid('assessment'), schoolId: actor.schoolId, classSubjectId: cs.id, termId: term.id, name: body.name.trim(), maxMarks: body.maxMarks, weight: body.weight ?? 1, date: body.date ?? null, publishedAt: null, createdAt: nowIso(), chapterIds: [] }
  const rows = table('Assessment'); rows.push(row); saveTable('Assessment', rows)
  return status(201, { item: serializeAssessment(row, null) })
})

function getAssessment(schoolId: string, id: string): Row {
  const row = table('Assessment').find(a => a.id === id && a.schoolId === schoolId)
  if (!row) throw notFound('Assessment')
  return row
}

route('PATCH', '/assessments/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getAssessment(actor.schoolId, ctx.params.id)
  assertWriteClassSubject(actor, before.classSubjectId as string)
  const body = ctx.body as { name?: string; maxMarks?: number; weight?: number; date?: string | null }
  if (body.maxMarks !== undefined) {
    const over = table('Mark').filter(m => m.assessmentId === before.id && Number(m.score) > body.maxMarks!)
    if (over.length) throw badRequest(`maxMarks ${body.maxMarks} is below ${over.length} existing score(s)`, { studentId: over.map(m => m.studentId) })
  }
  const rows = table('Assessment')
  const idx = rows.findIndex(a => a.id === before.id)
  rows[idx] = { ...rows[idx], ...(body.name !== undefined ? { name: body.name } : {}), ...(body.maxMarks !== undefined ? { maxMarks: body.maxMarks } : {}), ...(body.weight !== undefined ? { weight: body.weight } : {}), ...(body.date !== undefined ? { date: body.date } : {}) }
  saveTable('Assessment', rows)
  return { item: serializeAssessment(rows[idx], null) }
})

route('DELETE', '/assessments/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getAssessment(actor.schoolId, ctx.params.id)
  assertWriteClassSubject(actor, before.classSubjectId as string)
  const rows = table('Assessment')
  const idx = rows.findIndex(a => a.id === before.id)
  rows.splice(idx, 1)
  saveTable('Assessment', rows)
  saveTable('Mark', table('Mark').filter(m => m.assessmentId !== before.id))
  return { ok: true }
})

route('PUT', '/assessments/:id/marks', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getAssessment(actor.schoolId, ctx.params.id)
  assertWriteClassSubject(actor, before.classSubjectId as string)
  const { marks } = ctx.body as { marks: Array<{ studentId: string; score: number; remark?: string | null }> }
  const ids = marks.map(m => m.studentId)
  if (new Set(ids).size !== ids.length) throw badRequest('Duplicate studentId in marks')
  const cs = table('ClassSubject').find(c => c.id === before.classSubjectId)!
  assertOnRoster(cs.classId as string, ids)
  const over = marks.filter(m => m.score > Number(before.maxMarks))
  if (over.length) throw badRequest(`score must be <= maxMarks (${before.maxMarks})`, { studentId: over.map(m => m.studentId) })
  const rows = table('Mark')
  for (const m of marks) {
    const idx = rows.findIndex(x => x.assessmentId === before.id && x.studentId === m.studentId)
    if (idx === -1) rows.push({ id: uid('mark'), assessmentId: before.id, studentId: m.studentId, score: m.score, remark: m.remark ?? null, updatedAt: nowIso() })
    else rows[idx] = { ...rows[idx], score: m.score, remark: m.remark === undefined ? rows[idx].remark : m.remark, updatedAt: nowIso() }
  }
  saveTable('Mark', rows)
  return { item: serializeAssessment(before, null) }
})

route('POST', '/assessments/:id/publish', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getAssessment(actor.schoolId, ctx.params.id)
  assertWriteClassSubject(actor, before.classSubjectId as string)
  const rows = table('Assessment'); const idx = rows.findIndex(a => a.id === before.id)
  rows[idx] = { ...rows[idx], publishedAt: nowIso() }
  saveTable('Assessment', rows)
  return { item: serializeAssessment(rows[idx], null) }
})
route('POST', '/assessments/:id/unpublish', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getAssessment(actor.schoolId, ctx.params.id)
  assertWriteClassSubject(actor, before.classSubjectId as string)
  const rows = table('Assessment'); const idx = rows.findIndex(a => a.id === before.id)
  rows[idx] = { ...rows[idx], publishedAt: null }
  saveTable('Assessment', rows)
  return { item: serializeAssessment(rows[idx], null) }
})

// ═══════════════════════════ report card + ranks + remark ═══════════════════════════

const pct1 = (total: number, max: number) => (max ? Math.round((total / max) * 1000) / 10 : 0)

function publishedFor(classId: string, termId: string) {
  return table('Assessment').filter(a => a.termId === termId && !!a.publishedAt && table('ClassSubject').find(c => c.id === a.classSubjectId)?.classId === classId)
    .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.createdAt).localeCompare(String(b.createdAt)))
}

function rankRows(roster: { id: string; name: string; rollNo?: string }[], assessments: Row[]) {
  const rows = roster.map(s => {
    let total = 0, max = 0
    for (const a of assessments) {
      const m = table('Mark').find(x => x.assessmentId === a.id && x.studentId === s.id)
      total += (Number(m?.score) || 0) * Number(a.weight)
      max += Number(a.maxMarks) * Number(a.weight)
    }
    return { studentId: s.id, name: s.name, rollNo: s.rollNo, total: Math.round(total * 100) / 100, max: Math.round(max * 100) / 100, pct: pct1(total, max), rank: 0 }
  })
  rows.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name))
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].pct === r.pct ? rows[i - 1].rank : i + 1 })
  return rows
}

route('GET', '/assessments/ranks', (ctx) => {
  const actor = requireAuth(ctx)
  const { classId, termId } = ctx.query
  if (!classId || !termId) throw badRequest('classId and termId are required')
  const cls = getClass(actor, classId)
  const term = getTerm(actor, termId)
  assertViewClass(actor, cls.id as string)
  const roster = rosterOf(cls.id as string)
  const assessments = publishedFor(cls.id as string, term.id as string)
  const scale = scaleForBoard(actor.schoolId, cls.boardId as string | undefined)
  const grade = table('Grade').find(g => g.id === cls.gradeId)
  const items = rankRows(roster, assessments).map(r => ({ ...r, grade: assessments.length ? gradeFor(scale.bands, r.pct).grade : undefined }))
  return { classId: cls.id, classLabel: `${grade?.label ?? '?'}-${cls.section}`, termId: term.id, assessments: assessments.length, items }
})

route('GET', '/assessments/report-card', (ctx) => {
  const actor = requireAuth(ctx)
  const { studentId, termId } = ctx.query
  if (!studentId || !termId) throw badRequest('studentId and termId are required')
  assertViewStudent(actor, studentId)
  const term = getTerm(actor, termId)
  const student = table('User').find(u => u.id === studentId && u.role === 'student' && u.schoolId === actor.schoolId)
  if (!student) throw notFound('Student')
  const enrollment = enrollmentFor(studentId, term.academicYearId as string)
  if (!enrollment) {
    return { studentId, name: student.name, termId: term.id, classId: undefined, classLabel: undefined, scale: undefined, subjects: [], overall: { total: 0, max: 0, pct: 0, grade: undefined, rank: undefined, classSize: 0 }, remark: undefined }
  }
  const cls = table('Class').find(c => c.id === enrollment.classId)!
  const grade = table('Grade').find(g => g.id === cls.gradeId)
  const board = table('Board').find(b => b.id === cls.boardId)
  const roster = rosterOf(cls.id as string)
  const assessments = publishedFor(cls.id as string, term.id as string)
  const scale = scaleForBoard(actor.schoolId, cls.boardId as string | undefined)

  const bySubject = new Map<string, { subjectId: string; subject: string; color: string; assessments: unknown[]; total: number; max: number }>()
  for (const a of assessments) {
    const cs = table('ClassSubject').find(c => c.id === a.classSubjectId)!
    const subject = table('Subject').find(s => s.id === cs.subjectId)!
    const s = bySubject.get(cs.subjectId as string) ?? { subjectId: cs.subjectId as string, subject: subject.name as string, color: subject.color as string, assessments: [], total: 0, max: 0 }
    const m = table('Mark').find(x => x.assessmentId === a.id && x.studentId === studentId)
    s.assessments.push({ id: a.id, name: a.name, date: a.date ?? undefined, score: m?.score, maxMarks: a.maxMarks, weight: a.weight, remark: m?.remark ?? undefined })
    s.total += (Number(m?.score) || 0) * Number(a.weight)
    s.max += Number(a.maxMarks) * Number(a.weight)
    bySubject.set(cs.subjectId as string, s)
  }
  const subjects = [...bySubject.values()].map(s => {
    const pct = pct1(s.total, s.max)
    const g = gradeFor(scale.bands, pct)
    return { ...s, total: Math.round(s.total * 100) / 100, max: Math.round(s.max * 100) / 100, pct, grade: g.grade, points: g.points }
  })
  const ranked = rankRows(roster, assessments)
  const mine = ranked.find(r => r.studentId === studentId)
  const overallPct = mine?.pct ?? 0
  const remarks = (enrollment.remarks && typeof enrollment.remarks === 'object' ? enrollment.remarks : {}) as Record<string, { text: string }>
  return {
    studentId, name: student.name, termId: term.id, classId: cls.id, classLabel: `${grade?.label ?? '?'}-${cls.section}`, boardCode: board?.code, rollNo: enrollment.rollNo ?? undefined,
    scale: { id: scale.id, name: scale.name, bands: scale.bands }, subjects,
    overall: { total: mine?.total ?? 0, max: mine?.max ?? 0, pct: overallPct, grade: assessments.length ? gradeFor(scale.bands, overallPct).grade : undefined, rank: assessments.length ? mine?.rank : undefined, classSize: roster.length },
    remark: remarks[term.id as string]?.text,
  }
})

route('PUT', '/assessments/report-card/remark', (ctx) => {
  const actor = requireAuth(ctx)
  const { studentId, termId, remark } = ctx.body as { studentId?: string; termId?: string; remark?: string }
  if (!studentId || !termId || !remark?.trim()) throw badRequest('studentId, termId and remark are required')
  if (!isStaff(actor.role) && !isClassTeacherOfStudent(actor, studentId)) throw badRequest('Only the class teacher, staff, or admin may set this student\'s report-card remark')
  const term = getTerm(actor, termId)
  const enrollment = enrollmentFor(studentId, term.academicYearId as string)
  if (!enrollment) throw badRequest('Student is not enrolled for this term\'s academic year')
  const rows = table('Enrollment')
  const idx = rows.findIndex(e => e.id === enrollment.id)
  const before = (rows[idx].remarks && typeof rows[idx].remarks === 'object' ? rows[idx].remarks : {}) as Record<string, unknown>
  const entry = { text: remark, updatedById: actor.userId, updatedAt: nowIso() }
  rows[idx] = { ...rows[idx], remarks: { ...before, [term.id as string]: entry } }
  saveTable('Enrollment', rows)
  return { studentId, termId: term.id, remark: entry.text }
})
