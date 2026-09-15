import { test, expect } from '@playwright/test'

// Click-through spec for the admissions & documents batch (applications, admission-documents,
// board-registrations, certificates, verification) — see .agents/edunova/static-demo-plan.md.
// Reuses smoke.spec.ts's login pattern.

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('admin@edkonic.in')
  await page.locator('input[type="password"]').fill('admin123')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 })
}

test('admin can open an application and see the category-conditional document checklist', async ({ page }) => {
  await loginAsAdmin(page)

  // The seeded app-1 (Ishaan Bhatt) has no documents on file — go straight to it by id.
  await page.goto('/portal/admissions/app-1')
  await expect(page.getByText('Ishaan Bhatt')).toBeVisible({ timeout: 10_000 })

  // Missing-required-documents banner should render (nothing submitted for this application).
  await expect(page.getByText(/required document.*missing/i)).toBeVisible({ timeout: 10_000 })
  // Always-required catalog items must show up in the checklist regardless of category.
  await expect(page.getByText('Birth Certificate')).toBeVisible()
  await expect(page.getByText('Aadhaar Card Copy')).toBeVisible()

  // app-2 (Meher Kaur, SC category, board changed) has every required document on file — including
  // the category-conditional Caste Certificate and the board-change-conditional Migration Certificate
  // — so its checklist should read complete with no missing-documents banner.
  await page.goto('/portal/admissions/app-2')
  await expect(page.getByText('Meher Kaur')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Caste Certificate')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Migration Certificate')).toBeVisible()
  await expect(page.getByText(/required document.*missing/i)).toHaveCount(0)
  // Every required item shows "Collected" once its document is on file — none should read "Missing".
  await expect(page.getByText('Missing — required')).toHaveCount(0)
})

test('TC issuance blocks on held original documents until resolved', async ({ page }) => {
  await loginAsAdmin(page)

  // u-s1 (Ravi Kumar) has two HELD originals seeded (Birth Certificate, Transfer Certificate) —
  // the TC-issuance page must show them and refuse to issue until each is resolved.
  await page.goto('/portal/tc-issuance/u-s1')
  await expect(page.getByText(/Issue TC/i)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Birth Certificate')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Transfer Certificate (previous school)')).toBeVisible()
  await expect(page.getByText(/still need resolving/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /issue transfer certificate/i })).toBeDisabled()

  // Resolve both held originals via "Mark returned".
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Mark returned' }).first().click()
    await page.getByLabel(/returned to/i).fill('Father')
    await page.getByRole('button', { name: /confirm returned/i }).click()
    await expect(page.getByRole('button', { name: /confirm returned/i })).toHaveCount(0, { timeout: 10_000 })
  }

  await expect(page.getByText('No held original documents for this student')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /issue transfer certificate/i })).toBeEnabled()
})
