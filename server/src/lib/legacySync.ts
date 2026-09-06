import { prisma } from '../prisma'

// Recomputes the legacy denormalised User columns (class/section/roll/board/subjects/parentEmail/wards/title)
// from the real academic entities. See "Legacy field derivation" in phase-0-1-contract.md and phase-1b.

// Class labels stay `X-A` — the board is a separate field, never baked into the label.
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

// Users whose legacy fields depend on the given classes: enrolled students, class teachers, subject teachers.
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

export async function syncLegacyUserFields(userIds: string[]) {
  const ids = new Set(userIds.filter(Boolean))
  if (ids.size === 0) return

  // Parents' wards/title depend on their students, so expand students → their guardians.
  const parents = await prisma.guardian.findMany({ where: { studentId: { in: [...ids] } }, select: { parentId: true } })
  parents.forEach(g => ids.add(g.parentId))

  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } } })

  for (const u of users) {
    const data: Record<string, unknown> = {}

    if (u.role === 'student') {
      const enr = await primaryEnrollment(u.id)
      const guardian = await prisma.guardian.findFirst({ where: { studentId: u.id }, orderBy: { createdAt: 'asc' }, include: { parent: true } })
      const cls = enr ? label(enr.class) : null
      data.class = cls
      data.section = enr?.class.section ?? null
      data.roll = enr?.rollNo ?? null
      data.board = enr?.class.board.code ?? null
      data.parentEmail = guardian?.parent.email ?? null
      if (cls && enr?.rollNo && isDerivedTitle(u.role, u.title)) data.title = `Class ${cls} · Roll ${enr.rollNo}`
    } else if (u.role === 'teacher') {
      const teaching = await prisma.classSubject.findMany({ where: { teacherId: u.id }, include: { subject: true }, orderBy: { subject: { createdAt: 'asc' } } })
      const subjects = [...new Set(teaching.map(t => t.subject.name))]
      const cls = await prisma.class.findFirst({ where: { classTeacherId: u.id }, include: classRefs, orderBy: { createdAt: 'asc' } })
      data.subjects = subjects
      data.class = cls ? label(cls) : null
      if (subjects.length && cls && isDerivedTitle(u.role, u.title)) data.title = `${subjects.join(', ')} · Class Teacher ${label(cls)}`
    } else if (u.role === 'parent') {
      const links = await prisma.guardian.findMany({ where: { parentId: u.id }, include: { student: true }, orderBy: { createdAt: 'asc' } })
      const wards = links.map(l => l.student.name)
      data.wards = wards.length ? wards.join(', ') : null
      if (links.length && isDerivedTitle(u.role, u.title)) {
        const enr = await primaryEnrollment(links[0].studentId)
        data.title = `Parent of ${wards[0]}${enr ? ` · ${label(enr.class)}` : ''}`
      }
    } else {
      continue
    }

    await prisma.user.update({ where: { id: u.id }, data })
  }
}
