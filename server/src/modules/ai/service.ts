import type { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import type { AiConversation, AiMessage } from '@prisma/client'
import { prisma } from '../../prisma'
import { HttpError } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { activeClassOf } from '../../lib/scope'
import type { askBody } from './schema'

// See phase-9-10-integrations-hardening.md → item 1 (AI Doubt Clearing).
//
// One AiConversation per (student, subjectId) pair — a new question for the same subject continues the
// same thread (up to CONTEXT_MESSAGES of prior turns sent back as context); a different subjectId (or no
// subjectId) starts a fresh thread. Only students may ask; rate-limited to MAX_QUESTIONS_PER_DAY user
// messages/day/student, counted by a plain `AiMessage` count query scoped to today (UTC) — simplest
// correct implementation for this volume; a dedicated counter table would only pay off at a scale this
// school-management app does not operate at.
const MODEL = 'claude-sonnet-5'
const MAX_QUESTIONS_PER_DAY = 30
const CONTEXT_MESSAGES = 10

export const serializeMessage = (m: AiMessage) => ({
  id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString(),
})

export const serializeConversation = (c: AiConversation & { messages?: AiMessage[] }) => ({
  id: c.id, subjectId: c.subjectId ?? undefined, title: c.title ?? undefined, createdAt: c.createdAt.toISOString(),
  ...(c.messages ? { messages: c.messages.map(serializeMessage) } : {}),
})

function startOfTodayUtc() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

async function questionsAskedToday(studentId: string) {
  return prisma.aiMessage.count({
    where: { role: 'user', createdAt: { gte: startOfTodayUtc() }, conversation: { studentId } },
  })
}

// Builds a system prompt scoped to the student's board/grade/subjects via their active enrollment —
// reuses lib/scope.ts#activeClassOf rather than re-querying enrollment/class directly.
async function buildSystemPrompt(ctx: Ctx, subjectId?: string) {
  const enrollment = await activeClassOf(ctx.actorId)
  if (!enrollment) {
    return 'You are EduNova\'s AI study tutor. Help the student with their doubt clearly and simply. Keep answers focused and age-appropriate.'
  }
  const cls = enrollment.class
  const [board, grade, curriculum, subject] = await Promise.all([
    prisma.board.findUnique({ where: { id: cls.boardId } }),
    prisma.grade.findUnique({ where: { id: cls.gradeId } }),
    prisma.curriculumSubject.findMany({
      where: { boardId: cls.boardId, gradeId: cls.gradeId, ...(cls.streamId ? { OR: [{ streamId: cls.streamId }, { streamId: null }] } : {}) },
      include: { subject: true },
    }),
    subjectId ? prisma.subject.findFirst({ where: { id: subjectId, schoolId: ctx.schoolId } }) : Promise.resolve(null),
  ])
  const subjectNames = [...new Set(curriculum.map(c => c.subject.name))]
  const lines = [
    'You are EduNova\'s AI study tutor, helping a school student clear an academic doubt.',
    board && grade ? `The student is in ${board.name} board, grade ${grade.label}.` : undefined,
    subjectNames.length ? `Their curriculum subjects this year are: ${subjectNames.join(', ')}.` : undefined,
    subject ? `This question is specifically about ${subject.name} — focus your answer on that subject.` : undefined,
    'Explain concepts clearly and simply, at a level appropriate for this grade. Use short paragraphs or steps. ' +
      'If the question is off-syllabus or unrelated to school subjects, gently redirect the student back to their studies. ' +
      'Never do the student\'s homework/assignment verbatim — teach the concept and method instead.',
  ].filter(Boolean)
  return lines.join('\n')
}

async function findOrCreateConversation(ctx: Ctx, subjectId?: string) {
  const existing = await prisma.aiConversation.findFirst({
    where: { schoolId: ctx.schoolId, studentId: ctx.actorId, subjectId: subjectId ?? null },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) return existing
  return prisma.aiConversation.create({
    data: { schoolId: ctx.schoolId, studentId: ctx.actorId, subjectId: subjectId ?? null },
  })
}

export interface AskResult {
  conversation: AiConversation
  userMessage: AiMessage
  assistantMessage?: AiMessage
  configured: boolean
}

export async function ask(ctx: Ctx, input: z.infer<typeof askBody>): Promise<AskResult> {
  if (ctx.role !== 'student') throw new HttpError(403, 'Only students may ask the AI tutor')

  if (input.subjectId) {
    const subject = await prisma.subject.findFirst({ where: { id: input.subjectId, schoolId: ctx.schoolId } })
    if (!subject) throw new HttpError(400, 'Unknown subjectId')
  }

  const askedToday = await questionsAskedToday(ctx.actorId)
  if (askedToday >= MAX_QUESTIONS_PER_DAY) {
    throw new HttpError(429, `You've reached today's limit of ${MAX_QUESTIONS_PER_DAY} questions to the AI tutor. Try again tomorrow.`)
  }

  const conversation = await findOrCreateConversation(ctx, input.subjectId)
  const userMessage = await prisma.aiMessage.create({
    data: { conversationId: conversation.id, role: 'user', content: input.question },
  })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // No regex/keyword fallback "fake AI" — a clear structured "not configured" response instead.
    return { conversation, userMessage, configured: false }
  }

  const [systemPrompt, history] = await Promise.all([
    buildSystemPrompt(ctx, input.subjectId ?? undefined),
    prisma.aiMessage.findMany({
      where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: CONTEXT_MESSAGES,
    }),
  ])
  const priorTurns = history.reverse().filter(m => m.id !== userMessage.id)

  const client = new Anthropic({ apiKey })
  let answer: string
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        ...priorTurns.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: input.question },
      ],
    })
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    answer = textBlock?.text ?? '(The AI tutor did not return a text answer.)'
  } catch (err) {
    console.error('[ai] Claude API call failed:', err)
    throw new HttpError(502, 'The AI tutor is temporarily unavailable. Please try again shortly.')
  }

  const assistantMessage = await prisma.aiMessage.create({
    data: { conversationId: conversation.id, role: 'assistant', content: answer },
  })
  return { conversation, userMessage, assistantMessage, configured: true }
}

export async function listConversations(ctx: Ctx) {
  if (ctx.role !== 'student') throw new HttpError(403, 'Only students have an AI tutor history')
  const rows = await prisma.aiConversation.findMany({
    where: { schoolId: ctx.schoolId, studentId: ctx.actorId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(serializeConversation)
}
