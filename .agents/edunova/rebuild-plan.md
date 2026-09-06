# EduNova — End-to-End Rebuild Plan

> Written: 2026-09-07 · Status: proposed, not started
> Audit baseline: of ~55 features, 6 are end-to-end; the rest are partial, seed-only, fake, or missing. See the audit summary at the bottom.

## Goal

Turn the demo into real school-management software: a school starts **empty** (one school, one superadmin), and every class, subject, timetable, student, fee, and payslip is created through the admin UI and flows correctly to every other role. Demo data becomes an optional "Load sample school" action, never the default.

## Ground rules (apply to every phase)

1. **Server is the source of truth.** Every entity gets its own Prisma table and REST endpoints (`GET/POST/PATCH/DELETE`). The JSONB `SchoolData` blob shrinks each phase and is deleted in Phase 10.
2. **Authorization lives on the server.** Every route checks role + ownership (a teacher can only mark attendance for classes they teach; a parent only sees their wards). The client hides buttons; the server enforces.
3. **No string joins.** Relations use ids (`studentId`, `classId`), never `name === name`. Every hardcoded `'Aarav Sharma'`, `'X-A'`, `'t3'`, `'₹6,500'` is removed.
4. **No cosmetic actions.** A button either writes to the database or it doesn't exist. Fake OTP/biometrics/AI-call simulation/bot replies are removed or replaced with real integrations.
5. **Full lifecycle or nothing.** Every entity the admin creates can be edited and deleted (soft-delete where history matters: users, invoices, marks).
6. **Definition of done per phase:** (a) empty-school walkthrough passes — admin creates the data from scratch and each affected role sees it; (b) `tsc` + lint clean; (c) API integration tests for the new routes; (d) `current-state.md` updated.

## Phase overview

| # | Phase | Unlocks | Est. effort |
|---|---|---|---|
| 0 | Reset & conventions | Safe empty start, migration pattern | 1–2 days |
| 1 | Academic structure | Years, terms, classes, subjects, rooms, people links | 4–5 days |
| 2 | Timetable | Per-class builder with conflict detection | 3–4 days |
| 3 | Attendance & assessment | One attendance model, per-student marks, real ranks | 5–6 days |
| 4 | Admissions & identity | Admission→accounts, certificates, password/profile, audit | 3–4 days |
| 5 | Finance | Fee structures → invoices → payments; payroll from contracts | 5–6 days |
| 6 | HR | Leave, resignation, contracts, duties — real submission paths | 3 days |
| 7 | Communication | Feed authoring, real messaging, notifications, meetings | 5 days |
| 8 | Student welfare & compliance | Health, slips, achievements, discipline, reports — per student | 3–4 days |
| 9 | Integrations & AI | Real AI doubt-clearing, telephony or removal, media CMS | 3–5 days (optional) |
| 10 | Hardening & launch | Tests, RBAC matrix, deployment, backups, docs | 4–5 days |

Total: roughly 8–10 weeks of focused single-developer work. Phases 1→2→3 are strictly sequential; 4–8 can partly overlap once 3 is done.

---

## Phase 0 — Reset & conventions

**Goal:** an empty school boots and works; there's one consistent way to add an entity.

**Backend**
- Seed becomes: one `School`, one superadmin (`principal@…`, forced password change on first login). Nothing else.
- Add `POST /api/admin/load-sample-data` (superadmin only) that loads the current demo dataset on demand — replaces the implicit seed.
- Establish the per-entity module pattern in `server/src/modules/<entity>/{router,service,schema}.ts` with zod validation and a `requireRole()` / `requireOwnership()` middleware pair. Phases 1–8 copy this pattern.
- Add `AuditLog` table (actorId, action, entity, entityId, before/after JSON, at). Services write to it; superadmin can view it (UI in Phase 4).

**Frontend**
- Replace the "reset demo data" sidebar button with a superadmin-only Settings → Danger Zone card with a typed confirmation.
- Add `src/lib/api.ts` (typed fetch client) and `src/lib/hooks/useEntity.ts` (list/create/update/delete with optimistic updates). New modules use hooks, not `update(fn)`.
- Every screen must render sensibly with zero data (empty states with a "create the first…" CTA that deep-links to the admin screen).

**Delete:** `HIGHLIGHTS` Rickroll constant; hardcoded Overview tiles (`'₹6,500'`, `'#3'`, `'₹1.2Cr'`, `'95.5%'`); the "Did you know: timetable propagates" copy.

**Done when:** fresh DB → login as superadmin → every module opens without errors and shows an empty state.

---

## Phase 1 — Academic structure (foundation)

**Goal:** the admin can define the school's shape: years, terms, classes, sections, subjects, rooms, and who teaches what.

**Data model (Prisma)** — amended by `phase-1b-boards-curriculum.md`: schools run several boards (CBSE/ICSE/State/IGCSE/IB), span LKG–XII, and subjects/books/streams vary per board and grade, so the curriculum is modelled per board × grade (× stream) and a class belongs to exactly one board.
```
AcademicYear       id, schoolId, label "2026-27", startDate, endDate, isCurrent
Term               id, academicYearId, name, startDate, endDate, isCurrent
Board              id, schoolId, name, code "CBSE"                                   (a school can run several)
Grade              id, schoolId, label "LKG"…"XII", order                             (the ladder)
Stream             id, schoolId, name "Science"                                       (XI–XII, optional)
Subject            id, schoolId, name, code, color                                    (board-agnostic catalogue)
CurriculumSubject  id, boardId, gradeId, streamId?, subjectId, kind core|elective|language, textbook?
Class              id, schoolId, academicYearId, boardId, gradeId, streamId?, section, classTeacherId?, capacity
                   unique(year, board, grade, section) — CBSE X-A and ICSE X-A coexist
ClassSubject       id, classId, subjectId, teacherId, periodsPerWeek   (seeded from the class's curriculum; unique classId+subjectId)
Room           id, schoolId, name, kind (classroom|lab|ground|hall), capacity
Enrollment     id, studentId, classId, academicYearId, rollNo, status  (unique studentId+academicYearId)
Guardian       id, parentId, studentId, relation                      (many-to-many parent↔student)
User           drop free-text class/section/roll/subjects fields; keep profile fields
```

**API**
- CRUD for all of the above under `/api/academic/*`; `PATCH /api/academic/years/:id/set-current`.
- `POST /api/classes/:id/promote` (Phase 4 uses it): moves enrollments to the next grade/year.
- Users: `POST /api/users` fixed so every creation goes through it (PeopleMod currently pushes into the blob and doesn't survive reload); student creation requires a `classId`; parent creation requires ≥1 `studentId`.

**UI (admin/superadmin) — new "Academic Setup" group**
- Academic Years & Terms: list/create/edit/delete, set current.
- Boards & Grades: boards the school runs, the grade ladder (ordered), streams.
- Curriculum: subject catalogue + per board → grade → stream subject list with kind and textbook. No templates — built by hand.
- Classes & Sections: create as board + grade (+ stream) + section; roster; class teacher; "Subjects & teachers" per class (rows seeded from the curriculum, teacher + periods/week, sync from curriculum).
- Rooms: CRUD.
- People (rewrite): student form picks class from dropdown; parent form picks wards; teacher form shows the classes/subjects they're assigned (from `ClassSubject`), not a free-text list.

**Migrations of existing screens**
- `TermTabs` reads terms from the API filtered to the current year.
- Every `u.class === user.class` comparison becomes an `Enrollment`/`ClassSubject` lookup.
- Teachers directory (`db.directory`) deleted; derived from users + `ClassSubject`.

**Done when:** empty school → create year → 3 terms → class X-A → 6 subjects → assign teachers → add a student and parent → parent logs in and sees the child's class; teacher sees X-A in their classes.

---

## Phase 2 — Timetable

**Goal:** admin builds a timetable per class per term; each role sees their own view; conflicts are prevented.

**Data model**
```
PeriodTemplate  id, schoolId, name "Default", periods: [{idx, label, start, end, kind: class|break}]
TimetableEntry  id, classId, termId, dayOfWeek(1-6), periodIdx, classSubjectId, roomId?, teacherId (denorm from classSubject, overridable for substitutions)
                unique (classId, termId, dayOfWeek, periodIdx)
Substitution    id, timetableEntryId, date, substituteTeacherId, reason
```

**API**
- `GET /api/timetable?classId&termId` · `GET /api/timetable/teacher/:id?termId` · `PUT /api/timetable/entries` (bulk upsert) · `DELETE /api/timetable/entries/:id`.
- Server-side conflict validation on write: teacher double-booked in the same day/period; room double-booked. Returns structured 409 with the conflicting entries.
- `POST /api/timetable/copy` (from one term/class to another).

**UI**
- Admin "Timetable Builder": pick class + term; grid of days × periods; click a cell → choose subject (only this class's `ClassSubject`s; teacher auto-filled) + room; live conflict badges; "copy from…" action; publish/unpublish toggle (unpublished = invisible to students).
- Period template editor (admin): define period times and breaks once; replaces the hardcoded `TIMESLOTS`.
- Student/parent: their class's grid (existing readable-card layout from the current fix, now data-driven).
- Teacher: cross-class personal timetable (all their entries across classes), with substitutions highlighted.
- Overview "next class" tile computed from the real timetable + current time.

**Done when:** admin builds X-A's timetable; student sees it; teacher sees only their periods; assigning the same teacher to two classes in the same period is rejected with a clear error.

---

## Phase 3 — Attendance & assessment

**Goal:** one attendance system and per-student marks, with ranks and reports derived from real data.

**Data model**
```
AttendanceSession   id, classId, date, periodIdx?, markedById, lockedAt?          (unique classId+date+periodIdx)
AttendanceRecord    id, sessionId, studentId, status P|A|L|H|E(excused), note     (unique sessionId+studentId)
StaffAttendance     id, userId, date, status, markedById
Assessment          id, classSubjectId, termId, name "Unit Test 1", maxMarks, weight, date, publishedAt?
Mark                id, assessmentId, studentId, score, remark                     (unique assessmentId+studentId)
GradeScale          id, schoolId, board (CBSE|Matric|custom), bands [{min, grade, points}]
Homework            id, classSubjectId, title, description, dueDate, attachments[]
HomeworkSubmission  id, homeworkId, studentId, submittedAt, files[], status, grade?, feedback?
File                id, schoolId, uploaderId, path, mime, size, sha256          (server-side upload via multer → local disk in dev, S3-compatible in prod)
```

**API**
- Attendance: `POST /api/attendance/sessions` (creates + bulk records), `PATCH …/records/:id`, `GET /api/attendance/summary?studentId|classId&termId` (derived %), `POST …/sessions/:id/lock`.
- Assessments/marks: CRUD, `PUT /api/assessments/:id/marks` (bulk), `POST …/publish`; `GET /api/reports/ranks?classId&termId` computed server-side; `GET /api/reports/report-card?studentId&termId`.
- Homework: CRUD + submissions + `POST /api/files` upload.

**UI**
- Teacher "Take Attendance": today's periods from timetable → pick one → roster with P/A/L toggles → save (real). Later edits allowed until lock.
- Staff/admin "Attendance": class/day view, staff attendance, corrections, monthly export (CSV).
- Student/parent "Attendance": derived from records — subject-wise % and calendar, no separate model.
- Teacher "Gradebook": per class-subject, columns = assessments, rows = students; inline entry; publish.
- Student/parent "Marks": published assessments only; report card view with grade scale.
- Rank list: computed; deletes the hardcoded `students` array and `makeRanks`.
- Homework: teacher creates per class-subject with attachments; student uploads real files; teacher grades. Work Upload merges into Homework submissions.

**Delete:** `db.attendance`, `db.attendanceRecords`, `db.marks`, `db.ranks`, `db.directory`, `db.workUploads`, `TakeAttendanceMod` toast-only save, `GradeUploadMod` shared-row bug.

**Done when:** teacher marks attendance and enters marks for two students; each student sees only their own; ranks reorder when a mark changes; parent report card matches.

---

## Phase 4 — Admissions & identity

**Goal:** the student lifecycle from enquiry to transfer, plus real account hygiene.

**Data model**
```
Application     id, kind Admission|TC|Bonafide, applicantName, dob, guardian{name,phone,email}, targetClassId?, documents[], status, decidedById, notes, studentId? (set on approval)
Certificate     id, kind TC|Bonafide|Character, studentId, issuedById, issuedAt, serialNo, pdfFileId
PasswordReset   id, userId, tokenHash, expiresAt
```

**API**
- `POST /api/applications/:id/approve` — for Admission: creates student `User` + `Enrollment` + parent `User` + `Guardian` in one transaction, returns temp credentials. For TC: sets enrollment status `transferred`, generates certificate PDF.
- `POST /api/certificates` (PDF via server-side template, stored as `File`).
- `POST /api/auth/change-password`, `POST /api/auth/forgot` (dev: logs link; prod: email), `PATCH /api/users/me` (self-profile: phone, photo, emergency contact).
- Board registration: `BoardDetail` moves to a table, prefilled from `Enrollment` + profile; marksheet generated from Phase 3 marks (deletes the dead `marksheets` seed).
- Audit log viewer endpoint.

**UI**
- Admissions pipeline (staff/admin): kanban or table; approval dialog shows the accounts it will create.
- Profile page (all roles): edit own details, change password, see linked wards/classes.
- First-login forced password change.
- Superadmin: audit log viewer; admin management gains create + role change (not just revoke).
- Year-end "Promote students" wizard (uses Phase 1 endpoint).

**Done when:** approving an admission creates a student and parent who can both log in; issuing a TC ends the enrollment and downloads a PDF.

---

## Phase 5 — Finance

**Goal:** fees are defined per class/term, invoiced per student, paid through a recorded channel; payroll is generated from contracts.

**Data model**
```
FeeHead        id, schoolId, name "Tuition", isRecurring
FeeStructure   id, classId, termId, lines [{feeHeadId, amount}], dueDate
FeeInvoice     id, studentId, feeStructureId, termId, lines[], total, dueDate, status Draft|Due|PartiallyPaid|Paid|Waived, concession?
Payment        id, invoiceId, amount, method UPI|Card|NetBanking|Cash|Cheque, gatewayRef?, paidAt, recordedById, receiptNo, receiptPdfId
SalaryStructure id, userId (from Contract), basic, allowances[], deductions[]
Payslip        id, userId, month, gross, deductions, net, status Generated|Paid, paidAt, pdfFileId
```

**API**
- Fee heads/structures CRUD; `POST /api/fees/structures/:id/generate-invoices` (one per enrolled student, idempotent).
- Payments: `POST /api/payments` (cash/cheque by staff), `POST /api/payments/gateway/order` + webhook (Razorpay test mode — real integration behind an env flag; without keys, a clearly labeled sandbox that still records a `Payment`).
- `GET /api/fees/defaulters?termId` derived; `POST /api/fees/reminders` creates Notification rows (Phase 7) and logs the send.
- Payroll: `POST /api/payroll/run?month` generates payslips for every active contract; `PATCH …/:id/mark-paid`; payslip PDF.

**UI**
- Admin "Fee Setup": heads, per-class/term structures, generate invoices, concessions.
- Staff "Collections": search student → invoices → record payment → print receipt.
- Parent/student "Fees": their invoices, pay online, download receipts.
- Defaulters: derived list with real reminder action and reminder history.
- Admin "Payroll": run month, review, mark paid; teacher/staff "My Payslips".

**Delete:** `db.receipts`, `FeesMod` "assign to all" no-owner receipt, fake UPI "I have paid" button, viewport-based "desktop only for security" gate.

**Done when:** admin defines Term 1 fees for X-A → every X-A student gets an invoice → parent pays online (sandbox) → staff sees it paid and it leaves the defaulter list → payroll run creates payslips for all teachers.

---

## Phase 6 — HR

**Data model**
```
LeaveType       id, schoolId, name, daysPerYear, appliesTo student|staff
LeaveRequest    id, requesterId, forUserId (student or self), leaveTypeId, from, to, reason, status, decidedById, decidedAt
Contract        id, userId, designation, department, salaryStructureId, startDate, endDate, terms, status Draft|Active|Ended, signedByEmployeeAt?, signedByAdminAt?, pdfFileId
Resignation     id, userId, reason, submittedAt, lastWorkingDate, status, decidedById, notes
Duty            id, eventId (CalendarEvent), title, assigneeId, dueDate, status
```

**UI**
- Teacher/staff: My Leave (real submit, balance shown), My Contract (view, e-sign), Resign (real submit with notice-period calc), My Duties.
- Parent: Leave for a selected ward (no hardcoded name).
- Admin: leave approvals with balances, contract create/renew/end, resignation approval that ends the contract and schedules account deactivation, duty assignment with assignee.

**Delete:** `TeacherLeaveMod` useState, "Declare notice period" toast, seed-only `makeContract`.

**Done when:** teacher applies for leave → admin approves → balance drops; teacher resigns → admin approves → contract shows Ended.

---

## Phase 7 — Communication

**Data model**
```
Post           id, authorId, audience School|Class(classId)|Role(role), title?, body, media[], pinned, publishedAt
PostReaction   id, postId, userId                                (unique)
PostComment    id, postId, authorId, body, createdAt
Conversation   id, kind DM|Group, participants[], classId?, createdAt
Message        id, conversationId, senderId, body, attachments[], sentAt, readBy[]
Notification   id, userId, kind, title, body, link, readAt, createdAt
Meeting        id, requesterId, withUserId, studentId?, purpose, scheduledAt, durationMin, link, status, decidedById
```

**API & realtime**
- Feed CRUD with audience filtering server-side; per-user reactions.
- Conversations: `POST /api/conversations` with allowed-pairs rule (parent ↔ teachers of their ward's class; teacher ↔ staff/admin/teachers; admin ↔ anyone). No auto-replies.
- WebSocket (or SSE) channel for new messages/notifications; fallback polling.
- Notifications are created by other services (fee reminder, leave decision, marks published, new post for your class, meeting approved).
- Meetings: link generated from a real provider — Jitsi (`https://meet.jit.si/<room>`, no keys needed) by default; Google Meet via Calendar API if configured.

**UI**
- Feed: compose (admin/staff/teacher) with audience picker; edit/delete own posts; comments with delete.
- Messages: "New conversation" people picker constrained by rules; unread counts; read receipts from `readBy`.
- Notification bell + list; deep links.
- Meetings: request → approve → join link that works.
- Calendar events gain audience (school/class).

**Delete:** `autoReplyText`, fake "online/typing", non-functional call buttons, fabricated `meet.edunova.in` links.

**Done when:** teacher posts to X-A → only X-A students/parents see it and get a notification; parent starts a chat with the class teacher and the teacher receives it live.

---

## Phase 8 — Student welfare & compliance

**Data model**
```
HealthRecord      id, studentId, kind, detail, date, addedById, verifiedById?, documents[]
PermissionSlip    id, classId (or studentIds[]), title, detail, dueDate, createdById
SlipResponse      id, slipId, studentId, parentId, decision, respondedAt         (unique slipId+studentId)
Achievement       id, userId, title, detail, date, category, verifiedById?
DisciplinaryCase  (existing) + classId scoping, deletedAt, attachments via File
ParentVerification id, parentId, method, status, verifiedById, verifiedAt
```

**UI**
- Teacher/staff create slips per class; parents respond per ward; teacher sees response tally.
- Health records per ward; nurse/staff verify; visible only to that student's parent/teacher/admin (fixes the cross-student leak).
- Achievements per user with staff verification; appear on the student report.
- Discipline: scoped to the student's class teacher + committee; delete/archive; evidence uses real file upload.
- Parent verification becomes an admin/staff action (document check) — no self-granted OTP. Slip approval and e-sign require it.
- Student Report: fully derived from Phases 3/5/6/8; remove `studentProfileReports` seed; remove simulated AI calls from the report unless Phase 9 makes them real.

**Done when:** a slip sent to X-A reaches only X-A parents; a health record added for one child is invisible to another parent.

---

## Phase 9 — Integrations & AI (optional, each independently shippable)

- **AI Doubt Clearing:** replace regex answers with a real Claude API call (server-side, `claude-sonnet-5`), system prompt scoped to the student's class subjects; conversation history stored per student; rate-limited. Or remove the module.
- **AI parent calls:** either integrate real telephony (Exotel/Twilio + a voice agent) with genuine transcripts, or reduce to "Call log" where staff record real calls they made. The random-outcome simulator is deleted either way.
- **Event Highlights:** admin CMS for YouTube/Drive links with audience; replaces the constant.
- **Clubs/IHA/EXC/Faculty events:** move `RegistrationsMod` off localStorage into `Activity` + `ActivityRegistration` tables with capacity, staff visibility, attendance.
- **Email/SMS:** transactional provider (Resend/SES + MSG91) behind env flags; dev mode logs to console/mailpit.
- **PWA push notifications** for Phase 7 notifications.

---

## Phase 10 — Hardening & launch

- **Tests:** API integration suite (supertest + test DB) covering every route's RBAC; Playwright e2e for the "empty school → full term" walkthrough; CI runs both.
- **RBAC matrix** doc + tests: role × entity × action.
- **Delete the JSONB blob** and the legacy `update(fn)` path once no screen uses it.
- **Deployment:** production `docker-compose` (Postgres, API, static frontend behind nginx), `prisma migrate deploy` in CI, env docs, secrets handling, backups (nightly `pg_dump`), health endpoint, structured logging, error tracking.
- **Performance:** pagination on all list endpoints, indexes reviewed, N+1 audit.
- **Docs:** update `.agents/edunova/*`, admin onboarding guide ("set up your school in 30 minutes"), demo-data loader documented.
- **Security pass:** rate-limit auth, JWT refresh/rotation, CSRF strategy, file-type validation, PII export/delete for compliance.

---

## Audit summary (baseline, 2026-09-07)

| Verdict | Count |
|---|---|
| E2E | 6 — calendar events, board details, disciplinary (no delete), meetings (no delete), AI-call log rows, login/theme/PWA |
| Partial | ~24 |
| Read-only / seed-only | ~11 — terms, subjects, timetable, attendance, ranks, directory, feed posts, threads, salary, slips, highlights |
| Fake | ~12 — take attendance, teacher leave, notice period, send reminder, AI call simulate, OTP/biometric, AI doubts, call/video buttons, presence, evidence upload, desktop-only gate, overview tiles |
| Missing | ~7 — class entity, fee structure, password change, self-profile, notifications, search, settings |

Structural root causes: no class/section entity; timetable keyed by term only with no write path; marks not per student; two attendance models; hardcoded student names used as joins; no owner ids on health/slips.
