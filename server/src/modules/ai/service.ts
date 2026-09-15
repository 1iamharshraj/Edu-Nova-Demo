import type { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import type { AiConversation, AiMessage, GeneratedWorksheet } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { activeClassOf, assertWriteClassSubject, getClassSubject, getTerm, isClassTeacherOfStudent, isStaff } from '../../lib/scope'
import * as reports from '../assessments/reports'
import { summary as attendanceSummary } from '../attendance/service'
import type { askBody, generateWorksheetBody, saveWorksheetBody, draftRemarkBody, translateBody } from './schema'

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

// Phase 20 — AI-powered teaching & communication (see phase-20-ai-teaching-communication.md). Items 2-4
// (worksheet generation, remark drafting, translation) are one-shot Claude calls with no dedicated table of
// their own to count against (AiMessage is tutor-conversation-only, tied to a student), so they're
// rate-limited the same way — a plain per-actor-per-day count, just counted off `AuditLog` (every
// generation action is already audited per the ground rules) instead of `AiMessage`.
const MAX_GENERATIONS_PER_DAY = 20
const MAX_TRANSLATIONS_PER_DAY = 50

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

// Shared per-actor-per-day counter for the Phase 20 generation endpoints (items 2-4) — see the
// MAX_GENERATIONS_PER_DAY / MAX_TRANSLATIONS_PER_DAY comment above. Counts this actor's `AuditLog` rows
// for `action` created since UTC midnight; every generation call that reaches Claude successfully audits
// itself under that same action name, so this stays accurate without a dedicated counter table.
async function actionsToday(actorId: string, action: string) {
  return prisma.auditLog.count({ where: { actorId, action, at: { gte: startOfTodayUtc() } } })
}

// Phase 20 item 1 — chapters covered / not-yet-covered for one ClassSubject, sourced from Phase 18's
// ChapterProgress (see modules/syllabus/service.ts#getProgress, whose curriculum-subject lookup this
// mirrors exactly: boardId/gradeId/streamId/subjectId match, no OR-on-null-stream widening).
async function syllabusStatusFor(ctx: Ctx, boardId: string, gradeId: string, streamId: string | null, classSubject: { id: string; subjectId: string }, subjectName: string) {
  const curriculumSubject = await prisma.curriculumSubject.findFirst({
    where: { schoolId: ctx.schoolId, boardId, gradeId, streamId, subjectId: classSubject.subjectId },
  })
  if (!curriculumSubject) return null
  const [chapters, progress] = await Promise.all([
    prisma.syllabusChapter.findMany({ where: { curriculumSubjectId: curriculumSubject.id }, orderBy: { order: 'asc' } }),
    prisma.chapterProgress.findMany({ where: { classSubjectId: classSubject.id } }),
  ])
  if (!chapters.length) return null
  const byChapter = new Map(progress.map(p => [p.chapterId, p]))
  const covered = chapters.filter(ch => byChapter.get(ch.id)?.status === 'Done').map(ch => ch.title)
  const notCovered = chapters.filter(ch => byChapter.get(ch.id)?.status !== 'Done').map(ch => ch.title)
  return { subject: subjectName, covered, notCovered }
}

// Builds a system prompt scoped to the student's board/grade/subjects via their active enrollment —
// reuses lib/scope.ts#activeClassOf rather than re-querying enrollment/class directly.
async function buildSystemPrompt(ctx: Ctx, subjectId?: string) {
  const enrollment = await activeClassOf(ctx.actorId)
  if (!enrollment) {
    return 'You are Edkonic\'s AI study tutor. Help the student with their doubt clearly and simply. Keep answers focused and age-appropriate.'
  }
  const cls = enrollment.class
  const [board, grade, curriculum, subject, classSubjects] = await Promise.all([
    prisma.board.findUnique({ where: { id: cls.boardId } }),
    prisma.grade.findUnique({ where: { id: cls.gradeId } }),
    prisma.curriculumSubject.findMany({
      where: { boardId: cls.boardId, gradeId: cls.gradeId, ...(cls.streamId ? { OR: [{ streamId: cls.streamId }, { streamId: null }] } : {}) },
      include: { subject: true },
    }),
    subjectId ? prisma.subject.findFirst({ where: { id: subjectId, schoolId: ctx.schoolId } }) : Promise.resolve(null),
    // Only this subject's ClassSubject when the question is subject-scoped; otherwise every subject taught
    // in the student's class, so a subject-less question still gets a full syllabus picture.
    prisma.classSubject.findMany({
      where: { classId: cls.id, ...(subjectId ? { subjectId } : {}) },
      include: { subject: true },
    }),
  ])
  const subjectNames = [...new Set(curriculum.map(c => c.subject.name))]

  // Phase 18 ChapterProgress, one entry per subject that has a synced curriculum + chapters.
  const syllabusStatuses = (await Promise.all(
    classSubjects.map(cs => syllabusStatusFor(ctx, cls.boardId, cls.gradeId, cls.streamId, cs, cs.subject.name)),
  )).filter((s): s is NonNullable<typeof s> => s != null)
  const syllabusLines = syllabusStatuses.map(s =>
    `${s.subject} — chapters covered so far: ${s.covered.length ? s.covered.join(', ') : '(none yet)'}; chapters not yet covered: ${s.notCovered.length ? s.notCovered.join(', ') : '(none — fully covered)'}.`)

  const lines = [
    'You are Edkonic\'s AI study tutor, helping a school student clear an academic doubt.',
    board && grade ? `The student is in ${board.name} board, grade ${grade.label}.` : undefined,
    subjectNames.length ? `Their curriculum subjects this year are: ${subjectNames.join(', ')}.` : undefined,
    subject ? `This question is specifically about ${subject.name} — focus your answer on that subject.` : undefined,
    ...(syllabusLines.length ? ['Syllabus progress tracked by their teacher(s):', ...syllabusLines] : []),
    'Explain concepts clearly and simply, at a level appropriate for this grade. Use short paragraphs or steps. ' +
      'If the question is off-syllabus or unrelated to school subjects, gently redirect the student back to their studies. ' +
      'Never do the student\'s homework/assignment verbatim — teach the concept and method instead.',
    syllabusLines.length
      ? 'If the question is clearly about material listed above as "not yet covered", don\'t just answer it as if it were fair game — gently note that this hasn\'t been taught in class yet, ' +
        'offer a brief, high-level orientation at most, and encourage the student to focus on what has already been covered (or to ask their teacher once that chapter begins).'
      : undefined,
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

// ═══════════════════════════ item 2 — AI-generated worksheets ═══════════════════════════
// See phase-20-ai-teaching-communication.md → item 2. Generation is a pure Claude call returning a draft
// that is NOT persisted; only an explicit, separate POST /ai/worksheets save (after the teacher reviews it)
// creates a `GeneratedWorksheet` row — mirrors the ask()/AiMessage split (question always saved, answer only
// on success) but here nothing is saved until the human explicitly approves, per the hard "AI-generated
// content must be human-reviewed before anything is saved" rule in the phase ground rules.

export const serializeWorksheet = (w: GeneratedWorksheet) => ({
  id: w.id,
  classSubjectId: w.classSubjectId,
  chapterIds: w.chapterIds,
  title: w.title,
  content: w.content,
  pdfFileId: w.pdfFileId ?? undefined,
  createdById: w.createdById,
  createdAt: w.createdAt.toISOString(),
})

async function assertCanGenerateForClassSubject(ctx: Ctx, classSubjectId: string) {
  if (ctx.role === 'student' || ctx.role === 'parent') throw new HttpError(403, 'Only a teacher, staff, or admin may generate teaching material')
  await assertWriteClassSubject(ctx, classSubjectId)
}

async function chaptersFor(ctx: Ctx, classSubjectId: string, chapterIds: string[]) {
  const cs = await getClassSubject(ctx, classSubjectId)
  const curriculumSubject = await prisma.curriculumSubject.findFirst({
    where: { schoolId: ctx.schoolId, boardId: cs.class.boardId, gradeId: cs.class.gradeId, streamId: cs.class.streamId, subjectId: cs.subjectId },
  })
  if (!curriculumSubject) throw new HttpError(400, 'No syllabus is set up for this class subject yet')
  const chapters = await prisma.syllabusChapter.findMany({
    where: { id: { in: chapterIds }, curriculumSubjectId: curriculumSubject.id },
    orderBy: { order: 'asc' },
  })
  if (chapters.length !== chapterIds.length) throw new HttpError(400, 'One or more chapterIds do not belong to this class subject\'s syllabus')
  return { cs, chapters }
}

export interface GenerateWorksheetResult {
  configured: boolean
  classSubjectId: string
  chapterIds: string[]
  title?: string
  content?: string
}

export async function generateWorksheet(ctx: Ctx, input: z.infer<typeof generateWorksheetBody>): Promise<GenerateWorksheetResult> {
  await assertCanGenerateForClassSubject(ctx, input.classSubjectId)
  const { cs, chapters } = await chaptersFor(ctx, input.classSubjectId, input.chapterIds)

  const generatedToday = await actionsToday(ctx.actorId, 'generate-worksheet')
  if (generatedToday >= MAX_GENERATIONS_PER_DAY) {
    throw new HttpError(429, `You've reached today's limit of ${MAX_GENERATIONS_PER_DAY} AI worksheet generations. Try again tomorrow.`)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { configured: false, classSubjectId: input.classSubjectId, chapterIds: input.chapterIds }
  }

  const questionCount = input.questionCount ?? 10
  const difficulty = input.difficulty ?? 'medium'
  const chapterList = chapters.map(c => `- ${c.title}`).join('\n')
  const system = 'You are Edkonic\'s AI teaching assistant, drafting a worksheet/question paper for a teacher to review, edit, and approve before use. ' +
    'Never present the draft as final — it is a starting point for the teacher.'
  const prompt = [
    `Draft a worksheet for ${cs.subject.name}, grade ${cs.class.grade.label}, covering exactly these chapters:`,
    chapterList,
    `Include about ${questionCount} questions overall, at ${difficulty} difficulty for this grade.`,
    'Structure your response as plain text/markdown with: a short title line, a one-line instructions line for students, ' +
      'then numbered questions (mix of question types is fine — short answer, MCQ, etc., as appropriate for the subject), ' +
      'and finally an "Answer Key" section with brief answers.',
    'Do not include any preamble or commentary outside the worksheet itself.',
  ].join('\n')

  const client = new Anthropic({ apiKey })
  let content: string
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    content = textBlock?.text ?? '(The AI did not return worksheet content.)'
  } catch (err) {
    console.error('[ai] Claude worksheet generation failed:', err)
    throw new HttpError(502, 'AI worksheet generation is temporarily unavailable. Please try again shortly.')
  }

  const title = `${cs.subject.name} Worksheet — ${chapters.map(c => c.title).join(', ')}`
  await audit(ctx.schoolId, ctx.actorId, 'generate-worksheet', 'generatedWorksheet', input.classSubjectId, undefined, { classSubjectId: input.classSubjectId, chapterIds: input.chapterIds, difficulty, questionCount })
  return { configured: true, classSubjectId: input.classSubjectId, chapterIds: input.chapterIds, title, content }
}

export async function saveWorksheet(ctx: Ctx, input: z.infer<typeof saveWorksheetBody>) {
  await assertCanGenerateForClassSubject(ctx, input.classSubjectId)
  // Validates the chapters belong to this class subject's syllabus (same as generation) — a saved
  // worksheet's chapterIds should stay just as trustworthy as the generation-time draft's.
  await chaptersFor(ctx, input.classSubjectId, input.chapterIds)

  const row = await prisma.generatedWorksheet.create({
    data: {
      schoolId: ctx.schoolId,
      classSubjectId: input.classSubjectId,
      chapterIds: input.chapterIds,
      title: input.title,
      content: input.content,
      createdById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'generatedWorksheet', row.id, undefined, serializeWorksheet(row))
  return row
}

export async function listWorksheets(ctx: Ctx, classSubjectId?: string) {
  if (ctx.role === 'student' || ctx.role === 'parent') throw new HttpError(403, 'Only a teacher, staff, or admin may view generated worksheets')
  const rows = await prisma.generatedWorksheet.findMany({
    where: { schoolId: ctx.schoolId, classSubjectId },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(serializeWorksheet)
}

export async function getWorksheet(ctx: Ctx, id: string) {
  const row = await prisma.generatedWorksheet.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Generated worksheet')
  return row
}

// ═══════════════════════════ item 3 — AI-drafted report-card remarks ═══════════════════════════
// See phase-20-ai-teaching-communication.md → item 3. `studentId`/`termId` (not a classSubjectId), so scope
// mirrors the established per-student check used elsewhere for this exact "class teacher of this student, or
// staff/admin" rule (see lib/scope.ts#isClassTeacherOfStudent, used the same way in modules/health and
// modules/reports) rather than assertWriteClassSubject, which is keyed to a class-subject, not a student.
// Returns draft text only — never saved by this endpoint. The real, teacher-editable field lives on
// `Enrollment.remarks` (see schema.prisma) and is written separately via
// PUT /api/assessments/report-card/remark (modules/assessments/service.ts#setReportCardRemark) — the
// teacher pastes/edits the AI draft there themselves.

async function assertCanDraftRemark(ctx: Ctx, studentId: string) {
  if (isStaff(ctx)) return
  if (await isClassTeacherOfStudent(ctx, studentId)) return
  throw new HttpError(403, 'Only the class teacher, staff, or admin may draft a remark for this student')
}

export interface DraftRemarkResult {
  configured: boolean
  studentId: string
  termId: string
  draft?: string
}

export async function draftRemark(ctx: Ctx, input: z.infer<typeof draftRemarkBody>): Promise<DraftRemarkResult> {
  await assertCanDraftRemark(ctx, input.studentId)
  const term = await getTerm(ctx, input.termId)

  const generatedToday = await actionsToday(ctx.actorId, 'draft-remark')
  if (generatedToday >= MAX_GENERATIONS_PER_DAY) {
    throw new HttpError(429, `You've reached today's limit of ${MAX_GENERATIONS_PER_DAY} AI remark drafts. Try again tomorrow.`)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { configured: false, studentId: input.studentId, termId: input.termId }
  }

  const [card, attendance, achievements] = await Promise.all([
    reports.reportCard(ctx, input.studentId, input.termId),
    attendanceSummary(ctx, { studentId: input.studentId, termId: term.id }).catch(() => undefined),
    prisma.achievement.findMany({
      where: { schoolId: ctx.schoolId, userId: input.studentId, date: { gte: term.startDate, lte: term.endDate } },
      orderBy: { date: 'desc' },
    }),
  ])

  const subjectLines = card.subjects.map(s => `${s.subject}: ${s.pct}%${s.grade ? ` (grade ${s.grade})` : ''}`)
  const facts = [
    `Student: ${card.name}, term: ${term.name}.`,
    card.overall.pct ? `Overall: ${card.overall.pct}%${card.overall.grade ? ` (grade ${card.overall.grade})` : ''}${card.overall.rank ? `, rank ${card.overall.rank} of ${card.overall.classSize}` : ''}.` : 'No published assessments yet this term.',
    subjectLines.length ? `Per-subject performance: ${subjectLines.join('; ')}.` : undefined,
    attendance ? `Attendance this term: ${attendance.overall.pct}% (${attendance.overall.present}/${attendance.overall.total} days).` : undefined,
    achievements.length ? `Achievements this term: ${achievements.map(a => a.title).join(', ')}.` : undefined,
  ].filter(Boolean).join('\n')

  const system = 'You are Edkonic\'s AI teaching assistant, drafting a report-card remark for a teacher to review, edit, and approve before saving or sharing with a parent. ' +
    'Never present the draft as final.'
  const prompt = `Based on the following real data for this student this term, draft a personalized, encouraging, constructive report-card remark of 2-3 sentences. ` +
    `Be specific (reference actual subjects/performance where useful) but keep it warm and age-appropriate, and balance praise with one constructive note if performance warrants it. ` +
    `Do not invent facts not given below.\n\n${facts}`

  const client = new Anthropic({ apiKey })
  let draft: string
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    draft = textBlock?.text ?? '(The AI did not return a remark.)'
  } catch (err) {
    console.error('[ai] Claude remark drafting failed:', err)
    throw new HttpError(502, 'AI remark drafting is temporarily unavailable. Please try again shortly.')
  }

  await audit(ctx.schoolId, ctx.actorId, 'draft-remark', 'generatedRemark', input.studentId, undefined, { studentId: input.studentId, termId: input.termId })
  return { configured: true, studentId: input.studentId, termId: input.termId, draft }
}

// ═══════════════════════════ item 4 — AI-translated parent communications ═══════════════════════════

export interface TranslateResult {
  configured: boolean
  targetLanguage: string
  translatedText?: string
}

export async function translate(ctx: Ctx, input: z.infer<typeof translateBody>): Promise<TranslateResult> {
  const translatedToday = await actionsToday(ctx.actorId, 'translate')
  if (translatedToday >= MAX_TRANSLATIONS_PER_DAY) {
    throw new HttpError(429, `You've reached today's limit of ${MAX_TRANSLATIONS_PER_DAY} AI translations. Try again tomorrow.`)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { configured: false, targetLanguage: input.targetLanguage }
  }

  const system = 'You are a precise translator for a school communication platform. Translate the given text faithfully, preserving tone, ' +
    'and keep any specific numbers, dates, and names exactly as given. Return only the translated text, with no preamble, explanation, or quotation marks around it.'
  const client = new Anthropic({ apiKey })
  let translatedText: string
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: `Translate the following text to ${input.targetLanguage}:\n\n${input.text}` }],
    })
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    translatedText = textBlock?.text ?? '(The AI did not return a translation.)'
  } catch (err) {
    console.error('[ai] Claude translation failed:', err)
    throw new HttpError(502, 'AI translation is temporarily unavailable. Please try again shortly.')
  }

  await audit(ctx.schoolId, ctx.actorId, 'translate', 'aiTranslation', ctx.actorId, undefined, { targetLanguage: input.targetLanguage })
  return { configured: true, targetLanguage: input.targetLanguage, translatedText }
}
