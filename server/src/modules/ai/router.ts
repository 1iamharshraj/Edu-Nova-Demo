import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeMessage } from './service'
import { askBody } from './schema'

// /api/ai — see phase-9-10-integrations-hardening.md → item 1 (AI Doubt Clearing). Student-only.
export const aiRouter = Router()
aiRouter.use(requireAuth)

aiRouter.post('/ask', wrap(async (req, res) => {
  const result = await svc.ask(ctxOf(req as AuthedRequest), validate(askBody, req.body))
  if (!result.configured) {
    return res.status(503).json({
      error: 'AI tutor not configured',
      detail: 'Set ANTHROPIC_API_KEY on the server to enable the AI doubt-clearing tutor.',
      conversationId: result.conversation.id,
      userMessage: serializeMessage(result.userMessage),
    })
  }
  res.status(201).json({
    conversationId: result.conversation.id,
    userMessage: serializeMessage(result.userMessage),
    assistantMessage: serializeMessage(result.assistantMessage!),
  })
}))

aiRouter.get('/conversations', wrap(async (req, res) => {
  res.json({ items: await svc.listConversations(ctxOf(req as AuthedRequest)) })
}))
