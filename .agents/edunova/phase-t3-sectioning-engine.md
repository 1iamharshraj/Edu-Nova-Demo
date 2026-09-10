# Phase T3 — Sectioning Engine

Third phase of the Advanced Timetable Generation project (`advanced-timetable-roadmap.md` — read in full, especially D2, D5). Read `phase-t1-timetable-foundations.md` too — this phase's `Cohort`/`TrackEligibilityRule` machinery builds directly on T1's `Cohort` model (now live). The Sectioning Engine is explicitly OPTIONAL and decoupled from timetable generation (T4+) — a school that never touches this keeps working exactly as today; `Cohort` (T1) is the only thing later phases actually depend on, and it's already populated (1:1 per `Class`) with zero configuration.

## 1. Bands

- `PerformanceBand { id, schoolId, academicYearId, label, minScore, maxScore }` — neutral labels only (e.g. "Band A/B/C"), never auto-surfaced as "slow/average/topper" anywhere in UI/reports/notifications.
- `scoreSource` config (per template, not global): `LATEST_EXAM | EXAM_AVERAGE | CUSTOM_WEIGHTING` (subject weights) — reuse whatever real assessment/marks data already exists (Phase 3's `Assessment`/`Mark` models) as the actual score source; don't invent a parallel scoring concept.

## 2. SectioningTemplate — 5 original strategies + SKIM_THEN_BALANCE

- `SectioningTemplate { id, schoolId, academicYearId, gradeId, name, strategy (BALANCED|RANKED|BANDED|STRATIFIED_CAPPED|RANDOM_PARITY|SKIM_THEN_BALANCE), scoreSource, subjectWeights (json, if CUSTOM_WEIGHTING), bandIds[], distributionConfig (json, strategy-specific), sectionOrder (string[], fill order), respectExisting (bool) }`.
- Implement all 6 strategies exactly per the original spec's descriptions (BALANCED = per-band percentage mix per section with largest-remainder rounding; RANKED = sort+fill-to-capacity in order; BANDED = split into 2-3 broad bands first then BALANCED within each; STRATIFIED_CAPPED = BALANCED with hard per-band caps; RANDOM_PARITY = random then validate-and-swap until band mix is within tolerance; **SKIM_THEN_BALANCE** = `skim: [{sectionId, countOrPercentage}]` removed from the pool first, then `remainderStrategy` (any of the other 5, most commonly BALANCED or RANKED) runs on what's left — implement this as a genuine composition, calling the remainder strategy's own function on the filtered pool, not a duplicated algorithm).

## 3. Track/Stream two-stage pipeline (JEE/NEET etc.)

**Stage 1 — track assignment**: a track is just a `Cohort` (T1, type=TRACK) spanning the relevant base classes. Track membership is captured via a choice+eligibility flow:
- Reuse the existing `Activity`/`ActivityRegistration` capacity+waitlist pattern (Phase 8, already shipped) for the choice-collection step — a track is registerable like a club/house, with `capacity` and automatic waitlist promotion, rather than inventing new preference-allocation machinery. Confirm this reuse is clean (check `Activity.kind` extensibility) before building a parallel mechanism.
- `TrackEligibilityRule { id, schoolId, trackActivityId, subjectScoreRules (json: [{subjectRef, minScore}] — subjectRef can point to a real Phase 3 `Subject` for continuing students, matching T2's PriorSubjectScore shape for external admits), enforcementMode (STRICT|ADVISORY) }`. **`enforcementMode` is a simple per-rule toggle, nothing more elaborate (per D5 — "as simple as that").**
- On a track registration that fails eligibility: STRICT mode rejects the registration outright (clear error naming the unmet threshold); ADVISORY mode allows it through but flags it. Either way, an authorized role (configurable — default staff/admin) can force an override with a **mandatory reason**, captured in `audit()`. Do not build a structured taxonomy of override reasons — free text + approver identity is sufficient (per the roadmap's own reasoning on this point).
- **Exceptions report**: `GET /sectioning/track-eligibility-exceptions?trackActivityId=` — every override this term, with reason + approver, surfaced plainly (visibility, not policing) — a real, useful report for an academic head, not a buried audit-log query.
- Membership in a track `Cohort` defaults `respectExisting=true` across terms (continuity — coaching batches shouldn't reshuffle every term the way junior-grade sections might) — a mid-year track switch is a manual, audited move using the same mechanism as any other individual reassignment (§4 below), not a special case.

**Stage 2 (optional)** — within a track's population, run any `SectioningTemplate` from §2 scoped to just that track's cohort members (e.g. "JEE-A"/"JEE-B" merit sub-sections within JEE aspirants) — this is just §2's engine invoked with a filtered input population, not new logic.

## 4. Flow, validation, versioning, movement

- Deterministic pipeline exactly as the original spec's diagram: admin picks template → engine computes scores/bands → strategy runs → draft assignments → **validation** (capacity not exceeded, every student assigned exactly once, band mix within tolerance, optional siblings-together check — reuse T2's sibling-lookup logic from Admissions, don't reimplement) → admin reviews and approves (never write invalid assignments) → `section_id` written on each student, `Cohort` membership updated → versioned (`SectioningVersion`, diffs stored).
- Edge cases per the original spec: deterministic tie-breaker for score ties (documented, e.g. roll-number as secondary sort), largest-remainder allocation for uneven percentage splits, underfilled/overfilled validation warnings (admin proceeds or forces rebalance), an "unscored" pool for students with no exam history routed to manual admin placement.
- **Movement is a feature, not a bug**: individual student moves (mid-term rebalance, a single reassignment) are audited edits, not full re-versioning — support both cleanly.

## Ground rules
Same rigor as every other phase: additive migrations, `server/src/modules/sectioning/{router,service,schema}.ts`, zod validation, `requireRole()`, `HttpError`, `audit()` on every write (template runs, approvals, individual moves, eligibility overrides — this touches real student placement, treat it with the seriousness already established for money/HR actions elsewhere in this app), reset-cleanup blocks, full `tsc`/`eslint`/`npm test` gate clean, no git commands, no `/admin/reset`/`/admin/load-sample-data` except a final verification step.

**Live verification required**: run a real BALANCED sectioning pass and a real SKIM_THEN_BALANCE pass against seeded students with real marks, confirm the band-mix validation catches an intentionally-broken config, run a real track-registration flow that deliberately fails a STRICT eligibility rule (confirm rejection) and one that fails an ADVISORY rule (confirm it's allowed through but flagged), confirm an authorized override with a reason succeeds and shows up in the exceptions report.

**Testing bar** (per roadmap D9): live UI verification in a real browser for the template configuration screen and the draft-review-before-approve screen specifically — these are dense, high-stakes screens (this literally places real students into real sections) where the UI needs to make the validation warnings and band-mix preview genuinely legible, not just technically present.
