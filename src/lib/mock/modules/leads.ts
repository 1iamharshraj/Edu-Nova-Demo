// Lead Management — coaching-institute demo. Every enquiry (online, offline, paid-ad, or bulk-imported
// from a Google Sheet) is a `Lead` row moving through a pipeline (New → Contacted → Trial Scheduled →
// Trial Attended → Enrolled/Lost). `POST /leads/:id/convert` enrolls the lead straight into a batch
// (creates the student login + an active enrollment) — no school-style application/TC paperwork.
//
// Google Sheet import: this is a static, backend-less demo, so there's no live Google Sheets API call —
// `POST /leads/import` accepts either pasted/uploaded CSV rows (genuinely parsed) or a Google Sheet URL
// (the URL is recorded, but the "fetched" rows are a realistic simulated batch, clearly labeled as such
// in the response) — see the `simulated` flag in the response.

import { route, requireAuth, requireRole, status } from '../router'
import { badRequest, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']
const LEAD_STATUSES = ['New', 'Contacted', 'Trial Scheduled', 'Trial Attended', 'Enrolled', 'Lost']

function isStaff(role: string) {
  return STAFF_ROLES.includes(role)
}

function serializeLead(l: Row) {
  const assignee = l.assignedToId ? table('User').find(u => u.id === l.assignedToId) : undefined
  return {
    id: l.id, name: l.name, phone: l.phone, email: l.email ?? undefined,
    source: l.source, campaign: l.campaign ?? undefined, interestedCourse: l.interestedCourse,
    status: l.status, score: l.score ?? 0, assignedToId: l.assignedToId ?? undefined,
    assignedToName: assignee?.name as string | undefined,
    importBatch: l.importBatch ?? undefined, notes: l.notes ?? [],
    convertedStudentId: l.convertedStudentId ?? undefined,
    enrolledBatch: l.enrolledClassId ? (() => { const c = table('Class').find(x => x.id === l.enrolledClassId); return c ? batchLabel(c) : undefined })() : undefined,
    createdAt: l.createdAt,
  }
}

route('GET', '/leads', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw badRequest('Leads are staff/admin only')
  const { status: statusFilter, source, assignedToId, q } = ctx.query
  let rows = table('Lead').filter(l => l.schoolId === actor.schoolId)
  if (statusFilter) rows = rows.filter(l => l.status === statusFilter)
  if (source) rows = rows.filter(l => l.source === source)
  if (assignedToId) rows = rows.filter(l => l.assignedToId === assignedToId)
  if (q) {
    const needle = q.toLowerCase()
    rows = rows.filter(l => String(l.name).toLowerCase().includes(needle) || String(l.phone).includes(needle) || String(l.email ?? '').toLowerCase().includes(needle))
  }
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializeLead) }
})

route('GET', '/leads/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const row = table('Lead').find(l => l.id === ctx.params.id && l.schoolId === actor.schoolId)
  if (!row) throw notFound('Lead')
  return { item: serializeLead(row) }
})

route('POST', '/leads', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const body = ctx.body as { name?: string; phone?: string; email?: string; source?: string; campaign?: string; interestedCourse?: string; assignedToId?: string }
  if (!body.name?.trim()) throw badRequest('name is required')
  if (!body.phone?.trim()) throw badRequest('phone is required')
  if (!body.source) throw badRequest('source is required')
  const rows = table('Lead')
  const row: Row = {
    id: uid('lead'), schoolId: actor.schoolId, name: body.name.trim(), phone: body.phone.trim(),
    email: body.email?.trim() || null, source: body.source, campaign: body.campaign?.trim() || null,
    interestedCourse: body.interestedCourse?.trim() || '', status: 'New', score: 50,
    assignedToId: body.assignedToId || actor.userId, notes: [], createdAt: nowIso(),
  }
  rows.push(row)
  saveTable('Lead', rows)
  return status(201, { item: serializeLead(row) })
})

route('PATCH', '/leads/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('Lead')
  const idx = rows.findIndex(l => l.id === ctx.params.id && l.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Lead')
  const body = ctx.body as { name?: string; phone?: string; email?: string; interestedCourse?: string; assignedToId?: string; campaign?: string }
  rows[idx] = { ...rows[idx], ...body }
  saveTable('Lead', rows)
  return { item: serializeLead(rows[idx]) }
})

route('POST', '/leads/:id/status', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('Lead')
  const idx = rows.findIndex(l => l.id === ctx.params.id && l.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Lead')
  const { status: next } = ctx.body as { status?: string }
  if (!next || !LEAD_STATUSES.includes(next)) throw badRequest(`status must be one of ${LEAD_STATUSES.join(', ')}`)
  rows[idx] = { ...rows[idx], status: next }
  saveTable('Lead', rows)
  return { item: serializeLead(rows[idx]) }
})

route('POST', '/leads/:id/notes', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('Lead')
  const idx = rows.findIndex(l => l.id === ctx.params.id && l.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Lead')
  const { text } = ctx.body as { text?: string }
  if (!text?.trim()) throw badRequest('text is required')
  const by = table('User').find(u => u.id === actor.userId)
  const notes = [...((rows[idx].notes as Row[] | undefined) ?? []), { at: nowIso(), by: (by?.name as string) ?? 'Staff', text: text.trim() }]
  rows[idx] = { ...rows[idx], notes }
  saveTable('Lead', rows)
  return { item: serializeLead(rows[idx]) }
})

route('DELETE', '/leads/:id', (ctx) => {
  const actor = requireRole(ctx, 'admin', 'superadmin')
  const rows = table('Lead')
  const idx = rows.findIndex(l => l.id === ctx.params.id && l.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Lead')
  rows.splice(idx, 1)
  saveTable('Lead', rows)
  return { ok: true }
})

// ── Bulk import: pasted/uploaded CSV rows (real), or a Google Sheet URL (simulated — see header note). ──
interface ImportRow { name?: string; phone?: string; email?: string; interestedCourse?: string }

route('POST', '/leads/import', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const body = ctx.body as { rows?: ImportRow[]; sheetUrl?: string; batchLabel?: string }
  const batchLabel = body.batchLabel?.trim() || `import-${new Date().toISOString().slice(0, 10)}`
  const rows = table('Lead')
  let imported: Row[] = []
  let simulated = false

  if (body.sheetUrl?.trim()) {
    // No live Google Sheets fetch in this static demo — a realistic simulated batch stands in, clearly
    // flagged via `simulated: true` in the response so the UI can tell the operator what actually happened.
    simulated = true
    const sample: ImportRow[] = [
      { name: 'Ishaan Verma', phone: '+91 90001 11111', email: 'ishaan.verma@gmail.com', interestedCourse: 'JEE 2027 · A' },
      { name: 'Riya Kapoor', phone: '+91 90001 22222', email: 'riya.kapoor@gmail.com', interestedCourse: 'NEET Dropper Batch' },
      { name: 'Aryan Joshi', phone: '+91 90001 33333', interestedCourse: 'Foundation IX · A' },
    ]
    imported = sample.map(r => ({
      id: uid('lead'), schoolId: actor.schoolId, name: r.name, phone: r.phone, email: r.email ?? null,
      source: 'Google Sheet Import', campaign: null, interestedCourse: r.interestedCourse ?? '', status: 'New',
      score: 40, assignedToId: actor.userId, importBatch: batchLabel, notes: [], createdAt: nowIso(),
    }))
  } else if (body.rows?.length) {
    imported = body.rows
      .filter(r => r.name?.trim() && r.phone?.trim())
      .map(r => ({
        id: uid('lead'), schoolId: actor.schoolId, name: r.name!.trim(), phone: r.phone!.trim(),
        email: r.email?.trim() || null, source: 'Google Sheet Import', campaign: null,
        interestedCourse: r.interestedCourse?.trim() || '', status: 'New', score: 40,
        assignedToId: actor.userId, importBatch: batchLabel, notes: [], createdAt: nowIso(),
      }))
  } else {
    throw badRequest('Provide either rows (parsed CSV) or a sheetUrl')
  }

  saveTable('Lead', [...rows, ...imported])
  return status(201, { imported: imported.length, simulated, items: imported.map(serializeLead) })
})

// ── Enroll a lead straight into a batch — how a coaching institute actually onboards: no school-style
// application/TC paperwork, just a student login plus an active enrollment in the chosen batch. ──
function batchLabel(cls: Row) {
  const grade = table('Grade').find(g => g.id === cls.gradeId)
  return `${grade?.label ?? ''} · ${cls.section}`.trim()
}

function uniqueStudentEmail(name: string): string {
  const parts = name.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean)
  const base = parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1][0]}` : (parts[0] ?? 'student')
  const users = table('User')
  let email = `${base}@edkonic.in`
  for (let n = 2; users.some(u => String(u.email).toLowerCase() === email); n++) email = `${base}${n}@edkonic.in`
  return email
}

route('POST', '/leads/:id/convert', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('Lead')
  const idx = rows.findIndex(l => l.id === ctx.params.id && l.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Lead')
  const lead = rows[idx]
  if (lead.convertedStudentId) throw badRequest('This lead is already enrolled')
  const { classId } = ctx.body as { classId?: string }
  if (!classId) throw badRequest('Pick a batch to enroll into')
  const cls = table('Class').find(c => c.id === classId && c.schoolId === actor.schoolId)
  if (!cls) throw notFound('Batch')

  const users = table('User')
  const email = uniqueStudentEmail(String(lead.name))
  const password = 'student123'
  const student: Row = {
    id: uid('u-s'), schoolId: actor.schoolId, role: 'student', name: lead.name, email, password,
    title: `Student · ${batchLabel(cls)}`, avatarHue: Math.floor(Math.random() * 360), verified: true, active: true,
    mustChangePassword: false, isCounselor: false, phone: lead.phone, createdAt: nowIso(),
  }
  users.push(student)
  saveTable('User', users)

  const enrollments = table('Enrollment')
  const rollNo = String(enrollments.filter(e => e.classId === cls.id).length + 1).padStart(2, '0')
  enrollments.push({
    id: uid('enr'), schoolId: actor.schoolId, studentId: student.id, classId: cls.id,
    academicYearId: cls.academicYearId ?? 'ay-2025', status: 'active', rollNo,
  } as Row)
  saveTable('Enrollment', enrollments)

  const by = table('User').find(u => u.id === actor.userId)
  const notes = [...((lead.notes as Row[] | undefined) ?? []), { at: nowIso(), by: (by?.name as string) ?? 'Staff', text: `Enrolled into ${batchLabel(cls)} (roll ${rollNo}). Student login: ${email}` }]
  rows[idx] = { ...lead, status: 'Enrolled', convertedStudentId: student.id, enrolledClassId: cls.id, notes }
  saveTable('Lead', rows)
  return status(201, { item: serializeLead(rows[idx]), studentId: student.id, email, password, batch: batchLabel(cls) })
})

// ── Summary for the pipeline header (counts per status + per source, this week's new leads). ──
route('GET', '/leads-summary', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw badRequest('Leads are staff/admin only')
  const rows = table('Lead').filter(l => l.schoolId === actor.schoolId)
  const byStatus: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  for (const l of rows) {
    byStatus[String(l.status)] = (byStatus[String(l.status)] ?? 0) + 1
    bySource[String(l.source)] = (bySource[String(l.source)] ?? 0) + 1
  }
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const newThisWeek = rows.filter(l => new Date(String(l.createdAt)).getTime() >= weekAgo).length
  return { total: rows.length, newThisWeek, byStatus, bySource }
})
