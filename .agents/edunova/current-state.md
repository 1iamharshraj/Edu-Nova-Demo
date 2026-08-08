# EduNova Demo — Current State

> Last updated: 2026-08-08

## Build & quality gates

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
| Timetable | Functional | Modern desktop time/day grid with subject color bars, sticky headers, and polished mobile day cards. |
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
| Board Registration | Functional | Validate student details (name, DOB, reg no, roll no, class, school, affiliation) before sending to CBSE/Matric boards. **Name/DOB mismatch highlighting added.** |
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
| Authentication | Plain string comparison; no real auth. |
| AI doubt clearing | Hardcoded regex → answer map. |
| AI parent calls | Simulated voice-bot transcript and status. |
| Face scan / Aadhaar verify | Timed animation + any 4+ digit OTP. |
| File uploads | Visual only; no backend storage. |
| Receipts | `.txt` download, not PDF. |
| YouTube highlights | Rickroll placeholder for all videos. |
| Payments | No real money is deducted; simulated gateway. |
| Backend / API | None. |

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

- See `todos-and-further-plans.md` for the open backlog.
- See `phase-1-foundation.md` to start the next execution phase.
