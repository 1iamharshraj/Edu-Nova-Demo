# Phase 20 — AI-Powered Teaching & Communication

Extends the existing AI module (`server/src/modules/ai/`, `AiConversation`/`AiMessage`, Claude via `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`-gated with a graceful "not configured" state — read that module first, follow its exact patterns, don't rebuild the Claude-calling infrastructure). Depends on Phase 18 (syllabus chapters) for item 1. Independent of Phase 19/21 — can run in parallel with Phase 22.

**Every AI-generated item in this phase must be clearly labeled as AI-generated in the UI and require human review/approval before anything is sent, published, or graded** — this is a hard requirement, not a style preference. An AI-drafted report-card remark that gets emailed to a parent without a teacher looking at it first is a real reputational risk for a school; don't build a path where that can happen.

## 1. Syllabus-scoped AI tutor

Modify the existing `POST /api/ai/ask` system-prompt construction (find it in `server/src/modules/ai/service.ts`) to additionally fetch the student's `ChapterProgress` (Phase 18) for their enrolled subjects and include "chapters covered so far: [list]; chapters not yet covered: [list]" in the system prompt, with an instruction to the model to gently redirect if a question is clearly about not-yet-covered material rather than just answering it as if it were fair game. This is a prompt-construction change, not a new endpoint — keep the existing rate limit, conversation model, and "not configured" fallback exactly as they are.

## 2. AI-generated worksheets / question papers

- `POST /api/ai/generate-worksheet` `{classSubjectId, chapterIds: string[], questionCount?, difficulty?}` (teacher of that class-subject, staff, admin) — calls Claude with the chapter titles/topics as context, returns a structured draft (title, instructions, numbered questions, optionally an answer key) as **plain text/markdown content, not a saved document yet**.
- `POST /api/ai/worksheets` — the teacher reviews/edits the draft, then explicitly saves it (persisted as a `GeneratedWorksheet { id, schoolId, classSubjectId, chapterIds, title, content, createdById, createdAt }` — simple content storage, reuse the existing PDF-generation helpers from `server/src/lib/pdf.ts` if you want a downloadable PDF, matching how certificates/payslips already work).
- Rate-limit generation the same way `/ai/ask` already is (reuse the existing per-day-per-user counting pattern, don't invent a new one).

## 3. AI-drafted report-card remarks

- `POST /api/ai/draft-remark` `{studentId, termId}` (class teacher of that student, staff, admin) — pulls the student's real report card (existing `reports.reportCard()` function from the assessments module), attendance summary, and any achievements for that term, and asks Claude to draft a 2-3 sentence personalized remark. Returns the draft text only — **does not save it anywhere**.
- The actual report-card remark field: check whether `ReportCard`/`Assessment`'s existing structure already has a "remarks" field the teacher can edit and publish (if not, this may need a small additive field on whatever model report cards are assembled from — check first, extend minimally, don't restructure the assessments module). The teacher pastes/edits the AI draft into that real field and saves it through the existing report-card publish flow.

## 4. AI-translated parent communications

- `POST /api/ai/translate` `{text, targetLanguage}` (any authenticated role, rate-limited) — a thin, generic Claude call: translate this text to the target language, preserving tone and any specific numbers/dates/names exactly. Reasonable target-language list: Hindi, Tamil, Telugu, Kannada, Marathi, Bengali, Gujarati (validate against an enum, don't accept arbitrary free text as the target language).
- Frontend integration: a "Translate" button/option wherever a notice, message, or report-card remark is composed or read (Feed post composer, Messages, the report-card remark field from item 3) — calls the endpoint and shows the translated text alongside the original, never replacing it silently.

## Ground rules
Same as every previous phase: no new Prisma models except `GeneratedWorksheet` (item 2), extend `server/src/modules/ai/` for all four items rather than creating a parallel module, zod validation, `requireRole()`/existing scope helpers (especially `assertWriteClassSubject` for items 1-3, matching Phase 18's precedent), `HttpError`, `audit()` on generation actions, add a cleanup block to `POST /reset` for `GeneratedWorksheet`, no git commands, no `/admin/reset`/`/admin/load-sample-data` except your own final step, server/frontend split with Portal.tsx changes described-not-made by the frontend agent, full tsc/eslint/87-test verification. Since `ANTHROPIC_API_KEY` is very likely NOT configured in this dev environment, verify every new endpoint's graceful "AI tutor not configured"-equivalent behavior (matching the existing `/ai/ask` pattern exactly — same 503 shape, no fake/regex fallback ever) rather than a real Claude response — that's the correct, expected state for this environment and should be what you actually test.
