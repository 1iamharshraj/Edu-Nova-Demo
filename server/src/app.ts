import express from 'express'
import cors from 'cors'
import { authRouter } from './routes/auth'
import { usersRouter } from './routes/users'
import { dataRouter } from './routes/data'
import { academicRouter } from './modules/academic'
import { adminRouter } from './modules/admin/router'
import { timetableRouter } from './modules/timetable/router'
import { filesRouter } from './modules/files/router'
import { attendanceRouter } from './modules/attendance/router'
import { assessmentsRouter } from './modules/assessments/router'
import { homeworkRouter } from './modules/homework/router'
import { applicationsRouter } from './modules/applications/router'
import { certificatesRouter } from './modules/certificates/router'
import { boardRegistrationsRouter } from './modules/boardRegistrations/router'
import { verificationRouter } from './modules/verification/router'
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
  app.use('/api/timetable', timetableRouter)
  app.use('/api/files', filesRouter)
  app.use('/api/attendance', attendanceRouter)
  app.use('/api/assessments', assessmentsRouter)
  app.use('/api/homework', homeworkRouter)
  app.use('/api/applications', applicationsRouter)
  app.use('/api/certificates', certificatesRouter)
  app.use('/api/board-registrations', boardRegistrationsRouter)
  app.use('/api/verification', verificationRouter)

  app.use(errorHandler)
  return app
}
