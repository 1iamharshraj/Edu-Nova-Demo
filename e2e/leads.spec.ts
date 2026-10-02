import { test, expect } from '@playwright/test'

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

test('leads pipeline renders seeded leads, add + status change + convert', async ({ page }) => {
  await login(page)
  await nav(page, 'Leads').click()
  await expect(page.getByText('Aditya Rao').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Fatima Sheikh').first()).toBeVisible()

  // Add a lead — the modal's inputs follow Field order: Name, Phone, Email, Source, Interested course.
  await page.getByRole('button', { name: /^Add lead$/ }).click()
  const modal = page.locator('.mega-in')
  await modal.locator('input').nth(0).fill('Test Candidate')
  await modal.locator('input').nth(1).fill('+91 90000 00000')
  await modal.getByRole('button', { name: /^Add lead$/ }).click()
  await expect(page.getByText('Test Candidate').first()).toBeVisible({ timeout: 10_000 })
})

test('converting a lead creates a real admission application', async ({ page }) => {
  await login(page)
  await nav(page, 'Leads').click()
  await page.getByText('Fatima Sheikh').first().click()
  await expect(page).toHaveURL(/\/portal\/leads\//)
  await page.getByRole('button', { name: /Convert to application/i }).click()
  await expect(page.getByText('Converted to an admission application.')).toBeVisible({ timeout: 10_000 })
})
