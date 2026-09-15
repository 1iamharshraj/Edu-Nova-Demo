import { test, expect } from '@playwright/test'

// Core boot smoke test for the static demo's mock backend (see .agents/edunova/static-demo-plan.md).
// Every module batch should add its own click-through spec next to this one rather than growing this
// file — this one stays a fast "did the foundation break" check.

test('superadmin can log in and reach the portal', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('principal@edkonic.in')
  await page.locator('input[type="password"]').fill('principal123')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 })
})

test('wrong password is rejected', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('principal@edkonic.in')
  await page.locator('input[type="password"]').fill('wrong-password')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText(/credentials|invalid|password/i).first()).toBeVisible({ timeout: 10_000 })
})
