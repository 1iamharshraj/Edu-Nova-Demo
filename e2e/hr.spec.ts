import { test, expect } from '@playwright/test'

// Click-through coverage for this batch's mock endpoints: /hr, /payroll, /leave, /accounting.
// Logs in as the superadmin (who can see every Finance/Manage screen this batch touches) and visits
// Leave Types, Leave Approvals, Contracts & Exit, Payroll, Chart of Accounts, Journal and Accounting
// Reports — asserting each renders real seeded data and no error toast appears. See e2e/smoke.spec.ts
// for the shared login pattern and .agents/edunova/static-demo-plan.md for the mock backend's Testing note.

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('principal@edkonic.in')
  await page.locator('input[type="password"]').fill('principal123')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 })
}

function nav(page: import('@playwright/test').Page, label: string) {
  return page.getByRole('button', { name: new RegExp(`^${label}$`) })
}

async function assertNoErrorToast(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
}

test('leave types + leave approvals render seeded data', async ({ page }) => {
  await login(page)

  await nav(page, 'Leave Types').click()
  await expect(page.getByText('Leave Types', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Casual Leave').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Earned Leave').first()).toBeVisible()
  await assertNoErrorToast(page)

  await nav(page, 'Leave Approvals').click()
  // Term 3 pending staff leave request seeded in src/lib/mock/seed/hr.ts (leave-req-1, Sofia D'Souza / fever).
  await expect(page.getByText(/fever/i).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('contracts & exit shows signed contracts and a pending resignation', async ({ page }) => {
  await login(page)

  await nav(page, 'Contracts & Exit').click()
  await expect(page.getByText('Meera Krishnan').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('payroll shows salary structures and payslips', async ({ page }) => {
  await login(page)

  await nav(page, 'Payroll').click()
  // Structures tab (default): every seeded employee has a structure, so "No structure" must never appear.
  await expect(page.getByText('Meera Krishnan').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('No structure')).toHaveCount(0)
  await assertNoErrorToast(page)

  await page.getByRole('button', { name: /payslips/i }).click()
  // The month picker defaults to the real wall-clock month, which won't match the seeded payslip
  // months (2026-06/07/08) — pick one explicitly rather than relying on the default.
  await page.locator('input[type="month"]').fill('2026-08')
  await expect(page.getByText(/PAY\/2026\//).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('accounting — chart of accounts, journal and reports render', async ({ page }) => {
  await login(page)

  await nav(page, 'Chart of Accounts').click()
  await expect(page.getByText('Bank').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Salary Expense').first()).toBeVisible()
  await assertNoErrorToast(page)

  await nav(page, 'Journal').click()
  await expect(page.getByText('Payroll paid').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Accounting Reports').click()
  await expect(page.getByText(/trial balance|profit|balance sheet/i).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})
