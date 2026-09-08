import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader } from './helpers/auth'

const app = createApp()
let fx: Fixture
let secondClassId: string
let secondClassSubjectId: string

beforeAll(async () => {
  fx = await buildFixture(app)
  // A timetable grid needs a period template (Academic Setup → Periods) before any entry can be saved.
  await request(app).post('/api/timetable/period-templates').set(authHeader(fx.tokens.superadmin)).send({
    name: 'Standard day',
    periods: [
      { idx: 0, label: 'P1', start: '09:00', end: '09:45', kind: 'class' },
      { idx: 1, label: 'P2', start: '09:45', end: '10:30', kind: 'class' },
    ],
  })
  // A second section (VIII-B) sharing the same teacher, to exercise clash detection.
  const cls = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
    .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'B', capacity: 2 })
  secondClassId = cls.body.item.id
  const cs = await request(app).post('/api/academic/class-subjects').set(authHeader(fx.tokens.superadmin))
    .send({ classId: secondClassId, subjectId: fx.ids.subjectId, teacherId: fx.ids.teacherId, periodsPerWeek: 5 })
  secondClassSubjectId = cs.body.item.id
})

describe('timetable RBAC', () => {
  it('teacher cannot write timetable entries', async () => {
    const res = await request(app).put('/api/timetable/entries').set(authHeader(fx.tokens.teacher))
      .send({ classId: fx.ids.classId, termId: fx.ids.termId, entries: [] })
    expect(res.status).toBe(403)
  })
  it('student cannot publish', async () => {
    const res = await request(app).post('/api/timetable/publish').set(authHeader(fx.tokens.student))
      .send({ classId: fx.ids.classId, termId: fx.ids.termId, published: true })
    expect(res.status).toBe(403)
  })
  it('any authenticated role can read the grid', async () => {
    const res = await request(app).get('/api/timetable').query({ classId: fx.ids.classId, termId: fx.ids.termId }).set(authHeader(fx.tokens.teacher))
    expect(res.status).toBe(200)
  })
})

describe('timetable: build, clash detection, publish, visibility', () => {
  it('admin can save a grid entry for VIII-A Mon P1', async () => {
    const res = await request(app).put('/api/timetable/entries').set(authHeader(fx.tokens.admin)).send({
      classId: fx.ids.classId, termId: fx.ids.termId,
      entries: [{ dayOfWeek: 1, periodIdx: 0, classSubjectId: fx.ids.classSubjectId, roomId: fx.ids.roomId, teacherId: fx.ids.teacherId }],
    })
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
  })

  it('the same teacher double-booked at the same day/period in another class is rejected as a clash', async () => {
    const res = await request(app).put('/api/timetable/entries').set(authHeader(fx.tokens.admin)).send({
      classId: secondClassId, termId: fx.ids.termId,
      entries: [{ dayOfWeek: 1, periodIdx: 0, classSubjectId: secondClassSubjectId, teacherId: fx.ids.teacherId }],
    })
    expect(res.status).toBe(409)
  })

  it('moving VIII-B to a different period avoids the clash and saves', async () => {
    const res = await request(app).put('/api/timetable/entries').set(authHeader(fx.tokens.admin)).send({
      classId: secondClassId, termId: fx.ids.termId,
      entries: [{ dayOfWeek: 1, periodIdx: 1, classSubjectId: secondClassSubjectId, teacherId: fx.ids.teacherId }],
    })
    expect(res.status).toBe(200)
  })

  it('is not published yet, so the enrolled student sees no published timetable', async () => {
    const res = await request(app).get('/api/timetable/me').query({ termId: fx.ids.termId }).set(authHeader(fx.tokens.student))
    expect(res.status).toBe(200)
    expect(res.body.published).toBeFalsy()
  })

  it('publishing VIII-A makes it visible to the enrolled student', async () => {
    const pub = await request(app).post('/api/timetable/publish').set(authHeader(fx.tokens.admin))
      .send({ classId: fx.ids.classId, termId: fx.ids.termId, published: true })
    expect(pub.status).toBe(200)

    const res = await request(app).get('/api/timetable/me').query({ termId: fx.ids.termId }).set(authHeader(fx.tokens.student))
    expect(res.status).toBe(200)
    expect(res.body.published).toBe(true)
    expect(res.body.entries.length).toBeGreaterThan(0)
  })

  it("teacher's own timetable view includes the VIII-A Monday period", async () => {
    const res = await request(app).get(`/api/timetable/teacher/${fx.ids.teacherId}`).query({ termId: fx.ids.termId }).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.entries.length).toBeGreaterThanOrEqual(1)
  })
})
