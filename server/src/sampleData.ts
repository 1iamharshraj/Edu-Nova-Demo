import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { toDate } from './lib/validate'
import { syncUserTitle } from './lib/titleSync'
import { SEED_USERS, SEED_TERMS, SUBJECTS, TIMESLOTS, DAYS } from './sampleConstants'
import type { PeriodDef } from './modules/periodTemplates/service'
import { loadPhase3 } from './samplePhase3'
import { loadPhase4, issueSeedCertificates } from './samplePhase4'
import { loadPhase5 } from './samplePhase5'
import { loadPhase6 } from './samplePhase6'
import { loadPhase7 } from './samplePhase7'
import { loadPhase8 } from './samplePhase8'
import { loadPhase9 } from './samplePhase9'

const YEAR = { label: '2025-26', start: '2025-06-01', end: '2026-05-31' }
// Fixed term ids matching the seed term list (`sampleConstants.ts`).
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

// Phase 2: the old timetable rotation (`makeTT`) used shift 0 / 2 / 4 for t1 / t2 / t3; each class adds its
// own index so no two classes hit the same subject (= teacher = room) in the same slot.
const TERM_SHIFT: Record<string, number> = { t1: 0, t2: 2, t3: 4 }
const TEMPLATE_NAME = 'Standard day'

// "Standard day" from the legacy TIMESLOTS: 8 class periods + 3 breaks with the old times.
function standardDayPeriods(): PeriodDef[] {
  let n = 0
  return TIMESLOTS.map((slot, i) => {
    if (slot.kind === 'break') {
      const [start, end] = slot.duration!.split(' - ')
      return { idx: i, label: slot.label, start, end, kind: 'break' as const }
    }
    const next = TIMESLOTS[i + 1]
    return { idx: i, label: `P${++n}`, start: slot.time, end: next ? next.time : '17:00', kind: 'class' as const }
  })
}

const roomKind = (name: string) => (/lab/i.test(name) ? 'lab' : name === 'Ground' ? 'ground' : 'classroom')
const splitLabel = (label: string) => {
  const [grade, section] = label.split('-')
  return { grade, section }
}

// Builds the full demo school (year, terms, boards, grades, curriculum, classes, subjects, rooms, users,
// enrollments, guardians, class-subjects) inside `schoolId`. Caller guarantees the school is empty.
export async function loadSampleData(schoolId: string) {
  const users = SEED_USERS

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
        dob: u.dob,
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

    for (const [i, t] of SEED_TERMS.entries()) {
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
    const classTeacher = new Map<string, string | null>()
    for (const [i, label] of CLASS_LABELS.entries()) {
      const teacher = teachers.find(t => t.class === label)
      classTeacher.set(label, teacher ? userId(teacher.id) : null)
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

    const roomIds = new Map<string, string>()
    for (const [i, name] of ROOM_NAMES.entries()) {
      const row = await tx.room.create({ data: { schoolId, name, kind: roomKind(name), createdAt: at(i) } })
      roomIds.set(name, row.id)
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
    const classSubjects = new Map<string, { id: string; teacherId: string | null }>()
    for (const label of CLASS_LABELS) {
      for (const s of SUBJECTS) {
        const teacher = teachers.find(t => t.subjects?.includes(s.name))
        const row = await tx.classSubject.create({
          data: { schoolId, classId: classIds.get(label)!, subjectId: s.id, teacherId: teacher ? userId(teacher.id) : null, periodsPerWeek: 5, createdAt: at(n++) },
        })
        classSubjects.set(`${label}:${s.id}`, { id: row.id, teacherId: row.teacherId })
      }
    }

    // Timetable: default period template + a rotated grid per class × term (Mon–Fri), all published.
    const periods = standardDayPeriods()
    await tx.periodTemplate.create({ data: { schoolId, name: TEMPLATE_NAME, isDefault: true, periods } })
    const classPeriods = periods.filter(p => p.kind === 'class')
    const taken = new Set<string>() // `${termId}|${day}:${idx}|teacher:<id>` and `|room:<id>` — skip anything that would clash
    const entries: { schoolId: string; classId: string; termId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId: string; teacherId: string | null }[] = []
    for (const t of SEED_TERMS) {
      for (const [ci, label] of CLASS_LABELS.entries()) {
        let rotation = (TERM_SHIFT[t.id] ?? 0) + ci
        for (let day = 1; day <= DAYS.length; day++) {
          for (const p of classPeriods) {
            const i = rotation++ % SUBJECTS.length
            const cs = classSubjects.get(`${label}:${SUBJECTS[i].id}`)!
            const roomId = roomIds.get(ROOM_NAMES[i])!
            const slot = `${t.id}|${day}:${p.idx}`
            const teacherKey = cs.teacherId ? `${slot}|teacher:${cs.teacherId}` : null
            const roomKey = `${slot}|room:${roomId}`
            if ((teacherKey && taken.has(teacherKey)) || taken.has(roomKey)) continue
            if (teacherKey) taken.add(teacherKey)
            taken.add(roomKey)
            entries.push({ schoolId, classId: classIds.get(label)!, termId: t.id, dayOfWeek: day, periodIdx: p.idx, classSubjectId: cs.id, roomId, teacherId: cs.teacherId })
          }
        }
      }
    }
    await tx.timetableEntry.createMany({ data: entries })
    await tx.timetablePublish.createMany({
      data: SEED_TERMS.flatMap(t => CLASS_LABELS.map(label => ({ schoolId, classId: classIds.get(label)!, termId: t.id }))),
    })

    // Phase 3: attendance, staff attendance, grade scale, assessments + marks, homework.
    await loadPhase3(tx, { schoolId, terms: SEED_TERMS, termDates: TERM_DATES, subjects: SUBJECTS, classIds, classTeacher, classSubjects, boardIds, users, userId })

    // Phase 4: applications, board registrations, parent verification.
    await loadPhase4(tx, { schoolId, yearId: year.id, boardIds, classIds, userId })

    // Phase 5: fee heads/structures/invoices/payments, salary structures, payslips.
    await loadPhase5(tx, { schoolId, terms: SEED_TERMS, termDates: TERM_DATES, classIds, userId })

    // Phase 6: leave types/requests, contracts, resignation, duties.
    await loadPhase6(tx, { schoolId, userId })

    // Phase 7: feed posts, conversations/messages, meetings, calendar events.
    await loadPhase7(tx, { schoolId, userId })

    // Phase 8: health, permission slips, achievements, disciplinary cases, call log, activities.
    await loadPhase8(tx, { schoolId, classIds, userId })

    // Phase 9: event highlights, one example AI tutor conversation.
    await loadPhase9(tx, { schoolId, classIds, userId })
  }, { timeout: 60_000 })

  const all = await prisma.user.findMany({ where: { schoolId }, select: { id: true, email: true } })
  await syncUserTitle(all.map(u => u.id))

  const byEmail = new Map(all.map(u => [u.email, u.id]))
  await issueSeedCertificates(schoolId, seedId => byEmail.get(users.find(u => u.id === seedId)!.email.toLowerCase())!)
}
