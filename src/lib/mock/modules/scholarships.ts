// Mirrors server/src/modules/scholarships's contract: the scholarship catalog (admin/superadmin define)
// and awards (staff/admin/superadmin propose, admin/superadmin approve/reject). Approval retroactively
// discounts the student's not-yet-fully-paid fee invoices for the academic year — same allocation logic
// as the real server's lib/scholarshipDiscount.ts, inlined here since it's a small pure function. See
// .agents/edunova/static-demo-plan.md and phase-21-financial-intelligence.md item 4.
//
// The Fees module (FeeInvoice) may not exist yet in this demo depending on build order — same situation
// modules/accounting.ts's reports already handle by treating an absent/empty FeeInvoice table as zero.
// approveAward below does the same: if there are no invoices to discount, it still approves the award,
// just with totalDiscountApplied staying at 0 for now.

import { route, requireAuth, requireRole, status, type Actor, type ReqCtx } from '../router'
import { badRequest, conflict, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']
const ADMIN_ROLES = ['admin', 'superadmin']
const isStaff = (actor: Actor) => STAFF_ROLES.includes(actor.role)

const round2 = (n: number) => Math.round(n * 100) / 100

/** Same shape/behavior as the real server's lib/scholarshipDiscount.ts#allocateScholarshipDiscount —
 * a Percentage discount applies independently to every invoice; a FixedAmount discount draws down a
 * single pool across the invoices in the order given. */
function allocateScholarshipDiscount(
  discountType: 'Percentage' | 'FixedAmount', discountValue: number,
  invoices: Array<{ id: string; total: number; concession: number }>, alreadyConsumed = 0,
): Map<string, number> {
  const out = new Map<string, number>()
  let remainingFixed = discountType === 'FixedAmount' ? round2(discountValue - alreadyConsumed) : null
  for (const inv of invoices) {
    const available = round2(inv.total - inv.concession)
    if (available <= 0) continue
    let discount = discountType === 'Percentage' ? round2(inv.total * (discountValue / 100)) : Math.max(0, remainingFixed ?? 0)
    discount = Math.min(discount, available)
    if (discount <= 0) continue
    out.set(inv.id, discount)
    if (remainingFixed !== null) remainingFixed = round2(remainingFixed - discount)
  }
  return out
}

/* ═══════════════════════════ serializers ═══════════════════════════ */

function serializeScholarship(s: Row) {
  return { id: s.id, name: s.name, type: s.type, discountType: s.discountType, discountValue: s.discountValue, criteria: s.criteria ?? undefined, active: s.active !== false, createdAt: s.createdAt }
}

function serializeAward(a: Row) {
  return {
    id: a.id, scholarshipId: a.scholarshipId, studentId: a.studentId, academicYearId: a.academicYearId,
    status: a.status, reason: a.reason ?? undefined, proposedById: a.proposedById,
    approvedById: a.approvedById ?? undefined, approvedAt: a.approvedAt ?? undefined,
    appliedToInvoiceIds: (a.appliedToInvoiceIds as string[] | undefined) ?? [], totalDiscountApplied: (a.totalDiscountApplied as number | undefined) ?? 0,
    createdAt: a.createdAt,
  }
}

/* ═══════════════════════════ awards — registered before /:id so "awards" is never swallowed by it ═══════════════════════════ */

function scopeAwardQuery(actor: Actor, q: Record<string, string>): Record<string, string> {
  if (isStaff(actor)) return q
  if (!q.studentId) throw forbidden('studentId is required')
  if (actor.role === 'student' && q.studentId !== actor.userId) throw forbidden('You can only view your own awards')
  if (actor.role === 'parent') {
    const isWard = table('Guardian').some(g => g.schoolId === actor.schoolId && g.parentId === actor.userId && g.studentId === q.studentId)
    if (!isWard) throw forbidden('That student is not your ward')
  }
  return q
}

route('GET', '/scholarships/awards', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const { status: st, studentId, academicYearId, scholarshipId } = scopeAwardQuery(actor, ctx.query)
  let rows = table('ScholarshipAward').filter(a => a.schoolId === actor.schoolId)
  if (st) rows = rows.filter(a => a.status === st)
  if (studentId) rows = rows.filter(a => a.studentId === studentId)
  if (academicYearId) rows = rows.filter(a => a.academicYearId === academicYearId)
  if (scholarshipId) rows = rows.filter(a => a.scholarshipId === scholarshipId)
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializeAward) }
})

route('POST', '/scholarships/awards', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const body = ctx.body as { scholarshipId?: string; studentId?: string; academicYearId?: string }
  if (!body.scholarshipId || !body.studentId || !body.academicYearId) throw badRequest('scholarshipId, studentId and academicYearId are required')
  const scholarship = table('Scholarship').find(s => s.id === body.scholarshipId && s.schoolId === actor.schoolId)
  if (!scholarship) throw notFound('Scholarship')
  if (scholarship.active === false) throw badRequest('This scholarship is not active')
  const student = table('User').find(u => u.id === body.studentId && u.schoolId === actor.schoolId && u.role === 'student')
  if (!student) throw notFound('Student')
  const year = table('AcademicYear').find(y => y.id === body.academicYearId && y.schoolId === actor.schoolId)
  if (!year) throw notFound('Academic year')
  const existing = table('ScholarshipAward').find(a =>
    a.schoolId === actor.schoolId && a.scholarshipId === scholarship.id && a.studentId === student.id && a.academicYearId === year.id)
  if (existing) throw conflict('An award for this scholarship/student/academic year already exists', { id: existing.id, status: existing.status })
  const row: Row = {
    id: uid('scholarshipaward'), schoolId: actor.schoolId, scholarshipId: scholarship.id, studentId: student.id, academicYearId: year.id,
    status: 'Pending', reason: null, proposedById: actor.userId, approvedById: null, approvedAt: null,
    appliedToInvoiceIds: [], totalDiscountApplied: 0, createdAt: nowIso(),
  }
  const rows = table('ScholarshipAward')
  rows.push(row)
  saveTable('ScholarshipAward', rows)
  return status(201, { item: serializeAward(row) })
})

route('GET', '/scholarships/awards/:id', (ctx: ReqCtx) => {
  const actor = requireAuth(ctx)
  const row = table('ScholarshipAward').find(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (!row) throw notFound('Scholarship award')
  if (!isStaff(actor)) scopeAwardQuery(actor, { studentId: row.studentId as string })
  return { item: serializeAward(row) }
})

route('POST', '/scholarships/awards/:id/approve', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const rows = table('ScholarshipAward')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Scholarship award')
  const before = rows[idx]
  if (before.status !== 'Pending') throw conflict(`Award is already ${before.status}, not Pending`)
  const scholarship = table('Scholarship').find(s => s.id === before.scholarshipId)
  if (!scholarship) throw notFound('Scholarship')

  let approved: Row = { ...before, status: 'Approved', approvedById: actor.userId, approvedAt: nowIso() }
  rows[idx] = approved
  saveTable('ScholarshipAward', rows)

  const terms = table('Term').filter(t => t.schoolId === actor.schoolId && t.academicYearId === before.academicYearId)
  const termIds = new Set(terms.map(t => t.id))
  const invoices = termIds.size
    ? table('FeeInvoice').filter(i => i.schoolId === actor.schoolId && i.studentId === before.studentId && termIds.has(i.termId as string) && i.status !== 'Paid' && i.status !== 'Waived')
      .sort((a, b) => String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')))
    : []

  if (invoices.length && scholarship.discountType && typeof scholarship.discountValue === 'number') {
    const alloc = allocateScholarshipDiscount(
      scholarship.discountType as 'Percentage' | 'FixedAmount', scholarship.discountValue as number,
      invoices.map(i => ({ id: i.id, total: Number(i.total ?? 0), concession: Number(i.concession ?? 0) })),
      Number(approved.totalDiscountApplied ?? 0),
    )
    if (alloc.size) {
      const feeInvoices = table('FeeInvoice')
      const appliedIds: string[] = []
      let totalDiscount = 0
      for (const inv of invoices) {
        const discount = alloc.get(inv.id)
        if (!discount) continue
        const fidx = feeInvoices.findIndex(f => f.id === inv.id)
        if (fidx !== -1) {
          const newConcession = round2(Number(feeInvoices[fidx].concession ?? 0) + discount)
          const total = Number(feeInvoices[fidx].total ?? 0)
          const paid = Number(feeInvoices[fidx].paidAmount ?? 0)
          const balance = round2(total - newConcession - paid)
          const newStatus = balance <= 0 ? 'Paid' : paid > 0 ? 'PartiallyPaid' : 'Due'
          feeInvoices[fidx] = { ...feeInvoices[fidx], concession: newConcession, status: newStatus }
        }
        appliedIds.push(inv.id)
        totalDiscount = round2(totalDiscount + discount)
      }
      saveTable('FeeInvoice', feeInvoices)
      approved = { ...approved, appliedToInvoiceIds: [...(approved.appliedToInvoiceIds as string[]), ...appliedIds], totalDiscountApplied: round2(Number(approved.totalDiscountApplied ?? 0) + totalDiscount) }
      const idx2 = rows.findIndex(a => a.id === approved.id)
      rows[idx2] = approved
      saveTable('ScholarshipAward', rows)
    }
  }

  return { item: serializeAward(approved) }
})

route('POST', '/scholarships/awards/:id/reject', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const rows = table('ScholarshipAward')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Scholarship award')
  if (rows[idx].status !== 'Pending') throw conflict(`Award is already ${rows[idx].status}, not Pending`)
  const { reason } = ctx.body as { reason?: string }
  rows[idx] = { ...rows[idx], status: 'Rejected', reason: reason ?? null }
  saveTable('ScholarshipAward', rows)
  return { item: serializeAward(rows[idx]) }
})

/* ═══════════════════════════ scholarships (catalog) ═══════════════════════════ */

route('GET', '/scholarships', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { active } = ctx.query
  let rows = table('Scholarship').filter(s => s.schoolId === actor.schoolId)
  if (active !== undefined) rows = rows.filter(s => (s.active !== false) === (active === 'true'))
  rows = [...rows].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
  return { items: rows.map(serializeScholarship) }
})

route('POST', '/scholarships', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const body = ctx.body as { name?: string; type?: string; discountType?: string; discountValue?: number; criteria?: string; active?: boolean }
  if (!body.name?.trim() || !body.type || !body.discountType || typeof body.discountValue !== 'number' || body.discountValue <= 0) {
    throw badRequest('name, type, discountType and a positive discountValue are required')
  }
  if (body.discountType === 'Percentage' && body.discountValue > 100) throw badRequest('A percentage discount cannot exceed 100')
  if (table('Scholarship').some(s => s.schoolId === actor.schoolId && s.name === body.name)) throw conflict(`A scholarship named "${body.name}" already exists`)
  const row: Row = {
    id: uid('scholarship'), schoolId: actor.schoolId, name: body.name.trim(), type: body.type, discountType: body.discountType,
    discountValue: body.discountValue, criteria: body.criteria ?? null, active: body.active ?? true, createdAt: nowIso(),
  }
  const rows = table('Scholarship')
  rows.push(row)
  saveTable('Scholarship', rows)
  return status(201, { item: serializeScholarship(row) })
})

route('GET', '/scholarships/:id', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const row = table('Scholarship').find(s => s.id === ctx.params.id && s.schoolId === actor.schoolId)
  if (!row) throw notFound('Scholarship')
  return { item: serializeScholarship(row) }
})

// type/discountType/discountValue are immutable after creation — changing them after awards already
// exist against this scholarship would silently misrepresent what was actually approved historically.
route('PATCH', '/scholarships/:id', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const rows = table('Scholarship')
  const idx = rows.findIndex(s => s.id === ctx.params.id && s.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Scholarship')
  const body = ctx.body as { name?: string; criteria?: string | null; active?: boolean }
  rows[idx] = {
    ...rows[idx],
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.criteria !== undefined ? { criteria: body.criteria } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
  }
  saveTable('Scholarship', rows)
  return { item: serializeScholarship(rows[idx]) }
})

route('DELETE', '/scholarships/:id', (ctx: ReqCtx) => {
  const actor = requireRole(ctx, ...ADMIN_ROLES)
  const rows = table('Scholarship')
  const idx = rows.findIndex(s => s.id === ctx.params.id && s.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Scholarship')
  if (table('ScholarshipAward').some(a => a.scholarshipId === rows[idx].id)) throw badRequest('Cannot delete a scholarship that already has awards against it — deactivate it instead')
  rows.splice(idx, 1)
  saveTable('Scholarship', rows)
  return { ok: true }
})
