import type { EmploymentHistoryEntry } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate } from '../../lib/validate'
import { isAdmin } from '../../lib/scope'
import { logger } from '../../lib/logger'
import type { ChangeType } from './schema'

// See phase-11-employee-management.md → A4.

export const serializeHistoryEntry = (e: EmploymentHistoryEntry) => ({
  id: e.id,
  userId: e.userId,
  changeType: e.changeType,
  fromValue: e.fromValue ?? undefined,
  toValue: e.toValue,
  effectiveDate: fmtDate(e.effectiveDate),
  changedById: e.changedById,
  note: e.note ?? undefined,
  createdAt: e.createdAt.toISOString(),
})

// Best-effort append-only log, called *after* the real write (role change / PATCH /users/:id /
// upsertStructure) already succeeded. Never throws — a logging failure must not roll back or block the
// actual change (see A4: "wrap in try/catch and log-and-continue on failure").
export async function logChange(
  schoolId: string,
  userId: string,
  changeType: ChangeType,
  fromValue: string | null,
  toValue: string,
  changedById: string,
  note?: string,
) {
  try {
    const row = await prisma.employmentHistoryEntry.create({
      data: { schoolId, userId, changeType, fromValue, toValue, effectiveDate: new Date(), changedById, note: note ?? null },
    })
    await audit(schoolId, changedById, 'create', 'employmentHistoryEntry', row.id, undefined, serializeHistoryEntry(row))
  } catch (err) {
    logger.error({ err, schoolId, userId, changeType }, 'employment history log failed (non-fatal)')
  }
}

// GET /employment-history/:userId — self, HR/admin/superadmin, or (per A2) that user's manager.
export async function listHistory(ctx: Ctx, userId: string) {
  if (ctx.actorId !== userId && !isAdmin(ctx)) {
    const target = await prisma.user.findFirst({ where: { id: userId, schoolId: ctx.schoolId }, select: { reportsTo: true } })
    if (!target || target.reportsTo !== ctx.actorId) throw new HttpError(403, 'You may only view your own employment history')
  }
  return prisma.employmentHistoryEntry.findMany({
    where: { schoolId: ctx.schoolId, userId },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
  })
}
