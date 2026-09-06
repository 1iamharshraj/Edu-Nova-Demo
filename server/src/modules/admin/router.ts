import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { requireAuth, type AuthedRequest } from '../../auth'
import { HttpError, wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import { audit } from '../../lib/audit'
import { loadSampleData } from '../../sampleData'

export const adminRouter = Router()
adminRouter.use(requireAuth)

adminRouter.post('/load-sample-data', requireRole('superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const where = { schoolId: ctx.schoolId }
  const [classes, boards, grades] = await Promise.all([prisma.class.count({ where }), prisma.board.count({ where }), prisma.grade.count({ where })])
  if (classes || boards || grades) {
    throw new HttpError(409, 'Sample data can only be loaded into an empty school (classes / boards / grades already exist)')
  }
  await loadSampleData(ctx.schoolId)
  await audit(ctx.schoolId, ctx.actorId, 'load-sample-data', 'school', ctx.schoolId)
  res.json({ ok: true })
}))

const resetBody = z.object({ confirm: z.literal('RESET') })

adminRouter.post('/reset', requireRole('superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  validate(resetBody, req.body)
  const { schoolId } = ctx
  await prisma.$transaction([
    prisma.user.deleteMany({ where: { schoolId, id: { not: ctx.actorId } } }),
    prisma.academicYear.deleteMany({ where: { schoolId } }),
    prisma.curriculumSubject.deleteMany({ where: { schoolId } }),
    prisma.board.deleteMany({ where: { schoolId } }),
    prisma.grade.deleteMany({ where: { schoolId } }),
    prisma.stream.deleteMany({ where: { schoolId } }),
    prisma.subject.deleteMany({ where: { schoolId } }),
    prisma.room.deleteMany({ where: { schoolId } }),
    prisma.enrollment.deleteMany({ where: { schoolId } }),
    prisma.guardian.deleteMany({ where: { schoolId } }),
    prisma.classSubject.deleteMany({ where: { schoolId } }),
    prisma.auditLog.deleteMany({ where: { schoolId } }),
    prisma.schoolData.deleteMany({ where: { schoolId } }),
  ])
  await audit(schoolId, ctx.actorId, 'reset', 'school', schoolId)
  res.json({ ok: true })
}))

adminRouter.get('/audit', requireRole('admin', 'superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500)
  const before = req.query.before ? new Date(String(req.query.before)) : undefined
  if (before && Number.isNaN(before.getTime())) throw new HttpError(400, 'before must be an ISO date')
  const items = await prisma.auditLog.findMany({
    where: { schoolId: ctx.schoolId, ...(before ? { at: { lt: before } } : {}) },
    orderBy: { at: 'desc' },
    take: limit,
  })
  res.json({ items })
}))
