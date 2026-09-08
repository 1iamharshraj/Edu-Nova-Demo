import { prisma } from '../prisma'
import { HttpError, notFound } from './errors'
import type { Ctx } from './rbac'

// Phase 3 authorisation helpers (see phase-3-attendance-assessment.md → Authorisation).
//
// "Class scope" for writes: staff / admin / superadmin may write for any class; a teacher only for
// classes where they are the class teacher or hold a ClassSubject (the client's `classesTaughtBy`).
// Students and parents never write class data (homework submissions are handled separately).

export const STAFF_ROLES = ['staff', 'admin', 'superadmin']
export const ADMIN_ROLES = ['admin', 'superadmin']

export const isStaff = (ctx: Ctx) => STAFF_ROLES.includes(ctx.role)
export const isAdmin = (ctx: Ctx) => ADMIN_ROLES.includes(ctx.role)
export const isRestricted = (ctx: Ctx) => ctx.role === 'student' || ctx.role === 'parent'

export async function getClass(ctx: Ctx, classId: string) {
  const row = await prisma.class.findFirst({ where: { id: classId, schoolId: ctx.schoolId }, include: { grade: true } })
  if (!row) throw notFound('Class')
  return row
}

export async function getTerm(ctx: Ctx, termId: string) {
  const row = await prisma.term.findFirst({ where: { id: termId, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Term')
  return row
}

export async function getClassSubject(ctx: Ctx, id: string) {
  const row = await prisma.classSubject.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: { class: { include: { grade: true } }, subject: true },
  })
  if (!row) throw notFound('Class subject')
  return row
}

export async function canWriteClass(ctx: Ctx, classId: string): Promise<boolean> {
  if (isStaff(ctx)) return true
  if (ctx.role !== 'teacher') return false
  const cls = await prisma.class.findFirst({
    where: { id: classId, schoolId: ctx.schoolId, OR: [{ classTeacherId: ctx.actorId }, { classSubjects: { some: { teacherId: ctx.actorId } } }] },
    select: { id: true },
  })
  return !!cls
}

export async function assertWriteClass(ctx: Ctx, classId: string) {
  if (!(await canWriteClass(ctx, classId))) throw new HttpError(403, 'You do not teach this class')
}

// Read visibility: students only their own class, parents only a ward's class; everyone else any class.
export async function canViewClass(ctx: Ctx, classId: string): Promise<boolean> {
  if (ctx.role === 'student') return !!(await prisma.enrollment.findFirst({ where: { classId, studentId: ctx.actorId } }))
  if (ctx.role === 'parent') return !!(await prisma.enrollment.findFirst({ where: { classId, student: { guardianLinks: { some: { parentId: ctx.actorId } } } } }))
  return true
}

export async function assertViewClass(ctx: Ctx, classId: string) {
  if (!(await canViewClass(ctx, classId))) throw new HttpError(403, 'You are not enrolled in this class')
}

// Student ids the caller may see per-student data for: self (student) or wards (parent); null = unrestricted.
export async function visibleStudentIds(ctx: Ctx): Promise<string[] | null> {
  if (ctx.role === 'student') return [ctx.actorId]
  if (ctx.role === 'parent') {
    const wards = await prisma.guardian.findMany({ where: { parentId: ctx.actorId }, select: { studentId: true } })
    return wards.map(w => w.studentId)
  }
  return null
}

export async function assertViewStudent(ctx: Ctx, studentId: string) {
  const ids = await visibleStudentIds(ctx)
  if (ids && !ids.includes(studentId)) throw new HttpError(403, ctx.role === 'parent' ? 'That student is not your ward' : 'You can only view your own records')
}

// Active roster of a class as a map studentId → { id, name, rollNo }.
export async function rosterOf(classId: string) {
  const rows = await prisma.enrollment.findMany({
    where: { classId, status: 'active' },
    include: { student: { select: { id: true, name: true } } },
    orderBy: [{ rollNo: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map(e => ({ id: e.student.id, name: e.student.name, rollNo: e.rollNo ?? undefined }))
}

export async function assertOnRoster(classId: string, studentIds: string[]) {
  if (!studentIds.length) return
  const roster = new Set((await rosterOf(classId)).map(s => s.id))
  const bad = [...new Set(studentIds)].filter(id => !roster.has(id))
  if (bad.length) throw new HttpError(400, 'studentId must be an active student of this class', { studentId: bad })
}

// Class ids a teacher teaches (class-teacher of, or holds a ClassSubject in). See phase-7-communication.md
// (feed Class audience, messages allowed-pair rules) — mirrors modules/leave/service.ts#teacherClassIds.
export async function classesTaughtBy(schoolId: string, teacherId: string): Promise<string[]> {
  const rows = await prisma.class.findMany({
    where: { schoolId, OR: [{ classTeacherId: teacherId }, { classSubjects: { some: { teacherId } } }] },
    select: { id: true },
  })
  return rows.map(c => c.id)
}

export async function teacherClassIds(ctx: Ctx): Promise<string[]> {
  if (ctx.role !== 'teacher') return []
  return classesTaughtBy(ctx.schoolId, ctx.actorId)
}

// Active enrolment class ids for a student.
export async function studentClassIds(studentId: string): Promise<string[]> {
  const rows = await prisma.enrollment.findMany({ where: { studentId, status: 'active' }, select: { classId: true } })
  return rows.map(r => r.classId)
}

// Active enrolment class ids across all of a parent's wards.
export async function wardClassIds(ctx: Ctx): Promise<string[]> {
  const wards = (await visibleStudentIds(ctx)) ?? []
  if (!wards.length) return []
  const rows = await prisma.enrollment.findMany({ where: { studentId: { in: wards }, status: 'active' }, select: { classId: true } })
  return [...new Set(rows.map(r => r.classId))]
}

// The active enrolment class of a student (current academic year, else most recent), or null.
// Used by Phase 8 welfare modules — see phase-8-welfare.md (health/discipline "class teacher" visibility).
export async function activeClassOf(studentId: string) {
  return prisma.enrollment.findFirst({
    where: { studentId, status: 'active' },
    orderBy: [{ academicYear: { isCurrent: 'desc' } }, { createdAt: 'desc' }],
    include: { class: true },
  })
}

// True if `ctx` is the class teacher of the student's active class.
export async function isClassTeacherOfStudent(ctx: Ctx, studentId: string): Promise<boolean> {
  if (ctx.role !== 'teacher') return false
  const enrollment = await activeClassOf(studentId)
  return !!enrollment && enrollment.class.classTeacherId === ctx.actorId
}

// True if `ctx` is a guardian of the student.
export async function isGuardianOf(ctx: Ctx, studentId: string): Promise<boolean> {
  if (ctx.role !== 'parent') return false
  return !!(await prisma.guardian.findUnique({ where: { parentId_studentId: { parentId: ctx.actorId, studentId } } }))
}

// The class a student is (actively) enrolled in for the given academic year, or null.
export async function enrollmentFor(studentId: string, academicYearId: string) {
  return prisma.enrollment.findFirst({
    where: { studentId, academicYearId, status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: { class: { include: { grade: true, board: true } } },
  })
}
