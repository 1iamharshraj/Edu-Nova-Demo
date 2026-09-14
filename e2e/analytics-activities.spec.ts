import { test, expect } from '@playwright/test'

// Click-through coverage for this batch's mock endpoints: /analytics, /activities. See e2e/smoke.spec.ts
// for the shared login pattern and .agents/edunova/static-demo-plan.md for the mock backend's Testing note.

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/portal/, { timeout: 10_000 })
}

function nav(page: import('@playwright/test').Page, label: string) {
  return page.getByRole('button', { name: label, exact: true })
}

async function assertNoErrorToast(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
}

test('superadmin — students at risk, lost instructional time, activities admin', async ({ page }) => {
  await login(page, 'principal@edunova.in', 'principal123')

  await nav(page, 'Students at Risk').click()
  // risk-s2-t3 (Ananya Singh, Medium) is seeded against class-10a in src/lib/mock/seed/analytics.ts — the
  // default-picked class is class-9a (sorted first by grade), so pick class-10a explicitly.
  await page.getByLabel('Class').selectOption('class-10a')
  await expect(page.getByText('Ananya Singh').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Medium|High|Low/).first()).toBeVisible()
  await assertNoErrorToast(page)

  await nav(page, 'Lost Instructional Time').click()
  await expect(page.getByText('Scheduled so far').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Activities Admin').click()
  await expect(page.getByText('Robotics Club').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/2\/2 registered/).first()).toBeVisible()
  await assertNoErrorToast(page)
})

test('student — registers for an over-subscribed club and lands on the waitlist', async ({ page }) => {
  // Divya Sharma (u-s4) is not yet registered for Robotics Club, which is seeded at capacity 2 with two
  // Registered students (u-s1, u-s3) and one already Waitlisted (u-s2) — registering should waitlist her too.
  await login(page, 'divya.s@edunova.in', 'student123')

  await nav(page, 'Clubs & Chapters').click()
  await expect(page.getByText('Robotics Club').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Full — waitlist').first()).toBeVisible()

  await page.getByRole('button', { name: 'Register' }).click()
  await expect(page.getByText(/Registered for Robotics Club/i).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /On waitlist/i }).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await nav(page, 'Extra-Curricular (EXC)').click()
  // actreg-6 seeded her already Registered for Weekend Football Coaching.
  await expect(page.getByText('Weekend Football Coaching').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('✓ Registered').first()).toBeVisible()
  await assertNoErrorToast(page)
})
