// Mirrors server/src/modules/applications's contract: the admissions pipeline (Pending → Verified →
// Approved/Declined) plus TC/Bonafide/Character certificate requests. The Admission-approve flow
// atomically creates a student + parent (or links an existing parent by email) + Enrollment + Guardian,
// and hands off the small health-intake subset into HealthRecord — same shape as the real
// modules/applications/service.ts#approveAdmission transaction. The non-Admission approve flow issues a
// certificate via modules/certificates.ts, and for a TC first resolves every held original document via
// modules/admissionDocuments.ts#resolveHeldOriginalsForTc (blocking with a 409 listing what's still
// outstanding if anything is left unresolved) before ending the enrollment.

import { route, requireAuth, requireRole, status } from '../router'
import { badRequest, conflict, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import * as admissionDocuments from './admissionDocuments'
import * as certificates from './certificates'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']
const WRITE_ROLES = ['admin', 'superadmin']
const APPLICATION_KINDS = ['Admission', 'TC', 'Bonafide', 'Character']

function isStaff(role: string) {
  return STAFF_ROLES.includes(role)
}
function isRestricted(role: string) {
  return role === 'parent' || role === 'student'
}
function visibleStudentIds(actor: { role: string; userId: string; schoolId: string }): string[] {
  if (actor.role === 'student') return [actor.userId]
  if (actor.role === 'parent') return table('Guardian').filter(g => g.parentId === actor.userId && g.schoolId === actor.schoolId).map(g => g.studentId as string)
  return []
}

interface Guardian { name: string; phone?: string; email?: string; relation?: string }
interface HealthFlags { allergies?: string; conditions?: string; bloodGroup?: string }

export function serializeApplication(a: Row) {
  return {
    id: a.id, kind: a.kind, applicantName: a.applicantName, dob: a.dob ?? undefined, gender: a.gender ?? undefined,
    guardian: a.guardian ?? undefined, targetClassId: a.targetClassId ?? undefined, targetBoardId: a.targetBoardId ?? undefined,
    studentId: a.studentId ?? undefined, documents: (a.documents as string[] | undefined) ?? [], status: a.status, notes: a.notes ?? undefined,
    submittedById: a.submittedById ?? undefined, decidedById: a.decidedById ?? undefined, decidedAt: a.decidedAt ?? undefined,
    createdAt: a.createdAt, certificateId: table('Certificate').find(c => c.applicationId === a.id)?.id,
    previousSchoolName: a.previousSchoolName ?? undefined, previousBoardId: a.previousBoardId ?? undefined,
    lastGradeCompleted: a.lastGradeCompleted ?? undefined, priorSubjectScores: (a.priorSubjectScores as unknown[] | undefined) ?? [],
    declaredTrackPreference: a.declaredTrackPreference ?? undefined, siblingStudentId: a.siblingStudentId ?? undefined,
    admissionCategoryId: a.admissionCategoryId ?? undefined, admissionMode: a.admissionMode ?? undefined,
    healthFlags: a.healthFlags ?? undefined, transportRequired: a.transportRequired ?? false,
    transportPreferredArea: a.transportPreferredArea ?? undefined, transportHandledAt: a.transportHandledAt ?? undefined,
  }
}

function assertTargets(schoolId: string, input: { targetClassId?: string | null; targetBoardId?: string | null; previousBoardId?: string | null; admissionCategoryId?: string | null; siblingStudentId?: string | null }) {
  if (input.targetClassId && !table('Class').some(c => c.id === input.targetClassId && c.schoolId === schoolId)) throw notFound('Target class')
  if (input.targetBoardId && !table('Board').some(b => b.id === input.targetBoardId && b.schoolId === schoolId)) throw notFound('Target board')
  if (input.previousBoardId && !table('Board').some(b => b.id === input.previousBoardId && b.schoolId === schoolId)) throw notFound('Previous board')
  if (input.admissionCategoryId && !table('AdmissionCategory').some(c => c.id === input.admissionCategoryId && c.schoolId === schoolId)) throw notFound('Admission category')
  if (input.siblingStudentId && !table('User').some(s => s.id === input.siblingStudentId && s.schoolId === schoolId && s.role === 'student')) throw notFound('Sibling student')
}

function assertOpen(row: Row) {
  if (row.status === 'Approved' || row.status === 'Declined') throw conflict(`Application is already ${String(row.status).toLowerCase()}`)
}

/* ── sibling lookup — derived from a shared Guardian contact (phone/email), not a stored field ── */

route('GET', '/applications/sibling-suggestions', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { phone, email } = ctx.query
  if (!phone && !email) return { items: [] }
  const parentIds = new Set(
    table('User').filter(u => u.schoolId === actor.schoolId && u.role === 'parent' && ((phone && u.phone === phone) || (email && String(u.email).toLowerCase() === email.toLowerCase()))).map(u => u.id),
  )
  const guardians = table('Guardian').filter(g => g.schoolId === actor.schoolId && parentIds.has(g.parentId as string))
  const seen = new Set<string>()
  const items: Array<{ studentId: string; name: string; classLabel?: string }> = []
  for (const g of guardians) {
    const studentId = g.studentId as string
    if (seen.has(studentId)) continue
    const enr = table('Enrollment').find(e => e.studentId === studentId && e.status === 'active')
    if (!enr) continue
    seen.add(studentId)
    const student = table('User').find(u => u.id === studentId)
    if (!student) continue
    const cls = table('Class').find(c => c.id === enr.classId)
    const grade = cls ? table('Grade').find(g2 => g2.id === cls.gradeId) : undefined
    items.push({ studentId, name: student.name as string, classLabel: cls && grade ? `${grade.label}-${cls.section}` : undefined })
  }
  return { items }
})

/* ── transport-requirement staff to-do surface ── */

route('GET', '/applications/transport-todos', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const apps = table('Application').filter(a => a.schoolId === actor.schoolId && a.kind === 'Admission' && a.status === 'Approved' && a.transportRequired && !a.transportHandledAt && a.studentId)
  return {
    items: apps.map(a => ({
      applicationId: a.id, studentId: a.studentId, applicantName: a.applicantName, transportPreferredArea: a.transportPreferredArea ?? undefined,
      alreadyAssigned: table('StudentStopAssignment').some(s => s.studentId === a.studentId),
    })),
  }
})

route('POST', '/applications/:id/transport-handled', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('Application')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Application')
  rows[idx] = { ...rows[idx], transportHandledAt: nowIso() }
  saveTable('Application', rows)
  return { item: serializeApplication(rows[idx]) }
})

/* ── list / get / create / update ── */

route('GET', '/applications', (ctx) => {
  const actor = requireAuth(ctx)
  const { kind, status: st } = ctx.query
  let rows = table('Application').filter(a => a.schoolId === actor.schoolId)
  if (kind) rows = rows.filter(a => a.kind === kind)
  if (st) rows = rows.filter(a => a.status === st)
  if (isRestricted(actor.role)) {
    const ids = visibleStudentIds(actor)
    rows = rows.filter(a => a.submittedById === actor.userId || (a.studentId && ids.includes(a.studentId as string)))
  }
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializeApplication) }
})

route('GET', '/applications/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const row = table('Application').find(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (!row) throw notFound('Application')
  if (isRestricted(actor.role)) {
    const ids = visibleStudentIds(actor)
    const mine = row.submittedById === actor.userId || (row.studentId && ids.includes(row.studentId as string))
    if (!mine) throw forbidden('Not your application')
  }
  return { item: serializeApplication(row) }
})

route('POST', '/applications', (ctx) => {
  const actor = requireAuth(ctx)
  const body = ctx.body as {
    kind?: string; applicantName?: string; dob?: string | null; gender?: string | null; guardian?: Guardian | null
    targetClassId?: string | null; targetBoardId?: string | null; studentId?: string; documents?: string[]; notes?: string | null
    previousSchoolName?: string | null; previousBoardId?: string | null; lastGradeCompleted?: string | null
    priorSubjectScores?: Array<{ subjectName: string; score: number; maxScore: number }>; declaredTrackPreference?: string | null
    siblingStudentId?: string | null; admissionCategoryId?: string | null; admissionMode?: string | null; healthFlags?: HealthFlags | null
    transportRequired?: boolean; transportPreferredArea?: string | null
  }
  if (!body.kind || !APPLICATION_KINDS.includes(body.kind)) throw badRequest('kind must be one of Admission, TC, Bonafide, Character')
  if (actor.role === 'teacher') throw forbidden('Teachers cannot file applications')
  if (body.kind === 'Admission' && isRestricted(actor.role)) throw forbidden('Admission applications are filed by the office')

  let applicantName = body.applicantName
  let dob = body.dob ?? null
  if (body.kind === 'Admission') {
    if (!applicantName?.trim()) throw badRequest('applicantName is required for an Admission application')
    if (!body.guardian?.name) throw badRequest('guardian is required for an Admission application')
  } else {
    if (!body.studentId) throw badRequest(`studentId is required for a ${body.kind} application`)
    const student = table('User').find(u => u.id === body.studentId && u.role === 'student' && u.schoolId === actor.schoolId)
    if (!student) throw notFound('Student')
    applicantName = applicantName ?? (student.name as string)
    dob = dob ?? ((student.dob as string | undefined) ?? null)
  }
  assertTargets(actor.schoolId, body)

  const row: Row = {
    id: uid('application'), schoolId: actor.schoolId, kind: body.kind, applicantName, dob, gender: body.gender ?? null,
    guardian: body.guardian ?? null, targetClassId: body.targetClassId ?? null, targetBoardId: body.targetBoardId ?? null,
    studentId: body.kind === 'Admission' ? null : body.studentId, documents: body.documents ?? [], status: 'Pending',
    notes: body.notes ?? null, submittedById: actor.userId, decidedById: null, decidedAt: null, createdAt: nowIso(),
    previousSchoolName: body.previousSchoolName ?? null, previousBoardId: body.previousBoardId ?? null,
    lastGradeCompleted: body.lastGradeCompleted ?? null,
    priorSubjectScores: (body.priorSubjectScores ?? []).map(s => ({ id: uid('priorsubjectscore'), subjectName: s.subjectName, score: s.score, maxScore: s.maxScore })),
    declaredTrackPreference: body.declaredTrackPreference ?? null, siblingStudentId: body.siblingStudentId ?? null,
    admissionCategoryId: body.admissionCategoryId ?? null, admissionMode: body.admissionMode ?? null, healthFlags: body.healthFlags ?? null,
    transportRequired: body.transportRequired ?? false, transportPreferredArea: body.transportPreferredArea ?? null, transportHandledAt: null,
  }
  const rows = table('Application')
  rows.push(row)
  saveTable('Application', rows)
  return status(201, { item: serializeApplication(row) })
})

route('PATCH', '/applications/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('Application')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Application')
  const before = rows[idx]
  if (!isStaff(actor.role)) {
    if (before.submittedById !== actor.userId) throw forbidden('Only the applicant can edit this application')
    if (before.status !== 'Pending') throw conflict('Application can no longer be edited')
  }
  const body = ctx.body as Partial<{ targetClassId: string | null; targetBoardId: string | null; previousBoardId: string | null; admissionCategoryId: string | null; siblingStudentId: string | null }> & Record<string, unknown>
  assertTargets(actor.schoolId, body)
  rows[idx] = { ...before, ...body }
  saveTable('Application', rows)
  return { item: serializeApplication(rows[idx]) }
})

route('POST', '/applications/:id/verify', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('Application')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Application')
  assertOpen(rows[idx])
  rows[idx] = { ...rows[idx], status: 'Verified' }
  saveTable('Application', rows)
  return { item: serializeApplication(rows[idx]) }
})

route('POST', '/applications/:id/decline', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('Application')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Application')
  assertOpen(rows[idx])
  const { notes } = ctx.body as { notes?: string }
  rows[idx] = { ...rows[idx], status: 'Declined', notes: notes ?? rows[idx].notes, decidedById: actor.userId, decidedAt: nowIso() }
  saveTable('Application', rows)
  return { item: serializeApplication(rows[idx]) }
})

route('DELETE', '/applications/:id', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const rows = table('Application')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Application')
  rows.splice(idx, 1)
  saveTable('Application', rows)
  return { ok: true }
})

/* ── approve — the big one: Admission creates accounts, TC/Bonafide/Character issue a certificate ── */

function makeEmailBase(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.+|\.+$/g, '') || 'user'
}
function freeEmail(base: string, users: Row[]): string {
  const domain = 'edunova.in'
  for (let i = 0; i < 200; i++) {
    const email = i === 0 ? `${base}@${domain}` : `${base}${i + 1}@${domain}`
    if (!users.some(u => String(u.email).toLowerCase() === email)) return email
  }
  throw conflict('Could not allocate a unique email')
}

interface AdmissionCreated {
  student: { id: string; email: string; password: string }
  parent: { id: string; email: string; password: string; existing?: boolean }
}

function approveAdmission(actor: { userId: string; role: string; schoolId: string }, before: Row): { row: Row; created: AdmissionCreated } {
  if (!before.targetClassId) throw badRequest('targetClassId must be set before an Admission can be approved')
  const cls = table('Class').find(c => c.id === before.targetClassId && c.schoolId === actor.schoolId)
  if (!cls) throw notFound('Target class')
  const guardian = (before.guardian ?? null) as Guardian | null
  if (!guardian?.name) throw badRequest('guardian must be set before an Admission can be approved')

  const enrollments = table('Enrollment').filter(e => e.classId === cls.id)
  const rollNo = String(enrollments.reduce((m, e) => Math.max(m, Number(e.rollNo) || 0), 0) + 1)
  const hue = Math.floor(Math.random() * 360)
  const grade = table('Grade').find(g => g.id === cls.gradeId)
  const gradeLabel = (grade?.label as string | undefined) ?? '?'

  const users = table('User')
  const studentId = uid('u-s')
  const studentPassword = 'student123'
  const studentEmail = freeEmail(makeEmailBase(before.applicantName as string), users)
  const student: Row = {
    id: studentId, schoolId: actor.schoolId, role: 'student', name: before.applicantName, email: studentEmail, password: studentPassword,
    mustChangePassword: true, title: `Class ${gradeLabel}-${cls.section} · Roll ${rollNo}`, avatarHue: hue, verified: true, active: true,
    dob: before.dob ?? null, joinDate: nowIso().slice(0, 10),
  }
  users.push(student)

  const guardianEmail = guardian.email ? guardian.email.toLowerCase() : undefined
  let parent = guardianEmail ? users.find(u => u.role === 'parent' && u.schoolId === actor.schoolId && String(u.email).toLowerCase() === guardianEmail) : undefined
  const existingParent = !!parent
  let parentPassword = ''
  if (!parent) {
    parentPassword = 'parent123'
    const parentEmail = guardianEmail ?? freeEmail(makeEmailBase(guardian.name), users)
    parent = {
      id: uid('u-p'), schoolId: actor.schoolId, role: 'parent', name: guardian.name, email: parentEmail, password: parentPassword,
      mustChangePassword: true, title: `Parent of ${before.applicantName}`, avatarHue: (hue + 120) % 360, verified: false,
      active: true, phone: guardian.phone ?? undefined, joinDate: nowIso().slice(0, 10),
    }
    users.push(parent)
  }
  saveTable('User', users)

  const enrRows = table('Enrollment')
  enrRows.push({ id: uid('enrollment'), schoolId: actor.schoolId, studentId, classId: cls.id, academicYearId: cls.academicYearId, status: 'active', rollNo })
  saveTable('Enrollment', enrRows)

  const guardianRows = table('Guardian')
  guardianRows.push({ id: uid('guardian'), schoolId: actor.schoolId, studentId, parentId: parent.id, relation: guardian.relation ?? 'parent', isPrimary: true })
  saveTable('Guardian', guardianRows)

  // Health handoff — the small structured intake subset becomes HealthRecord rows once, in the same
  // step as student creation; not a duplicate of the full module (staff/nurse can expand on them after).
  const flags = (before.healthFlags ?? null) as HealthFlags | null
  if (flags) {
    const hr = table('HealthRecord')
    const today = nowIso().slice(0, 10)
    if (flags.allergies) hr.push({ id: uid('healthrecord'), schoolId: actor.schoolId, studentId, kind: 'Allergy', title: 'Reported at admission', detail: flags.allergies, date: today, addedById: actor.userId })
    if (flags.conditions) hr.push({ id: uid('healthrecord'), schoolId: actor.schoolId, studentId, kind: 'Condition', title: 'Reported at admission', detail: flags.conditions, date: today, addedById: actor.userId })
    if (flags.bloodGroup) hr.push({ id: uid('healthrecord'), schoolId: actor.schoolId, studentId, kind: 'Other', title: 'Blood group (from admission)', detail: `Blood group: ${flags.bloodGroup}`, date: today, addedById: actor.userId })
    saveTable('HealthRecord', hr)
  }

  const rows = table('Application')
  const idx = rows.findIndex(a => a.id === before.id)
  rows[idx] = { ...before, status: 'Approved', studentId, decidedById: actor.userId, decidedAt: nowIso() }
  saveTable('Application', rows)

  return {
    row: rows[idx],
    created: {
      student: { id: studentId, email: studentEmail, password: studentPassword },
      parent: existingParent ? { id: parent.id, email: parent.email as string, password: '', existing: true } : { id: parent.id, email: parent.email as string, password: parentPassword },
    },
  }
}

route('POST', '/applications/:id/approve', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('Application')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Application')
  const before = rows[idx]
  assertOpen(before)

  let row: Row
  let created: AdmissionCreated | undefined

  if (before.kind === 'Admission') {
    // Completeness checklist can optionally hard-block approval (school-level setting). Off by
    // default — approval proceeds with the checklist left open for post-enrollment follow-up.
    const check = admissionDocuments.checklist(actor.schoolId, before.id)
    if (check.admissionDocumentsBlockApproval && !check.complete) {
      throw conflict('Required admission documents are missing', { missingRequired: check.missingRequired })
    }
    ;({ row, created } = approveAdmission(actor, before))
  } else {
    const studentId = before.studentId as string | undefined
    if (!studentId) throw badRequest('Application has no student')
    if (before.kind === 'TC') {
      // TC-issuance document-return workflow — resolved (and 409s, before any state changes, if
      // unresolved) ahead of ending the enrollment/issuing the certificate.
      const body = ctx.body as { documentReturns?: admissionDocuments.DocumentReturnResolution[] } | undefined
      admissionDocuments.resolveHeldOriginalsForTc(actor, studentId, body?.documentReturns)
      const enrRows = table('Enrollment').map(e => (e.studentId === studentId && e.status === 'active' ? { ...e, status: 'transferred' } : e))
      saveTable('Enrollment', enrRows)
    }
    const updated = table('Application')
    const uIdx = updated.findIndex(a => a.id === before.id)
    updated[uIdx] = { ...before, status: 'Approved', decidedById: actor.userId, decidedAt: nowIso() }
    saveTable('Application', updated)
    certificates.issueCertificate(actor, before.kind as 'TC' | 'Bonafide' | 'Character', studentId, before.id)
    row = table('Application').find(a => a.id === before.id)!
  }

  return { item: serializeApplication(row), ...(created ? { created } : {}) }
})
