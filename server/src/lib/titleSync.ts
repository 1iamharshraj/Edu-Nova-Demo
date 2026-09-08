import { prisma } from '../prisma'

// Keeps `User.title` (the short display line under a person's name — "Class X-A · Roll 12",
// "Mathematics · Class Teacher X-A", "Parent of Aarav Sharma") in sync with the real academic
// entities whenever they change. This used to also denormalise a handful of legacy `User` columns
// (class/section/roll/board/subjects/parentEmail/wards) — those columns are gone (Phase 10 cleanup),
// but the title-refresh behavior itself is real and still used across People/HR/academic modules.

const label = (c: { grade: { label: string }; section: string }) => `${c.grade.label}-${c.section}`
const classRefs = { grade: true, board: true } as const

// A title is "custom" if it neither matches the derived pattern for the role nor the onboarding default.
function isDerivedTitle(role: string, title: string) {
  if (!title || title === `${role} · onboarded`) return true
  if (role === 'student') return /^Class .+ · Roll .+$/.test(title)
  if (role === 'teacher') return /^.+ · Class Teacher .+$/.test(title)
  if (role === 'parent') return /^Parent of .+$/.test(title)
  return false
}

// Active enrollment in the current year, else the most recent one.
async function primaryEnrollment(studentId: string) {
  const rows = await prisma.enrollment.findMany({
    where: { studentId },
    include: { class: { include: classRefs }, academicYear: true },
    orderBy: [{ academicYear: { startDate: 'desc' } }, { createdAt: 'desc' }],
  })
  return rows.find(e => e.status === 'active' && e.academicYear.isCurrent) ?? rows[0] ?? null
}

// Users whose title depends on the given classes: enrolled students, class teachers, subject teachers.
export async function usersTouchingClasses(classIds: string[]): Promise<string[]> {
  if (classIds.length === 0) return []
  const [classes, enrollments, classSubjects] = await Promise.all([
    prisma.class.findMany({ where: { id: { in: classIds } }, select: { classTeacherId: true } }),
    prisma.enrollment.findMany({ where: { classId: { in: classIds } }, select: { studentId: true } }),
    prisma.classSubject.findMany({ where: { classId: { in: classIds } }, select: { teacherId: true } }),
  ])
  return [
    ...classes.map(c => c.classTeacherId),
    ...enrollments.map(e => e.studentId),
    ...classSubjects.map(cs => cs.teacherId),
  ].filter((x): x is string => !!x)
}

export async function syncUserTitle(userIds: string[]) {
  const ids = new Set(userIds.filter(Boolean))
  if (ids.size === 0) return

  // Parents' titles depend on their students, so expand students → their guardians.
  const parents = await prisma.guardian.findMany({ where: { studentId: { in: [...ids] } }, select: { parentId: true } })
  parents.forEach(g => ids.add(g.parentId))

  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } } })

  for (const u of users) {
    if (!isDerivedTitle(u.role, u.title)) continue
    let title: string | null = null

    if (u.role === 'student') {
      const enr = await primaryEnrollment(u.id)
      if (enr?.rollNo) title = `Class ${label(enr.class)} · Roll ${enr.rollNo}`
    } else if (u.role === 'teacher') {
      const teaching = await prisma.classSubject.findMany({ where: { teacherId: u.id }, include: { subject: true }, orderBy: { subject: { createdAt: 'asc' } } })
      const subjects = [...new Set(teaching.map(t => t.subject.name))]
      const cls = await prisma.class.findFirst({ where: { classTeacherId: u.id }, include: classRefs, orderBy: { createdAt: 'asc' } })
      if (subjects.length && cls) title = `${subjects.join(', ')} · Class Teacher ${label(cls)}`
    } else if (u.role === 'parent') {
      const links = await prisma.guardian.findMany({ where: { parentId: u.id }, include: { student: true }, orderBy: { createdAt: 'asc' } })
      if (links.length) {
        const enr = await primaryEnrollment(links[0].studentId)
        title = `Parent of ${links[0].student.name}${enr ? ` · ${label(enr.class)}` : ''}`
      }
    } else {
      continue
    }

    if (title && title !== u.title) await prisma.user.update({ where: { id: u.id }, data: { title } })
  }
}
