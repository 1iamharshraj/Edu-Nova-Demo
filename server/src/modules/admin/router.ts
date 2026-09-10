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
    // Phase T1 tables (advanced timetable generation, foundations — phase-t1-timetable-foundations.md).
    // FK-safe order: CohortClass -> Cohort, RoomCapability -> Capability. TeacherQualification and
    // WorkingDayPattern have no dependents of their own. PeriodTemplate override rows (dayOfWeek/
    // baseTemplateId, added to the existing PeriodTemplate table) are covered by the pre-existing
    // `periodTemplate.deleteMany({ where: { schoolId } })` further below — one statement matching every
    // row (base + override) for this school, so no separate cleanup needed here.
    // Phase T3 tables (advanced timetable generation, sectioning engine — phase-t3-sectioning-engine.md).
    // FK-safe order: SectioningAssignment before SectioningVersion; CohortMembership/TrackEligibilityException
    // have no dependents of their own; TrackEligibilityRule before Activity is NOT required here since
    // Activity itself is untouched by this reset block (see the pre-existing activityRegistration/activity
    // deleteMany further below — those cascade TrackEligibilityRule via its own FK).
    prisma.sectioningAssignment.deleteMany({ where: { schoolId } }),
    prisma.sectioningVersion.deleteMany({ where: { schoolId } }),
    prisma.sectioningTemplate.deleteMany({ where: { schoolId } }),
    prisma.performanceBand.deleteMany({ where: { schoolId } }),
    prisma.trackEligibilityException.deleteMany({ where: { schoolId } }),
    prisma.trackEligibilityRule.deleteMany({ where: { schoolId } }),
    prisma.cohortMembership.deleteMany({ where: { schoolId } }),
    prisma.cohortClass.deleteMany({ where: { cohort: { schoolId } } }),
    prisma.cohort.deleteMany({ where: { schoolId } }),
    prisma.roomCapability.deleteMany({ where: { room: { schoolId } } }),
    prisma.capability.deleteMany({ where: { schoolId } }),
    prisma.teacherQualification.deleteMany({ where: { schoolId } }),
    prisma.workingDayPattern.deleteMany({ where: { schoolId } }),
    // Phase T4 tables (advanced timetable generation, Constraint Builder + solver core —
    // phase-t4-solver-core.md). FK-safe order: TeachingAssignment before TeachingRequirement (assignment
    // carries a teachingRequirementId FK); Constraint has no dependents of its own.
    prisma.teachingAssignment.deleteMany({ where: { schoolId } }),
    prisma.teachingRequirement.deleteMany({ where: { schoolId } }),
    prisma.constraint.deleteMany({ where: { schoolId } }),
    // Phase T5 tables (never added to reset when T5 shipped — caught and fixed here). No FK dependents of
    // their own (TeachingAssignmentPool references TeachingRequirement, already cleared above).
    prisma.teacherAvailability.deleteMany({ where: { schoolId } }),
    prisma.teachingAssignmentPool.deleteMany({ where: { schoolId } }),
    prisma.preference.deleteMany({ where: { schoolId } }),
    prisma.preferenceProfile.deleteMany({ where: { schoolId } }),
    // Phase T6 tables (advanced timetable generation, sessions/jobs/diagnostics — phase-t6-sessions-jobs.md).
    // FK-safe order: leaf join/entry tables before their parents. TimetableEntry.sessionId (additive column
    // on the existing table) needs no separate cleanup — it's cleared by that table's own pre-existing
    // deleteMany further below, and TimetableSession is deleted here regardless of whether any
    // TimetableEntry still references it (onDelete: SetNull).
    prisma.electiveChoice.deleteMany({ where: { electiveOffering: { electiveBlock: { schoolId } } } }),
    prisma.electiveOffering.deleteMany({ where: { electiveBlock: { schoolId } } }),
    prisma.electiveBlock.deleteMany({ where: { schoolId } }),
    prisma.sessionRequirement.deleteMany({ where: { session: { schoolId } } }),
    prisma.sessionCohort.deleteMany({ where: { session: { schoolId } } }),
    prisma.timetableSessionEntry.deleteMany({ where: { session: { schoolId } } }),
    prisma.timetableSession.deleteMany({ where: { schoolId } }),
    prisma.timetableGenerationJob.deleteMany({ where: { schoolId } }),
    // Phase T7 tables (advanced timetable generation, versioning + locks + override system —
    // phase-t7-versioning-override.md). FK-safe order: TimetableEditEvent/TimetableLock (children) before
    // TimetableVersion (parent). TimetableEntry.timetableVersionId (additive column on the existing table)
    // needs no separate cleanup — the pre-existing timetableEntry.deleteMany further below clears it, and
    // TimetableVersion is deleted here regardless (onDelete: SetNull on that FK).
    prisma.timetableEditEvent.deleteMany({ where: { schoolId } }),
    prisma.timetableLock.deleteMany({ where: { schoolId } }),
    prisma.timetableVersion.deleteMany({ where: { schoolId } }),
    // Phase 30 tables (FK-safe order: wallet-transactions -> wallets; both filtered directly by schoolId
    // rather than joined through the other, so this can run anywhere in the list).
    prisma.walletTransaction.deleteMany({ where: { schoolId } }),
    prisma.studentWallet.deleteMany({ where: { schoolId } }),
    // Phase 25 tables (FK-safe order: exam-seats -> seating-plans; invigilation-duties has no dependents of
    // its own. Both reference Assessment/Room, so this block must run before the Phase 3 Assessment
    // deleteMany and the Phase-1b Room deleteMany further below).
    prisma.examSeat.deleteMany({ where: { plan: { schoolId } } }),
    prisma.examSeatingPlan.deleteMany({ where: { schoolId } }),
    prisma.invigilationDuty.deleteMany({ where: { schoolId } }),
    // Phase 27 tables (no FK dependents — safe to delete first). Item 2 (portfolio) is a read-only
    // aggregation of Achievement/Certificate/ActivityRegistration — no new tables to clean up there.
    prisma.housePoints.deleteMany({ where: { schoolId } }),
    // Phase 23 tables (no FK dependents — safe to delete first).
    prisma.parentDigestSend.deleteMany({ where: { schoolId } }),
    // Phase 20 tables (no FK dependents — safe to delete first). AiConversation/AiMessage predate this
    // phase (Phase 9) and are cleaned up further below with the other Phase 9 tables; Enrollment.remarks
    // (Phase 20 item 3) needs no explicit cleanup — it's a JSON field cleared when Enrollment itself is
    // deleted below, not a separate row/table.
    prisma.generatedWorksheet.deleteMany({ where: { schoolId } }),
    // Phase 22 tables (no FK dependents — safe to delete first). FK-safe order: medication-logs before
    // medication-schedules; everything else here has no dependents of its own.
    prisma.medicationLog.deleteMany({ where: { schoolId } }),
    prisma.medicationSchedule.deleteMany({ where: { schoolId } }),
    prisma.anonymousReport.deleteMany({ where: { schoolId } }),
    prisma.counselingRecord.deleteMany({ where: { schoolId } }),
    prisma.counselingSettings.deleteMany({ where: { schoolId } }),
    prisma.pickupEvent.deleteMany({ where: { schoolId } }),
    prisma.authorizedPickupPerson.deleteMany({ where: { schoolId } }),
    prisma.visitor.deleteMany({ where: { schoolId } }),
    // Phase 19 tables (no FK dependents — safe to delete first).
    prisma.studentRiskSnapshot.deleteMany({ where: { schoolId } }),
    prisma.analyticsSettings.deleteMany({ where: { schoolId } }),
    // Phase 18 tables (FK-safe order: chapter-resources -> assessment-chapter links (in-place clear on
    // Assessment.chapterIds, not a delete) -> term-targets -> chapter-progress -> chapters).
    prisma.chapterResource.deleteMany({ where: { schoolId } }),
    prisma.assessment.updateMany({ where: { schoolId }, data: { chapterIds: [] } }),
    prisma.termSyllabusTarget.deleteMany({ where: { schoolId } }),
    prisma.chapterProgress.deleteMany({ where: { schoolId } }),
    prisma.syllabusChapter.deleteMany({ where: { schoolId } }),
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
    // Phase 24 tables (FK-safe order: meal feedback -> mess menu; roll-call entries cascade with their
    // roll-call row; outpasses are leaves off Hostel/User). Independent of the Phase 14 hostel-tree
    // deletion below since each is filtered directly by schoolId rather than joined through it.
    prisma.mealFeedback.deleteMany({ where: { schoolId } }),
    prisma.messMenu.deleteMany({ where: { schoolId } }),
    prisma.hostelRollCall.deleteMany({ where: { schoolId } }),
    prisma.hostelOutpass.deleteMany({ where: { schoolId } }),
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
    // Phase T9 tables (advanced timetable generation, substitution workflow — phase-t9-substitution.md).
    // FK-safe order: PeriodHold/SubstitutionRequest (children, both carry a leaveRequestId-adjacent FK
    // chain) before the Phase 6 LeaveRequest deleteMany immediately below; SubstitutionPolicy is a
    // school-level singleton with no dependents of its own.
    prisma.periodHold.deleteMany({ where: { schoolId } }),
    prisma.substitutionRequest.deleteMany({ where: { schoolId } }),
    prisma.substitutionPolicy.deleteMany({ where: { schoolId } }),
    // Phase 6 tables.
    prisma.leaveRequest.deleteMany({ where: { schoolId } }),
    prisma.leaveType.deleteMany({ where: { schoolId } }),
    prisma.contract.deleteMany({ where: { schoolId } }),
    prisma.resignation.deleteMany({ where: { schoolId } }),
    prisma.duty.deleteMany({ where: { schoolId } }),
    // Phase 5 tables (records cascade from their parents where applicable).
    // Phase 21 (FK-safe: ScholarshipAward before Scholarship; both before FeeInvoice/FeeStructure since
    // FeeInvoice.installmentPlanId -> FeeInstallmentPlan.feeStructureId -> FeeStructure).
    prisma.scholarshipAward.deleteMany({ where: { schoolId } }),
    prisma.scholarship.deleteMany({ where: { schoolId } }),
    prisma.feeReminder.deleteMany({ where: { schoolId } }),
    prisma.payment.deleteMany({ where: { schoolId } }),
    prisma.feeInvoice.deleteMany({ where: { schoolId } }),
    prisma.feeInstallmentPlan.deleteMany({ where: { schoolId } }),
    prisma.feeStructure.deleteMany({ where: { schoolId } }),
    prisma.feeHead.deleteMany({ where: { schoolId } }),
    prisma.payslip.deleteMany({ where: { schoolId } }),
    prisma.salaryStructure.deleteMany({ where: { schoolId } }),
    // Phase T2 tables (FK-safe: SubmittedDocument/PriorSubjectScore before Application since both carry
    // an applicationId FK; AdmissionCategory/RequiredDocumentType/AdmissionSettings are school-level
    // catalogs cleaned like other catalogs — see phase-t2-strong-admissions.md).
    prisma.submittedDocument.deleteMany({ where: { schoolId } }),
    prisma.priorSubjectScore.deleteMany({ where: { schoolId } }),
    prisma.admissionCategory.deleteMany({ where: { schoolId } }),
    prisma.requiredDocumentType.deleteMany({ where: { schoolId } }),
    prisma.admissionSettings.deleteMany({ where: { schoolId } }),
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
    // Bug B fix: Highlight and AiConversation (AiMessage cascades from AiConversation via
    // onDelete: Cascade — see schema) have no dependents that block this and no reason to survive a
    // reset, but they were previously relying entirely on the User cascade below to clean them up. Since
    // that user.deleteMany excludes the actor performing the reset, any Highlight/AiConversation owned
    // by that actor's own account was left behind indefinitely. Delete them explicitly, scoped by
    // schoolId directly (not through the user relation), so they're gone regardless of who created them.
    prisma.aiConversation.deleteMany({ where: { schoolId } }),
    prisma.highlight.deleteMany({ where: { schoolId } }),
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
    // Phase 28 — a reset is scoped to ONE school (`schoolId`), so it must only null out THIS school's own
    // `groupId` — the SchoolGroup row itself and any other member schools are untouched (a reset of one
    // campus must not destroy the whole group or its other members' data). GroupAdmin grants held by this
    // school's own users are cleaned up implicitly: `onDelete: Cascade` on GroupAdmin.userId means the
    // user.deleteMany(...) above already removed any such grants for users deleted in this reset (the
    // caller's own user row survives the reset and keeps any grant it holds, correctly — resetting a
    // school's data shouldn't revoke its superadmin's own group membership).
    prisma.school.update({ where: { id: schoolId }, data: { groupId: null } }),
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
