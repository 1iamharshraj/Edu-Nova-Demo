import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { toDate } from './lib/validate'
import { syncLegacyUserFields } from './lib/legacySync'
// The demo school is built from the same seed the frontend was designed around.
import { seedDB, SUBJECTS } from '../../src/lib/data'

const YEAR = { label: '2025-26', start: '2025-06-01', end: '2026-05-31' }
// Fixed term ids so the JSON blob (timetable / marks keyed by term id) still lines up.
const TERM_DATES: Record<string, [string, string]> = {
  t1: ['2025-06-01', '2025-09-30'],
  t2: ['2025-10-01', '2026-01-31'],
  t3: ['2026-02-01', '2026-05-31'],
}
// Phase 1b: two boards, a I–XII grade ladder, no streams. All demo classes sit under CBSE.
const BOARDS = [
  { code: 'CBSE', name: 'Central Board of Secondary Education' },
  { code: 'Matric', name: 'Matriculation (State Board)' },
]
const GRADE_LABELS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
// The six seed subjects are taught (kind core) in these board/grade combinations.
const CURRICULUM: [board: string, grade: string][] = [['CBSE', 'IX'], ['CBSE', 'X'], ['Matric', 'X']]
const CLASS_LABELS = ['X-A', 'X-B', 'IX-A', 'IX-B']
const CLASS_BOARD = 'CBSE'
const ROOM_NAMES = ['A-201', 'Lab-2', 'Lab-1', 'B-104', 'CS-Lab', 'Ground']

const roomKind = (name: string) => (/lab/i.test(name) ? 'lab' : name === 'Ground' ? 'ground' : 'classroom')
const splitLabel = (label: string) => {
  const [grade, section] = label.split('-')
  return { grade, section }
}

// Builds the full demo school (year, terms, boards, grades, curriculum, classes, subjects, rooms, users,
// enrollments, guardians, class-subjects, JSON blob) inside `schoolId`. Caller guarantees the school is empty.
export async function loadSampleData(schoolId: string) {
  const db = seedDB()
  const { users, ...blob } = db

  // bcrypt is slow — hash outside the transaction.
  const hashes = new Map<string, string>()
  for (const u of users) hashes.set(u.id, await bcrypt.hash(u.password, 10))

  // Explicit createdAt offsets keep list ordering identical to the seed arrays.
  const base = Date.now()
  const at = (i: number) => new Date(base + i)

  await prisma.$transaction(async tx => {
    // Users (upsert by email so an existing principal / requester survives with its password).
    for (const u of users) {
      const profile = {
        name: u.name,
        title: u.title,
        avatarHue: u.avatarHue,
        verified: u.verified,
        department: u.department,
        designation: u.designation,
        reportsTo: u.reportsTo,
        joinDate: u.joinDate,
        phone: u.phone,
        board: u.board,
        dob: u.dob,
        salary: u.salary,
        contract: u.contract as object | undefined,
        resignation: u.resignation as object | undefined,
      }
      await tx.user.upsert({
        where: { email: u.email.toLowerCase() },
        update: profile,
        create: { id: u.id, schoolId, role: u.role, email: u.email.toLowerCase(), passwordHash: hashes.get(u.id)!, ...profile },
      })
    }
    const byEmail = new Map((await tx.user.findMany({ where: { schoolId } })).map(u => [u.email, u]))
    const userId = (seedId: string) => byEmail.get(users.find(u => u.id === seedId)!.email.toLowerCase())!.id
    const teachers = users.filter(u => u.role === 'teacher')

    const year = await tx.academicYear.create({
      data: { schoolId, label: YEAR.label, startDate: toDate(YEAR.start), endDate: toDate(YEAR.end), isCurrent: true },
    })

    for (const [i, t] of db.terms.entries()) {
      const [start, end] = TERM_DATES[t.id]
      await tx.term.create({
        data: { id: t.id, schoolId, academicYearId: year.id, name: t.name, startDate: toDate(start), endDate: toDate(end), isCurrent: !!t.current, createdAt: at(i) },
      })
    }

    for (const [i, s] of SUBJECTS.entries()) {
      await tx.subject.create({ data: { id: s.id, schoolId, name: s.name, code: s.id.toUpperCase(), color: s.color, createdAt: at(i) } })
    }

    const boardIds = new Map<string, string>()
    for (const [i, b] of BOARDS.entries()) {
      const row = await tx.board.create({ data: { schoolId, name: b.name, code: b.code, createdAt: at(i) } })
      boardIds.set(b.code, row.id)
    }

    const gradeIds = new Map<string, string>()
    for (const [i, label] of GRADE_LABELS.entries()) {
      const row = await tx.grade.create({ data: { schoolId, label, order: i + 1, createdAt: at(i) } })
      gradeIds.set(label, row.id)
    }

    let k = 0
    for (const [board, grade] of CURRICULUM) {
      for (const s of SUBJECTS) {
        await tx.curriculumSubject.create({
          data: { schoolId, boardId: boardIds.get(board)!, gradeId: gradeIds.get(grade)!, subjectId: s.id, kind: 'core', createdAt: at(k++) },
        })
      }
    }

    const classIds = new Map<string, string>()
    for (const [i, label] of CLASS_LABELS.entries()) {
      const teacher = teachers.find(t => t.class === label)
      const { grade, section } = splitLabel(label)
      const c = await tx.class.create({
        data: {
          schoolId,
          academicYearId: year.id,
          boardId: boardIds.get(CLASS_BOARD)!,
          gradeId: gradeIds.get(grade)!,
          section,
          classTeacherId: teacher ? userId(teacher.id) : null,
          createdAt: at(i),
        },
      })
      classIds.set(label, c.id)
    }

    for (const [i, name] of ROOM_NAMES.entries()) {
      await tx.room.create({ data: { schoolId, name, kind: roomKind(name), createdAt: at(i) } })
    }

    for (const s of users.filter(u => u.role === 'student' && u.class)) {
      const classId = classIds.get(s.class!)
      if (!classId) continue
      await tx.enrollment.create({ data: { schoolId, studentId: userId(s.id), classId, academicYearId: year.id, rollNo: s.roll ?? null } })
    }

    for (const p of users.filter(u => u.role === 'parent')) {
      for (const s of users.filter(u => u.role === 'student' && u.parentEmail?.toLowerCase() === p.email.toLowerCase())) {
        await tx.guardian.create({ data: { schoolId, parentId: userId(p.id), studentId: userId(s.id), relation: 'parent' } })
      }
    }

    let n = 0
    for (const label of CLASS_LABELS) {
      for (const s of SUBJECTS) {
        const teacher = teachers.find(t => t.subjects?.includes(s.name))
        await tx.classSubject.create({
          data: { schoolId, classId: classIds.get(label)!, subjectId: s.id, teacherId: teacher ? userId(teacher.id) : null, periodsPerWeek: 5, createdAt: at(n++) },
        })
      }
    }

    await tx.schoolData.upsert({
      where: { schoolId },
      create: { schoolId, data: blob as object },
      update: { data: blob as object },
    })
  }, { timeout: 60_000 })

  const all = await prisma.user.findMany({ where: { schoolId }, select: { id: true } })
  await syncLegacyUserFields(all.map(u => u.id))
}
