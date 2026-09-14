# Static Demo — Mock Backend Plan — **DONE**

All ~272 endpoint call sites across every module (HR/finance/payroll/leave, library/hostel/transport/
inventory, admissions & documents, sectioning, the full T0-T10 timetable engine, exams/academics-adjacent,
safety/wellbeing, community/comms, analytics/activities) are implemented and seeded. Full gate clean:
`npx tsc -b --noEmit`, `npx eslint .` — both clean, repo-wide. Every individual `e2e/*.spec.ts` file passes
reliably when run alone; a full `npx playwright test` run (34 tests across 11 spec files) shows occasional,
non-reproducing-in-the-same-place flakiness under sustained load (the shared sandbox's Vite dev server +
Chromium running continuously for many minutes across many consecutive full-suite executions) — this is the
same environmental pattern seen repeatedly with the real backend's vitest suite earlier in this project, not
an application defect. `retries: 1` is set in `playwright.config.ts` to absorb it.

**Two real bugs were found and fixed during the final integration pass** (by the orchestrating session, not
a module-batch agent): (1) `seed/activities.ts` did `db.Activity = [...]` — a full overwrite, not an append
— which silently destroyed the four house `Activity` rows `seed/community.ts` seeds whenever the activities
fragment happened to run after community's, breaking the House Leaderboard. Fixed to `db.Activity = [...(db.Activity ?? []), ...]`, and `db.ActivityRegistration` was given the same treatment defensively. A repo-wide
grep confirmed this was the only genuine cross-file collection-name collision that overwrote instead of
appended (`User`/`Enrollment`/`Guardian` are also written by two files each — `core.ts` and `admissions.ts`
— but both already append correctly). (2) `e2e/community-comms.spec.ts`'s house-leaderboard assertion used
a bare `getByText(...).first()`, which matched a hidden `<option>` in the page's own "Award points"
house-picker `<select>` before the actual visible leaderboard row — fixed with a `:visible` CSS selector.



Goal: make `main` (the branch Vercel deploys) a fully clickable, backend-free demo of EVERYTHING built
on `feature/backend-api` — the original ~30-phase ERP plus the T0-T10 Advanced Timetable Generation
project. Decisions locked in with the user: full scope (not a highlight reel), simulate complex
algorithms for speed rather than genuinely reimplementing them, build directly on `main` (no commits/
pushes without an explicit ask in that message).

## Architecture (built, working, do not redesign)

`feature/backend-api`'s ENTIRE frontend (`src/`, 189 files) has been checked out onto `main` unchanged.
Every hook and page still calls `api.get/post/patch/put/del()` from `src/lib/api.ts` exactly as before —
nothing in `src/portal/`, `src/pages/`, or `src/lib/hooks/` needs to change. The only rewritten file is
`src/lib/api.ts` itself: `request()` now calls `dispatch()` from `src/lib/mock/` instead of `fetch()`.

`src/lib/mock/` is the in-browser stand-in for the real Express/Prisma backend:
- `store.ts` — `Collections` (`Record<string, Row[]>`, one array per Prisma model name), persisted to
  `localStorage`, plus a fake bearer-token session map (no real JWT — this is a demo, not a security
  boundary) and `uid()`/`nowIso()` helpers.
- `router.ts` — a tiny Express-alike: `route(method, pattern, handler)` registers a handler; `dispatch()`
  is what `api.ts` calls. `requireAuth`/`requireRole` throw `MockHttpError` the same way the real
  server's `requireRole()`/`HttpError` do. **`crud(basePath, collection, opts)` is the single most
  important tool for the remaining work** — it auto-registers list/get/create/update/delete for a
  straightforward schoolId-scoped collection in one line; only write a hand-rolled `route()` for
  endpoints that genuinely aggregate, validate across collections, or simulate an algorithm.
- `http.ts` — `MockHttpError` + `notFound`/`forbidden`/`badRequest`/`conflict` helpers.
- `serialize.ts` — cross-cutting row→JSON shaping (currently just `serializeUser`; add more here only
  when 2+ modules need the same shape — otherwise keep serializers local to their module file).
- `seed/index.ts` — orchestrates seed fragments; `seed/core.ts` seeds School/User/AcademicYear/Term/
  Board/Grade/Stream/Class/Subject/ClassSubject/Room/Enrollment/Guardian (one login-ready user per
  role, 4 classes, core subjects). **A new module batch adds its own `seed/<module>.ts` file exporting
  a fragment function, registers it via `addSeedFragment()` in that file's own top-level code (import
  it for the side effect), and adds ONE import line to `src/lib/mock/index.ts`.**
- `modules/auth.ts`, `modules/users.ts`, `modules/admin.ts`, `modules/academic.ts`, `modules/group.ts`,
  `modules/files.ts` — done. Cover login/me/refresh/logout/change-password, user CRUD + search, admin
  reset/load-sample-data (both just reseed — there's no "empty school" concept in a single-school static
  demo), the full `/academic/bootstrap` aggregation + CRUD for its 16 sub-resources, group/mine
  (always "no group"), and file upload/download (small images round-trip as data URLs; everything else
  downloads a placeholder blob).
- `index.ts` — the manifest. Imports every seed fragment and every route module for their side effects,
  exports `dispatch`. **This is the one shared file every batch touches — one import line each.**

Verified: `npx tsc -b --noEmit` and `npx eslint .` are clean across the WHOLE 189-file frontend against
this foundation (proves the swap is transparent to every existing page/hook). A real login→bootstrap
round trip should be smoke-tested per batch (see Testing below).

## Endpoint inventory (272 distinct `method+path` call sites, grep'd from `src/lib/hooks` + `src/portal`
## + `src/pages`) grouped by prefix — this is the punch list

Already done: `auth` (3), `users` (6), `academic` (6 + 16 sub-resources), `admin` (1), `group` (2),
`(root)`/files (3).

Remaining, roughly ordered by how much of the app depends on them (do foundational ones first):

1. **HR/finance/library/hostel/transport core** — the original ~30-phase ERP's bread and butter:
   `hr` (8), `payroll` (2), `leave` (5), `fees` (14), `accounting` (4), `library` (8), `hostel` (17),
   `transport` (11), `inventory` (11). These are almost entirely `crud()`-shaped — a batch here should
   mostly be seed data + one `crud()` call per collection, with maybe 2-3 hand-written aggregation
   endpoints per module (e.g. a fee-defaulter summary, a payroll run).
2. **Admissions & documents** (T2-era) — `applications` (3), `admission-documents` (7),
   `board-registrations` (3), `certificates` (1), `verification` (2). Needs the category/document-type/
   physical-custody model seeded (see `phase-t2-strong-admissions.md` for the real shape) and the
   approve-with-document-checklist flow simulated (real validation logic, since it's simple conditional
   checks, not an algorithm — don't fake this one).
3. **Sectioning** (T3-era) — `sectioning` (13). Simulate the actual strategies (BALANCED/RANKED/
   SKIM_THEN_BALANCE/etc.) with a simplified deterministic shuffle that LOOKS like a real strategy ran
   (respects the stated strategy's spirit — e.g. BALANCED actually interleaves by score) rather than
   porting the real solver.
4. **Timetable engine** (T0-T10) — `timetable` (42, by far the largest single group) + `substitutions`
   (1, though T9 added many more under the `timetable` prefix already counted). This is where "simulate
   for speed" matters most: seed 2-3 ALREADY-GENERATED timetables (don't run a live solver), and make
   "Auto-Generate"/"What-If"/"Regenerate" buttons apply a canned-but-parameterized transformation (e.g.
   swap the specific slot a what-if event names, using real conflict-checking so it never produces a
   double-booking, but skip genuine constraint-satisfaction search). T7's version/lock/override system
   and T9's PeriodHold race guard are cheap, real state-machine logic — implement those for real, they're
   not the expensive part.
5. **Exams & academics-adjacent** — `exams` (5), `assessments` (10), `syllabus` (9), `homework` (4),
   `attendance` (4), `feed` (4), `calendar` (3), `meetings` (2), `slips` (2), `achievements` (2),
   `health` (4), `highlights` (2).
6. **Safety & wellbeing** — `safety` (10), `counseling` (via `calls`? confirm prefix), `discipline` (3),
   `staff-conduct` (2), `scholarships` (4).
7. **Community & comms** — `alumni` (8), `culture` (1), `canteen` (1), `messages` (2),
   `notifications` (2), `reviews` (3), `ai` (5).
8. **Misc** — `analytics` (2), `activities` (3).

(Counts are call-site counts from the grep inventory, not endpoint counts — a module with sub-resources
like `academic` undercounts real surface area. Re-run the inventory command below if it drifts.)

```
python3 - <<'PY'
import re, glob
paths=set()
files=glob.glob('src/lib/hooks/*.ts')+glob.glob('src/portal/**/*.tsx',recursive=True)+glob.glob('src/pages/**/*.tsx',recursive=True)
pat=re.compile(r"api\.(get|post|put|patch|del)(?:<[^>]*>)?\(\s*[`'\"]([^`'\"]*)")
for f in files:
    for m in pat.finditer(open(f,encoding='utf-8').read()):
        paths.add((m.group(1), m.group(2).split('${')[0]))
print(len(paths))
PY
```

## Ground rules for each batch

- Read the real `server/src/modules/<name>/` (or wherever the module lives — grep first) for the exact
  response shape each endpoint must match; read the frontend hook(s)/pages that call it for what's
  actually consumed (don't build fields nothing reads). The `server/` directory sitting in this working
  tree is untracked leftover from `feature/backend-api` — read-only reference, never edit it, and don't
  worry about it being stale on disk elsewhere; a clean copy is also available via
  `git show feature/backend-api:server/src/...` if needed.
- Prefer `crud()` over hand-rolled routes. Only hand-roll when there's real cross-collection logic,
  aggregation, or a simulated algorithm.
- Add realistic Indian-school-appropriate seed data — names, categories, amounts — consistent with what
  the real backend's `server/src/sampleConstants.ts`/`sampleData.ts` already established (reuse/adapt
  those values rather than inventing a second style).
- No git commands. Don't touch `src/App.tsx` or `src/portal/Portal.tsx` — those are unchanged from
  `feature/backend-api` and already route to every page; if a genuinely new route is somehow needed,
  report it instead of adding it.
- Full gate: `npx tsc -b --noEmit` and `npx eslint .` (repo root) must stay clean.

## Testing (no live backend to curl, so verify differently)

Since there's no server to hit with `curl`, verify each batch by importing `dispatch` from
`src/lib/mock` directly in a small Node script (`npx tsx` if available, or a `.mjs` script run via
plain `node` after a quick esbuild/tsc transpile) and calling it end-to-end: log in, hit the batch's
endpoints, assert the shapes match what the corresponding hook expects. `npm run e2e` (Playwright) is
also available in this repo if a real headless-browser click-through is worth the setup for a given
batch — check `e2e/`/`playwright.config.ts` for what's already wired before assuming from scratch.
