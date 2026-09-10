# Phase T9 — Substitution Workflow

Ninth phase of the Advanced Timetable Generation project (`advanced-timetable-roadmap.md` — read in full, especially D6). Read T8's shipped what-if engine THOROUGHLY first — a substitution's uncovered periods fall back to it. Read this app's EXISTING `LeaveRequest`/`LeaveType` model (Phase 6, HR, already shipped) and the existing `Substitution` model (Phase 2, already shipped, used by the current manual timetable) THOROUGHLY before writing anything — per D6, this phase EXTENDS the existing leave model, it does not fork a parallel one.

## 1. Substitution selection-mode policy (D6)

- `SubstitutionPolicy` — a school-level setting: `TEACHER_INITIATED | ADMIN_ASSIGNED | HYBRID`. `TEACHER_INITIATED` = the absent teacher picks their own substitute and sends a request (the original spec's full flow). `ADMIN_ASSIGNED` = staff/admin picks directly from the ranked Substitute Finder list (§2) with no teacher-to-teacher request/accept round-trip. `HYBRID` = teacher suggests, admin makes the final call. The Substitute Finder eligibility/ranking engine (§2) is identical across all 3 modes — only who triggers it and who has final say changes.
- **Minimum-notice-period policy**: `minNoticeHoursForSubstitution` (school-configurable). A `LeaveRequest` submitted with less notice than this skips the pre-arranged-substitution workflow entirely and goes straight to admin emergency assignment (still via the same Substitute Finder ranking, just without the teacher-to-teacher accept round-trip — there isn't time for it).

## 2. Substitute Finder (reuses T4's Constraint Builder/Validator directly)

- Given a teacher's absence (specific periods on a specific date), find eligible substitutes using the EXACT SAME hard-constraint machinery T4/T5 already built (no collision, availability from T1's `TeacherAvailability`, qualified via T1's `TeacherQualification`, workload limits) — not a separate heuristic reimplementing these checks.
- Cross-subject substitution allowed only if school policy permits it (a config flag, default false).
- Ranking (soft, scored, same spirit as T5's Mode 4 optimizer): qualification match, same department/subject, workload balance, avoids creating a 4th/5th consecutive period, avoids teacher gaps, class suitability/preferences. Default weights from the original spec's table (qualification 40%, same subject 20%, availability fit 15%, workload headroom 10%, avoids-consecutive-load 5%, preference 5%, class suitability 5%) — configurable, not hardcoded, reuse T5's `Preference`-table pattern.
- Candidates failing any hard constraint are excluded before scoring — the score only orders survivors.

## 3. Data model additions

- `LeaveRequest` (EXTEND the existing model, don't fork): add `status` value `PENDING_SUBSTITUTION` in the lifecycle before `SUBMITTED`.
- `SubstitutionRequest { id, leaveRequestId, originalTeacherId, substituteTeacherId, periods[], status (SENT|ACCEPTED|DECLINED|EXPIRED), acceptedAt, expiresAt }`.
- `PeriodHold { id, teacherId, periodRef (day/date + periodIdx + termId), holdType (TENTATIVE|LOCKED), sourceSubstitutionRequestId, expiresAt }` — the race-condition guard from the original spec: `TENTATIVE` on substitute-accept, only promoted to `LOCKED` on the teacher's leave being ADMIN-APPROVED (never before — this is the same invariant already correctly implied by T7's lock model, reuse `TimetableLock` for the LOCKED state rather than inventing a second locking concept if that's a clean fit, otherwise keep them separate and document why).
- Tentative-hold auto-expiry after a configurable duration, so a dead request doesn't block a teacher's availability indefinitely.

## 4. Flow + edge cases

- Full flow exactly per the original spec: select leave periods → Substitute Finder suggests → teacher sends request (or admin assigns directly, per policy) → substitute accepts (tentative hold) → leave request submitted with substitution details attached → admin approves → hold becomes locked, timetable patched via T8's what-if engine, revalidated.
- **Partial substitution**: allow splitting — a substitute covers some periods, remaining periods fall back to T8's what-if flow.
- **No candidates or decline**: fall back to T8's what-if re-optimization for the uncovered periods, with a clear explanation of why no candidates existed (all busy / over workload / no qualified teacher).
- **Admin override**: force-assign a substitute who failed a soft constraint (never a hard one) with a mandatory audit note.
- **Chained absence**: if an accepted substitute later reports their own absence, their accepted substitutions surface as a new absence event re-entering this same flow, flagged as a substitution-backfill.
- **Validation runs twice**: at accept time (tentative hold placed, patch validated against hard constraints) and at publish time (after admin approval, before the patched version publishes via T7's flow).

## Ground rules
Same rigor as every phase: additive migrations (extending `LeaveRequest`, not forking), extend `server/src/modules/hr/` for the `LeaveRequest` changes and a new `server/src/modules/timetable/substitution.ts` (or similar) for the Finder/Request/Hold machinery — your call on the cleanest split, document it, zod validation, `requireRole()`, `HttpError`, `audit()`, reset-cleanup blocks, full `tsc`/`npm test` gate clean, no git commands, no `/admin/reset`/`/admin/load-sample-data` except a final verification step.

**Critical regression requirement**: the existing `LeaveRequest`/leave-approval flow (Phase 6) must keep working for leave that has nothing to do with a teacher/timetable (staff leave, non-teaching-period leave) — this phase only adds the substitution branch for teachers with covered periods, it doesn't change the base leave model's other uses.

**Live verification required**: run the full TEACHER_INITIATED flow end-to-end (request → suggest → send → accept → submit → approve → hold becomes lock → timetable patched); run ADMIN_ASSIGNED mode and confirm it skips the request/accept round-trip; submit a leave request with less than the configured minimum notice and confirm it correctly routes to emergency assignment; confirm a substitute accepting two overlapping requests is correctly prevented by the PeriodHold mechanism (the second acceptance rejected or queued); confirm a tentative hold auto-expires after its configured duration.

**Testing bar** (per roadmap D9): live UI verification for the full substitution request/accept/approve flow from both the requesting-teacher and the admin perspective.
