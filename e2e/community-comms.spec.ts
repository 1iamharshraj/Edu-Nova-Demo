import { test, expect } from '@playwright/test'

// Click-through coverage for this batch's mock endpoints: /alumni, /culture, /canteen, /messages,
// /notifications, /reviews, /ai. See e2e/smoke.spec.ts for the shared login pattern and
// .agents/edunova/static-demo-plan.md for the mock backend's Testing note.

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

test('superadmin — alumni directory, house leaderboard, team reviews, canteen reconciliation', async ({ page }) => {
  await login(page, 'principal@edkonic.in', 'principal123')

  await nav(page, 'Alumni').click()
  await expect(page.getByText('Rohit Malhotra').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'House Leaderboard').click()
  // The page also has an "Award points" house-picker <select> whose hidden <option>s match on text
  // before the visible leaderboard row does — scope to :visible so `.first()` finds the real one.
  await expect(page.locator(':visible:text("Nilgiri House")').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.locator(':visible:text("Shivalik House")').first()).toBeVisible()
  await assertNoErrorToast(page)

  await nav(page, 'Team Reviews').click()
  // pr-1/pr-2 seeded in src/lib/mock/seed/community.ts against Meera Krishnan (u-t) and Arjun Nair (u-t2).
  await expect(page.getByText('Meera Krishnan').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Canteen Reconciliation').click()
  await expect(page.getByText('Reconciled').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Yes', { exact: true }).first()).toBeVisible()
  await assertNoErrorToast(page)
})

test('parent — canteen wallet top-up and messaging a teacher', async ({ page }) => {
  await login(page, 'parent@edkonic.in', 'parent123')

  await nav(page, 'Canteen Wallet').click()
  await expect(page.getByText(/₹495\.00/).first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /top up/i }).click()
  await page.getByRole('button', { name: /add.*to wallet/i }).click()
  await expect(page.getByText(/added to/i).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

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

test('student — AI doubt tutor history and asking a new question', async ({ page }) => {
  await login(page, 'ravi.k@edkonic.in', 'student123')

  await nav(page, 'AI Doubt Clearing').click()
  await expect(page.getByText(/quadratic equations/i).first()).toBeVisible({ timeout: 10_000 })

  const askBox = page.getByPlaceholder('Type your doubt…')
  await askBox.fill('How do I balance a chemical equation?')
  await page.keyboard.press('Enter')
  await expect(page.getByText('How do I balance a chemical equation?').first()).toBeVisible({ timeout: 15_000 })
  await assertNoErrorToast(page)
})
