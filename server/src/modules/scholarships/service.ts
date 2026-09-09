import type { z } from 'zod'
import type { Prisma, Scholarship, ScholarshipAward } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { assertViewStudent, isAdmin, isStaff } from '../../lib/scope'
import { allocateScholarshipDiscount, type DiscountType } from '../../lib/scholarshipDiscount'
import { recomputeStatus } from '../fees/service'
import type { createScholarship, patchScholarship, scholarshipQuery, createAward, awardQuery, rejectAward } from './schema'

type Tx = Prisma.TransactionClient

const round2 = (n: number) => Math.round(n * 100) / 100

// ─────────────────────────── serializers ───────────────────────────

export const serializeScholarship = (s: Scholarship) => ({
  id: s.id, name: s.name, type: s.type, discountType: s.discountType, discountValue: s.discountValue,
  criteria: s.criteria ?? undefined, active: s.active, createdAt: s.createdAt.toISOString(),
})

export const serializeAward = (a: ScholarshipAward) => ({
  id: a.id, scholarshipId: a.scholarshipId, studentId: a.studentId, academicYearId: a.academicYearId,
  status: a.status, reason: a.reason ?? undefined, proposedById: a.proposedById,
  approvedById: a.approvedById ?? undefined, approvedAt: a.approvedAt?.toISOString(),
  appliedToInvoiceIds: a.appliedToInvoiceIds, totalDiscountApplied: a.totalDiscountApplied,
  createdAt: a.createdAt.toISOString(),
})

// ─────────────────────────── scholarships (programs) ───────────────────────────

export async function listScholarships(ctx: Ctx, q: z.infer<typeof scholarshipQuery>) {
  return prisma.scholarship.findMany({
    where: { schoolId: ctx.schoolId, active: q.active !== undefined ? q.active === 'true' : undefined },
    orderBy: [{ createdAt: 'asc' }],
  })
}

async function getScholarshipRaw(ctx: Ctx, id: string) {
  const row = await prisma.scholarship.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Scholarship')
  return row
}

export async function getScholarship(ctx: Ctx, id: string) {
  return getScholarshipRaw(ctx, id)
}

export async function createScholarshipRow(ctx: Ctx, input: z.infer<typeof createScholarship>) {
  const existing = await prisma.scholarship.findFirst({ where: { schoolId: ctx.schoolId, name: input.name } })
  if (existing) throw new HttpError(409, `A scholarship named "${input.name}" already exists`)
  const row = await prisma.scholarship.create({
    data: {
      schoolId: ctx.schoolId, name: input.name, type: input.type, discountType: input.discountType,
      discountValue: input.discountValue, criteria: input.criteria ?? null, active: input.active ?? true,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'scholarship', row.id, undefined, serializeScholarship(row))
  return row
}

export async function updateScholarshipRow(ctx: Ctx, id: string, input: z.infer<typeof patchScholarship>) {
  const before = await getScholarshipRaw(ctx, id)
  const row = await prisma.scholarship.update({
    where: { id },
    data: { name: input.name, criteria: input.criteria === undefined ? undefined : input.criteria, active: input.active },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'scholarship', id, serializeScholarship(before), serializeScholarship(row))
  return row
}

export async function removeScholarshipRow(ctx: Ctx, id: string) {
  const before = await getScholarshipRaw(ctx, id)
  const awardCount = await prisma.scholarshipAward.count({ where: { scholarshipId: id } })
  if (awardCount > 0) throw new HttpError(400, 'Cannot delete a scholarship that already has awards against it — deactivate it instead')
  await prisma.scholarship.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'scholarship', id, serializeScholarship(before))
}

// ─────────────────────────── awards ───────────────────────────

// Staff/admin/superadmin see every award; a parent/student may only see their own child's / their own.
async function scopeAwardQuery(ctx: Ctx, q: z.infer<typeof awardQuery>) {
  if (isStaff(ctx)) return q
  if (!q.studentId) throw new HttpError(403, 'studentId is required')
  await assertViewStudent(ctx, q.studentId)
  return q
}

export async function listAwards(ctx: Ctx, q: z.infer<typeof awardQuery>) {
  const scoped = await scopeAwardQuery(ctx, q)
  return prisma.scholarshipAward.findMany({
    where: {
      schoolId: ctx.schoolId, status: scoped.status, studentId: scoped.studentId,
      academicYearId: scoped.academicYearId, scholarshipId: scoped.scholarshipId,
    },
    orderBy: [{ createdAt: 'desc' }],
  })
}

async function getAwardRaw(ctx: Ctx, id: string) {
  const row = await prisma.scholarshipAward.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Scholarship award')
  return row
}

export async function getAward(ctx: Ctx, id: string) {
  const row = await getAwardRaw(ctx, id)
  if (!isStaff(ctx)) await assertViewStudent(ctx, row.studentId)
  return row
}

// POST /scholarships/awards — staff/admin propose (Pending). One award per (scholarship, student,
// academic year) — enforced by the DB unique constraint, checked here first for a clean 409.
export async function proposeAward(ctx: Ctx, input: z.infer<typeof createAward>) {
  const [scholarship, student, year] = await Promise.all([
    prisma.scholarship.findFirst({ where: { id: input.scholarshipId, schoolId: ctx.schoolId } }),
    prisma.user.findFirst({ where: { id: input.studentId, schoolId: ctx.schoolId, role: 'student' } }),
    prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId: ctx.schoolId } }),
  ])
  if (!scholarship) throw notFound('Scholarship')
  if (!scholarship.active) throw new HttpError(400, 'This scholarship is not active')
  if (!student) throw notFound('Student')
  if (!year) throw notFound('Academic year')
  const existing = await prisma.scholarshipAward.findUnique({
    where: { scholarshipId_studentId_academicYearId: { scholarshipId: scholarship.id, studentId: student.id, academicYearId: year.id } },
  })
  if (existing) throw new HttpError(409, 'An award for this scholarship/student/academic year already exists', { id: existing.id, status: existing.status })
  const row = await prisma.scholarshipAward.create({
    data: {
      schoolId: ctx.schoolId, scholarshipId: scholarship.id, studentId: student.id, academicYearId: year.id,
      status: 'Pending', proposedById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'propose', 'scholarshipAward', row.id, undefined, serializeAward(row))
  return row
}

// POST /scholarships/awards/:id/reject — admin/superadmin. Pending -> Rejected only.
export async function rejectAwardRow(ctx: Ctx, id: string, input: z.infer<typeof rejectAward>) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  const before = await getAwardRaw(ctx, id)
  if (before.status !== 'Pending') throw new HttpError(409, `Award is already ${before.status}, not Pending`)
  const row = await prisma.scholarshipAward.update({ where: { id }, data: { status: 'Rejected', reason: input.reason ?? null } })
  await audit(ctx.schoolId, ctx.actorId, 'reject', 'scholarshipAward', id, serializeAward(before), serializeAward(row))
  return row
}

// POST /scholarships/awards/:id/approve — admin/superadmin. Pending -> Approved, and — the
// safety-critical part of this phase, see phase-21-financial-intelligence.md item 4 — the discount is
// actually applied to the student's fee invoices for the academic year right now: every not-yet-fully-
// paid invoice in the year gets its `concession` increased (via lib/scholarshipDiscount.ts's allocator,
// same logic fees/service.ts#generateInvoices uses for invoices created *after* this approval), and its
// status recomputed through fees/service.ts#recomputeStatus — the exact same funnel a real payment goes
// through, so PartiallyPaid/Paid/Due all come out consistent with the new, lower `total - concession`.
// The GL is *not* touched here directly and does not need to be: Phase 17's auto-posting hook only ever
// fires from an actual Payment (postFeePaymentAutoEntry in fees/service.ts#recordPayment), and a payment
// can never exceed the invoice's (now-reduced) balance, so the ledger only ever sees the reduced amount
// a parent actually pays — never the pre-discount total. See the live verification trace in the report.
export async function approveAward(ctx: Ctx, id: string) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  const before = await getAwardRaw(ctx, id)
  if (before.status !== 'Pending') throw new HttpError(409, `Award is already ${before.status}, not Pending`)
  const scholarship = await prisma.scholarship.findUniqueOrThrow({ where: { id: before.scholarshipId } })

  const row = await prisma.$transaction(async tx => {
    const approved = await tx.scholarshipAward.update({
      where: { id }, data: { status: 'Approved', approvedById: ctx.actorId, approvedAt: new Date() },
    })

    const terms = await tx.term.findMany({ where: { schoolId: ctx.schoolId, academicYearId: before.academicYearId }, select: { id: true } })
    const termIds = terms.map(t => t.id)
    if (!termIds.length) return approved

    // Not-yet-fully-paid invoices for this student in this academic year, oldest due date first — a
    // FixedAmount scholarship's pool is drawn down in that order (see allocateScholarshipDiscount).
    const invoices = await tx.feeInvoice.findMany({
      where: { schoolId: ctx.schoolId, studentId: before.studentId, termId: { in: termIds }, status: { notIn: ['Paid', 'Waived'] } },
      orderBy: [{ dueDate: 'asc' }],
    })
    if (!invoices.length) return approved

    const alloc = allocateScholarshipDiscount(
      scholarship.discountType as DiscountType, scholarship.discountValue,
      invoices.map(i => ({ id: i.id, total: i.total, concession: i.concession })),
      approved.totalDiscountApplied, // 0 for a fresh Pending->Approved award
    )
    if (alloc.size === 0) return approved

    const appliedIds: string[] = []
    let totalDiscount = 0
    for (const inv of invoices) {
      const discount = alloc.get(inv.id)
      if (!discount) continue
      await tx.feeInvoice.update({ where: { id: inv.id }, data: { concession: round2(inv.concession + discount) } })
      await recomputeStatus(tx, inv.id)
      appliedIds.push(inv.id)
      totalDiscount = round2(totalDiscount + discount)
    }

    return tx.scholarshipAward.update({
      where: { id },
      data: {
        appliedToInvoiceIds: { push: appliedIds },
        totalDiscountApplied: round2(approved.totalDiscountApplied + totalDiscount),
      },
    })
  })

  await audit(ctx.schoolId, ctx.actorId, 'approve', 'scholarshipAward', id, serializeAward(before), {
    ...serializeAward(row), discountApplied: round2(row.totalDiscountApplied - before.totalDiscountApplied),
  })
  return row
}
