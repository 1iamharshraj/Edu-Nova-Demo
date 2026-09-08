// Central place for anything that depends on the shape of the login response. A parallel effort is
// adding refresh tokens / a Session table to /api/auth/login — if that response gains a field (or the
// token needs to be paired with a refresh call), this is the one file to change; every test imports
// `login`/`authHeader` from here rather than hitting /api/auth/login directly.
import type { Express } from 'express'
import request from 'supertest'

export interface LoginResult {
  token: string
  user: { id: string; role: string; schoolId?: string; email: string; name: string }
  mustChangePassword: boolean
}

export async function login(app: Express, email: string, password: string): Promise<LoginResult> {
  const res = await request(app).post('/api/auth/login').send({ email, password })
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body as LoginResult
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` }
}
