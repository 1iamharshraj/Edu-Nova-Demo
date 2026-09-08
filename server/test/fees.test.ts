import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader } from './helpers/auth'

const app = createApp()
let fx: Fixture
let feeHeadId: string
let structureId: string
let invoiceId: string

const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

beforeAll(async () => {
  fx = await buildFixture(app)
})

describe('fees RBAC', () => {
  it('teacher cannot create a fee head', async () => {
    const res = await request(app).post('/api/fees/heads').set(authHeader(fx.tokens.teacher)).send({ name: 'Tuition' })
    expect(res.status).toBe(403)
  })
  it('student cannot create a fee head', async () => {
    const res = await request(app).post('/api/fees/heads').set(authHeader(fx.tokens.student)).send({ name: 'Tuition' })
    expect(res.status).toBe(403)
  })
  it('staff can create a fee head', async () => {
    const res = await request(app).post('/api/fees/heads').set(authHeader(fx.tokens.staff)).send({ name: 'Tuition' })
    expect(res.status).toBe(201)
    feeHeadId = res.body.item.id
  })
})

describe('fees: invoice -> pay -> defaulter check', () => {
  it('staff builds a fee structure for the class/term with a due date already in the past', async () => {
    const res = await request(app).post('/api/fees/structures').set(authHeader(fx.tokens.staff)).send({
      classId: fx.ids.classId, termId: fx.ids.termId, dueDate: yesterday,
      lines: [{ feeHeadId, amount: 5000 }],
    })
    expect(res.status).toBe(201)
    structureId = res.body.item.id
  })

  it('generating invoices creates one per active enrollment (1 student)', async () => {
    const res = await request(app).post(`/api/fees/structures/${structureId}/generate`).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(201)
    expect(res.body.created).toBe(1)
  })

  it('generating again for the same structure creates nothing new (idempotent)', async () => {
    const res = await request(app).post(`/api/fees/structures/${structureId}/generate`).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(201)
    expect(res.body.created).toBe(0)
  })

  it('the student can see their own invoice', async () => {
    const res = await request(app).get('/api/fees/invoices').query({ studentId: fx.ids.studentId }).set(authHeader(fx.tokens.student))
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    invoiceId = res.body.items[0].id
    expect(res.body.items[0].status).toBe('Due')
  })

  it('the invoice already shows up as a defaulter (due date is in the past)', async () => {
    const res = await request(app).get('/api/fees/defaulters').query({ termId: fx.ids.termId }).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(200)
    expect(res.body.items.some((d: { studentId: string }) => d.studentId === fx.ids.studentId)).toBe(true)
  })

  it('a teacher cannot record a payment', async () => {
    const res = await request(app).post('/api/fees/payments').set(authHeader(fx.tokens.teacher)).send({ invoiceId, amount: 5000, method: 'Cash' })
    expect(res.status).toBe(403)
  })

  it('staff records full payment; invoice becomes Paid', async () => {
    const res = await request(app).post('/api/fees/payments').set(authHeader(fx.tokens.staff)).send({ invoiceId, amount: 5000, method: 'Cash' })
    expect(res.status).toBe(201)
    const inv = await request(app).get(`/api/fees/invoices/${invoiceId}`).set(authHeader(fx.tokens.staff))
    expect(inv.body.item.status).toBe('Paid')
  })

  it('a fully paid invoice no longer appears in the defaulter list', async () => {
    const res = await request(app).get('/api/fees/defaulters').query({ termId: fx.ids.termId }).set(authHeader(fx.tokens.staff))
    expect(res.body.items.some((d: { studentId: string }) => d.studentId === fx.ids.studentId)).toBe(false)
  })

  it("a parent unrelated to the student cannot see that student's invoices", async () => {
    const other = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'parent', name: 'Other Parent' })
    const login = await request(app).post('/api/auth/login').send({ email: other.body.user.email, password: 'parent123' })
    const res = await request(app).get('/api/fees/invoices').query({ studentId: fx.ids.studentId }).set(authHeader(login.body.token))
    // Not-your-ward: service returns 403 (or an empty list depending on implementation) — either is
    // an acceptable "cannot see" outcome, but leaking the other student's invoice would not be.
    if (res.status === 200) {
      expect(res.body.items).toHaveLength(0)
    } else {
      expect(res.status).toBe(403)
    }
  })
})
