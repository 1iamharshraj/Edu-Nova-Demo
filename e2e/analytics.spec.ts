import { test, expect } from '@playwright/test'

// Students-at-risk early warning. Seed data lives in src/lib/mock/seed/analytics.ts — risk-s2-t3 (Ananya
// Singh, Medium) is seeded against class-10a (JEE 2027 · A); the default-picked batch is Foundation IX · A.

test('director — students at risk for a batch', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('principal@edkonic.in')
  await page.locator('input[type="password"]').fill('principal123')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 })

  await page.getByRole('button', { name: 'Students at Risk', exact: true }).click()
  await page.getByLabel('Batch').selectOption('class-10a')
  await expect(page.getByText('Ananya Singh').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/^(Medium|High|Low) · \d+$/).first()).toBeVisible()
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
})
