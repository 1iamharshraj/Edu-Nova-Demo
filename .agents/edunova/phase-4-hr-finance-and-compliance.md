# Phase 4 — HR, Finance & Compliance Refinements

## Goal

Polish the finance, HR, and compliance modules that are already functional but need better UX.

## Scope

### 1. Payment gateway legitimacy (`src/portal/modules/paymentGateway.tsx`)

- Add clearer status steps (Amount Due → Choose Method → Pay → Receipt).
- Improve UPI QR, card form, and net-banking UI spacing and labels.
- Keep the mobile viewport disabled with a friendly "Open on desktop for payments" card.
- On successful payment, generate and show a styled receipt summary before download.

### 2. Fee defaulters & AI call logs (`src/portal/modules/feeDefaulters.tsx`)

- Ensure class teacher, admin, and staff can see defaulters and request an AI call.
- Add a **Call log** tab with filters: status, student, date, requester.
- Allow archiving/deleting completed calls (admin/superadmin only).
- Show call duration and outcome on the transcript card.
- Link each call to the student's full profile report.

### 3. Disciplinary committee linkage (`src/portal/modules/disciplinary.tsx`)

- When a disciplinary case is closed, record the outcome in the student's profile.
- Show a badge on the student profile if there is an active or closed case.
- Allow admin/staff to generate a warning letter or certificate hold note from the case view.

### 4. Contracts & resignations (`src/portal/modules/office.tsx`)

- Add a notice-period countdown card for the employee after resignation is approved.
- Link salary receipts to the contract designation.
- Show contract status clearly in the People list for teachers/staff.

### 5. Admin/staff fee assignment UX

- Allow bulk fee assignment by class/section.
- Add a confirmation summary before assigning fees.
- Show per-student fee breakdown in the student profile report.

## Definition of done

- Payment gateway feels like a real checkout on desktop and is clearly disabled on mobile.
- AI call logs are filterable, archivable, and linked to student profiles.
- Disciplinary outcomes appear in the student profile report.
- Resignation approval triggers a clear notice-period countdown.
- Build + lint pass; commits pushed.

## Estimated files

- `src/portal/modules/paymentGateway.tsx`
- `src/portal/modules/feeDefaulters.tsx`
- `src/portal/modules/disciplinary.tsx`
- `src/portal/modules/office.tsx` (contracts/resignations + fees)
- `src/portal/modules/studentReport.tsx`
- `src/lib/data.ts` (types/seed if needed)
