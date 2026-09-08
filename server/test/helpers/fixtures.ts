import bcrypt from 'bcryptjs'
import type { Express } from 'express'
import request from 'supertest'
import { prisma } from './db'
import { login, authHeader, type LoginResult } from './auth'

// A lean, hand-built "empty school → one class with people in it" fixture, built the same way a real
// admin would (through the API, as superadmin) so it doubles as an end-to-end smoke test of the
// academic-setup → enrollment path. Kept intentionally small — one board/grade/class/subject — because
// most test files only need *a* class to hang their module's tests off of, not a full school.

export const SUPERADMIN = { email: 'superadmin@fixture.test', password: 'principal123' }

export async function seedSuperadmin(schoolName = 'Fixture School') {
  const school = await prisma.school.create({ data: { name: schoolName } })
  await prisma.user.create({
    data: {
      id: 'fx-superadmin',
      schoolId: school.id,
      role: 'superadmin',
      name: 'Fixture Principal',
      email: SUPERADMIN.email,
      passwordHash: await bcrypt.hash(SUPERADMIN.password, 10),
      title: 'Principal',
      avatarHue: 200,
      verified: true,
    },
  })
  return school.id
}

export interface Fixture {
  schoolId: string
  ids: {
    yearId: string; termId: string; boardId: string; gradeId: string; classId: string
    subjectId: string; classSubjectId: string; roomId: string
    teacherId: string; staffId: string; adminId: string; parentId: string; studentId: string
  }
  tokens: Record<'superadmin' | 'admin' | 'staff' | 'teacher' | 'parent' | 'student', string>
  logins: Record<'superadmin' | 'admin' | 'staff' | 'teacher' | 'parent' | 'student', LoginResult>
}

async function createUser(app: Express, token: string, body: Record<string, unknown>) {
  const res = await request(app).post('/api/users').set(authHeader(token)).send(body)
  if (res.status !== 201) throw new Error(`create user failed: ${res.status} ${JSON.stringify(res.body)}`)
  return res.body.user as { id: string; email: string }
}

// Builds: current year + current term, one board, one grade, one class (capacity 2), one subject wired
// into the class with a teacher, a room, plus one each of teacher/staff/admin/parent/student, the
// student enrolled in the class and linked to the parent as a ward.
export async function buildFixture(app: Express): Promise<Fixture> {
  const schoolId = await seedSuperadmin()
  const superLogin = await login(app, SUPERADMIN.email, SUPERADMIN.password)
  const sa = superLogin.token

  const year = await request(app).post('/api/academic/years').set(authHeader(sa))
    .send({ label: '2026-27', startDate: '2026-06-01', endDate: '2027-05-31' })
  const yearId = year.body.item.id as string

  const term = await request(app).post('/api/academic/terms').set(authHeader(sa))
    .send({ academicYearId: yearId, name: 'Term 1', startDate: '2026-06-01', endDate: '2026-09-30' })
  const termId = term.body.item.id as string

  const board = await request(app).post('/api/academic/boards').set(authHeader(sa)).send({ name: 'Central Board', code: 'CBSE' })
  const boardId = board.body.item.id as string

  const grade = await request(app).post('/api/academic/grades').set(authHeader(sa)).send({ label: 'VIII' })
  const gradeId = grade.body.item.id as string

  const subject = await request(app).post('/api/academic/subjects').set(authHeader(sa)).send({ name: 'Mathematics', code: 'MATH', color: '#4f46e5' })
  const subjectId = subject.body.item.id as string

  const room = await request(app).post('/api/academic/rooms').set(authHeader(sa)).send({ name: 'C-101', kind: 'classroom', capacity: 40 })
  const roomId = room.body.item.id as string

  const cls = await request(app).post('/api/academic/classes').set(authHeader(sa))
    .send({ academicYearId: yearId, boardId, gradeId, section: 'A', capacity: 2 })
  const classId = cls.body.item.id as string

  const teacher = await createUser(app, sa, { role: 'teacher', name: 'Kavya Rao' })
  const staff = await createUser(app, sa, { role: 'staff', name: 'Sunita Staff' })
  const admin = await createUser(app, sa, { role: 'admin', name: 'Arjun Admin' })
  const student = await createUser(app, sa, { role: 'student', name: 'Ishaan Student', classId })
  const parent = await createUser(app, sa, { role: 'parent', name: 'Meenakshi Parent', studentIds: [student.id] })

  const classSubject = await request(app).post('/api/academic/class-subjects').set(authHeader(sa))
    .send({ classId, subjectId, teacherId: teacher.id, periodsPerWeek: 5 })
  const classSubjectId = classSubject.body.item.id as string

  // Kavya is both the subject teacher AND the class teacher of VIII-A — several Phase 8 rules (health
  // record visibility, discipline reporting) key off "class teacher" specifically, not "teaches a subject".
  await request(app).patch(`/api/academic/classes/${classId}`).set(authHeader(sa)).send({ classTeacherId: teacher.id })

  const [teacherLogin, staffLogin, adminLogin, parentLogin, studentLogin] = await Promise.all([
    login(app, teacher.email, 'teacher123'),
    login(app, staff.email, 'staff123'),
    login(app, admin.email, 'admin123'),
    login(app, parent.email, 'parent123'),
    login(app, student.email, 'student123'),
  ])

  return {
    schoolId,
    ids: { yearId, termId, boardId, gradeId, classId, subjectId, classSubjectId, roomId, teacherId: teacher.id, staffId: staff.id, adminId: admin.id, parentId: parent.id, studentId: student.id },
    tokens: { superadmin: sa, admin: adminLogin.token, staff: staffLogin.token, teacher: teacherLogin.token, parent: parentLogin.token, student: studentLogin.token },
    logins: { superadmin: superLogin, admin: adminLogin, staff: staffLogin, teacher: teacherLogin, parent: parentLogin, student: studentLogin },
  }
}
