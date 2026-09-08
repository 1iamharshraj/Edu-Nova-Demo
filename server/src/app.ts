import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import pinoHttp from 'pino-http'
import { prisma } from './prisma'
import { logger } from './lib/logger'
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
import { feesRouter } from './modules/fees/router'
import { payrollRouter } from './modules/payroll/router'
import { leaveRouter } from './modules/leave/router'
import { hrRouter } from './modules/hr/router'
import { feedRouter } from './modules/feed/router'
import { messagesRouter } from './modules/messages/router'
import { notificationsRouter } from './modules/notifications/router'
import { meetingsRouter } from './modules/meetings/router'
import { calendarRouter } from './modules/calendar/router'
import { eventsRouter } from './routes/events'
import { healthRouter } from './modules/health/router'
import { slipsRouter } from './modules/slips/router'
import { achievementsRouter } from './modules/achievements/router'
import { disciplineRouter } from './modules/discipline/router'
import { callsRouter } from './modules/calls/router'
import { activitiesRouter } from './modules/activities/router'
import { reportsRouter } from './modules/reports/router'
import { aiRouter } from './modules/ai/router'
import { highlightsRouter } from './modules/highlights/router'
import { pushRouter } from './modules/push/router'
import { errorHandler } from './lib/errors'

export function createApp() {
  const app = express()
  // `crossOriginResourcePolicy: 'cross-origin'` so uploaded files/PDFs streamed from this origin can still
  // be fetched (with the bearer token) by the Vite dev frontend on a different origin/port; CSP is left
  // off since this is a pure JSON+file API, not an HTML-serving app that needs one.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(pinoHttp({ logger, autoLogging: { ignore: req => req.url === '/healthz' } }))
  app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }))
  app.use(express.json({ limit: '5mb' }))

  // Liveness probe moved off `/api/health` — Phase 8 claims that path for the welfare HealthRecord API
  // (GET/POST/PATCH/DELETE, see phase-8-welfare.md). See TESTING.md deviation note.
  // Phase 10 §6: a real DB connectivity check, not a static 200 — a dead database now shows up here.
  app.get('/healthz', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      res.json({ ok: true, db: true })
    } catch (err) {
      req.log?.error({ err }, 'healthz db check failed')
      res.status(503).json({ ok: false, db: false })
    }
  })
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
  app.use('/api/fees', feesRouter)
  app.use('/api/payroll', payrollRouter)
  app.use('/api/leave', leaveRouter)
  app.use('/api/hr', hrRouter)
  app.use('/api/feed', feedRouter)
  app.use('/api/messages', messagesRouter)
  app.use('/api/notifications', notificationsRouter)
  app.use('/api/meetings', meetingsRouter)
  app.use('/api/calendar', calendarRouter)
  app.use('/api/events', eventsRouter)
  app.use('/api/health', healthRouter)
  app.use('/api/slips', slipsRouter)
  app.use('/api/achievements', achievementsRouter)
  app.use('/api/discipline', disciplineRouter)
  app.use('/api/calls', callsRouter)
  app.use('/api/activities', activitiesRouter)
  app.use('/api/reports', reportsRouter)
  app.use('/api/ai', aiRouter)
  app.use('/api/highlights', highlightsRouter)
  app.use('/api/push', pushRouter)

  app.use(errorHandler)
  return app
}
