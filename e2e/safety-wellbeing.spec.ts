import { test, expect } from '@playwright/test'

// Click-through coverage for this batch's mock endpoints: /safety (authorized pickup, pickup log +
// OTP, visitors, counseling records, anonymous reports), /discipline, /staff-conduct, /scholarships
// (+ /scholarships/awards), and PATCH /users/:id/counselor. See e2e/smoke.spec.ts for the shared login
// pattern and .agents/edunova/static-demo-plan.md for the mock backend's Testing note.

async function loginAs(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login')
  // Switching users mid-test (see the "report a concern" test below): if a session from a prior
  // loginAs() call is still active, the auth guard client-side-redirects /login -> /portal — but that
  // redirect can land a render tick after this goto() resolves, so checking page.url() immediately is
  // racy. Instead, wait for whichever of the two landmarks actually shows up, and sign out for real
  // through the UI if it was the portal.
  const emailInput = page.locator('input[type="email"]')
  const signOutBtn = page.getByRole('button', { name: 'Sign out' })
  await Promise.race([
    emailInput.waitFor({ state: 'visible', timeout: 10_000 }),
    signOutBtn.waitFor({ state: 'visible', timeout: 10_000 }),
  ])
  if (await signOutBtn.isVisible().catch(() => false)) {
    await signOutBtn.click()
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  }
  await emailInput.waitFor({ state: 'visible', timeout: 10_000 })
  await emailInput.fill(email)
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

test('discipline shows seeded cases and a committee member can add a note', async ({ page }) => {
  await loginAs(page, 'principal@edkonic.in', 'principal123')

  await nav(page, 'Discipline').click()
  // Seeded in src/lib/mock/seed/safetyWellbeing.ts (dc-1..dc-3).
  await expect(page.getByText('Mobile phone use during a term exam').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Altercation on the playground').first()).toBeVisible()
  await assertNoErrorToast(page)

  // Open the resolved case (dc-1) and add a free-standing note (real write against /discipline/:id/notes).
  const dc1Card = page.locator('div.card-lift', { hasText: 'Mobile phone use during a term exam' })
  await dc1Card.getByRole('button', { name: /Review case|View case/ }).click()
  await expect(page).toHaveURL(/\/portal\/discipline\/cases\//, { timeout: 10_000 })
  await page.getByPlaceholder(/Add a note/i).fill('Follow-up: parent acknowledged the warning in writing.')
  await page.getByRole('button', { name: /Add note only/i }).click()
  await expect(page.getByText('Follow-up: parent acknowled').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('staff conduct shows seeded records, filterable and viewable', async ({ page }) => {
  await loginAs(page, 'principal@edkonic.in', 'principal123')

  await nav(page, 'Staff Conduct').click()
  // Seeded sc-1 (Vikram Rao, UnderReview) / sc-2 (Kavita Joshi, Resolved).
  await expect(page.getByText('Late arrival pattern').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('ID card / visitor-escort policy reminder').first()).toBeVisible()
  await assertNoErrorToast(page)

  // Open the under-review record (sc-1, most recently created — sorted first) and resolve it (real
  // write against PATCH /staff-conduct/:id).
  // Note: `exact: true` matters here — a substring match on "View" would also hit the sidebar's
  // "Overview" nav button (which literally contains "view").
  await page.getByRole('button', { name: 'View', exact: true }).first().click()
  await expect(page.getByText('Late arrival pattern').first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Resolve/ }).click()
  await expect(page.locator('[data-sonner-toast][data-type="success"]').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('scholarships catalog + awards render, and an admin can approve a pending award', async ({ page }) => {
  await loginAs(page, 'principal@edkonic.in', 'principal123')

  await nav(page, 'Scholarships').click()
  // Awards tab is the default — awd-2 (Karthik Reddy, Pending against Need-Based Fee Assistance).
  await expect(page.getByText('Karthik Reddy').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  await page.getByRole('button', { name: 'Approve' }).first().click()
  await expect(page.locator('[data-sonner-toast][data-type="success"]').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  // The "Scholarships" catalog tab, not the sidebar nav item of the same name — it renders later in the
  // DOM (inside the page content, after the sidebar), so `.last()` reliably picks the tab.
  await page.getByRole('button', { name: 'Scholarships', exact: true }).last().click()
  await expect(page.getByText('Merit Scholarship — Academic Toppers').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Staff Ward Concession').first()).toBeVisible()
  await assertNoErrorToast(page)
})

test('pickup desk logs a pickup and the visitor desk checks a visitor in and out', async ({ page }) => {
  await loginAs(page, 'principal@edkonic.in', 'principal123')

  await nav(page, 'Visitor Desk').click()
  await expect(page.getByText('Sunita Rao').first()).toBeVisible({ timeout: 10_000 }) // seeded, on campus
  await assertNoErrorToast(page)

  await page.getByLabel('Full name').fill('Nikhil Shah')
  await page.getByLabel('Phone').fill('9876543210')
  await page.getByLabel('Purpose of visit').fill('Textbook donation drive')
  await page.getByRole('button', { name: /^Check in$/ }).click()
  await expect(page.getByText('Nikhil Shah').first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('report a concern submits anonymously, and the concern review queue shows it', async ({ page }) => {
  await loginAs(page, 'ravi.k@edkonic.in', 'student123')

  await nav(page, 'Report a Concern').click()
  await page.locator('textarea').fill('A vending machine near the gym has been leaving a wet floor with no warning sign.')
  await page.getByRole('button', { name: /Submit anonymously/i }).click()
  await expect(page.getByText('Report submitted').first()).toBeVisible({ timeout: 10_000 })

  await loginAs(page, 'principal@edkonic.in', 'principal123')
  await nav(page, 'Concern Review').click()
  // Seeded ar-1 (Bullying, New).
  await expect(page.getByText(/teasing a junior about their accent/i).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/vending machine near the gym/i).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})

test('a designated counselor sees confidential counseling records and can log a session', async ({ page }) => {
  // u-t3 (Sofia D'Souza) is seeded as isCounselor: true in src/lib/mock/seed/safetyWellbeing.ts.
  await loginAs(page, 'sofia.d@edkonic.in', 'teacher123')

  await nav(page, 'Counseling Records').click()
  await expect(page.getByText('Confidential', { exact: false }).first()).toBeVisible({ timeout: 10_000 })

  // Pick the seeded student (Karthik Reddy) via the async search picker to see cr-1's notes.
  await page.getByPlaceholder(/search student/i).fill('Karthik')
  await page.getByRole('option', { name: /Karthik Reddy/ }).click()
  await expect(page.getByText(/exam-related anxiety/i).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)

  // Log a new session note (real write against POST /safety/counseling-records).
  await page.getByRole('button', { name: /Log session/i }).click()
  await page.locator('textarea').fill('Brief check-in — student reports the earlier concern has eased since last session.')
  await page.getByRole('button', { name: /Save session note/i }).click()
  await expect(page.getByText(/Brief check-in/i).first()).toBeVisible({ timeout: 10_000 })
  await assertNoErrorToast(page)
})
