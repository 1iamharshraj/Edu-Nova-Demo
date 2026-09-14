// Mirrors server/src/modules/verification's contract: parent identity verification, decided by
// staff/admin. `User.verified` follows the verification record's status, kept in sync here the same
// way the real service.ts's syncUserVerified() does.

import { route, requireAuth, requireRole, status, type Actor } from '../router'
import { badRequest, conflict, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']
const VERIFICATION_METHODS = ['Document', 'InPerson', 'Aadhaar']

function serializeVerification(v: Row) {
  return {
    id: v.id, parentId: v.parentId, method: v.method, status: v.status, documentFileId: v.documentFileId ?? undefined,
    verifiedById: v.verifiedById ?? undefined, verifiedAt: v.verifiedAt ?? undefined, note: v.note ?? undefined,
    createdAt: v.createdAt, updatedAt: v.updatedAt,
  }
}

function syncUserVerified(parentId: string, verified: boolean) {
  const users = table('User')
  const idx = users.findIndex(u => u.id === parentId)
  if (idx === -1) return
  users[idx] = { ...users[idx], verified }
  saveTable('User', users)
}

route('GET', '/verification/me', (ctx) => {
  const actor = requireAuth(ctx)
  if (actor.role !== 'parent') throw forbidden('Only parents have a verification record')
  const row = table('ParentVerification').find(v => v.parentId === actor.userId && v.schoolId === actor.schoolId)
  return { item: row ? serializeVerification(row) : null }
})

route('POST', '/verification/me', (ctx) => {
  const actor = requireAuth(ctx)
  if (actor.role !== 'parent') throw forbidden('Only parents can request verification')
  const { method, documentFileId } = ctx.body as { method?: string; documentFileId?: string }
  if (!method || !VERIFICATION_METHODS.includes(method)) throw badRequest('method must be one of Document, InPerson, Aadhaar')
  if (method === 'Document' && !documentFileId) throw badRequest('documentFileId is required for Document verification')
  const rows = table('ParentVerification')
  const idx = rows.findIndex(v => v.parentId === actor.userId && v.schoolId === actor.schoolId)
  if (idx !== -1 && rows[idx].status === 'Verified') throw conflict('You are already verified')
  const now = nowIso()
  const row: Row = idx === -1
    ? { id: uid('parentverification'), schoolId: actor.schoolId, parentId: actor.userId, method, documentFileId: documentFileId ?? null, status: 'Pending', note: null, verifiedById: null, verifiedAt: null, createdAt: now, updatedAt: now }
    : { ...rows[idx], method, documentFileId: documentFileId ?? null, status: 'Pending', note: null, verifiedById: null, verifiedAt: null, updatedAt: now }
  if (idx === -1) rows.push(row)
  else rows[idx] = row
  saveTable('ParentVerification', rows)
  syncUserVerified(actor.userId, false)
  return status(201, { item: serializeVerification(row) })
})

route('GET', '/verification', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { status: st } = ctx.query
  let rows = table('ParentVerification').filter(v => v.schoolId === actor.schoolId)
  if (st) rows = rows.filter(v => v.status === st)
  rows = [...rows].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  return { items: rows.map(serializeVerification) }
})

function decide(actor: Actor, id: string, newStatus: 'Verified' | 'Rejected', note?: string) {
  const rows = table('ParentVerification')
  const idx = rows.findIndex(v => v.id === id && v.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Verification')
  const before = rows[idx]
  const now = nowIso()
  rows[idx] = { ...before, status: newStatus, note: note ?? (newStatus === 'Verified' ? null : before.note), verifiedById: actor.userId, verifiedAt: now, updatedAt: now }
  saveTable('ParentVerification', rows)
  syncUserVerified(before.parentId as string, newStatus === 'Verified')
  return rows[idx]
}

route('POST', '/verification/:id/verify', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  return { item: serializeVerification(decide(actor, ctx.params.id, 'Verified')) }
})

route('POST', '/verification/:id/reject', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { note } = ctx.body as { note?: string }
  return { item: serializeVerification(decide(actor, ctx.params.id, 'Rejected', note)) }
})
