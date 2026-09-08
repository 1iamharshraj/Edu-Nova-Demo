import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../prisma'
import { requireAuth, type AuthedRequest } from '../../auth'
import { HttpError, wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import { audit } from '../../lib/audit'
import { loadSampleData } from '../../sampleData'
import { purgeSchoolFiles } from '../files/service'
import { closeSchoolConnections } from '../../lib/realtime'
import { paginationQuery, paginate } from '../../lib/pagination'

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
    // Phase 17 tables (FK-safe order: journal-lines -> journal-entries -> accounts).
    prisma.journalLine.deleteMany({ where: { entry: { schoolId } } }),
    prisma.journalEntry.deleteMany({ where: { schoolId } }),
    prisma.account.deleteMany({ where: { schoolId } }),
    // Phase 16 tables (FK-safe order: purchase-order-lines -> purchase-orders -> stock-movements -> vendors -> items).
    prisma.purchaseOrderLine.deleteMany({ where: { po: { schoolId } } }),
    prisma.purchaseOrder.deleteMany({ where: { schoolId } }),
    prisma.stockMovement.deleteMany({ where: { schoolId } }),
    prisma.vendor.deleteMany({ where: { schoolId } }),
    prisma.inventoryItem.deleteMany({ where: { schoolId } }),
    // Phase 15 tables (FK-safe order: loans -> copies -> books -> settings).
    prisma.loan.deleteMany({ where: { schoolId } }),
    prisma.bookCopy.deleteMany({ where: { schoolId } }),
    prisma.book.deleteMany({ where: { schoolId } }),
    prisma.librarySettings.deleteMany({ where: { schoolId } }),
    // Phase 14 tables (FK-safe order: allocations -> beds -> rooms -> hostels).
    prisma.hostelAllocation.deleteMany({ where: { schoolId } }),
    prisma.hostelBed.deleteMany({ where: { schoolId } }),
    prisma.hostelRoom.deleteMany({ where: { schoolId } }),
    prisma.hostel.deleteMany({ where: { schoolId } }),
    // Phase 12 tables.
    prisma.vehicleLocation.deleteMany({ where: { schoolId } }),
    prisma.studentStopAssignment.deleteMany({ where: { schoolId } }),
    prisma.vehicle.deleteMany({ where: { schoolId } }),
    prisma.stop.deleteMany({ where: { schoolId } }),
    prisma.route.deleteMany({ where: { schoolId } }),
    // Phase 13 tables.
    prisma.alumniDonation.deleteMany({ where: { schoolId } }),
    prisma.alumniEventRsvp.deleteMany({ where: { event: { schoolId } } }),
    prisma.alumniEvent.deleteMany({ where: { schoolId } }),
    prisma.alumniProfile.deleteMany({ where: { schoolId } }),
    // Phase 11 tables.
    prisma.employeeDocument.deleteMany({ where: { schoolId } }),
    prisma.staffConductRecord.deleteMany({ where: { schoolId } }),
    prisma.employmentHistoryEntry.deleteMany({ where: { schoolId } }),
    prisma.performanceReview.deleteMany({ where: { schoolId } }),
    // Phase 8 tables.
    prisma.activityRegistration.deleteMany({ where: { activity: { schoolId } } }),
    prisma.activity.deleteMany({ where: { schoolId } }),
    prisma.callLog.deleteMany({ where: { schoolId } }),
    prisma.disciplinaryNote.deleteMany({ where: { case: { schoolId } } }),
    prisma.disciplinaryCase.deleteMany({ where: { schoolId } }),
    prisma.achievement.deleteMany({ where: { schoolId } }),
    prisma.slipResponse.deleteMany({ where: { slip: { schoolId } } }),
    prisma.permissionSlip.deleteMany({ where: { schoolId } }),
    prisma.healthRecord.deleteMany({ where: { schoolId } }),
    // Phase 7 tables.
    prisma.message.deleteMany({ where: { conversation: { schoolId } } }),
    prisma.participant.deleteMany({ where: { conversation: { schoolId } } }),
    prisma.conversation.deleteMany({ where: { schoolId } }),
    prisma.postComment.deleteMany({ where: { post: { schoolId } } }),
    prisma.postReaction.deleteMany({ where: { post: { schoolId } } }),
    prisma.post.deleteMany({ where: { schoolId } }),
    prisma.notification.deleteMany({ where: { schoolId } }),
    prisma.meeting.deleteMany({ where: { schoolId } }),
    prisma.calendarEvent.deleteMany({ where: { schoolId } }),
    // Phase 6 tables.
    prisma.leaveRequest.deleteMany({ where: { schoolId } }),
    prisma.leaveType.deleteMany({ where: { schoolId } }),
    prisma.contract.deleteMany({ where: { schoolId } }),
    prisma.resignation.deleteMany({ where: { schoolId } }),
    prisma.duty.deleteMany({ where: { schoolId } }),
    // Phase 5 tables (records cascade from their parents where applicable).
    prisma.feeReminder.deleteMany({ where: { schoolId } }),
    prisma.payment.deleteMany({ where: { schoolId } }),
    prisma.feeInvoice.deleteMany({ where: { schoolId } }),
    prisma.feeStructure.deleteMany({ where: { schoolId } }),
    prisma.feeHead.deleteMany({ where: { schoolId } }),
    prisma.payslip.deleteMany({ where: { schoolId } }),
    prisma.salaryStructure.deleteMany({ where: { schoolId } }),
    // Phase 4 tables (password resets cascade from users).
    prisma.certificate.deleteMany({ where: { schoolId } }),
    prisma.application.deleteMany({ where: { schoolId } }),
    prisma.boardRegistration.deleteMany({ where: { schoolId } }),
    prisma.parentVerification.deleteMany({ where: { schoolId } }),
    // Phase 3 tables (records / marks / submissions cascade from their parents).
    prisma.homework.deleteMany({ where: { schoolId } }),
    prisma.assessment.deleteMany({ where: { schoolId } }),
    prisma.gradeScale.deleteMany({ where: { schoolId } }),
    prisma.attendanceSession.deleteMany({ where: { schoolId } }),
    prisma.staffAttendance.deleteMany({ where: { schoolId } }),
    prisma.file.deleteMany({ where: { schoolId } }),
    prisma.substitution.deleteMany({ where: { schoolId } }),
    prisma.timetableEntry.deleteMany({ where: { schoolId } }),
    prisma.timetablePublish.deleteMany({ where: { schoolId } }),
    prisma.periodTemplate.deleteMany({ where: { schoolId } }),
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
  ])
  await purgeSchoolFiles(schoolId)
  closeSchoolConnections(schoolId)
  await audit(schoolId, ctx.actorId, 'reset', 'school', schoolId)
  res.json({ ok: true })
}))

// `?limit&cursor` cursor pagination (Phase 10 §5) layered on top of the existing `before`/`entity`/
// `actorId` filters — a caller that passes neither `limit` nor `cursor` gets exactly the old behaviour
// (first 50, capped at 500 via `limit`). `cursor` is an audit-log id from a previous page's `nextCursor`.
adminRouter.get('/audit', requireRole('admin', 'superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const q = validate(paginationQuery, req.query)
  const before = req.query.before ? new Date(String(req.query.before)) : undefined
  if (before && Number.isNaN(before.getTime())) throw new HttpError(400, 'before must be an ISO date')
  const entity = req.query.entity ? String(req.query.entity) : undefined
  const actorId = req.query.actorId ? String(req.query.actorId) : undefined
  const where = { schoolId: ctx.schoolId, entity, actorId, ...(before ? { at: { lt: before } } : {}) }
  const { items, nextCursor } = await paginate(
    args => prisma.auditLog.findMany({ where, orderBy: [{ at: 'desc' }, { id: 'desc' }], ...args }),
    { limit: q.limit, cursor: q.cursor, defaultLimit: 50, maxLimit: 500 },
  )
  res.json({ items, nextCursor })
}))

// Admin-visible list of a user's (or, unfiltered, the whole school's) refresh-token sessions — mainly for
// "sign this user out everywhere" tooling. Never exposes the token hash.
const sessionsQuery = paginationQuery.extend({ userId: z.string().min(1).optional() })

adminRouter.get('/sessions', requireRole('admin', 'superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const q = validate(sessionsQuery, req.query)
  const where = { user: { schoolId: ctx.schoolId }, ...(q.userId ? { userId: q.userId } : {}) }
  const { items, nextCursor } = await paginate(
    args => prisma.session.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, userId: true, createdAt: true, expiresAt: true, revokedAt: true },
      ...args,
    }),
    { limit: q.limit, cursor: q.cursor, defaultLimit: 50, maxLimit: 500 },
  )
  res.json({ items, nextCursor })
}))

adminRouter.post('/sessions/:id/revoke', requireRole('admin', 'superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const row = await prisma.session.findFirst({ where: { id: req.params.id, user: { schoolId: ctx.schoolId } } })
  if (!row) throw new HttpError(404, 'Session not found')
  await prisma.session.update({ where: { id: row.id }, data: { revokedAt: row.revokedAt ?? new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'revoke-session', 'session', row.id)
  res.json({ ok: true })
}))
