import type { z } from 'zod'
import { Prisma, type StudentWallet, type WalletTransaction } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isStaff, isAdmin, assertViewStudent } from '../../lib/scope'
import { toDate } from '../../lib/validate'
import { postCanteenTopUpAutoEntry, postCanteenPurchaseAutoEntry, systemAccountBalance, CANTEEN_LIABILITY_CODE } from '../accounting/service'
import type { topUpBody, purchaseBody, transactionsQuery } from './schema'

// See phase-30-canteen-wallet.md. Ledger-not-mutable-total pattern: `WalletTransaction.amount` is the
// source of truth (signed integer paise, balance is always re-derivable as its running sum);
// `StudentWallet.balance` is a maintained cache updated in the same DB transaction as every
// WalletTransaction insert, so it can never drift from the ledger.

const round2 = (n: number) => Math.round(n * 100) / 100
const toPaise = (rupees: number) => Math.round(rupees * 100)
const fromPaise = (paise: number) => round2(paise / 100)

export const serializeWallet = (w: StudentWallet) => ({
  id: w.id, studentId: w.studentId, balance: fromPaise(w.balance),
  createdAt: w.createdAt.toISOString(), updatedAt: w.updatedAt.toISOString(),
})

export const serializeTxn = (t: WalletTransaction) => ({
  id: t.id, walletId: t.walletId, type: t.type, amount: fromPaise(t.amount),
  reason: t.reason ?? undefined, itemsSummary: t.itemsSummary ?? undefined,
  recordedById: t.recordedById ?? undefined, occurredAt: t.occurredAt.toISOString(),
})

async function getStudentUser(ctx: Ctx, studentId: string) {
  const user = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId } })
  if (!user) throw notFound('Student')
  if (user.role !== 'student') throw new HttpError(400, 'Wallets are only issued to student accounts')
  return user
}

// Lazily creates a wallet on first touch (top-up or purchase) — mirrors ensureChartSeeded's "seed on
// first use" pattern in accounting/service.ts. `studentId` is globally unique (StudentWallet.studentId
// @unique), so a cross-school collision is not something normal operation can trigger; the schoolId guard
// below is defense in depth only.
async function ensureWallet(ctx: Ctx, studentId: string) {
  const existing = await prisma.studentWallet.findUnique({ where: { studentId } })
  if (existing) {
    if (existing.schoolId !== ctx.schoolId) throw notFound('Student')
    return existing
  }
  await getStudentUser(ctx, studentId)
  try {
    return await prisma.studentWallet.create({ data: { schoolId: ctx.schoolId, studentId, balance: 0 } })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return prisma.studentWallet.findUniqueOrThrow({ where: { studentId } })
    }
    throw err
  }
}

async function findWallet(ctx: Ctx, studentId: string) {
  return prisma.studentWallet.findFirst({ where: { studentId, schoolId: ctx.schoolId } })
}

// self (student), guardian (parent), or staff/admin/superadmin — teachers and anyone else have no access
// to wallet data, this is real money and a family's spend history.
async function assertWalletViewAccess(ctx: Ctx, studentId: string) {
  if (ctx.role === 'student' || ctx.role === 'parent') return assertViewStudent(ctx, studentId)
  if (isStaff(ctx)) return
  throw new HttpError(403, 'You do not have access to this wallet')
}

// Mirrors fees/service.ts#gatewayConfirmPayment exactly: in sandbox mode (no RAZORPAY_KEY_ID/SECRET
// configured — the state of every dev/demo environment) the confirmation is accepted as-is; with real
// keys configured, the HMAC signature is verified before the wallet is ever credited.
async function verifyGatewaySignatureIfConfigured(input: { orderId?: string; paymentId?: string; signature?: string }) {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (keyId && keySecret) {
    const crypto = await import('node:crypto')
    const expected = crypto.createHmac('sha256', keySecret).update(`${input.orderId ?? ''}|${input.paymentId ?? ''}`).digest('hex')
    if (expected !== input.signature) throw new HttpError(400, 'Payment signature verification failed')
  }
}

// POST /canteen/wallets/:studentId/topup — parent/guardian (for their ward) or staff/admin (in-person).
// Only credits the wallet on confirmed payment success (see verifyGatewaySignatureIfConfigured above);
// on success, posts Debit Bank / Credit Canteen Wallet Liability to the real GL (Phase 17 funnel).
export async function topUp(ctx: Ctx, studentId: string, input: z.infer<typeof topUpBody>) {
  if (ctx.role === 'parent') await assertViewStudent(ctx, studentId)
  else if (!isStaff(ctx)) throw new HttpError(403, 'Only a parent/guardian or staff/admin may top up a wallet')

  await verifyGatewaySignatureIfConfigured(input)
  const wallet = await ensureWallet(ctx, studentId)
  const amountPaise = toPaise(input.amount)
  const amountRupees = fromPaise(amountPaise)

  const { updated, txn } = await prisma.$transaction(async tx => {
    const updated = await tx.studentWallet.update({ where: { id: wallet.id }, data: { balance: { increment: amountPaise } } })
    const txn = await tx.walletTransaction.create({
      data: {
        schoolId: ctx.schoolId, walletId: wallet.id, type: 'TopUp', amount: amountPaise,
        reason: `Top-up via ${input.method}`, recordedById: ctx.actorId,
      },
    })
    return { updated, txn }
  })
  await audit(ctx.schoolId, ctx.actorId, 'topup', 'studentWallet', wallet.id,
    { balance: fromPaise(wallet.balance) }, { balance: fromPaise(updated.balance), amount: amountRupees, method: input.method, transactionId: txn.id })
  // Phase 17 — best-effort ledger auto-post; never blocks or rolls back the wallet credit itself.
  await postCanteenTopUpAutoEntry(ctx, { id: txn.id, amount: amountRupees, occurredAt: txn.occurredAt })
  return { wallet: serializeWallet(updated), transaction: serializeTxn(txn) }
}

// POST /canteen/wallets/:studentId/purchase — canteen counter staff (see the same role-granularity
// limitation Phase 22 flagged for gate-security: no dedicated canteen-staff role exists yet, so plain
// `staff` is used and this grants every staff account purchase-recording rights school-wide, not just
// canteen counter staff — a future phase should add a dedicated role/flag if that turns out to matter).
// Rejects with 400 if the balance is insufficient — no overdraft, ever; on success posts Debit Canteen
// Wallet Liability / Credit Canteen Revenue to the real GL.
export async function purchase(ctx: Ctx, studentId: string, input: z.infer<typeof purchaseBody>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only canteen/staff/admin may record a purchase')

  const wallet = await ensureWallet(ctx, studentId)
  const amountPaise = toPaise(input.amount)
  if (wallet.balance < amountPaise) {
    throw new HttpError(400, `Insufficient wallet balance: has Rs.${fromPaise(wallet.balance).toFixed(2)}, needs Rs.${input.amount.toFixed(2)}`, {
      balance: fromPaise(wallet.balance), required: input.amount,
    })
  }

  const { updated, txn } = await prisma.$transaction(async tx => {
    // Atomic check-and-decrement in a single conditional UPDATE — closes the race that a plain
    // read-then-write (SELECT balance, then UPDATE) leaves open under Postgres Read-Committed isolation,
    // where two concurrent purchases can both pass a prior SELECT check before either commits. The
    // `balance: { gte: amountPaise }` guard in the WHERE clause makes the check part of the same atomic
    // statement as the decrement, so only one of two racing purchases can ever succeed.
    const result = await tx.studentWallet.updateMany({
      where: { id: wallet.id, balance: { gte: amountPaise } },
      data: { balance: { decrement: amountPaise } },
    })
    if (result.count === 0) {
      const fresh = await tx.studentWallet.findUniqueOrThrow({ where: { id: wallet.id } })
      throw new HttpError(400, `Insufficient wallet balance: has Rs.${fromPaise(fresh.balance).toFixed(2)}, needs Rs.${input.amount.toFixed(2)}`, {
        balance: fromPaise(fresh.balance), required: input.amount,
      })
    }
    const updated = await tx.studentWallet.findUniqueOrThrow({ where: { id: wallet.id } })
    const txn = await tx.walletTransaction.create({
      data: {
        schoolId: ctx.schoolId, walletId: wallet.id, type: 'Purchase', amount: -amountPaise,
        itemsSummary: input.itemsSummary ?? null, recordedById: ctx.actorId,
      },
    })
    return { updated, txn }
  })
  await audit(ctx.schoolId, ctx.actorId, 'purchase', 'studentWallet', wallet.id,
    { balance: fromPaise(wallet.balance) }, { balance: fromPaise(updated.balance), amount: input.amount, itemsSummary: input.itemsSummary, transactionId: txn.id })
  await postCanteenPurchaseAutoEntry(ctx, { id: txn.id, amount: fromPaise(amountPaise), occurredAt: txn.occurredAt })
  return { wallet: serializeWallet(updated), transaction: serializeTxn(txn) }
}

// GET /canteen/wallets/:studentId — current balance + a short recent-activity list. For plain `staff`
// (indistinguishable from canteen counter staff — see the role-granularity note on `purchase` above) the
// transaction list is deliberately withheld: a counter staffer needs to see the balance before a sale,
// not a family's full spend history — that's what GET /transactions is for, gated the same way everywhere
// else in this codebase (self/guardian, staff/admin).
export async function getWalletSummary(ctx: Ctx, studentId: string) {
  await assertWalletViewAccess(ctx, studentId)
  const wallet = await findWallet(ctx, studentId)
  const balance = wallet ? fromPaise(wallet.balance) : 0
  if (!wallet || ctx.role === 'staff') return { studentId, balance, recent: [] as ReturnType<typeof serializeTxn>[] }
  const rows = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 10,
  })
  return { studentId, balance, recent: rows.map(serializeTxn) }
}

// GET /canteen/wallets/:studentId/transactions?from=&to= — full, dated, itemized spend log with a running
// balance per row (self/guardian, staff/admin). The running balance is computed over the WHOLE ledger
// (not just the filtered window) so a filtered row's balance is the true wallet balance at that moment,
// then the from/to window is applied for display.
export async function listTransactions(ctx: Ctx, studentId: string, q: z.infer<typeof transactionsQuery>) {
  await assertWalletViewAccess(ctx, studentId)
  const wallet = await findWallet(ctx, studentId)
  if (!wallet) return { studentId, balance: 0, items: [] as (ReturnType<typeof serializeTxn> & { runningBalance: number })[] }

  const all = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] })
  let running = 0
  const withRunning = all.map(t => { running += t.amount; return { t, runningBalance: running } })

  const from = q.from ? toDate(q.from) : undefined
  const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : undefined
  const filtered = withRunning.filter(({ t }) => (!from || t.occurredAt >= from) && (!to || t.occurredAt <= to))
  filtered.reverse() // newest first for display, per the other list endpoints' convention in this codebase

  return {
    studentId, balance: fromPaise(wallet.balance),
    items: filtered.map(({ t, runningBalance }) => ({ ...serializeTxn(t), runningBalance: fromPaise(runningBalance) })),
  }
}

// Admin reconciliation check (item 6): sum of every wallet's balance for this school should always equal
// the Canteen Wallet Liability GL account's balance — both are driven off the exact same two auto-post
// hooks, so any mismatch would indicate a real bug (e.g. a ledger post that silently failed while the
// wallet credit/debit went through — see the fail-open comment on postCanteenTopUpAutoEntry). Compared in
// integer paise, never float ===, per this codebase's GL convention.
export async function reconciliation(ctx: Ctx) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  const wallets = await prisma.studentWallet.findMany({ where: { schoolId: ctx.schoolId }, select: { balance: true } })
  const sumWalletBalancesPaise = wallets.reduce((a, w) => a + w.balance, 0)
  const glLiabilityBalance = await systemAccountBalance(ctx.schoolId, CANTEEN_LIABILITY_CODE)
  const sumWalletBalances = fromPaise(sumWalletBalancesPaise)
  return {
    walletCount: wallets.length,
    sumWalletBalances,
    glLiabilityBalance,
    reconciled: Math.round(sumWalletBalances * 100) === Math.round(glLiabilityBalance * 100),
  }
}
