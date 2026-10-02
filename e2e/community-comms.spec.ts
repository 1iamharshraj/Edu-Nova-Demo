import { test, expect } from '@playwright/test'

// Coaching demo: success stories, faculty reviews, parent↔faculty messaging and the student AI doubt
// solver. Seed data lives in src/lib/mock/seed/community.ts.

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 })
}

function nav(page: import('@playwright/test').Page, label: string) {
  return page.getByRole('button', { name: new RegExp(`^${label}$`) })
}

async function assertNoErrorToast(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
}

test('director — success stories and faculty team reviews', async ({ page }) => {
  await login(page, 'principal@edkonic.in', 'principal123')

  await nav(page, 'Success Stories').click()
  await expect(page.getByText('Rohit Malhotra').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Team Reviews').click()
  await expect(page.getByText('Meera Krishnan').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('parent — messaging faculty', async ({ page }) => {
  await login(page, 'parent@edkonic.in', 'parent123')

  await nav(page, 'Messages').click()
  await expect(page.getByText('Meera Krishnan').first()).toBeVisible({ timeout: 10_000 })
  await page.getByText('Meera Krishnan').first().click()
  await expect(page.getByText(/quadratic equations/i).first()).toBeVisible({ timeout: 10_000 })
  const input = page.locator('input[placeholder="Type a message…"]:visible')
  await input.fill('Thank you for the update, will help him practice at home.')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Thank you for the update, will help him practice at home.').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('student — AI doubt solver history and asking a new question', async ({ page }) => {
  await login(page, 'ravi.k@edkonic.in', 'student123')

  await nav(page, 'AI Doubt Solver').click()
  await expect(page.getByText(/quadratic equations/i).first()).toBeVisible({ timeout: 10_000 })

  const askBox = page.getByPlaceholder('Type your doubt…')
  await askBox.fill('How do I balance a chemical equation?')
  await page.keyboard.press('Enter')
  await expect(page.getByText('How do I balance a chemical equation?').first()).toBeVisible({ timeout: 15_000 })
  await assertNoErrorToast(page)
})
