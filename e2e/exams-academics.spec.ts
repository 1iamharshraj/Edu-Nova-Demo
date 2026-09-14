import { test, expect } from '@playwright/test'

// Click-through coverage for this batch's mock endpoints: /exams, /assessments, /syllabus, /homework,
// /attendance, /feed, /calendar, /meetings, /slips, /achievements, /health, /highlights. See
// e2e/smoke.spec.ts for the shared login pattern and .agents/edunova/static-demo-plan.md for the mock
// backend's Testing note. Seed data lives in src/lib/mock/seed/examsAcademics.ts.

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

test('superadmin — calendar, achievements list, and verifying an achievement (write)', async ({ page }) => {
  await login(page, 'principal@edunova.in', 'principal123')

  await nav(page, 'Calendar').click()
  await expect(page.getByText('Winter Break Begins').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Achievements').click()
  await expect(page.getByText('Won District-Level Chess Championship').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Published article in school magazine').first()).toBeVisible({ timeout: 10_000 })
  const verifyButtons = page.getByRole('button', { name: /verify/i })
  const verifyCountBefore = await verifyButtons.count()
  expect(verifyCountBefore).toBeGreaterThan(0)
  await verifyButtons.first().click()
  await expect(page.getByText('Achievement verified').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /verify/i })).toHaveCount(verifyCountBefore - 1, { timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('teacher — gradebook, teaching progress, and meetings', async ({ page }) => {
  await login(page, 'teacher@edunova.in', 'teacher123')

  await nav(page, 'Gradebook').click()
  await expect(page.getByText(/Unit Test 1/).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Teaching Progress').click()
  // "Polynomials" is chapter 2 of both cur-g9-math and cur-g10-math, so it renders regardless of which of
  // u-t's teachable class-subjects (all Mathematics) the page defaults to.
  await expect(page.getByText('Polynomials').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Meetings').click()
  await expect(page.getByText(/Mathematics/i).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('student — marks, school feed, health records and achievements', async ({ page }) => {
  await login(page, 'ravi.k@edunova.in', 'student123')

  await nav(page, 'Marks & Grades').click()
  await expect(page.getByText('Mathematics').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Unit Test 1/).first()).toBeVisible()
  await assertNoErrorToast(page)

  await nav(page, 'Attendance').click()
  await expect(page.getByText(/\d+%/).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'School Feed').click()
  await expect(page.getByText('Welcome back for Term 3!').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Health Records').click()
  await expect(page.getByText('Peanut allergy').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Achievements').click()
  await expect(page.getByText('Won District-Level Chess Championship').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('parent — permission slips, and approving one on behalf of a ward (write)', async ({ page }) => {
  await login(page, 'parent@edunova.in', 'parent123')

  await nav(page, 'Permission Slips').click()
  await expect(page.getByText('Annual Sports Day Participation').first()).toBeVisible({ timeout: 10_000 })
  const approveButton = page.getByRole('button', { name: 'Approve' })
  await expect(approveButton).toHaveCount(1, { timeout: 10_000 })
  await approveButton.click()
  await expect(page.getByText('Slip approved').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0, { timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Health Records').click()
  await expect(page.getByText('Peanut allergy').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})
