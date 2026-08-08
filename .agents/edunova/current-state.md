# EduNova Demo — Current State

> Last updated: 2026-08-07

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
  - `parent.arav.sharma@edunova.in` / `parent123` (parent)
  - `student@edunova.in` / `student123` (student)
- Role hierarchy: `superadmin` > `admin` > `staff` / `teacher` > `parent` / `student`.
- Session persistence across reloads via `localStorage`.
- Superadmin can manage admins (revoke access), admins can manage staff/teachers/students/parents.
- Mobile login role selector text overflow fixed.

## Portal modules (functional)

| Module | Status | Notes |
|--------|--------|-------|
| Overview | Functional | Role-aware greeting cards + upcoming events + new stats (defaulters, resignations, disciplinary). |
| Timetable | Redesigned | Modern desktop grid with day columns; mobile day-picker + vertical cards; term switcher. |
| Attendance | Functional | Subject-wise + daily view for all roles; staff/admin/teacher attendance management for everyone including admins. |
| Marks & Grades | Functional | Term-wise cards. |
| Rank List | Functional | Overall + subject ranks. |
| Calendar | Common | All roles see the same calendar; admin/staff/superadmin can edit events. |
| Teachers | Functional | Directory cards. |
| School Feed | Functional | Desktop feed widened, like + comments work. |
| Messages | Fixed | Teacher sees parent-name in parent threads; teacher-teacher tab added; term switcher. |
| Event Highlights | Functional | YouTube embed placeholder. |
| AI Doubt Clearing | Functional | Desktop sidebar + chat layout; rule-based answers. |
| Homework | Functional | Filter by subject + term. |
| Work Upload | Legitimized | File upload ledger with file name, size, status, notes. |
| Permission Slips | Functional | Approve/decline with verify simulation. |
| Leave Requests | Functional | Create + approve/decline. |
| Health Records | Functional | Create + e-sign simulation. |
| Achievements | Functional | Add + list. |
| Payments & Receipts | Gateway | `PaymentGatewayMod` with UPI QR, card UI, net banking; disabled on mobile view. |
| Meetings | Functional | Request/approve video meetings; GMeet-style links; visible to requester, teacher, admin, superadmin. |
| TC & Bonafide | Functional | Apply + approve/decline. |
| Board Registration | Functional | Validate student details (name, DOB, reg no, roll no, class, school, affiliation) before sending to CBSE/Matric boards. |
| Take Attendance | Functional | Mark P/A for a fixed roster. |
| Create Assignment | Functional | Posts to homework list. |
| Upload Grades | Functional | Only updates Aarav's marks. |
| People | Functional | Add/edit/revoke students, teachers, staff, parents, admins; role-aware tabs. |
| Fees | Functional | Assign fee heads. |
| Fee Defaulters & AI Calls | Functional | List dues, schedule AI calls, simulate calls, review transcripts. |
| Disciplinary Committee | Functional | Report cases, track status chain, assign actions, appeals; read-only for students/parents. |
| Student Reports | Functional | Full dossier with attendance, marks, ranks, fees, meetings, calls, disciplinary, certificates, health. |
| Work Assignment | Functional | Toggle done status + generate duties. |
| Salary Receipts | Functional | Same as payments. |
| Contract & Resignation | Admin-controlled | Admin/superadmin manage contracts and approve/decline teacher/staff resignations. |
| Admin Management | Superadmin-only | Revoke admin access; cannot delete own superadmin account. |

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

## Known issues

1. No automated test suite (Vitest + React Testing Library). Testing is manual via role login.
2. Large bundle size warning from Vite (~1 MB uncompressed). Code splitting deferred to future.
3. Some shadcn/ui primitives have unused warnings but are ignored from lint to avoid modifying generated files.
4. Payment gateway is intentionally disabled on mobile viewport for security demo purposes.

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

- See `todos-and-further-plans.md` for open enhancements and future phases.
- Run `npm run dev` and log in as each role to verify the module menus render.
