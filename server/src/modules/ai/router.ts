import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeMessage, serializeWorksheet } from './service'
import { askBody, generateWorksheetBody, saveWorksheetBody, worksheetsQuery, draftRemarkBody, translateBody } from './schema'

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

// ═══════════════════════════ item 2 — worksheets ═══════════════════════════

aiRouter.post('/generate-worksheet', wrap(async (req, res) => {
  const result = await svc.generateWorksheet(ctxOf(req as AuthedRequest), validate(generateWorksheetBody, req.body))
  if (!result.configured) {
    return res.status(503).json({
      error: 'AI worksheet generation not configured',
      detail: 'Set ANTHROPIC_API_KEY on the server to enable AI worksheet generation.',
      classSubjectId: result.classSubjectId,
      chapterIds: result.chapterIds,
    })
  }
  res.json({ classSubjectId: result.classSubjectId, chapterIds: result.chapterIds, title: result.title, content: result.content })
}))

aiRouter.post('/worksheets', wrap(async (req, res) => {
  const row = await svc.saveWorksheet(ctxOf(req as AuthedRequest), validate(saveWorksheetBody, req.body))
  res.status(201).json({ item: serializeWorksheet(row) })
}))

aiRouter.get('/worksheets', wrap(async (req, res) => {
  const q = validate(worksheetsQuery, req.query)
  res.json({ items: await svc.listWorksheets(ctxOf(req as AuthedRequest), q.classSubjectId) })
}))

aiRouter.get('/worksheets/:id', wrap(async (req, res) => {
  res.json({ item: serializeWorksheet(await svc.getWorksheet(ctxOf(req as AuthedRequest), req.params.id)) })
}))

// ═══════════════════════════ item 3 — draft report-card remark ═══════════════════════════

aiRouter.post('/draft-remark', wrap(async (req, res) => {
  const result = await svc.draftRemark(ctxOf(req as AuthedRequest), validate(draftRemarkBody, req.body))
  if (!result.configured) {
    return res.status(503).json({
      error: 'AI remark drafting not configured',
      detail: 'Set ANTHROPIC_API_KEY on the server to enable AI remark drafting.',
      studentId: result.studentId,
      termId: result.termId,
    })
  }
  res.json({ studentId: result.studentId, termId: result.termId, draft: result.draft })
}))

// ═══════════════════════════ item 4 — translate ═══════════════════════════

aiRouter.post('/translate', wrap(async (req, res) => {
  const result = await svc.translate(ctxOf(req as AuthedRequest), validate(translateBody, req.body))
  if (!result.configured) {
    return res.status(503).json({
      error: 'AI translation not configured',
      detail: 'Set ANTHROPIC_API_KEY on the server to enable AI translation.',
      targetLanguage: result.targetLanguage,
    })
  }
  res.json({ targetLanguage: result.targetLanguage, translatedText: result.translatedText })
}))
