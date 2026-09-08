import type { Prisma } from '@prisma/client'
import { DEFAULT_CHART, BANK_CODE, FEE_INCOME_CODE, SALARY_EXPENSE_CODE } from './modules/accounting/service'

// Phase 17 demo data: the starter chart of accounts, plus a ledger that mirrors exactly what the live
// Fees/Payroll auto-posting hooks (modules/accounting/service.ts#postFeePaymentAutoEntry /
// #postPayrollAutoEntry) would have produced for every payment/paid-payslip Phase 5 already seeded, plus
// two manual entries (an opening balance and a Utilities expense) to demonstrate the manual-entry path.
// Runs inside the same transaction as loadSampleData, after Phase 5 (fees/payroll) already exists.
// See phase-17-accounting.md → Frontend → Sample data.
//
// Why replicate rather than rely on the hooks firing: samplePhase5.ts writes `Payment`/`Payslip` rows
// directly via `tx.payment.create` / `tx.payslip.create` (same pattern samplePhase16.ts uses for
// `StockMovement` — sample loading bypasses the service layer entirely, so it never calls
// recordPayment/gatewayConfirmPayment/markPaid, and the hooks attached to those functions never run).
// This was verified, not assumed — see the Phase 17 report for the live-hook proof against a real API
// call instead.

type Tx = Prisma.TransactionClient

export interface Phase17Args {
  schoolId: string
  userId: (seedId: string) => string
}

const dayUTC = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

export async function loadPhase17(tx: Tx, a: Phase17Args) {
  const { schoolId } = a
  const admin = a.userId('u-a') // Dr. Leela Menon — records the manual entries in this demo.

  // ── chart of accounts ──
  const byCode = new Map<string, string>()
  for (const acct of DEFAULT_CHART) {
    const row = await tx.account.create({
      data: { schoolId, code: acct.code, name: acct.name, type: acct.type, isSystem: acct.isSystem, parentId: acct.parentCode ? byCode.get(acct.parentCode) : null },
    })
    byCode.set(acct.code, row.id)
  }
  const bankId = byCode.get(BANK_CODE)!
  const feeIncomeId = byCode.get(FEE_INCOME_CODE)!
  const salaryExpenseId = byCode.get(SALARY_EXPENSE_CODE)!
  const utilitiesId = byCode.get('5010')!
  const openingBalanceId = byCode.get('3000')!

  // ── replicate the auto-posting hooks for every payment/paid-payslip Phase 5 already seeded ──
  const payments = await tx.payment.findMany({ where: { schoolId } })
  for (const p of payments) {
    await tx.journalEntry.create({
      data: {
        schoolId, date: dayUTC(p.paidAt), memo: 'Fee payment received', reference: p.id,
        sourceType: 'FeePayment', sourceId: p.id, createdById: admin,
        lines: { create: [{ accountId: bankId, debit: p.amount, credit: 0 }, { accountId: feeIncomeId, debit: 0, credit: p.amount }] },
      },
    })
  }

  const payslips = await tx.payslip.findMany({ where: { schoolId, status: 'Paid' } })
  for (const s of payslips) {
    await tx.journalEntry.create({
      data: {
        schoolId, date: dayUTC(s.paidAt ?? new Date()), memo: `Payroll paid — ${s.month}`, reference: s.id,
        sourceType: 'Payroll', sourceId: s.id, createdById: admin,
        lines: { create: [{ accountId: salaryExpenseId, debit: s.net, credit: 0 }, { accountId: bankId, debit: 0, credit: s.net }] },
      },
    })
  }

  // ── manual entries: an opening balance (so Bank isn't already negative from the payroll activity
  // above) and a seeded Utilities expense, both through the same manual-entry shape POST
  // /accounting/journal-entries accepts ──
  const now = new Date()
  const daysAgo = (n: number) => dayUTC(new Date(now.getTime() - n * 86_400_000))

  // Sized comfortably above the seeded Jan-Mar payroll run (~11 employees x 3 months) net of the seeded
  // fee income, so the demo Bank balance reads as a normal positive number rather than deeply overdrawn.
  await tx.journalEntry.create({
    data: {
      schoolId, date: daysAgo(95), memo: 'Opening bank balance', reference: 'Opening entry',
      sourceType: 'Manual', sourceId: null, createdById: admin,
      lines: { create: [{ accountId: bankId, debit: 3_000_000, credit: 0 }, { accountId: openingBalanceId, debit: 0, credit: 3_000_000 }] },
    },
  })

  await tx.journalEntry.create({
    data: {
      schoolId, date: daysAgo(15), memo: 'Electricity bill payment', reference: 'Utilities — March 2026',
      sourceType: 'Manual', sourceId: null, createdById: admin,
      lines: { create: [{ accountId: utilitiesId, debit: 18_500, credit: 0 }, { accountId: bankId, debit: 0, credit: 18_500 }] },
    },
  })
}
