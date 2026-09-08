import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

// See phase-15-library.md.
export const COPY_CONDITIONS = ['New', 'Good', 'Worn', 'Damaged'] as const
export const COPY_STATUSES = ['Available', 'Loaned', 'Lost', 'Retired'] as const
export const FINE_STATUSES = ['None', 'Pending', 'Paid', 'Waived'] as const

// Roles allowed to be a Loan.borrowerId — mirrors the spec's "a User — student or staff/teacher";
// admin/superadmin are included too since they are, functionally, staff. Parents are deliberately
// excluded — not a borrower type this phase supports (a parent's own "My Loans" screen will just be
// empty, which is correct).
export const BORROWER_ROLES = ['student', 'teacher', 'staff', 'admin', 'superadmin'] as const

// ---- books (catalog entry, one row per title) ----

export const createBook = z.object({
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(200),
  isbn: z.string().trim().max(40).nullable().optional(),
  publisher: z.string().trim().max(160).nullable().optional(),
  category: z.string().trim().max(80).nullable().optional(),
  coverFileId: idStr.nullable().optional(),
})
export const patchBook = createBook.partial()

export const bookQuery = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
})

// ---- copies (one row per physical copy, scoped to a book) ----

export const createCopy = z.object({
  bookId: idStr,
  barcode: z.string().trim().min(1).max(60),
  condition: z.enum(COPY_CONDITIONS).nullable().optional(),
  acquiredAt: dateStr.nullable().optional(),
})

// status/barcode/condition/acquiredAt are all independently patchable, but the service layer refuses
// a manual transition into/out of 'Loaned' — that status is only ever set by the issue/return flow.
export const patchCopy = z.object({
  barcode: z.string().trim().min(1).max(60).optional(),
  condition: z.enum(COPY_CONDITIONS).nullable().optional(),
  status: z.enum(COPY_STATUSES).optional(),
  acquiredAt: dateStr.nullable().optional(),
})

export const copyQuery = z.object({
  bookId: idStr,
  status: z.enum(COPY_STATUSES).optional(),
})

// ---- loans ----

// dueDate is never client-supplied — it's always computed server-side from LibrarySettings.loanPeriodDays
// at issue time (see phase-15-library.md's loan logic).
export const issueLoan = z.object({
  copyId: idStr,
  borrowerId: idStr,
})

// `condition` records the copy's condition at return time; `lost: true` overrides it (a lost copy is
// never "available" or merely "damaged" — see service.ts#returnLoanRow for the exact status mapping).
export const returnLoan = z.object({
  condition: z.enum(COPY_CONDITIONS).optional(),
  lost: z.boolean().optional(),
})

// Marking a fine Paid/Waived is a manual record, not a payment flow (see phase-15-library.md).
export const fineUpdate = z.object({
  fineStatus: z.enum(['Paid', 'Waived']),
})

export const loanQuery = z.object({
  borrowerId: idStr.optional(),
  bookId: idStr.optional(),
  status: z.enum(['active', 'returned', 'overdue']).optional(),
})

// ---- settings (one row per school, admin-editable) ----

export const patchSettings = z.object({
  loanPeriodDays: z.number().int().min(1).max(365).optional(),
  maxActiveLoansStudent: z.number().int().min(0).max(50).optional(),
  maxActiveLoansStaff: z.number().int().min(0).max(50).optional(),
  finePerDayOverdue: z.number().min(0).max(10000).optional(),
})
