import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap, notFound } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import { serializeNotification } from '../../lib/notify'
import { paginationQuery, paginate } from '../../lib/pagination'

// /api/notifications — see phase-7-communication.md.
export const notificationsRouter = Router()
notificationsRouter.use(requireAuth)

// `defaultLimit: 200` matches the old fixed `take: 200` exactly, so a caller that passes neither `limit`
// nor `cursor` sees identical results to before pagination existed.
const listQuery = paginationQuery.extend({ unread: z.coerce.boolean().optional() })

notificationsRouter.get('/', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const q = validate(listQuery, req.query)
  const where = { schoolId: ctx.schoolId, userId: ctx.actorId, ...(q.unread ? { readAt: null } : {}) }
  const { items, nextCursor } = await paginate(
    args => prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...args }),
    { limit: q.limit, cursor: q.cursor, defaultLimit: 200, maxLimit: 200 },
  )
  res.json({ items: items.map(serializeNotification), nextCursor })
}))

notificationsRouter.post('/:id/read', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const row = await prisma.notification.findFirst({ where: { id: req.params.id, schoolId: ctx.schoolId, userId: ctx.actorId } })
  if (!row) throw notFound('Notification')
  const updated = await prisma.notification.update({ where: { id: row.id }, data: { readAt: row.readAt ?? new Date() } })
  res.json({ item: serializeNotification(updated) })
}))

notificationsRouter.post('/read-all', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  await prisma.notification.updateMany({ where: { schoolId: ctx.schoolId, userId: ctx.actorId, readAt: null }, data: { readAt: new Date() } })
  res.json({ ok: true })
}))
