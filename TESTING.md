# EduNova — Manual end-to-end test (Phase 0 + 1)

Work through this top to bottom in one sitting (~45 min). Tick each box; if anything doesn't match the **Expect** line, note the section number and what you saw.

Scope: what Phase 0 + 1 built — auth, empty school, academic setup, people, settings, cross-role visibility, and the legacy modules surviving an empty school. Section 9 lists what is **known not to work yet** so you don't log it as a bug.

---

## 0. Setup

```bash
npm run db:up          # Postgres in Docker on :5434
npm run db:migrate
npm run db:seed        # one school + principal only (safe to re-run; it's idempotent)
npm run server:dev     # API on :4000
npm run dev            # frontend on :3000 (second terminal)
```

- [ ] `curl http://localhost:4000/api/health` → `{"ok":true}`
- [ ] http://localhost:3000 loads the landing page
- [ ] Open DevTools → Application → Local Storage → clear `edunova_*` keys (start from a clean session)

Reference accounts (only the first exists on a fresh school):

| Role | Email | Password |
|---|---|---|
| Superadmin | principal@edunova.in | principal123 |
| Sample admin | admin@edunova.in | admin123 |
| Sample staff | staff@edunova.in | staff123 |
| Sample teacher | teacher@edunova.in | teacher123 |
| Sample parent | parent@edunova.in | parent123 |
| Sample student | student@edunova.in | student123 |

---

## 1. Authentication

- [ ] **1.1** Go to `/login`, pick **Superadmin**, sign in.
  **Expect:** lands on `/portal`, header shows "superadmin portal", sidebar has groups *Main · Academic Setup · Manage · Finance · System*.
- [ ] **1.2** Refresh the page.
  **Expect:** still signed in (JWT in localStorage `edunova_token_v1`), no flash of the login page beyond "Loading EduNova…".
- [ ] **1.3** Sign out → try `/portal` directly.
  **Expect:** redirected to `/login`.
- [ ] **1.4** Pick **Student** on the login page and sign in with the prefilled `student@edunova.in`.
  **Expect:** error "Those credentials don't match any EduNova account…" — the sample accounts don't exist on a fresh school.
- [ ] **1.5** Sign in as superadmin with a wrong password.
  **Expect:** same error, no portal access.
- [ ] **1.6** (Phase 10) Fail login 11+ times in under 15 minutes.
  **Expect:** a rate-limit error after the 10th attempt — this protects `/api/auth/*`, not the rest of the API.
- [ ] **1.7** (Phase 10) Access tokens now expire after 15 minutes. Stay logged in and idle past that (or manually expire a token) and trigger any API call.
  **Expect:** the app transparently refreshes the session and the call still succeeds — no unexpected logout, no visible error. You should only be logged out if the refresh token itself is invalid/expired/revoked (e.g. after `logout` on another device or a very long idle period).

---

## 2. Empty school renders everywhere

Signed in as superadmin, on a fresh school:

- [ ] **2.1** Overview.
  **Expect:** tiles show *Students 0 · Teachers 0 · Admins 0 · Resignations 0*; "Coming up" says *No events on the calendar yet*; a **Set up your school** checklist with 4 unticked steps.
- [ ] **2.2** Click through **every** sidebar item (all groups).
  **Expect:** every screen opens with an empty state / "create the first…" message. **No blank white screen, no red error overlay, nothing in the browser console that says `Uncaught`.** (Warnings are fine.)
- [ ] **2.3** Settings.
  **Expect:** *School data* card shows all zeros (years, terms, boards, grades, classes, subjects, curriculum rows, rooms) except *People 1*; *Sample school* card shows the **Load sample school** button; *Danger zone* card present; *Recent activity* shows "No activity recorded yet" (or only earlier resets).
- [ ] **2.4** Sidebar footer.
  **Expect:** only *Install app* and *Sign out* — there is **no** "Reset demo data" button anywhere (desktop sidebar or mobile "More" sheet).

---

## 3. Academic setup (the core of Phase 1)

### 3.1 Years & Terms
- [ ] Open **Years & Terms**. Expect the empty card *Start by creating the academic year*.
- [ ] Add year: label `2026-27`, start `2026-06-01`, end `2027-05-31`.
  **Expect:** appears in the list with a **Current** pill (first year is current automatically).
- [ ] Try adding a term with end date before start date.
  **Expect:** blocked with a validation message; nothing created.
- [ ] Add three terms to the year: `Term 1` (Jun 1 – Sep 30 2026), `Term 2` (Oct 1 2026 – Jan 31 2027), `Term 3` (Feb 1 – May 31 2027).
  **Expect:** all three listed; **Term 1 has the Current pill** (first term becomes current automatically).
- [ ] Click **Set current** on Term 3.
  **Expect:** pill moves to Term 3, Term 1 loses it.
- [ ] Edit Term 2's name to `Term 2 (Winter)`.
  **Expect:** name updates in place.
- [ ] Add a second year `2027-28`, then **delete** it.
  **Expect:** delete confirmation mentions it removes terms and classes; year disappears; `2026-27` still current.
- [ ] Go to **Overview**. **Expect:** step 1 of the checklist is ticked.

### 3.2 Boards & Grades
- [ ] Open **Boards & Grades**. Expect three empty cards (Boards, Grade ladder, Streams) with CTAs.
- [ ] Add boards: `Central Board of Secondary Education` code `CBSE`, and `Council for the Indian School Certificate Examinations` code `ICSE`.
  **Expect:** both listed with their codes. Adding another board with code `CBSE` → rejected (409).
- [ ] Grade ladder: add `LKG`, `UKG`, `I`, `VIII`, `IX`, `X` in that order.
  **Expect:** listed in the order added. Move `X` up one step → it swaps with `IX`; move it back down.
- [ ] Rename `LKG` → `Pre-KG`, then delete `UKG`.
  **Expect:** updates / disappears.
- [ ] Streams: add `Science` and `Commerce`.
- [ ] Overview. **Expect:** step 2 ticked.

### 3.3 Curriculum
- [ ] Open **Curriculum**. Catalogue (left): add `Mathematics` (`MATH`), `Science` (`SCI`), `English` (`ENG`), `Hindi` (`HIN`) with different colours.
  **Expect:** four swatches. Adding another `Mathematics` → rejected (409). Rename `Science` → `General Science`.
- [ ] Pick **CBSE → VIII → No stream**.
  **Expect:** empty table with an *Add subject* control listing all four catalogue subjects.
- [ ] Add Mathematics (core), General Science (core), English (core), Hindi (language). Type textbook `NCERT Mathematics VIII` on the Mathematics row and blur.
  **Expect:** four rows, kinds shown, textbook persists after switching to another grade and back.
- [ ] *Add subject* now lists nothing (all four used). Delete the Hindi row → Hindi is offered again.
- [ ] Pick **ICSE → VIII**. **Expect:** empty — curricula are per board. Add Mathematics (core) and English (core) only.
- [ ] Pick **CBSE → X → Science**. Add Mathematics (core). Pick **CBSE → X → Commerce**. **Expect:** empty (streams are independent).
- [ ] Overview. **Expect:** step 3 ticked.

### 3.4 Rooms
- [ ] Open **Rooms**. Add `C-101` (classroom, 40), `Physics Lab` (lab, 30), `Playground` (ground).
  **Expect:** listed with kind and capacity. Edit `C-101` capacity to 45. Delete `Playground`.

### 3.5 Classes & Sections
- [ ] Open **Classes & Sections**. Expect empty state with the year selector showing `2026-27`.
- [ ] Add class: board `CBSE`, grade `VIII`, no stream, section `A`, capacity `40`, no class teacher.
  **Expect:** card **VIII-A** with a **CBSE** pill, *No class teacher*, *0 students*, capacity 40, grouped under a CBSE heading.
- [ ] Open **Subjects & teachers** on CBSE VIII-A.
  **Expect:** three rows came in automatically from the CBSE VIII curriculum (Mathematics, General Science, English — Hindi was deleted), each with an empty teacher dropdown and periods `5`. Close.
- [ ] Add class: board `ICSE`, grade `VIII`, section `A`.
  **Expect:** allowed — a second **VIII-A** card with an **ICSE** pill under an ICSE heading. Its *Subjects & teachers* shows only Mathematics and English.
- [ ] Add `CBSE` / `VIII` / `A` again. **Expect:** rejected (same board + grade + section in the year).
- [ ] Add `CBSE` / `VIII` / `B`, and `CBSE` / `X` / stream `Science` / `A`.
  **Expect:** X-A card shows pills **CBSE** and **Science**; its subjects = Mathematics only.
- [ ] Back in **Curriculum → CBSE → VIII**, add Hindi (language) again. Then **Classes → CBSE VIII-A → Subjects & teachers → Sync from curriculum**.
  **Expect:** Hindi row appears; existing rows untouched. (ICSE VIII-A is unaffected.)
- [ ] Delete `CBSE X-A`. **Expect:** confirmation warns about enrollments/subject assignments; card removed.
- [ ] Overview. **Expect:** step 4 ticked.

## 3b. Timetable (Phase 2)

Prerequisites: §3–4 done (classes with subjects and teachers, a current term).

- [ ] **Periods** (Academic Setup). Add a template `Standard day`: P1 09:00–09:45, P2 09:45–10:30, Break 10:30–10:45 (kind break), P3 10:45–11:30, P4 11:30–12:15. **Expect:** listed with a **Default** pill (first template is default). Reorder P4 above P3 and back; delete attempt on the default while entries exist → refused.
- [ ] **Timetable Builder**: pick CBSE VIII-A + the current term. **Expect:** grid Mon–Fri × P1–P4 with the break as a narrow strip; side panel lists the class subjects with `0/n` counters.
- [ ] Click Mon P1 → subject Mathematics (teacher prefilled Kavya), room C-101 → OK. Fill Mon P2 English, Tue P1 Mathematics. **Expect:** *Unsaved changes* pill; counters update (Mathematics 2/7). **Save** → toast; pill clears.
- [ ] Switch to CBSE VIII-B, put Mathematics (Kavya) in **Mon P1**, Save. **Expect:** save rejected with a conflict banner and the Mon P1 cell marked **Clash** (Kavya is in VIII-A then). Move it to Mon P3 → saves.
- [ ] VIII-B Mon P2 → any subject with room **C-101** → Save. **Expect:** room clash (VIII-A English is in C-101 at Mon P2). Change room → saves.
- [ ] **Copy from…** VIII-A → VIII-B (same term). **Expect:** refused because VIII-B is not empty. Clear VIII-B's entries (Clear each cell, Save), copy again → reports copied count and skipped subjects VIII-B lacks.
- [ ] **Publish** VIII-A. **Expect:** pill turns Published. Publish is disabled while there are unsaved changes.
- [ ] **Student (Ishaan, VIII-A) → Timetable.** **Expect:** the grid with Mathematics/English cards showing teacher, room, time; the current period is highlighted if you test during it; Overview tile **Next class** shows the next entry today (or "No more classes today").
- [ ] **Student in VIII-B (unpublished)** → *Timetable not published yet*.
- [ ] **Teacher Kavya → My Timetable.** **Expect:** her periods across VIII-A and VIII-B with the class label leading; Overview **Classes today** count matches.
- [ ] As principal, add a **substitution** via the API is not in the UI yet? → It is: Timetable (admin view) → pick a class → click an entry → "Cover this period" with a date and substitute teacher. If that control is missing in your build, skip. **Expect (if present):** the substitute's My Timetable shows the covered period for that week.
- [ ] Sample school: **Load sample school** → student@edunova.in Timetable shows a full published week for Term 3; teacher@edunova.in sees ~27 periods across 4 classes.

## 3c. Attendance, gradebook, homework (Phase 3)

Prerequisites: §3–4 and §3b (published timetable for CBSE VIII-A with Kavya teaching Mathematics).

- [ ] **Teacher Kavya → Take Attendance.** Class VIII-A, today's date. **Expect:** period list shows her timetable periods for that weekday plus *Whole day*; roster Ishaan + Diya with P/A/L/E toggles; status pill *Not taken*.
- [ ] Mark Ishaan **A**, Diya **P**, Save. **Expect:** toast; pill *Saved*. Change Ishaan to **L**, Save again → replaced (reload: still L). Click **Lock** → toggles disabled, pill *Locked*.
- [ ] **Principal → Attendance** (Manage): Students tab, VIII-A, today. **Expect:** the session with counts; **Unlock** works (admin only); **Export CSV** downloads. Staff tab: mark Kavya **P** for today, Save.
- [ ] **Student Ishaan → Attendance.** **Expect:** today shows **L**; overall % computed; if period sessions exist, a by-subject breakdown. Overview **Attendance** tile matches.
- [ ] **Parent Meenakshi → Attendance.** **Expect:** same as Ishaan (ward picker if >1 ward).
- [ ] **Kavya → Gradebook.** Pick VIII-A · Mathematics · current term. **Expect:** no assessments yet; **Add assessment** → `Unit Test 1`, max 25, date today → column appears with a *Draft* pill.
- [ ] Enter Ishaan 21, Diya 24 → **Save marks**. Try 30 for Ishaan → flagged, save blocked. **Publish** the column.
- [ ] **Student Ishaan → Marks & Grades.** **Expect:** Mathematics: Unit Test 1 21/25, grade from the default scale (A2 for 84%). **Rank List** → Diya #1, Ishaan #2. Overview **Class rank** = #2.
- [ ] Kavya adds `Class Test` (max 20), enters marks, leaves it **unpublished** → Ishaan does **not** see it; **Ranks** unchanged.
- [ ] **Principal → Gradebook → Grade scales**: add `CBSE 8-point` (A1 91, A2 81, B1 71, B2 61, C1 51, C2 41, D 33, E 0). A band out of order → rejected. Ishaan's report card now uses it.
- [ ] **Kavya → Create Assignment**: VIII-A Mathematics, title `Worksheet 3`, due in 7 days, attach a small PDF or txt. **Expect:** listed with the attachment link.
- [ ] **Ishaan → Homework Upload**: sees Worksheet 3 as *Pending*; upload a txt → **Submit** → *Submitted*. Upload a `.exe` → rejected.
- [ ] **Kavya → Create Assignment → Worksheet 3 → submissions**: Ishaan's file downloads; grade `A1`, feedback text → Ishaan sees *Graded A1* + feedback.
- [ ] **Meenakshi → Homework Status** shows the same for Ishaan.
- [ ] **My Report** (Ishaan) shows attendance %, marks and rank from the same data.
- [ ] Sample school: student@edunova.in has ~95% attendance, 3 published assessments per subject per term, rank 1 of 2; teacher@edunova.in Gradebook shows X-A Mathematics with marks.

## 3g. Communication (Phase 7)

- [ ] **School Feed** (admin/staff/teacher): compose a post with audience **School** → everyone sees it. Compose one as a teacher with audience **Class** (their own class) → only that class's students/parents/teachers see it, another class does not.
- [ ] React (like) and comment on a post as a student; delete your own comment. Admin can delete anyone's post; author can edit/delete their own.
- [ ] **Messages**: as a parent, **New conversation** → the people picker only offers teachers of your ward's class (and staff/admin) — not arbitrary teachers or other parents. Start one, send a message.
- [ ] Open the same conversation as the teacher (second browser) → the message appears **live** without a manual refresh (SSE); reply → parent sees it live too. Read receipts update once the other side opens the thread.
- [ ] **Notification bell** (header, any role): a new message you haven't opened yet produces a notification; **mark all read** clears the badge.
- [ ] **Meetings**: parent requests a meeting with the class teacher → teacher **Approves** → a real, clickable `meet.jit.si` link appears for both.
- [ ] **Calendar Management** (admin/staff): add an event with audience **One class** → only that class's students/parents see it on their Calendar; a **Whole school** event is visible to everyone.
- [ ] Sample school: Feed has 5 posts with reactions/comments; Messages has the seeded Nisha↔Meera and teacher-to-teacher threads with history; Meetings has 3 seeded requests; Calendar has the seeded holidays/exams/events.

---

## 3h. Welfare & compliance (Phase 8)

- [ ] **Health records**: staff/admin adds a health record (kind, title, detail, date) for a student. **Expect:** visible to the student, their guardian(s), that student's class teacher, and any staff/admin. A parent of a *different* student, or a teacher who doesn't teach that student's class, gets **403 / can't see it** — this is the fix for the old cross-student privacy leak.
- [ ] Staff/admin **verifies** a health record (e.g. a vaccination) → shows *Verified*.
- [ ] **Permission slips**: teacher creates a slip scoped to their own class only (no "all classes" option unless staff/admin). Parent of a student in that class sees it under **Permission Slips** and can **Approve**/**Decline** (gated behind parent verification — an unverified parent sees a prompt to verify first, not a dead button). Parent of a student in another class does not see it.
- [ ] Teacher/staff view the slip's **response tally** — who has and hasn't responded.
- [ ] **Achievements**: student adds their own achievement (category, title, detail, date); teacher/staff/admin **verifies** it. A student cannot verify their own or another student's achievement.
- [ ] **Discipline**: teacher reports a case for a student in a class they teach → succeeds. Reporting for a student in a class they don't teach → **403**. Staff/admin can report for anyone. Add a note to the case (status timeline) with optional evidence upload. Admin **soft-deletes** a case → disappears from the default list, still visible with **Show archived** toggled and in the audit log. Non-admin cannot delete.
- [ ] **Call log** (Fee Defaulters screen, staff/teacher/admin): log a call actually made — reason, summary, outcome, duration — against a defaulting student. **Expect:** appears in that student's call history immediately; a parent/teacher unrelated to the student can't see or log calls for them. (There is no more "schedule an AI call" concept — this is a log of real calls made, entered after the fact.)
- [ ] **Activities** (Clubs & Chapters / Inter-House / EXC / Event Registration / Faculty Events, per role): register for an activity with `capacity: 1` as one student → shows **✓ Registered**. A second student registering for the same activity → **On waitlist**. First student cancels → the waitlisted student is **automatically promoted** to Registered (check by reloading their view).
- [ ] **Activities Admin** (staff/admin/superadmin): create a new activity (kind, title, description, capacity, open/close dates). **View registrations** on an existing activity shows who's registered/waitlisted by name.
- [ ] **Student Report** (any role with access): open a student's report — one page load now assembles profile, attendance, marks, rank, fees, meetings, call log, discipline, achievements, certificates and health records via a single `/api/reports/student/:id` call. A parent/teacher without a relationship to that student gets a clear "you cannot view this report" state instead of a partially-blank page.
- [ ] Sample school: `u-s` (student) has a seeded allergy record, 3 permission slips (one already responded), 3 achievements, 2 discipline cases (one with notes), 1 logged call, and the full activity catalogue (clubs/houses/EXC/events/faculty) with a few pre-registered students.

---

## 3i. Integrations & AI (Phase 9)

- [ ] **AI Doubt Clearing** (student only): ask a question. Without `ANTHROPIC_API_KEY` set on the server (the default in local dev), **expect** a clear "AI tutor not configured" state — not a crash, not a fake regex answer. Your question is still saved to the thread.
- [ ] Ask a second question on the same subject → continues the same conversation thread; switching the subject filter starts a new thread. Ask 30+ questions in a day → the 31st shows a friendly "you've reached today's limit" message (server-authored).
- [ ] A non-student role (parent/teacher/staff/admin) has no way to reach `AIDoubtsMod` in the sidebar, and a direct API call is rejected with 403.
- [ ] **Event Highlights**: staff/admin/superadmin publish a highlight with a YouTube URL and audience **School** → renders as a real embedded video for every role. Publish one with audience **Class** → only that class's students/parents/teacher see it; other classes don't. Delete a highlight → disappears everywhere.
- [ ] A student/parent has no publish/delete controls on the Highlights screen — read-only.
- [ ] **Push notifications** (Profile → Notifications): toggle "Enable notifications" → browser permission prompt → on allow, the toggle shows enabled and persists across reloads; on deny/unsupported browser, a clear disabled explanation is shown (no crash). Disable → unsubscribes cleanly.
- [ ] Sample school: 2 seeded highlights (one School-wide, one Class-scoped) and one seeded AI conversation with a sample exchange for `u-s`.

---

## 4. People

### 4.1 Teachers
- [ ] **People & Roles → Teachers → Add person**: name `Kavya Nair`, joining date today, salary `55000`, *Class teacher of* → `VIII-A`. Create.
  **Expect:** an **Account created** modal showing the email (`kavya.nair@edunova.in`) and a one-time password (`teacher123`), with copy buttons. Write these down.
- [ ] Teacher row.
  **Expect:** shows *Class teacher of VIII-A* and **no** subject pills yet, plus the hint to assign subjects in Academic Setup.
- [ ] Add a second teacher `Rahul Menon`, no class-teacher assignment.
- [ ] **Classes & Sections** → VIII-A card. **Expect:** now shows *Kavya Nair* as class teacher.

### 4.2 Subject assignments (per class)
- [ ] **Classes & Sections → CBSE VIII-A → Subjects & teachers**.
  **Expect:** rows Mathematics, General Science, English, Hindi — no teacher yet, periods 5.
- [ ] Set Mathematics → teacher Kavya, periods `6`. Set English → Rahul, periods `5`.
  **Expect:** toast on each save; values persist after closing and reopening the modal.
- [ ] Change Mathematics periods to `7` and blur. **Expect:** saved (toast).
- [ ] Set English's teacher back to *— unassigned —*. **Expect:** saved; row stays with no teacher. Click the trash on Hindi → row removed (the curriculum row is untouched — check Curriculum still lists Hindi for CBSE VIII).
- [ ] *Add subject* in the modal lists Hindi again (catalogue subjects not on the class). Add it back.
- [ ] **People → Teachers**. **Expect:** Kavya now has a **Mathematics · VIII-A** pill; Rahul has none.

### 4.3 Students
- [ ] **People → Students**. **Expect:** *Add student* is enabled (classes exist). (If you want to confirm the guard: it should be disabled with a tooltip on a school with no classes.)
- [ ] Add student: `Ishaan Rao`, class `VIII-A · CBSE` (the dropdown lists `VIII-A · CBSE`, `VIII-A · ICSE`, `VIII-B · CBSE`), roll `7`, DOB `2013-02-11`, no parent yet.
  **Expect:** Account created modal (email `ishaan.rao@edunova.in`, password `student123`). Row shows **VIII-A** with a **CBSE** pill · Roll 7.
- [ ] Add `Diya Patel`, class `VIII-A · CBSE`, roll `4`. Add `Arjun Iyer`, class `VIII-B · CBSE`, roll `1`. Add `Zara Khan`, class `VIII-A · ICSE`, roll `1`.
- [ ] Filter by class `VIII-A · CBSE`. **Expect:** only Ishaan and Diya — Zara (ICSE VIII-A) is not listed. Clear the filter.
- [ ] Search `diya`. **Expect:** only Diya. Clear.
- [ ] **Classes & Sections** → VIII-A. **Expect:** *2 students*. Open **Roster**.
  **Expect:** Ishaan (7) and Diya (4) sorted by roll. Change Diya's roll to `5` inline (blur/Enter) → persists after closing and reopening the modal.
- [ ] In the roster, **Add student** → the picker should list only students not enrolled this year (none right now, since all three are enrolled). Close.
- [ ] Edit Arjun → change class to `VIII-A`.
  **Expect:** row now shows VIII-A; VIII-B card shows *0 students*; VIII-A shows *3*.

### 4.4 Parents
- [ ] **People → Parents → Add person**: `Meenakshi Rao`, phone `+91 90000 00001`, wards → tick **Ishaan Rao** (the checklist shows each student's class label).
  **Expect:** Account created modal (email `parent.meenakshi.rao@edunova.in`, password `parent123`). Row shows ward *Ishaan Rao (VIII-A)*.
- [ ] **People → Students** → Ishaan's row. **Expect:** shows guardian *Meenakshi Rao*.
- [ ] Edit Meenakshi → also tick **Diya Patel** → save. **Expect:** two wards listed.
- [ ] Edit Meenakshi → untick Diya → save. **Expect:** back to one ward.
- [ ] Overview. **Expect:** all 5 checklist steps ticked; the checklist is replaced by a **This term** card showing the current term (Term 3) and its date range.

### 4.5 Staff and admins
- [ ] **People → Staff**: add `Farhan Qureshi`, department *Administration*, designation *Office Superintendent*. **Expect:** created, password `staff123`.
- [ ] **People → Admins** (superadmin only): add `Leela Menon`, designation *School Administrator*, scope *Full access*. **Expect:** created, password `admin123`.
- [ ] **Admin Management**: Leela appears; do **not** revoke yet.

### 4.6 Delete & protections
- [ ] Try to delete your own account (principal) — the row should show **Protected** / no delete button.
- [ ] Delete `Rahul Menon` (teacher). **Expect:** *Revoke access?* confirm → removed. **Subjects → Assignments**: any row that had Rahul now shows unassigned (no crash).
- [ ] Delete `Arjun Iyer`. **Expect:** VIII-A count drops to 2; roster no longer lists him.

## 3d. Admissions, certificates, identity (Phase 4)

- [ ] **Login as principal** (fresh school from §0). Its password still works — first-run accounts existing before Phase 4 aren't forced to change; but a NEW account you create next should be.
- [ ] **People → Staff**: add `Priya Menon`. **Expect:** the created-account modal password still shown; that account, on first login, is **forced to `/change-password`** before reaching the portal.
- [ ] Log in as Priya with the one-time password → redirected to Change Password → set a new one → lands in the portal. Log out, log back in with the new password → works; old password → fails.
- [ ] **Login page → Forgot password?** for Priya's email → dev mode shows a reset link → open it → set a password → login with it works.
- [ ] **Staff/Admin → Verifications**: empty initially.
- [ ] **Parent** (create one via People, or use one from earlier sections) logs in → sees an unverified banner → uploads any file as an ID document → status *Pending*.
- [ ] **Staff → Verifications**: the parent appears Pending → **Verify**. Parent's badge clears; **Permission Slips** they previously couldn't act on now work (verification-gated).
- [ ] Parent tries the old fake-OTP path (there isn't one anymore) — confirm no self-verify control exists on their own account.
- [ ] **Applications → Admissions & Certs** (staff): create an **Admission** application for a new applicant into an existing class → **Verify → Approve**. **Expect:** a one-time credentials screen for the new student (and a new parent if the guardian email didn't already exist); the student can log in immediately and is enrolled in that class with the next free roll number.
- [ ] Student/parent → **Applications** (or **TC & Bonafide**): apply for a **Bonafide** certificate → staff Verify → Approve → **download the certificate PDF** (opens/downloads correctly, has the student's name, class, a serial number, and a QR code).
- [ ] Apply for a **TC** for a student → approve → that student's enrollment shows **transferred** in their People row; TC PDF downloads.
- [ ] **Board Registration**: teacher **Prefill** a student's registration from their enrollment → edit if needed → **Validate** (teacher) → **Send to board** (principal only — staff sees no Send button) → **Download marksheet** PDF (reflects real Gradebook marks).
- [ ] **Profile** (avatar button, top right, any role): edit phone/address, upload a photo → avatar updates everywhere; change password from here too.
- [ ] **Settings → Admin Management** (superadmin): create an admin, change an existing admin's role, revoke one (not yourself, not the last superadmin).
- [ ] **Settings → Recent activity**: filter by entity `application` and by actor → list narrows correctly.

## 3e. Finance (Phase 5)

- [ ] **Fee Setup → Heads**: add `Tuition`, `Transport`. **Structures**: pick CBSE VIII-A + current term, add lines (Tuition 40000, Transport 8000), due date → **Generate invoices** → toast `created: 2` (or however many active students). Re-click **Generate** → `created: 0, skipped: 2` (idempotent).
- [ ] **Fee Setup → Invoices**: filter by the class/term → both students Due. Add a concession to one → total drops. **Waive** the other → status Waived.
- [ ] **Student/parent → Payments**: sees the invoice; **Pay** → sandbox banner (no gateway keys configured) → confirms → status flips to Paid; **download receipt** PDF.
- [ ] **Collections** (staff): search the other student → record a **Cash** payment for their invoice → receipt PDF; invoice leaves the defaulter list.
- [ ] **Fee Defaulters**: a student left unpaid appears with outstanding amount and parent contact; **Send reminder** → real toast, reminder count increments (not a no-op toast). Confirm the old "Simulate call" button is gone from this screen — only real scheduling/log remains.
- [ ] **Payroll** (admin): set a salary structure for a teacher (basic + allowances) → **Run month** for the current month → payslip generated; re-run same month → no duplicate; **Mark paid**; download PDF.
- [ ] **My Payslips** (that teacher): sees the payslip and can download it.
- [ ] Sample school: defaulters list shows Kabir Singh as a full defaulter and Aarav/Diya with a smaller amount due; parent (Nisha) sees Paid + Due invoices per term; teacher (Meera) has 3 Paid payslips (Jan–Mar 2026).

---

## 5. Cross-role visibility (the point of the whole exercise)

Open a **second browser / private window** for these so you can keep the principal signed in.

### 5.1 Teacher
- [ ] Sign in as `kavya.nair@edunova.in` / `teacher123`.
  **Expect:** teacher portal. Overview tile **My classes** = `1` with *VIII-A*.
- [ ] **Take Attendance**. **Expect:** class VIII-A with Ishaan and Diya listed (no picker needed since she has one class). *(Saving here is still a stub — see §9.)*
- [ ] **Upload Grades**. **Expect:** same two students; subject dropdown includes Mathematics.
- [ ] **My Timetable**. **Expect:** *No timetable published for this term yet* (builder is Phase 2). Term tabs show Term 1 / Term 2 (Winter) / Term 3.
- [ ] She must **not** see Academic Setup, People, or Settings in the sidebar.

### 5.2 Student
- [ ] Sign in as `ishaan.rao@edunova.in` / `student123`.
  **Expect:** Overview tile **My class = VIII-A · 2 students**; *Class rank —*; Attendance *—*.
- [ ] **Timetable** heading subtitle says **Class VIII-A**; grid shows the empty state.
- [ ] **Attendance**, **Marks & Grades**, **Rank List**: each shows an empty state for the term — no crash.
- [ ] **My Report**: opens for Ishaan; *Health records* section is visible (he's the student).

### 5.3 Parent
- [ ] Sign in as `parent.meenakshi.rao@edunova.in` / `parent123`.
  **Expect:** Overview tile **Attendance** subtitle mentions *Ishaan*; **Fees due ₹0**.
- [ ] **Student Report**: opens Ishaan's report automatically (no picker).
- [ ] **Holiday Requests → New**: the student is prefilled/selected as **Ishaan Rao** (not "Aarav"). Submit one.
  **Expect:** appears in the list as Pending.
- [ ] **Timetable** subtitle says **Class VIII-A**.
- [ ] (Back as principal) edit Meenakshi and add **Diya** as a second ward, then reload the parent window → **Holiday Requests → New** now shows a **Student select** with both wards.

### 5.4 Principal sees the parent's action
- [ ] As principal: **Leave Approvals**. **Expect:** Meenakshi's request for Ishaan is listed. Approve it.
- [ ] Reload the parent window → request shows **Approved**.

### 5.5 Permission enforcement is server-side
- [ ] In the **student** window, open DevTools → Console and run:
  ```js
  fetch('http://localhost:4000/api/academic/classes', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+localStorage.getItem('edunova_token_v1')}, body: JSON.stringify({academicYearId:'x', grade:'I', section:'A'})}).then(r=>r.status).then(console.log)
  ```
  **Expect:** `403`.
- [ ] Same call in the **principal** window (with a real `academicYearId` from Years & Terms, or just watch for `400`/`404` rather than `403`).
  **Expect:** not `403` — the server allows the role and only rejects on data.

## 3f. HR (Phase 6)

- [ ] **Settings/HR → Leave Types** (admin): add `Casual` (12/staff), `Sick` (10/staff), `Student leave` (0 = unlimited/student).
- [ ] **Parent → Holiday Requests → New**: pick ward + `Student leave`, date range, reason → submit.
- [ ] **Teacher (class teacher) → Leave Approvals**: the request appears under `scope=approvals` → **Approve**. Parent sees it Approved.
- [ ] **Teacher → My Leave**: apply for `Casual`, 2 days → balance shows `2 used / 12`. **Admin → Leave Approvals** (staff scope) → approve.
- [ ] **Teacher → My Contract**: view the contract, **Sign** (employee side) → status stays Draft until the admin also signs.
- [ ] **Admin → Contracts & Exit**: create a Draft contract for a new hire, **Sign** (admin side) → once both signed, status **Active**. **End** an existing Active contract with a reason → **Ended**.
- [ ] **Teacher → My Contract → Resign**: submit with a last-working-date less than 30 days out → accepted, shown as short-notice.
- [ ] **Admin → Contracts & Exit → Resignations**: approve it. If the last-working-date has already passed, that account **cannot log in again** (`Account inactive`); if it's in the future, they can still log in until then.
- [ ] **Duties**: staff/admin create a duty with an assignee (a teacher); the assignee can mark it **Done** but cannot revert it; staff/admin can toggle freely; delete a duty.
- [ ] Sample school: teacher@edunova.in has an Active, both-signed contract and 1 seed duty; admin sees resignation `res1` (Pending, for Rahul Verma / u-t4).

---

## 6. Settings: audit, sample data, reset

As principal:

- [ ] **Settings → Recent activity**.
  **Expect:** newest first; rows for the things you just did (`create user`, `update classSubject`, `delete user`, `set-current term`, …) with your name as actor.
- [ ] **Settings → Sample school**.
  **Expect:** button is **hidden** with the note *Available only on an empty school. Reset first…* (because you now have data).
- [ ] **Danger zone → Reset school…** → the modal. Type `reset` (lowercase).
  **Expect:** the **Delete everything** button stays disabled.
- [ ] Type `RESET` → Delete everything.
  **Expect:** toast *School reset — only your account remains*; School data card back to zeros / People 1; Overview shows the setup checklist again; Years & Terms empty.
- [ ] The teacher/student/parent windows: reload each.
  **Expect:** bounced to `/login` (their accounts no longer exist), and signing in with the old credentials fails.
- [ ] **Load sample school** (button now visible) → click.
  **Expect:** toast *Sample school loaded*; School data: 1 year, 3 terms, 2 boards, 12 grades, 4 classes, 6 subjects, 18 curriculum rows, 6 rooms, 19 people. Overview checklist gone.
- [ ] Click **Load sample school** logic again is impossible (button hidden). Fine.
- [ ] **Classes & Sections**: X-A, X-B, IX-A, IX-B all under a CBSE heading; X-A's class teacher is *Meera Krishnan*; **Roster** of X-A lists Aarav Sharma (12) and Diya Patel (4).
- [ ] **Classes → X-A → Subjects & teachers**: all 6 subjects with teachers (Mathematics → Meera Krishnan, Physics → Arjun Nair, …). **Curriculum → CBSE → X** lists the same six as core.
- [ ] **People → Parents**: Nisha Sharma's ward is *Aarav Sharma (X-A)*.

---

## 7. Legacy modules with the sample school loaded

The point here is regression: the old demo flows still work now that data comes from the server. Sign in as each sample account.

**Student (`student@edunova.in`)**
- [ ] Timetable shows the full X-A grid, cards readable without hovering (subject, teacher, room, time); legend shows all three break types.
- [ ] Attendance, Marks, Rank List all show data for Term 3; Rank List's "You" row is **Aarav Sharma** (he's the logged-in student, not a hardcode — confirm by logging in as `diya.p@edunova.in` / `student123`: her Rank "You" row is Diya).
- [ ] School Feed: like a post, add a comment → both persist after reload.
- [ ] Event Highlights: **No highlights published yet** (Rickroll placeholders are gone).

**Parent (`parent@edunova.in`)**
- [ ] Overview: Attendance subtitle *Term 3 · Aarav*; Fees due **₹6,500** (computed from Aarav's due receipts, not a literal — verify by paying it in *Payments* and watching the tile drop to ₹0).
- [ ] Messages: threads render; sending a message persists after reload.
- [ ] Permission Slips / Health Records / Achievements: lists populated; add an achievement → persists.

**Teacher (`teacher@edunova.in`)**
- [ ] Overview: *My classes 1 · X-A*. Take Attendance / Upload Grades show the X-A roster.
- [ ] Board Registration: only X-A students.

**Staff / Admin**
- [ ] Attendance Mgmt, Applications, Calendar Mgmt (add an event → shows on student's Calendar and Overview "Coming up"), Fees, Fee Defaulters, Discipline, Student Reports all open with data and no console errors.
- [ ] Admin sees **Academic Setup** and **Settings** but Settings has **no** Sample school / Danger zone cards (superadmin only) — just School data and Recent activity.

---

## 8. Persistence & multi-device

- [ ] Do any write (e.g. add a room) in one browser; reload the **other** browser as principal.
  **Expect:** the room is there — data lives on the server, not in the browser.
- [ ] Stop the API (`Ctrl-C` on `server:dev`), reload the app.
  **Expect:** "Loading EduNova…" then the login page (token check failed) — no crash. Restart the API; sign in works again and all data is intact.
- [ ] Restart Postgres (`docker compose restart`) → data still intact (named volume).

---

## 9. Known limitations — do NOT log these as bugs

These are scheduled in `.agents/edunova/rebuild-plan.md`:

Global search still doesn't exist. Teacher leave/resignation submission still doesn't exist as a real flow (Phase 6). The legacy `SchoolData` JSONB blob and its denormalized legacy `User` columns are gone (Phase 10) — `GET /api/data` is now a slim endpoint computing `terms`/`subjects` from real tables, kept only because a handful of older screens still read it that way. Production deployment tooling (`docker-compose.prod.yml`, Dockerfiles, backup cron) is built (see section 11) but has not been exercised against a real production server.

**Playwright e2e** (`e2e/*.spec.ts`, `npm run e2e`) — 6 tests, all passing: login (valid/invalid), setup checklist, timetable publish → student sees it, attendance → parent sees it, fee payment → drops off the defaulters list. These share the `/api/auth/login` rate limit (10 attempts/15min, Phase 10) with each other and with anyone doing manual testing at the same time — running the full suite twice back-to-back, or right after a burst of manual logins, can 429 on the suite's own login calls. That's the rate limiter working as designed, not a test bug. If it happens, either wait ~15 minutes or reuse the still-valid cached token at `node_modules/.cache/e2e-superadmin-auth.json` (each token lives 15 minutes) rather than re-running the whole suite immediately.

Also expected: the login page still lists all six demo roles with prefilled credentials — they only work after **Load sample school**.

---

## 11. Deployment (Phase 10 §6)

Do this on a spare machine or VM, not your dev box (it binds :80 by default and expects `docker` + `docker compose`):

- [ ] `cp .env.example .env` and fill in `POSTGRES_PASSWORD` + `JWT_SECRET` with real random values.
- [ ] `docker compose -f docker-compose.prod.yml build` completes without error (three images: `api`, `nginx`, plus pulled `postgres`/`backup`).
- [ ] `docker compose -f docker-compose.prod.yml up -d` — all four containers (`postgres`, `api`, `nginx`, `backup`) reach `Up`/`healthy`.
- [ ] `docker compose -f docker-compose.prod.yml logs api` shows `prisma migrate deploy` running and applying migrations, then `EduNova API listening on http://localhost:4000`, before the container is considered ready.
- [ ] `curl http://localhost/healthz` → `{"ok":true,"db":true}` (through nginx's proxy, not hitting `api` directly).
- [ ] Visit `http://localhost/` in a browser → the EduNova login page loads (confirms the SPA build + nginx SPA fallback for client-side routes — try refreshing on a deep link like `/login`).
- [ ] Sign in and confirm API calls succeed (Network tab shows same-origin `/api/...` requests, no CORS errors).
- [ ] Upload something (e.g. an avatar or a certificate attachment) and confirm it persists across `docker compose ... restart api`.
- [ ] After the stack has run past the `SCHEDULE` window (or trigger a manual `docker compose -f docker-compose.prod.yml exec backup /backup.sh` if the image supports it), confirm a `.sql.gz` file appears under `./backups/daily/`.
- [ ] `docker compose -f docker-compose.prod.yml down` then `up -d` again (no `-v`) — confirm the database and any uploaded files from earlier are still there (volumes persisted).

---

## 10. Report template

```
Section: 4.3
Step: Edit Arjun → change class to VIII-A
Expected: VIII-B shows 0 students
Saw: VIII-B still shows 1 student until hard reload
Console: (paste any red error)
```
