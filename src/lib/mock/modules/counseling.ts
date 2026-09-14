// Mirrors server/src/modules/counseling's contract: confidential CounselingRecord (counselor-only, with
// an admin/superadmin oversight opt-in that defaults off) and fully anonymous AnonymousReport (no
// identity field anywhere, ever). Mounted at /safety per the real router even though the code lives in
// its own module — same split as the real backend (a THIRD, narrower RBAC shape that neither
// modules/health's nor modules/staffConduct's pattern expresses; see phase-22-campus-safety.md item 3).
// Also owns PATCH /users/:id/counselor — the narrow admin/superadmin-only flag that grants access to this
// module, deliberately its own endpoint rather than the generic PATCH /users/:id (a staff-managing-teacher
// must never be able to grant it). See .agents/edunova/static-demo-plan.md.

import { route, requireAuth, requireRole, status, type Actor, type ReqCtx } from '../router'
import { badRequest, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { serializeUser } from '../serialize'

const ADMIN_ROLES = ['admin', 'superadmin']

function isCounselor(actor: Actor): boolean {
  return !!table('User').find(u => u.id === actor.userId && u.schoolId === actor.schoolId)?.isCounselor
}

function oversightEnabled(actor: Actor): boolean {
  return !!table('CounselingSettings').find(s => s.schoolId === actor.schoolId)?.oversightEnabled
}

/** Visible ONLY to the counselor who owns a record, or to admin/superadmin when this school has
 * explicitly turned oversight on (default: off). Nobody else — not the class teacher, not plain staff,
 * not the student, not the parent — gets a path through this function. */
function canAccessRecord(actor: Actor, record: Row): boolean {
  if (actor.userId === record.counselorId) return true
  return ADMIN_ROLES.includes(actor.role) && oversightEnabled(actor)
}

function canReviewAnonymousReports(actor: Actor): boolean {
  return ADMIN_ROLES.includes(actor.role) || isCounselor(actor)
}

/* ═══════════════════════════ CounselingRecord ═══════════════════════════ */

function serializeRecord(r: Row) {
  return {
    id: r.id, studentId: r.studentId, counselorId: r.counselorId, sessionDate: r.sessionDate, notes: r.notes,
    category: r.category ?? undefined, followUpNeeded: !!r.followUpNeeded, createdAt: r.createdAt,
  }
}

route('GET', '/safety/counseling-records', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const { studentId } = ctx.query
  const oversight = ADMIN_ROLES.includes(actor.role) && oversightEnabled(actor)
  if (!oversight && !isCounselor(actor)) return { items: [] }
  let rows = table('CounselingRecord').filter(r => r.schoolId === actor.schoolId)
  if (studentId) rows = rows.filter(r => r.studentId === studentId)
  if (!oversight) rows = rows.filter(r => r.counselorId === actor.userId)
  rows = [...rows].sort((a, b) => String(b.sessionDate).localeCompare(String(a.sessionDate)))
  return { items: rows.map(serializeRecord) }
})

route('GET', '/safety/counseling-records/:id', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const row = table('CounselingRecord').find(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (!row) throw notFound('Counseling record')
  if (!canAccessRecord(actor, row)) throw forbidden('You do not have access to this counseling record')
  return { item: serializeRecord(row) }
})

route('POST', '/safety/counseling-records', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!isCounselor(actor)) throw forbidden('Only a designated counselor may access counseling records')
  const body = ctx.body as { studentId?: string; sessionDate?: string; notes?: string; category?: string; followUpNeeded?: boolean }
  if (!body.studentId) throw badRequest('studentId is required')
  if (!table('User').some(u => u.id === body.studentId && u.schoolId === actor.schoolId && u.role === 'student')) throw notFound('Student')
  if (!body.sessionDate) throw badRequest('sessionDate is required')
  if (!body.notes?.trim()) throw badRequest('notes is required')
  const row: Row = {
    id: uid('counselingrecord'), schoolId: actor.schoolId, studentId: body.studentId, counselorId: actor.userId,
    sessionDate: body.sessionDate, notes: body.notes.trim(), category: body.category ?? null, followUpNeeded: !!body.followUpNeeded, createdAt: nowIso(),
  }
  const rows = table('CounselingRecord')
  rows.push(row)
  saveTable('CounselingRecord', rows)
  return status(201, { item: serializeRecord(row) })
})

route('PATCH', '/safety/counseling-records/:id', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const rows = table('CounselingRecord')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Counseling record')
  // Writes are stricter than reads: only the owning counselor edits their own record — oversight grants
  // visibility, not the ability to rewrite another counselor's notes.
  if (rows[idx].counselorId !== actor.userId) throw forbidden('Only the counselor who wrote this record may edit it')
  const body = ctx.body as { sessionDate?: string; notes?: string; category?: string | null; followUpNeeded?: boolean }
  rows[idx] = {
    ...rows[idx],
    ...(body.sessionDate !== undefined ? { sessionDate: body.sessionDate } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(body.category !== undefined ? { category: body.category } : {}),
    ...(body.followUpNeeded !== undefined ? { followUpNeeded: body.followUpNeeded } : {}),
  }
  saveTable('CounselingRecord', rows)
  return { item: serializeRecord(rows[idx]) }
})

route('DELETE', '/safety/counseling-records/:id', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const rows = table('CounselingRecord')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Counseling record')
  if (rows[idx].counselorId !== actor.userId) throw forbidden('Only the counselor who wrote this record may delete it')
  rows.splice(idx, 1)
  saveTable('CounselingRecord', rows)
  return { ok: true }
})

/* ═══════════════════════════ CounselingSettings (admin-set oversight toggle) ═══════════════════════════ */

route('GET', '/safety/counseling-settings', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  return { item: { oversightEnabled: oversightEnabled(actor) } }
})

route('PATCH', '/safety/counseling-settings', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const { oversightEnabled: next } = ctx.body as { oversightEnabled?: boolean }
  if (typeof next !== 'boolean') throw badRequest('oversightEnabled must be a boolean')
  const rows = table('CounselingSettings')
  const idx = rows.findIndex(s => s.schoolId === actor.schoolId)
  if (idx === -1) rows.push({ id: uid('counselingsettings'), schoolId: actor.schoolId, oversightEnabled: next, createdAt: nowIso() })
  else rows[idx] = { ...rows[idx], oversightEnabled: next }
  saveTable('CounselingSettings', rows)
  return { item: { oversightEnabled: next } }
})

/* ═══════════════════════════ AnonymousReport ═══════════════════════════
 * Genuinely anonymous: no submittedById field is ever stored, and `actor.userId` is used ONLY for the
 * role check below (must be a student or parent) — never written to the row. */

function serializeReport(r: Row) {
  return {
    id: r.id, category: r.category, description: r.description, submittedAt: r.submittedAt, status: r.status,
    reviewedById: r.reviewedById ?? undefined, resolutionNotes: r.resolutionNotes ?? undefined,
  }
}

route('POST', '/safety/anonymous-reports', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (actor.role !== 'student' && actor.role !== 'parent') throw forbidden('Only a student or parent may submit an anonymous report')
  const body = ctx.body as { category?: string; description?: string }
  const categories = ['Bullying', 'Safety', 'Wellbeing', 'Other']
  if (!body.category || !categories.includes(body.category)) throw badRequest('A valid category is required')
  if (!body.description?.trim()) throw badRequest('description is required')
  const row: Row = {
    id: uid('anonymousreport'), schoolId: actor.schoolId, category: body.category, description: body.description.trim(),
    submittedAt: nowIso(), status: 'New', reviewedById: null, resolutionNotes: null,
  }
  const rows = table('AnonymousReport')
  rows.push(row)
  saveTable('AnonymousReport', rows)
  // Deliberately no reference to actor.userId anywhere in the stored row above.
  return status(201, { item: serializeReport(row) })
})

route('GET', '/safety/anonymous-reports', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!canReviewAnonymousReports(actor)) throw forbidden('Only a counselor or admin/superadmin may view anonymous reports')
  const { status: st } = ctx.query
  let rows = table('AnonymousReport').filter(r => r.schoolId === actor.schoolId)
  if (st) rows = rows.filter(r => r.status === st)
  rows = [...rows].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))
  return { items: rows.map(serializeReport) }
})

route('GET', '/safety/anonymous-reports/:id', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!canReviewAnonymousReports(actor)) throw forbidden('Only a counselor or admin/superadmin may view anonymous reports')
  const row = table('AnonymousReport').find(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (!row) throw notFound('Anonymous report')
  return { item: serializeReport(row) }
})

route('PATCH', '/safety/anonymous-reports/:id', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  if (!canReviewAnonymousReports(actor)) throw forbidden('Only a counselor or admin/superadmin may review anonymous reports')
  const rows = table('AnonymousReport')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Anonymous report')
  const body = ctx.body as { status?: string; resolutionNotes?: string | null }
  const statuses = ['New', 'Reviewing', 'Resolved']
  if (body.status !== undefined && !statuses.includes(body.status)) throw badRequest('Invalid status')
  rows[idx] = {
    ...rows[idx],
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.resolutionNotes !== undefined ? { resolutionNotes: body.resolutionNotes } : {}),
    reviewedById: actor.userId,
  }
  saveTable('AnonymousReport', rows)
  return { item: serializeReport(rows[idx]) }
})

/* ═══════════════════════════ PATCH /users/:id/counselor ═══════════════════════════ */

route('PATCH', '/users/:id/counselor', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const { isCounselor: next } = ctx.body as { isCounselor?: boolean }
  if (typeof next !== 'boolean') throw badRequest('isCounselor must be a boolean')
  const rows = table('User')
  const idx = rows.findIndex(u => u.id === ctx.params.id && u.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('User')
  rows[idx] = { ...rows[idx], isCounselor: next }
  saveTable('User', rows)
  return { user: serializeUser(rows[idx]) }
})
