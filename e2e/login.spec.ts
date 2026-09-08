import { test, expect } from '@playwright/test'
import { resetViaApi, SUPERADMIN, uiLogin } from './helpers'

test.describe('login', () => {
  test.beforeEach(async ({ request }) => {
    await resetViaApi(request)
  })

  test('superadmin logs in with valid credentials and lands on the portal', async ({ page }) => {
    await uiLogin(page, SUPERADMIN.email, SUPERADMIN.password)
    await expect(page).toHaveURL(/\/portal/)
    await expect(page.getByText('superadmin portal')).toBeVisible()
  })

  test('invalid credentials show an error and keep the user on the login page', async ({ page }) => {
    await uiLogin(page, SUPERADMIN.email, 'wrong-password')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText(/credentials don.t match any EduNova account/i)).toBeVisible()
  })
})
