import { api } from '../api'
import type { GeneratedWorksheetDraft, GeneratedWorksheetRec, TranslateLanguage, WorksheetDifficulty } from '../data'
import { qs, useList } from './useAcademics'

// Data hooks + thin action wrappers for Phase 20 (AI-powered teaching & communication) — /api/ai/*.
// Components live in src/portal/modules/aiTools.tsx (worksheets) plus inline additions to
// classroom.tsx (Draft AI Remark, in the Gradebook) and social.tsx (Translate, in Feed/Messages).
// See .agents/edunova/phase-20-ai-teaching-communication.md. Item 1 (the syllabus-scoped tutor) is a
// server-only prompt change — no hook needed, `useAiConversations`/`ask()` in useIntegrations.ts /
// social.tsx already cover it.
//
// Every call below can 503 ("AI tutor not configured" — no ANTHROPIC_API_KEY) or 429 (daily rate limit) —
// callers catch `ApiError` and branch on `.status` exactly like `AIDoubtsMod.ask()` does; nothing here
// papers over that with a fake fallback.

/* ── worksheets (item 2) ─────────────────────────────────── */

/** `GET /ai/worksheets` — every worksheet the caller may see, optionally narrowed to one class-subject. */
export function useGeneratedWorksheets(classSubjectId?: string) {
  return useList<GeneratedWorksheetRec>(`/ai/worksheets${qs({ classSubjectId })}`)
}

/** `POST /ai/generate-worksheet` — draft only, not persisted. Throws `ApiError` (503 unconfigured, 429 rate-limited). */
export async function generateWorksheetDraft(body: { classSubjectId: string; chapterIds: string[]; questionCount?: number; difficulty?: WorksheetDifficulty }) {
  return api.post<GeneratedWorksheetDraft>('/ai/generate-worksheet', body)
}

/** `POST /ai/worksheets` — the teacher's explicit save, after reviewing/editing the draft above. */
export async function saveGeneratedWorksheet(body: { classSubjectId: string; chapterIds: string[]; title: string; content: string }) {
  return api.post<{ item?: GeneratedWorksheetRec } | GeneratedWorksheetRec>('/ai/worksheets', body)
    .then(r => (r && typeof r === 'object' && 'item' in r && r.item) ? r.item : (r as GeneratedWorksheetRec))
}

/* ── report-card remark drafting (item 3) ───────────────── */

/** `POST /ai/draft-remark` — returns draft text only; never saved anywhere by this call. The real,
 * teacher-editable field is `Enrollment.remarks[termId]` (surfaced as `ReportCard.remark`), saved
 * separately and explicitly via `saveReportCardRemark` below — see ReportCardRemarksMod in aiTools.tsx. */
export async function draftRemark(studentId: string, termId: string) {
  return api.post<{ studentId: string; termId: string; draft: string }>('/ai/draft-remark', { studentId, termId })
}

/** `PUT /assessments/report-card/remark` — the actual save, through the report card's own field (not the
 * AI module). Only ever called with text the teacher has reviewed/edited in the UI. */
export async function saveReportCardRemark(studentId: string, termId: string, remark: string) {
  return api.put<{ studentId: string; termId: string; remark: string }>('/assessments/report-card/remark', { studentId, termId, remark })
}

/* ── translation (item 4) ───────────────────────────────── */

/** `POST /ai/translate` — thin, generic; shown alongside the original text, never replacing it. */
export async function translateText(text: string, targetLanguage: TranslateLanguage) {
  return api.post<{ targetLanguage: string; translatedText: string }>('/ai/translate', { text, targetLanguage })
}
