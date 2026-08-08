# Phase 2 — People & Academics

## Goals

Build proper people/student management, board-aware marksheet validation for CBSE and Matric, and expand admissions/certificates.

## Changes

### 1. People Management rewrite (`src/portal/modules/office.tsx` or `people.tsx`)

- Tabs: Students, Teachers, Staff, Admins, Parents.
- Filters: class, section, subject, department, role, search by name/email.
- Desktop: table view; mobile: card list.
- Add/edit modal per role:
  - Student: name, class, section, roll, parent email, board.
  - Teacher: name, subjects, class teacher of, joining date, salary.
  - Staff: name, department, designation, joining date.
  - Admin: name, designation, access scope.
  - Parent: name, ward(s), phone.
- Delete with confirmation; guard against deleting self or last superadmin.
- Superadmin sees an extra "Admins" tab to manage admin users.
- Clicking a student row opens the full Student Profile Report.

### 2. Student Profile Report (`src/portal/modules/studentReport.tsx` or `office.tsx`)

Admin and staff can open any student profile to see a comprehensive report:

- Personal details + board details.
- Attendance summary across all terms (graph + calendar).
- Marks/grades across all terms (table + trend chart).
- Rank history.
- Achievements and co-curricular activities.
- Fee status and payment history.
- Meeting/call history.
- Disciplinary cases and complaints.
- Certificates issued (TC, bonafide, etc.).
- Health records.
- Teacher/parent notes.
- Generate printable/downloadable report (demo `.txt` or styled print view).
- Accessible from People Management and Fee Defaulters.

### 3. Marksheet Validation (CBSE + Matric) (`src/portal/modules/office.tsx` or `marksheet.tsx`)

Replace generic 3-step workflow with board-aware validation:

- Select board: **CBSE** or **Matric/State**.
- Display and validate student board details (registration, DOB, school, roll number, etc.).
- Validate subject marks: theory, practical, total; ensure totals match grade book.
- Board-specific grade computation:
  - CBSE: CGPA + skill grades.
  - Matric: percentage + rank.
- Sign-off chain: Class Teacher → Principal (superadmin) → Seal & publish.
- Once sealed, show a "Board Marksheet" view in parent/student portal.
- Seed at least one validated and one pending marksheet for demo.

### 4. Admissions & Certificates (`src/portal/modules/office.tsx`)

- Expand `ApplicationsMod`:
  - Admin/superadmin can view admissions, TC, bonafide, disciplinary.
  - Status pipeline: Pending → Verified → Approved / Declined.
  - Notes field for admin.
  - Parent/student can view and download approved certificates (demo `.txt` download).
- Link certificate issuance to disciplinary case outcomes if needed.

## Definition of done

- People management handles all five role tabs with add/edit/delete.
- Student profile report is accessible and shows all historical data.
- Marksheet validation supports both CBSE and Matric flows end-to-end.
- Admissions pipeline has clear status transitions.
- No TypeScript errors; mobile and desktop layouts work.

## Files to modify/create

- Modify `src/portal/modules/office.tsx`
- Create `src/portal/modules/people.tsx` (optional split)
- Create `src/portal/modules/studentReport.tsx` (optional split)
- Create `src/portal/modules/marksheet.tsx` (optional split)
- Modify `src/lib/data.ts` (ensure seed data supports this phase)
- Modify `src/portal/Portal.tsx` (register modules)
