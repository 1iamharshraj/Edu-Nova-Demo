# Phase 24 — Boarding & Hostel Extensions

Extends the existing Hostel module (Phase 14 — `Hostel`/`HostelRoom`/`HostelBed`/`HostelAllocation`, `server/src/modules/hostel/`). Read that module first, follow its exact patterns. Independent of Phase 23, can run in parallel with it.

## 1. Hostel outpass / leave workflow

- `HostelOutpass { id, schoolId, studentId, requestedDepartureAt, expectedReturnAt, reason, destination?, status (Pending|Approved|Declined|Departed|Returned|Overdue), approvedByWardenId?, approvedAt?, actualDepartureAt?, actualReturnAt? }`.
- Workflow: student (or parent, on the student's behalf) submits a request → the hostel's assigned warden (`Hostel.wardenUserId` from Phase 14) approves/declines → **on approval, notify the parent** (reuse existing notify infrastructure) → gate/warden logs actual departure (`POST /:id/depart`) and return (`POST /:id/return`) → a request past `expectedReturnAt` with no `actualReturnAt` should be queryable as `Overdue` (either a computed status at read time, or a background check that flips it — computed-at-read is simpler and sufficient here, don't build a scheduler for this).
- Endpoints: `/api/hostel/outpasses` — `POST` (student/parent for their own/ward's allocation), `GET` (self/guardian for own, warden/staff/admin for their hostel/any), `POST /:id/approve`, `POST /:id/decline`, `POST /:id/depart`, `POST /:id/return` (warden/staff/admin).
- Frontend: a request form (student/parent), an approval queue (warden — likely needs to check if `Hostel.wardenUserId` maps to an actual login-capable staff account and how "my hostel" scoping should work for a warden viewing only their own hostel's requests), and a gate-log depart/return action.

## 2. Night roll-call / hostel attendance

- `HostelRollCall { id, schoolId, hostelId, date, recordedById, createdAt }` + `HostelRollCallEntry { id, rollCallId, allocationId, present (bool), notes? }` — one roll-call session per hostel per night, entries for every currently-`Active` allocation in that hostel.
- `POST /api/hostel/roll-calls` (warden/staff/admin, creates a session pre-populated with every active allocation in that hostel defaulting to present, following the same "create session, then patch records" pattern already used by the existing student `AttendanceSession`/`AttendanceRecord` model — read that module for the exact pattern to mirror), `PATCH /api/hostel/roll-calls/:id/entries` (bulk update presence).
- **Missing-at-roll-call alert**: when a roll-call is submitted with any `present: false` entries, notify the warden (already knows, they just took it) AND the student's registered parent/guardian (reuse notify infrastructure) — this is the actual safety value of the feature.
- Frontend: a nightly roll-call screen (list of currently-allocated students, tap to mark absent, submit), and a history view.

## 3. Mess menu + meal feedback

- `MessMenu { id, schoolId, hostelId, date, mealType (Breakfast|Lunch|Snacks|Dinner), items (string, free text or string array) }` — admin/warden sets the menu, ideally in a batch/week-at-a-time UI rather than one meal at a time (frontend concern, backend can just take single-meal creates and let the frontend loop).
- `MealFeedback { id, schoolId, menuId, studentId, rating (1-5), comment? }` — students/parents can rate a given meal.
- `/api/hostel/mess-menu` CRUD (warden/staff/admin write, everyone with a hostel allocation reads), `/api/hostel/meal-feedback` (student/parent create for their own/ward's meals, warden/staff/admin read/aggregate).
- **Allergy surfacing**: if a `MessMenu` item's ingredients could reasonably be cross-referenced against a student's `HealthRecord` allergy entries (Phase 8/22), that's a nice-to-have connection worth attempting if it's genuinely low-effort (e.g. simple keyword matching against allergy `title`/`detail` text) — but don't force a heavyweight ingredient-tagging system into this phase if it balloons scope; a simple, clearly-labeled "may not account for all allergens, verify independently" disclaimer is an acceptable fallback if full matching isn't practical.
- Frontend: a menu display (this week's meals), a quick rating widget after a meal, and a warden-facing feedback summary (average ratings per meal/day).

## Ground rules
Same as every previous phase: additive migrations, extend `server/src/modules/hostel/` for all three items (don't fork into a separate module — this is squarely hostel-domain), zod validation, `requireRole()`/scope helpers (reuse Phase 14's self-or-guardian scoping pattern for outpasses/roll-call-visibility/meal-feedback), `HttpError`, `audit()` on mutations, add cleanup blocks to `POST /reset` for the three new model groups, no git commands, no `/admin/reset`/`/admin/load-sample-data` except your own final step, server/frontend split with Portal.tsx changes described-not-made by the frontend agent, full tsc/eslint/87-test verification, live curl+UI verification of the full outpass lifecycle (request → approve → depart → return) and a roll-call session with at least one "missing" entry triggering the parent notification.
