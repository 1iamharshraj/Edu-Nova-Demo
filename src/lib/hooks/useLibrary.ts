import { useMemo } from 'react'
import type { BookCondition, BookCopyRec, BookRec, CopyStatus, FineStatus, LibrarySettingsRec, LoanRec, Role } from '../data'
import { qs, useList, useOne } from './useAcademics'

// Data hooks and pure helpers for Phase 15: library catalog (books/copies), loans (issue/return, self and
// staff/admin views) and per-school settings (loan period, per-role limits, fine rate). Components live in
// src/portal/modules/library.tsx. See .agents/edunova/phase-15-library.md
//
// Reconciled and live-verified (curl, admin token) against the server once it landed
// (`server/src/modules/library/{router,schema,service}.ts`) — the router/service were still unbuilt when this
// frontend was first drafted, so every path/shape below was confirmed against the real API, not assumed:
// `GET /library/books` takes `q` (not `search`) + `category`; `GET /library/copies` requires `bookId` and
// takes an optional `status`; `POST /library/copies` does NOT accept `status` (new copies always start
// Available — status only changes via PATCH, and the server refuses a manual transition into/out of
// 'Loaned'); `POST /library/loans/:id/return` takes `{ condition?, lost? }`, not a `fineStatus` — marking a
// fine Paid/Waived is a separate `PATCH /library/loans/:id/fine` call (`{ fineStatus: 'Paid' | 'Waived' }`,
// confirmed live); `GET /library/loans` takes `status: 'active' | 'returned' | 'overdue'`, not a boolean
// `active` flag, and also accepts `bookId` (no free-text `search` — the Issue & Returns screen searches
// borrowers client-side over the already-loaded user directory instead). `Loan` rows nest `copy.book` and
// `borrower`/`issuedBy`/`returnedBy` objects rather than flat decorated fields — see `LoanRec` in data.ts.
// One live gap worth flagging: `GET /library/settings` is gated `admin`/`superadmin` only (not `staff`), so a
// staff (non-admin) user on the Issue & Returns screen falls back to `DEFAULT_LIBRARY_SETTINGS` below for the
// loan-limit pill and fine preview — cosmetic only, since issue/return/fine enforcement is authoritative
// server-side regardless of what the client previews.

export const BOOK_CONDITIONS: BookCondition[] = ['New', 'Good', 'Worn', 'Damaged']
export const COPY_STATUSES: CopyStatus[] = ['Available', 'Loaned', 'Lost', 'Retired']

export const copyStatusTone = (s: CopyStatus): 'green' | 'amber' | 'rose' | 'slate' =>
  s === 'Available' ? 'green' : s === 'Loaned' ? 'amber' : s === 'Lost' ? 'rose' : 'slate'

export const fineStatusTone = (s: FineStatus): 'green' | 'amber' | 'rose' | 'slate' =>
  s === 'Paid' ? 'green' : s === 'Pending' ? 'rose' : s === 'Waived' ? 'slate' : 'slate'

/** `/library/books?q=&category=` — everyone can read (students/parents browse the catalog too);
 * staff/admin/superadmin write via POST/PATCH/DELETE. */
export function useBooks(params: { q?: string; category?: string } = {}, enabled = true) {
  return useList<BookRec>(enabled ? `/library/books${qs(params)}` : null)
}

export function useBook(bookId?: string, enabled = true) {
  return useOne<BookRec>(enabled && bookId ? `/library/books/${encodeURIComponent(bookId)}` : null)
}

/** `/library/copies?bookId=&status=` — `bookId` is required by the server's `copyQuery` schema; inventory
 * management is staff/admin/superadmin only per the spec (not student-facing) — the catalog's per-book
 * availability count should come from the book record itself. */
export function useCopies(bookId?: string, enabled = true) {
  return useList<BookCopyRec>(enabled && bookId ? `/library/copies${qs({ bookId })}` : null)
}

/** `/library/loans?borrowerId=&bookId=&status=active|returned|overdue` — a caller may always see their own;
 * staff/admin/superadmin can see everyone's (no free-text search param in the server's `loanQuery` schema —
 * the Issue & Returns screen searches borrowers client-side over the already-loaded user directory instead). */
export function useLoans(params: { borrowerId?: string; bookId?: string; status?: 'active' | 'returned' | 'overdue' } = {}, enabled = true) {
  return useList<LoanRec>(enabled ? `/library/loans${qs(params)}` : null)
}

/** `/library/settings` — GET readable by admin/superadmin, PATCH admin/superadmin only. */
export function useLibrarySettings(enabled = true) {
  return useOne<LibrarySettingsRec>(enabled ? '/library/settings' : null)
}

/** Reasonable fallback so the settings screen and fine-preview math have numbers before the first GET
 * resolves, and so nothing divides-by-zero if the server hasn't written a settings row yet. */
export const DEFAULT_LIBRARY_SETTINGS: LibrarySettingsRec = {
  id: '', loanPeriodDays: 14, maxActiveLoansStudent: 3, maxActiveLoansStaff: 5, finePerDayOverdue: 2,
}

/** A role's active-loan ceiling per `LibrarySettings` — students get `maxActiveLoansStudent`, every other
 * borrower role (teacher/staff/admin/superadmin) gets `maxActiveLoansStaff`. */
export function loanLimitFor(role: Role | undefined, settings: LibrarySettingsRec): number {
  return role === 'student' ? settings.maxActiveLoansStudent : settings.maxActiveLoansStaff
}

/** Whole days between issue/now and the due date; positive once overdue. Mirrors the server's
 * `daysOverdue * finePerDayOverdue` fine computation for an at-a-glance preview before a return is submitted. */
export function daysOverdue(dueDate: string, at: Date = new Date()): number {
  const due = new Date(dueDate)
  const ms = at.setHours(0, 0, 0, 0) - new Date(due).setHours(0, 0, 0, 0)
  return Math.max(0, Math.round(ms / 86_400_000))
}

export function isOverdue(loan: Pick<LoanRec, 'returnedAt' | 'dueDate'>, at: Date = new Date()): boolean {
  if (loan.returnedAt) return false
  return daysOverdue(loan.dueDate, at) > 0
}

export function previewFine(dueDate: string, finePerDayOverdue: number, at: Date = new Date()): number {
  return daysOverdue(dueDate, at) * finePerDayOverdue
}

/** Book-level availability text for the catalog — never just hides a fully-loaned title. */
export function availabilityLabel(book: Pick<BookRec, 'availableCopies' | 'totalCopies'>): string {
  const total = book.totalCopies ?? 0
  const available = book.availableCopies ?? 0
  if (total === 0) return 'No copies catalogued'
  if (available === 0) return '0 available, all on loan'
  return `${available} of ${total} available`
}

/** Sort current (not-yet-returned) loans by due date ascending, past loans by return date descending. */
export function useSplitLoans(loans: LoanRec[] | undefined) {
  return useMemo(() => {
    const current = (loans ?? []).filter(l => !l.returnedAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    const past = (loans ?? []).filter(l => l.returnedAt).sort((a, b) => (b.returnedAt ?? '').localeCompare(a.returnedAt ?? ''))
    return { current, past }
  }, [loans])
}
