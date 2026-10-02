import { test, expect } from '@playwright/test'

// Coaching demo: calendar, test gradebook, syllabus progress, PTMs, and the student's test scores /
// attendance / announcements. Seed data lives in src/lib/mock/seed/examsAcademics.ts.

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

test('director — calendar shows mock tests and breaks', async ({ page }) => {
  await login(page, 'principal@edkonic.in', 'principal123')

  await nav(page, 'Calendar').click()
  await expect(page.getByText('Winter Break Begins').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Mock Test/).first()).toBeVisible()
  await assertNoErrorToast(page)
})

test('faculty — test gradebook, syllabus progress, and parent–teacher meetings', async ({ page }) => {
  await login(page, 'teacher@edkonic.in', 'teacher123')

  await nav(page, 'Test Gradebook').click()
  await expect(page.getByText(/Unit Test 1/).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Syllabus Progress').click()
  await expect(page.getByText('Polynomials').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Parent–Teacher Meetings').click()
  await expect(page.getByText(/Mathematics/i).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('student — test scores, attendance and announcements', async ({ page }) => {
  await login(page, 'ravi.k@edkonic.in', 'student123')

  await nav(page, 'Test Scores').click()
  await expect(page.getByText('Mathematics').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Unit Test 1/).first()).toBeVisible()
  await assertNoErrorToast(page)

  await nav(page, 'Attendance').click()
  await expect(page.getByText(/\d+%/).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Announcements').click()
  await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})
