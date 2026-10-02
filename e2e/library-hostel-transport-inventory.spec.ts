import { test, expect } from '@playwright/test'

// Click-through smoke coverage for the library/hostel/transport/inventory mock-backend batch (see
// .agents/edunova/static-demo-plan.md). Logs in as the superadmin (same pattern as e2e/smoke.spec.ts),
// then visits each module's sidebar entry and asserts real seed data renders — proving the mock
// dispatch()/seed wiring for these four modules works end to end in a real browser, not just that
// tsc/eslint are happy.

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('principal@edkonic.in')
  await page.locator('input[type="password"]').fill('principal123')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 })
})

test('library catalog renders seeded books', async ({ page }) => {
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await expect(page.getByText('Malgudi Days')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Mathematics — NCERT Class X')).toBeVisible()
})

// Hostel and Transport are intentionally not part of this coaching-institute demo (day-only institutes
// per the branch's scope) — their nav entries are removed, so those two specs from the school demo are
// dropped here rather than left to fail. The mock backend modules themselves are untouched/dormant.

test('inventory catalog renders seeded items and low-stock flag', async ({ page }) => {
  await page.getByRole('button', { name: 'Inventory', exact: true }).first().click()
  await expect(page.getByText('Chalk Box (Dustless)')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('First Aid Kit').first()).toBeVisible()
})
