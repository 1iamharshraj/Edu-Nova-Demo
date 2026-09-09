# Phase 25 — Exam Operations

Depends on Phase 18 (syllabus pace feeds the board-exam readiness dashboard, item 4) — build item 4 last, after confirming Phase 18 is live (it already is by the time this phase starts, per the roadmap sequencing). Extends the existing `Assessment`/`Room`/timetable-conflict infrastructure. Can run in parallel with Phase 27.

## 1. Exam seating-plan generation

- `ExamSeatingPlan { id, schoolId, assessmentIds (string array — an exam slot can cover multiple assessments sharing a room/time, e.g. different electives in one hall), date, roomId, generatedAt, generatedById }` + `ExamSeat { id, planId, studentId, seatNumber, assessmentId }`.
- `POST /api/exams/seating-plans` `{assessmentIds, date, roomId}` — the generation algorithm: gather every student enrolled in a class taking any of the given assessments, assign seats in the room (use `Room.capacity`, reject if the combined student count exceeds it) with a simple, explainable mixing rule (e.g. alternate by class/subject so adjacent seats are never the same class+subject combination where possible) — don't over-engineer a sophisticated constraint solver, a straightforward round-robin interleave that avoids same-paper neighbors where the numbers allow it is sufficient and matches how this is actually done by hand today.
- `GET /api/exams/seating-plans/:id` — the generated chart; `GET /:id/pdf` — a printable seating chart (reuse `server/src/lib/pdf.ts`).
- Frontend: pick assessments + room + date → generate → review/print.

## 2. Invigilation roster

- `InvigilationDuty { id, schoolId, assessmentId, roomId, teacherId, date, status (Assigned|Confirmed|Completed) }`.
- `POST /api/exams/invigilation/auto-assign` `{assessmentIds, date}` — suggest teachers who are free that period (no `TimetableEntry` of their own then, no existing `Duty` conflict — check the existing `Duty` model from Phase 6 for how to avoid double-booking a teacher across duty types) and don't already teach one of the subjects being examined (avoid a teacher invigilating their own subject's exam, a common real constraint) — rank by current invigilation-duty count this term (spread the load). Returns suggestions; admin/staff confirms via a normal create/assign endpoint, doesn't have to auto-commit.
- `/api/exams/invigilation` CRUD for manual assignment/adjustment, `POST /:id/confirm` (the assigned teacher confirms).
- Frontend: an auto-suggest + manual-override roster screen, and "My Invigilation Duties" for teachers (could fold into the existing Duties screen from Phase 6 rather than being a separate nav item — check that screen first).

## 3. Hall tickets / admit cards

- `GET /api/exams/hall-ticket/:studentId?termId=` — a real PDF (reuse `server/src/lib/pdf.ts`, matching the certificate/payslip pattern) with student photo, name, roll number, board registration number if applicable (Phase 4's `BoardRegistration`), the list of assessments/dates/rooms/seat numbers (pulling from item 1's seating plan if one exists for each assessment, otherwise just the assessment schedule without a seat number). Self/guardian/staff/admin can download.
- Frontend: a "Download Hall Ticket" button on the student's own portal and on the staff-facing student detail view.

## 4. Board-exam readiness dashboard

- `GET /api/exams/board-readiness?classId=` (staff/admin, likely scoped to 10th/12th classes specifically — check if there's a clean way to identify board-exam-eligible grades, e.g. `Grade.label` matching X/XII, or just let the caller pick any class and the dashboard is equally valid for any grade even if most useful for board years) — for every student in the class: their overall syllabus pace across all subjects (aggregate Phase 18's per-class-subject pace into one "how many subjects are behind" signal), their average mock/assessment scores, and their `BoardRegistration` status (Draft/Pending/Validated/SentToBoard from Phase 4). One row per student, sortable/filterable by "needs attention" (any subject significantly behind, or registration not yet validated, or scores trending down).
- Frontend: a dashboard table, staff/admin, likely fits well as a new tab on the existing Board Registration screen or Student Reports area — check both before deciding where it belongs.

## 5. Exam-schedule clash detection for elective combinations

- Extend the existing assessment-scheduling logic (find where an `Assessment`'s date/time gets set — check `server/src/modules/assessments/`) to check: does any student who's enrolled in TWO different elective subjects (via `ClassSubject`/`CurriculumSubject`'s elective `kind`, from the multi-board curriculum work) have two assessments scheduled at an overlapping date/time? This mirrors the existing timetable teacher/room conflict-detection pattern (409 + a `conflicts[]` array) — reuse that response shape convention for consistency, don't invent a new error format.

## Ground rules
Same as every previous phase: additive migrations, `server/src/modules/exams/{router,service,schema}.ts` for items 1-3 (or extend `assessments/` if that's cleaner after reading it — your call), extend `assessments/` for items 4-5, zod validation, `requireRole()`/scope helpers, `HttpError`, `audit()` on mutations, add cleanup blocks to `POST /reset`, no git commands, no `/admin/reset`/`/admin/load-sample-data` except your own final step, server/frontend split with Portal.tsx changes described-not-made by the frontend agent, full tsc/eslint/87-test verification, live curl+UI verification — specifically generate a real seating plan against seeded students/rooms and confirm no room-capacity violation, and confirm the elective clash detector actually catches a deliberately-overlapping test case.
