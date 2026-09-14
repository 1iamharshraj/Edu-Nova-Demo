// Mirrors server/src/modules/health/{router,service,schema}.ts's contract for
// src/portal/modules/actions.tsx (HealthMod). Visible only to the student, their guardians, their class
// teacher, and staff/admin. Add: parent/student for self/ward, or staff/admin for anyone. Medication
// schedules/logs are nurse/staff/admin-only writes (RBAC reuses the HealthRecord visibility scope).

import { route, requireAuth, status } from '../router'
import { badRequest, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { isAdmin, isStaff, isClassTeacherOfStudent, isGuardianOf, visibleStudentIds } from './examsAcademicsScope'
import type { Actor } from '../router'

const HEALTH_KINDS = ['Vaccination', 'Allergy', 'Condition', 'Checkup', 'Other']

function serializeHealth(h: Row) {
  return { id: h.id, studentId: h.studentId, kind: h.kind, title: h.title, detail: h.detail, date: h.date, addedById: h.addedById, verifiedById: h.verifiedById ?? undefined, verifiedAt: h.verifiedAt ?? undefined, fileIds: h.fileIds ?? [], createdAt: h.createdAt }
}
function serializeSchedule(m: Row) {
  return { id: m.id, studentId: m.studentId, medicationName: m.medicationName, dosage: m.dosage, times: m.times ?? [], startDate: m.startDate, endDate: m.endDate ?? undefined, notes: m.notes ?? undefined, addedById: m.addedById, createdAt: m.createdAt }
}
function serializeLog(l: Row) {
  return { id: l.id, scheduleId: l.scheduleId, administeredAt: l.administeredAt, administeredById: l.administeredById, notes: l.notes ?? undefined }
}

function canViewHealth(actor: Actor, studentId: string): boolean {
  if (isStaff(actor.role)) return true
  if (actor.role === 'student') return actor.userId === studentId
  if (isGuardianOf(actor, studentId)) return true
  if (isClassTeacherOfStudent(actor, studentId)) return true
  return false
}
function assertViewHealth(actor: Actor, studentId: string) {
  if (!canViewHealth(actor, studentId)) throw forbidden('You cannot view this student’s health records')
}
function assertStudent(actor: Actor, studentId: string): Row {
  const row = table('User').find(u => u.id === studentId && u.schoolId === actor.schoolId && u.role === 'student')
  if (!row) throw notFound('Student')
  return row
}

route('GET', '/health', (ctx) => {
  const actor = requireAuth(ctx)
  const { studentId } = ctx.query
  if (studentId) {
    assertViewHealth(actor, studentId)
    return { items: table('HealthRecord').filter(h => h.schoolId === actor.schoolId && h.studentId === studentId).sort((a, b) => String(b.date).localeCompare(String(a.date))).map(serializeHealth) }
  }
  const only = visibleStudentIds(actor)
  if (!only) throw badRequest('studentId is required')
  return { items: table('HealthRecord').filter(h => h.schoolId === actor.schoolId && only.includes(h.studentId as string)).sort((a, b) => String(b.date).localeCompare(String(a.date))).map(serializeHealth) }
})

route('POST', '/health', (ctx) => {
  const actor = requireAuth(ctx)
  const body = ctx.body as { studentId?: string; kind?: string; title?: string; detail?: string; date?: string; fileIds?: string[] }
  if (!body.studentId) throw badRequest('studentId is required')
  assertStudent(actor, body.studentId)
  if (actor.role === 'student') { if (actor.userId !== body.studentId) throw forbidden('You may only add a health record for yourself') }
  else if (actor.role === 'parent') { if (!isGuardianOf(actor, body.studentId)) throw forbidden('That student is not your ward') }
  else if (!isStaff(actor.role)) throw forbidden('Only the student, a parent, or staff/admin may add a health record')
  if (!HEALTH_KINDS.includes(body.kind ?? '')) throw badRequest(`kind must be one of ${HEALTH_KINDS.join(', ')}`)
  if (!body.title?.trim()) throw badRequest('title is required')
  if (!body.detail?.trim()) throw badRequest('detail is required')
  if (!body.date) throw badRequest('date is required')
  const row: Row = { id: uid('healthrecord'), schoolId: actor.schoolId, studentId: body.studentId, kind: body.kind, title: body.title.trim(), detail: body.detail.trim(), date: body.date, addedById: actor.userId, verifiedById: null, verifiedAt: null, fileIds: body.fileIds ?? [], createdAt: nowIso() }
  const rows = table('HealthRecord'); rows.push(row); saveTable('HealthRecord', rows)
  return status(201, { item: serializeHealth(row) })
})

function getOwned(actor: Actor, id: string): Row {
  const row = table('HealthRecord').find(h => h.id === id && h.schoolId === actor.schoolId)
  if (!row) throw notFound('Health record')
  if (row.addedById !== actor.userId && !isAdmin(actor.role) && !isStaff(actor.role)) throw forbidden('Only the author or staff/admin may modify this record')
  return row
}

route('PATCH', '/health/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getOwned(actor, ctx.params.id)
  const body = ctx.body as { kind?: string; title?: string; detail?: string; date?: string; fileIds?: string[] }
  const rows = table('HealthRecord'); const idx = rows.findIndex(h => h.id === before.id)
  rows[idx] = { ...rows[idx], ...(body.kind !== undefined ? { kind: body.kind } : {}), ...(body.title !== undefined ? { title: body.title } : {}), ...(body.detail !== undefined ? { detail: body.detail } : {}), ...(body.date !== undefined ? { date: body.date } : {}), ...(body.fileIds !== undefined ? { fileIds: body.fileIds } : {}) }
  saveTable('HealthRecord', rows)
  return { item: serializeHealth(rows[idx]) }
})

route('DELETE', '/health/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getOwned(actor, ctx.params.id)
  const rows = table('HealthRecord'); const idx = rows.findIndex(h => h.id === before.id)
  rows.splice(idx, 1)
  saveTable('HealthRecord', rows)
  return { ok: true }
})

route('POST', '/health/:id/verify', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may verify a health record')
  const before = table('HealthRecord').find(h => h.id === ctx.params.id && h.schoolId === actor.schoolId)
  if (!before) throw notFound('Health record')
  const rows = table('HealthRecord'); const idx = rows.findIndex(h => h.id === before.id)
  rows[idx] = { ...rows[idx], verifiedById: actor.userId, verifiedAt: nowIso() }
  saveTable('HealthRecord', rows)
  return { item: serializeHealth(rows[idx]) }
})

// ═══════════════════════════ medication schedules + administration log ═══════════════════════════

route('GET', '/health/medication-schedules', (ctx) => {
  const actor = requireAuth(ctx)
  const { studentId } = ctx.query
  if (studentId) {
    assertViewHealth(actor, studentId)
    return { items: table('MedicationSchedule').filter(m => m.schoolId === actor.schoolId && m.studentId === studentId).sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))).map(serializeSchedule) }
  }
  const only = visibleStudentIds(actor)
  if (!only) throw badRequest('studentId is required')
  return { items: table('MedicationSchedule').filter(m => m.schoolId === actor.schoolId && only.includes(m.studentId as string)).sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))).map(serializeSchedule) }
})

route('POST', '/health/medication-schedules', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may add a medication schedule')
  const body = ctx.body as { studentId?: string; medicationName?: string; dosage?: string; times?: string[]; startDate?: string; endDate?: string; notes?: string }
  if (!body.studentId) throw badRequest('studentId is required')
  assertStudent(actor, body.studentId)
  if (!body.medicationName?.trim()) throw badRequest('medicationName is required')
  if (!body.dosage?.trim()) throw badRequest('dosage is required')
  if (!body.times?.length) throw badRequest('times must have at least one entry')
  if (!body.startDate) throw badRequest('startDate is required')
  const row: Row = { id: uid('medicationschedule'), schoolId: actor.schoolId, studentId: body.studentId, medicationName: body.medicationName.trim(), dosage: body.dosage.trim(), times: body.times, startDate: body.startDate, endDate: body.endDate ?? null, notes: body.notes ?? null, addedById: actor.userId, createdAt: nowIso() }
  const rows = table('MedicationSchedule'); rows.push(row); saveTable('MedicationSchedule', rows)
  return status(201, { item: serializeSchedule(row) })
})

function getSchedule(actor: Actor, id: string): Row {
  const row = table('MedicationSchedule').find(m => m.id === id && m.schoolId === actor.schoolId)
  if (!row) throw notFound('Medication schedule')
  return row
}

route('PATCH', '/health/medication-schedules/:id', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may edit a medication schedule')
  const before = getSchedule(actor, ctx.params.id)
  const body = ctx.body as { medicationName?: string; dosage?: string; times?: string[]; startDate?: string; endDate?: string | null; notes?: string | null }
  const rows = table('MedicationSchedule'); const idx = rows.findIndex(m => m.id === before.id)
  rows[idx] = { ...rows[idx], ...(body.medicationName !== undefined ? { medicationName: body.medicationName } : {}), ...(body.dosage !== undefined ? { dosage: body.dosage } : {}), ...(body.times !== undefined ? { times: body.times } : {}), ...(body.startDate !== undefined ? { startDate: body.startDate } : {}), ...(body.endDate !== undefined ? { endDate: body.endDate } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}) }
  saveTable('MedicationSchedule', rows)
  return { item: serializeSchedule(rows[idx]) }
})

route('DELETE', '/health/medication-schedules/:id', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may delete a medication schedule')
  const before = getSchedule(actor, ctx.params.id)
  const rows = table('MedicationSchedule'); const idx = rows.findIndex(m => m.id === before.id)
  rows.splice(idx, 1)
  saveTable('MedicationSchedule', rows)
  return { ok: true }
})

route('GET', '/health/medication-logs', (ctx) => {
  const actor = requireAuth(ctx)
  const { scheduleId } = ctx.query
  if (!scheduleId) throw badRequest('scheduleId is required')
  const schedule = getSchedule(actor, scheduleId)
  assertViewHealth(actor, schedule.studentId as string)
  return { items: table('MedicationLog').filter(l => l.schoolId === actor.schoolId && l.scheduleId === scheduleId).sort((a, b) => String(b.administeredAt).localeCompare(String(a.administeredAt))).map(serializeLog) }
})

route('POST', '/health/medication-logs', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may log a medication dose')
  const body = ctx.body as { scheduleId?: string; administeredAt?: string; notes?: string }
  if (!body.scheduleId) throw badRequest('scheduleId is required')
  const schedule = getSchedule(actor, body.scheduleId)
  const row: Row = { id: uid('medicationlog'), schoolId: actor.schoolId, scheduleId: schedule.id, administeredAt: body.administeredAt ?? nowIso(), administeredById: actor.userId, notes: body.notes ?? null }
  const rows = table('MedicationLog'); rows.push(row); saveTable('MedicationLog', rows)
  return status(201, { item: serializeLog(row) })
})
