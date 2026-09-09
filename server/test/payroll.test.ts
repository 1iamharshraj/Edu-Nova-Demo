import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader } from './helpers/auth'

// Money-integrity regression: mark-paid must be idempotent — calling it twice on the same payslip must
// never post a second GL entry for the same salary (see phase-17-accounting.md's auto-post funnel).

const app = createApp()
let fx: Fixture
let payslipId: string

beforeAll(async () => {
  fx = await buildFixture(app)
})

describe('payroll: run -> mark-paid idempotency', () => {
  it('admin sets a salary structure for the teacher', async () => {
    const res = await request(app).put(`/api/payroll/structures/${fx.ids.teacherId}`).set(authHeader(fx.tokens.admin))
      .send({ basic: 40000, allowances: [{ name: 'HRA', amount: 5000 }], deductions: [{ name: 'PF', amount: 2000 }], effectiveFrom: '2026-06-01' })
    expect(res.status).toBe(200)
  })

  it('running payroll for the month generates one payslip', async () => {
    const res = await request(app).post('/api/payroll/run').set(authHeader(fx.tokens.admin)).send({ month: '2026-09' })
    expect(res.status).toBe(201)
    expect(res.body.created).toBeGreaterThanOrEqual(1)
    const list = await request(app).get('/api/payroll/payslips').query({ userId: fx.ids.teacherId, month: '2026-09' }).set(authHeader(fx.tokens.admin))
    expect(list.body.items).toHaveLength(1)
    payslipId = list.body.items[0].id
    expect(list.body.items[0].status).toBe('Generated')
  })

  it('mark-paid succeeds the first time', async () => {
    const res = await request(app).patch(`/api/payroll/payslips/${payslipId}/mark-paid`).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('Paid')
  })

  it('mark-paid called again is a safe idempotent no-op, still 200 Paid', async () => {
    const res = await request(app).patch(`/api/payroll/payslips/${payslipId}/mark-paid`).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('Paid')
  })

  it('only one GL entry was posted for this payslip despite two mark-paid calls', async () => {
    const res = await request(app).get('/api/accounting/journal-entries').query({ sourceType: 'Payroll' }).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    const forThisPayslip = res.body.items.filter((e: { sourceId?: string }) => e.sourceId === payslipId)
    expect(forThisPayslip).toHaveLength(1)
  })
})
