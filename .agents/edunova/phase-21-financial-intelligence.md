# Phase 21 — Financial Intelligence

Extends the real double-entry GL from Phase 17 (`Account`/`JournalEntry`/`JournalLine`) and the existing Fees module. Independent of Phase 18/19 — can run in parallel with Phase 19, or on its own.

## 1. Cash-flow forecasting

Not a new model — a computed report. `GET /api/accounting/reports/cash-flow-forecast?months=3` (admin/superadmin): for each of the next N months, project **inflow** from known fee due-dates not yet paid (`FeeInvoice` rows with `dueDate` in that month and `status != 'Paid'`, using the invoice total minus paid-so-far) and **outflow** from the known recurring payroll obligation (this month's total `SalaryStructure.basic + allowances` across active employees, assumed roughly constant unless there's a clear way to detect seasonality — don't over-engineer this, a straightforward "next N months = current bank balance + projected fee collections − projected payroll" is the right level of sophistication for v1). Combine with the current Bank account balance (from the GL, Phase 17) as the starting point. Return a month-by-month projected balance.

## 2. Per-program profitability

`GET /api/accounting/reports/program-profitability?termId=` — for a defined "program" (a board+grade combination, a stream, or — once Phase 24/28 exist — a hostel or a campus), sum real Income (fee collections tagged to that program's classes/students) against real Expense (a proportional share of `Salary Expense` for teachers assigned to that program's classes, plus any directly-attributable expense journal entries). **Be honest about the limitation**: allocating shared costs (a teacher who teaches both CBSE and ICSE sections, or general school overhead) to one "program" is inherently an estimate, not an exact number — compute a defensible, clearly-labeled allocation (e.g. proportional to periods taught for that program) and document the methodology in the API response itself (`{..., methodology: "expense allocated proportionally to teaching periods"}`) so nobody mistakes an estimate for precise accounting.

## 3. Concession/scholarship impact modeling

`GET /api/accounting/reports/concession-impact?termId=` — total value of fee waivers/discounts actually applied this term (requires checking how concessions currently work in the Fees module — if `FeeInvoice`/`FeeStructure` already has a discount/waiver concept, use it; if not, this item depends on item 4 below existing first, so build item 4's `Scholarship` model before this report).

## 4. Formal scholarship program

- `Scholarship { id, schoolId, name, type (MeritBased|NeedBased|SiblingDiscount|StaffWard|Other), discountType (Percentage|FixedAmount), discountValue, criteria? (free text), active }`
- `ScholarshipAward { id, schoolId, scholarshipId, studentId, academicYearId, status (Pending|Approved|Rejected), approvedById?, approvedAt?, appliedToInvoiceIds (string array or join — track which invoices actually got the discount) }`
- Approval workflow: staff/admin proposes an award (Pending) → admin/superadmin approves → **on approval, the discount must actually apply to that student's fee invoices for the year** (this needs to hook into the existing fee-invoice-generation logic — read `server/src/modules/fees/service.ts` first to find the cleanest integration point; a scholarship discount should reduce the generated invoice total, and the resulting reduced revenue should be correctly reflected when Phase 17's auto-posting hook fires, i.e. don't post the pre-discount amount to the ledger).
- `/api/scholarships` and `/api/scholarships/awards` CRUD, staff/admin (propose), admin/superadmin (approve).

## 5. Parent-facing fee installment plans

- Extend `FeeStructure` or add `FeeInstallmentPlan { id, schoolId, feeStructureId, installments (JSON array of {label, percentage or amount, dueDate offset}) }` — check the existing `FeeStructure`/`FeeInvoice` generation logic first (`server/src/modules/fees/service.ts`) to see whether the cleanest implementation is a genuinely new installment-plan concept, or whether invoice generation can simply be parameterized to split one term's fee into N invoices with staggered due dates using logic that's mostly already there (idempotent generation already exists per Phase 5 — extend it, don't replace it).
- A parent-facing choice at admission or fee-setup time: pay in full, or opt into an installment plan (quarterly/monthly) — generates the staggered invoice schedule instead of one lump invoice, each with its own reminder per the existing reminder system.
- Frontend: an admin screen to define installment plans per fee structure, and a parent-facing choice (at the point they'd otherwise see one invoice) plus their existing Payment Gateway screen naturally already handles paying multiple smaller invoices — verify this is genuinely true before assuming no payment-flow changes are needed.

## Ground rules
Same as every previous phase: additive migrations, extend `server/src/modules/accounting/` for items 1-3 (pure report endpoints) and add `server/src/modules/scholarships/{router,service,schema}.ts` for item 4, extend `server/src/modules/fees/` for item 5 (do not fork Fees into a parallel module — this must be a real extension of the existing idempotent invoice-generation logic), zod validation, `requireRole()`, `HttpError`, `audit()` on mutations (especially scholarship approval — this is real money), add cleanup blocks to `POST /reset` for any new tables, no git commands, no `/admin/reset`/`/admin/load-sample-data` except your own final step, server/frontend split with Portal.tsx changes described-not-made by the frontend agent, full tsc/eslint/87-test verification (pay special attention to the existing Fees and Payroll tests — you're extending, not replacing, that logic, so they must still pass), live curl+UI verification — specifically prove a scholarship-discounted invoice generates the correct reduced total AND the correct reduced amount posts to the GL (re-run the Phase 17 balance check: whole ledger still sums to zero after a discounted payment).
