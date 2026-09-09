# Phase 19 — Early Warning & Teaching Analytics

Depends on Phase 18 (syllabus/lost-periods data feeds into two of these features) — build after Phase 18 has landed and its endpoints are confirmed live.

## 1. Student risk scoring (the centerpiece of this phase)

- `StudentRiskSnapshot { id, schoolId, studentId, termId, computedAt, attendancePct, avgMarksPct, homeworkOverdueCount, feeOverdueAmount, openDisciplineCaseCount, riskScore (0-100), riskLevel (Low|Medium|High), factors (JSON array of {factor, weight, contribution} for explainability) }` — a computed, periodically-refreshed snapshot, not a live-query-every-time endpoint (real-time computation across 5 modules on every page load would be slow at scale; recompute on a schedule or on-demand via a button, your call on mechanism, but the model should look like a cached/materialized result).
- **Scoring formula** (make this genuinely reasonable, not arbitrary): weight attendance drop, marks decline (trend, not just absolute — a student going from 90% to 70% is a bigger signal than one steady at 65%), overdue homework count, fee overdue amount (as a binary/tiered factor, not linear — a family with an overdue fee isn't automatically "at risk" academically, weight it lower than the academic factors, or make it a separate visible flag rather than folded into one score if that's cleaner), and open disciplinary cases. Document the exact weights and reasoning in code comments — this is the kind of number a class teacher will trust or distrust based on whether it makes sense, so it needs to be explainable, not a black box. The `factors` JSON field exists specifically so the UI can show "why" a student is flagged, not just a number.
- Computation trigger: `POST /api/analytics/risk-snapshots/recompute` (staff/admin, recomputes for the whole school or one class) is sufficient for v1 — a background cron-style auto-recompute is a nice-to-have, not required.
- `GET /api/analytics/risk-snapshots?classId=&riskLevel=` — class teacher sees their own class, staff/admin see any class.
- Frontend: a "Students at Risk" section, visible to class teachers (their own class) and staff/admin (any class), showing flagged students with the explainability factors, and a link into the student's existing full report (`StudentReportMod` from Phase 8).

## 2. Lost instructional time report

Directly built on Phase 18's lost-periods calculation, aggregated to a school-wide/class-wide/subject-wide report rather than per-class-subject. `GET /api/analytics/lost-time?termId=&groupBy=class|subject|teacher` — total scheduled periods vs. periods actually delivered, broken down, with the reason breakdown (holiday/staff-absence) Phase 18 already computes per class-subject, summed up. This should be mostly an aggregation query over Phase 18's existing computation, not new core logic — check with the Phase 18 server work (should already be landed) for the exact function/query to reuse before writing a parallel implementation.

## 3. Teacher workload balancing

`GET /api/analytics/teacher-workload?termId=` — for every teacher, count of periods/week from real `TimetableEntry` rows, surfaced as a simple list/table sorted by load, with a configurable "high load" threshold (default 30 periods/week, admin-editable — check if a sensible place for this setting already exists, e.g. alongside `LibrarySettings`'s pattern of one settings-row-per-school, or add a similar simple settings row here). Surface this **inside the existing Timetable Builder** as a warning banner when assigning a teacher who's already near/over the threshold for that term, not just as a standalone report — the value is catching it while building, not after.

## 4. Homework load regulation

`GET /api/analytics/homework-load?classId=&date=` — for a given class and date, how many teachers have assigned homework due that day (query the existing `Homework` model by class+dueDate). Surface as a warning **inside the existing Create Assignment screen**: when a teacher picks a due date, show "3 other subjects already have homework due this day for this class" before they submit — same "catch it while creating, not after" principle as workload balancing.

## 5. Smart substitute suggestion

Extends the existing `Substitution` model/workflow (check `server/src/modules/timetable/` for how substitutions are currently created — likely a manual picker). `GET /api/analytics/substitute-suggestions?classSubjectId=&date=&periodIdx=` — returns a ranked list of candidate teachers: free that period (no `TimetableEntry` of their own then), teaches that subject somewhere in the school (preferred), sorted by current workload (prefer less-loaded teachers). Surface as a "Suggested" section at the top of whatever picker already exists for assigning a substitute — don't replace the manual picker, augment it.

## Frontend integration notes
Items 3, 4, and 5 are explicitly **augmentations to existing screens** (Timetable Builder, Create Assignment, the substitution picker), not new standalone modules — the frontend agent should expect to make small, targeted additions to `src/portal/modules/timetableBuilder.tsx`, `src/portal/modules/classroom.tsx` (`CreateAssignmentMod`), and wherever substitutions are assigned, in addition to building the new risk-dashboard and lost-time-report screens. Read those files first to find the right insertion points before writing new UI from scratch.

## Ground rules
Same as every previous phase: additive migrations, `server/src/modules/analytics/{router,service,schema}.ts` pattern (items 3/4/5 can be service functions without new models, if they're pure computed queries — only item 1 clearly needs a persisted model), zod validation, `requireRole()`, `HttpError`, `audit()` on the recompute action, add a Phase 19 cleanup block to `POST /reset` if any new table exists, no git commands, no `/admin/reset`/`/admin/load-sample-data` except your own final step, server/frontend split with Portal.tsx changes (and the three existing-screen augmentations) described-not-made by the frontend agent, full tsc/eslint/87-test verification, live curl+UI verification — specifically verify the risk score for at least one deliberately-seeded "at risk" student and one deliberately-seeded "healthy" student produce sensibly different scores with sensible `factors` explanations.
