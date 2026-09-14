// Seed fragment for Phase 15: library catalog (Book/BookCopy), loans, and settings. Extends
// seed/core.ts's School/User rows — see seed/index.ts for the registration order. Titles mirror what a
// real Indian school library actually stocks (NCERT textbooks alongside popular fiction), matching the
// style already established in server/src/sampleConstants.ts.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'
import { addSeedFragment } from './index'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const dateDaysAgo = (n: number) => daysAgo(n).slice(0, 10)

export function seedLibrary(db: Collections) {
  db.Book = [
    { id: 'book-ncert-math10', schoolId: SCHOOL_ID, title: 'Mathematics — NCERT Class X', author: 'NCERT', publisher: 'NCERT', category: 'Textbook', createdAt: '2025-04-05T00:00:00.000Z' },
    { id: 'book-ncert-sci10', schoolId: SCHOOL_ID, title: 'Science — NCERT Class X', author: 'NCERT', publisher: 'NCERT', category: 'Textbook', createdAt: '2025-04-05T00:00:00.000Z' },
    { id: 'book-panchatantra', schoolId: SCHOOL_ID, title: 'The Panchatantra', author: 'Vishnu Sharma', publisher: 'Rupa Publications', category: 'Fiction', createdAt: '2025-04-05T00:00:00.000Z' },
    { id: 'book-malgudi', schoolId: SCHOOL_ID, title: 'Malgudi Days', author: 'R.K. Narayan', publisher: 'Indian Thought Publications', category: 'Fiction', createdAt: '2025-04-05T00:00:00.000Z' },
    { id: 'book-wings-fire', schoolId: SCHOOL_ID, title: 'Wings of Fire', author: 'A.P.J. Abdul Kalam', publisher: 'Universities Press', category: 'Biography', createdAt: '2025-04-05T00:00:00.000Z' },
    { id: 'book-harry1', schoolId: SCHOOL_ID, title: "Harry Potter and the Philosopher's Stone", author: 'J.K. Rowling', publisher: 'Bloomsbury', category: 'Fiction', createdAt: '2025-04-05T00:00:00.000Z' },
  ].map(r => r as Row)

  db.BookCopy = [
    { id: 'copy-1a', schoolId: SCHOOL_ID, bookId: 'book-ncert-math10', barcode: 'LIB-1001', condition: 'Good', status: 'Available', acquiredAt: '2025-04-10', createdAt: '2025-04-10T00:00:00.000Z' },
    { id: 'copy-1b', schoolId: SCHOOL_ID, bookId: 'book-ncert-math10', barcode: 'LIB-1002', condition: 'Good', status: 'Loaned', acquiredAt: '2025-04-10', createdAt: '2025-04-10T00:00:00.000Z' },
    { id: 'copy-2a', schoolId: SCHOOL_ID, bookId: 'book-ncert-sci10', barcode: 'LIB-1003', condition: 'New', status: 'Available', acquiredAt: '2025-04-10', createdAt: '2025-04-10T00:00:00.000Z' },
    { id: 'copy-3a', schoolId: SCHOOL_ID, bookId: 'book-panchatantra', barcode: 'LIB-1004', condition: 'Good', status: 'Available', acquiredAt: '2024-06-01', createdAt: '2024-06-01T00:00:00.000Z' },
    { id: 'copy-4a', schoolId: SCHOOL_ID, bookId: 'book-malgudi', barcode: 'LIB-1005', condition: 'Good', status: 'Available', acquiredAt: '2024-06-01', createdAt: '2024-06-01T00:00:00.000Z' },
    { id: 'copy-4b', schoolId: SCHOOL_ID, bookId: 'book-malgudi', barcode: 'LIB-1006', condition: 'Worn', status: 'Loaned', acquiredAt: '2023-06-01', createdAt: '2023-06-01T00:00:00.000Z' },
    { id: 'copy-5a', schoolId: SCHOOL_ID, bookId: 'book-wings-fire', barcode: 'LIB-1007', condition: 'Good', status: 'Available', acquiredAt: '2024-08-15', createdAt: '2024-08-15T00:00:00.000Z' },
    { id: 'copy-6a', schoolId: SCHOOL_ID, bookId: 'book-harry1', barcode: 'LIB-1008', condition: 'Good', status: 'Available', acquiredAt: '2024-01-20', createdAt: '2024-01-20T00:00:00.000Z' },
    { id: 'copy-6b', schoolId: SCHOOL_ID, bookId: 'book-harry1', barcode: 'LIB-1009', condition: 'Damaged', status: 'Lost', acquiredAt: '2024-01-20', createdAt: '2024-01-20T00:00:00.000Z' },
  ].map(r => r as Row)

  db.Loan = [
    // Active, not yet due.
    { id: 'loan-1', schoolId: SCHOOL_ID, copyId: 'copy-1b', borrowerId: 'u-s1', issuedAt: daysAgo(10), dueDate: daysFromNow(4), returnedAt: null, fineAmount: null, fineStatus: 'None', issuedById: 'u-st', returnedById: null, createdAt: daysAgo(10) },
    // Active and overdue (fine is computed at return time, so it still reads fineStatus: 'None' until returned — see useLibrary.ts#isOverdue for the client-side "overdue" check).
    { id: 'loan-2', schoolId: SCHOOL_ID, copyId: 'copy-4b', borrowerId: 'u-s2', issuedAt: daysAgo(30), dueDate: dateDaysAgo(16), returnedAt: null, fineAmount: null, fineStatus: 'None', issuedById: 'u-st', returnedById: null, createdAt: daysAgo(30) },
    // Returned on time.
    { id: 'loan-3', schoolId: SCHOOL_ID, copyId: 'copy-3a', borrowerId: 'u-t', issuedAt: daysAgo(40), dueDate: dateDaysAgo(26), returnedAt: daysAgo(29), fineAmount: null, fineStatus: 'None', issuedById: 'u-st', returnedById: 'u-st', createdAt: daysAgo(40) },
    // Returned late, fine already paid at the desk.
    { id: 'loan-4', schoolId: SCHOOL_ID, copyId: 'copy-6a', borrowerId: 'u-s3', issuedAt: daysAgo(60), dueDate: dateDaysAgo(46), returnedAt: daysAgo(40), fineAmount: 12, fineStatus: 'Paid', issuedById: 'u-st', returnedById: 'u-st', createdAt: daysAgo(60) },
  ].map(r => r as Row)

  db.LibrarySettings = [
    { id: 'libset-demo', schoolId: SCHOOL_ID, loanPeriodDays: 14, maxActiveLoansStudent: 3, maxActiveLoansStaff: 5, finePerDayOverdue: 2, createdAt: '2025-04-01T00:00:00.000Z' },
  ].map(r => r as Row)
}

addSeedFragment(seedLibrary)
