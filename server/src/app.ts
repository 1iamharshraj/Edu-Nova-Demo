import express from 'express'
import cors from 'cors'
import { authRouter } from './routes/auth'
import { usersRouter } from './routes/users'
import { dataRouter } from './routes/data'
import { academicRouter } from './modules/academic'
import { adminRouter } from './modules/admin/router'
import { errorHandler } from './lib/errors'

export function createApp() {
  const app = express()
  app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }))
  app.use(express.json({ limit: '5mb' }))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRouter)
  app.use('/api/users', usersRouter)
  app.use('/api/data', dataRouter)
  app.use('/api/academic', academicRouter)
  app.use('/api/admin', adminRouter)

  app.use(errorHandler)
  return app
}
