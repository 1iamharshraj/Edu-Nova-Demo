// Mirrors server/src/modules/alumni/{router,service}.ts (phase-13-alumni.md). Alumni are NOT `User`s —
// no portal login in this system — so RSVPs and donations are always recorded BY staff on an alumnus's
// behalf. Profiles/events: write is staff/admin/superadmin; read is broader (+teacher). Donations are
// financial data: staff/admin/superadmin only, for both read and write.

import { route, requireRole, status } from '../router'
import { notFound, conflict, badRequest } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']
const BROAD_READ_ROLES = ['teacher', ...STAFF_ROLES]

function userRef(id: unknown) {
  const u = table('User').find(x => x.id === id)
  return u ? { id: u.id, name: u.name } : undefined
}

// ───────────────────────── serializers ─────────────────────────

function serializeProfile(p: Row) {
  return {
    id: p.id, studentUserId: p.studentUserId ?? undefined, name: p.name, email: p.email ?? undefined, phone: p.phone ?? undefined,
    graduationYear: p.graduationYear, lastClassLabel: p.lastClassLabel ?? undefined, currentOccupation: p.currentOccupation ?? undefined,
    currentOrganization: p.currentOrganization ?? undefined, currentCity: p.currentCity ?? undefined, linkedInUrl: p.linkedInUrl ?? undefined,
    notes: p.notes ?? undefined, convertedAt: p.convertedAt, convertedById: p.convertedById ?? undefined,
    convertedByName: userRef(p.convertedById)?.name,
  }
}

function serializeEvent(e: Row) {
  return {
    id: e.id, title: e.title, description: e.description ?? undefined, date: e.date, location: e.location ?? undefined,
    createdById: e.createdById ?? undefined, createdByName: userRef(e.createdById)?.name,
  }
}

function serializeRsvp(r: Row) {
  const alumni = table('AlumniProfile').find(a => a.id === r.alumniId)
  return { id: r.id, eventId: r.eventId, alumniId: r.alumniId, status: r.status, respondedAt: r.respondedAt, alumniName: alumni?.name }
}

function serializeDonation(d: Row) {
  const alumni = table('AlumniProfile').find(a => a.id === d.alumniId)
  return {
    id: d.id, alumniId: d.alumniId, amount: d.amount, purpose: d.purpose ?? undefined, donatedAt: d.donatedAt,
    recordedById: d.recordedById ?? undefined, note: d.note ?? undefined, alumniName: alumni?.name, recordedByName: userRef(d.recordedById)?.name,
  }
}

function donationsTotalFor(schoolId: string, alumniId: string) {
  return table('AlumniDonation').filter(d => d.schoolId === schoolId && d.alumniId === alumniId).reduce((sum, d) => sum + Number(d.amount), 0)
}

// ───────────────────────── profiles ─────────────────────────

route('GET', '/alumni/profiles', (ctx) => {
  const actor = requireRole(ctx, ...BROAD_READ_ROLES)
  const { q, graduationYear } = ctx.query
  let rows = table('AlumniProfile').filter(a => a.schoolId === actor.schoolId)
  if (graduationYear) rows = rows.filter(a => String(a.graduationYear) === graduationYear)
  if (q) {
    const needle = q.toLowerCase()
    rows = rows.filter(a => String(a.name).toLowerCase().includes(needle) || String(a.email ?? '').toLowerCase().includes(needle))
  }
  rows = [...rows].sort((a, b) => Number(b.graduationYear) - Number(a.graduationYear) || String(a.name).localeCompare(String(b.name)))
  return { items: rows.map(serializeProfile) }
})

route('POST', '/alumni/profiles', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const b = ctx.body as { studentUserId?: string | null; name: string; graduationYear: number; [k: string]: unknown }
  if (b.studentUserId) {
    const dup = table('AlumniProfile').find(a => a.schoolId === actor.schoolId && a.studentUserId === b.studentUserId)
    if (dup) throw conflict('This student already has an alumni profile')
  }
  const row: Row = {
    id: uid('alumniprofile'), schoolId: actor.schoolId, studentUserId: b.studentUserId ?? null, name: b.name, email: b.email ?? null,
    phone: b.phone ?? null, graduationYear: b.graduationYear, lastClassLabel: b.lastClassLabel ?? null, currentOccupation: b.currentOccupation ?? null,
    currentOrganization: b.currentOrganization ?? null, currentCity: b.currentCity ?? null, linkedInUrl: b.linkedInUrl ?? null,
    notes: b.notes ?? null, convertedAt: nowIso(), convertedById: actor.userId, createdAt: nowIso(),
  }
  const rows = table('AlumniProfile'); rows.push(row); saveTable('AlumniProfile', rows)
  return status(201, { item: serializeProfile(row) })
})

route('GET', '/alumni/profiles/:id', (ctx) => {
  const actor = requireRole(ctx, ...BROAD_READ_ROLES)
  const row = table('AlumniProfile').find(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (!row) throw notFound('Alumni profile')
  return { item: { ...serializeProfile(row), donationsTotal: donationsTotalFor(actor.schoolId, row.id) } }
})

route('PATCH', '/alumni/profiles/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('AlumniProfile')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Alumni profile')
  rows[idx] = { ...rows[idx], ...ctx.body, updatedAt: nowIso() }
  saveTable('AlumniProfile', rows)
  return { item: serializeProfile(rows[idx]) }
})

route('DELETE', '/alumni/profiles/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('AlumniProfile')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Alumni profile')
  rows.splice(idx, 1); saveTable('AlumniProfile', rows)
  return { ok: true }
})

// ───────────────────────── student -> alumnus conversion ─────────────────────────

route('POST', '/alumni/convert-student', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const b = ctx.body as { studentId: string; graduationYear?: number; currentOccupation?: string; currentOrganization?: string; currentCity?: string; linkedInUrl?: string; notes?: string; endEnrollment?: boolean }
  const student = table('User').find(u => u.id === b.studentId && u.schoolId === actor.schoolId && u.role === 'student')
  if (!student) throw notFound('Student')
  if (table('AlumniProfile').some(a => a.schoolId === actor.schoolId && a.studentUserId === student.id)) {
    throw conflict('This student has already been converted to an alumnus')
  }

  const enrollments = table('Enrollment').filter(e => e.studentId === student.id && e.schoolId === actor.schoolId)
  const activeEnrollment = enrollments.find(e => e.status === 'active') ?? enrollments[enrollments.length - 1]
  let lastClassLabel: string | null = null
  if (activeEnrollment) {
    const cls = table('Class').find(c => c.id === activeEnrollment.classId)
    const grade = cls ? table('Grade').find(g => g.id === cls.gradeId) : undefined
    const board = cls ? table('Board').find(bd => bd.id === cls.boardId) : undefined
    if (cls && grade) lastClassLabel = `${grade.label}-${cls.section}${board ? ` ${board.code}` : ''}`
  }
  const academicYear = table('AcademicYear').find(y => y.id === activeEnrollment?.academicYearId)
  const graduationYear = b.graduationYear ?? (academicYear ? new Date(String(academicYear.endDate)).getFullYear() : new Date().getFullYear())
  const endEnrollment = b.endEnrollment !== false

  if (endEnrollment && activeEnrollment) {
    const enrRows = table('Enrollment')
    const idx = enrRows.findIndex(e => e.id === activeEnrollment.id)
    if (idx !== -1) { enrRows[idx] = { ...enrRows[idx], status: 'graduated' }; saveTable('Enrollment', enrRows) }
  }

  const row: Row = {
    id: uid('alumniprofile'), schoolId: actor.schoolId, studentUserId: student.id, name: student.name, email: student.email ?? null,
    phone: student.phone ?? null, graduationYear, lastClassLabel, currentOccupation: b.currentOccupation ?? null,
    currentOrganization: b.currentOrganization ?? null, currentCity: b.currentCity ?? null, linkedInUrl: b.linkedInUrl ?? null,
    notes: b.notes ?? null, convertedAt: nowIso(), convertedById: actor.userId, createdAt: nowIso(),
  }
  const rows = table('AlumniProfile'); rows.push(row); saveTable('AlumniProfile', rows)
  return status(201, { item: serializeProfile(row), enrollmentEnded: endEnrollment && !!activeEnrollment })
})

// ───────────────────────── events ─────────────────────────

route('GET', '/alumni/events', (ctx) => {
  const actor = requireRole(ctx, ...BROAD_READ_ROLES)
  const rows = [...table('AlumniEvent').filter(e => e.schoolId === actor.schoolId)].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  return { items: rows.map(serializeEvent) }
})

route('POST', '/alumni/events', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const b = ctx.body as { title: string; description?: string; date: string; location?: string }
  const row: Row = { id: uid('alumnievent'), schoolId: actor.schoolId, title: b.title, description: b.description ?? null, date: b.date, location: b.location ?? null, createdById: actor.userId, createdAt: nowIso() }
  const rows = table('AlumniEvent'); rows.push(row); saveTable('AlumniEvent', rows)
  return status(201, { item: serializeEvent(row) })
})

route('GET', '/alumni/events/:id', (ctx) => {
  const actor = requireRole(ctx, ...BROAD_READ_ROLES)
  const row = table('AlumniEvent').find(e => e.id === ctx.params.id && e.schoolId === actor.schoolId)
  if (!row) throw notFound('Alumni event')
  return { item: serializeEvent(row) }
})

route('PATCH', '/alumni/events/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('AlumniEvent')
  const idx = rows.findIndex(e => e.id === ctx.params.id && e.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Alumni event')
  rows[idx] = { ...rows[idx], ...ctx.body, updatedAt: nowIso() }
  saveTable('AlumniEvent', rows)
  return { item: serializeEvent(rows[idx]) }
})

route('DELETE', '/alumni/events/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('AlumniEvent')
  const idx = rows.findIndex(e => e.id === ctx.params.id && e.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Alumni event')
  rows.splice(idx, 1); saveTable('AlumniEvent', rows)
  return { ok: true }
})

// ───────────────────────── rsvp (staff-recorded on an alumnus's behalf) ─────────────────────────

route('GET', '/alumni/events/:id/rsvp', (ctx) => {
  const actor = requireRole(ctx, ...BROAD_READ_ROLES)
  const event = table('AlumniEvent').find(e => e.id === ctx.params.id && e.schoolId === actor.schoolId)
  if (!event) throw notFound('Alumni event')
  const rows = [...table('AlumniEventRsvp').filter(r => r.eventId === event.id)].sort((a, b) => String(b.respondedAt).localeCompare(String(a.respondedAt)))
  return { items: rows.map(serializeRsvp) }
})

route('POST', '/alumni/events/:id/rsvp', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const event = table('AlumniEvent').find(e => e.id === ctx.params.id && e.schoolId === actor.schoolId)
  if (!event) throw notFound('Alumni event')
  const b = ctx.body as { alumniId: string; status: 'Interested' | 'Going' | 'Declined' }
  const alumni = table('AlumniProfile').find(a => a.id === b.alumniId && a.schoolId === actor.schoolId)
  if (!alumni) throw notFound('Alumni profile')
  const rows = table('AlumniEventRsvp')
  const idx = rows.findIndex(r => r.eventId === event.id && r.alumniId === alumni.id)
  const respondedAt = nowIso()
  if (idx === -1) {
    const row: Row = { id: uid('alumnirsvp'), eventId: event.id, alumniId: alumni.id, status: b.status, respondedAt }
    rows.push(row); saveTable('AlumniEventRsvp', rows)
    return { item: serializeRsvp(row) }
  }
  rows[idx] = { ...rows[idx], status: b.status, respondedAt }
  saveTable('AlumniEventRsvp', rows)
  return { item: serializeRsvp(rows[idx]) }
})

// ───────────────────────── donations (financial data — staff/admin/superadmin only) ─────────────────────────

route('GET', '/alumni/donations', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { alumniId } = ctx.query
  let rows = table('AlumniDonation').filter(d => d.schoolId === actor.schoolId)
  if (alumniId) rows = rows.filter(d => d.alumniId === alumniId)
  rows = [...rows].sort((a, b) => String(b.donatedAt).localeCompare(String(a.donatedAt)))
  return { items: rows.map(serializeDonation) }
})

route('POST', '/alumni/donations', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const b = ctx.body as { alumniId: string; amount: number; purpose?: string; donatedAt?: string; note?: string }
  if (!(b.amount > 0)) throw badRequest('amount must be positive')
  const alumni = table('AlumniProfile').find(a => a.id === b.alumniId && a.schoolId === actor.schoolId)
  if (!alumni) throw notFound('Alumni profile')
  const row: Row = { id: uid('alumnidonation'), schoolId: actor.schoolId, alumniId: alumni.id, amount: b.amount, purpose: b.purpose ?? null, donatedAt: b.donatedAt ?? nowIso().slice(0, 10), note: b.note ?? null, recordedById: actor.userId, createdAt: nowIso() }
  const rows = table('AlumniDonation'); rows.push(row); saveTable('AlumniDonation', rows)
  return status(201, { item: serializeDonation(row) })
})

route('GET', '/alumni/donations/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const row = table('AlumniDonation').find(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (!row) throw notFound('Donation')
  return { item: serializeDonation(row) }
})

route('PATCH', '/alumni/donations/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('AlumniDonation')
  const idx = rows.findIndex(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Donation')
  rows[idx] = { ...rows[idx], ...ctx.body }
  saveTable('AlumniDonation', rows)
  return { item: serializeDonation(rows[idx]) }
})

route('DELETE', '/alumni/donations/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('AlumniDonation')
  const idx = rows.findIndex(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Donation')
  rows.splice(idx, 1); saveTable('AlumniDonation', rows)
  return { ok: true }
})
