// Mirrors server/src/modules/notifications/router.ts (phase-7-communication.md). Plain per-user CRUD-ish
// list + read/read-all — no separate service.ts on the real side either. Other modules (messages,
// canteen) push Notification rows directly via `table('Notification')`; this file only serves them.

import { route, requireAuth } from '../router'
import { notFound } from '../http'
import { table, saveTable, nowIso, type Row } from '../store'

function serializeNotification(n: Row) {
  return { id: n.id, userId: n.userId, kind: n.kind, title: n.title, body: n.body ?? undefined, link: n.link ?? undefined, readAt: n.readAt ?? undefined, createdAt: n.createdAt }
}

route('GET', '/notifications', (ctx) => {
  const actor = requireAuth(ctx)
  const { unread } = ctx.query
  let rows = table('Notification').filter(n => n.schoolId === actor.schoolId && n.userId === actor.userId)
  if (unread === '1' || unread === 'true') rows = rows.filter(n => !n.readAt)
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 200)
  return { items: rows.map(serializeNotification) }
})

route('POST', '/notifications/:id/read', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('Notification')
  const idx = rows.findIndex(n => n.id === ctx.params.id && n.schoolId === actor.schoolId && n.userId === actor.userId)
  if (idx === -1) throw notFound('Notification')
  rows[idx] = { ...rows[idx], readAt: rows[idx].readAt ?? nowIso() }
  saveTable('Notification', rows)
  return { item: serializeNotification(rows[idx]) }
})

route('POST', '/notifications/read-all', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('Notification')
  const now = nowIso()
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].schoolId === actor.schoolId && rows[i].userId === actor.userId && !rows[i].readAt) rows[i] = { ...rows[i], readAt: now }
  }
  saveTable('Notification', rows)
  return { ok: true }
})
