import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader, login } from './helpers/auth'

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

// Phase T10 §1 — attendance is a "who is physically in front of the class right now" record, so a period
// covered by a T9 one-off `Substitution` should let the SUBSTITUTE (not just the entry's own regular
// teacher) mark that specific period's attendance — see server/src/modules/attendance/service.ts's
// assertWriteAttendance. The other Phase-18/19/25 consumers (syllabus pace, analytics, exam-clash) were
// judged NOT substitution-aware by design (documented in that phase's report), so this is the one real
// write-permission gap T10 found and fixed.
describe('T10 §1 — attendance write access reflects a same-day Substitution', () => {
  let substituteToken: string
  let timetableEntryId: string
  const subDate = '2026-08-03' // a Monday, comfortably inside fx's term and far from any other test's dates

  beforeAll(async () => {
    await request(app).post('/api/timetable/period-templates').set(authHeader(fx.tokens.superadmin)).send({
      name: 'T10 attendance-substitution day',
      periods: [{ idx: 0, label: 'P1', start: '09:00', end: '09:45', kind: 'class' }],
    })
    const sub = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin))
      .send({ role: 'teacher', name: 'T10 Substitute Teacher' })
    const subLogin = await login(app, sub.body.user.email, sub.body.password)
    substituteToken = subLogin.token

    const entries = await request(app).put('/api/timetable/entries').set(authHeader(fx.tokens.admin)).send({
      classId: fx.ids.classId, termId: fx.ids.termId,
      entries: [{ dayOfWeek: 1, periodIdx: 0, classSubjectId: fx.ids.classSubjectId, roomId: fx.ids.roomId, teacherId: fx.ids.teacherId }],
    })
    timetableEntryId = entries.body.items[0].id

    const created = await request(app).post('/api/timetable/substitutions').set(authHeader(fx.tokens.admin))
      .send({ timetableEntryId, date: subDate, substituteTeacherId: sub.body.user.id, reason: 'T10 fixture' })
    expect(created.status).toBe(201)
  })

  it('the substitute teacher can mark attendance for the covered period on the covered date', async () => {
    const res = await request(app).post('/api/attendance/sessions').set(authHeader(substituteToken))
      .send({ classId: fx.ids.classId, date: subDate, periodIdx: 0, records: [{ studentId: fx.ids.studentId, status: 'P' }] })
    expect(res.status).toBe(201)
  })

  it('a teacher with no relation to the class or the substitution still cannot mark it', async () => {
    const outsider = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin))
      .send({ role: 'teacher', name: 'T10 Unrelated Teacher' })
    const outsiderLogin = await login(app, outsider.body.user.email, outsider.body.password)
    const res = await request(app).post('/api/attendance/sessions').set(authHeader(outsiderLogin.token))
      .send({ classId: fx.ids.classId, date: subDate, periodIdx: 0, records: [{ studentId: fx.ids.studentId, status: 'P' }] })
    expect(res.status).toBe(403)
  })

  it('the substitute cannot mark attendance for the SAME entry on a different, non-covered date', async () => {
    const res = await request(app).post('/api/attendance/sessions').set(authHeader(substituteToken))
      .send({ classId: fx.ids.classId, date: '2026-08-10', periodIdx: 0, records: [{ studentId: fx.ids.studentId, status: 'P' }] })
    expect(res.status).toBe(403)
  })
})
