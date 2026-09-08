import { test, expect } from '@playwright/test'
import { apiLogin, buildMinimalFixture, cachedSuperadminToken, resetSchool, resetViaApi, tokenLogin } from './helpers'

// Builds one timetable entry through the real Timetable Builder UI, publishes it, then confirms the
// student in that class sees it on their own Timetable screen.
test.describe('timetable publish', () => {
  test('admin builds and publishes a timetable entry; the student sees it', async ({ page, request, browser }) => {
    const saToken = await resetViaApi(request)
    const fixture = await buildMinimalFixture(request, saToken)

    const { token, refreshToken } = cachedSuperadminToken()
    await tokenLogin(page, token, refreshToken)
    await expect(page).toHaveURL(/\/portal/)

    await page.getByRole('button', { name: 'Timetable Builder' }).click()
    await page.getByLabel('Class').selectOption({ label: 'VIII-A · CBSE' })
    await page.getByLabel('Term').selectOption({ label: 'Term 1' })

    await page.getByRole('button', { name: 'Add period Monday P1' }).click()
    // getByLabel('Subject') is ambiguous: the "Teacher override" select's default option text starts
    // with "Subject teacher (...)", so its accessible name also contains "Subject". Scope to the field
    // whose own label span text is exactly "Subject".
    const subjectField = page.locator('.mega-in label').filter({ has: page.locator('span', { hasText: /^Subject$/ }) })
    await subjectField.locator('select').selectOption({ label: 'Mathematics — Kavya Rao' })
    await page.getByRole('button', { name: 'Apply' }).click()

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Unsaved changes')).toHaveCount(0)

    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.getByText('Published', { exact: true })).toBeVisible()

    // Second, independent browser context for the student — a fresh /auth/login (one call) since this
    // is a distinct account created by this test's fixture.
    const studentLogin = await apiLogin(request, fixture.student.email, 'student123')
    const studentCtx = await browser.newContext()
    const studentPage = await studentCtx.newPage()
    await tokenLogin(studentPage, studentLogin.token, studentLogin.refreshToken)
    await expect(studentPage).toHaveURL(/\/portal/)
    await studentPage.getByRole('button', { name: 'Timetable' }).click()
    await expect(studentPage.getByText('Timetable not published yet.')).toHaveCount(0)
    await expect(studentPage.getByText('Mathematics').first()).toBeVisible()
    await studentCtx.close()
  })

  test.afterAll(async ({ request }) => {
    const { token } = cachedSuperadminToken()
    await resetSchool(request, token)
  })
})
