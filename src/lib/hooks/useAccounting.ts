import type { AccountRec, AccountType, BalanceSheetRec, JournalEntryRec, JournalSourceType, ProfitAndLossRec, TrialBalanceRec } from '../data'
import { qs, useList, useOne } from './useAcademics'

// Data hooks and pure helpers for Phase 17: Accounting / General Ledger — a real double-entry ledger
// (Account, JournalEntry + JournalLine, admin/superadmin only) auto-posted from Fees/Payroll plus manual
// entries, and three reports (Trial Balance, P&L, Balance Sheet). Components live in
// src/portal/modules/accounting.tsx. See .agents/edunova/phase-17-accounting.md.
//
// Reconciled against the live server/src/modules/accounting/{router,schema,service}.ts once it landed
// (built in parallel with this frontend, same as inventory/library before it). Points worth knowing:
// - `PATCH /accounting/accounts/:id` only accepts `name`/`parentId`/`active` — `code` and `type` are
//   immutable after creation (service.ts: changing them could misfile posted journal lines, or break the
//   Fees/Payroll integration's lookup-by-code) — the edit form shows them read-only.
//   `DELETE /accounting/accounts/:id` exists too, refused for `isSystem` accounts or ones with journal
//   history/children (informative 400 message surfaced via errorMessage()).
// - Report shapes: trial-balance's rows are keyed `accounts` (not `rows`); profit-and-loss's net figure is
//   `netIncome` (not `net`); balance-sheet rows use `amount` (not `balance`), and Equity carries a
//   synthetic `{accountId: null, code: null, name: 'Retained Earnings (Net Income)', amount}` row alongside
//   a `totalLiabilitiesAndEquity` field (this phase has no period-close, so accumulated net income is
//   folded into Equity so Assets == Liabilities + Equity holds) — see BalanceSheetRow/BalanceSheetRec.
// - A serialized JournalEntry carries `totalDebit`/`totalCredit` decorations (sum of its lines) — used for
//   the Journal list's amount column instead of re-summing client-side.

export const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense']
export const JOURNAL_SOURCE_TYPES: JournalSourceType[] = ['Manual', 'FeePayment', 'Payroll', 'Other']

/** Every account-type row renders the same debit-normal/credit-normal convention as the reports: Asset and
 * Expense accounts carry a natural debit balance, Liability/Equity/Income a natural credit balance. */
export const DEBIT_NORMAL_TYPES: AccountType[] = ['Asset', 'Expense']

export const accountTypeTone = (t: AccountType): 'indigo' | 'rose' | 'sky' | 'green' | 'amber' => {
  switch (t) {
    case 'Asset': return 'indigo'
    case 'Liability': return 'rose'
    case 'Equity': return 'sky'
    case 'Income': return 'green'
    case 'Expense': return 'amber'
  }
}

/** A journal entry's source is auto-generated whenever it isn't a plain `Manual` entry (see the "System"
 * badge in the Journal screen) — `Other` also reads as system-sourced since nothing manual produces it today. */
export const isSystemSourced = (sourceType: JournalSourceType) => sourceType !== 'Manual'

export const sourceLabel = (sourceType: JournalSourceType): string => {
  switch (sourceType) {
    case 'FeePayment': return 'Fee payment'
    case 'Payroll': return 'Payroll'
    case 'Other': return 'System'
    case 'Manual': return 'Manual'
  }
}

/* ── float-safe balance check ─────────────────────────────
 * Real money arithmetic must never compare floating-point sums with `===` — 0.1 + 0.2 !== 0.3 in IEEE754, and
 * a genuinely unbalanced entry could render as "balanced" (or vice versa) depending on rounding noise. Every
 * amount is converted to an integer count of the smallest currency unit (paise, i.e. rupees × 100, rounded)
 * before summing/comparing, so the comparison is exact integer arithmetic throughout. */
export const toPaise = (amount: number | string): number => Math.round((Number(amount) || 0) * 100)

export interface LineBalanceInput { debit: number | string; credit: number | string }

/** Sums a line editor's debit/credit columns in paise and reports whether they balance — the single source of
 * truth for the live balance-check UI in the manual journal entry form. */
export function computeBalance(lines: LineBalanceInput[]) {
  const debitPaise = lines.reduce((a, l) => a + toPaise(l.debit), 0)
  const creditPaise = lines.reduce((a, l) => a + toPaise(l.credit), 0)
  return { debitPaise, creditPaise, balanced: debitPaise === creditPaise, diffPaise: debitPaise - creditPaise }
}

/** Paise back to a rupee amount for display — never used for the balance comparison itself, only formatting. */
export const fromPaise = (paise: number) => paise / 100

export const fmtMoney = (amount: number) =>
  `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/* ── accounts ──────────────────────────────────────────── */

/** `GET /accounting/accounts?type=&active=` — admin/superadmin only. */
export function useAccounts(params: { type?: AccountType; active?: boolean } = {}, enabled = true) {
  return useList<AccountRec>(enabled ? `/accounting/accounts${qs({
    type: params.type, active: params.active === undefined ? undefined : String(params.active),
  })}` : null)
}

/* ── journal ───────────────────────────────────────────── */

/** `GET /accounting/journal-entries?from=&to=&accountId=&sourceType=` — admin/superadmin only. The server
 * paginates (`limit`/`cursor`, Phase 10's helper) with a generous default limit; this screen relies on that
 * default rather than driving a "load more" UI, same convention as `useInvoices`/`usePayments`. */
export function useJournalEntries(params: { from?: string; to?: string; accountId?: string; sourceType?: JournalSourceType } = {}, enabled = true) {
  return useList<JournalEntryRec>(enabled ? `/accounting/journal-entries${qs(params)}` : null)
}

export function useJournalEntry(id?: string, enabled = true) {
  return useOne<JournalEntryRec>(enabled && id ? `/accounting/journal-entries/${encodeURIComponent(id)}` : null)
}

/* ── reports ───────────────────────────────────────────── */

/** `GET /accounting/reports/trial-balance?asOf=` — admin/superadmin only. */
export function useTrialBalance(asOf?: string, enabled = true) {
  return useOne<TrialBalanceRec>(enabled && asOf ? `/accounting/reports/trial-balance${qs({ asOf })}` : null)
}

/** `GET /accounting/reports/profit-and-loss?from=&to=` — admin/superadmin only. */
export function useProfitAndLoss(from?: string, to?: string, enabled = true) {
  return useOne<ProfitAndLossRec>(enabled && from && to ? `/accounting/reports/profit-and-loss${qs({ from, to })}` : null)
}

/** `GET /accounting/reports/balance-sheet?asOf=` — admin/superadmin only. */
export function useBalanceSheet(asOf?: string, enabled = true) {
  return useOne<BalanceSheetRec>(enabled && asOf ? `/accounting/reports/balance-sheet${qs({ asOf })}` : null)
}
