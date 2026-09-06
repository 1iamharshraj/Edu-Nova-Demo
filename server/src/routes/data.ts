import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth, type AuthedRequest } from '../auth'
import { HttpError, wrap } from '../lib/errors'

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

dataRouter.get('/', wrap(async (req, res) => {
  const { schoolId } = (req as AuthedRequest).auth!
  const row = await prisma.schoolData.findUnique({ where: { schoolId } })
  const blob = (row?.data ?? {}) as Record<string, unknown>
  const [terms, subjects] = await Promise.all([legacyTerms(schoolId), legacySubjects(schoolId)])
  res.json({ data: { ...blob, terms, subjects } })
}))

dataRouter.put('/', wrap(async (req, res) => {
  const { schoolId } = (req as AuthedRequest).auth!
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be the data object')
  // users / terms / subjects are owned by real tables now — never persisted into the blob.
  const { users: _u, terms: _t, subjects: _s, ...rest } = body as Record<string, unknown>

  const row = await prisma.schoolData.upsert({
    where: { schoolId },
    create: { schoolId, data: rest as object },
    update: { data: rest as object },
  })
  const [terms, subjects] = await Promise.all([legacyTerms(schoolId), legacySubjects(schoolId)])
  res.json({ data: { ...(row.data as object), terms, subjects } })
}))
