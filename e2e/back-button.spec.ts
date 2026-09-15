import { test, expect } from '@playwright/test'

// Regression test for the browser Back button always landing on Overview instead of whichever
// module the user was actually on (see Portal.tsx: `active` now lives in the URL's `?m=` param so
// navigating to a real route like an employee detail page and back restores it correctly).

test('back button restores the module you were on, not Overview', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('principal@edkonic.in')
  await page.locator('input[type="password"]').fill('principal123')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 })

  // Switch to a non-default module — this must be a real URL change (?m=...), not just React state.
  await page.getByRole('button', { name: 'Contracts & Exit', exact: true }).click()
  await expect(page).toHaveURL(/\/portal\?m=/)
  const moduleUrl = page.url()
  expect(moduleUrl).not.toMatch(/m=home/)

  // Simulate navigating to a real sub-route (as clicking into any detail page would).
  await page.goto('/portal/employees/u-t')
  await expect(page.getByText('Meera Krishnan').first()).toBeVisible({ timeout: 10_000 })

  // Pressing Back should return to the exact module URL, not the bare /portal default (Overview).
  await page.goBack()
  await expect(page).toHaveURL(moduleUrl)
})
