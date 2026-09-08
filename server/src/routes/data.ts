import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth, type AuthedRequest } from '../auth'
import { wrap } from '../lib/errors'

export const dataRouter = Router()
dataRouter.use(requireAuth)

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const short = (m: number) => MONTHS[m].slice(0, 3)

// Legacy `Term` shape: { id, name, range: "Jun – Sep 2025", months: ["June", …], current }
async function legacyTerms(schoolId: string) {
  const rows = await prisma.term.findMany({ where: { schoolId }, orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }] })
  return rows.map(t => {
    const s = t.startDate, e = t.endDate
    const months: string[] = []
    for (let y = s.getUTCFullYear(), m = s.getUTCMonth(); y < e.getUTCFullYear() || (y === e.getUTCFullYear() && m <= e.getUTCMonth()); ) {
      months.push(MONTHS[m])
      if (++m === 12) { m = 0; y++ }
    }
    return {
      id: t.id,
      name: t.name,
      range: `${short(s.getUTCMonth())} – ${short(e.getUTCMonth())} ${e.getUTCFullYear()}`,
      months,
      current: t.isCurrent,
    }
  })
}

// Legacy `Subject` shape: { id, name, teacher: "A, B" | "—", color }
async function legacySubjects(schoolId: string) {
  const rows = await prisma.subject.findMany({
    where: { schoolId },
    include: { classSubjects: { include: { teacher: { select: { name: true } } } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map(s => {
    const names = [...new Set(s.classSubjects.map(cs => cs.teacher?.name).filter((n): n is string => !!n))]
    return { id: s.id, name: s.name, teacher: names.length ? names.join(', ') : '—', color: s.color }
  })
}

// Every other legacy blob key (attendance, marks, feed, applications, boardDetails, marksheets, receipts,
// contracts, resignations, health, discipline, …) has long since moved into real tables served by their own
// routes (/api/attendance, /api/assessments, /api/homework, /api/applications, /api/board-registrations,
// /api/certificates, /api/health, /api/slips, /api/achievements, /api/discipline, /api/calls, /api/activities,
// etc). The `SchoolData` JSON blob that used to back this route is gone (Phase 10 cleanup) — this endpoint now
// only computes the two legacy-shaped, read-only views (`terms` with `range`/`months`, `subjects` with a
// comma-joined `teacher` string) that a handful of older screens still read via `useStore().db`.
dataRouter.get('/', wrap(async (req, res) => {
  const { schoolId } = (req as AuthedRequest).auth!
  const [terms, subjects] = await Promise.all([legacyTerms(schoolId), legacySubjects(schoolId)])
  res.json({ data: { terms, subjects } })
}))
