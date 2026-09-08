import type { z } from 'zod'
import type { Prisma, Account, JournalEntry, JournalLine } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { paginate } from '../../lib/pagination'
import { logger } from '../../lib/logger'
import type { createAccount, patchAccount, accountQuery, createJournalEntry, journalQuery, trialBalanceQuery, profitAndLossQuery, balanceSheetQuery } from './schema'

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

export const DEFAULT_CHART: { code: string; name: string; type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense'; parentCode?: string; isSystem: boolean }[] = [
  { code: '1000', name: 'Current Assets', type: 'Asset', isSystem: false },
  { code: '1001', name: 'Cash', type: 'Asset', parentCode: '1000', isSystem: false },
  { code: BANK_CODE, name: 'Bank', type: 'Asset', parentCode: '1000', isSystem: true },
  { code: '2000', name: 'Accounts Payable', type: 'Liability', isSystem: false },
  { code: '3000', name: 'Opening Balance', type: 'Equity', isSystem: false },
  { code: FEE_INCOME_CODE, name: 'Fee Income', type: 'Income', isSystem: true },
  { code: '4010', name: 'Donation Income', type: 'Income', isSystem: false },
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
  if (count > 0) return
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

async function systemAccount(schoolId: string, code: string) {
  const row = await prisma.account.findFirst({ where: { schoolId, code } })
  if (!row) throw new Error(`System account with code ${code} is missing for school ${schoolId}`)
  return row
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
