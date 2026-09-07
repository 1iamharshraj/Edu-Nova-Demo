# Phase 8 — Student welfare & compliance (health, slips, achievements, discipline, report, activities)

> Same conventions. Replaces blob keys `health`, `slips`, `achievements`, `disciplinaryCases`, `aiParentCalls`, `studentProfileReports`, and the localStorage `RegistrationsMod`.

## Model
```
HealthRecord        id, schoolId, studentId, kind Vaccination|Allergy|Condition|Checkup|Other, title, detail, date, addedById, verifiedById?, verifiedAt?, fileIds String[]
PermissionSlip      id, schoolId, title, detail, dueDate, classId? (null = all), createdById, requiresVerifiedParent (default true), createdAt
SlipResponse        id, slipId, studentId, parentId, decision Approved|Declined, respondedAt, note?        unique(slipId, studentId)
Achievement         id, schoolId, userId, title, detail, date, category Academic|Sports|Arts|Service|Other, verifiedById?, verifiedAt?, fileIds String[]
DisciplinaryCase    (port existing fields) + classId, deletedAt?, fileIds String[] (replaces `evidence` text), reportedById
DisciplinaryNote    id, caseId, authorId, body, createdAt                        (status-change log + free notes)
CallLog             id, schoolId, studentId, parentId?, byId, reason fee|attendance|disciplinary|general, summary, outcome confirmed|callback|unreachable|refused|other, calledAt, durationMin?
Activity            id, schoolId, kind club|house|exc|event|faculty, title, description, capacity?, opensAt?, closesAt?, forRoles String[], createdById
ActivityRegistration id, activityId, userId, registeredAt, status Registered|Waitlisted|Cancelled   unique(activityId, userId)
```

## Rules
- Health: parent/student add for self/ward; nurse/staff/admin verify; visible only to the student, guardians, class teacher, staff/admin.
- Slips: teacher (own classes)/staff/admin create; parents respond per ward; teacher sees tally; responding requires `verified` if `requiresVerifiedParent`.
- Achievements: student/teacher add own; staff/admin verify; parent sees wards'.
- Discipline: reporters teacher/staff/admin; a teacher may only report on students in their classes; parents/students read own; soft delete by admin.
- Call log: staff/teacher/admin record real calls; replaces AI call simulation.
- Activities: staff/admin create; students/teachers register per `forRoles`; capacity → waitlist.

## Endpoints
`/api/health` GET `?studentId`, POST, PATCH/DELETE `/:id`, POST `/:id/verify`.
`/api/slips` GET (scoped), POST, PATCH/DELETE, GET `/:id/responses`, POST `/:id/respond` `{ studentId, decision, note? }`.
`/api/achievements` GET `?userId`, POST, PATCH/DELETE, POST `/:id/verify`.
`/api/discipline` GET (scoped), POST, PATCH `/:id`, POST `/:id/status` `{ status, note }`, POST `/:id/notes`, DELETE `/:id` (soft).
`/api/calls` GET `?studentId`, POST, DELETE.
`/api/activities` GET `?kind`, POST/PATCH/DELETE, POST `/:id/register`, POST `/:id/cancel`, GET `/:id/registrations` (staff/admin).
`/api/reports/student/:id` → assembled dossier (profile, enrollment, attendance summary, report card, ranks, invoices, meetings, calls, discipline, achievements, health if permitted) — one call for `studentReport.tsx`.

`GET /api/data` drops the replaced keys — after this phase the blob is EMPTY; keep the route returning `{ data: {} }` until Phase 10 deletes it.

## Sample data
Port seed health (for u-s), slips (all classes; p3 responded), achievements, disciplinary cases dc1/dc2, call log ac1 → CallLog, activities from the old `RegistrationsMod` catalogue.

## Frontend
- `HealthMod`, `SlipsMod` (parent respond per ward; teacher/staff create + tally), `AchievementsMod` (categories, verify), `disciplinary.tsx` (scoped, notes timeline, evidence files, soft delete), `feeDefaulters.tsx` call section → **Call log** (record real call), `RegistrationsMod` → activities from API with capacity/waitlist + staff "Activities" admin screen, `studentReport.tsx` → `/reports/student/:id`.
- Parent verification gate on slips uses the real `verified` (Phase 4).
