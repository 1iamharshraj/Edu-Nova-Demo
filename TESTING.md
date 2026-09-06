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

| Area | Current state | Phase |
|---|---|---|
| Timetable | Read-only; no builder; sample data only | 2 |
| Take Attendance (teacher) | Save shows a toast but writes nothing | 3 |
| Upload Grades | Writes to a per-term (not per-student) row | 3 |
| Attendance / Marks / Ranks for a **new** school | Empty until Phase 3 — only sample data has them | 3 |
| Forced password change (`mustChangePassword`) | Flag exists, not enforced; no password change UI | 4 |
| Profile editing, notifications, search | Don't exist | 4, 7 |
| Fees "Assign to all classes" | Creates an owner-less receipt | 5 |
| Salary, payroll | Sample data only | 5 |
| Teacher "My Leave", "Declare notice period" | Local state + toast only | 6 |
| Feed authoring, new conversations, bot auto-replies, fake presence | Unchanged | 7 |
| Health records | Not per-student; only shown to the student and their guardian | 8 |
| AI doubt clearing, AI parent calls "simulate", meet links | Simulated | 9 |

Also expected: the login page still lists all six demo roles with prefilled credentials — they only work after **Load sample school**.

---

## 10. Report template

```
Section: 4.3
Step: Edit Arjun → change class to VIII-A
Expected: VIII-B shows 0 students
Saw: VIII-B still shows 1 student until hard reload
Console: (paste any red error)
```
