# Phase 18 — Syllabus & Teaching Progress Tracking

This is the foundation for several later phases (AI tutor scoping in Phase 20, the board-exam readiness dashboard in Phase 25, early-warning signals in Phase 19) — get the data model right here.

## Design decisions (made now, not left to the implementing agent)

1. **Syllabus lives on `CurriculumSubject`** (board × grade × stream × subject), not on `ClassSubject` or `Class`. Defined once, every section of that board/grade/subject inherits the same chapter list automatically — this is the whole point of doing it here instead of per-class.
2. **Chapter is the tracked unit; topics under a chapter are optional free text**, not a separate tracked entity. Topic-level tracking is where these systems become bureaucratic box-ticking — resist the urge to build it as a first-class model.
3. **Progress is self-reported by the teacher, no separate verification step.** A class-teacher/HOD "acknowledge" step was considered and rejected for v1 — it adds friction without much value, and management can already see the data directly. Note this as a deliberate choice; a verification layer can be added later if a school actually asks for it.
4. **No starter/pre-loaded NCERT syllabi in this phase.** Real, valuable idea, but it's a content-maintenance commitment (board syllabi change periodically) that shouldn't block this phase. Admin/HOD builds the chapter list by hand, same "blank, admin builds everything" philosophy the multi-board rebuild used. Note it as a clearly-flagged future enhancement, not a gap to silently skip past.
5. **No new HOD/subject-coordinator role in this phase.** Syllabus/chapter management is staff/admin/superadmin (matching curriculum-management RBAC elsewhere) plus the specific teacher(s) assigned to that class-subject for progress updates. A dedicated HOD role is a reasonable future addition but out of scope here — don't invent a new role for one feature.

## Data model

- `SyllabusChapter { id, schoolId, curriculumSubjectId, order (int), title, estimatedPeriods (int), examWeightagePct? (float, optional) }` — ordered chapter list per curriculum-subject. `@@unique([curriculumSubjectId, order])`.
- `ChapterProgress { id, schoolId, classSubjectId, chapterId, status (NotStarted | InProgress | Done), startedAt?, completedAt?, notes?, updatedById }` — one row per (class-subject, chapter) — this is where X-A and X-B's pace diverges even though they share the same `SyllabusChapter` list. `@@unique([classSubjectId, chapterId])`.
- `TermSyllabusTarget { id, schoolId, curriculumSubjectId, termId, targetChapterId (the chapter that should be reached by term end), classId? (nullable — a school-wide target for the curriculum-subject, OR a specific class override) }` — management/staff sets these; nullable `classId` means "applies to every class teaching this curriculum-subject unless a class-specific override exists."
- `ChapterResource { id, schoolId, chapterId, fileId (→ existing File model), label, uploadedById, createdAt }` — the shared per-chapter teaching-resource library (lesson plans, worksheets, slides), reusing the existing file-upload infrastructure, visible to every teacher who teaches that curriculum-subject anywhere in the school.
- On `Assessment` (existing model): add `chapterIds String[]` (or a join table `AssessmentChapter` if the codebase's Postgres/Prisma setup makes an array column awkward — check existing conventions for string-array fields like `Activity.forRoles` first and match whatever pattern is already used) — links an assessment to the chapters it covers, enabling the coverage-vs-actually-learned report.

## Computed views (the part that makes this more than a checklist)

- **Expected pace**: for a given class-subject and "as of" date, compute `scheduledPeriodsSoFar` from real `TimetableEntry` rows for that class-subject between the term start and the as-of date, **minus periods lost to**: (a) `CalendarEvent` rows with `type: 'holiday'` on a scheduled day, (b) the assigned teacher's own leave/absence on that date (cross-reference `StaffAttendance`/approved `LeaveRequest`), (c) any `Substitution` where the period didn't actually run (check what data is actually available for this — if substitution data doesn't cleanly indicate "period ran vs. was cancelled," treat every valid `Substitution` as a period that DID run with a different teacher, only count genuinely missing periods as lost, and document this assumption clearly). Divide `scheduledPeriodsSoFar` by the sum of `estimatedPeriods` for chapters up to a candidate chapter to derive "you should be around chapter N."
- **Lost-periods count**: expose this as its own number (scheduled periods this term minus periods actually deliverable per the calculation above) — it's independently useful (feeds Phase 19's lost-instructional-time report) even without the pace-comparison framing.
- **Coverage-vs-learning**: for chapters marked `Done` with at least one linked, published `Assessment`, show the class average score on that assessment next to the completion date — surfaces "chapter marked done, but the class scored 40%" as a distinct signal from "chapter marked done, scored 85%."

## Endpoints

- `/api/syllabus/chapters?curriculumSubjectId=` — CRUD, staff/admin/superadmin write (matches curriculum RBAC), everyone read.
- `/api/syllabus/chapter-resources` — upload/list/delete per chapter, teacher (of that curriculum-subject anywhere in the school)/staff/admin write, everyone who teaches that subject can read.
- `/api/syllabus/progress?classSubjectId=` — `GET` (progress for every chapter of that class-subject, joined with the chapter list so untouched chapters show as `NotStarted` even with no row yet), `PATCH` per chapter (status/notes/dates) — write restricted to the assigned teacher(s) of that specific `ClassSubject` (reuse the exact scoping tightened in the Phase 10 audit fix — a teacher can only write progress for a class-subject they're actually assigned to, not any class-subject in a class they're peripherally connected to) plus staff/admin/superadmin.
- `/api/syllabus/targets` — CRUD, staff/admin/superadmin only.
- `GET /api/syllabus/pace/:classSubjectId?asOf=` — the computed expected-pace view described above.
- `GET /api/syllabus/coverage/:classSubjectId` — the coverage-vs-learning view.

## Frontend

- **Curriculum screen extension** (admin/staff, likely a new tab/section on the existing Curriculum module): manage chapters per curriculum-subject — add/reorder/edit, with estimated periods and optional exam weightage.
- **A "Teaching Progress" screen for teachers**: their assigned class-subjects, each showing the chapter list with status toggles, a visible pace indicator ("Chapter 6 of 14 — on pace" / "behind by ~2 chapters, adjusted for 5 lost periods"), and per-chapter resource upload/browse.
- **A management-facing "Syllabus Overview" screen** (staff/admin): every class-subject's pace at a glance, term-target setup, and the coverage-vs-learning view for completed chapters.
- Sample data: a real chapter list for at least 2-3 curriculum-subjects (e.g. CBSE Class X Mathematics — genuinely use a real, sensible chapter breakdown, not "Chapter 1, Chapter 2..." placeholders), progress at different stages across the seeded classes (one class ahead, one behind, one on pace), a term target, a couple of chapter resources, and at least one assessment linked to a completed chapter to demonstrate the coverage view.

## Ground rules
Same as every previous phase: additive migrations, `server/src/modules/syllabus/{router,service,schema}.ts` pattern, zod validation, `requireRole()`/existing scope helpers, `HttpError`, `audit()` on mutations, add a Phase 18 cleanup block to `POST /reset`, no git commands, no `/admin/reset`/`/admin/load-sample-data` except your own final step, server/frontend split with Portal.tsx changes described-not-made by the frontend agent, full tsc/eslint/87-test verification, live curl+UI verification — specifically verify the pace calculation produces a sane number against real seeded timetable/holiday/leave data (don't just check it returns *a* number, check the arithmetic is actually right by computing it by hand against the seed data and comparing), and verify the class-subject-scoped write restriction (a teacher cannot update progress for a class-subject they're not assigned to — this exact class of bug was the Phase 10 audit's critical finding, don't reintroduce it here).
