import type { z } from 'zod'
import { Prisma } from '@prisma/client'
import type { Account, JournalEntry, JournalLine } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { paginate } from '../../lib/pagination'
import { logger } from '../../lib/logger'
import type {
  createAccount, patchAccount, accountQuery, createJournalEntry, journalQuery, trialBalanceQuery, profitAndLossQuery, balanceSheetQuery,
  cashFlowForecastQuery, programProfitabilityQuery, concessionImpactQuery,
} from './schema'

// See phase-17-accounting.md. This module carries real correctness stakes (a wrong ledger is worse than
// no ledger) — the one invariant that must never be violated anywhere in this file is: every JournalEntry
// written to the database has sum(lines.debit) === sum(lines.credit), checked in cents to avoid float
// drift, inside the same transaction that writes it. See writeBalancedEntry, the single choke point every
// entry (manual or auto-posted) goes through.

type EntryWithLines = JournalEntry & { lines: JournalLine[] }

const round2 = (n: number) => Math.round(n * 100) / 100
const cents = (n: number) => Math.round(n * 100)

// ───────────────────────────── default chart of accounts ─────────────────────────────

// Starter chart per phase-17-accounting.md — small and sensible, not exhaustive; admin can add more
// through the Chart of Accounts screen. `isSystem: true` marks the three accounts the Fees/Payroll
// auto-posting hooks below actually post against (Bank, Fee Income, Salary Expense) — deleting one of
// those would silently break the integration, so service.ts refuses to delete an isSystem account at all
// (stronger than the spec's literal "discourage deletion", a deliberate conservative choice).
export const BANK_CODE = '1002'
export const FEE_INCOME_CODE = '4000'
export const SALARY_EXPENSE_CODE = '5000'
// Phase 30 — canteen prepaid wallet (see phase-30-canteen-wallet.md item 2). A top-up is money held on
// the school's behalf, not yet revenue, so it lands in a Liability account; a purchase is the point that
// money is actually recognized as revenue, so it moves from that liability into real Income.
export const CANTEEN_LIABILITY_CODE = '2010'
export const CANTEEN_REVENUE_CODE = '4020'

export const DEFAULT_CHART: { code: string; name: string; type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense'; parentCode?: string; isSystem: boolean }[] = [
  { code: '1000', name: 'Current Assets', type: 'Asset', isSystem: false },
  { code: '1001', name: 'Cash', type: 'Asset', parentCode: '1000', isSystem: false },
  { code: BANK_CODE, name: 'Bank', type: 'Asset', parentCode: '1000', isSystem: true },
  { code: '2000', name: 'Accounts Payable', type: 'Liability', isSystem: false },
  { code: CANTEEN_LIABILITY_CODE, name: 'Canteen Wallet Liability', type: 'Liability', isSystem: true },
  { code: '3000', name: 'Opening Balance', type: 'Equity', isSystem: false },
  { code: FEE_INCOME_CODE, name: 'Fee Income', type: 'Income', isSystem: true },
  { code: '4010', name: 'Donation Income', type: 'Income', isSystem: false },
  { code: CANTEEN_REVENUE_CODE, name: 'Canteen Revenue', type: 'Income', isSystem: true },
  { code: SALARY_EXPENSE_CODE, name: 'Salary Expense', type: 'Expense', isSystem: true },
  { code: '5010', name: 'Utilities Expense', type: 'Expense', isSystem: false },
  { code: '5020', name: 'Maintenance Expense', type: 'Expense', isSystem: false },
  { code: '5090', name: 'Other Expense', type: 'Expense', isSystem: false },
]

// Lazily seeds the starter chart the first time this school touches accounting — "on first use" per
// phase-17-accounting.md (school creation itself isn't a single choke point in this codebase, so this is
// the simplest correct place). No-ops once any Account row exists for the school.
export async function ensureChartSeeded(schoolId: string) {
  const count = await prisma.account.count({ where: { schoolId } })
  if (count === 0) {
    await prisma.$transaction(async tx => {
      const stillNone = await tx.account.count({ where: { schoolId } })
      if (stillNone > 0) return
      const byCode = new Map<string, string>()
      for (const a of DEFAULT_CHART) {
        const row = await tx.account.create({
          data: { schoolId, code: a.code, name: a.name, type: a.type, isSystem: a.isSystem, parentId: a.parentCode ? byCode.get(a.parentCode) : null },
        })
        byCode.set(a.code, row.id)
      }
    })
  }
  // Phase 30 — the two canteen accounts were added to DEFAULT_CHART after some schools' charts had
  // already been seeded (the `count === 0` branch above is a no-op for them). Ensure both exist for every
  // school regardless of when its chart was first seeded — cheap (two indexed lookups) once they exist.
  await Promise.all([
    ensureAccount(schoolId, CANTEEN_LIABILITY_CODE, 'Canteen Wallet Liability', 'Liability'),
    ensureAccount(schoolId, CANTEEN_REVENUE_CODE, 'Canteen Revenue', 'Income'),
  ])
}

async function ensureAccount(schoolId: string, code: string, name: string, type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense') {
  const existing = await prisma.account.findUnique({ where: { schoolId_code: { schoolId, code } } })
  if (existing) return existing
  try {
    return await prisma.account.create({ data: { schoolId, code, name, type, isSystem: true } })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return prisma.account.findUniqueOrThrow({ where: { schoolId_code: { schoolId, code } } })
    }
    throw err
  }
}

async function systemAccount(schoolId: string, code: string) {
  const row = await prisma.account.findFirst({ where: { schoolId, code } })
  if (!row) throw new Error(`System account with code ${code} is missing for school ${schoolId}`)
  return row
}

// GL balance of a system account by code (credit-normal accounts like this Liability/Income pair are
// reported credit-minus-debit — see balanceSheet/profitAndLoss above for the same convention). Exported
// for modules/canteen/service.ts's admin reconciliation check (item 6: sum of all wallet balances should
// equal the Canteen Wallet Liability account's GL balance at any point).
export async function systemAccountBalance(schoolId: string, code: string) {
  await ensureChartSeeded(schoolId)
  const acct = await systemAccount(schoolId, code)
  const sums = await aggregateLines(schoolId, {})
  const s = sums.get(acct.id)
  return round2((s?.credit ?? 0) - (s?.debit ?? 0))
}

// ───────────────────────────── serializers ─────────────────────────────

export const serializeAccount = (a: Account) => ({
  id: a.id, code: a.code, name: a.name, type: a.type, parentId: a.parentId ?? undefined,
  isSystem: a.isSystem, active: a.active, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString(),
})

export const serializeLine = (l: JournalLine) => ({ id: l.id, accountId: l.accountId, debit: l.debit, credit: l.credit })

export const serializeEntry = (e: EntryWithLines) => ({
  id: e.id, date: fmtDate(e.date), memo: e.memo, reference: e.reference ?? undefined,
  sourceType: e.sourceType, sourceId: e.sourceId ?? undefined, createdById: e.createdById,
  createdAt: e.createdAt.toISOString(), postedAt: e.postedAt.toISOString(),
  lines: e.lines.map(serializeLine),
  totalDebit: round2(e.lines.reduce((s, l) => s + l.debit, 0)),
  totalCredit: round2(e.lines.reduce((s, l) => s + l.credit, 0)),
})

// ───────────────────────────── accounts ─────────────────────────────

export async function listAccounts(ctx: Ctx, q: z.infer<typeof accountQuery>) {
  await ensureChartSeeded(ctx.schoolId)
  return prisma.account.findMany({
    where: { schoolId: ctx.schoolId, type: q.type, active: q.active !== undefined ? q.active === 'true' : undefined },
    orderBy: [{ code: 'asc' }],
  })
}

async function findAccountRaw(ctx: Ctx, id: string) {
  const row = await prisma.account.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Account')
  return row
}

export async function createAccountRow(ctx: Ctx, input: z.infer<typeof createAccount>) {
  await ensureChartSeeded(ctx.schoolId)
  const existing = await prisma.account.findUnique({ where: { schoolId_code: { schoolId: ctx.schoolId, code: input.code } } })
  if (existing) throw new HttpError(409, `An account with code "${input.code}" already exists`)
  if (input.parentId) await findAccountRaw(ctx, input.parentId)
  const row = await prisma.account.create({
    data: { schoolId: ctx.schoolId, code: input.code, name: input.name, type: input.type, parentId: input.parentId ?? null, active: input.active ?? true },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'account', row.id, undefined, serializeAccount(row))
  return row
}

export async function updateAccountRow(ctx: Ctx, id: string, input: z.infer<typeof patchAccount>) {
  const before = await findAccountRaw(ctx, id)
  if (input.parentId) {
    if (input.parentId === id) throw new HttpError(400, 'An account cannot be its own parent')
    await findAccountRaw(ctx, input.parentId)
  }
  const row = await prisma.account.update({
    where: { id }, data: { name: input.name, parentId: input.parentId === undefined ? undefined : input.parentId, active: input.active },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'account', id, serializeAccount(before), serializeAccount(row))
  return row
}

export async function removeAccountRow(ctx: Ctx, id: string) {
  const before = await findAccountRaw(ctx, id)
  if (before.isSystem) throw new HttpError(400, `"${before.name}" is a system account relied on by the Fees/Payroll auto-posting integration and cannot be deleted`)
  const lineCount = await prisma.journalLine.count({ where: { accountId: id } })
  if (lineCount > 0) throw new HttpError(400, 'Cannot delete an account that has journal-entry history — its record must be kept for the audit trail')
  const childCount = await prisma.account.count({ where: { parentId: id } })
  if (childCount > 0) throw new HttpError(400, 'Cannot delete an account that has child accounts')
  await prisma.account.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'account', id, serializeAccount(before))
}

// ───────────────────────────── journal entries: the one write path ─────────────────────────────

// The single place a JournalEntry is ever created — manual entries (via the router, RBAC already
// enforced there) and the Fees/Payroll auto-posting hooks below both funnel through this. Re-validates
// the balance itself rather than trusting any caller (including this module's own hook functions):
// sums are compared in integer cents to avoid float-accumulation false negatives/positives, and the
// whole write happens inside a transaction so a partially-written entry can never exist.
async function writeBalancedEntry(
  ctx: Ctx,
  input: { date: Date; memo: string; reference?: string | null; sourceType: string; sourceId?: string | null; lines: { accountId: string; debit: number; credit: number }[] },
): Promise<EntryWithLines> {
  if (input.lines.length < 2) throw new HttpError(400, 'A journal entry needs at least two lines')
  for (const l of input.lines) {
    if (l.debit < 0 || l.credit < 0) throw new HttpError(400, 'debit/credit cannot be negative')
    if ((l.debit > 0) === (l.credit > 0)) throw new HttpError(400, 'Each line must have exactly one of debit/credit non-zero')
  }
  const totalDebitCents = input.lines.reduce((s, l) => s + cents(l.debit), 0)
  const totalCreditCents = input.lines.reduce((s, l) => s + cents(l.credit), 0)
  if (totalDebitCents !== totalCreditCents) {
    throw new HttpError(400, `Journal entry is not balanced: debits ${(totalDebitCents / 100).toFixed(2)} ≠ credits ${(totalCreditCents / 100).toFixed(2)}`, {
      totalDebit: round2(totalDebitCents / 100), totalCredit: round2(totalCreditCents / 100),
    })
  }
  if (totalDebitCents === 0) throw new HttpError(400, 'A journal entry cannot have zero value')

  const accountIds = [...new Set(input.lines.map(l => l.accountId))]
  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds }, schoolId: ctx.schoolId } })
  if (accounts.length !== accountIds.length) throw new HttpError(400, 'One or more accountId are invalid for this school')
  const inactive = accounts.find(a => !a.active)
  if (inactive) throw new HttpError(400, `Account "${inactive.name}" is inactive and cannot be posted to`)

  return prisma.$transaction(async tx => {
    // Re-check the balance one more time inside the transaction (defense in depth — belt and suspenders,
    // since nothing between the checks above and here can change `input.lines`, but this is cheap and the
    // ground rule is "never write an unbalanced entry under any circumstance").
    const d = input.lines.reduce((s, l) => s + cents(l.debit), 0)
    const c = input.lines.reduce((s, l) => s + cents(l.credit), 0)
    if (d !== c) throw new HttpError(400, 'Journal entry is not balanced')
    return tx.journalEntry.create({
      data: {
        schoolId: ctx.schoolId, date: input.date, memo: input.memo, reference: input.reference ?? null,
        sourceType: input.sourceType, sourceId: input.sourceId ?? null, createdById: ctx.actorId,
        lines: { create: input.lines.map(l => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })) },
      },
      include: { lines: true },
    })
  })
}

// POST /accounting/journal-entries — admin/superadmin only (enforced at the router). Always sourceType
// 'Manual'. No edit/delete of a posted entry in this phase — a correction is a future reversing-entry
// feature (phase-17-accounting.md's known limitation), not built now.
export async function createManualEntry(ctx: Ctx, input: z.infer<typeof createJournalEntry>) {
  await ensureChartSeeded(ctx.schoolId)
  const entry = await writeBalancedEntry(ctx, {
    date: toDate(input.date), memo: input.memo, reference: input.reference ?? null, sourceType: 'Manual', sourceId: null,
    lines: input.lines.map(l => ({ accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0 })),
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'journalEntry', entry.id, undefined, serializeEntry(entry))
  return entry
}

export async function listEntries(ctx: Ctx, q: z.infer<typeof journalQuery>) {
  const where: Prisma.JournalEntryWhereInput = {
    schoolId: ctx.schoolId,
    sourceType: q.sourceType,
    date: q.from || q.to ? { gte: q.from ? toDate(q.from) : undefined, lte: q.to ? toDate(q.to) : undefined } : undefined,
    lines: q.accountId ? { some: { accountId: q.accountId } } : undefined,
  }
  return paginate(
    args => prisma.journalEntry.findMany({ where, include: { lines: true }, orderBy: [{ date: 'desc' }, { id: 'desc' }], ...args }) as Promise<EntryWithLines[]>,
    { limit: q.limit, cursor: q.cursor, defaultLimit: 100, maxLimit: 500 },
  )
}

export async function getEntry(ctx: Ctx, id: string) {
  const row = await prisma.journalEntry.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { lines: true } })
  if (!row) throw notFound('Journal entry')
  return row as EntryWithLines
}

// ───────────────────────────── auto-posting hooks (Fees / Payroll) ─────────────────────────────
// Called from fees/service.ts (recordPayment, gatewayConfirmPayment) and payroll/service.ts (markPaid)
// AFTER the real write has already committed. Both catch every error internally and only log — mirrors
// employmentHistory/service.ts#logChange's fail-open pattern — so a ledger-posting failure can NEVER
// block or roll back the actual fee payment or payroll payment. Callers add a single `await` line, no
// try/catch of their own needed.

// Debit Bank, Credit Fee Income, for the payment amount. "Bank" (not "Cash") is used consistently for
// every auto-posted fee receipt — a real school's fee collection routes through a bank/gateway even when
// the recorded `Payment.method` is 'Cash' at the front desk, and using one fixed account keeps the hook
// simple and predictable; documented here per phase-17-accounting.md's "pick one, document it".
export async function postFeePaymentAutoEntry(ctx: Ctx, payment: { id: string; amount: number; paidAt: Date }) {
  try {
    await ensureChartSeeded(ctx.schoolId)
    const [bank, income] = await Promise.all([systemAccount(ctx.schoolId, BANK_CODE), systemAccount(ctx.schoolId, FEE_INCOME_CODE)])
    const entry = await writeBalancedEntry(ctx, {
      date: payment.paidAt, memo: 'Fee payment received', reference: payment.id, sourceType: 'FeePayment', sourceId: payment.id,
      lines: [{ accountId: bank.id, debit: payment.amount, credit: 0 }, { accountId: income.id, debit: 0, credit: payment.amount }],
    })
    await audit(ctx.schoolId, ctx.actorId, 'auto-post', 'journalEntry', entry.id, undefined, serializeEntry(entry))
  } catch (err) {
    logger.error({ err, schoolId: ctx.schoolId, paymentId: payment.id }, 'fee-payment ledger auto-post failed (non-fatal)')
  }
}

// Debit Salary Expense, Credit Bank, for the net pay amount.
export async function postPayrollAutoEntry(ctx: Ctx, payslip: { id: string; net: number; paidAt: Date | null }) {
  try {
    await ensureChartSeeded(ctx.schoolId)
    const [salary, bank] = await Promise.all([systemAccount(ctx.schoolId, SALARY_EXPENSE_CODE), systemAccount(ctx.schoolId, BANK_CODE)])
    const entry = await writeBalancedEntry(ctx, {
      date: payslip.paidAt ?? new Date(), memo: 'Payroll paid', reference: payslip.id, sourceType: 'Payroll', sourceId: payslip.id,
      lines: [{ accountId: salary.id, debit: payslip.net, credit: 0 }, { accountId: bank.id, debit: 0, credit: payslip.net }],
    })
    await audit(ctx.schoolId, ctx.actorId, 'auto-post', 'journalEntry', entry.id, undefined, serializeEntry(entry))
  } catch (err) {
    logger.error({ err, schoolId: ctx.schoolId, payslipId: payslip.id }, 'payroll ledger auto-post failed (non-fatal)')
  }
}

// Called from modules/canteen/service.ts#topUp AFTER the wallet balance has already been credited — same
// fail-open contract as the two hooks above (a ledger-posting failure can never block or roll back the
// actual wallet credit). Debit Bank, Credit Canteen Wallet Liability — see phase-30-canteen-wallet.md
// item 2: a top-up is money held on the school's behalf, not yet revenue.
export async function postCanteenTopUpAutoEntry(ctx: Ctx, txn: { id: string; amount: number; occurredAt: Date }) {
  try {
    await ensureChartSeeded(ctx.schoolId)
    const [bank, liability] = await Promise.all([systemAccount(ctx.schoolId, BANK_CODE), systemAccount(ctx.schoolId, CANTEEN_LIABILITY_CODE)])
    const entry = await writeBalancedEntry(ctx, {
      date: txn.occurredAt, memo: 'Canteen wallet top-up', reference: txn.id, sourceType: 'CanteenTopUp', sourceId: txn.id,
      lines: [{ accountId: bank.id, debit: txn.amount, credit: 0 }, { accountId: liability.id, debit: 0, credit: txn.amount }],
    })
    await audit(ctx.schoolId, ctx.actorId, 'auto-post', 'journalEntry', entry.id, undefined, serializeEntry(entry))
  } catch (err) {
    logger.error({ err, schoolId: ctx.schoolId, walletTxnId: txn.id }, 'canteen top-up ledger auto-post failed (non-fatal)')
  }
}

// Called from modules/canteen/service.ts#purchase AFTER the wallet balance has already been debited —
// same fail-open contract. Debit Canteen Wallet Liability, Credit Canteen Revenue — this is the point the
// money actually becomes the school's recognized revenue (accrual treatment for a prepaid-balance system).
export async function postCanteenPurchaseAutoEntry(ctx: Ctx, txn: { id: string; amount: number; occurredAt: Date }) {
  try {
    await ensureChartSeeded(ctx.schoolId)
    const [liability, revenue] = await Promise.all([systemAccount(ctx.schoolId, CANTEEN_LIABILITY_CODE), systemAccount(ctx.schoolId, CANTEEN_REVENUE_CODE)])
    const entry = await writeBalancedEntry(ctx, {
      date: txn.occurredAt, memo: 'Canteen purchase', reference: txn.id, sourceType: 'CanteenPurchase', sourceId: txn.id,
      lines: [{ accountId: liability.id, debit: txn.amount, credit: 0 }, { accountId: revenue.id, debit: 0, credit: txn.amount }],
    })
    await audit(ctx.schoolId, ctx.actorId, 'auto-post', 'journalEntry', entry.id, undefined, serializeEntry(entry))
  } catch (err) {
    logger.error({ err, schoolId: ctx.schoolId, walletTxnId: txn.id }, 'canteen purchase ledger auto-post failed (non-fatal)')
  }
}

// ───────────────────────────── reports ─────────────────────────────

// Aggregates every JournalLine for the school within an optional date window, keyed by account. Dates on
// JournalEntry are stored as SQL DATE (no time component, see toDate()), so a plain <=/>= comparison
// against another date-truncated Date correctly includes/excludes whole days.
async function aggregateLines(schoolId: string, window: { gte?: Date; lte?: Date }) {
  const dateFilter: Prisma.DateTimeFilter | undefined = window.gte || window.lte ? { gte: window.gte, lte: window.lte } : undefined
  const rows = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where: { entry: { schoolId, ...(dateFilter ? { date: dateFilter } : {}) } },
    _sum: { debit: true, credit: true },
  })
  return new Map(rows.map(r => [r.accountId, { debit: r._sum.debit ?? 0, credit: r._sum.credit ?? 0 }]))
}

// GET /accounting/reports/trial-balance?asOf= — every account with a non-zero cumulative balance up to
// and including asOf, split into a debit or credit column by its net sign. totalDebit === totalCredit is
// mathematically guaranteed by the balanced-entry invariant (every line ever posted has a matching
// opposite somewhere), not separately enforced here — see the live-verification note in the report back.
export async function trialBalance(ctx: Ctx, q: z.infer<typeof trialBalanceQuery>) {
  await ensureChartSeeded(ctx.schoolId)
  const asOf = toDate(q.asOf)
  const sums = await aggregateLines(ctx.schoolId, { lte: asOf })
  const accounts = await prisma.account.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ code: 'asc' }] })
  const rows: { accountId: string; code: string; name: string; type: string; debit: number; credit: number }[] = []
  let totalDebit = 0, totalCredit = 0
  for (const a of accounts) {
    const s = sums.get(a.id)
    if (!s) continue
    const net = round2(s.debit - s.credit)
    if (net === 0) continue
    const debit = net > 0 ? net : 0
    const credit = net < 0 ? -net : 0
    totalDebit = round2(totalDebit + debit)
    totalCredit = round2(totalCredit + credit)
    rows.push({ accountId: a.id, code: a.code, name: a.name, type: a.type, debit, credit })
  }
  return { asOf: q.asOf, accounts: rows, totalDebit, totalCredit }
}

// GET /accounting/reports/profit-and-loss?from=&to= — sum of Income accounts minus sum of Expense
// accounts for the period, broken down by account.
export async function profitAndLoss(ctx: Ctx, q: z.infer<typeof profitAndLossQuery>) {
  await ensureChartSeeded(ctx.schoolId)
  const from = toDate(q.from), to = toDate(q.to)
  if (from > to) throw new HttpError(400, '`from` must not be after `to`')
  const sums = await aggregateLines(ctx.schoolId, { gte: from, lte: to })
  const accounts = await prisma.account.findMany({ where: { schoolId: ctx.schoolId, type: { in: ['Income', 'Expense'] } }, orderBy: [{ code: 'asc' }] })
  const income: { accountId: string; code: string; name: string; amount: number }[] = []
  const expense: { accountId: string; code: string; name: string; amount: number }[] = []
  let totalIncome = 0, totalExpense = 0
  for (const a of accounts) {
    const s = sums.get(a.id)
    if (!s) continue
    if (a.type === 'Income') {
      const amount = round2(s.credit - s.debit)
      if (amount === 0) continue
      totalIncome = round2(totalIncome + amount)
      income.push({ accountId: a.id, code: a.code, name: a.name, amount })
    } else {
      const amount = round2(s.debit - s.credit)
      if (amount === 0) continue
      totalExpense = round2(totalExpense + amount)
      expense.push({ accountId: a.id, code: a.code, name: a.name, amount })
    }
  }
  return { from: q.from, to: q.to, income, expense, totalIncome, totalExpense, netIncome: round2(totalIncome - totalExpense) }
}

// GET /accounting/reports/balance-sheet?asOf= — Assets vs. Liabilities + Equity as of a date. This phase
// has no period-close workflow (no automated entry moves Income/Expense balances into Equity at
// year-end), so accumulated net income since inception (Income minus Expense, up to asOf) is folded into
// the Equity section as a synthetic "Retained Earnings (Net Income)" line — without it, Assets would NOT
// equal Liabilities + Equity for a school with any posted revenue/expense activity, since that activity
// only ever debits/credits Asset/Expense/Income accounts, never a real Equity row. This is standard
// unclosed-books accounting practice, not a fudge: given the balanced-entry invariant (every line's
// opposite exists somewhere), Assets == Liabilities + Equity(incl. retained earnings) holds by
// construction — see the live cross-check against the P&L and trial balance in the report back.
export async function balanceSheet(ctx: Ctx, q: z.infer<typeof balanceSheetQuery>) {
  await ensureChartSeeded(ctx.schoolId)
  const asOf = toDate(q.asOf)
  const sums = await aggregateLines(ctx.schoolId, { lte: asOf })
  const accounts = await prisma.account.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ code: 'asc' }] })
  const assets: { accountId: string; code: string; name: string; amount: number }[] = []
  const liabilities: { accountId: string; code: string; name: string; amount: number }[] = []
  const equity: { accountId: string | null; code: string | null; name: string; amount: number }[] = []
  let totalAssets = 0, totalLiabilities = 0, equityAccountsTotal = 0, totalIncome = 0, totalExpense = 0
  for (const a of accounts) {
    const s = sums.get(a.id)
    if (!s) continue
    if (a.type === 'Asset') {
      const amount = round2(s.debit - s.credit)
      if (amount === 0) continue
      totalAssets = round2(totalAssets + amount)
      assets.push({ accountId: a.id, code: a.code, name: a.name, amount })
    } else if (a.type === 'Liability') {
      const amount = round2(s.credit - s.debit)
      if (amount === 0) continue
      totalLiabilities = round2(totalLiabilities + amount)
      liabilities.push({ accountId: a.id, code: a.code, name: a.name, amount })
    } else if (a.type === 'Equity') {
      const amount = round2(s.credit - s.debit)
      if (amount === 0) continue
      equityAccountsTotal = round2(equityAccountsTotal + amount)
      equity.push({ accountId: a.id, code: a.code, name: a.name, amount })
    } else if (a.type === 'Income') {
      totalIncome = round2(totalIncome + round2(s.credit - s.debit))
    } else if (a.type === 'Expense') {
      totalExpense = round2(totalExpense + round2(s.debit - s.credit))
    }
  }
  const netIncome = round2(totalIncome - totalExpense)
  if (netIncome !== 0) equity.push({ accountId: null, code: null, name: 'Retained Earnings (Net Income)', amount: netIncome })
  const totalEquity = round2(equityAccountsTotal + netIncome)
  return {
    asOf: q.asOf, assets, liabilities, equity,
    totalAssets, totalLiabilities, totalEquity,
    totalLiabilitiesAndEquity: round2(totalLiabilities + totalEquity),
  }
}

// ───────────────────────────── Phase 21 — financial intelligence (report endpoints) ─────────────────────────────
// See phase-21-financial-intelligence.md items 1-3. Pure reports built on top of the Phase 17 GL and the
// existing Fees/Payroll data — no new models for these three.

// Same role set payroll/service.ts#PAYROLL_ROLES uses for "who draws a salary" — duplicated (not
// imported) to avoid a cross-module dependency for one small constant.
const PAYROLL_ROLES = ['teacher', 'staff', 'admin', 'superadmin']

// GET /accounting/reports/cash-flow-forecast?months=3 — "current Bank balance + projected fee
// collections − projected payroll" per month, per phase-21-financial-intelligence.md item 1. Inflow is
// known unpaid invoice due-dates falling in that month (net of concession and payments already made);
// outflow assumes this month's total payroll obligation (active employees' SalaryStructure
// basic+allowances) stays roughly constant — no seasonality modeling, deliberately kept simple for v1.
export async function cashFlowForecast(ctx: Ctx, q: z.infer<typeof cashFlowForecastQuery>) {
  await ensureChartSeeded(ctx.schoolId)
  const bank = await systemAccount(ctx.schoolId, BANK_CODE)
  const now = new Date()
  const bankSums = await aggregateLines(ctx.schoolId, { lte: now })
  const bankRow = bankSums.get(bank.id)
  const startingBalance = round2((bankRow?.debit ?? 0) - (bankRow?.credit ?? 0))

  const structures = await prisma.salaryStructure.findMany({
    where: { schoolId: ctx.schoolId, user: { active: true, role: { in: PAYROLL_ROLES } } },
  })
  const monthlyPayrollObligation = round2(structures.reduce((a, s) => {
    const allowances = (s.allowances as { amount: number }[]).reduce((x, i) => x + i.amount, 0)
    return a + s.basic + allowances
  }, 0))

  const openInvoices = await prisma.feeInvoice.findMany({
    where: { schoolId: ctx.schoolId, status: { in: ['Due', 'PartiallyPaid'] } },
    include: { payments: true },
  })

  const months: { month: string; projectedInflow: number; projectedOutflow: number; projectedBalance: number }[] = []
  let runningBalance = startingBalance
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  for (let i = 0; i < q.months; i++) {
    const monthStart = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i, 1))
    const monthEnd = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i + 1, 0))
    const projectedInflow = round2(openInvoices
      .filter(inv => inv.dueDate >= monthStart && inv.dueDate <= monthEnd)
      .reduce((a, inv) => a + Math.max(0, inv.total - inv.concession - inv.payments.reduce((x, p) => x + p.amount, 0)), 0))
    const projectedOutflow = monthlyPayrollObligation
    runningBalance = round2(runningBalance + projectedInflow - projectedOutflow)
    months.push({
      month: `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`,
      projectedInflow, projectedOutflow, projectedBalance: runningBalance,
    })
  }

  return {
    startingBalance, monthlyPayrollObligation, months,
    methodology: 'Starting balance is the Bank account\'s current GL balance. Each month\'s projected inflow sums unpaid/partially-paid fee invoices whose due date falls in that month, net of concession and payments already received. Projected outflow assumes the current total monthly payroll obligation (active staff/teacher/admin SalaryStructure basic+allowances) stays constant across the window — no seasonality modeling.',
  }
}

const PROGRAM_PROFITABILITY_METHODOLOGY =
  'Income is real fee collections (payments actually received against invoices this term) for students enrolled in each board+grade\'s classes. Expense is each teacher\'s actual paid salary for the term, expense allocated proportionally to teaching periods — a teacher who splits their week across programs has their salary split the same way (their weekly periods in this program\'s classes ÷ their total weekly periods across all classes). Any directly-attributable expense journal entry tagged to a specific program would also be included, but this codebase has no way to tag a journal entry to a program yet, so that component is currently always zero. General/shared school overhead is NOT allocated to any program. This is a defensible estimate for comparing programs against each other, not precise cost accounting — do not treat it as an audited number.'

// GET /accounting/reports/program-profitability?termId= — "program" = a board+grade combination (the
// only program concept this codebase has before Phase 24/28 hostel/campus exist). See
// PROGRAM_PROFITABILITY_METHODOLOGY above and phase-21-financial-intelligence.md item 2 for why this is
// an estimate, not exact accounting.
export async function programProfitability(ctx: Ctx, q: z.infer<typeof programProfitabilityQuery>) {
  const term = await prisma.term.findFirst({ where: { id: q.termId, schoolId: ctx.schoolId } })
  if (!term) throw notFound('Term')

  const classes = await prisma.class.findMany({
    where: { schoolId: ctx.schoolId, academicYearId: term.academicYearId },
    include: { board: true, grade: true },
  })
  if (!classes.length) return { termId: q.termId, programs: [], methodology: PROGRAM_PROFITABILITY_METHODOLOGY }

  type Program = { boardId: string; boardName: string; gradeId: string; gradeLabel: string; classIds: string[] }
  const programs = new Map<string, Program>()
  for (const c of classes) {
    const key = `${c.boardId}::${c.gradeId}`
    const p = programs.get(key) ?? { boardId: c.boardId, boardName: c.board.name, gradeId: c.gradeId, gradeLabel: c.grade.label, classIds: [] }
    p.classIds.push(c.id)
    programs.set(key, p)
  }

  // Income: real payments this term, attributed to the class the paying student is actively enrolled in.
  const classIds = classes.map(c => c.id)
  const enrollments = await prisma.enrollment.findMany({ where: { schoolId: ctx.schoolId, classId: { in: classIds }, status: 'active' }, select: { studentId: true, classId: true } })
  const classByStudent = new Map(enrollments.map(e => [e.studentId, e.classId]))
  const invoices = await prisma.feeInvoice.findMany({
    where: { schoolId: ctx.schoolId, termId: q.termId, studentId: { in: [...classByStudent.keys()] } },
    include: { payments: true },
  })
  const incomeByClass = new Map<string, number>()
  for (const inv of invoices) {
    const classId = classByStudent.get(inv.studentId)
    if (!classId) continue
    const paid = inv.payments.reduce((a, p) => a + p.amount, 0)
    incomeByClass.set(classId, round2((incomeByClass.get(classId) ?? 0) + paid))
  }

  // Expense: each teacher's Paid payslips within the term's date range, allocated by weekly periods.
  const classSubjects = await prisma.classSubject.findMany({
    where: { schoolId: ctx.schoolId, class: { academicYearId: term.academicYearId } },
    select: { classId: true, teacherId: true, periodsPerWeek: true },
  })
  const payslips = await prisma.payslip.findMany({
    where: { schoolId: ctx.schoolId, status: 'Paid', paidAt: { gte: term.startDate, lte: term.endDate } },
  })
  const expenseByClass = new Map<string, number>()
  for (const slip of payslips) {
    const taught = classSubjects.filter(cs => cs.teacherId === slip.userId)
    const totalPeriods = taught.reduce((a, cs) => a + cs.periodsPerWeek, 0)
    if (totalPeriods <= 0) continue
    for (const cs of taught) {
      const share = round2(slip.net * (cs.periodsPerWeek / totalPeriods))
      expenseByClass.set(cs.classId, round2((expenseByClass.get(cs.classId) ?? 0) + share))
    }
  }

  const result = [...programs.values()].map(p => {
    const income = round2(p.classIds.reduce((a, id) => a + (incomeByClass.get(id) ?? 0), 0))
    const expense = round2(p.classIds.reduce((a, id) => a + (expenseByClass.get(id) ?? 0), 0))
    const inProgram = classSubjects.filter(cs => p.classIds.includes(cs.classId))
    const teacherCount = new Set(inProgram.filter(cs => cs.teacherId).map(cs => cs.teacherId)).size
    const weeklyPeriods = inProgram.reduce((a, cs) => a + cs.periodsPerWeek, 0)
    return {
      boardId: p.boardId, boardName: p.boardName, gradeId: p.gradeId, gradeLabel: p.gradeLabel,
      income, expense, profit: round2(income - expense), teacherCount, weeklyPeriods,
    }
  }).sort((a, b) => b.profit - a.profit)

  return { termId: q.termId, programs: result, methodology: PROGRAM_PROFITABILITY_METHODOLOGY }
}

// GET /accounting/reports/concession-impact?termId= — total value of fee waivers/discounts actually
// applied (FeeInvoice.concession, which already existed pre-Phase-21), broken down into the portion
// attributable to an Approved Scholarship award (Phase 21 item 4, via ScholarshipAward.appliedToInvoiceIds)
// vs. any other manually-applied concession (e.g. a staff member editing FeeInvoice.concession directly).
export async function concessionImpact(ctx: Ctx, q: z.infer<typeof concessionImpactQuery>) {
  const discountedInvoices = await prisma.feeInvoice.findMany({
    where: { schoolId: ctx.schoolId, termId: q.termId, concession: { gt: 0 } },
  })
  const allInvoices = await prisma.feeInvoice.findMany({
    where: { schoolId: ctx.schoolId, termId: q.termId }, select: { total: true },
  })
  const totalInvoiced = round2(allInvoices.reduce((a, i) => a + i.total, 0))
  const totalConcession = round2(discountedInvoices.reduce((a, i) => a + i.concession, 0))

  const awards = await prisma.scholarshipAward.findMany({
    where: { schoolId: ctx.schoolId, status: 'Approved' },
    include: { scholarship: true },
  })
  const scholarshipTypeByInvoice = new Map<string, string>()
  for (const a of awards) for (const invoiceId of a.appliedToInvoiceIds) scholarshipTypeByInvoice.set(invoiceId, a.scholarship.type)

  let scholarshipConcession = 0, manualConcession = 0
  const byType = new Map<string, number>()
  const studentsAffected = new Set<string>()
  for (const inv of discountedInvoices) {
    studentsAffected.add(inv.studentId)
    const type = scholarshipTypeByInvoice.get(inv.id)
    if (type) {
      scholarshipConcession = round2(scholarshipConcession + inv.concession)
      byType.set(type, round2((byType.get(type) ?? 0) + inv.concession))
    } else {
      manualConcession = round2(manualConcession + inv.concession)
    }
  }

  return {
    termId: q.termId, totalInvoiced, totalConcession,
    pctOfInvoiced: totalInvoiced > 0 ? round2((totalConcession / totalInvoiced) * 100) : 0,
    scholarshipConcession, manualConcession,
    byScholarshipType: [...byType.entries()].map(([type, amount]) => ({ type, amount })),
    studentsAffected: studentsAffected.size,
  }
}
