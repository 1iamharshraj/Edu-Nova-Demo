# Phase T8 — Partial Re-optimization / What-If

Eighth phase of the Advanced Timetable Generation project (`advanced-timetable-roadmap.md` — read in full). Read T7's shipped `TimetableLock`/`TimetableVersion` code THOROUGHLY first — T7 built the lock model and a minimal "skip locked things during full-regenerate/refine" integration; this phase is where locks are actually fully respected during a genuine partial re-solve, and where the "identify the minimal affected region, don't regenerate the whole timetable" capability the original spec calls a "major product capability, not an edge feature" gets built for real.

## 1. Affected-region identification

- Given a change event (a teacher marked absent for specific periods, a room marked unavailable, a new `TeachingRequirement` added, a period removed, a school event added blocking specific slots), compute the actual minimal set of affected `TimetableSession`s — not "everything downstream," genuinely just what the change touches (the original spec's worked example: a teacher unavailable Wednesday affects 3 specific sessions out of a whole school's worth, ~97% of the timetable is untouched).
- This reuses T4/T5's Constraint Builder — a change event is really just "one more hard constraint became true/false for a specific slot," and the affected region is exactly the set of sessions whose validity that constraint change touches.

## 2. Partial re-optimization

- Freeze every session NOT in the affected region (including everything under an active `TimetableLock`, fully respected this time — not the minimal T7 integration) and re-run T5's solver (greedy placement + SA refinement) scoped to ONLY the affected region.
- Validate the patched result (T4's existing validator, unchanged).
- Publish as a new `TimetableVersion` (parent = the version being patched, `changeReason` = the triggering event) via T7's version-lineage machinery — never an in-place mutation.

## 3. Trigger surface

- A `POST /api/timetable/what-if` `{versionId, changeEvent: {type, ...}}` endpoint — `type` covers at minimum: `TEACHER_UNAVAILABLE`, `ROOM_UNAVAILABLE`, `REQUIREMENT_ADDED`, `REQUIREMENT_CHANGED`, `PERIOD_REMOVED`, `EVENT_BLOCKING_SLOTS`.
- Returns the same shape T4/T5's generation endpoints already return (draft entries + diagnostics if infeasible) for the affected region only, plus a summary (`affectedSessionCount`, `unaffectedSessionCount`, `affectedCohorts[]`) so the admin can see at a glance how contained the change is — this is the "97% untouched" reassurance from the original spec's own framing, make it visible, not just true.
- Admin reviews and approves the patch through the same review-then-publish flow T7 already built — no new approval mechanism, reuse what's there.

## Ground rules
Same rigor as every phase: additive migrations if needed, extend `server/src/modules/timetable/`, zod validation, `requireRole()`, `HttpError`, `audit()`, reset-cleanup blocks, full `tsc`/`npm test` gate clean, no git commands, no `/admin/reset`/`/admin/load-sample-data` except a final verification step.

**Critical regression requirement**: every prior phase's endpoints keep working; T7's manual-edit override system stays the primary "just fix this one thing by hand" path for small changes — this phase's what-if engine is for changes that ripple (an absence, a room going down), not a replacement for T7's direct editing.

**Live verification required**: mark a real teacher unavailable for specific periods on a real committed timetable, trigger what-if, confirm the affected-region summary correctly identifies only the truly-touched sessions (not the whole timetable), confirm every session under an active T7 lock was genuinely untouched by the re-solve, confirm the patch publishes as a proper new version with correct lineage back to the parent.

**Testing bar** (per roadmap D9): live UI verification for the what-if trigger flow and the affected-region summary display.
