# Phase 15 — Library Management (Track B3 of the ERP roadmap)

## Data model

- `Book { id, schoolId, title, author, isbn?, publisher?, category?, coverFileId? (reuse the existing files module for a cover image, optional) }` — the catalog entry (one row per title, not per physical copy).
- `BookCopy { id, bookId, barcode (unique per school), condition? (New | Good | Worn | Damaged), status (Available | Loaned | Lost | Retired), acquiredAt? }` — one row per physical copy, since a library has multiple copies of the same title.
- `Loan { id, copyId, borrowerId (a User — student or staff/teacher), issuedAt, dueDate, returnedAt?, fineAmount? (computed at return time if overdue), fineStatus (None | Pending | Paid | Waived), issuedById, returnedById? }`
- `LibrarySettings { id, schoolId, loanPeriodDays (default e.g. 14), maxActiveLoansStudent (default e.g. 3), maxActiveLoansStaff (default e.g. 5), finePerDayOverdue (default e.g. ₹2) }` — one row per school, editable by admin, so the numbers aren't hardcoded.

## Loan logic (the core of this phase)

- Issuing a loan: the specific `BookCopy` must be `Available` (reject clearly if not). The borrower must be under their role's `maxActiveLoans` limit (count their current `returnedAt: null` loans and compare) — reject with a clear message if at the limit, don't silently allow over-borrowing.
- `dueDate` = `issuedAt + loanPeriodDays` from `LibrarySettings`.
- Returning: sets `returnedAt: now`, frees the copy back to `Available` (unless marked Lost/Damaged at return time, in which case set the copy's `status` accordingly instead). If `returnedAt > dueDate`, compute `fineAmount = daysOverdue * finePerDayOverdue`, set `fineStatus: Pending`. An admin/staff can later mark a fine `Paid` or `Waived` — this is a RECORD, not a real payment flow; reuse the Fees module ONLY if you want to actually charge it as an invoice line (optional, nice-to-have, not required — a simple Paid/Waived status toggle on the Loan itself is sufficient for this phase).
- A book with NO available copies should clearly show "0 available, all on loan" in the catalog view rather than just disappearing or looking broken.

## Endpoints

- `/api/library/books` — catalog CRUD, staff/admin write, everyone read (students/parents should be able to browse the catalog).
- `/api/library/copies` — CRUD scoped to a book, staff/admin only (this is inventory management, not student-facing).
- `/api/library/loans` — `POST` (issue, staff/admin only — a student doesn't self-checkout a book, a librarian/staff member does it at the desk), `POST /:id/return`, `GET /loans?borrowerId=` (self can see own; staff/admin see all/search).
- `/api/library/settings` — `GET`/`PATCH`, admin/superadmin only.

## Frontend

- **Catalog browse screen** (all roles): search/filter books by title/author/category, see availability (copies available / total), see a book's detail (which copies exist and their status, if the viewer is staff/admin — a student just needs to know "is any copy available").
- **Staff/admin "Issue & Returns" screen**: search a borrower, see their current loans and remaining limit, issue a new loan (pick an available copy), process a return (mark condition, auto-computed fine if overdue, then Paid/Waived toggle).
- **"My Loans" screen** (self, all roles): current and past loans, due dates, any pending fines.
- **Admin "Library Settings"**: edit the loan-period/limits/fine-rate numbers.
- Sample data: 6-8 books across a few categories, 2-3 copies each (some loaned out, most available), a handful of active loans against existing sample students/teachers, one overdue loan with a pending fine to demonstrate that path.

## Ground rules
Same as every previous phase: additive migrations, `{router,service,schema}.ts` pattern, zod, `requireRole()`, `HttpError`, `audit()` on mutations, no git commands, no `/admin/reset`/`/admin/load-sample-data` except your own final step, server/frontend split with Portal.tsx changes described-not-made by the frontend agent, full tsc/eslint/test verification, live curl+UI verification.
