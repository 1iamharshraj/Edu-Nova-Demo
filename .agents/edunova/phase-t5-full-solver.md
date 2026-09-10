# Phase T5 — Full Assignment Modes + Soft Constraints

Fifth phase of the Advanced Timetable Generation project (`advanced-timetable-roadmap.md` — read in full, especially T0's results). Read `phase-t4-solver-core.md` and T4's actual shipped code THOROUGHLY first — this phase widens T4's deliberately narrow scope (Mode 1 only, hard constraints only, single cohort group) into the full solver. Read `server/scratch/t0-solver-spike/spike.ts` again for the exact simulated-annealing implementation T0 validated — this phase turns that spike into real, tested production code, applying T0's two identified fixes (incremental delta scoring, decompose-by-cohort) from the start rather than porting the spike's naive full-rescore approach.

## 1. Assignment Modes 2-4

- **Mode 2 (Pool)**: `TeachingAssignment.assignmentMode='POOL'` with a `TeachingAssignmentPool { teachingAssignmentId, teacherId }` join — admin defines an eligible-teacher pool per requirement, the solver picks one from the pool respecting hard constraints (prefer lowest current workload as a tiebreaker, but this is a placement detail, not the full Mode 4 optimizer).
- **Mode 3 (Random)**: selects randomly from eligible teachers (T1's `TeacherQualification` scoped to the subject+grade-range) — must still respect every hard constraint; "random" means the tiebreak among already-valid candidates, never a constraint bypass.
- **Mode 4 (Optimized, recommended default)**: the real scoring-based selector — qualification match (T1 `TeacherQualification`), availability (T1 `TeacherAvailability`), current workload, class suitability, teacher preferences, conflict minimization, weekly workload balancing, **plus band-affinity matching** when T3 section band profiles exist (VERIFIED affinity weighted higher than DECLARED, per the original spec's priority order — T11's evaluation engine populates VERIFIED, so until T11 ships every school effectively runs on DECLARED only, which is fine and expected). Every selection writes `selectionReason` (the actual scores/fallback notes) for audit/explainability — when no band-affinity match exists, the reason text must say so plainly (e.g. "No support-band specialist available — assigned best-fit: Ravi (balanced profile, lowest workload)"), never silently drop the explanation.

## 2. Soft-constraint scoring + refinement engine

- Implement the scoring function T0 benchmarked: workload imbalance, teacher gaps, consecutive-same-subject, unpreferred periods (T1 `TeacherAvailability.PREFERRED`/`NOT_PREFERRED`), lab-split penalties — configurable weights via a `Preference { id, schoolId, type, scope, weight, priority, enabled, parameters }` table (data, not hardcoded, per the original spec's principle), seeded with the original spec's example weights as sensible defaults.
- **Simulated annealing refinement**, built correctly this time per T0's findings: incremental/delta scoring (never a full rescore per candidate move — maintain running per-teacher/per-cohort penalty contributions and update only what a move actually touches), decomposed by cohort-group (per-grade or per-department, not one whole-school pass — T0 confirmed this is both a performance necessity and the structurally correct scope given real-world near-block-diagonal structure).
- **Lexicographic staged objective**, exactly as T0 implemented it in the spike: hard constraints (weight ~1,000,000) → major soft violations like lab splits/teacher overload (~1,000) → workload balance (~50) → minor preference penalties (~1) — sized so no lower tier can ever outweigh a unit of the tier above it. A candidate move is validated against hard constraints BEFORE being scored at all, so hard constraints can never regress during refinement (T0's spike confirmed this invariant holds; this phase's real implementation must preserve it and test it explicitly).
- Time-budgeted: default 5s per cohort-group refinement pass (T0's benchmark showed 5s already captures ~99.7% of a 30s run's gain) — configurable, not hardcoded.

## 3. Preference profiles

- `PreferenceProfile { id, name (DEFAULT|BALANCED|TEACHER_FRIENDLY|STUDENT_FRIENDLY|EXAM_PREP|PRIMARY_SCHOOL|LAB_HEAVY), weightOverrides (json) }` — ship all 7 from the original spec as real, usable starting points (not placeholders), school picks one and can further adjust individual weights.

## Ground rules
Same rigor as every phase: additive migrations, extend `server/src/modules/timetable/`, zod validation, `requireRole()`, `HttpError`, `audit()`, reset-cleanup blocks, full `tsc`/`eslint`/`npm test` gate clean, no git commands, no `/admin/reset`/`/admin/load-sample-data` except a final verification step.

**Critical regression requirement**: T4's hard-constraint-only generation path and Phase 26's original "Auto-Generate" UI must both keep working throughout — this phase adds refinement as an additional step after the existing greedy placement, not a replacement of it.

**Live verification required**: generate a real timetable using Mode 4 (Optimized) with real T1 teacher-qualification and band-affinity data, confirm the `selectionReason` audit trail is genuinely explainable (not generic boilerplate); run refinement and confirm the total penalty score measurably improves while a re-run of the hard-constraint validator shows zero violations at every stage; confirm a school using a different `PreferenceProfile` produces a measurably different (and sensible) result than DEFAULT on the same input.

**Testing bar** (per roadmap D9): live UI verification for the preference-profile picker and the Mode 2/3/4 assignment-mode configuration, not just the generation endpoint.
