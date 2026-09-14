// Mirrors server/src/routes/auth.ts's contract exactly (see that file for the real behavior this
// stands in for) but against the in-memory store instead of Postgres, and with no real password
// hashing/JWT signing — this is a client-only demo, not a security boundary.

import { route, requireAuth } from '../router'
import { MockHttpError, notFound } from '../http'
import { table, saveTable, issueSession, rotateRefreshToken, revokeToken, nowIso } from '../store'
import { serializeUser as toClientUser } from '../serialize'

route('POST', '/auth/login', (ctx) => {
  const { email, password } = ctx.body as { email?: string; password?: string }
  if (!email || !password) throw new MockHttpError(400, 'email and password are required')
  const user = table('User').find(u => String(u.email).toLowerCase() === String(email).trim().toLowerCase())
  if (!user || user.password !== password) throw new MockHttpError(401, 'Invalid credentials')
  if (user.active === false) throw new MockHttpError(403, 'Account inactive')
  const users = table('User')
  const idx = users.findIndex(u => u.id === user.id)
  users[idx] = { ...user, lastLoginAt: nowIso() }
  saveTable('User', users)
  const { token, refreshToken } = issueSession(user.id)
  return { token, refreshToken, user: toClientUser(users[idx]), mustChangePassword: user.mustChangePassword ?? false }
})

route('POST', '/auth/refresh', (ctx) => {
  const { refreshToken } = ctx.body as { refreshToken?: string }
  if (!refreshToken) throw new MockHttpError(401, 'Invalid or expired refresh token')
  // We don't track which user a refresh token belongs to beyond the session map itself, so pull it
  // from there directly (rotateRefreshToken looks the old token up and mints a fresh pair for the
  // same user) — if it's not found the token is stale/unknown.
  const fresh = rotateRefreshToken(refreshToken)
  if (!fresh) throw new MockHttpError(401, 'Invalid or expired refresh token')
  return fresh
})

route('POST', '/auth/logout', (ctx) => {
  const { refreshToken } = ctx.body as { refreshToken?: string }
  if (refreshToken) revokeToken(refreshToken)
  return { ok: true }
})

route('GET', '/auth/me', (ctx) => {
  const actor = requireAuth(ctx)
  const user = table('User').find(u => u.id === actor.userId)
  if (!user) throw notFound('User')
  return { user: toClientUser(user), mustChangePassword: user.mustChangePassword ?? false }
})

route('POST', '/auth/change-password', (ctx) => {
  const actor = requireAuth(ctx)
  const { currentPassword, newPassword } = ctx.body as { currentPassword?: string; newPassword?: string }
  const users = table('User')
  const idx = users.findIndex(u => u.id === actor.userId)
  if (idx === -1) throw notFound('User')
  if (users[idx].password !== currentPassword) throw new MockHttpError(401, 'Current password is incorrect')
  if (currentPassword === newPassword) throw new MockHttpError(400, 'New password must differ from the current one')
  users[idx] = { ...users[idx], password: newPassword, mustChangePassword: false }
  saveTable('User', users)
  return { ok: true }
})

route('POST', '/auth/forgot', () => {
  // Static demo — there's no email to send. Always 200, same as the real endpoint's anti-enumeration shape.
  return { ok: true }
})

route('POST', '/auth/reset', () => {
  throw new MockHttpError(400, 'Reset link is invalid or has expired')
})

route('POST', '/auth/admin/set-password', (ctx) => {
  const actor = requireAuth(ctx)
  if (actor.role !== 'admin' && actor.role !== 'superadmin') throw new MockHttpError(403, 'Not permitted')
  const { userId, newPassword } = ctx.body as { userId?: string; newPassword?: string }
  const users = table('User')
  const idx = users.findIndex(u => u.id === userId)
  if (idx === -1) throw notFound('User')
  const plain = newPassword ?? Math.random().toString(36).slice(2, 10)
  users[idx] = { ...users[idx], password: plain, mustChangePassword: true }
  saveTable('User', users)
  return { ok: true, userId, email: users[idx].email, password: plain, mustChangePassword: true }
})
