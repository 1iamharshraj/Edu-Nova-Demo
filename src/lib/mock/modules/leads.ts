// Lead Management — coaching-institute demo. Every enquiry (online, offline, paid-ad, or bulk-imported
// from a Google Sheet) is a `Lead` row moving through a pipeline (New → Contacted → Trial Scheduled →
// Trial Attended → Enrolled/Lost). A lead converts into a real admissions `Application` via
// `POST /leads/:id/convert`, reusing the existing admissions pipeline rather than forking a second one.
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
    convertedApplicationId: l.convertedApplicationId ?? undefined,
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
      { name: 'Ishaan Verma', phone: '+91 90001 11111', email: 'ishaan.verma@gmail.com', interestedCourse: 'JEE Main 2027 — Batch A' },
      { name: 'Riya Kapoor', phone: '+91 90001 22222', email: 'riya.kapoor@gmail.com', interestedCourse: 'NEET Dropper Batch' },
      { name: 'Aryan Joshi', phone: '+91 90001 33333', interestedCourse: 'Foundation Batch — Class X' },
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

// ── Convert a lead into a real admissions Application (Admission kind, Pending status) — reuses the
// existing admissions pipeline rather than a second parallel one. ──
route('POST', '/leads/:id/convert', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('Lead')
  const idx = rows.findIndex(l => l.id === ctx.params.id && l.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Lead')
  const lead = rows[idx]
  if (lead.convertedApplicationId) throw badRequest('This lead has already been converted')

  const applications = table('Application')
  const application: Row = {
    id: uid('application'), schoolId: actor.schoolId, kind: 'Admission', applicantName: lead.name,
    dob: null, gender: null,
    guardian: { name: `${lead.name} (self/guardian)`, phone: lead.phone, email: lead.email ?? undefined },
    targetClassId: null, targetBoardId: null, documents: [], status: 'Pending',
    notes: `Converted from lead ${lead.id} — interested in: ${lead.interestedCourse}. Source: ${lead.source}${lead.campaign ? ` (${lead.campaign})` : ''}.`,
    submittedById: actor.userId, createdAt: nowIso(),
  }
  applications.push(application)
  saveTable('Application', applications)

  rows[idx] = { ...lead, status: 'Enrolled', convertedApplicationId: application.id }
  saveTable('Lead', rows)
  return status(201, { item: serializeLead(rows[idx]), applicationId: application.id })
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
