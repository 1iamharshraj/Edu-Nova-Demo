import fs from 'node:fs'
import path from 'node:path'
import { request as playwrightRequest } from '@playwright/test'
import { API_BASE, AUTH_CACHE_PATH, SUPERADMIN } from './helpers'

// The backend rate-limits POST /auth/login to 10 attempts per 15 minutes per IP (Phase 10 §4 — this is
// deliberate, tested behaviour, see login.spec.ts). A naive suite that logs the superadmin in fresh for
// every reset/test file would blow through that budget on its own. So we log the superadmin in exactly
// ONCE here, cache the token, and every other test/reset reuses it (or injects it via localStorage
// instead of re-submitting the login form) rather than calling /auth/login again.
export default async function globalSetup() {
  const ctx = await playwrightRequest.newContext()
  const res = await ctx.post(`${API_BASE}/auth/login`, { data: SUPERADMIN })
  if (!res.ok()) throw new Error(`global-setup: superadmin login failed: ${res.status()} ${await res.text()}`)
  const json = await res.json()
  fs.mkdirSync(path.dirname(AUTH_CACHE_PATH), { recursive: true })
  fs.writeFileSync(AUTH_CACHE_PATH, JSON.stringify({ token: json.token, refreshToken: json.refreshToken }))
  await ctx.dispose()
}
