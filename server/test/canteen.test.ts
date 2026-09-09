import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader } from './helpers/auth'

// See phase-30-canteen-wallet.md. Covers the RBAC surface, the no-overdraft invariant, and (indirectly,
// via the accounting reports the school already exposes) that the GL posts on both top-up and purchase.

const app = createApp()
let fx: Fixture

beforeAll(async () => {
  fx = await buildFixture(app)
})

describe('canteen wallet: RBAC', () => {
  it('a teacher cannot top up a wallet', async () => {
    const res = await request(app).post(`/api/canteen/wallets/${fx.ids.studentId}/topup`)
      .set(authHeader(fx.tokens.teacher)).send({ amount: 100, method: 'Cash' })
    expect(res.status).toBe(403)
  })
  it('an unrelated parent cannot top up someone else\'s ward', async () => {
    const other = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'parent', name: 'Other Parent' })
    const login = await request(app).post('/api/auth/login').send({ email: other.body.user.email, password: other.body.password })
    const res = await request(app).post(`/api/canteen/wallets/${fx.ids.studentId}/topup`)
      .set(authHeader(login.body.token)).send({ amount: 100, method: 'Cash' })
    expect(res.status).toBe(403)
  })
  it('a teacher cannot record a purchase', async () => {
    const res = await request(app).post(`/api/canteen/wallets/${fx.ids.studentId}/purchase`)
      .set(authHeader(fx.tokens.teacher)).send({ amount: 10 })
    expect(res.status).toBe(403)
  })
  it('a student cannot record a purchase', async () => {
    const res = await request(app).post(`/api/canteen/wallets/${fx.ids.studentId}/purchase`)
      .set(authHeader(fx.tokens.student)).send({ amount: 10 })
    expect(res.status).toBe(403)
  })
})

describe('canteen wallet: top-up -> purchase -> insufficient balance', () => {
  it('a new wallet has zero balance', async () => {
    const res = await request(app).get(`/api/canteen/wallets/${fx.ids.studentId}`).set(authHeader(fx.tokens.student))
    expect(res.status).toBe(200)
    expect(res.body.balance).toBe(0)
  })

  it('parent tops up 500 (rupees) for their ward', async () => {
    const res = await request(app).post(`/api/canteen/wallets/${fx.ids.studentId}/topup`)
      .set(authHeader(fx.tokens.parent)).send({ amount: 500, method: 'UPI' })
    expect(res.status).toBe(201)
    expect(res.body.wallet.balance).toBe(500)
    expect(res.body.transaction.type).toBe('TopUp')
    expect(res.body.transaction.amount).toBe(500)
  })

  it('staff records a purchase of 120', async () => {
    const res = await request(app).post(`/api/canteen/wallets/${fx.ids.studentId}/purchase`)
      .set(authHeader(fx.tokens.staff)).send({ amount: 120, itemsSummary: '2x Samosa, 1x Juice' })
    expect(res.status).toBe(201)
    expect(res.body.wallet.balance).toBe(380)
    expect(res.body.transaction.type).toBe('Purchase')
    expect(res.body.transaction.amount).toBe(-120)
  })

  it('a purchase exceeding the balance is cleanly rejected (400), balance untouched', async () => {
    const res = await request(app).post(`/api/canteen/wallets/${fx.ids.studentId}/purchase`)
      .set(authHeader(fx.tokens.staff)).send({ amount: 5000 })
    expect(res.status).toBe(400)
    const check = await request(app).get(`/api/canteen/wallets/${fx.ids.studentId}`).set(authHeader(fx.tokens.staff))
    expect(check.body.balance).toBe(380)
  })

  it('canteen/staff GET summary does not include recent transactions (balance-check-only)', async () => {
    const res = await request(app).get(`/api/canteen/wallets/${fx.ids.studentId}`).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(200)
    expect(res.body.balance).toBe(380)
    expect(res.body.recent).toEqual([])
  })

  it('admin GET summary includes recent transactions', async () => {
    const res = await request(app).get(`/api/canteen/wallets/${fx.ids.studentId}`).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.recent.length).toBe(2)
  })

  it('the full spend log (self) shows both transactions with a running balance', async () => {
    const res = await request(app).get(`/api/canteen/wallets/${fx.ids.studentId}/transactions`).set(authHeader(fx.tokens.student))
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(2)
    // newest first: Purchase(-120, running 380) then TopUp(+500, running 500)
    expect(res.body.items[0].type).toBe('Purchase')
    expect(res.body.items[0].runningBalance).toBe(380)
    expect(res.body.items[1].type).toBe('TopUp')
    expect(res.body.items[1].runningBalance).toBe(500)
  })

  it('never goes negative: balance stays 380 after the rejected purchase attempt', async () => {
    const res = await request(app).get(`/api/canteen/wallets/${fx.ids.studentId}`).set(authHeader(fx.tokens.admin))
    expect(res.body.balance).toBe(380)
    expect(res.body.balance).toBeGreaterThanOrEqual(0)
  })
})

describe('canteen wallet: admin reconciliation', () => {
  it('sum of wallet balances equals the Canteen Wallet Liability GL account balance', async () => {
    const res = await request(app).get('/api/canteen/reconciliation').set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.sumWalletBalances).toBe(380)
    expect(res.body.glLiabilityBalance).toBe(380)
    expect(res.body.reconciled).toBe(true)
  })
  it('staff cannot view the reconciliation report', async () => {
    const res = await request(app).get('/api/canteen/reconciliation').set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(403)
  })
})

describe('canteen wallet: concurrent purchases never overdraw the balance', () => {
  it('top up to 480 total, then fire two concurrent 300 purchases — exactly one wins, balance never negative', async () => {
    const top = await request(app).post(`/api/canteen/wallets/${fx.ids.studentId}/topup`)
      .set(authHeader(fx.tokens.parent)).send({ amount: 100, method: 'UPI' })
    expect(top.status).toBe(201)
    const before = await request(app).get(`/api/canteen/wallets/${fx.ids.studentId}`).set(authHeader(fx.tokens.admin))
    expect(before.body.balance).toBe(480) // 380 carried over from the earlier describe block + 100 top-up

    // 480 can afford one 300 purchase but not two (600 > 480) — mirrors the audit's live repro of firing
    // two concurrent purchases against a wallet that can only afford one.
    const [a, b] = await Promise.all([
      request(app).post(`/api/canteen/wallets/${fx.ids.studentId}/purchase`).set(authHeader(fx.tokens.staff)).send({ amount: 300 }),
      request(app).post(`/api/canteen/wallets/${fx.ids.studentId}/purchase`).set(authHeader(fx.tokens.staff)).send({ amount: 300 }),
    ])
    const statuses = [a.status, b.status].sort((x, y) => x - y)
    expect(statuses).toEqual([201, 400])

    const after = await request(app).get(`/api/canteen/wallets/${fx.ids.studentId}`).set(authHeader(fx.tokens.admin))
    expect(after.body.balance).toBe(180)
    expect(after.body.balance).toBeGreaterThanOrEqual(0)
  })
})
