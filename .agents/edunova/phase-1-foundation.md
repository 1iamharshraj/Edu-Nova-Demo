# Phase 1 — Foundation Fixes (Access, Messaging, Roster)

> Status: completed in commit `73fd97b`.

## Goal

Fix the most visible data-accuracy and access-control bugs before moving to larger UI polish.

## Scope

### 1. Staff management access (`src/lib/access.ts`)

- Update `canManage` so a `staff` user can manage `student`, `parent`, and `teacher` roles.
- Keep admin/superadmin rules unchanged.
- Verify the People module for `staff` now allows editing teachers and students.

### 2. Teacher message bubble fix (`src/portal/modules/social.tsx`)

- Refactor message storage so `Message.from` stores the actual sender name instead of relative `me`/`them`.
- Update `isMine` and `myFrom` helpers to compare `m.from === user?.name`.
- Update seed data in `src/lib/data.ts` to use absolute names for seeded threads.
- Ensure the typing indicator shows the **other** participant's name, not the current user's name.
- Keep parent/student views unchanged.

### 3. Hardcoded teacher tools (`src/portal/modules/office.tsx`)

- `TakeAttendanceMod`: replace the hardcoded `ROSTER` with the actual class roster from `db.users` filtered by the teacher's class/section.
- `GradeUploadMod`: parse scores for all visible students in the selected class, not just Aarav Sharma.
- Persist marks to the store and show a summary toast.

### 4. Logged-in teacher contract (`src/portal/modules/office.tsx`)

- `ContractMod`: look up the contract by `user?.id` instead of always showing Meera Krishnan's contract.
- Fall back to an empty-state card if no contract exists.

### 5. Deterministic demo data (`src/lib/data.ts`)

- Replace `Math.random()` in `makeAttendanceRecords` with a seeded PRNG based on `studentId` + date so the same demo always produces the same data.

### 6. Parent verification hardcoding (`src/portal/ui.tsx`)

- Use the logged-in parent's `name` and `phone` in the Aadhaar + face flow instead of the hardcoded Nisha Sharma/••23 strings.

## Definition of done

- Staff can edit/delete teachers and students in the People module.
- Teacher sending a message in a parent thread shows the bubble on the right and the reply from the parent on the left.
- Take attendance and upload grades operate on the real class roster.
- Every teacher sees their own contract.
- Demo data is deterministic after reset.
- `npm run build` and `npm run lint` pass.
- Changes pushed to `origin/main`.

## Estimated files

- `src/lib/access.ts`
- `src/portal/modules/social.tsx`
- `src/lib/data.ts` (seed threads + attendance)
- `src/portal/modules/office.tsx`
- `src/portal/ui.tsx` (verify flow)
