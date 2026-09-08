# Phase 11 — Employee Management (Track A of the ERP roadmap)

Fixes the 7 gaps identified in `phase-11-plus-erp-roadmap.md` Track A. Builds on the existing `hr`, `payroll`, and `users` modules — do not duplicate what already exists (contracts, resignations, duties, leave, staff attendance are all real and working; this phase adds what's missing around them).

## A1 — Employee ID numbers

- `User.employeeId String? @unique` (nullable — only assigned to employee roles: teacher/staff/admin/superadmin, not student/parent).
- Format: `EMP-<schoolYearOrJoinYear>-<4-digit sequence>`, e.g. `EMP-2026-0042`. Generate at creation time in `POST /users` for employee roles only (reuse the pattern already used for roll-number/registration-number sequencing elsewhere in the codebase — check `applications/service.ts` or `boardRegistrations/service.ts` for the existing sequence-generation convention and match it, don't invent a new one).
- Display: People & Roles table/detail, Profile (self), Payslip PDF header, Contract PDF header.

## A2 — Real reporting line (`reportsTo`) + a simple team view

- `User.reportsTo` is currently a plain nullable `String` column, never used by any relation or UI. Convert it to a proper self-relation: `reportsTo String? ` stays as the FK column but add a Prisma relation (`manager User? @relation("Reports", fields: [reportsTo], references: [id])`, `reports User[] @relation("Reports")`) so it's queryable both directions. Write a migration that preserves any existing data (there likely isn't any real data in it yet — check sample data first).
- `POST /users` and `PATCH /users/:id`: accept `reportsTo` (must be another employee-role user in the same school; validate no cycles — a user cannot (transitively) report to themselves).
- People & Roles form: add a "Reports to" picker (searchable dropdown of employee-role users, excluding self) for teacher/staff/admin.
- New small screen or section: **"My Team"** (any employee with direct reports sees a simple list of who reports to them, each with a link to their profile) and on Profile, show "Reports to: <name>" if set. A full visual org-chart tree is NOT required for this phase — a clean list/tree-by-indentation is enough. If you have time and it's low-risk, a simple indented tree view for HR/admin (`GET /users/org-chart` returning the whole school as a tree) is a nice-to-have, not required.

## A3 — Performance reviews

New module `server/src/modules/reviews/` (or `performanceReviews` — pick one, be consistent) following the established `{schema,service,router}.ts` pattern.

- `PerformanceReview { id, schoolId, employeeId, reviewerId, cycle (string, e.g. "2026 Annual"), periodStart, periodEnd, overallRating (1-5 int, or a small enum — your call, document it), strengths (text), areasForImprovement (text), goals (text), employeeComments (text, nullable — filled by the employee), status (Draft → Shared → Acknowledged), createdAt, sharedAt, acknowledgedAt }`.
- Workflow: HR/admin (or the employee's manager, once `reportsTo` from A2 is real — use that) creates a review in `Draft`, fills ratings/feedback, then "Share" (status → Shared, employee can now see it and add `employeeComments`), employee "Acknowledge"s it (status → Acknowledged, locks further edits from either side). Reviewer/HR can still see everything at every stage; employee only sees it once Shared.
- Endpoints: `POST /reviews` (create, reviewer/HR only), `PATCH /reviews/:id` (edit while Draft), `POST /reviews/:id/share`, `POST /reviews/:id/acknowledge` (employee, adds their comments in the same call or a separate `PATCH` before acknowledging — your call), `GET /reviews?employeeId=` (self sees own; HR/admin sees anyone; a manager sees their direct reports' via the A2 relation).
- Frontend: `MyReviewsMod` (self, all roles that can be reviewed) showing past reviews read-only once acknowledged, with an "Add my comments" flow while Shared-not-yet-acknowledged. `TeamReviewsMod` or fold into an admin/HR screen — create/edit/share reviews for direct reports or (HR/admin) anyone.
- Sample data: 2-3 seeded reviews across different statuses (one Acknowledged with full history, one Shared awaiting employee comment, one Draft) so the workflow is visibly demonstrable.

## A4 — Employment history (role/designation/department/salary changes)

New model `EmploymentHistoryEntry { id, schoolId, userId, changeType (Role | Designation | Department | Salary | ClassTeacherAssignment | Other), fromValue (string, nullable), toValue (string), effectiveDate, changedById, note (nullable), createdAt }`. Append-only — never updated or deleted (except by admin audit-cleanup, out of scope here).

- Write a row automatically whenever: `PATCH /users/:id/role` changes role; `PATCH /users/:id` changes `designation` or `department`; `PUT /payroll/structures/:userId` (`upsertStructure`, from the existing payroll module) changes `basic` or the allowance/deduction total meaningfully (log the before/after basic value at minimum — full line-item diffing is a nice-to-have, not required). Do this by adding a small hook/helper called from each of those existing service functions — do NOT duplicate the write logic, just log after the fact, and do not let a logging failure ever block the actual write (wrap in try/catch, log-and-continue on failure).
- `GET /employment-history/:userId` — self, HR/admin/superadmin, or (per A2) that user's manager, can view. Returns entries newest-first.
- Frontend: a "History" tab/section on the employee's profile/detail view (People & Roles detail, and on one's own Profile) rendering this as a simple timeline.
- This also closes the payroll "no raise history" gap from the audit — a salary-structure change is now a permanent, queryable record even though the live `SalaryStructure` row itself still just holds the current value (don't change that upsert-overwrite behavior, just log alongside it).

## A5 — Staff disciplinary records

Do NOT extend the existing student `DisciplinaryCase` model (different visibility rules, different actors, different sensitivity — mixing them risks a real RBAC leak). Build a parallel, smaller model instead: `StaffConductRecord { id, schoolId, employeeId, reportedById, title, description, category (Conduct | Performance | Policy | Attendance | Other), status (Reported → UnderReview → Resolved), actionTaken (nullable string), fileIds (evidence uploads, reuse the existing files module), createdAt, resolvedAt, resolvedById }`.

- **Strictly HR/admin/superadmin only** — both to create/view/resolve. Not visible to the employee's manager, not visible to the employee themselves (this is a deliberate, more restrictive default than student discipline — note this choice in your report so it can be revisited if wrong). No teacher/staff-general visibility at all.
- Endpoints: `POST /staff-conduct`, `GET /staff-conduct?employeeId=`, `PATCH /staff-conduct/:id` (status/actionTaken), all gated `requireRole('admin','superadmin')` only (not plain 'staff' — HR-sensitive).
- Frontend: one admin/superadmin-only screen, similar in shape to the existing `DisciplinaryCommitteeMod` but simpler (no class-teacher scoping needed since it's admin-only).

## A6 — Employee documents + ID card

- Reuse the existing `files` module entirely — no new file-storage code needed. Add a small join concept: either a generic `fileIds: string[]` array added to `User` (simplest, matches how other models attach files) for "employee documents," or a dedicated `EmployeeDocument { id, userId, fileId, label, uploadedAt }` if you want labeled documents (e.g. "ID proof," "Degree certificate") rather than an unlabeled bag — **prefer the labeled version**, it's much more useful and not meaningfully more work given the files module already exists.
- Endpoint: `POST /users/:id/documents` (upload + label, HR/admin only), `GET /users/:id/documents`, `DELETE /users/:id/documents/:docId`.
- ID card: `GET /users/:id/id-card.pdf` — a real PDF using the existing pdfkit helpers (`server/src/lib/pdf.ts`, already used for certificates/payslips/contracts — follow that exact pattern). Content: school name/logo if available, employee photo (from `User.photoFileId`), name, employee ID (A1), role/designation, a school-issued-date. A QR code linking to a verification page is a nice-to-have if there's a natural low-risk way to do it with what's already in the stack (check if `qrcode` is already a dependency — it's used elsewhere per the codebase's PDF helpers); skip it if it adds meaningful complexity.
- Frontend: a "Documents" section and a "Download ID card" button on the People & Roles detail view (HR/admin) and on one's own Profile (self, ID card only — not document management).

## A7 — Onboarding phone field for teacher/staff/admin

Trivial: in `src/portal/modules/office.tsx`'s `PeopleMod`, the `phone` field is currently only wired into the parent branch of the create/edit form. Add it to the teacher/staff/admin branches too (the `User.phone` column already exists and is already sent/received correctly for parent — just extend which roles populate it in the form and the `CreateUserInput`/`UpdateUserInput` payload). No backend change should be needed.

---

## Ground rules (same as every previous phase)
- Additive Prisma migrations only, `server/src/modules/<entity>/{router,service,schema}.ts` pattern, zod validation, `requireRole()`, `HttpError`, `audit()` on mutations.
- Never commit/push/checkout — leave everything as uncommitted working-tree changes.
- Never call `POST /api/admin/reset` or `/admin/load-sample-data` except as your own final verification step (coordinate with whatever else may be running — check first).
- Server and frontend work should be split into two parallel agents as in every previous phase, with clear file ownership: server owns `server/src/`; frontend owns `src/` but must NOT edit `src/portal/Portal.tsx` — describe exactly what nav/registration changes Portal.tsx needs in the final report instead, matching the Phase 8 pattern.
- End with `cd server && npx tsc --noEmit` clean, root `npx tsc -b --noEmit && npx eslint .` clean, `cd server && npm test` still passing (fix or extend tests if your changes affect existing coverage), and a full curl/live verification of every new endpoint and workflow state transition.
