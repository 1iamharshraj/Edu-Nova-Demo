// Shared class/roster/guardian scoping helpers for the exams/academics module batch — syllabus,
// assessments, exams, homework, attendance, feed, calendar, meetings, slips, achievements, health,
// highlights. Mirrors server/src/lib/scope.ts's contract closely enough that each module file below reads
// like the real service, without pulling in a cross-batch shared file (every other batch hand-rolls the
// same handful of helpers locally too — see modules/leave.ts's wardsOf/teacherClassIds for the precedent).
// Not a route module — nothing here calls `route()`, so it is imported directly by the files that need it
// and never needs a side-effect import in index.ts.

import { table, type Row } from '../store'
import { notFound, forbidden } from '../http'
import type { Actor } from '../router'

const ADMIN_ROLES = ['admin', 'superadmin']
export function isAdmin(role: string) { return ADMIN_ROLES.includes(role) }
export function isStaff(role: string) { return ['staff', ...ADMIN_ROLES].includes(role) }

export function getClass(actor: Actor, classId: string): Row {
  const row = table('Class').find(c => c.id === classId && c.schoolId === actor.schoolId)
  if (!row) throw notFound('Class')
  return row
}

export function getClassSubject(actor: Actor, id: string): Row {
  const row = table('ClassSubject').find(c => c.id === id && c.schoolId === actor.schoolId)
  if (!row) throw notFound('Class subject')
  return row
}

export function getTerm(actor: Actor, id: string): Row {
  const row = table('Term').find(t => t.id === id && t.schoolId === actor.schoolId)
  if (!row) throw notFound('Term')
  return row
}

export function rosterOf(classId: string): { id: string; name: string; rollNo?: string }[] {
  const enrollments = table('Enrollment').filter(e => e.classId === classId && e.status === 'active')
  return enrollments.map(e => {
    const u = table('User').find(x => x.id === e.studentId)
    return { id: String(e.studentId), name: String(u?.name ?? 'Student'), rollNo: e.rollNo as string | undefined }
  })
}

export function teacherClassIds(teacherId: string): string[] {
  const owns = table('Class').filter(c => c.classTeacherId === teacherId).map(c => String(c.id))
  const teaches = table('ClassSubject').filter(cs => cs.teacherId === teacherId).map(cs => String(cs.classId))
  return [...new Set([...owns, ...teaches])]
}

export function studentClassIds(studentId: string): string[] {
  return table('Enrollment').filter(e => e.studentId === studentId && e.status === 'active').map(e => String(e.classId))
}

export function wardsOf(parentId: string): string[] {
  return table('Guardian').filter(g => g.parentId === parentId).map(g => String(g.studentId))
}

export function wardClassIds(actor: Actor): string[] {
  return [...new Set(wardsOf(actor.userId).flatMap(studentClassIds))]
}

export function isGuardianOf(actor: Actor, studentId: string): boolean {
  return table('Guardian').some(g => g.parentId === actor.userId && g.studentId === studentId)
}

export function classTeacherOfStudent(studentId: string): string | null {
  const enr = table('Enrollment').filter(e => e.studentId === studentId && e.status === 'active')
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
  if (!enr) return null
  const cls = table('Class').find(c => c.id === enr.classId)
  return cls ? (String(cls.classTeacherId ?? '') || null) : null
}

export function isClassTeacherOfStudent(actor: Actor, studentId: string): boolean {
  return classTeacherOfStudent(studentId) === actor.userId
}

/** null -> unrestricted (staff/admin); [] -> nobody visible; ids -> exactly those. */
export function visibleStudentIds(actor: Actor): string[] | null {
  if (isStaff(actor.role)) return null
  if (actor.role === 'student') return [actor.userId]
  if (actor.role === 'parent') return wardsOf(actor.userId)
  return []
}

export function canViewClass(actor: Actor, classId: string): boolean {
  if (isStaff(actor.role)) return true
  if (actor.role === 'teacher') return teacherClassIds(actor.userId).includes(classId)
  if (actor.role === 'student') return studentClassIds(actor.userId).includes(classId)
  if (actor.role === 'parent') return wardClassIds(actor).includes(classId)
  return false
}

export function assertViewClass(actor: Actor, classId: string) {
  if (!canViewClass(actor, classId)) throw forbidden('You cannot view this class')
}

export function canWriteClassSubject(actor: Actor, classSubjectId: string): boolean {
  if (isStaff(actor.role)) return true
  const cs = table('ClassSubject').find(c => c.id === classSubjectId)
  if (!cs) return false
  if (cs.teacherId === actor.userId) return true
  const cls = table('Class').find(c => c.id === cs.classId)
  return !!cls && cls.classTeacherId === actor.userId
}

export function assertWriteClassSubject(actor: Actor, classSubjectId: string) {
  if (!canWriteClassSubject(actor, classSubjectId)) throw forbidden('You do not teach this subject in this class')
}

export function assertOnRoster(classId: string, studentIds: string[]) {
  const roster = new Set(rosterOf(classId).map(s => s.id))
  const bad = studentIds.filter(id => !roster.has(id))
  if (bad.length) throw forbidden(`Student(s) not on this class's roster: ${bad.join(', ')}`)
}

export function enrollmentFor(studentId: string, academicYearId: string): Row | undefined {
  return table('Enrollment').find(e => e.studentId === studentId && e.academicYearId === academicYearId && e.status === 'active')
}

export function assertViewStudent(actor: Actor, studentId: string) {
  if (isStaff(actor.role)) return
  if (actor.userId === studentId) return
  if (isGuardianOf(actor, studentId)) return
  if (actor.role === 'teacher') {
    const classes = new Set(teacherClassIds(actor.userId));
    if (studentClassIds(studentId).some(c => classes.has(c))) return
  }
  throw forbidden('You cannot view this student')
}
