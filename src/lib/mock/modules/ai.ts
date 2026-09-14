// Mirrors server/src/modules/ai/{router,service}.ts (phase-9-10-integrations-hardening.md item 1,
// phase-20-ai-teaching-communication.md items 2-4). The real backend calls the Claude API; per the
// static-demo plan, every "AI" response here is SIMULATED — a plausible canned response with a little
// randomized variation, never a real model call, and (unlike the real backend) never a 503 "not
// configured" — a static demo should always look like the feature works. Rate limiting (429s) is
// likewise not reproduced; this is a demo, not a cost-control surface.

import { route, requireAuth, status } from '../router'
import { notFound, forbidden, badRequest } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

function pick<T>(items: T[]): T { return items[Math.floor(Math.random() * items.length)] }

function serializeAiMessage(m: Row) {
  return { id: m.id, role: m.role, content: m.content, createdAt: m.createdAt }
}
function serializeAiConversation(c: Row, withMessages: boolean) {
  const base = { id: c.id, subjectId: c.subjectId ?? undefined, title: c.title ?? undefined, createdAt: c.createdAt }
  if (!withMessages) return base
  const messages = [...table('AiMessage').filter(m => m.conversationId === c.id)].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  return { ...base, messages: messages.map(serializeAiMessage) }
}

// ── item 1: AI doubt-clearing tutor (student-only) ──

const TUTOR_OPENERS = [
  'Great question! Let’s break this down step by step.',
  'Good one — this trips up a lot of students at first, but it’s simpler than it looks.',
  'Sure, happy to help with this.',
]
const TUTOR_CLOSERS = [
  'Try working through a similar example on your own, and let me know if you get stuck.',
  'Does that make sense? Feel free to ask a follow-up if any part is unclear.',
  'Once you’re comfortable with this, try applying the same idea to a slightly harder problem.',
]

function simulateTutorAnswer(question: string): string {
  const opener = pick(TUTOR_OPENERS)
  const closer = pick(TUTOR_CLOSERS)
  return `${opener}\n\nRegarding "${question.length > 140 ? question.slice(0, 140) + '…' : question}" — start by identifying what’s actually being asked and which concept it draws on. Work through it methodically: note down what you know, what you need to find, and which formula or rule connects them. Explain each step out loud (or on paper) as you go — that’s usually where the "aha" moment happens.\n\n${closer}`
}

route('POST', '/ai/ask', (ctx) => {
  const actor = requireAuth(ctx)
  if (actor.role !== 'student') throw forbidden('Only students may ask the AI tutor')
  const b = ctx.body as { question: string; subjectId?: string }
  if (!b.question?.trim()) throw badRequest('question is required')
  if (b.subjectId && !table('Subject').some(s => s.id === b.subjectId && s.schoolId === actor.schoolId)) throw badRequest('Unknown subjectId')

  const conversations = table('AiConversation')
  let conv = conversations.find(c => c.schoolId === actor.schoolId && c.studentId === actor.userId && (c.subjectId ?? null) === (b.subjectId ?? null))
  if (!conv) {
    conv = { id: uid('aic'), schoolId: actor.schoolId, studentId: actor.userId, subjectId: b.subjectId ?? null, title: null, createdAt: nowIso() }
    conversations.push(conv); saveTable('AiConversation', conversations)
  }

  const messages = table('AiMessage')
  const userMessage: Row = { id: uid('aim'), conversationId: conv.id, role: 'user', content: b.question.trim(), createdAt: nowIso() }
  messages.push(userMessage)
  const assistantMessage: Row = { id: uid('aim'), conversationId: conv.id, role: 'assistant', content: simulateTutorAnswer(b.question.trim()), createdAt: nowIso() }
  messages.push(assistantMessage)
  saveTable('AiMessage', messages)

  return status(201, { conversationId: conv.id, userMessage: serializeAiMessage(userMessage), assistantMessage: serializeAiMessage(assistantMessage) })
})

route('GET', '/ai/conversations', (ctx) => {
  const actor = requireAuth(ctx)
  if (actor.role !== 'student') throw forbidden('Only students have an AI tutor history')
  const rows = [...table('AiConversation').filter(c => c.schoolId === actor.schoolId && c.studentId === actor.userId)].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(c => serializeAiConversation(c, true)) }
})

// ── item 2: AI-generated worksheets ──

function serializeWorksheet(w: Row) {
  return { id: w.id, classSubjectId: w.classSubjectId, chapterIds: w.chapterIds, title: w.title, content: w.content, pdfFileId: w.pdfFileId ?? undefined, createdById: w.createdById, createdAt: w.createdAt }
}

function assertCanGenerate(actor: { role: string }) {
  if (actor.role === 'student' || actor.role === 'parent') throw forbidden('Only a teacher, staff, or admin may generate teaching material')
}

const QUESTION_STEMS = ['Define and explain', 'Solve the following problem on', 'Compare and contrast two aspects of', 'Give a real-world example of', 'True or False, with justification:', 'Briefly describe the significance of']

function simulateWorksheetContent(subjectName: string, gradeLabel: string, chapterTitles: string[], questionCount: number, difficulty: string) {
  const chapterList = chapterTitles.length ? chapterTitles.map(c => `- ${c}`).join('\n') : '- (chapters as selected)'
  const questions = Array.from({ length: questionCount }, (_, i) => {
    const topic = chapterTitles.length ? pick(chapterTitles) : subjectName
    return `${i + 1}. ${pick(QUESTION_STEMS)} ${topic}.`
  }).join('\n')
  const answerKey = Array.from({ length: questionCount }, (_, i) => `${i + 1}. (Model answer — review and edit before sharing with students.)`).join('\n')
  return `${subjectName} Worksheet — Grade ${gradeLabel}\nInstructions: Attempt all questions. Show your working where applicable. Difficulty: ${difficulty}.\n\nChapters covered:\n${chapterList}\n\nQuestions:\n${questions}\n\nAnswer Key\n${answerKey}`
}

route('POST', '/ai/generate-worksheet', (ctx) => {
  const actor = requireAuth(ctx)
  assertCanGenerate(actor)
  const b = ctx.body as { classSubjectId: string; chapterIds: string[]; questionCount?: number; difficulty?: 'easy' | 'medium' | 'hard' }
  if (!b.chapterIds?.length) throw badRequest('chapterIds must include at least one chapter')
  const cs = table('ClassSubject').find(c => c.id === b.classSubjectId && c.schoolId === actor.schoolId)
  if (!cs) throw notFound('Class subject')
  const subject = table('Subject').find(s => s.id === cs.subjectId)
  const cls = table('Class').find(c => c.id === cs.classId)
  const grade = cls ? table('Grade').find(g => g.id === cls.gradeId) : undefined
  const chapterTitles = table('SyllabusChapter').filter(ch => b.chapterIds.includes(ch.id)).map(ch => String(ch.title))

  const questionCount = b.questionCount ?? 10
  const difficulty = b.difficulty ?? 'medium'
  const subjectName = subject?.name ? String(subject.name) : 'General'
  const title = `${subjectName} Worksheet — ${chapterTitles.length ? chapterTitles.join(', ') : 'Selected Chapters'}`
  const content = simulateWorksheetContent(subjectName, grade?.label ? String(grade.label) : '—', chapterTitles, questionCount, difficulty)
  return { classSubjectId: b.classSubjectId, chapterIds: b.chapterIds, title, content }
})

route('POST', '/ai/worksheets', (ctx) => {
  const actor = requireAuth(ctx)
  assertCanGenerate(actor)
  const b = ctx.body as { classSubjectId: string; chapterIds: string[]; title: string; content: string }
  const row: Row = { id: uid('worksheet'), schoolId: actor.schoolId, classSubjectId: b.classSubjectId, chapterIds: b.chapterIds, title: b.title, content: b.content, pdfFileId: null, createdById: actor.userId, createdAt: nowIso() }
  const rows = table('GeneratedWorksheet'); rows.push(row); saveTable('GeneratedWorksheet', rows)
  return status(201, { item: serializeWorksheet(row) })
})

route('GET', '/ai/worksheets', (ctx) => {
  const actor = requireAuth(ctx)
  assertCanGenerate(actor)
  const { classSubjectId } = ctx.query
  let rows = table('GeneratedWorksheet').filter(w => w.schoolId === actor.schoolId)
  if (classSubjectId) rows = rows.filter(w => w.classSubjectId === classSubjectId)
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializeWorksheet) }
})

route('GET', '/ai/worksheets/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const row = table('GeneratedWorksheet').find(w => w.id === ctx.params.id && w.schoolId === actor.schoolId)
  if (!row) throw notFound('Generated worksheet')
  return { item: serializeWorksheet(row) }
})

// ── item 3: AI-drafted report-card remarks ──

const REMARK_TEMPLATES = [
  (name: string) => `${name} has shown steady effort and engagement in class this term. Continuing to build consistent study habits will help translate that effort into even stronger results.`,
  (name: string) => `${name} has performed well this term, participating actively in class discussions. A little more focus on regular revision would help consolidate these gains further.`,
  (name: string) => `${name} demonstrates good understanding of core concepts and completes assignments reliably. Encouraging more independent problem-solving would be a good next step.`,
]

route('POST', '/ai/draft-remark', (ctx) => {
  const actor = requireAuth(ctx)
  const b = ctx.body as { studentId: string; termId: string }
  const student = table('User').find(u => u.id === b.studentId && u.schoolId === actor.schoolId && u.role === 'student')
  if (!student) throw notFound('Student')
  const term = table('Term').find(t => t.id === b.termId && t.schoolId === actor.schoolId)
  if (!term) throw notFound('Term')
  const isStaff = ['staff', 'admin', 'superadmin'].includes(actor.role)
  const isClassTeacher = table('Enrollment').some(e => e.studentId === student.id && e.status === 'active'
    && table('Class').find(c => c.id === e.classId)?.classTeacherId === actor.userId)
  if (!isStaff && !isClassTeacher) throw forbidden('Only the class teacher, staff, or admin may draft a remark for this student')

  const draft = pick(REMARK_TEMPLATES)(String(student.name))
  return { studentId: b.studentId, termId: b.termId, draft }
})

// ── item 4: AI translation ──

const TRANSLATE_PREFIX: Record<string, string> = {
  Hindi: '[हिंदी अनुवाद]', Tamil: '[தமிழ் மொழிபெயர்ப்]',
  Telugu: '[తెలుగు అనువాదం]', Kannada: '[ಕನ್ನಡ ಅನುವಾದ]',
  Marathi: '[मराठी अनुवाद]', Bengali: '[বাংলা অনুবা঒6]', Gujarati: '[ગુજરાતી અનુવાદ]',
}

route('POST', '/ai/translate', (ctx) => {
  requireAuth(ctx)
  const b = ctx.body as { text: string; targetLanguage: string }
  if (!b.text?.trim()) throw badRequest('text is required')
  const prefix = TRANSLATE_PREFIX[b.targetLanguage] ?? `[${b.targetLanguage}]`
  // Simulated — see header note. A real integration would call the Claude API; here we clearly label the
  // (untranslated) text so the demo UI shows a plausible-looking translated panel without faking content.
  const translatedText = `${prefix} ${b.text.trim()}`
  return { targetLanguage: b.targetLanguage, translatedText }
})
