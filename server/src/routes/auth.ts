import crypto from 'node:crypto'
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../prisma'
import { signToken, requireAuth, generateRefreshToken, hashRefreshToken, type AuthedRequest } from '../auth'
import { toClientUser } from '../serialize'
import { canManage } from '../access'
import { HttpError, notFound, wrap } from '../lib/errors'
import { requireRole, ctxOf } from '../lib/rbac'
import { validate } from '../lib/validate'
import { audit } from '../lib/audit'
import { sendEmail } from '../lib/notify'
import { genPassword, type Role } from '../userDefaults'
import { deactivateIfPastLastWorkingDate } from '../modules/hr/service'

export const authRouter = Router()

const RESET_TTL_MS = 60 * 60 * 1000
const password = z.string().min(8, 'Password must be at least 8 characters').max(200)
const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex')

// Rate limiting (Phase 10 §1) — scoped to `/api/auth/*` only, not the whole app. `login` is the tightest
// (credential-stuffing target); `forgot`/`reset`/`refresh` are looser but still capped since they touch
// tokens/emails. Each limiter responds 429 with a `retryAfter` (seconds) alongside express-rate-limit's
// own standard `RateLimit-*` / `Retry-After` headers.
//
// Two deliberate choices here, both fixed after a real incident: a shared dev IP (many concurrent test
// agents, all logging in successfully) locked out an unrelated real browser login within minutes.
//  1. `skipSuccessfulRequests: true` — only failed attempts count toward the limit. A correct password
//     must never burn down the same budget a guesser's wrong passwords do.
//  2. Keyed by IP **+ the attempted email**, not IP alone. A real school sits behind one shared office
//     IP/NAT — keying by IP alone means one person's typos (or, for `login`, one attacker's guesses
//     against a single account) lock out every other account on the same network. Per-(IP, email) keying
//     still stops credential stuffing against one account, without collateral damage to everyone else
//     sharing that IP. `forgot`/`refresh` have no stable per-account identity to add (refresh has no
//     email in the body at all), so those stay IP-scoped — they're already the more permissive limiters.
const makeLimiter = (windowMs: number, max: number, message: string, keyByEmail = false) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: keyByEmail
    ? (req) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
        return `${ipKeyGenerator(req.ip ?? '')}:${email}`
      }
    : undefined,
  message: { error: message },
  handler: (req, res, _next, options) => {
    res.status(options.statusCode).json({ error: message, retryAfter: Math.ceil(windowMs / 1000) })
  },
})
const loginLimiter = makeLimiter(15 * 60 * 1000, 10, 'Too many login attempts. Please try again later.', true)
const forgotLimiter = makeLimiter(15 * 60 * 1000, 20, 'Too many requests. Please try again later.')
const refreshLimiter = makeLimiter(15 * 60 * 1000, 60, 'Too many refresh attempts. Please try again later.')

// Creates a Session row for a fresh login/refresh and returns the raw refresh token (never persisted).
async function issueSession(userId: string) {
  const { token, hash, expiresAt } = generateRefreshToken()
  await prisma.session.create({ data: { userId, refreshTokenHash: hash, expiresAt } })
  return token
}

authRouter.post('/login', loginLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) throw new HttpError(400, 'email and password are required')

  const user = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } })
  if (!user) throw new HttpError(401, 'Invalid credentials')

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) throw new HttpError(401, 'Invalid credentials')

  // Opportunistic sweep: an approved resignation whose lastWorkingDate has since passed deactivates the
  // account here (no background scheduler in this codebase — see hr/service.ts → approveResignation).
  await deactivateIfPastLastWorkingDate(user.id)
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  if (!fresh.active) throw new HttpError(403, 'Account inactive')

  const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  const token = signToken({ userId: user.id, role: user.role, schoolId: user.schoolId })
  const refreshToken = await issueSession(user.id)
  res.json({ token, refreshToken, user: toClientUser(updated), mustChangePassword: updated.mustChangePassword })
}))

const refreshBody = z.object({ refreshToken: z.string().min(1) })

// Rotating refresh: the presented token must match a non-revoked, unexpired Session; it is revoked and a
// new one issued in its place (so a stolen-then-reused old token is a detectable replay — not handled
// beyond revocation here, but the shape is in place). Returns a new access token + refresh token, same
// shape as `/login`, since the frontend stores both the same way.
authRouter.post('/refresh', refreshLimiter, wrap(async (req, res) => {
  const body = validate(refreshBody, req.body)
  const hash = hashRefreshToken(body.refreshToken)
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hash }, include: { user: true } })
  if (!session || session.revokedAt || session.expiresAt < new Date()) throw new HttpError(401, 'Invalid or expired refresh token')
  if (!session.user.active) throw new HttpError(403, 'Account inactive')

  const refreshToken = await prisma.$transaction(async tx => {
    await tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
    const { token, hash: newHash, expiresAt } = generateRefreshToken()
    await tx.session.create({ data: { userId: session.userId, refreshTokenHash: newHash, expiresAt } })
    return token
  })
  const token = signToken({ userId: session.user.id, role: session.user.role, schoolId: session.user.schoolId })
  res.json({ token, refreshToken, user: toClientUser(session.user), mustChangePassword: session.user.mustChangePassword })
}))

authRouter.post('/logout', wrap(async (req, res) => {
  // Best-effort session revocation — the refresh token is optional so old clients (or a client that never
  // stored one) still get a clean 200. Access tokens remain stateless JWTs; only the refresh side is
  // server-tracked, so logout kills the ability to mint new access tokens, not the current one until it expires.
  const { refreshToken } = (req.body || {}) as { refreshToken?: string }
  if (refreshToken) {
    await prisma.session.updateMany({ where: { refreshTokenHash: hashRefreshToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } })
  }
  res.json({ ok: true })
}))

authRouter.get('/me', requireAuth, wrap(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: (req as AuthedRequest).auth!.userId } })
  if (!user) throw notFound('User')
  res.json({ user: toClientUser(user), mustChangePassword: user.mustChangePassword })
}))

const changeBody = z.object({ currentPassword: z.string().min(1), newPassword: password })

authRouter.post('/change-password', requireAuth, wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const body = validate(changeBody, req.body)
  const user = await prisma.user.findUnique({ where: { id: ctx.actorId } })
  if (!user) throw notFound('User')
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw new HttpError(401, 'Current password is incorrect')
  if (body.currentPassword === body.newPassword) throw new HttpError(400, 'New password must differ from the current one')
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, 10), mustChangePassword: false } })
  await prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'change-password', 'user', user.id)
  res.json({ ok: true })
}))

const forgotBody = z.object({ email: z.string().trim().email() })

// Always 200 so the endpoint cannot be used to probe accounts. Without an email provider the reset link is
// logged to the server console and, outside production, returned as `devResetUrl`.
authRouter.post('/forgot', forgotLimiter, wrap(async (req, res) => {
  const body = validate(forgotBody, req.body)
  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } })
  if (!user) return res.json({ ok: true })
  const token = crypto.randomBytes(32).toString('hex')
  await prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } })
  await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } })
  const base = process.env.APP_URL || process.env.CORS_ORIGIN || 'http://localhost:3000'
  const url = `${base.replace(/\/$/, '')}/reset?token=${token}`
  console.log(`[auth] password reset for ${user.email}: ${url}`)
  await sendEmail({ to: user.email, subject: 'Reset your Edkonic password', body: `Reset your password: ${url}\nThis link expires in 1 hour.` })
  await audit(user.schoolId, user.id, 'forgot-password', 'user', user.id)
  res.json({ ok: true, ...(process.env.NODE_ENV !== 'production' ? { devResetUrl: url } : {}) })
}))

const resetBody = z.object({ token: z.string().min(16), newPassword: password })

authRouter.post('/reset', forgotLimiter, wrap(async (req, res) => {
  const body = validate(resetBody, req.body)
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(body.token) }, include: { user: true } })
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new HttpError(400, 'Reset link is invalid or has expired')
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await bcrypt.hash(body.newPassword, 10), mustChangePassword: false } }),
    prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ])
  await audit(row.user.schoolId, row.userId, 'reset-password', 'user', row.userId)
  res.json({ ok: true })
}))

const setBody = z.object({ userId: z.string().min(1), newPassword: password.optional() })

// Admin sets (or generates) a password for a user they may manage; returned once, and the user must change it.
authRouter.post('/admin/set-password', requireAuth, requireRole('admin', 'superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const body = validate(setBody, req.body)
  const target = await prisma.user.findFirst({ where: { id: body.userId, schoolId: ctx.schoolId } })
  if (!target) throw notFound('User')
  const allUsers = (await prisma.user.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, role: true } })) as { id: string; role: Role }[]
  if (!canManage({ id: ctx.actorId, role: ctx.role }, { id: target.id, role: target.role as Role }, allUsers)) throw new HttpError(403, 'Not permitted to manage this user')
  const plain = body.newPassword ?? genPassword()
  await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await bcrypt.hash(plain, 10), mustChangePassword: true } })
  await prisma.passwordReset.updateMany({ where: { userId: target.id, usedAt: null }, data: { usedAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'set-password', 'user', target.id)
  res.json({ ok: true, userId: target.id, email: target.email, password: plain, mustChangePassword: true })
}))
