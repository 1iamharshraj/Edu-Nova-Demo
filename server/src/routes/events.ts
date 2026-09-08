import { Router } from 'express'
import jwt from 'jsonwebtoken'
import type { JwtPayload } from '../auth'
import { addClient, removeClient } from '../lib/realtime'

const JWT_SECRET = process.env.JWT_SECRET || 'edunova_dev_jwt_secret_change_me'

// GET /api/events/stream — SSE. EventSource can't set headers, so auth travels as `?token=`
// (see phase-7-communication.md → Realtime). Broadcasts {type:"message"|"notification", payload}
// pushed by feed/messages/notifications services through lib/realtime.ts.
export const eventsRouter = Router()

eventsRouter.get('/stream', (req, res) => {
  const token = String(req.query.token || '')
  let payload: JwtPayload
  try {
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(': connected\n\n')

  const client = addClient(payload.userId, payload.schoolId, res)
  const keepAlive = setInterval(() => { try { res.write(': ping\n\n') } catch { /* connection closed */ } }, 25_000)

  req.on('close', () => {
    clearInterval(keepAlive)
    removeClient(payload.userId, client)
  })
})
