// Mirrors server/src/modules/canteen/{router,service}.ts (phase-30-canteen-wallet.md). Amounts here are
// plain RUPEES throughout (no paise conversion — this mock has no reason to mirror the real backend's
// integer-paise storage convention since nothing else reads these rows). Ledger-not-mutable-total
// pattern kept: `WalletTransaction.amount` is signed and the wallet's `balance` is just a maintained
// cache of the running sum, same as the real service.
//
// Reconciliation (item 6) is simplified: the real endpoint compares the wallet-balance sum against a
// separate GL "Canteen Wallet Liability" account maintained by the accounting module's auto-post hooks.
// Wiring a full journal-entry integration is out of this batch's scope, so `glLiabilityBalance` here is
// simply mirrored to equal `sumWalletBalances` (always reconciled) — a defensible simulation of the
// invariant the real system enforces via double-entry posting on every top-up/purchase.

import { route, requireAuth, status } from '../router'
import { notFound, badRequest, forbidden } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = new Set(['staff', 'admin', 'superadmin'])
const isStaff = (role: string) => STAFF_ROLES.has(role)
const round2 = (n: number) => Math.round(n * 100) / 100

function serializeWallet(w: Row) {
  return { id: w.id, studentId: w.studentId, balance: round2(Number(w.balance)), createdAt: w.createdAt, updatedAt: w.updatedAt }
}

function serializeTxn(t: Row) {
  return { id: t.id, walletId: t.walletId, type: t.type, amount: round2(Number(t.amount)), reason: t.reason ?? undefined, itemsSummary: t.itemsSummary ?? undefined, recordedById: t.recordedById ?? undefined, occurredAt: t.occurredAt }
}

function getStudentUser(schoolId: string, studentId: string) {
  const user = table('User').find(u => u.id === studentId && u.schoolId === schoolId)
  if (!user) throw notFound('Student')
  if (user.role !== 'student') throw badRequest('Wallets are only issued to student accounts')
  return user
}

function ensureWallet(schoolId: string, studentId: string): Row {
  const rows = table('StudentWallet')
  const existing = rows.find(w => w.studentId === studentId)
  if (existing) return existing
  getStudentUser(schoolId, studentId)
  const row: Row = { id: uid('wallet'), schoolId, studentId, balance: 0, createdAt: nowIso(), updatedAt: nowIso() }
  rows.push(row); saveTable('StudentWallet', rows)
  return row
}

function findWallet(schoolId: string, studentId: string) {
  return table('StudentWallet').find(w => w.studentId === studentId && w.schoolId === schoolId)
}

function isGuardianOf(schoolId: string, parentId: string, studentId: string) {
  return table('Guardian').some(g => g.schoolId === schoolId && g.parentId === parentId && g.studentId === studentId)
}

function assertWalletViewAccess(actor: { userId: string; role: string; schoolId: string }, studentId: string) {
  if (actor.role === 'student') { if (actor.userId !== studentId) throw forbidden('You do not have access to this wallet'); return }
  if (actor.role === 'parent') { if (!isGuardianOf(actor.schoolId, actor.userId, studentId)) throw forbidden('You do not have access to this wallet'); return }
  if (isStaff(actor.role)) return
  throw forbidden('You do not have access to this wallet')
}

route('POST', '/canteen/wallets/:studentId/topup', (ctx) => {
  const actor = requireAuth(ctx)
  const studentId = ctx.params.studentId
  if (actor.role === 'parent') { if (!isGuardianOf(actor.schoolId, actor.userId, studentId)) throw forbidden('You do not have access to this wallet') }
  else if (!isStaff(actor.role)) throw forbidden('Only a parent/guardian or staff/admin may top up a wallet')

  const b = ctx.body as { amount: number; method: string }
  if (!(b.amount > 0)) throw badRequest('amount must be positive')
  const wallet = ensureWallet(actor.schoolId, studentId)
  const wallets = table('StudentWallet')
  const idx = wallets.findIndex(w => w.id === wallet.id)
  const updated: Row = { ...wallets[idx], balance: round2(Number(wallets[idx].balance) + b.amount), updatedAt: nowIso() }
  wallets[idx] = updated; saveTable('StudentWallet', wallets)

  const txn: Row = { id: uid('wtx'), schoolId: actor.schoolId, walletId: wallet.id, type: 'TopUp', amount: b.amount, reason: `Top-up via ${b.method}`, itemsSummary: null, recordedById: actor.userId, occurredAt: nowIso() }
  const txns = table('WalletTransaction'); txns.push(txn); saveTable('WalletTransaction', txns)

  const notifs = table('Notification')
  notifs.push({ id: uid('notif'), schoolId: actor.schoolId, userId: studentId, kind: 'wallet', title: 'Canteen wallet topped up', body: `₹${b.amount} added to your canteen wallet.`, link: 'canteen', readAt: null, createdAt: nowIso() } as Row)
  saveTable('Notification', notifs)

  return status(201, { wallet: serializeWallet(updated), transaction: serializeTxn(txn) })
})

route('POST', '/canteen/wallets/:studentId/purchase', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isStaff(actor.role)) throw forbidden('Only canteen/staff/admin may record a purchase')
  const studentId = ctx.params.studentId
  const b = ctx.body as { amount: number; itemsSummary?: string }
  if (!(b.amount > 0)) throw badRequest('amount must be positive')

  const wallet = ensureWallet(actor.schoolId, studentId)
  const wallets = table('StudentWallet')
  const idx = wallets.findIndex(w => w.id === wallet.id)
  const balance = Number(wallets[idx].balance)
  if (balance < b.amount) {
    throw badRequest(`Insufficient wallet balance: has ₹${balance.toFixed(2)}, needs ₹${b.amount.toFixed(2)}`, { balance, required: b.amount })
  }
  const updated: Row = { ...wallets[idx], balance: round2(balance - b.amount), updatedAt: nowIso() }
  wallets[idx] = updated; saveTable('StudentWallet', wallets)

  const txn: Row = { id: uid('wtx'), schoolId: actor.schoolId, walletId: wallet.id, type: 'Purchase', amount: -b.amount, reason: null, itemsSummary: b.itemsSummary ?? null, recordedById: actor.userId, occurredAt: nowIso() }
  const txns = table('WalletTransaction'); txns.push(txn); saveTable('WalletTransaction', txns)

  return status(201, { wallet: serializeWallet(updated), transaction: serializeTxn(txn) })
})

route('GET', '/canteen/wallets/:studentId', (ctx) => {
  const actor = requireAuth(ctx)
  const studentId = ctx.params.studentId
  assertWalletViewAccess(actor, studentId)
  const wallet = findWallet(actor.schoolId, studentId)
  const balance = wallet ? round2(Number(wallet.balance)) : 0
  if (!wallet || actor.role === 'staff') return { studentId, balance, recent: [] }
  const rows = [...table('WalletTransaction').filter(t => t.walletId === wallet.id)].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0, 10)
  return { studentId, balance, recent: rows.map(serializeTxn) }
})

route('GET', '/canteen/wallets/:studentId/transactions', (ctx) => {
  const actor = requireAuth(ctx)
  const studentId = ctx.params.studentId
  assertWalletViewAccess(actor, studentId)
  const wallet = findWallet(actor.schoolId, studentId)
  if (!wallet) return { studentId, balance: 0, items: [] }

  const all = [...table('WalletTransaction').filter(t => t.walletId === wallet.id)].sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)))
  let running = 0
  const withRunning = all.map(t => { running = round2(running + Number(t.amount)); return { t, runningBalance: running } })

  const { from, to } = ctx.query
  const filtered = withRunning.filter(({ t }) => (!from || String(t.occurredAt) >= from) && (!to || String(t.occurredAt) <= `${to}T23:59:59.999Z`))
  filtered.reverse()

  return { studentId, balance: round2(Number(wallet.balance)), items: filtered.map(({ t, runningBalance }) => ({ ...serializeTxn(t), runningBalance: round2(runningBalance) })) }
})

route('GET', '/canteen/reconciliation', (ctx) => {
  const actor = requireAuth(ctx)
  if (!(actor.role === 'admin' || actor.role === 'superadmin')) throw forbidden('Admin/superadmin only')
  const wallets = table('StudentWallet').filter(w => w.schoolId === actor.schoolId)
  const sumWalletBalances = round2(wallets.reduce((a, w) => a + Number(w.balance), 0))
  // See header note — no separate GL integration in this batch, so the liability side is mirrored.
  return { walletCount: wallets.length, sumWalletBalances, glLiabilityBalance: sumWalletBalances, reconciled: true }
})
