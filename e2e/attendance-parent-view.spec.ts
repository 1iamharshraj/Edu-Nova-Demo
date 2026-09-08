import { test, expect } from '@playwright/test'
import { apiLogin, buildMinimalFixture, cachedSuperadminToken, resetSchool, resetViaApi, tokenLogin } from './helpers'

// A teacher marks one student Present for today through the real Take Attendance UI; the student's
// parent then sees it reflected on their own Attendance screen.
test.describe('attendance parent view', () => {
  test('teacher marks attendance; the parent sees it', async ({ page, request, browser }) => {
    const saToken = await resetViaApi(request)
    const fixture = await buildMinimalFixture(request, saToken)

    const teacherLogin = await apiLogin(request, fixture.teacher.email, 'teacher123')
    await tokenLogin(page, teacherLogin.token, teacherLogin.refreshToken)
    await expect(page).toHaveURL(/\/portal/)

    await page.getByRole('button', { name: 'Take Attendance' }).click()
    // Only one class is assigned to this teacher, so no class picker is shown — the roster loads directly.
    await expect(page.getByText('Ishaan Student')).toBeVisible()

    const row = page.getByText('Ishaan Student', { exact: true }).locator('..')
    await row.getByRole('button', { name: 'P', exact: true }).click()

    await page.getByRole('button', { name: /Save attendance|Save changes/ }).click()
    await expect(page.getByText(/Attendance saved/)).toBeVisible()

    const parentLogin = await apiLogin(request, fixture.parent.email, 'parent123')
    const parentCtx = await browser.newContext()
    const parentPage = await parentCtx.newPage()
    await tokenLogin(parentPage, parentLogin.token, parentLogin.refreshToken)
    await expect(parentPage).toHaveURL(/\/portal/)
    await parentPage.getByRole('button', { name: 'Attendance' }).click()
    await expect(parentPage.getByText('No attendance recorded for this term yet.')).toHaveCount(0)
    await expect(parentPage.getByText('Overall')).toBeVisible()
    // "100%" also appears in a small summary Pill — the big stat number is the last match.
    await expect(parentPage.getByText('100%').last()).toBeVisible()
    await parentCtx.close()
  })

  test.afterAll(async ({ request }) => {
    const { token } = cachedSuperadminToken()
    await resetSchool(request, token)
  })
})
