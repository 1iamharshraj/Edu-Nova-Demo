import { useCallback } from 'react'
import { api } from '../api'
import type { CanteenReconciliation, WalletMutationResult, WalletSummary, WalletTransactionsResponse, WalletTxnType } from '../data'
import { qs, useOne } from './useAcademics'

// Phase 30 — Canteen prepaid wallet (frontend). Components live in src/portal/modules/canteen.tsx.
// Reconciled against the live server/src/modules/canteen/{router,schema,service}.ts. See
// .agents/edunova/phase-30-canteen-wallet.md
//
// Wire amounts are RUPEES (a decimal number, e.g. 50.5) — same convention as Payment.amount/FeeInvoice
// everywhere else (server stores integer paise internally, never on the wire — see schema.ts's header
// note). Always format with `fmtWallet`, never divide/multiply by 100 client-side.

export const fmtWallet = (rupees: number) => `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const WALLET_TXN_LABEL: Record<WalletTxnType, string> = { TopUp: 'Top-up', Purchase: 'Purchase', Refund: 'Refund', Adjustment: 'Adjustment' }

/** `GET /canteen/wallets/:studentId` — current balance + up to 10 recent transactions. Self/guardian,
 * staff/admin, and canteen counter staff (`recent` comes back empty for plain `staff` — balance-check-
 * before-purchase only, no exposure to a family's spend history at the counter). */
export function useWallet(studentId?: string, enabled = true) {
  return useOne<WalletSummary>(enabled && studentId ? `/canteen/wallets/${encodeURIComponent(studentId)}` : null)
}

/** `GET /canteen/wallets/:studentId/transactions?from=&to=` — the full, dated, itemized spend log, newest
 * first, each row carrying its true running balance. Self/guardian, staff/admin only (not counter staff). */
export function useWalletTransactions(studentId?: string, params: { from?: string; to?: string } = {}, enabled = true) {
  return useOne<WalletTransactionsResponse>(enabled && studentId ? `/canteen/wallets/${encodeURIComponent(studentId)}/transactions${qs(params)}` : null)
}

/** `POST /canteen/wallets/:studentId/topup` — parent/guardian (own ward) or staff/admin (in-person). Only
 * credited on confirmed payment success server-side; posts Bank/Cash ↔ Canteen Wallet Liability to the GL. */
export function useTopUpWallet() {
  return useCallback((studentId: string, body: { amount: number; method: string }) =>
    api.post<WalletMutationResult>(`/canteen/wallets/${encodeURIComponent(studentId)}/topup`, body), [])
}

/** `POST /canteen/wallets/:studentId/purchase` — canteen counter staff. Server rejects (400) if the wallet's
 * balance is less than `amount` — no overdraft, ever. Posts Canteen Wallet Liability ↔ Canteen Revenue. */
export function usePurchaseWallet() {
  return useCallback((studentId: string, body: { amount: number; itemsSummary?: string }) =>
    api.post<WalletMutationResult>(`/canteen/wallets/${encodeURIComponent(studentId)}/purchase`, body), [])
}

/** `GET /canteen/reconciliation` — admin/superadmin only: sum of every wallet's balance vs. the GL's
 * Canteen Wallet Liability account balance, and whether they tie. */
export function useCanteenReconciliation(enabled = true) {
  return useOne<CanteenReconciliation>(enabled ? '/canteen/reconciliation' : null)
}
