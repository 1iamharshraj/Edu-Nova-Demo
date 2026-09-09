import { z } from 'zod'
import { idStr, dateStr } from '../../lib/validate'

// See phase-17-accounting.md.

export const ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'] as const
// 'CanteenTopUp'/'CanteenPurchase' — Phase 30, see modules/accounting/service.ts#postCanteenTopUpAutoEntry
// / #postCanteenPurchaseAutoEntry.
export const SOURCE_TYPES = ['Manual', 'FeePayment', 'Payroll', 'CanteenTopUp', 'CanteenPurchase', 'Other'] as const

// ───────────────────────────── accounts ─────────────────────────────

export const createAccount = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(160),
  type: z.enum(ACCOUNT_TYPES),
  parentId: idStr.nullable().optional(),
  active: z.boolean().optional(),
})

// `code` and `type` are immutable after creation (service.ts) — changing either could silently misfile
// every journal line already posted against the account, or (for `code`) break the Fees/Payroll
// integration's lookup-by-code. Only name/parent/active are editable.
export const patchAccount = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  parentId: idStr.nullable().optional(),
  active: z.boolean().optional(),
})

export const accountQuery = z.object({
  type: z.enum(ACCOUNT_TYPES).optional(),
  active: z.enum(['true', 'false']).optional(),
})

// ───────────────────────────── journal entries ─────────────────────────────

// Exactly one of debit/credit must be non-zero per line — both fields present (>= 0) so the client can
// render a two-column debit/credit table, but never both positive and never both zero.
export const journalLineInput = z
  .object({
    accountId: idStr,
    debit: z.number().min(0).max(1_000_000_000).default(0),
    credit: z.number().min(0).max(1_000_000_000).default(0),
  })
  .refine(l => (l.debit > 0) !== (l.credit > 0), 'Each line must have exactly one of debit/credit non-zero')

export const createJournalEntry = z.object({
  date: dateStr,
  memo: z.string().trim().min(1).max(300),
  reference: z.string().trim().max(200).nullable().optional(),
  lines: z.array(journalLineInput).min(2).max(50),
})

export const journalQuery = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  accountId: idStr.optional(),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().min(1).optional(),
})

// ───────────────────────────── reports ─────────────────────────────

export const trialBalanceQuery = z.object({ asOf: dateStr })
export const profitAndLossQuery = z.object({ from: dateStr, to: dateStr })
export const balanceSheetQuery = z.object({ asOf: dateStr })

// ───────────────────────────── Phase 21 — financial intelligence ─────────────────────────────

export const cashFlowForecastQuery = z.object({ months: z.coerce.number().int().min(1).max(12).default(3) })
export const programProfitabilityQuery = z.object({ termId: idStr })
export const concessionImpactQuery = z.object({ termId: idStr.optional() })
