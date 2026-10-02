import { test, expect } from '@playwright/test'

// Inventory (study material, stationery, lab stock). Seed data lives in src/lib/mock/seed/inventory.ts.

test('inventory catalog renders seeded items', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('principal@edkonic.in')
  await page.locator('input[type="password"]').fill('principal123')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 })

  await page.getByRole('button', { name: 'Inventory', exact: true }).first().click()
  await expect(page.getByText('Chalk Box (Dustless)')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('First Aid Kit').first()).toBeVisible()
})
