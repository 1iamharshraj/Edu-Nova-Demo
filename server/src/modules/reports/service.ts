import { prisma } from '../../prisma'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isStaff, isClassTeacherOfStudent, isGuardianOf, activeClassOf } from '../../lib/scope'
import * as reports from '../assessments/reports'
import { summary as attendanceSummary } from '../attendance/service'
import { listInvoices } from '../fees/service'
import { serializeCall } from '../calls/service'
import { serializeCase } from '../discipline/service'
import { serializeAchievement } from '../achievements/service'
import { serializeHealth } from '../health/service'

// GET /api/reports/student/:id — the assembled dossier behind `studentReport.tsx`. See
// phase-8-welfare.md → Endpoints. Access: the student, their guardians, their class teacher, staff/admin —
// the same circle that may see health records; anyone else gets a 403.

async function assertDossierAccess(ctx: Ctx, studentId: string) {
  if (isStaff(ctx)) return
  if (ctx.role === 'student' && ctx.actorId === studentId) return
  if (await isGuardianOf(ctx, studentId)) return
  if (await isClassTeacherOfStudent(ctx, studentId)) return
  throw new HttpError(403, 'You cannot view this student’s report')
}

export async function studentDossier(ctx: Ctx, studentId: string) {
  const student = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')
  await assertDossierAccess(ctx, studentId)

  const enrollment = await activeClassOf(studentId)
  const term = enrollment
    ? await prisma.term.findFirst({ where: { schoolId: ctx.schoolId, academicYearId: enrollment.academicYearId, isCurrent: true } })
      ?? (await prisma.term.findFirst({ where: { schoolId: ctx.schoolId, academicYearId: enrollment.academicYearId }, orderBy: { startDate: 'desc' } }))
    : null

  const [attendance, reportCard, invoices, meetings, calls, discipline, achievements, health] = await Promise.all([
    term ? attendanceSummary(ctx, { studentId, termId: term.id }).catch(() => undefined) : undefined,
    term ? reports.reportCard(ctx, studentId, term.id).catch(() => undefined) : undefined,
    listInvoices(ctx, { studentId }).catch(() => ({ items: [], nextCursor: null })),
    prisma.meeting.findMany({ where: { schoolId: ctx.schoolId, studentId }, orderBy: { scheduledAt: 'desc' } }),
    prisma.callLog.findMany({ where: { schoolId: ctx.schoolId, studentId }, orderBy: { calledAt: 'desc' } }),
    prisma.disciplinaryCase.findMany({ where: { schoolId: ctx.schoolId, studentId, deletedAt: null }, orderBy: { createdAt: 'desc' } }),
    prisma.achievement.findMany({ where: { schoolId: ctx.schoolId, userId: studentId }, orderBy: { date: 'desc' } }),
    prisma.healthRecord.findMany({ where: { schoolId: ctx.schoolId, studentId }, orderBy: { date: 'desc' } }),
  ])

  const ranks = term && enrollment ? await reports.ranks(ctx, enrollment.classId, term.id).catch(() => undefined) : undefined

  return {
    profile: { id: student.id, name: student.name, email: student.email, role: student.role, avatarHue: student.avatarHue, photoFileId: student.photoFileId ?? undefined },
    enrollment: enrollment ? { classId: enrollment.classId, classLabel: undefined, rollNo: enrollment.rollNo ?? undefined, academicYearId: enrollment.academicYearId } : undefined,
    termId: term?.id,
    attendance,
    reportCard,
    ranks,
    invoices: invoices.items.map(i => ({
      id: i.id, termId: i.termId, status: i.status, dueDate: i.dueDate.toISOString().slice(0, 10),
      total: i.total, paid: i.payments.reduce((a, p) => a + p.amount, 0),
    })),
    meetings: meetings.map(m => ({ id: m.id, purpose: m.purpose, scheduledAt: m.scheduledAt.toISOString(), status: m.status })),
    calls: calls.map(serializeCall),
    discipline: discipline.map(serializeCase),
    achievements: achievements.map(serializeAchievement),
    health: health.map(serializeHealth),
  }
}
