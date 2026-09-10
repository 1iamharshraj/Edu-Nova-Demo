# Phase T4 — Constraint Builder + Solver Core (narrow scope)

Fourth phase of the Advanced Timetable Generation project (`advanced-timetable-roadmap.md` — read in full, especially T0's results section and D2/D3). Read `server/scratch/t0-solver-spike/spike.ts` (T0's throwaway benchmark) and `server/src/modules/timetable/autogen.ts` (Phase 26's shipped generator) THOROUGHLY before writing anything — this phase turns T0's validated research into real, tested production code, reusing what `autogen.ts` already does well per T0's explicit findings (occupancy-map pattern, lab-matching heuristic, double-period pairing) and extending what it doesn't have (day-of-week generalization via T1's `PeriodTemplate` override, and — starting in T5, not this phase — soft-constraint scoring/refinement).

**This phase is deliberately narrow**: one assignment mode (Fixed), hard constraints only, generation scoped to a single `Cohort` group at a time (not whole-school) — the goal is a real, working, tested core pipeline that T5 widens rather than a feature-complete solver on the first pass.

## 1. TeachingRequirement

- `TeachingRequirement { id, schoolId, cohortId (T1's Cohort, not Class), subjectId, requiredPeriodsPerWeek, sessionDuration (SINGLE|DOUBLE|TRIPLE|BLOCK), roomRequirement (ANY|LAB_TYPE|SPECIFIC_ROOM), labDoubleAllowed }`.
- Admin UI to define these per cohort+subject — for the common case (a cohort = one section), this is functionally equivalent to today's implicit "ClassSubject needs N periods/week" (check `ClassSubject.periodsPerWeek`, added in an earlier phase for Phase 26's own generator — reuse/migrate that data as the seed for TeachingRequirement rather than asking every school to re-enter it from scratch).

## 2. TeachingAssignment (Mode 1 — Fixed only, this phase)

- `TeachingAssignment { id, teachingRequirementId, teacherId, assignmentMode (FIXED — only value this phase), selectionReason, createdAt, createdBy }`.
- Simple admin UI: pick a teacher for a requirement. Modes 2-4 (Pool/Random/Optimized) are T5's job — this phase's UI only needs to support Fixed cleanly.

## 3. Constraint Builder

- Translates hard constraints (teacher collision, cohort collision, room collision, teacher/room availability from T1's `TeacherAvailability`, required weekly periods, fixed sessions, room-capability requirements from T1's `RoomCapability`) into the solver's internal model.
- Reuse `autogen.ts`'s existing occupancy-map pattern (`Map<id, Set<"day:period">>` for teacher/room busy-tracking) directly — T0 confirmed this ports cleanly, don't reinvent it.
- `Constraint { id, schoolId, type, scope, severity (HARD — this phase only), enabled, parameters, source (SYSTEM|SCHOOL|MANUAL) }` as a real, queryable, school-configurable table (per the original spec's data-not-code principle) — not hardcoded logic. The Constraint Builder reads active `Constraint` rows and applies them; it does not hardcode which constraints exist.

## 4. Solver — hard-constraint-only generation, single cohort group

- Generation entry point: `POST /api/timetable/generate` `{cohortIds[] (a single grade's worth, or a specific set — NOT "whole school" this phase), termId, mode: 'fill-empty'|'full-regenerate'}` — same request shape as Phase 26's existing `autogen.ts` endpoint (extend it in place, don't fork a parallel endpoint — read how the frontend currently calls it and keep that contract working) but scoped through `Cohort`/`TeachingRequirement`/`TeachingAssignment` instead of directly through `ClassSubject`.
- Greedy initial placement (ported from `autogen.ts`, generalized for T1's day-of-week `PeriodTemplate` — a Saturday half-day must place fewer periods and respect that day's own template, not the Mon-Fri one).
- **No soft-constraint scoring or SA refinement in this phase** — that's T5. This phase stops at "first feasible placement satisfying every hard constraint, reporting what didn't fit" — exactly `autogen.ts`'s current behavior, just re-targeted at the new data model.
- `unplaced[]` reporting exactly as `autogen.ts` already does (human-readable reason per unplaced requirement).
- Materialize output into real `TimetableEntry` rows per D3 — one row per underlying `Class` a cohort's sessions touch (for the common 1:1 section-cohort case, this is just one row per class, identical to today's behavior).

## Ground rules
Same rigor as every phase: additive migrations, extend `server/src/modules/timetable/` (this is squarely timetable-domain, don't fork a parallel module), zod validation, `requireRole()` (admin, matching existing autogen RBAC), `HttpError`, `audit()` on generation/commit, reset-cleanup blocks, full `tsc`/`eslint`/`npm test` gate clean, no git commands, no `/admin/reset`/`/admin/load-sample-data` except a final verification step.

**Critical regression requirement**: Phase 26's existing "Auto-Generate" UI in Timetable Builder must keep working exactly as today throughout this phase — T10 is when it's actually retired, not T4. This phase can EXTEND the underlying endpoint/logic but must not break the currently-shipped feature or its UI mid-transition.

**Live verification required**: generate a real timetable for one cohort group with genuinely constrained data (a teacher who teaches multiple cohorts, a subject needing a lab room), confirm zero hard-constraint violations in the output (re-run the existing conflict-detection engine against it), confirm the existing Phase 26 "Auto-Generate" UI still works unchanged, confirm a `TeachingRequirement` seeded from existing `ClassSubject.periodsPerWeek` data matches what the school already had configured.

**Testing bar** (per roadmap D9): live UI verification for the requirement/assignment configuration screens, not just the generation endpoint.
