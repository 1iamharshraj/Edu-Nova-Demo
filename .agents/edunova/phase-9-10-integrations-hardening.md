# Phase 9 — Integrations & AI · Phase 10 — Hardening & launch

## Phase 9 (each item independently shippable)
1. **AI Doubt Clearing** → server route `POST /api/ai/ask` `{ question, subjectId? }` calling the Claude API (`@anthropic-ai/sdk`, model `claude-sonnet-5`, env `ANTHROPIC_API_KEY`); system prompt scoped to the student's class board/grade/subjects; `AiConversation`/`AiMessage` tables per student; rate limit 30/day/student; when the key is missing the module shows "AI tutor not configured" (no regex fallback). Frontend `AIDoubtsMod` streams the answer (SSE) and keeps history.
2. **Event Highlights CMS** → `Highlight { id, schoolId, title, url (YouTube/Drive), thumbnailFileId?, audience, publishedAt }`; admin screen; `HighlightsMod` renders real embeds.
3. **Email/SMS** → `server/src/lib/notify.ts` provider abstraction: `console` (default, logs), `resend` (env `RESEND_API_KEY`), `msg91` (SMS); used by fee reminders, password reset, admission credentials, leave decisions.
4. **PWA push** → `PushSubscription` table + `web-push` (VAPID keys in env); subscribe from Settings/profile; notifications service pushes.
5. **Telephony** — NOT implemented; the Call log (Phase 8) is the shipped replacement. Document as a future integration.

## Phase 10
1. Delete the JSON blob: remove `SchoolData` model, `/api/data`, `db.*` legacy reads, `update()` from the store, `seedDB()` legacy generators; `sampleData.ts` builds everything natively.
2. Drop legacy `User` columns (`class`, `section`, `roll`, `subjects`, `wards`, `parentEmail`, `board`, `salary`, `contract`, `resignation`) after replacing every read with `useAcademic()` lookups.
3. Tests: `server/test/*.test.ts` with vitest + supertest against a `edunova_test` database (`DATABASE_URL_TEST`), one file per module covering RBAC (each role × forbidden action) and the "empty school → full term" flow; Playwright `e2e/` smoke: login, setup checklist, timetable publish → student sees it, attendance → parent sees it, fee → pay → defaulter list. `npm test` runs both.
4. Security: rate-limit `/auth/*` (express-rate-limit), JWT refresh (`/auth/refresh` with rotating refresh tokens in a `Session` table; access token 15 min), helmet, file-type sniffing on upload, request logging (pino), `/api/health` includes DB check.
5. Pagination (`?limit&cursor`) on messages, notifications, audit, invoices, sessions; indexes reviewed.
6. Deployment: `docker-compose.prod.yml` (postgres + api + nginx serving `dist/`), `Dockerfile`s, `prisma migrate deploy` on start, `.env.example` for both, nightly `pg_dump` cron in compose, README "Deploy".
7. Docs: `.agents/edunova/current-state.md` rewritten as the full feature matrix with E2E verdicts; `TESTING.md` covers every phase; admin onboarding guide.
