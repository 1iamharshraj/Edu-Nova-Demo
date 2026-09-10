# Phase T10 — Migration & Integration Pass

Tenth phase of the Advanced Timetable Generation project (`advanced-timetable-roadmap.md` — read in full). This is the last active phase before T11 (deferred per D8). Unlike T1-T9, this phase is not primarily new capability — it's an audit + retirement + regression pass. Read every phase's "DONE" summary in the roadmap first (T0-T9) for the full picture of what now exists before touching anything.

## 1. Reconcile every existing `TimetableEntry` consumer

A grep-verified inventory of real consumers outside `server/src/modules/timetable/` as of this phase (confirm this is still accurate — code may have moved):
- `server/src/modules/attendance/service.ts`
- `server/src/modules/syllabus/service.ts` (Phase 18 syllabus pace)
- `server/src/modules/analytics/service.ts` (Phase 19 analytics)
- `server/src/modules/exams/service.ts` (Phase 25 exam-clash detection)
- `server/src/modules/periodTemplates/service.ts`
- `server/src/modules/admin/router.ts` (reset/load-sample-data cleanup ordering)
- `server/src/routes/users.ts`
- `server/src/modules/substitutions/service.ts` and `schema.ts` (T9's own — already reconciled with T6/T8's session/version model, use as a reference example of "done right")

For each: confirm it correctly handles entries that carry `sessionId`/`timetableVersionId` (T6/T7 additions) and entries that don't (legacy/simple entries) — nothing should silently misbehave on either shape. Confirm none of them assume "every entry has exactly one teacher/room with no possibility of a same-day one-off `Substitution` override" where that assumption would now be wrong (e.g. an attendance or analytics view that should reflect T9's one-off substitute for a specific date, not just the recurring `TimetableEntry.teacherId`). If a consumer doesn't need substitution-awareness (e.g. syllabus pace, which is about content covered, not who taught it), explicitly note that as a reasoned non-issue rather than silently skipping it. **Hostel roll-call and a distinct "teacher/parent view" were mentioned in the original planning spec but were NOT found in a grep of the current codebase — verify whether they exist under different names before concluding they don't; if they genuinely don't exist yet, note that and move on, don't invent them.**

## 2. Retire Phase 26's simple generator

- Confirm T7's override system (management hand-edit + live conflict warnings + locks + undo) and T4-T8's generate/review/publish/what-if flow genuinely cover everything the old "Auto-Generate" button in Timetable Builder did.
- Remove the old simple-generator entry point from the Timetable Builder UI — the generation+review+override flow built across T4-T8 becomes the only path. Confirm the old `autogen.ts` code that T4/T5 built ON TOP OF (not replaced — re-read T4's summary: "reuses the occupancy-map pattern... as-is for the new initial-solution stage") is NOT deleted, since T4/T5's solver still calls into it internally; only the standalone old *UI entry point and any now-dead standalone code path* that bypassed the new session/version pipeline should go.
- Grep for any remaining direct writes to `TimetableEntry` that don't go through T6's session-aware path or T7's version/publish path (other than T9's intentional one-off `Substitution` rows, which are correctly a separate model) — these would be leftover legacy write paths that should now be removed or routed through the new system.

## 3. Full regression pass

Mirror the project's earlier full-system-regression-audit pattern (see `full-system-regression-2026-09-09.md` for the shape of that pass, if useful as a reference for format — don't just copy it, this is a different, narrower scope). At minimum, live-verify: attendance taken against a class on a day with a T9 substitution reflects reality correctly; syllabus pace tracking is unaffected; analytics dashboards don't error or show stale/wrong numbers; exam-clash detection still correctly detects a real clash against the current timetable; nothing in `server/src/routes/users.ts`'s use of timetable data broke.

## Ground rules
Same rigor as every phase: additive migrations only if truly needed (this phase should mostly not need new tables — it's reconciliation, not new modeling). zod validation, `requireRole()`, `HttpError`, `audit()` conventions for anything you do add or change. Full `tsc`/`npm test` gate clean (backend was 339/339 clean before this phase — note the new total, it may DECREASE if dead code/tests for the retired generator UI path are legitimately removed, that's fine if explained). No git commands. No `/admin/reset`/`/admin/load-sample-data` except a final verification step.

**Critical regression requirement**: every prior phase's endpoints and UI keep working. This phase removes exactly one thing on purpose (Phase 26's standalone Auto-Generate UI entry point) and must not silently break anything else while doing it.

**Live verification required**: confirm Timetable Builder no longer offers the old standalone Auto-Generate button/flow (or if kept as a clearly-labeled legacy fallback for some documented reason, explain why); confirm the new flow (T4-T8) is the only path and works end-to-end from empty to published; confirm attendance/syllabus/analytics/exams all still function correctly against real timetable data, including a case involving a T9 substitution.

**Testing bar** (per roadmap D9): live UI verification, not just API testing — actually use Timetable Builder in the browser (or via the established live-API-exercise fallback used by T9's frontend agent, if no browser tool is available) and confirm the removed old flow is genuinely gone and nothing else regressed.

**Honesty requirement** (established pattern for this entire project): if something in §1's original-spec-mentioned consumers (hostel roll-call, teacher/parent views) turns out not to exist, say so plainly rather than either fabricating a fix for a non-problem or silently ignoring the mismatch between the original plan and current reality.
