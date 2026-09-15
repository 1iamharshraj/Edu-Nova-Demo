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

test('hostel module renders seeded hostels and occupancy', async ({ page }) => {
  await page.getByRole('button', { name: 'Hostel', exact: true }).first().click()
  await expect(page.getByText('Vivekananda Bhavan (Boys)')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Sarojini Bhavan (Girls)')).toBeVisible()
})

test('transport module renders seeded routes and vehicles', async ({ page }) => {
  await page.getByRole('button', { name: 'Transport', exact: true }).first().click()
  await expect(page.getByText('Route 1 — MG Road')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Vehicles', exact: true }).click()
  await expect(page.getByText('TN-07-AB-1234')).toBeVisible()
})

test('inventory catalog renders seeded items and low-stock flag', async ({ page }) => {
  await page.getByRole('button', { name: 'Inventory', exact: true }).first().click()
  await expect(page.getByText('Chalk Box (Dustless)')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('First Aid Kit').first()).toBeVisible()
})
