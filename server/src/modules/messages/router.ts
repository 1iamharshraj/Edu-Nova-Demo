import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { createConversation, messagesQuery, createMessage } from './schema'

// /api/messages — see phase-7-communication.md.
export const messagesRouter = Router()
messagesRouter.use(requireAuth)

messagesRouter.get('/contacts', wrap(async (req, res) => {
  res.json({ items: await svc.listContacts(ctxOf(req as AuthedRequest)) })
}))
messagesRouter.get('/conversations', wrap(async (req, res) => {
  res.json({ items: await svc.listConversations(ctxOf(req as AuthedRequest)) })
}))
messagesRouter.post('/conversations', wrap(async (req, res) => {
  const conv = await svc.createConversationSvc(ctxOf(req as AuthedRequest), validate(createConversation, req.body))
  res.status(201).json({ item: { id: conv.id, kind: conv.kind, title: conv.title ?? undefined, classId: conv.classId ?? undefined, participants: conv.participants.map(p => ({ userId: p.userId, name: p.user.name, role: p.user.role })), createdAt: conv.createdAt.toISOString() } })
}))
messagesRouter.get('/conversations/:id/messages', wrap(async (req, res) => {
  res.json(await svc.listMessages(ctxOf(req as AuthedRequest), req.params.id, validate(messagesQuery, req.query)))
}))
messagesRouter.post('/conversations/:id/messages', wrap(async (req, res) => {
  res.status(201).json({ item: await svc.sendMessage(ctxOf(req as AuthedRequest), req.params.id, validate(createMessage, req.body)) })
}))
messagesRouter.post('/conversations/:id/read', wrap(async (req, res) => {
  res.json(await svc.markRead(ctxOf(req as AuthedRequest), req.params.id))
}))
