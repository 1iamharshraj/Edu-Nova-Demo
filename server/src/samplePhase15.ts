import type { Prisma } from '@prisma/client'

// Phase 15 demo data: 8 books across a few categories (2-3 copies each), a handful of active loans
// against existing sample students/teachers, one genuinely-overdue-but-not-yet-returned loan (no fine
// yet — matches the invariant that a fine is only computed at return time), one already-returned-late
// loan with a resulting Pending fine (demonstrates the fine-computation path), and one clean on-time
// return. Runs inside the same transaction as loadSampleData, after users/enrollments already exist. See
// phase-15-library.md → sample-data notes.
//
// Loan/return timestamps are relative to "now" (load time), not fixed calendar dates — mirrors
// samplePhase12.ts's vehicle-location pings — so "overdue" stays true no matter when the demo is loaded.

type Tx = Prisma.TransactionClient

export interface Phase15Args {
  schoolId: string
  userId: (seedId: string) => string
}

const daysAgo = (now: Date, n: number) => new Date(now.getTime() - n * 86_400_000)
function addDays(base: Date, days: number): Date {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export async function loadPhase15(tx: Tx, a: Phase15Args) {
  const { schoolId } = a
  const uid = a.userId
  const now = new Date()

  // Default settings row, explicit (rather than relying on lazy creation) so the sample school has a
  // predictable one from the start: 14-day loans, 3 active for students, 5 for staff, ₹2/day overdue.
  await tx.librarySettings.create({ data: { schoolId, loanPeriodDays: 14, maxActiveLoansStudent: 3, maxActiveLoansStaff: 5, finePerDayOverdue: 2 } })

  const book = (title: string, author: string, category: string, publisher: string, isbn: string) =>
    tx.book.create({ data: { schoolId, title, author, category, publisher, isbn } })

  const alchemist = await book('The Alchemist', 'Paulo Coelho', 'Fiction', 'HarperOne', '978-0062315007')
  const briefHistory = await book('A Brief History of Time', 'Stephen Hawking', 'Science', 'Bantam Books', '978-0553380163')
  const wingsOfFire = await book('Wings of Fire', 'A.P.J. Abdul Kalam', 'Biography', 'Universities Press', '978-8173711466')
  const ncertMaths = await book('NCERT Mathematics X', 'NCERT', 'Textbook', 'NCERT', '978-8174504931')
  const mockingbird = await book('To Kill a Mockingbird', 'Harper Lee', 'Fiction', 'Grand Central Publishing', '978-0446310789')
  const diary = await book('The Diary of a Young Girl', 'Anne Frank', 'Biography', 'Bantam Books', '978-0553296983')
  const sapiens = await book('Sapiens: A Brief History of Humankind', 'Yuval Noah Harari', 'Non-fiction', 'Harper', '978-0062316097')
  const ncertScience = await book('NCERT Science IX', 'NCERT', 'Textbook', 'NCERT', '978-8174504771')

  // ── copies: 2-3 per book, `barcode` "LIB-<book>-<n>" ──
  const copy = (bookId: string, prefix: string, n: number, condition: string, status: 'Available' | 'Loaned' = 'Available') =>
    tx.bookCopy.create({ data: { schoolId, bookId, barcode: `LIB-${prefix}-${n}`, condition, status, acquiredAt: daysAgo(now, 200 + n) } })

  // Only copies referenced by a loan below need a binding — the rest are pure catalog filler (plain
  // Available copies padding out each book's total-copy count).
  await Promise.all([copy(alchemist.id, 'ALC', 1, 'Good'), copy(alchemist.id, 'ALC', 2, 'Good')])
  const alchemistC = await copy(alchemist.id, 'ALC', 3, 'New', 'Loaned')
  await copy(briefHistory.id, 'BHT', 1, 'Worn')
  const briefB = await copy(briefHistory.id, 'BHT', 2, 'Good', 'Loaned')
  await Promise.all([copy(wingsOfFire.id, 'WOF', 1, 'Good'), copy(wingsOfFire.id, 'WOF', 2, 'New')])
  const wingsC = await copy(wingsOfFire.id, 'WOF', 3, 'Good', 'Loaned')
  const mathsA = await copy(ncertMaths.id, 'MTX', 1, 'Good')
  await Promise.all([copy(ncertMaths.id, 'MTX', 2, 'Good'), copy(ncertMaths.id, 'MTX', 3, 'Worn')])
  const mockA = await copy(mockingbird.id, 'TKM', 1, 'Good')
  await copy(mockingbird.id, 'TKM', 2, 'Worn')
  await Promise.all([copy(diary.id, 'DYG', 1, 'Good'), copy(diary.id, 'DYG', 2, 'New')])
  const sapiensB = await copy(sapiens.id, 'SAP', 2, 'Good', 'Loaned')
  await copy(sapiens.id, 'SAP', 1, 'New')
  await Promise.all([copy(ncertScience.id, 'SCI', 1, 'Good'), copy(ncertScience.id, 'SCI', 2, 'Good'), copy(ncertScience.id, 'SCI', 3, 'New')])

  const staffLibrarian = uid('u-st') // Farhan Qureshi, Office Superintendent — doubles as the issuing desk in this demo.
  const admin = uid('u-a')

  // ── active loans, on time (due in the future) ──
  await tx.loan.create({
    data: {
      schoolId, copyId: alchemistC.id, borrowerId: uid('u-s'), issuedById: staffLibrarian,
      issuedAt: daysAgo(now, 3), dueDate: addDays(daysAgo(now, 3), 14),
    },
  })
  await tx.loan.create({
    data: {
      schoolId, copyId: wingsC.id, borrowerId: uid('u-s2'), issuedById: staffLibrarian,
      issuedAt: daysAgo(now, 5), dueDate: addDays(daysAgo(now, 5), 14),
    },
  })
  await tx.loan.create({
    data: {
      schoolId, copyId: sapiensB.id, borrowerId: uid('u-t2'), issuedById: admin,
      issuedAt: daysAgo(now, 1), dueDate: addDays(daysAgo(now, 1), 14),
    },
  })

  // ── active loan, genuinely overdue and NOT yet returned — no fine yet (a fine is only computed at
  // return time; see phase-15-library.md's loan logic), demonstrates the "overdue, unreturned" state. ──
  await tx.loan.create({
    data: {
      schoolId, copyId: briefB.id, borrowerId: uid('u-s4'), issuedById: staffLibrarian,
      issuedAt: daysAgo(now, 20), dueDate: addDays(daysAgo(now, 20), 14), // due 6 days ago
    },
  })

  // ── returned late, resulting Pending fine (6 days overdue × ₹2/day = ₹12) — demonstrates the actual
  // fine-computation path from phase-15-library.md. ──
  await tx.loan.create({
    data: {
      schoolId, copyId: mockA.id, borrowerId: uid('u-s3'), issuedById: staffLibrarian, returnedById: admin,
      issuedAt: daysAgo(now, 30), dueDate: addDays(daysAgo(now, 30), 14), returnedAt: daysAgo(now, 10),
      fineAmount: 12, fineStatus: 'Pending',
    },
  })

  // ── returned on time, clean — no fine. ──
  await tx.loan.create({
    data: {
      schoolId, copyId: mathsA.id, borrowerId: uid('u-s'), issuedById: admin, returnedById: staffLibrarian,
      issuedAt: daysAgo(now, 40), dueDate: addDays(daysAgo(now, 40), 14), returnedAt: daysAgo(now, 30),
      fineAmount: null, fineStatus: 'None',
    },
  })
}
