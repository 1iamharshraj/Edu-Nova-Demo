# EduNova Demo — Current State

> Last updated: 2026-09-07 — Phase 0 + 1 of `rebuild-plan.md` landed (real backend, empty-by-default school, academic structure). Sections below the banner describe the legacy demo modules and are being rewritten phase by phase.

## Rebuild status (read this first)

| Phase | Status | What landed |
|---|---|---|
| 0 · Reset & conventions | **Done** | Empty seed (one school + principal), `POST /api/admin/load-sample-data`, typed-confirm `POST /api/admin/reset`, `AuditLog` + Settings viewer, `server/src/modules/<entity>/{router,service,schema}` pattern with zod + `requireRole`, `src/lib/api.ts` + `useEntity`, hardcoded Overview tiles / Rickroll highlights / "Did you know" copy removed, sidebar reset buttons removed. |
| 1 · Academic structure | **Done** | Prisma: `AcademicYear`, `Term`, `Class`, `Subject`, `ClassSubject`, `Room`, `Enrollment`, `Guardian`. `/api/academic/*` CRUD (contract in `phase-0-1-contract.md`). Admin UI: Years & Terms, Classes & Sections (roster, class teacher), Subjects (+ per-class teacher assignment), Rooms. People rewritten on real entities (class dropdown, ward picker, one-time password modal). Server denormalises legacy `user.class/section/roll/subjects/wards/parentEmail` so old screens keep working. `db.terms`/`db.subjects` are derived from the tables. All legacy modules survive an empty school; `'Aarav Sharma'` / `'X-A'` / `'t3'` literals removed. |
| 1b · Boards & curriculum | **Done** | `Board`, `Grade`, `Stream`, `CurriculumSubject`; `Class` is board + grade (+ stream) + section, unique per board so CBSE X-A and ICSE X-A coexist; class subjects seeded from the curriculum with `POST /classes/:id/sync-curriculum`. UI: Boards & Grades, Curriculum (replaces Subjects), Classes with a board pill and a per-class Subjects & teachers modal. Spec: `phase-1b-boards-curriculum.md`. |
| 2 · Timetable | **Done** | `PeriodTemplate`, `TimetableEntry` (unique class×term×day×period), `TimetablePublish`, `Substitution`; `/api/timetable/*` with server-side teacher/room conflict detection (409 + `conflicts[]`), role-scoped `/me` and `/teacher/:id`, copy, publish. UI: Periods editor, Timetable Builder (draft grid, clash highlighting, copy-from, publish), data-driven Timetable for student/parent/teacher/admin, Overview next-class tile. Spec: `phase-2-timetable.md`. |
| 3 · Attendance & assessment | **Done** | `File` uploads (multer), `AttendanceSession/Record`, `StaffAttendance`, `GradeScale`, `Assessment/Mark`, `Homework/Submission`; `/api/attendance`, `/api/assessments` (report-card, ranks, grade-scales), `/api/homework`, `/api/files`; teacher scope enforced server-side. UI: Take Attendance (per period from the timetable), Attendance Mgmt (+staff, CSV), Gradebook, Create Assignment with attachments, data-driven Attendance/Marks/Ranks/Teachers, Homework with real uploads. Spec: `phase-3-attendance-assessment.md`. |
| 4 · Admissions & identity | In progress | `phase-4-admissions-identity.md` |
| 5 · Finance | In progress | `phase-5-finance.md` |
| 6–10 | Not started | Specs drafted: `phase-6-hr.md`, `phase-7-communication.md`, `phase-8-welfare.md`, `phase-9-10-integrations-hardening.md`. |

**Auth is real now**: bcrypt + JWT (`/api/auth/login`, `/api/auth/me`). Sample-school demo accounts exist only after loading sample data.

**Quality gates**: `npx tsc -b --noEmit && npx eslint .` (frontend) and `cd server && npx tsc --noEmit` — all clean at this checkpoint. No automated tests yet (Phase 10).

## Build & quality gates (legacy)

| Gate | Status |
|------|--------|
| `npm install` | Passes (`.npmrc` pinned to `registry.npmjs.org`) |
| `npm run build` | Passes |
| `npm run lint` | Passes (0 errors, 0 warnings) |
| `npm run dev` | Starts on `http://localhost:3000` |

## Authentication & roles

- Demo login with 6 pre-filled accounts:
  - `principal@edunova.in` / `principal123` (superadmin)
  - `admin@edunova.in` / `admin123` (admin)
  - `staff@edunova.in` / `staff123` (staff)
  - `teacher@edunova.in` / `teacher123` (teacher)
  - `parent@edunova.in` / `parent123` (parent)
  - `student@edunova.in` / `student123` (student)
- Role hierarchy: `superadmin` > `admin` > `staff` / `teacher` > `parent` / `student`.
- Session persistence across reloads via `localStorage`.
- Superadmin can manage admins (revoke access), admins can manage staff/teachers/students/parents.

## Portal modules

| Module | Status | Notes |
|--------|--------|-------|
| Overview | Functional | Role-aware greeting cards + upcoming events + stats (defaulters, resignations, disciplinary). |
| Timetable | Functional | Modern desktop time/day grid: weekdays as rows, 09:00-17:00 time slots as columns, morning/lunch/evening breaks highlighted. Polished mobile day cards. |
| Attendance | Functional | Subject-wise + daily view for all roles; staff/admin/teacher attendance management for everyone including admins. |
| Marks & Grades | Functional | Term-wise cards. |
| Rank List | Functional | Overall + subject ranks. |
| Calendar | Functional | All roles see the same calendar; admin/staff/superadmin can edit events. |
| Teachers | Functional | Directory cards. |
| School Feed | Functional | Cleaner cards, smaller media placeholder, tag overlay, and improved desktop spacing. |
| Messages | Functional | Threads and chat render; teacher-to-parent auto-replies are now context-aware and read receipts show only on the user's own messages. |
| Event Highlights | Functional | YouTube embed placeholder. |
| AI Doubt Clearing | Functional | Rule-based answers with a wider sidebar, gradient answer card, suggestion chips, and cleaner typing state. |
| Homework | Functional | Filter by subject + term. |
| Work Upload | Functional | File upload ledger with file name, size, status, notes. |
| Permission Slips | Functional | Approve/decline with verify simulation. |
| Leave Requests | Functional | Create + approve/decline. |
| Health Records | Functional | Create + e-sign simulation. |
| Achievements | Functional | Add + list. |
| Payments & Receipts | Functional | `PaymentGatewayMod` with UPI QR, card UI, net banking; intentionally disabled on mobile viewport. |
| Meetings | Functional | Request/approve video meetings with GMeet-style links; visible to requester, teacher, admin, superadmin. |
| TC & Bonafide | Functional | Apply + approve/decline. |
| Board Registration | Functional | Validate student details before sending to CBSE/Matric boards. Students see only themselves; parents see only their wards; teachers see their class; staff/admin/superadmin see all. **Name/DOB mismatch highlighting added.** |
| Take Attendance | Functional | Uses the teacher's real class roster from the DB. |
| Create Assignment | Functional | Posts to homework list. |
| Upload Grades | Functional | Publishes scores for every student in the teacher's class. |
| People | Functional | Add/edit/revoke students, teachers, staff, parents, admins; role-aware tabs. |
| Fees | Functional | Assign fee heads. |
| Fee Defaulters & AI Calls | Functional | List dues, schedule AI calls, simulate calls, review transcripts. |
| Disciplinary Committee | Functional | Report cases, track status chain, assign actions, appeals; read-only for students/parents. |
| Student Reports | Functional | Full dossier with attendance, marks, ranks, fees, meetings, calls, disciplinary, certificates, health. |
| Work Assignment | Functional | Toggle done status + generate duties, but not assigned to specific people. |
| Salary Receipts | Functional | Same as payments. |
| Contract & Resignation | Functional | Admin/superadmin manage contracts; resignation must be approved before notice starts. |
| Admin Management | Functional | Superadmin-only; revoke admin access. |

## What is simulated / not real

| Feature | Simulation |
|---------|------------|
| Authentication | ~~Plain string comparison~~ Real bcrypt + JWT since Phase 0. |
| AI doubt clearing | Hardcoded regex → answer map. |
| AI parent calls | Simulated voice-bot transcript and status. |
| Face scan / Aadhaar verify | Timed animation + any 4+ digit OTP. |
| File uploads | Visual only; no backend storage. |
| Receipts | `.txt` download, not PDF. |
| YouTube highlights | Removed; empty until the Phase 9 CMS. |
| Payments | No real money is deducted; simulated gateway. |
| Backend / API | Express + Prisma + Postgres (`server/`); legacy data still in a JSONB blob, academic entities in real tables. |

## Known bugs & rough edges

1. **Work assignments have no assignees** — duties are created but not linked to specific staff/teacher. `src/portal/modules/office.tsx:243-290`
2. **Light/dark overlap still reported** — some hardcoded light backgrounds exist without `dark:` counterparts, despite the theme fix pass.
3. **No automated test suite** — manual testing via role login only.
4. **Large bundle size** — Vite warns about ~1 MB uncompressed chunk.

**Already fixed in this cycle:** staff can manage teachers and students; teacher message auto-replies are context-aware; Take Attendance and Upload Grades use the real class roster; My Contract shows the logged-in user's contract; parent verification uses the logged-in parent's name/phone; attendance records are deterministic after reset; timetable, school feed, AI doubt clearing, and mobile login selector have been polished; admin applications pipeline has status notes and kind filter; People management links to student profile reports.

## Files and modules inventory

- `src/App.tsx` — routes + `/login` redirect when already authenticated.
- `src/pages/Landing.tsx` — marketing landing.
- `src/pages/Login.tsx` — role selector login + superadmin account.
- `src/portal/Portal.tsx` — portal shell + overview + module registry.
- `src/portal/ui.tsx` — shared primitives (Card, Pill, Modal, Field, Avatar, Progress, TermTabs, etc.).
- `src/portal/modules/academics.tsx` — Attendance, Marks, Rank, Calendar, Teachers.
- `src/portal/modules/timetable.tsx` — Timetable.
- `src/portal/modules/social.tsx` — Feed, Messages, Highlights, AI Doubts.
- `src/portal/modules/actions.tsx` — Homework, Slips, Leave, Health, Achievements, Payments, Work Upload.
- `src/portal/modules/office.tsx` — Take Attendance, Create Assignment, Upload Grades, Contract, Work Assignment, Registrations, Applications, People, Fees, Calendar Admin, Board Registration, Attendance Mgmt, Contracts & Resignations.
- `src/portal/modules/meetings.tsx` — Meeting requests + GMeet links.
- `src/portal/modules/feeDefaulters.tsx` — Fee defaulters + AI parent calls.
- `src/portal/modules/disciplinary.tsx` — Disciplinary committee.
- `src/portal/modules/paymentGateway.tsx` — Desktop payment gateway.
- `src/portal/modules/studentReport.tsx` — Full student profile report.
- `src/lib/data.ts` — types and seed DB.
- `src/lib/store.tsx` — state management + create/delete helpers.
- `src/lib/access.ts` — role/access helpers.
- `src/lib/theme.tsx` — dark/light toggle.
- `src/lib/pwa.tsx` — install prompt + QR.
- `src/index.css` — global styles + dark mode fixes.
- `public/sw.js` — service worker.
- `public/manifest.json` — PWA manifest.
- `.npmrc` — npm registry override.
- `eslint.config.js` — ignores generated UI/hook files.

## Next steps

- Phase 5 final QA, documentation sync, and GitHub push are complete.
- See `todos-and-further-plans.md` for the open backlog and future enhancements.
