# EduNova Demo — Todos & Further Plans

## Completed improvements

1. ✅ **Superadmin** role above admin (principal/vice-chairman) who can manage all admins.
2. ✅ **Board Registration Details validation** — validate the student details the school sends to CBSE/Matric boards before exam registration (name, DOB, registration no, roll no, class, school, affiliation). **Name/DOB mismatches are now highlighted with a side-by-side comparison and require a note before validating.**
3. ✅ **People management** rebuilt for proper staff/teacher/student/admin profiles with add/edit/revoke.
4. ✅ **Teacher messaging** tabs for parents and teachers; flexible term selection.
5. ✅ **Timetable** desktop grid + mobile day-picker (needs further visual polish).
6. ✅ **Mobile login role selector** scrollable pills (needs further compactness polish).
7. ✅ **Online meetings** GMeet-style links, request/approve flow from teacher, student, and parent, visible to all parties.
8. ✅ **Teacher resignation** approval workflow before notice period starts.
9. ✅ **Admin management** menus for admissions, certificates, people, contracts, calendar, attendance, fees, disciplinary.
10. ✅ **Contracts** for teachers/staff controlled by admin/superadmin.
11. ✅ **Calendar** common for all roles, editable by admin/staff/superadmin.
12. ✅ **Attendance** for everyone including admins; superadmin can manage admins.
13. ✅ **Work upload** file ledger with name, size, status, notes.
14. ✅ **Payment gateway** legitimate-looking UPI/card/netbanking UI; disabled on mobile viewport.
15. ✅ **Light/dark mode** theme pass (remaining overlap issues to be fixed in final QA).
16. ✅ **School feed desktop UI** widened to `max-w-5xl` (needs further layout polish).
17. ✅ **AI doubt clearing desktop UI** sidebar + chat layout (needs further visual polish).
18. ✅ Admin menus to control all students, teachers, and staff.
19. ✅ **Fee defaulters** + **AI parent calls** (request by class teacher/admin/staff, view call logs, transcripts).
20. ✅ **Disciplinary committee** module for complaints, hearings, actions, appeals.
21. ✅ **Student profile report** for admin/staff/teacher with full academic/behavioral/financial history.

## Open backlog (prioritized)

### P0 — Fix data & messaging accuracy (done)
- [x] Fix `canManage` so **staff** can manage **teachers** and **students** (not just students/parents). `src/lib/access.ts:36-38`
- [x] Fix teacher-message auto-replies so the other participant's reply matches the conversation direction, and show read receipts only on the user's own messages. `src/portal/modules/social.tsx:11-34`
- [x] Fix **teacher contract** to show the logged-in teacher's own contract, not Meera Krishnan's static data. `src/portal/modules/office.tsx:191-241`
- [x] Fix **Take Attendance** and **Upload Grades** to use the actual DB roster instead of hardcoded names. `src/portal/modules/office.tsx:32-97`
- [x] Fix **parent verification** hardcoded name/mobile. `src/portal/ui.tsx:113-179`
- [x] Make **attendance records deterministic** on reset instead of random. `src/lib/data.ts:410-424`

### P1 — High-visibility UI polish
- [ ] Redesign **timetable** to look modern/elegant on desktop and clean on mobile. `src/portal/modules/timetable.tsx`
- [ ] Improve **school feed desktop UI** (layout, media placeholders, spacing). `src/portal/modules/social.tsx:40-111`
- [ ] Improve **AI doubt clearing desktop UI** (sidebar, suggested chips, typing state). `src/portal/modules/social.tsx:369-407`
- [ ] Tighten **mobile login role selector** (compact buttons, better text fit). `src/pages/Login.tsx:85-92`
- [ ] Resolve remaining **light/dark overlap** issues across all modules. `src/index.css` + module files

### P2 — Admin & people workflows
- [ ] Strengthen **admissions & certificates** pipeline: clear status transitions, admin notes, link to student profile. `src/portal/modules/office.tsx` (ApplicationsMod)
- [ ] Add **student profile report** entry from People management for admin/staff. `src/portal/modules/office.tsx` (PeopleMod)
- [ ] Add **work assignment assignees** — link duties to specific teachers/staff. `src/portal/modules/office.tsx:243-290`
- [ ] Allow **admin/superadmin** to select and set the global active term from the portal. `src/portal/Portal.tsx` term context

### P3 — Finance & HR refinements
- [ ] Polish **payment gateway** copy and mobile disabled state. `src/portal/modules/paymentGateway.tsx`
- [ ] Add **call log management** for AI parent calls (delete/archive, filter by requester). `src/portal/modules/feeDefaulters.tsx`
- [ ] Link **disciplinary case outcomes** to student profile report and certificate issuance. `src/portal/modules/disciplinary.tsx` + `studentReport.tsx`

### P4 — Final QA & documentation
- [ ] Responsive audit on mobile and desktop for all key modules.
- [ ] Light/dark theme audit for every module.
- [ ] Smoke-test every role: superadmin, admin, staff, teacher, parent, student.
- [ ] Ensure `npm run build` and `npm run lint` pass.
- [ ] Sync all `.agents/edunova/*.md` docs after implementation.
- [ ] Push final commits to `origin/main`.

## Future enhancements (out of scope for the current demo push)

- Integrate a real backend API (auth, persistent database, file storage).
- Replace rule-based AI with a real LLM for doubts and parent calls.
- Integrate real payment gateway (Razorpay, Stripe, etc.).
- Generate real PDF certificates and receipts.
- Add real-time notifications / WebSocket.
- Add test suite (Vitest + React Testing Library).
- Add server-side RBAC.
- Multi-school / multi-branch support.
- Code splitting to reduce bundle size.
- Real-time timetable conflict validation.
- Bulk import/export of users and marks via CSV/Excel.

## Phase documents

- `phase-1-foundation.md` — P0 fixes + access/messaging.
- `phase-2-people-and-academics.md` — admin workflows + roster fixes.
- `phase-3-communication-and-ui.md` — timetable, feed, AI, login polish.
- `phase-4-hr-finance-and-compliance.md` — finance/HR refinements.
- `phase-5-polish-and-build.md` — final QA, docs, push.
