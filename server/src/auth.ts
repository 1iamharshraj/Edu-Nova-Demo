import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'

const JWT_SECRET = process.env.JWT_SECRET || 'edkonic_dev_jwt_secret_change_me'

// Access tokens are short-lived; a rotating refresh token (see routes/auth.ts `/refresh`, backed by the
// `Session` table) is what keeps a session alive without re-entering credentials. See
// phase-9-10-integrations-hardening.md → Phase 10 §2.
export const ACCESS_TOKEN_TTL = '15m'
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface JwtPayload {
  userId: string
  role: string
  schoolId: string
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL })
}

// Refresh tokens are opaque random strings, never JWTs — only their sha256 hash is persisted
// (Session.refreshTokenHash), so a leaked database dump does not hand out usable tokens.
export function generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(48).toString('base64url')
  return { token, hash: hashRefreshToken(token), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) }
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export interface AuthedRequest extends Request {
  auth?: JwtPayload
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' })
  }
  const token = header.slice('Bearer '.length)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload
    req.auth = payload
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
