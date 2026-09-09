import { z } from 'zod'
import { idStr } from '../../lib/validate'
import { PAYMENT_METHODS } from '../fees/schema'

// See phase-30-canteen-wallet.md. Amounts in every request/response body here are RUPEES (a decimal
// number, e.g. 50.5) — the same convention `Payment.amount`/`FeeInvoice` fields already use everywhere
// else in this API. `StudentWallet.balance`/`WalletTransaction.amount` are stored internally as integer
// PAISE (see service.ts#toPaise/fromPaise) purely as the ledger's own storage convention; that never
// leaks into the wire format so the frontend doesn't need two different amount conventions.

export const WALLET_TXN_TYPES = ['TopUp', 'Purchase', 'Refund', 'Adjustment'] as const

// Item 2: `{amount, method}` is the request shape the phase spec calls for. `orderId`/`paymentId`/
// `signature` are optional extras accepted (not required) so a real Razorpay-backed top-up can carry
// signature-verification data through in exactly the shape fees/schema.ts#gatewayConfirm already uses —
// see service.ts#topUp for when they're actually checked (RAZORPAY_KEY_ID/SECRET configured).
export const topUpBody = z.object({
  amount: z.number().positive(),
  method: z.enum(PAYMENT_METHODS),
  orderId: z.string().optional(),
  paymentId: z.string().optional(),
  signature: z.string().optional(),
})

export const purchaseBody = z.object({
  amount: z.number().positive(),
  itemsSummary: z.string().trim().max(500).optional(),
})

export const transactionsQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
})

export const studentIdParam = z.object({ studentId: idStr })
