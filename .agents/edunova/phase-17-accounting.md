# Phase 17 — Accounting / General Ledger (Track B6 of the ERP roadmap)

This is the largest single item in the ERP roadmap — comparable in scope to Fees + Payroll combined. Unlike every other phase, this one carries real correctness stakes (a wrong ledger is worse than no ledger), so this spec is intentionally more conservative and prescriptive than earlier phases, and the implementation should lean toward "correct and simple" over "feature-complete."

**Scope discipline**: this phase is a real double-entry ledger with auto-posting from Fees and Payroll, manual journal entries for everything else, and three reports (Trial Balance, P&L, Balance Sheet). It is NOT: multi-currency, multi-entity/branch accounting, tax computation/filing, bank reconciliation/statement import, budgeting, or accrual-vs-cash-basis switching. If asked to guess on any ambiguous accounting judgment call not covered below, prefer the simpler, more conservative choice and document the assumption clearly rather than guessing silently.

## Data model

- `Account { id, schoolId, code (string, e.g. "1000", school-defined but should be seeded with a sensible default chart), name, type (Asset | Liability | Equity | Income | Expense), parentId? (for a simple hierarchy, e.g. "Cash" and "Bank" under "Current Assets"), isSystem (bool — true for accounts auto-created/used by the Fees/Payroll integration, to discourage deletion), active (bool) }`
- `JournalEntry { id, schoolId, date, memo, reference? (free text, e.g. "Invoice INV-2026-042" or "Payroll Sept 2026"), sourceType (Manual | FeePayment | Payroll | Other), sourceId? (nullable FK-by-convention to the originating FeePayment/Payslip id, not a real Prisma relation since it's polymorphic — just store the id and type), createdById, createdAt, postedAt (a JournalEntry is posted immediately on creation in this phase — no separate draft/approval workflow, keep it simple) }`
- `JournalLine { id, entryId, accountId, debit (decimal, >= 0), credit (decimal, >= 0, exactly one of debit/credit is non-zero per line — enforce in the zod schema and service, not just trust the caller) }`
- **Invariant, enforced server-side on every entry creation, inside a transaction**: `sum(lines.debit) === sum(lines.credit)` for the whole entry. Reject with a clear 400 if unbalanced — never write an unbalanced entry.

## Default chart of accounts (seed on first use / at school creation — small, sensible starter set)

Assets: Cash, Bank. Liabilities: (a placeholder, e.g. "Accounts Payable" — used if you wire in vendor-payment posting from Inventory, otherwise can stay unused). Equity: "Opening Balance" (a catch-all for any manual opening entries an admin wants to make when first setting this up). Income: "Fee Income", "Donation Income" (for Alumni donations, if you choose to auto-post those — see below, optional). Expense: "Salary Expense", "Utilities Expense", "Maintenance Expense", "Other Expense".

This is a STARTER set, not exhaustive — admin can add more accounts through the UI. Seed exactly this set (or something close to it, using your judgment) so the auto-posting integrations below have real accounts to post against out of the box.

## Auto-posting integration (read-only hooks into existing modules — do not change their core behavior)

- **Fee payment received** (existing `fees` module, wherever a `Payment` row is created/confirmed — e.g. `fees/service.ts`'s payment-confirmation function): after a successful payment, auto-create a balanced `JournalEntry` (`sourceType: FeePayment`, `sourceId: payment.id`): Debit "Bank" (or "Cash" — pick one consistently, document the choice), Credit "Fee Income", for the payment amount. Wrap in try/catch — a ledger-posting failure must NEVER block or roll back the actual fee payment; log the failure and continue (mirror how the Phase 9 notification piggyback was built to fail-open, check that code for the pattern).
- **Payroll paid** (existing `payroll` module, wherever a `Payslip` is marked paid): auto-create a balanced entry (`sourceType: Payroll`, `sourceId: payslip.id`): Debit "Salary Expense", Credit "Bank", for the net pay amount. Same fail-open requirement.
- Do NOT modify the Fees or Payroll service functions' actual logic, return shapes, or error behavior — only ADD a best-effort side-effect call at the point of success. If you can't find a clean single choke point for "payment confirmed" or "payslip marked paid" without touching more than a couple of lines, that's fine — a couple of lines of addition is expected; just don't restructure those modules.
- Optional, only if trivially easy given how Phase 13 (Alumni) turns out: auto-post an Alumni donation as Debit Bank / Credit "Donation Income." Skip if Phase 13 isn't done/available yet or if it adds meaningful coordination overhead — this is a nice-to-have, not required.

## Manual journal entries

- `POST /accounting/journal-entries` — admin/superadmin only, body: `{date, memo, reference?, lines: [{accountId, debit, credit}, ...]}` (at least 2 lines, balanced, validated server-side as above).
- `GET /accounting/journal-entries` — list with filters (date range, account, source type), paginated (reuse the cursor-pagination helper from `server/src/lib/pagination.ts` built in Phase 10).
- No edit/delete of a posted entry in this phase (real accounting doesn't let you silently edit history) — if a correction is needed, the correct pattern is a reversing entry (a new entry that undoes the old one). You do NOT need to build an automated "reverse this entry" button in this phase — a manual reversing entry through the normal creation form is sufficient; note this as a known limitation for a future phase, not a gap to solve now.

## Reports

- `GET /accounting/reports/trial-balance?asOf=<date>` — every account with a non-zero balance as of that date, split by debit/credit column, with a total row (should balance to zero).
- `GET /accounting/reports/profit-and-loss?from=<date>&to=<date>` — sum of Income accounts minus sum of Expense accounts for the period, broken down by account.
- `GET /accounting/reports/balance-sheet?asOf=<date>` — Assets, Liabilities, Equity as of that date (Assets should equal Liabilities + Equity — if computed correctly from a balanced ledger this is automatic, not something to separately enforce).
- All three: admin/superadmin only, since this is sensitive financial data.

## Frontend

- **Chart of Accounts** screen (admin/superadmin): list/create/edit accounts (simple flat or lightly-nested list, not a fancy tree UI — a clean grouped-by-type list is enough).
- **Journal** screen (admin/superadmin): list of entries (filterable by date/account/source — `FeePayment`/`Payroll`-sourced entries should visibly show they were auto-generated, e.g. a "System" badge, vs. manually created ones), a "New manual entry" form (date, memo, reference, a repeatable line editor with account picker + debit/credit, running balance-check before submit so the admin sees immediately if it doesn't balance).
- **Reports** screen (admin/superadmin): the three reports above, each a clean tabular view; a CSV/PDF export is a nice-to-have (reuse the existing pdf/CSV helpers already in the codebase if genuinely low-effort) but not required for this phase.
- Sample data: the seeded chart of accounts, plus enough real activity from the existing sample school's Fees/Payroll data to make the auto-posting visible — if the sample-data loader already creates fee payments and a payroll run, the ledger hooks firing during that same seed process should naturally populate a demonstrable ledger; verify this is actually true rather than assuming it, and add a couple of manual entries too (e.g. a seeded "Utilities" expense) so the manual-entry path is also demonstrable.

## Ground rules
Same as every previous phase, with extra emphasis given the financial-correctness stakes: additive migrations, `{router,service,schema}.ts` pattern under `server/src/modules/accounting/`, zod validation with real balance-checking (not just type checking), `requireRole()`, `HttpError`, `audit()` on every mutation, no git commands, no `/admin/reset`/`/admin/load-sample-data` except your own final step. **Before reporting done, specifically verify**: every seeded/test journal entry actually balances (write a quick server-side or curl-based check summing debits vs credits across the whole ledger and confirming it's zero), the Fees/Payroll auto-posting hooks fire correctly on a live test payment/payroll-run without altering the original Fees/Payroll behavior or breaking any of the 87 existing tests, and the three reports produce numbers that are internally consistent with each other (e.g. the P&L for the seeded activity should be reflected correctly in the trial balance for the same period). Full tsc/eslint/test verification as always.
