import type { z } from 'zod'
import type { Book, BookCopy, Loan, LibrarySettings } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isStaff } from '../../lib/scope'
import { fmtDate, toDate } from '../../lib/validate'
import { BORROWER_ROLES } from './schema'
import type {
  createBook, patchBook, bookQuery, createCopy, patchCopy, copyQuery,
  issueLoan, returnLoan, fineUpdate, loanQuery, patchSettings,
} from './schema'

// See phase-15-library.md. Every write here is gated at the router (`requireRole('staff','admin',
// 'superadmin')` for books/copies/loans, `requireRole('admin','superadmin')` for settings) — this
// service assumes that has already run, except for the loan self-view rules in `listLoans`/`getLoanForView`
// which every authenticated role can reach and so are enforced here.

type BookWithCopyStatuses = Book & { copies: { status: string }[] }
type BookWithCopies = Book & { copies: BookCopy[] }
type LoanFull = Loan & {
  copy: BookCopy & { book: Book }
  borrower: { id: string; name: string; role: string }
  issuedBy: { id: string; name: string } | null
  returnedBy: { id: string; name: string } | null
}

// ───────────────────────── serialization ─────────────────────────

// Catalog-browse shape: availability counts only, no per-copy detail (see phase-15-library.md — "a
// student just needs to know is any copy available").
export const serializeBookSummary = (b: BookWithCopyStatuses) => {
  const totalCopies = b.copies.length
  const availableCopies = b.copies.filter(c => c.status === 'Available').length
  return {
    id: b.id, title: b.title, author: b.author, isbn: b.isbn ?? undefined, publisher: b.publisher ?? undefined,
    category: b.category ?? undefined, coverFileId: b.coverFileId ?? undefined,
    totalCopies, availableCopies,
    createdAt: b.createdAt.toISOString(), updatedAt: b.updatedAt.toISOString(),
  }
}

// Staff/admin detail shape: full per-copy list (which copies exist and their status).
export const serializeBookDetail = (b: BookWithCopies) => ({
  id: b.id, title: b.title, author: b.author, isbn: b.isbn ?? undefined, publisher: b.publisher ?? undefined,
  category: b.category ?? undefined, coverFileId: b.coverFileId ?? undefined,
  totalCopies: b.copies.length, availableCopies: b.copies.filter(c => c.status === 'Available').length,
  copies: b.copies.map(serializeCopy),
  createdAt: b.createdAt.toISOString(), updatedAt: b.updatedAt.toISOString(),
})

export const serializeCopy = (c: BookCopy) => ({
  id: c.id, bookId: c.bookId, barcode: c.barcode, condition: c.condition ?? undefined, status: c.status,
  acquiredAt: c.acquiredAt ? fmtDate(c.acquiredAt) : undefined,
  createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
})

export const serializeLoan = (l: LoanFull) => ({
  id: l.id,
  copyId: l.copyId,
  copy: { id: l.copy.id, barcode: l.copy.barcode, status: l.copy.status, condition: l.copy.condition ?? undefined,
    book: { id: l.copy.book.id, title: l.copy.book.title, author: l.copy.book.author } },
  borrowerId: l.borrowerId,
  borrower: { id: l.borrower.id, name: l.borrower.name, role: l.borrower.role },
  issuedAt: l.issuedAt.toISOString(),
  dueDate: fmtDate(l.dueDate),
  returnedAt: l.returnedAt ? l.returnedAt.toISOString() : undefined,
  fineAmount: l.fineAmount ?? undefined,
  fineStatus: l.fineStatus,
  issuedById: l.issuedById,
  issuedBy: l.issuedBy ? { id: l.issuedBy.id, name: l.issuedBy.name } : undefined,
  returnedById: l.returnedById ?? undefined,
  returnedBy: l.returnedBy ? { id: l.returnedBy.id, name: l.returnedBy.name } : undefined,
  createdAt: l.createdAt.toISOString(),
})

export const serializeSettings = (s: LibrarySettings) => ({
  id: s.id,
  loanPeriodDays: s.loanPeriodDays,
  maxActiveLoansStudent: s.maxActiveLoansStudent,
  maxActiveLoansStaff: s.maxActiveLoansStaff,
  finePerDayOverdue: s.finePerDayOverdue,
  updatedAt: s.updatedAt.toISOString(),
})

// ───────────────────────── internal helpers ─────────────────────────

const loanInclude = {
  copy: { include: { book: true } },
  borrower: { select: { id: true, name: true, role: true } },
  issuedBy: { select: { id: true, name: true } },
  returnedBy: { select: { id: true, name: true } },
} as const

async function findBookRaw(ctx: Ctx, id: string) {
  const row = await prisma.book.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Book')
  return row
}

async function findCopyRaw(ctx: Ctx, id: string) {
  const row = await prisma.bookCopy.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Book copy')
  return row
}

async function findLoanRaw(ctx: Ctx, id: string) {
  const row = await prisma.loan.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Loan')
  return row
}

async function getLoanFull(ctx: Ctx, id: string): Promise<LoanFull> {
  const row = await prisma.loan.findFirst({ where: { id, schoolId: ctx.schoolId }, include: loanInclude })
  if (!row) throw notFound('Loan')
  return row as LoanFull
}

// LibrarySettings is a lazily-created singleton per school (defaults kick in the first time anything
// touches it — no seed step required before the endpoints/loan logic work).
async function getOrCreateSettings(ctx: Ctx): Promise<LibrarySettings> {
  const existing = await prisma.librarySettings.findUnique({ where: { schoolId: ctx.schoolId } })
  if (existing) return existing
  try {
    return await prisma.librarySettings.create({ data: { schoolId: ctx.schoolId } })
  } catch {
    // Race: another request created it first — re-read.
    return prisma.librarySettings.findUniqueOrThrow({ where: { schoolId: ctx.schoolId } })
  }
}

function addDays(base: Date, days: number): Date {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

const round2 = (n: number) => Math.round(n * 100) / 100

// A day overdue is any part of a day past the due date — daysOverdue is always >= 1 once returnedAt is
// past dueDate (matches typical library fine policy: partial days round up).
function fineFor(dueDate: Date, returnedAt: Date, perDay: number): { fineAmount: number | null; fineStatus: 'None' | 'Pending' } {
  if (returnedAt.getTime() <= dueDate.getTime()) return { fineAmount: null, fineStatus: 'None' }
  const daysOverdue = Math.max(1, Math.ceil((returnedAt.getTime() - dueDate.getTime()) / 86_400_000))
  return { fineAmount: round2(daysOverdue * perDay), fineStatus: 'Pending' }
}

// ───────────────────────── books ─────────────────────────

export async function listBooks(ctx: Ctx, q: z.infer<typeof bookQuery>): Promise<BookWithCopyStatuses[]> {
  return prisma.book.findMany({
    where: {
      schoolId: ctx.schoolId,
      category: q.category,
      ...(q.q ? { OR: [
        { title: { contains: q.q, mode: 'insensitive' } },
        { author: { contains: q.q, mode: 'insensitive' } },
        { category: { contains: q.q, mode: 'insensitive' } },
      ] } : {}),
    },
    include: { copies: { select: { status: true } } },
    orderBy: [{ title: 'asc' }],
  })
}

export async function getBook(ctx: Ctx, id: string, withCopies: boolean): Promise<BookWithCopyStatuses | BookWithCopies> {
  const row = await prisma.book.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: withCopies ? { copies: true } : { copies: { select: { status: true } } },
  })
  if (!row) throw notFound('Book')
  return row as BookWithCopyStatuses | BookWithCopies
}

export async function createBookRow(ctx: Ctx, input: z.infer<typeof createBook>): Promise<BookWithCopyStatuses> {
  if (input.coverFileId) {
    const file = await prisma.file.findFirst({ where: { id: input.coverFileId, schoolId: ctx.schoolId } })
    if (!file) throw notFound('Cover file')
  }
  const row = await prisma.book.create({
    data: {
      schoolId: ctx.schoolId, title: input.title, author: input.author, isbn: input.isbn ?? null,
      publisher: input.publisher ?? null, category: input.category ?? null, coverFileId: input.coverFileId ?? null,
    },
  })
  const full = { ...row, copies: [] as { status: string }[] }
  await audit(ctx.schoolId, ctx.actorId, 'create', 'book', row.id, undefined, serializeBookSummary(full))
  return full
}

export async function updateBook(ctx: Ctx, id: string, input: z.infer<typeof patchBook>): Promise<BookWithCopyStatuses> {
  const beforeRow = await getBook(ctx, id, false) as BookWithCopyStatuses
  if (input.coverFileId) {
    const file = await prisma.file.findFirst({ where: { id: input.coverFileId, schoolId: ctx.schoolId } })
    if (!file) throw notFound('Cover file')
  }
  await prisma.book.update({
    where: { id },
    data: {
      title: input.title, author: input.author, isbn: input.isbn, publisher: input.publisher,
      category: input.category, coverFileId: input.coverFileId,
    },
  })
  const after = await getBook(ctx, id, false) as BookWithCopyStatuses
  await audit(ctx.schoolId, ctx.actorId, 'update', 'book', id, serializeBookSummary(beforeRow), serializeBookSummary(after))
  return after
}

export async function removeBook(ctx: Ctx, id: string) {
  const before = await getBook(ctx, id, false) as BookWithCopyStatuses
  if (before.copies.length) throw new HttpError(400, 'Cannot delete a book that still has copies — remove its copies first')
  await prisma.book.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'book', id, serializeBookSummary(before))
}

// ───────────────────────── copies ─────────────────────────

export async function listCopies(ctx: Ctx, q: z.infer<typeof copyQuery>) {
  await findBookRaw(ctx, q.bookId)
  return prisma.bookCopy.findMany({
    where: { schoolId: ctx.schoolId, bookId: q.bookId, status: q.status },
    orderBy: [{ barcode: 'asc' }],
  })
}

export async function getCopy(ctx: Ctx, id: string) {
  return findCopyRaw(ctx, id)
}

export async function createCopyRow(ctx: Ctx, input: z.infer<typeof createCopy>) {
  await findBookRaw(ctx, input.bookId)
  const dup = await prisma.bookCopy.findFirst({ where: { schoolId: ctx.schoolId, barcode: input.barcode } })
  if (dup) throw new HttpError(409, `A copy with barcode "${input.barcode}" already exists`)
  const row = await prisma.bookCopy.create({
    data: {
      schoolId: ctx.schoolId, bookId: input.bookId, barcode: input.barcode, condition: input.condition ?? null,
      acquiredAt: input.acquiredAt ? toDate(input.acquiredAt) : null,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'bookCopy', row.id, undefined, serializeCopy(row))
  return row
}

export async function updateCopy(ctx: Ctx, id: string, input: z.infer<typeof patchCopy>) {
  const before = await findCopyRaw(ctx, id)
  if (input.status && input.status !== before.status) {
    if (input.status === 'Loaned') throw new HttpError(400, "Copy status 'Loaned' can only be set by issuing a loan")
    if (before.status === 'Loaned') throw new HttpError(400, 'This copy is currently on loan — process the return first')
  }
  if (input.barcode && input.barcode !== before.barcode) {
    const dup = await prisma.bookCopy.findFirst({ where: { schoolId: ctx.schoolId, barcode: input.barcode, id: { not: id } } })
    if (dup) throw new HttpError(409, `A copy with barcode "${input.barcode}" already exists`)
  }
  const row = await prisma.bookCopy.update({
    where: { id },
    data: {
      barcode: input.barcode, condition: input.condition, status: input.status,
      acquiredAt: input.acquiredAt !== undefined ? (input.acquiredAt ? toDate(input.acquiredAt) : null) : undefined,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'bookCopy', id, serializeCopy(before), serializeCopy(row))
  return row
}

export async function removeCopy(ctx: Ctx, id: string) {
  const before = await findCopyRaw(ctx, id)
  if (before.status === 'Loaned') throw new HttpError(400, 'Cannot delete a copy that is currently on loan')
  await prisma.bookCopy.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'bookCopy', id, serializeCopy(before))
}

// ───────────────────────── loans (the core of this phase) ─────────────────────────

export async function listLoans(ctx: Ctx, q: z.infer<typeof loanQuery>) {
  const staffView = isStaff(ctx)
  if (!staffView && q.borrowerId && q.borrowerId !== ctx.actorId) {
    throw new HttpError(403, 'You can only view your own loans')
  }
  const borrowerId = staffView ? q.borrowerId : ctx.actorId

  const where: Record<string, unknown> = {
    schoolId: ctx.schoolId,
    ...(borrowerId ? { borrowerId } : {}),
    ...(q.bookId ? { copy: { bookId: q.bookId } } : {}),
  }
  if (q.status === 'active') where.returnedAt = null
  else if (q.status === 'returned') where.returnedAt = { not: null }
  else if (q.status === 'overdue') { where.returnedAt = null; where.dueDate = { lt: new Date() } }

  return prisma.loan.findMany({ where, include: loanInclude, orderBy: [{ issuedAt: 'desc' }] }) as Promise<LoanFull[]>
}

export async function getLoanForView(ctx: Ctx, id: string): Promise<LoanFull> {
  const row = await getLoanFull(ctx, id)
  if (!isStaff(ctx) && row.borrowerId !== ctx.actorId) throw new HttpError(403, 'You can only view your own loans')
  return row
}

// Issuing a loan: the copy must be Available, and the borrower must be under their role's active-loan
// limit (count of their returnedAt: null loans). dueDate = issuedAt + LibrarySettings.loanPeriodDays,
// frozen on the row at issue time.
export async function issueLoanRow(ctx: Ctx, input: z.infer<typeof issueLoan>): Promise<LoanFull> {
  const copy = await findCopyRaw(ctx, input.copyId)
  if (copy.status !== 'Available') throw new HttpError(400, `This copy is not available to issue (status: ${copy.status})`)

  const borrower = await prisma.user.findFirst({
    where: { id: input.borrowerId, schoolId: ctx.schoolId, role: { in: BORROWER_ROLES as unknown as string[] } },
  })
  if (!borrower) throw notFound('Borrower')

  const settings = await getOrCreateSettings(ctx)
  const limit = borrower.role === 'student' ? settings.maxActiveLoansStudent : settings.maxActiveLoansStaff
  const activeCount = await prisma.loan.count({ where: { schoolId: ctx.schoolId, borrowerId: borrower.id, returnedAt: null } })
  if (activeCount >= limit) {
    throw new HttpError(400, `${borrower.name} has reached their active loan limit (${limit}) — return a book before issuing another`)
  }

  const issuedAt = new Date()
  const dueDate = addDays(issuedAt, settings.loanPeriodDays)

  const created = await prisma.$transaction(async tx => {
    await tx.bookCopy.update({ where: { id: copy.id }, data: { status: 'Loaned' } })
    return tx.loan.create({
      data: { schoolId: ctx.schoolId, copyId: copy.id, borrowerId: borrower.id, issuedAt, dueDate, issuedById: ctx.actorId },
    })
  })
  const full = await getLoanFull(ctx, created.id)
  await audit(ctx.schoolId, ctx.actorId, 'issue', 'loan', created.id, undefined, serializeLoan(full))
  return full
}

// Returning: sets returnedAt, frees the copy back to Available — unless the copy was lost (status ->
// Lost) or came back Damaged (status -> Retired, since the BookCopy.status enum has no separate
// "Damaged" value and a damaged copy should not stay in active circulation). If returned after dueDate,
// computes a Pending fine at the school's configured per-day rate.
export async function returnLoanRow(ctx: Ctx, id: string, input: z.infer<typeof returnLoan>): Promise<LoanFull> {
  const loan = await findLoanRaw(ctx, id)
  if (loan.returnedAt) throw new HttpError(400, 'This loan has already been returned')
  const copy = await findCopyRaw(ctx, loan.copyId)
  const before = await getLoanFull(ctx, id)

  const settings = await getOrCreateSettings(ctx)
  const returnedAt = new Date()
  const { fineAmount, fineStatus } = fineFor(loan.dueDate, returnedAt, settings.finePerDayOverdue)

  const copyStatus = input.lost ? 'Lost' : input.condition === 'Damaged' ? 'Retired' : 'Available'

  await prisma.$transaction(async tx => {
    await tx.loan.update({ where: { id }, data: { returnedAt, fineAmount, fineStatus, returnedById: ctx.actorId } })
    await tx.bookCopy.update({ where: { id: copy.id }, data: { status: copyStatus, condition: input.condition ?? copy.condition } })
  })
  const full = await getLoanFull(ctx, id)
  await audit(ctx.schoolId, ctx.actorId, 'return', 'loan', id, serializeLoan(before), serializeLoan(full))
  return full
}

// A record-only Paid/Waived toggle — not a real payment flow (see phase-15-library.md).
export async function updateFineStatus(ctx: Ctx, id: string, input: z.infer<typeof fineUpdate>): Promise<LoanFull> {
  const loan = await findLoanRaw(ctx, id)
  if (loan.fineStatus === 'None') throw new HttpError(400, 'This loan has no fine to update')
  const before = await getLoanFull(ctx, id)
  await prisma.loan.update({ where: { id }, data: { fineStatus: input.fineStatus } })
  const full = await getLoanFull(ctx, id)
  await audit(ctx.schoolId, ctx.actorId, 'update-fine', 'loan', id, serializeLoan(before), serializeLoan(full))
  return full
}

// ───────────────────────── settings ─────────────────────────

export async function getSettings(ctx: Ctx) {
  return getOrCreateSettings(ctx)
}

export async function updateSettings(ctx: Ctx, input: z.infer<typeof patchSettings>) {
  const before = await getOrCreateSettings(ctx)
  const row = await prisma.librarySettings.update({
    where: { schoolId: ctx.schoolId },
    data: {
      loanPeriodDays: input.loanPeriodDays, maxActiveLoansStudent: input.maxActiveLoansStudent,
      maxActiveLoansStaff: input.maxActiveLoansStaff, finePerDayOverdue: input.finePerDayOverdue,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'librarySettings', row.id, serializeSettings(before), serializeSettings(row))
  return row
}
