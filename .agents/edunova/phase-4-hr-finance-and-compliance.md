# Phase 4 — HR, Finance & Compliance

## Goals

Implement HR workflows (contracts, resignations), fee defaulters + AI parent calls, disciplinary committee, and a legitimate payment gateway (desktop only).

## Changes

### 1. Contracts controlled by admin (`src/portal/modules/contracts.tsx` or `office.tsx`)

- Admin/superadmin can create/view contracts for teachers and staff.
- Contract template: designation, salary, start/end date, clauses, status.
- Teacher/staff can view their own contract in their portal.
- Status: Draft → Active → Resigned / Terminated.
- Link contract to salary receipts.

### 2. Resignation approval workflow (`src/portal/modules/contracts.tsx` or `office.tsx`)

- Teacher/staff submits resignation with reason and last working date.
- Admin/superadmin sees pending list and approves/declines.
- If approved, contract status updates to "Resigned" and notice period starts.
- Notice card appears in the employee's portal with a countdown.
- Resignation cannot be submitted if a disciplinary case is open (optional guard).

### 3. Fees & Fee Defaulters (`src/portal/modules/actions.tsx` or `feeDefaulters.tsx`)

- **Fee Defaulters view** (class teacher, admin, staff):
  - List students with due fees by class/section.
  - Show amount due, last paid date, contact number, parent name.
  - Quick actions: "Call parent now", "Schedule AI call", "Send reminder".
- Admin/staff can assign fees to all students or specific classes.
- Parents/students see dues and receipts.

### 4. AI Parent Calls (`src/portal/modules/actions.tsx` or `feeDefaulters.tsx`)

- Simulated voice-bot call to parents:
  - Requester picks reason: fee reminder, disciplinary follow-up, attendance concern, general update.
  - Select language and preferred time.
  - Status: Scheduled → In Progress → Completed → Failed.
  - Simulate a call with a transcript: greeting → reason → parent response → confirmation.
  - Store `AIParentCall` record.
- **Call Logs**:
  - All calls visible to admin/staff/class teacher (scope based on role).
  - Filter by status, student, date, requester.
  - View transcript, duration, outcome.

### 5. Disciplinary Committee (`src/portal/modules/disciplinary.tsx` or `office.tsx`)

- **Complaint log**: reportedBy, date, description, witnesses, evidence (demo file upload), status.
- **Hearing workflow**: Scheduled → Heard → Decision → Action Taken → Appeal (optional) → Closed.
- **Actions**: Warning, Suspension, Expulsion, Community Service, Parent Meeting Required.
- **Visibility**:
  - Admin/superadmin/staff/class teacher can view and update.
  - Student/parent can see their own cases.
- Demo seed: a few pending and closed cases, including one for a named student.
- Link disciplinary outcomes to student profile report and certificates if needed.

### 6. Payment Gateway (desktop only) (`src/portal/modules/actions.tsx` or `payments.tsx`)

- Create a legitimate-looking payment modal:
  - Tabs: UPI, Card, Net Banking.
  - Simulated card form with validation (no real processing).
  - Simulated UPI QR with app icons.
- **Mobile**: Show a "For security, fee payments are available on desktop" message. Allow viewing dues and receipts.
- **Desktop**: show payment modal and allow "Pay". On success, update receipt status and generate receipt.

## Definition of done

- Contracts are manageable by admin and visible to employees.
- Resignation requires approval before notice period starts.
- Fee defaulters list and AI calls are functional for authorized roles.
- Call logs are searchable and filterable.
- Disciplinary committee supports full complaint-to-action workflow.
- Payment gateway is desktop-only and looks legitimate.
- All financial/HR state persists to `localStorage`.

## Files to modify/create

- Modify `src/portal/modules/actions.tsx`
- Modify `src/portal/modules/office.tsx`
- Create `src/portal/modules/contracts.tsx` (optional split)
- Create `src/portal/modules/feeDefaulters.tsx` (optional split)
- Create `src/portal/modules/disciplinary.tsx` (optional split)
- Create `src/portal/modules/payments.tsx` (optional split)
- Modify `src/lib/data.ts` (seed contracts, resignations, defaulters, calls, cases)
- Modify `src/portal/Portal.tsx` (register new modules)
