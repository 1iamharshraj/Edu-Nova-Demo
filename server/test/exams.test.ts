import { describe, it, expect, beforeAll } from 'vitest'
import type { Express } from 'express'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader, login } from './helpers/auth'

const app = createApp()
let fx: Fixture

async function createUser(body: Record<string, unknown>) {
  const res = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send(body)
  if (res.status !== 201) throw new Error(`create user failed: ${res.status} ${JSON.stringify(res.body)}`)
  return { ...(res.body.user as { id: string; email: string }), password: res.body.password as string }
}

let secondStudentId: string
let smallRoomId: string
let secondTeacherId: string
let secondTeacherToken: string
let mathsAssessmentId: string

beforeAll(async () => {
  fx = await buildFixture(app)

  // A second student in VIII-A (fixture class has capacity 2) — needed to exceed a tiny room in the
  // seating-capacity test below.
  const student2 = await createUser({ role: 'student', name: 'Second Student', classId: fx.ids.classId })
  secondStudentId = student2.id

  const room = await request(app).post('/api/academic/rooms').set(authHeader(fx.tokens.superadmin)).send({ name: 'Tiny Hall', kind: 'hall', capacity: 1 })
  smallRoomId = room.body.item.id

  const teacher2 = await createUser({ role: 'teacher', name: 'Free Teacher' })
  secondTeacherId = teacher2.id
  secondTeacherToken = (await login(app as unknown as Express, teacher2.email, teacher2.password)).token

  const assessment = await request(app).post('/api/assessments').set(authHeader(fx.tokens.admin))
    .send({ classSubjectId: fx.ids.classSubjectId, termId: fx.ids.termId, name: 'Maths Final', maxMarks: 100, date: '2026-07-10' })
  mathsAssessmentId = assessment.body.item.id
})

describe('exams item 1: seating plans', () => {
  it('rejects a plan whose headcount exceeds the room capacity', async () => {
    const res = await request(app).post('/api/exams/seating-plans').set(authHeader(fx.tokens.admin))
      .send({ assessmentIds: [mathsAssessmentId], date: '2026-07-10', roomId: smallRoomId })
    expect(res.status).toBe(400)
    expect(res.body.details.required).toBe(2)
    expect(res.body.details.capacity).toBe(1)
  })

  it('generates a seating plan that fits the room, one seat per enrolled student, no duplicates', async () => {
    const res = await request(app).post('/api/exams/seating-plans').set(authHeader(fx.tokens.admin))
      .send({ assessmentIds: [mathsAssessmentId], date: '2026-07-10', roomId: fx.ids.roomId })
    expect(res.status).toBe(201)
    const seats = res.body.item.seats as { studentId: string; seatNumber: number }[]
    expect(seats).toHaveLength(2)
    expect(new Set(seats.map(s => s.seatNumber)).size).toBe(2)
    expect(new Set(seats.map(s => s.studentId))).toEqual(new Set([fx.ids.studentId, secondStudentId]))

    const get = await request(app).get(`/api/exams/seating-plans/${res.body.item.id}`).set(authHeader(fx.tokens.staff))
    expect(get.status).toBe(200)
    expect(get.body.item.roomName).toBe('C-101')

    const pdf = await request(app).get(`/api/exams/seating-plans/${res.body.item.id}/pdf`).set(authHeader(fx.tokens.staff))
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toBe('application/pdf')
  })

  it('teacher cannot generate a seating plan', async () => {
    const res = await request(app).post('/api/exams/seating-plans').set(authHeader(fx.tokens.teacher))
      .send({ assessmentIds: [mathsAssessmentId], date: '2026-07-10', roomId: fx.ids.roomId })
    expect(res.status).toBe(403)
  })
})

describe('exams item 2: invigilation roster', () => {
  it('auto-assign suggests the free teacher, not the subject teacher who is examined out', async () => {
    const res = await request(app).post('/api/exams/invigilation/auto-assign').set(authHeader(fx.tokens.admin))
      .send({ assessmentIds: [mathsAssessmentId], date: '2026-07-10' })
    expect(res.status).toBe(200)
    const ids = res.body.suggestions.map((s: { teacherId: string }) => s.teacherId)
    expect(ids).toContain(secondTeacherId)
    expect(ids).not.toContain(fx.ids.teacherId)
  })

  it('does not auto-commit — no duty exists until a manual create', async () => {
    const res = await request(app).get('/api/exams/invigilation').query({ date: '2026-07-10' }).set(authHeader(fx.tokens.admin))
    expect(res.body.items).toHaveLength(0)
  })

  let dutyId: string
  it('staff/admin creates the duty manually', async () => {
    const res = await request(app).post('/api/exams/invigilation').set(authHeader(fx.tokens.admin))
      .send({ assessmentId: mathsAssessmentId, roomId: fx.ids.roomId, teacherId: secondTeacherId, date: '2026-07-10' })
    expect(res.status).toBe(201)
    expect(res.body.item.status).toBe('Assigned')
    dutyId = res.body.item.id
  })

  it('double-booking the same teacher on the same date is rejected', async () => {
    const res = await request(app).post('/api/exams/invigilation').set(authHeader(fx.tokens.admin))
      .send({ assessmentId: mathsAssessmentId, roomId: fx.ids.roomId, teacherId: secondTeacherId, date: '2026-07-10' })
    expect(res.status).toBe(409)
  })

  it('a different teacher cannot confirm someone else’s duty', async () => {
    const res = await request(app).post(`/api/exams/invigilation/${dutyId!}/confirm`).set(authHeader(fx.tokens.teacher))
    expect(res.status).toBe(403)
  })

  it('the assigned teacher confirms their own duty', async () => {
    const res = await request(app).post(`/api/exams/invigilation/${dutyId!}/confirm`).set(authHeader(secondTeacherToken))
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('Confirmed')
  })
})

describe('exams item 3: hall ticket', () => {
  it('the student can download their own hall ticket', async () => {
    const res = await request(app).get(`/api/exams/hall-ticket/${fx.ids.studentId}`).query({ termId: fx.ids.termId }).set(authHeader(fx.tokens.student))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
  })

  it('staff can download any student’s hall ticket', async () => {
    const res = await request(app).get(`/api/exams/hall-ticket/${fx.ids.studentId}`).query({ termId: fx.ids.termId }).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(200)
  })

  it('a parent cannot download a hall ticket for a student who is not their ward', async () => {
    const res = await request(app).get(`/api/exams/hall-ticket/${secondStudentId}`).query({ termId: fx.ids.termId }).set(authHeader(fx.tokens.parent))
    expect(res.status).toBe(403)
  })
})

describe('exams item 4: board-exam readiness', () => {
  it('staff sees one row per roster student', async () => {
    const res = await request(app).get('/api/exams/board-readiness').query({ classId: fx.ids.classId }).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(200)
    expect(res.body.students).toHaveLength(2)
    expect(res.body.students.map((s: { studentId: string }) => s.studentId)).toEqual(expect.arrayContaining([fx.ids.studentId, secondStudentId]))
    expect(res.body.students[0]).toHaveProperty('needsAttention')
    expect(res.body.students[0]).toHaveProperty('registrationStatus')
  })

  it('student cannot view the readiness dashboard', async () => {
    const res = await request(app).get('/api/exams/board-readiness').query({ classId: fx.ids.classId }).set(authHeader(fx.tokens.student))
    expect(res.status).toBe(403)
  })
})

describe('exams item 5: elective exam-schedule clash detection', () => {
  let economicsClassSubjectId: string

  beforeAll(async () => {
    const subject = await request(app).post('/api/academic/subjects').set(authHeader(fx.tokens.superadmin))
      .send({ name: 'Economics', code: 'ECO', color: '#16a34a' })
    const economicsSubjectId = subject.body.item.id as string

    // Mark both Mathematics and Economics as elective in the curriculum for this board/grade — the schema
    // has no per-student elective-pick model (Enrollment/ClassSubject are class-wide), so "a student
    // enrolled in two electives" is read as "their class offers two elective ClassSubjects" (see
    // modules/assessments/service.ts#checkElectiveClash).
    await request(app).post('/api/academic/curriculum').set(authHeader(fx.tokens.superadmin))
      .send({ boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, subjectId: fx.ids.subjectId, kind: 'elective' })
    await request(app).post('/api/academic/curriculum').set(authHeader(fx.tokens.superadmin))
      .send({ boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, subjectId: economicsSubjectId, kind: 'elective' })

    const cs = await request(app).post('/api/academic/class-subjects').set(authHeader(fx.tokens.superadmin))
      .send({ classId: fx.ids.classId, subjectId: economicsSubjectId, teacherId: secondTeacherId, periodsPerWeek: 4 })
    economicsClassSubjectId = cs.body.item.id
  })

  it('scheduling an elective assessment on a date that clashes with another elective assessment is rejected 409 with conflicts[]', async () => {
    const first = await request(app).post('/api/assessments').set(authHeader(fx.tokens.admin))
      .send({ classSubjectId: economicsClassSubjectId, termId: fx.ids.termId, name: 'Economics Midterm', maxMarks: 50, date: '2026-08-01' })
    expect(first.status).toBe(201)

    const clash = await request(app).post('/api/assessments').set(authHeader(fx.tokens.admin))
      .send({ classSubjectId: fx.ids.classSubjectId, termId: fx.ids.termId, name: 'Maths Midterm', maxMarks: 50, date: '2026-08-01' })
    expect(clash.status).toBe(409)
    expect(clash.body.conflicts).toBeInstanceOf(Array)
    expect(clash.body.conflicts[0].rule).toBe('elective')
    expect(clash.body.conflicts[0].date).toBe('2026-08-01')
  })

  it('a different date for the same two electives is accepted', async () => {
    const res = await request(app).post('/api/assessments').set(authHeader(fx.tokens.admin))
      .send({ classSubjectId: fx.ids.classSubjectId, termId: fx.ids.termId, name: 'Maths Midterm', maxMarks: 50, date: '2026-08-02' })
    expect(res.status).toBe(201)
  })

  it('patching an assessment’s date onto an existing elective clash is also rejected', async () => {
    const target = await request(app).post('/api/assessments').set(authHeader(fx.tokens.admin))
      .send({ classSubjectId: fx.ids.classSubjectId, termId: fx.ids.termId, name: 'Maths Retest', maxMarks: 50, date: '2026-08-05' })
    expect(target.status).toBe(201)

    const patch = await request(app).patch(`/api/assessments/${target.body.item.id}`).set(authHeader(fx.tokens.admin))
      .send({ date: '2026-08-01' })
    expect(patch.status).toBe(409)
    expect(patch.body.conflicts[0].rule).toBe('elective')
  })
})
