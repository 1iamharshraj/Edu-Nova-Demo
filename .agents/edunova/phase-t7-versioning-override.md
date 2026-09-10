# Phase T7 — Versioning + Locks + a Proper Management-Override System

Seventh phase of the Advanced Timetable Generation project (`advanced-timetable-roadmap.md` — read in full, especially D10 and D9). Read T6's shipped `TimetableSession`/`TimetableGenerationJob` code THOROUGHLY first. **The override system is the centerpiece of this phase**, per the user's explicit ask: once the solver retires Phase 26's old generator (T10), management needs a real, well-built, safe way to hand-adjust anything the new system produces — this is not an afterthought feature, it's what makes the retirement in T10 acceptable at all.

## 1. Version lineage

- `TimetableVersion { id, schoolId, academicYearId, termId, scopeCohortIds[], status (DRAFT|GENERATED|MODIFIED|APPROVED|PUBLISHED|ARCHIVED), parentVersionId, createdById, createdAt, generationJobId (nullable — a manually-created version has none), changeReason }`.
- Every `TimetableEntry` that this system's generation/commit path writes should be traceable to a `TimetableVersion` (add a nullable `timetableVersionId` to `TimetableEntry` if it doesn't already have an equivalent link after T6 — check T6's actual shipped schema first) — this is what makes lineage, diffing, and "revert to a prior version" possible.
- **Diffs stored where practical**: when a version is created as a modification of a parent (manual edit, or a partial-re-optimization result once T8 ships), compute and store a diff (which entries changed, from what to what) rather than requiring a full-entry-set comparison every time it's needed.

## 2. Enforced published-immutability

- No `UPDATE`/`DELETE` on a `PUBLISHED` `TimetableVersion` or its entries — enforced at the service layer AND the database layer (not merely a UI restriction). Any change to a published timetable must go through: modification request → new DRAFT version (parent = the published one) → MODIFIED → APPROVED → PUBLISHED (the old published version stays archived and fully intact, never touched).
- Implementation choice is yours (status-checked write path, a trigger, row-level security) — the invariant (never mutate a published version) is absolute and must be tested explicitly: attempt a direct write against a published version's entries and confirm it's rejected at the service layer even if a caller tries to bypass the normal API flow.

## 3. Generic TimetableLock

- `TimetableLock { id, timetableVersionId, lockType (SESSION|TEACHER|ROOM|COHORT|DAY|PERIOD|ASSIGNMENT), targetType, targetId, dayOfWeek (nullable — set for slot-level locks), periodIdx (nullable), reason, createdById, createdAt }` — exactly as the original spec's examples describe (a whole-day lock is a different constraint from a specific teacher-assignment lock, from a specific slot lock — the schema must represent all of them). T8 (partial re-optimization, not this phase) is what actually reads and respects these during a re-solve — this phase just builds the lock model and the UI to set/clear locks; wire enough into T4/T5's existing solver so a locked session/slot is never touched by a regenerate in the meantime (a full "respect every lock type during solving" integration can be minimal here, `full-regenerate`/`refine` just need to skip anything with an active lock in scope).

## 4. The management-override system (centerpiece — build this with real care)

This is what replaces Phase 26's existing manual-edit path in Timetable Builder once T10 retires it. Requirements, all non-negotiable per the roadmap's D10:

- **Move / swap / lock / unlock / regenerate-this-slot / undo** — a real, complete set of hand-edit actions on a generated/committed timetable, not just "move one entry."
- **Live, real-time conflict detection AS THE ADMIN EDITS** — not just revalidation after save. Reuse the exact 409+`conflicts[]` response convention this app has used consistently for timetable/exam-clash conflicts since Phase 2 — do not invent a new error shape. The frontend must surface this inline the moment a proposed change would create a teacher/room/cohort double-booking, before the admin commits to it, not as a surprise after clicking save.
- **Every override is audited**: who, when, what changed (before/after), and — where the admin provides one — why. This is not optional logging, it's the actual safety record that makes "management can always fix what the solver got wrong" a trustworthy claim rather than a hope.
- **Undo**: at minimum, undo-the-last-change within an editing session; ideally, revert-to-any-prior-point-in-this-version's-edit-history using the diff data from §1.

## Ground rules
Same rigor as every phase: additive migrations, extend `server/src/modules/timetable/`, zod validation, `requireRole()` (admin, matching existing timetable-edit RBAC), `HttpError`, `audit()` on every override action, reset-cleanup blocks, full `tsc`/`npm test` gate clean, no git commands, no `/admin/reset`/`/admin/load-sample-data` except a final verification step.

**Critical regression requirement**: every prior phase's generate/commit/refine/session endpoints must keep working. Phase 26's original manual-edit UI in Timetable Builder should be the actual UI this phase upgrades in place (extending it with live conflict detection and the lock/undo affordances) — not a parallel new editing surface competing with the existing one.

**Live verification required, not optional**: attempt a hand-edit that would create a genuine teacher double-booking and confirm the UI catches it live, before save, with the real conflicts[] detail; attempt a direct write against a PUBLISHED version's entries (bypassing the normal flow if possible) and confirm it's rejected at the service layer; set a lock on a specific slot, then attempt to edit that locked slot and confirm it's blocked with a clear message; perform a real undo and confirm it correctly reverts; confirm every one of these actions produced a real, inspectable audit log entry.

**Testing bar** (per roadmap D9): live UI verification for the entire editing experience — this is the screen a school will use constantly, more attention here than almost any other screen in the project.
