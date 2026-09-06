import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../prisma'
import { signToken, requireAuth, type AuthedRequest } from '../auth'
import { toClientUser } from '../serialize'

export const authRouter = Router()

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' })

  const user = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } })
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' })

  const token = signToken({ userId: user.id, role: user.role, schoolId: user.schoolId })
  res.json({ token, user: toClientUser(user) })
})

authRouter.post('/logout', (_req, res) => {
  // Stateless JWTs — nothing to invalidate server-side. Client just drops the token.
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } })
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ user: toClientUser(user) })
})
