import { test, expect } from '@playwright/test'
import { cachedSuperadminToken, resetViaApi, tokenLogin } from './helpers'

// Walks the real UI (not API calls) through the first few academic-setup steps and confirms the
// Overview "Set up your school" checklist ticks off matching steps as we go. Logs the superadmin in by
// injecting the cached token (see helpers.ts) rather than the login form — login.spec.ts already covers
// the login journey itself, and the shared /auth/login rate limit is a scarce resource across the suite.
test.describe('setup checklist', () => {
  test.beforeEach(async ({ request }) => {
    await resetViaApi(request)
  })

  test('creating a year+term, a board+grade, and a class ticks matching checklist steps', async ({ page }) => {
    const { token, refreshToken } = cachedSuperadminToken()
    await tokenLogin(page, token, refreshToken)
    await expect(page).toHaveURL(/\/portal/)

    // Overview: all steps unticked on a fresh school.
    await expect(page.getByText('Set up your school')).toBeVisible()
    // The `line-through` class lives on the second inner <span> (the label), not the <li> itself —
    // the first <span> in each <li> is the numbered/checkmark circle.
    const yearStep = page.locator('li', { hasText: 'Create the academic year and its terms' }).locator('span').nth(1)
    const boardStep = page.locator('li', { hasText: 'Add the boards you run and the grade ladder' }).locator('span').nth(1)
    const classStep = page.locator('li', { hasText: 'Create sections and assign teachers' }).locator('span').nth(1)
    await expect(yearStep).not.toHaveClass(/line-through/)

    // 1. Years & Terms — create a year and a term.
    await page.getByRole('button', { name: 'Years & Terms' }).click()
    await page.getByRole('button', { name: /Create academic year|Add year/ }).click()
    await page.getByLabel('Label').fill('2026-27')
    await page.getByLabel('Start date').fill('2026-06-01')
    await page.getByLabel('End date').fill('2027-05-31')
    await page.getByRole('button', { name: 'Create year' }).click()
    await expect(page.getByText('2026-27', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /Add first term|Add term/ }).first().click()
    await page.getByLabel('Term name').fill('Term 1')
    await page.getByLabel('Start date').fill('2026-06-01')
    await page.getByLabel('End date').fill('2026-09-30')
    await page.getByRole('button', { name: 'Create term' }).click()
    await expect(page.getByText('Term 1')).toBeVisible()

    // Overview: step 1 now ticked.
    await page.getByRole('button', { name: 'Overview' }).click()
    await expect(yearStep).toHaveClass(/line-through/)
    await expect(boardStep).not.toHaveClass(/line-through/)

    // 2. Boards & Grades — create a board and a grade.
    await page.getByRole('button', { name: 'Boards & Grades' }).click()
    await page.getByRole('button', { name: /Add first board|Add board/ }).first().click()
    await page.getByLabel('Name').fill('Central Board of Secondary Education')
    await page.getByLabel('Code').fill('CBSE')
    await page.getByRole('button', { name: 'Add board' }).last().click()
    await expect(page.getByText('CBSE')).toBeVisible()

    await page.getByRole('button', { name: /Add first grade|Add grade/ }).first().click()
    await page.getByLabel('Label').fill('VIII')
    await page.getByRole('button', { name: 'Add grade' }).last().click()
    await expect(page.getByText('VIII')).toBeVisible()

    // Overview: step 2 now ticked.
    await page.getByRole('button', { name: 'Overview' }).click()
    await expect(boardStep).toHaveClass(/line-through/)
    await expect(classStep).not.toHaveClass(/line-through/)

    // 3. Classes & Sections — create a class (board + grade + section is enough; curriculum optional).
    await page.getByRole('button', { name: 'Classes & Sections' }).click()
    await page.getByRole('button', { name: /Add first class|Add class/ }).first().click()
    await page.getByLabel('Board').selectOption({ label: 'CBSE · Central Board of Secondary Education' })
    await page.getByLabel('Grade').selectOption({ label: 'VIII' })
    await page.getByLabel('Section').fill('A')
    await page.getByRole('button', { name: 'Create class' }).click()
    await expect(page.getByText('VIII-A')).toBeVisible()

    // Overview: step 4 now ticked.
    await page.getByRole('button', { name: 'Overview' }).click()
    await expect(classStep).toHaveClass(/line-through/)
  })
})
