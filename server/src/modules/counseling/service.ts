import type { z } from 'zod'
import type { CounselingRecord, AnonymousReport } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { ADMIN_ROLES } from '../../lib/scope'
import { toDate, fmtDate } from '../../lib/validate'
import type { createCounselingRecord, patchCounselingRecord, counselingQuery, createAnonymousReport, patchAnonymousReport, anonymousReportQuery } from './schema'

// See phase-22-campus-safety.md → item 3. Deliberately its OWN module, not folded into modules/health/
// (visible to class teachers) or modules/staffConduct/ (HR/admin-only): CounselingRecord needs a THIRD,
// narrower shape of RBAC that neither existing pattern expresses — counselor-only by default, with an
// explicit opt-in for admin/superadmin oversight that most schools will never turn on. Mixing that check
// into a module whose default reader set is wider risks a copy-paste bug quietly widening this one, so it
// gets a dedicated module, a dedicated (small) service, and its own tests.
//
// AnonymousReport lives here too (not modules/safety/) because it shares the counselor+oversight reader
// set with CounselingRecord, and because keeping "no identity, ever" code next to the strictest RBAC in
// the codebase is easier to audit than splitting it across modules.

// ── CounselingRecord ──────────────────────────────────────────────────────────────────────────────────

export const serializeCounselingRecord = (r: CounselingRecord) => ({
  id: r.id,
  studentId: r.studentId,
  counselorId: r.counselorId,
  sessionDate: fmtDate(r.sessionDate),
  notes: r.notes,
  category: r.category ?? undefined,
  followUpNeeded: r.followUpNeeded,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

// Fetches the acting user's own `isCounselor` flag — never trust `ctx.role` alone for this; counselors
// keep their ordinary teacher/staff role, isCounselor is a separate, admin-set capability (see
// prisma/schema.prisma → User.isCounselor).
async function isCounselor(ctx: Ctx): Promise<boolean> {
  const me = await prisma.user.findFirst({ where: { id: ctx.actorId, schoolId: ctx.schoolId }, select: { isCounselor: true } })
  return !!me?.isCounselor
}

async function assertIsCounselor(ctx: Ctx) {
  if (!(await isCounselor(ctx))) throw new HttpError(403, 'Only a designated counselor may access counseling records')
}

async function oversightEnabled(ctx: Ctx): Promise<boolean> {
  const settings = await prisma.counselingSettings.findUnique({ where: { schoolId: ctx.schoolId } })
  return !!settings?.oversightEnabled
}

// The dedicated, narrower visibility check the spec calls for — do not reuse modules/health's
// canViewHealth or modules/staffConduct's router-level requireRole('admin','superadmin'). A record is
// visible ONLY to the counselor who owns it, or to admin/superadmin when this specific school has
// explicitly turned oversight on (default: off, i.e. counselor-only). Nobody else — not the class
// teacher, not plain staff, not the student, not the parent — gets a path through this function.
async function canAccessCounselingRecord(ctx: Ctx, record: { counselorId: string }): Promise<boolean> {
  if (ctx.actorId === record.counselorId) return true
  if (ADMIN_ROLES.includes(ctx.role) && (await oversightEnabled(ctx))) return true
  return false
}

async function assertStudent(ctx: Ctx, studentId: string) {
  const row = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!row) throw notFound('Student')
  return row
}

// GET / — studentId optional. Without it: every record the caller may see (their own as counselor, or
// — oversight-enabled only — every record in the school). With it: same visibility, scoped to that
// student (never widens access; a non-counselor / non-oversight caller still gets nothing).
export async function listCounselingRecords(ctx: Ctx, q: z.infer<typeof counselingQuery>) {
  const oversight = ADMIN_ROLES.includes(ctx.role) && (await oversightEnabled(ctx))
  if (!oversight && !(await isCounselor(ctx))) return []
  const where = {
    schoolId: ctx.schoolId,
    ...(q.studentId ? { studentId: q.studentId } : {}),
    ...(oversight ? {} : { counselorId: ctx.actorId }),
  }
  const rows = await prisma.counselingRecord.findMany({ where, orderBy: { sessionDate: 'desc' } })
  // Every read of a restricted record is itself audited (who accessed what) — see spec: "an audit trail
  // of access is a safety feature, not a leak". Best-effort, one row per accessed record, non-blocking.
  await Promise.all(rows.map(r => audit(ctx.schoolId, ctx.actorId, 'view', 'counselingRecord', r.id)))
  return rows.map(serializeCounselingRecord)
}

export async function getCounselingRecord(ctx: Ctx, id: string) {
  const row = await prisma.counselingRecord.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Counseling record')
  if (!(await canAccessCounselingRecord(ctx, row))) throw new HttpError(403, 'You do not have access to this counseling record')
  await audit(ctx.schoolId, ctx.actorId, 'view', 'counselingRecord', row.id)
  return row
}

export async function createCounselingRecordSvc(ctx: Ctx, input: z.infer<typeof createCounselingRecord>) {
  await assertIsCounselor(ctx)
  await assertStudent(ctx, input.studentId)
  const row = await prisma.counselingRecord.create({
    data: {
      schoolId: ctx.schoolId, studentId: input.studentId, counselorId: ctx.actorId, sessionDate: toDate(input.sessionDate),
      notes: input.notes, category: input.category ?? null, followUpNeeded: input.followUpNeeded ?? false,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'counselingRecord', row.id, undefined, { studentId: row.studentId })
  return row
}

export async function updateCounselingRecord(ctx: Ctx, id: string, input: z.infer<typeof patchCounselingRecord>) {
  const before = await prisma.counselingRecord.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Counseling record')
  // Writes are stricter than reads: only the owning counselor edits their own record — oversight grants
  // visibility, not the ability to rewrite another counselor's notes.
  if (before.counselorId !== ctx.actorId) throw new HttpError(403, 'Only the counselor who wrote this record may edit it')
  const row = await prisma.counselingRecord.update({
    where: { id },
    data: {
      sessionDate: input.sessionDate ? toDate(input.sessionDate) : undefined,
      notes: input.notes, category: input.category, followUpNeeded: input.followUpNeeded,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'counselingRecord', id, undefined, { studentId: row.studentId })
  return row
}

export async function deleteCounselingRecord(ctx: Ctx, id: string) {
  const before = await prisma.counselingRecord.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Counseling record')
  if (before.counselorId !== ctx.actorId) throw new HttpError(403, 'Only the counselor who wrote this record may delete it')
  await prisma.counselingRecord.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'counselingRecord', id, undefined, { studentId: before.studentId })
}

// ── CounselingSettings (admin-set oversight toggle) ───────────────────────────────────────────────────

export async function getCounselingSettings(ctx: Ctx) {
  const row = await prisma.counselingSettings.findUnique({ where: { schoolId: ctx.schoolId } })
  return { oversightEnabled: row?.oversightEnabled ?? false }
}

export async function setCounselingSettings(ctx: Ctx, oversightEnabled: boolean) {
  const before = await prisma.counselingSettings.findUnique({ where: { schoolId: ctx.schoolId } })
  const row = await prisma.counselingSettings.upsert({
    where: { schoolId: ctx.schoolId },
    create: { schoolId: ctx.schoolId, oversightEnabled },
    update: { oversightEnabled },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'counselingSettings', row.id, { oversightEnabled: before?.oversightEnabled ?? false }, { oversightEnabled: row.oversightEnabled })
  return { oversightEnabled: row.oversightEnabled }
}

// ── AnonymousReport ────────────────────────────────────────────────────────────────────────────────────
// Genuinely anonymous: no submittedById field exists on the model (see prisma/schema.prisma), and this
// service never writes the submitter's identity anywhere it could leak back out — not into the row, and
// not into an audit() call. `ctx.actorId` here is used ONLY for the role check (must be a student or
// parent to submit) and is never read again after that check returns.

export const serializeAnonymousReport = (r: AnonymousReport) => ({
  id: r.id,
  category: r.category,
  description: r.description,
  submittedAt: r.submittedAt.toISOString(),
  status: r.status,
  reviewedById: r.reviewedById ?? undefined,
  resolutionNotes: r.resolutionNotes ?? undefined,
})

export async function createAnonymousReportSvc(ctx: Ctx, input: z.infer<typeof createAnonymousReport>) {
  if (ctx.role !== 'student' && ctx.role !== 'parent') throw new HttpError(403, 'Only a student or parent may submit an anonymous report')
  const row = await prisma.anonymousReport.create({
    data: { schoolId: ctx.schoolId, category: input.category, description: input.description, status: 'New' },
  })
  // Deliberately NO audit() call here — see module header. An audit entry would necessarily carry
  // `actorId` (the submitter), which is exactly the identifying trace this model promises never to keep.
  return row
}

function canReviewAnonymousReports(ctx: Ctx): Promise<boolean> {
  if (ADMIN_ROLES.includes(ctx.role)) return Promise.resolve(true)
  return isCounselor(ctx)
}

export async function listAnonymousReports(ctx: Ctx, q: z.infer<typeof anonymousReportQuery>) {
  if (!(await canReviewAnonymousReports(ctx))) throw new HttpError(403, 'Only a counselor or admin/superadmin may view anonymous reports')
  const rows = await prisma.anonymousReport.findMany({ where: { schoolId: ctx.schoolId, status: q.status }, orderBy: { submittedAt: 'desc' } })
  return rows.map(serializeAnonymousReport)
}

export async function getAnonymousReport(ctx: Ctx, id: string) {
  if (!(await canReviewAnonymousReports(ctx))) throw new HttpError(403, 'Only a counselor or admin/superadmin may view anonymous reports')
  const row = await prisma.anonymousReport.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Anonymous report')
  return row
}

export async function updateAnonymousReport(ctx: Ctx, id: string, input: z.infer<typeof patchAnonymousReport>) {
  if (!(await canReviewAnonymousReports(ctx))) throw new HttpError(403, 'Only a counselor or admin/superadmin may review anonymous reports')
  const before = await prisma.anonymousReport.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Anonymous report')
  const row = await prisma.anonymousReport.update({
    where: { id },
    data: { status: input.status, resolutionNotes: input.resolutionNotes, reviewedById: ctx.actorId },
  })
  // This audit entry is about the REVIEWER's action (who reviewed/resolved report X), never the
  // submitter's identity — the report itself carries no submitter field to leak in the first place.
  await audit(ctx.schoolId, ctx.actorId, 'review', 'anonymousReport', id, { status: before.status }, { status: row.status })
  return row
}
