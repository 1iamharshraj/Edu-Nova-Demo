import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader } from './helpers/auth'

const app = createApp()
let fx: Fixture
const today = new Date().toISOString().slice(0, 10)

beforeAll(async () => {
  fx = await buildFixture(app)
})

describe('attendance: mark, summary, lock/unlock', () => {
  let sessionId: string

  it('a teacher of the class can create/mark a session', async () => {
    const res = await request(app).post('/api/attendance/sessions').set(authHeader(fx.tokens.teacher)).send({
      classId: fx.ids.classId, date: today,
      records: [{ studentId: fx.ids.studentId, status: 'P' }],
    })
    expect(res.status).toBe(201)
    sessionId = res.body.item.id
    expect(res.body.item.records).toHaveLength(1)
  })

  it('a teacher who does not teach this class cannot mark it', async () => {
    // Create an unrelated class with no teacher assignment, then try marking it as fx.teacher.
    const cls = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
      .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'Z' })
    const res = await request(app).post('/api/attendance/sessions').set(authHeader(fx.tokens.teacher)).send({
      classId: cls.body.item.id, date: today, records: [],
    })
    expect(res.status).toBe(403)
  })

  it('student cannot mark attendance', async () => {
    const res = await request(app).post('/api/attendance/sessions').set(authHeader(fx.tokens.student)).send({
      classId: fx.ids.classId, date: today, records: [{ studentId: fx.ids.studentId, status: 'P' }],
    })
    expect(res.status).toBe(403)
  })

  it('parent cannot mark attendance', async () => {
    const res = await request(app).post('/api/attendance/sessions').set(authHeader(fx.tokens.parent)).send({
      classId: fx.ids.classId, date: today, records: [{ studentId: fx.ids.studentId, status: 'P' }],
    })
    expect(res.status).toBe(403)
  })

  it('re-posting the same class/date replaces the record (change P -> A)', async () => {
    const res = await request(app).post('/api/attendance/sessions').set(authHeader(fx.tokens.teacher)).send({
      classId: fx.ids.classId, date: today,
      records: [{ studentId: fx.ids.studentId, status: 'A' }],
    })
    expect(res.status).toBe(200)
    expect(res.body.item.id).toBe(sessionId)
  })

  it('a non-admin cannot unlock a session', async () => {
    const res = await request(app).post(`/api/attendance/sessions/${sessionId}/unlock`).set(authHeader(fx.tokens.teacher))
    expect(res.status).toBe(403)
  })

  it('the teacher can lock the session', async () => {
    const res = await request(app).post(`/api/attendance/sessions/${sessionId}/lock`).set(authHeader(fx.tokens.teacher))
    expect(res.status).toBe(200)
    expect(res.body.item.lockedAt).toBeTruthy()
  })

  it('admin can unlock it again', async () => {
    const res = await request(app).post(`/api/attendance/sessions/${sessionId}/unlock`).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.item.lockedAt).toBeFalsy()
  })

  it('the student sees their own attendance summary for the term', async () => {
    const res = await request(app).get('/api/attendance/summary').query({ termId: fx.ids.termId, studentId: fx.ids.studentId }).set(authHeader(fx.tokens.student))
    expect(res.status).toBe(200)
  })

  it('a parent unrelated to the student cannot read that student\'s summary', async () => {
    // second student + unrelated parent
    const student2 = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'student', name: 'Unrelated Student', classId: fx.ids.classId })
    const res = await request(app).get('/api/attendance/summary').query({ termId: fx.ids.termId, studentId: student2.body.user.id }).set(authHeader(fx.tokens.parent))
    expect(res.status).toBe(403)
  })
})
