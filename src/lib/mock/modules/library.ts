// Mirrors server/src/modules/library/{router,schema,service}.ts (see git show feature/backend-api:
// server/src/modules/library/*.ts for the reference this was built against — the real `server/` tree
// isn't checked out in this working copy). Books (catalog, one row per title) with BookCopies (one row
// per physical copy), Loans against a specific copy, and a per-school LibrarySettings singleton.
// Frontend contract confirmed against src/lib/hooks/useLibrary.ts's extensive comments.

import { route, requireAuth, requireRole, status } from '../router'
import { notFound, badRequest, conflict } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const BORROWER_ROLES = new Set(['student', 'teacher', 'staff', 'admin', 'superadmin'])

function isStaff(role: string) {
  return role === 'staff' || role === 'admin' || role === 'superadmin'
}

// ───────────────────────── serializers ─────────────────────────

function serializeBook(b: Row) {
  const copies = table('BookCopy').filter(c => c.bookId === b.id)
  return {
    id: b.id, title: b.title, author: b.author, isbn: b.isbn ?? undefined, publisher: b.publisher ?? undefined,
    category: b.category ?? undefined, coverFileId: b.coverFileId ?? undefined, createdAt: b.createdAt,
    totalCopies: copies.length, availableCopies: copies.filter(c => c.status === 'Available').length,
  }
}

function serializeCopy(c: Row) {
  const book = table('Book').find(b => b.id === c.bookId)
  return { id: c.id, bookId: c.bookId, barcode: c.barcode, condition: c.condition ?? undefined, status: c.status, acquiredAt: c.acquiredAt ?? undefined, bookTitle: book?.title }
}

function userRef(id: unknown) {
  const u = table('User').find(x => x.id === id)
  return u ? { id: u.id, name: u.name, role: u.role } : undefined
}

function serializeLoan(l: Row) {
  const copy = table('BookCopy').find(c => c.id === l.copyId)
  const book = copy ? table('Book').find(b => b.id === copy.bookId) : undefined
  return {
    id: l.id, copyId: l.copyId,
    copy: copy ? { id: copy.id, barcode: copy.barcode, status: copy.status, condition: copy.condition ?? undefined, book: book ? { id: book.id, title: book.title, author: book.author } : undefined } : undefined,
    borrowerId: l.borrowerId, borrower: userRef(l.borrowerId),
    issuedAt: l.issuedAt, dueDate: l.dueDate, returnedAt: l.returnedAt ?? undefined,
    fineAmount: l.fineAmount ?? undefined, fineStatus: l.fineStatus,
    issuedById: l.issuedById, issuedBy: userRef(l.issuedById),
    returnedById: l.returnedById ?? undefined, returnedBy: l.returnedById ? userRef(l.returnedById) : undefined,
    createdAt: l.createdAt,
  }
}

function serializeSettings(s: Row) {
  return { id: s.id, loanPeriodDays: s.loanPeriodDays, maxActiveLoansStudent: s.maxActiveLoansStudent, maxActiveLoansStaff: s.maxActiveLoansStaff, finePerDayOverdue: s.finePerDayOverdue }
}

function getOrCreateSettings(schoolId: string): Row {
  const rows = table('LibrarySettings')
  let row = rows.find(r => r.schoolId === schoolId)
  if (!row) {
    row = { id: uid('libset'), schoolId, loanPeriodDays: 14, maxActiveLoansStudent: 3, maxActiveLoansStaff: 5, finePerDayOverdue: 2, createdAt: nowIso() }
    rows.push(row)
    saveTable('LibrarySettings', rows)
  }
  return row
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const round2 = (n: number) => Math.round(n * 100) / 100

function fineFor(dueDate: string, returnedAtIso: string, perDay: number): { fineAmount: number | null; fineStatus: string } {
  const due = new Date(dueDate).getTime()
  const returned = new Date(returnedAtIso).getTime()
  if (returned <= due) return { fineAmount: null, fineStatus: 'None' }
  const daysOverdue = Math.max(1, Math.ceil((returned - due) / 86_400_000))
  return { fineAmount: round2(daysOverdue * perDay), fineStatus: 'Pending' }
}

// ───────────────────────── books ─────────────────────────

route('GET', '/library/books', (ctx) => {
  const actor = requireAuth(ctx)
  const { q, category } = ctx.query
  let rows = table('Book').filter(b => b.schoolId === actor.schoolId)
  if (category) rows = rows.filter(b => b.category === category)
  if (q) {
    const needle = q.toLowerCase()
    rows = rows.filter(b => String(b.title).toLowerCase().includes(needle) || String(b.author).toLowerCase().includes(needle) || String(b.category ?? '').toLowerCase().includes(needle))
  }
  return { items: rows.map(serializeBook) }
})

route('GET', '/library/books/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const row = table('Book').find(b => b.id === ctx.params.id && b.schoolId === actor.schoolId)
  if (!row) throw notFound('Book')
  return { item: serializeBook(row) }
})

route('POST', '/library/books', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { title: string; author: string; isbn?: string; publisher?: string; category?: string; coverFileId?: string }
  const row: Row = { id: uid('book'), schoolId: actor.schoolId, title: b.title, author: b.author, isbn: b.isbn ?? null, publisher: b.publisher ?? null, category: b.category ?? null, coverFileId: b.coverFileId ?? null, createdAt: nowIso() }
  const rows = table('Book'); rows.push(row); saveTable('Book', rows)
  return status(201, { item: serializeBook(row) })
})

route('PATCH', '/library/books/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('Book')
  const idx = rows.findIndex(b => b.id === ctx.params.id && b.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Book')
  rows[idx] = { ...rows[idx], ...ctx.body, updatedAt: nowIso() }
  saveTable('Book', rows)
  return { item: serializeBook(rows[idx]) }
})

route('DELETE', '/library/books/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('Book')
  const idx = rows.findIndex(b => b.id === ctx.params.id && b.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Book')
  if (table('BookCopy').some(c => c.bookId === ctx.params.id)) throw badRequest('Cannot delete a book that still has copies — remove its copies first')
  rows.splice(idx, 1); saveTable('Book', rows)
  return { ok: true }
})

// ───────────────────────── copies ─────────────────────────

route('GET', '/library/copies', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const { bookId, status: st } = ctx.query
  let rows = table('BookCopy').filter(c => c.schoolId === actor.schoolId)
  if (bookId) rows = rows.filter(c => c.bookId === bookId)
  if (st) rows = rows.filter(c => c.status === st)
  return { items: rows.map(serializeCopy) }
})

route('POST', '/library/copies', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { bookId: string; barcode: string; condition?: string; acquiredAt?: string }
  if (!table('Book').some(bk => bk.id === b.bookId && bk.schoolId === actor.schoolId)) throw notFound('Book')
  if (table('BookCopy').some(c => c.schoolId === actor.schoolId && c.barcode === b.barcode)) throw conflict(`A copy with barcode "${b.barcode}" already exists`)
  const row: Row = { id: uid('copy'), schoolId: actor.schoolId, bookId: b.bookId, barcode: b.barcode, condition: b.condition ?? null, status: 'Available', acquiredAt: b.acquiredAt ?? null, createdAt: nowIso() }
  const rows = table('BookCopy'); rows.push(row); saveTable('BookCopy', rows)
  return status(201, { item: serializeCopy(row) })
})

route('PATCH', '/library/copies/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('BookCopy')
  const idx = rows.findIndex(c => c.id === ctx.params.id && c.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Book copy')
  const before = rows[idx]
  const b = ctx.body as { status?: string; barcode?: string; condition?: string; acquiredAt?: string | null }
  if (b.status && b.status !== before.status) {
    if (b.status === 'Loaned') throw badRequest("Copy status 'Loaned' can only be set by issuing a loan")
    if (before.status === 'Loaned') throw badRequest('This copy is currently on loan — process the return first')
  }
  if (b.barcode && b.barcode !== before.barcode && rows.some(c => c.id !== before.id && c.schoolId === actor.schoolId && c.barcode === b.barcode)) {
    throw conflict(`A copy with barcode "${b.barcode}" already exists`)
  }
  rows[idx] = { ...before, ...b, updatedAt: nowIso() }
  saveTable('BookCopy', rows)
  return { item: serializeCopy(rows[idx]) }
})

route('DELETE', '/library/copies/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('BookCopy')
  const idx = rows.findIndex(c => c.id === ctx.params.id && c.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Book copy')
  if (rows[idx].status === 'Loaned') throw badRequest('Cannot delete a copy that is currently on loan')
  rows.splice(idx, 1); saveTable('BookCopy', rows)
  return { ok: true }
})

// ───────────────────────── loans ─────────────────────────

route('GET', '/library/loans', (ctx) => {
  const actor = requireAuth(ctx)
  const staffView = isStaff(actor.role)
  const { borrowerId, bookId, status: st } = ctx.query
  if (!staffView && borrowerId && borrowerId !== actor.userId) throw badRequest('You can only view your own loans')
  const effectiveBorrower = staffView ? borrowerId : actor.userId
  let rows = table('Loan').filter(l => l.schoolId === actor.schoolId)
  if (effectiveBorrower) rows = rows.filter(l => l.borrowerId === effectiveBorrower)
  if (bookId) {
    const copyIds = new Set(table('BookCopy').filter(c => c.bookId === bookId).map(c => c.id))
    rows = rows.filter(l => copyIds.has(l.copyId as string))
  }
  const now = Date.now()
  if (st === 'active') rows = rows.filter(l => !l.returnedAt)
  else if (st === 'returned') rows = rows.filter(l => !!l.returnedAt)
  else if (st === 'overdue') rows = rows.filter(l => !l.returnedAt && new Date(l.dueDate as string).getTime() < now)
  rows = [...rows].sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)))
  return { items: rows.map(serializeLoan) }
})

route('GET', '/library/loans/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const row = table('Loan').find(l => l.id === ctx.params.id && l.schoolId === actor.schoolId)
  if (!row) throw notFound('Loan')
  if (!isStaff(actor.role) && row.borrowerId !== actor.userId) throw badRequest('You can only view your own loans')
  return { item: serializeLoan(row) }
})

route('POST', '/library/loans', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { copyId: string; borrowerId: string }
  const copies = table('BookCopy')
  const copy = copies.find(c => c.id === b.copyId && c.schoolId === actor.schoolId)
  if (!copy) throw notFound('Book copy')
  if (copy.status !== 'Available') throw badRequest(`This copy is not available to issue (status: ${copy.status})`)
  const borrower = table('User').find(u => u.id === b.borrowerId && u.schoolId === actor.schoolId && BORROWER_ROLES.has(String(u.role)))
  if (!borrower) throw notFound('Borrower')
  const settings = getOrCreateSettings(actor.schoolId)
  const limit = borrower.role === 'student' ? settings.maxActiveLoansStudent as number : settings.maxActiveLoansStaff as number
  const activeCount = table('Loan').filter(l => l.schoolId === actor.schoolId && l.borrowerId === borrower.id && !l.returnedAt).length
  if (activeCount >= limit) throw badRequest(`${borrower.name} has reached their active loan limit (${limit}) — return a book before issuing another`)
  const issuedAt = nowIso()
  const dueDate = addDays(issuedAt, settings.loanPeriodDays as number)
  const loan: Row = { id: uid('loan'), schoolId: actor.schoolId, copyId: copy.id, borrowerId: borrower.id, issuedAt, dueDate, returnedAt: null, fineAmount: null, fineStatus: 'None', issuedById: actor.userId, returnedById: null, createdAt: issuedAt }
  const loans = table('Loan'); loans.push(loan); saveTable('Loan', loans)
  const cIdx = copies.findIndex(c => c.id === copy.id)
  copies[cIdx] = { ...copy, status: 'Loaned' }
  saveTable('BookCopy', copies)
  return status(201, { item: serializeLoan(loan) })
})

route('POST', '/library/loans/:id/return', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const loans = table('Loan')
  const idx = loans.findIndex(l => l.id === ctx.params.id && l.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Loan')
  const loan = loans[idx]
  if (loan.returnedAt) throw badRequest('This loan has already been returned')
  const copies = table('BookCopy')
  const cIdx = copies.findIndex(c => c.id === loan.copyId)
  if (cIdx === -1) throw notFound('Book copy')
  const b = ctx.body as { condition?: string; lost?: boolean }
  const settings = getOrCreateSettings(actor.schoolId)
  const returnedAt = nowIso()
  const { fineAmount, fineStatus } = fineFor(loan.dueDate as string, returnedAt, settings.finePerDayOverdue as number)
  const copyStatus = b.lost ? 'Lost' : b.condition === 'Damaged' ? 'Retired' : 'Available'
  loans[idx] = { ...loan, returnedAt, fineAmount, fineStatus, returnedById: actor.userId }
  saveTable('Loan', loans)
  copies[cIdx] = { ...copies[cIdx], status: copyStatus, condition: b.condition ?? copies[cIdx].condition }
  saveTable('BookCopy', copies)
  return { item: serializeLoan(loans[idx]) }
})

route('PATCH', '/library/loans/:id/fine', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const loans = table('Loan')
  const idx = loans.findIndex(l => l.id === ctx.params.id && l.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Loan')
  if (loans[idx].fineStatus === 'None') throw badRequest('This loan has no fine to update')
  const { fineStatus } = ctx.body as { fineStatus: 'Paid' | 'Waived' }
  loans[idx] = { ...loans[idx], fineStatus }
  saveTable('Loan', loans)
  return { item: serializeLoan(loans[idx]) }
})

// ───────────────────────── settings ─────────────────────────

route('GET', '/library/settings', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  return { item: serializeSettings(getOrCreateSettings(actor.schoolId)) }
})

route('PATCH', '/library/settings', (ctx) => {
  const actor = requireRole(ctx, 'admin', 'superadmin')
  const before = getOrCreateSettings(actor.schoolId)
  const rows = table('LibrarySettings')
  const idx = rows.findIndex(r => r.id === before.id)
  rows[idx] = { ...before, ...ctx.body }
  saveTable('LibrarySettings', rows)
  return { item: serializeSettings(rows[idx]) }
})
