// Mirrors server/src/modules/achievements/{router,service,schema}.ts's contract for
// src/portal/modules/actions.tsx (AchievementMod). Add: student/teacher for themselves (staff/admin for
// anyone). Verify: staff/admin. A parent sees their wards' achievements.

import { route, requireAuth, status } from '../router'
import { badRequest, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { isAdmin, isStaff, isGuardianOf } from './examsAcademicsScope'
import type { Actor } from '../router'

const CATEGORIES = ['Academic', 'Sports', 'Arts', 'Service', 'Other']

function serializeAchievement(a: Row) {
  return { id: a.id, userId: a.userId, title: a.title, detail: a.detail, date: a.date, category: a.category, verifiedById: a.verifiedById ?? undefined, verifiedAt: a.verifiedAt ?? undefined, fileIds: a.fileIds ?? [], createdAt: a.createdAt }
}

function canView(actor: Actor, userId: string): boolean {
  if (isStaff(actor.role)) return true
  if (actor.userId === userId) return true
  return isGuardianOf(actor, userId)
}

route('GET', '/achievements', (ctx) => {
  const actor = requireAuth(ctx)
  const { userId } = ctx.query
  if (userId) {
    if (!canView(actor, userId)) throw forbidden('You cannot view this user’s achievements')
    return { items: table('Achievement').filter(a => a.schoolId === actor.schoolId && a.userId === userId).sort((a, b) => String(b.date).localeCompare(String(a.date))).map(serializeAchievement) }
  }
  if (isStaff(actor.role)) return { items: table('Achievement').filter(a => a.schoolId === actor.schoolId).sort((a, b) => String(b.date).localeCompare(String(a.date))).map(serializeAchievement) }
  return { items: table('Achievement').filter(a => a.schoolId === actor.schoolId && a.userId === actor.userId).sort((a, b) => String(b.date).localeCompare(String(a.date))).map(serializeAchievement) }
})

route('POST', '/achievements', (ctx) => {
  const actor = requireAuth(ctx)
  const body = ctx.body as { userId?: string; title?: string; detail?: string; date?: string; category?: string; fileIds?: string[] }
  const userId = body.userId ?? actor.userId
  if (actor.role !== 'student' && actor.role !== 'teacher' && !isStaff(actor.role)) throw forbidden('Only a student or teacher may add an achievement')
  if (userId !== actor.userId && !isStaff(actor.role)) throw forbidden('You may only add an achievement for yourself')
  if (!body.title?.trim()) throw badRequest('title is required')
  if (!body.detail?.trim()) throw badRequest('detail is required')
  if (!body.date) throw badRequest('date is required')
  if (!CATEGORIES.includes(body.category ?? '')) throw badRequest(`category must be one of ${CATEGORIES.join(', ')}`)
  const row: Row = { id: uid('achievement'), schoolId: actor.schoolId, userId, title: body.title.trim(), detail: body.detail.trim(), date: body.date, category: body.category, verifiedById: null, verifiedAt: null, fileIds: body.fileIds ?? [], createdAt: nowIso() }
  const rows = table('Achievement'); rows.push(row); saveTable('Achievement', rows)
  return status(201, { item: serializeAchievement(row) })
})

function getOwnedOrAdmin(actor: Actor, id: string): Row {
  const row = table('Achievement').find(a => a.id === id && a.schoolId === actor.schoolId)
  if (!row) throw notFound('Achievement')
  if (row.userId !== actor.userId && !isAdmin(actor.role)) throw forbidden('Only the owner or admin may modify this achievement')
  return row
}

route('PATCH', '/achievements/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getOwnedOrAdmin(actor, ctx.params.id)
  const body = ctx.body as { title?: string; detail?: string; date?: string; category?: string; fileIds?: string[] }
  const rows = table('Achievement'); const idx = rows.findIndex(a => a.id === before.id)
  rows[idx] = { ...rows[idx], ...(body.title !== undefined ? { title: body.title } : {}), ...(body.detail !== undefined ? { detail: body.detail } : {}), ...(body.date !== undefined ? { date: body.date } : {}), ...(body.category !== undefined ? { category: body.category } : {}), ...(body.fileIds !== undefined ? { fileIds: body.fileIds } : {}) }
  saveTable('Achievement', rows)
  return { item: serializeAchievement(rows[idx]) }
})

route('DELETE', '/achievements/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getOwnedOrAdmin(actor, ctx.params.id)
  const rows = table('Achievement'); const idx = rows.findIndex(a => a.id === before.id)
  rows.splice(idx, 1)
  saveTable('Achievement', rows)
  return { ok: true }
})

route('POST', '/achievements/:id/verify', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only staff/admin may verify an achievement')
  const before = table('Achievement').find(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (!before) throw notFound('Achievement')
  const rows = table('Achievement'); const idx = rows.findIndex(a => a.id === before.id)
  rows[idx] = { ...rows[idx], verifiedById: actor.userId, verifiedAt: nowIso() }
  saveTable('Achievement', rows)
  return { item: serializeAchievement(rows[idx]) }
})
