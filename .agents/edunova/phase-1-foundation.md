# Phase 1 — Foundation

## Goals

Lay the groundwork for the entire improvement plan: data model, role hierarchy, access control, auth/login fixes, global theme fixes, and the first set of high-impact UI modules (timetable, calendar, attendance).

## Changes

### 1. Data model (`src/lib/data.ts`)

- Extend `Role` to include `'superadmin'`.
- Extend `User` interface with:
  - `class?: string`, `section?: string`
  - `subjects?: string[]` (teachers)
  - `department?: string` (staff)
  - `reportsTo?: string`
  - `joinDate?: string`
  - `contract?: Contract`
  - `resignation?: Resignation`
  - `attendanceId?: string`
- Add new types:
  - `Board`, `BoardDetail`, `ValidatedMark`, `Marksheet`
  - `Contract`, `Resignation`
  - `MeetingRequest`, `WorkUpload`, `AttendanceRecord`
  - `AIParentCall`, `DisciplinaryCase`, `StudentProfileReport`
- Update `DB` interface with new arrays:
  - `marksheets`, `contracts`, `resignations`, `meetings`, `workUploads`, `attendanceRecords`, `boardDetails`, `aiParentCalls`, `disciplinaryCases`, `studentProfileReports`
- Update `seedDB()`:
  - Add superadmin demo user (Principal).
  - Keep existing admin as school-level admin.
  - Seed richer profiles (class, section, subjects, department, joinDate).
  - Seed attendance records for all roles.
  - Seed sample board details, meetings, contracts, resignations, work uploads, fee defaulters, AI calls, disciplinary cases, student reports.
- Add board-grade helpers and keep existing helpers.

### 2. Access helpers (`src/lib/access.ts` — new file)

Create `canManage(currentUser, targetUser)`, `isSuperAdmin(u)`, `isAdmin(u)`, `roleRank(role)`.

Rules:
- superadmin can manage everyone except themselves if they are the only superadmin.
- admin can manage staff, teachers, students, parents — not admins or superadmins.
- staff/teacher can manage only students in their class/subject (demo scope).

### 3. Store updates (`src/lib/store.tsx`)

- `resetAll()` re-seeds with the new schema.
- `createUser(data)` helper that auto-generates email and password.
- `deleteUser(id)` guards against deleting the last superadmin or self.
- Ensure all writes go through `update(fn)` so `localStorage` stays in sync.

### 4. Login (`src/pages/Login.tsx`)

- Add superadmin demo account to `ROLES` array.
- Fix mobile role selector:
  - Use smaller text, `truncate`, or horizontal scrollable pills.
  - Ensure labels never wrap awkwardly inside buttons.
- Update blurbs to match hierarchy.

### 5. Theme fixes (`src/index.css`, `src/lib/theme.tsx`)

- Audit all hardcoded backgrounds and ensure `dark:` counterparts exist.
- Fix known overlap issues:
  - `mega-panel`, `glass-nav`, `aurora`, `grain`
  - Any card with `bg-white` must also have `dark:bg-[#14141f]`
- Add mobile safe-area padding utilities.

### 6. Portal shell (`src/portal/Portal.tsx`)

- Update `modulesFor(role)` to register new Phase 1 modules and adjust existing ones:
  - superadmin: Overview, People, Admin Management, Admissions, Attendance, Calendar, Work, Marksheet, Fees, Faculty Salary, Academic Settings, Contracts, Resignations, Disciplinary, Student Reports, Fee Defaulters, AI Calls.
  - admin: same minus Admin Management.
  - staff/teacher: add Attendance Mgmt, Calendar Mgmt, People, Fee Defaulters, Disciplinary, Student Reports, Contracts, Resignations.
  - parent/student: add Meetings, Board Marksheet view.
- Update `Overview` cards with new stats (pending admins, resignations, contracts, meetings, defaulters, disciplinary cases, AI calls).
- Add superadmin-only inline Admin Management module.

### 7. UI primitives (`src/portal/ui.tsx`)

- Add `Section`, `FilterBar`, `DataTable` wrappers if needed for Phase 1.
- Keep existing primitives consistent.
- Add `line-clamp` utilities if not already present.

### 8. Timetable redesign (`src/portal/modules/timetable.tsx` or `academics.tsx`)

- **Desktop**: modern elegant grid with days as columns, periods as rows. Each cell is a rounded card with subject color, teacher avatar, room badge, and time. Sticky header. Hover lift. Subject color legend.
- **Mobile**: day picker tabs (Mon–Fri) + vertical list of periods for selected day. No horizontal scrolling.

### 9. Common calendar (`src/portal/modules/academics.tsx` + `office.tsx`)

- `CalendarMod`: read-only for all roles; show holidays, exams, events.
- `CalendarAdminMod`: admin/superadmin can add/edit/delete events; changes reflect in all portals.
- Larger desktop calendar, better spacing, clearer event list.

### 10. Attendance for all roles (`src/portal/modules/academics.tsx` + `office.tsx`)

- Students: keep subject-wise + daily view, source from `attendanceRecords`.
- Teachers/Staff/Admins: own attendance calendar and summary.
- Admin/Staff/Superadmin: Attendance Management module:
  - Daily summary by role.
  - Filter by role/class/department.
  - Mark attendance for selected date and group.
  - View individual attendance records.
- Superadmin: can manage admin attendance and admin users.

## Definition of done

- `npm run build` passes for the foundation code (deps resolved first).
- All roles can log in and see the correct Phase 1 modules.
- Timetable is responsive and visually modern.
- Calendar edits propagate to all roles.
- Attendance data persists and covers all user types.
- Light/dark mode is consistent across Phase 1 modules.
- `.agents/edunova/` docs updated with Phase 1 progress.

## Files to modify/create

- Create `src/lib/access.ts`
- Modify `src/lib/data.ts`
- Modify `src/lib/store.tsx`
- Modify `src/pages/Login.tsx`
- Modify `src/portal/Portal.tsx`
- Modify `src/portal/ui.tsx`
- Modify `src/portal/modules/academics.tsx`
- Modify `src/portal/modules/office.tsx`
- Create `src/portal/modules/timetable.tsx` (recommended)
- Modify `src/index.css`
- Modify `src/lib/theme.tsx` (if needed)
