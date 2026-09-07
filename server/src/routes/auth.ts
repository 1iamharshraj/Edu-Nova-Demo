import crypto from 'node:crypto'
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../prisma'
import { signToken, requireAuth, type AuthedRequest } from '../auth'
import { toClientUser } from '../serialize'
import { canManage } from '../access'
import { HttpError, notFound, wrap } from '../lib/errors'
import { requireRole, ctxOf } from '../lib/rbac'
import { validate } from '../lib/validate'
import { audit } from '../lib/audit'
import type { Role } from '../userDefaults'

export const authRouter = Router()

const RESET_TTL_MS = 60 * 60 * 1000
const password = z.string().min(8, 'Password must be at least 8 characters').max(200)
const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex')
const genPassword = () => crypto.randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8) + '2k'

authRouter.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) throw new HttpError(400, 'email and password are required')

  const user = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } })
  if (!user) throw new HttpError(401, 'Invalid credentials')

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) throw new HttpError(401, 'Invalid credentials')

  const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  const token = signToken({ userId: user.id, role: user.role, schoolId: user.schoolId })
  res.json({ token, user: toClientUser(updated), mustChangePassword: updated.mustChangePassword })
}))

authRouter.post('/logout', (_req, res) => {
  // Stateless JWTs — nothing to invalidate server-side. Client just drops the token.
  res.json({ ok: true })
})

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
authRouter.post('/forgot', wrap(async (req, res) => {
  const body = validate(forgotBody, req.body)
  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } })
  if (!user) return res.json({ ok: true })
  const token = crypto.randomBytes(32).toString('hex')
  await prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } })
  await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } })
  const base = process.env.APP_URL || process.env.CORS_ORIGIN || 'http://localhost:3000'
  const url = `${base.replace(/\/$/, '')}/reset?token=${token}`
  console.log(`[auth] password reset for ${user.email}: ${url}`)
  await audit(user.schoolId, user.id, 'forgot-password', 'user', user.id)
  res.json({ ok: true, ...(process.env.NODE_ENV !== 'production' ? { devResetUrl: url } : {}) })
}))

const resetBody = z.object({ token: z.string().min(16), newPassword: password })

authRouter.post('/reset', wrap(async (req, res) => {
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
