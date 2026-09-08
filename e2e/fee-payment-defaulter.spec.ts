import { test, expect } from '@playwright/test'
import { apiLogin, authedJson, buildMinimalFixture, cachedSuperadminToken, resetSchool, resetViaApi, tokenLogin } from './helpers'

// Seeds a single overdue invoice via the API (fixture setup, not the flow under test), then exercises
// the real flow through the UI: staff sees the student on the Fee Defaulters list, the parent pays the
// invoice via the sandbox gateway, and the student then drops off the defaulters list.
test.describe('fee payment and defaulter list', () => {
  test('parent pays an overdue invoice; the student drops off the defaulters list', async ({ page, request, browser }) => {
    const saToken = await resetViaApi(request)
    const fixture = await buildMinimalFixture(request, saToken)

    const head = await authedJson(request, saToken, 'POST', '/fees/heads', { name: 'Tuition' })
    const feeHeadId = head.item.id as string
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await authedJson(request, saToken, 'POST', '/fees/invoices', {
      studentId: fixture.student.id,
      termId: fixture.termId,
      dueDate: yesterday,
      lines: [{ feeHeadId, name: 'Tuition', amount: 5000 }],
    })

    // Staff side: the student appears on the defaulters list.
    const staffLogin = await apiLogin(request, fixture.staff.email, 'staff123')
    await tokenLogin(page, staffLogin.token, staffLogin.refreshToken)
    await expect(page).toHaveURL(/\/portal/)
    await page.getByRole('button', { name: 'Fee Defaulters' }).click()
    await expect(page.getByText('Ishaan Student')).toBeVisible()
    await expect(page.getByText(/outstanding/)).toBeVisible()

    // Parent side: pay the invoice in full via the sandbox gateway.
    const parentLogin = await apiLogin(request, fixture.parent.email, 'parent123')
    const parentCtx = await browser.newContext()
    const parentPage = await parentCtx.newPage()
    await tokenLogin(parentPage, parentLogin.token, parentLogin.refreshToken)
    await expect(parentPage).toHaveURL(/\/portal/)
    await parentPage.getByRole('button', { name: 'Payments' }).click()
    await expect(parentPage.getByRole('button', { name: 'Pay', exact: true })).toBeVisible()
    await parentPage.getByRole('button', { name: 'Pay', exact: true }).click()
    await parentPage.getByRole('button', { name: /^Pay ₹/ }).click()
    await expect(parentPage.getByText('Payment received')).toBeVisible()
    await parentCtx.close()

    // Back on the staff side: navigate away and back (fresh mount) — the student should be gone.
    await page.getByRole('button', { name: 'Overview' }).click()
    await page.getByRole('button', { name: 'Fee Defaulters' }).click()
    await expect(page.getByText('Ishaan Student')).toHaveCount(0)
  })

  test.afterAll(async ({ request }) => {
    const { token } = cachedSuperadminToken()
    await resetSchool(request, token)
  })
})
