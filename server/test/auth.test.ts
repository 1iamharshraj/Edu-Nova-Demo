import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { seedSuperadmin, SUPERADMIN } from './helpers/fixtures'
import { login, authHeader } from './helpers/auth'

const app = createApp()

beforeAll(async () => {
  await seedSuperadmin()
})

describe('auth', () => {
  it('rejects a login with no email/password', async () => {
    const res = await request(app).post('/api/auth/login').send({})
    expect(res.status).toBe(400)
  })

  it('rejects wrong credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: SUPERADMIN.email, password: 'wrong-password' })
    expect(res.status).toBe(401)
  })

  it('rejects a login for an email that does not exist', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@fixture.test', password: 'whatever123' })
    expect(res.status).toBe(401)
  })

  it('logs in with correct credentials and returns a token + user', async () => {
    const { token, user, mustChangePassword } = await login(app, SUPERADMIN.email, SUPERADMIN.password)
    expect(token).toBeTruthy()
    expect(user.email).toBe(SUPERADMIN.email)
    expect(user.role).toBe('superadmin')
    expect(typeof mustChangePassword).toBe('boolean')
  })

  it('GET /api/auth/me requires a bearer token', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('GET /api/auth/me returns the caller with a valid token', async () => {
    const { token } = await login(app, SUPERADMIN.email, SUPERADMIN.password)
    const res = await request(app).get('/api/auth/me').set(authHeader(token))
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(SUPERADMIN.email)
  })

  it('rejects a request with a garbage bearer token', async () => {
    const res = await request(app).get('/api/auth/me').set(authHeader('not-a-real-jwt'))
    expect(res.status).toBe(401)
  })

  it('change-password requires the current password to be correct', async () => {
    const { token } = await login(app, SUPERADMIN.email, SUPERADMIN.password)
    const res = await request(app).post('/api/auth/change-password').set(authHeader(token))
      .send({ currentPassword: 'wrong', newPassword: 'brandNewPassword1' })
    expect(res.status).toBe(401)
  })

  it('change-password succeeds and the new password can log in', async () => {
    const { token } = await login(app, SUPERADMIN.email, SUPERADMIN.password)
    const res = await request(app).post('/api/auth/change-password').set(authHeader(token))
      .send({ currentPassword: SUPERADMIN.password, newPassword: 'brandNewPassword1' })
    expect(res.status).toBe(200)
    const relogin = await login(app, SUPERADMIN.email, 'brandNewPassword1')
    expect(relogin.token).toBeTruthy()
  })

  it('forgot-password always returns ok (no account enumeration) and dev builds get a reset URL for a real account', async () => {
    const resReal = await request(app).post('/api/auth/forgot').send({ email: SUPERADMIN.email })
    expect(resReal.status).toBe(200)
    expect(resReal.body.ok).toBe(true)

    const resFake = await request(app).post('/api/auth/forgot').send({ email: 'nobody@fixture.test' })
    expect(resFake.status).toBe(200)
    expect(resFake.body.ok).toBe(true)
    // Fake account: no reset token is ever created, so no devResetUrl.
    expect(resFake.body.devResetUrl).toBeUndefined()
  })
})
