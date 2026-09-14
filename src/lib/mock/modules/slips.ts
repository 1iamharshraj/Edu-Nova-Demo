// Mirrors server/src/modules/slips/{router,service,schema}.ts's contract for
// src/portal/modules/actions.tsx (SlipMod). Create: teacher (own classes) / staff / admin — a teacher may
// not create a school-wide slip. Respond: a parent per ward, requiring `verified` when
// `requiresVerifiedParent`. A parent/student caller gets their own ward's response(s) attached inline.

import { route, requireAuth, status } from '../router'
import { badRequest, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { isAdmin, isStaff, isGuardianOf, teacherClassIds, wardClassIds, studentClassIds, visibleStudentIds, getClass } from './examsAcademicsScope'
import type { Actor } from '../router'

function serializeResponse(r: Row) {
  return { id: r.id, slipId: r.slipId, studentId: r.studentId, parentId: r.parentId, decision: r.decision, respondedAt: r.respondedAt, note: r.note ?? undefined }
}
function serializeSlip(s: Row, myResponses?: ReturnType<typeof serializeResponse>[]) {
  return { id: s.id, title: s.title, detail: s.detail, dueDate: s.dueDate, classId: s.classId ?? undefined, createdById: s.createdById, requiresVerifiedParent: !!s.requiresVerifiedParent, createdAt: s.createdAt, myResponses }
}

function relevantClassIds(actor: Actor): string[] {
  if (actor.role === 'student') return studentClassIds(actor.userId)
  if (actor.role === 'parent') return wardClassIds(actor)
  if (actor.role === 'teacher') return teacherClassIds(actor.userId)
  return []
}
function canViewSlip(classIds: Set<string>, actor: Actor, slip: Row): boolean {
  if (isStaff(actor.role)) return true
  if (slip.classId === null || slip.classId === undefined) return true
  return classIds.has(slip.classId as string)
}

route('GET', '/slips', (ctx) => {
  const actor = requireAuth(ctx)
  const { classId } = ctx.query
  let rows = table('PermissionSlip').filter(s => s.schoolId === actor.schoolId)
  if (classId) rows = rows.filter(s => s.classId === classId)
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const classIds = isStaff(actor.role) ? null : new Set(relevantClassIds(actor))
  const visible = classIds ? rows.filter(s => canViewSlip(classIds, actor, s)) : rows

  if (actor.role !== 'student' && actor.role !== 'parent') return { items: visible.map(s => serializeSlip(s)) }
  const studentIds = visibleStudentIds(actor) ?? []
  if (!studentIds.length || !visible.length) return { items: visible.map(s => serializeSlip(s)) }
  const responses = table('SlipResponse').filter(r => visible.some(s => s.id === r.slipId) && studentIds.includes(r.studentId as string))
  const bySlip = new Map<string, Row[]>()
  for (const r of responses) bySlip.set(r.slipId as string, [...(bySlip.get(r.slipId as string) ?? []), r])
  return { items: visible.map(s => serializeSlip(s, (bySlip.get(s.id) ?? []).map(serializeResponse))) }
})

route('POST', '/slips', (ctx) => {
  const actor = requireAuth(ctx)
  if (actor.role !== 'teacher' && !isStaff(actor.role)) throw forbidden('Only a teacher, staff or admin may create a permission slip')
  const body = ctx.body as { title?: string; detail?: string; dueDate?: string; classId?: string; requiresVerifiedParent?: boolean }
  if (body.classId) {
    getClass(actor, body.classId)
    if (actor.role === 'teacher' && !teacherClassIds(actor.userId).includes(body.classId)) throw forbidden('You do not teach this class')
  } else if (actor.role === 'teacher') {
    throw forbidden('A teacher must scope a permission slip to a class they teach')
  }
  if (!body.title?.trim()) throw badRequest('title is required')
  if (!body.detail?.trim()) throw badRequest('detail is required')
  if (!body.dueDate) throw badRequest('dueDate is required')
  const row: Row = { id: uid('permissionslip'), schoolId: actor.schoolId, title: body.title.trim(), detail: body.detail.trim(), dueDate: body.dueDate, classId: body.classId ?? null, createdById: actor.userId, requiresVerifiedParent: body.requiresVerifiedParent ?? true, createdAt: nowIso() }
  const rows = table('PermissionSlip'); rows.push(row); saveTable('PermissionSlip', rows)
  return status(201, { item: serializeSlip(row) })
})

function getOwnedOrAdmin(actor: Actor, id: string): Row {
  const row = table('PermissionSlip').find(s => s.id === id && s.schoolId === actor.schoolId)
  if (!row) throw notFound('Permission slip')
  if (row.createdById !== actor.userId && !isAdmin(actor.role)) throw forbidden('Only the creator or admin may modify this slip')
  return row
}

route('PATCH', '/slips/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getOwnedOrAdmin(actor, ctx.params.id)
  const body = ctx.body as { title?: string; detail?: string; dueDate?: string; requiresVerifiedParent?: boolean }
  const rows = table('PermissionSlip'); const idx = rows.findIndex(s => s.id === before.id)
  rows[idx] = { ...rows[idx], ...(body.title !== undefined ? { title: body.title } : {}), ...(body.detail !== undefined ? { detail: body.detail } : {}), ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}), ...(body.requiresVerifiedParent !== undefined ? { requiresVerifiedParent: body.requiresVerifiedParent } : {}) }
  saveTable('PermissionSlip', rows)
  return { item: serializeSlip(rows[idx]) }
})

route('DELETE', '/slips/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getOwnedOrAdmin(actor, ctx.params.id)
  const rows = table('PermissionSlip'); const idx = rows.findIndex(s => s.id === before.id)
  rows.splice(idx, 1)
  saveTable('PermissionSlip', rows)
  saveTable('SlipResponse', table('SlipResponse').filter(r => r.slipId !== before.id))
  return { ok: true }
})

route('GET', '/slips/:id/responses', (ctx) => {
  const actor = requireAuth(ctx)
  const slip = table('PermissionSlip').find(s => s.id === ctx.params.id && s.schoolId === actor.schoolId)
  if (!slip) throw notFound('Permission slip')
  const allowedTeacher = actor.role === 'teacher' && slip.classId && teacherClassIds(actor.userId).includes(slip.classId as string)
  if (!isStaff(actor.role) && !allowedTeacher) throw forbidden('Only staff, admin, or the teacher of this class may see responses')
  const rows = table('SlipResponse').filter(r => r.slipId === slip.id).sort((a, b) => String(b.respondedAt).localeCompare(String(a.respondedAt)))
  return { items: rows.map(serializeResponse) }
})

route('POST', '/slips/:id/respond', (ctx) => {
  const actor = requireAuth(ctx)
  if (actor.role !== 'parent') throw forbidden('Only a parent may respond to a permission slip')
  const slip = table('PermissionSlip').find(s => s.id === ctx.params.id && s.schoolId === actor.schoolId)
  if (!slip) throw notFound('Permission slip')
  const { studentId, decision, note } = ctx.body as { studentId?: string; decision?: string; note?: string }
  if (!studentId) throw badRequest('studentId is required')
  if (!isGuardianOf(actor, studentId)) throw forbidden('That student is not your ward')
  if (!['Approved', 'Declined'].includes(decision ?? '')) throw badRequest('decision must be Approved or Declined')

  if (slip.classId) {
    const enrollment = table('Enrollment').find(e => e.studentId === studentId && e.status === 'active')
    if (!enrollment || enrollment.classId !== slip.classId) throw forbidden('This slip does not apply to that student’s class')
  }
  if (slip.requiresVerifiedParent) {
    const parent = table('User').find(u => u.id === actor.userId && u.schoolId === actor.schoolId)
    if (!parent?.verified) throw forbidden('Your parent account must be verified before responding to this slip')
  }

  const rows = table('SlipResponse')
  const idx = rows.findIndex(r => r.slipId === slip.id && r.studentId === studentId)
  const row: Row = idx === -1
    ? { id: uid('slipresponse'), slipId: slip.id, studentId, parentId: actor.userId, decision, respondedAt: nowIso(), note: note ?? null }
    : { ...rows[idx], decision, note: note ?? null, respondedAt: nowIso() }
  if (idx === -1) rows.push(row); else rows[idx] = row
  saveTable('SlipResponse', rows)
  return status(201, { item: serializeResponse(row) })
})
