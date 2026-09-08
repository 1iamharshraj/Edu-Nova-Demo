import type { z } from 'zod'
import type { Achievement } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isAdmin, isStaff, isGuardianOf } from '../../lib/scope'
import { toDate, fmtDate } from '../../lib/validate'
import type { createAchievement, patchAchievement, achievementsQuery } from './schema'

// See phase-8-welfare.md → Rules ("Achievements"). Add: student/teacher for themselves. Verify: staff/admin.
// A parent sees their wards' achievements.

export const serializeAchievement = (a: Achievement) => ({
  id: a.id, userId: a.userId, title: a.title, detail: a.detail, date: fmtDate(a.date), category: a.category,
  verifiedById: a.verifiedById ?? undefined, verifiedAt: a.verifiedAt?.toISOString(), fileIds: a.fileIds, createdAt: a.createdAt.toISOString(),
})

async function canView(ctx: Ctx, userId: string): Promise<boolean> {
  if (isStaff(ctx)) return true
  if (ctx.actorId === userId) return true
  return isGuardianOf(ctx, userId)
}

export async function listAchievements(ctx: Ctx, q: z.infer<typeof achievementsQuery>) {
  if (q.userId) {
    if (!(await canView(ctx, q.userId))) throw new HttpError(403, 'You cannot view this user’s achievements')
    const rows = await prisma.achievement.findMany({ where: { schoolId: ctx.schoolId, userId: q.userId }, orderBy: { date: 'desc' } })
    return rows.map(serializeAchievement)
  }
  if (isStaff(ctx)) {
    const rows = await prisma.achievement.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { date: 'desc' } })
    return rows.map(serializeAchievement)
  }
  const rows = await prisma.achievement.findMany({ where: { schoolId: ctx.schoolId, userId: ctx.actorId }, orderBy: { date: 'desc' } })
  return rows.map(serializeAchievement)
}

export async function createAchievementSvc(ctx: Ctx, input: z.infer<typeof createAchievement>) {
  const userId = input.userId ?? ctx.actorId
  if (ctx.role !== 'student' && ctx.role !== 'teacher' && !isStaff(ctx)) throw new HttpError(403, 'Only a student or teacher may add an achievement')
  if (userId !== ctx.actorId && !isStaff(ctx)) throw new HttpError(403, 'You may only add an achievement for yourself')
  const row = await prisma.achievement.create({
    data: { schoolId: ctx.schoolId, userId, title: input.title, detail: input.detail, date: toDate(input.date), category: input.category, fileIds: input.fileIds ?? [] },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'achievement', row.id, undefined, { userId: row.userId, title: row.title })
  return row
}

async function getOwnedOrAdmin(ctx: Ctx, id: string) {
  const row = await prisma.achievement.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Achievement')
  if (row.userId !== ctx.actorId && !isAdmin(ctx)) throw new HttpError(403, 'Only the owner or admin may modify this achievement')
  return row
}

export async function updateAchievement(ctx: Ctx, id: string, input: z.infer<typeof patchAchievement>) {
  const before = await getOwnedOrAdmin(ctx, id)
  const row = await prisma.achievement.update({
    where: { id },
    data: { title: input.title, detail: input.detail, date: input.date ? toDate(input.date) : undefined, category: input.category, fileIds: input.fileIds },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'achievement', id, serializeAchievement(before), serializeAchievement(row))
  return row
}

export async function deleteAchievement(ctx: Ctx, id: string) {
  const before = await getOwnedOrAdmin(ctx, id)
  await prisma.achievement.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'achievement', id, serializeAchievement(before))
}

export async function verifyAchievement(ctx: Ctx, id: string) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may verify an achievement')
  const before = await prisma.achievement.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Achievement')
  const row = await prisma.achievement.update({ where: { id }, data: { verifiedById: ctx.actorId, verifiedAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'verify', 'achievement', id, serializeAchievement(before), serializeAchievement(row))
  return row
}
