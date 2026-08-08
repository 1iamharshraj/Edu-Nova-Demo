# Phase 2 — People & Admin Workflows

## Goal

Strengthen admin/staff management of students, teachers, admissions, and work assignments.

## Scope

### 1. Admissions & certificates pipeline (`src/portal/modules/office.tsx`)

- Expand `ApplicationsMod` to show a clear pipeline:
  - Pending → Verified → Approved / Declined.
- Add an admin/staff notes field for each application.
- Link an approved admission to a new student profile (auto-create a basic `User` record).
- Allow downloading approved certificates as styled `.txt` (demo) or a printable view.
- Filter applications by kind (Admission, TC, Bonafide, Disciplinary).

### 2. People → student report link

- In `PeopleMod`, add a **View full report** action on every student card.
- For admin/staff, open `StudentReportMod` for the selected student.
- Keep the existing `StudentReportsMod` wrapper in `Portal.tsx`.

### 3. Admin control over all students/teachers/staff

- Verify `admin` and `superadmin` already see all relevant menus (People, Student Reports, Contracts, Attendance, Fees, Discipline).
- Add a quick-access **Students**, **Teachers**, **Staff** tab/filter in the admin Overview if not already prominent.
- Ensure `canManage` allows admin to manage `staff`, `teacher`, `student`, `parent`.

### 4. Work assignment with assignees (`src/portal/modules/office.tsx`)

- Add an `assigneeId` field to `WorkUpload` or create a new `WorkAssignment` type.
- In `WorkAssignMod`, let staff/admin select a teacher/staff assignee when creating a duty.
- Show the assignee avatar and name on each card.
- Mark assignments as Done/Assigned and persist.

### 5. Global term selection by superadmin

- Add a small **Set active term** control in the superadmin/admin Overview or Calendar page.
- Update `Term.current` in the store so all modules default to the selected term.
- Persist to `localStorage`.

## Definition of done

- Admin/staff can process admissions with notes and status transitions.
- Every student in People management has a one-click full report.
- Work assignments have named assignees and persist status.
- Superadmin can set the active term from the portal.
- All admin menus give control over students, teachers, and staff.
- Build + lint pass; commits pushed.

## Estimated files

- `src/portal/modules/office.tsx`
- `src/portal/Portal.tsx`
- `src/lib/data.ts` (types/seed)
- `src/lib/store.tsx`
