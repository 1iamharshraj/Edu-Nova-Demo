import { test, expect } from '@playwright/test'

// Batch Allocation (the sectioning engine, relabelled for coaching): template list -> run a strategy ->
// draft review -> approve.

test('admin can run a sectioning template and approve the draft', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('admin@edkonic.in')
  await page.locator('input[type="password"]').fill('admin123')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 })

  await page.getByRole('button', { name: 'Batch Allocation' }).click()
  await expect(page.getByRole('heading', { name: 'Batch Allocation' })).toBeVisible()

  // The seeded BALANCED template for Grade X, with an already-APPROVED past run visible on its card.
  await expect(page.getByText('JEE 2027 — Balanced batches')).toBeVisible()
  await expect(page.getByText('Balanced').first()).toBeVisible()
  await expect(page.getByText(/students?$/).first()).toBeVisible()

  // Run it — generates a fresh DRAFT version and navigates to the draft-review screen.
  await page.getByRole('button', { name: /Run — generate draft/ }).first().click()
  await expect(page).toHaveURL(/\/portal\/sectioning\/versions\//, { timeout: 10_000 })

  // Validation + band-mix preview must render without crashing, whichever state they land in.
  await expect(page.getByText(/blocking issue|No validation issues/).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('JEE 2027 · A', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('JEE 2027 · B', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Scored', { exact: true })).toBeVisible()
  await expect(page.getByText('Assigned', { exact: true })).toBeVisible()

  // Approve — if the run tripped a blocking validation issue (likely with only 3 students across 4
  // bands and a 15pp tolerance), the force checkbox must be ticked first; either way this must succeed
  // and flip the version to APPROVED without the page crashing.
  const forceCheckbox = page.getByRole('checkbox')
  if (await forceCheckbox.isVisible().catch(() => false)) await forceCheckbox.check()
  await page.getByRole('button', { name: /^Approve/ }).click()
  await expect(page.getByText('APPROVED', { exact: true })).toBeVisible({ timeout: 10_000 })
})

test('a second, differently-strategized template (SKIM_THEN_BALANCE) also runs cleanly', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('admin@edkonic.in')
  await page.locator('input[type="password"]').fill('admin123')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 })

  await page.getByRole('button', { name: 'Batch Allocation' }).click()
  await expect(page.getByText('Foundation IX — Toppers batch, then balance')).toBeVisible()

  await page.getByRole('button', { name: /Run — generate draft/ }).nth(1).click()
  await expect(page).toHaveURL(/\/portal\/sectioning\/versions\//, { timeout: 10_000 })
  await expect(page.getByText(/blocking issue|No validation issues/).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Foundation IX · A', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Foundation IX · B', { exact: true }).first()).toBeVisible()
})
