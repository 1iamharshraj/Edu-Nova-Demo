import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader } from './helpers/auth'

const app = createApp()
let fx: Fixture
let otherStudentToken: string
let otherStudentId: string
let otherParentToken: string
let unrelatedTeacherToken: string

beforeAll(async () => {
  fx = await buildFixture(app)

  // A second, unrelated student + their own parent + a teacher who doesn't teach fx.ids.classId —
  // used to prove the health-record cross-student privacy rule from phase-8-welfare.md.
  const otherStudent = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'student', name: 'Other Student' })
  otherStudentId = otherStudent.body.user.id
  const otherStudentLogin = await request(app).post('/api/auth/login').send({ email: otherStudent.body.user.email, password: 'student123' })
  otherStudentToken = otherStudentLogin.body.token

  const otherParent = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'parent', name: 'Other Parent', studentIds: [otherStudentId] })
  const otherParentLogin = await request(app).post('/api/auth/login').send({ email: otherParent.body.user.email, password: 'parent123' })
  otherParentToken = otherParentLogin.body.token

  const unrelatedTeacher = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'teacher', name: 'Unrelated Teacher' })
  const unrelatedTeacherLogin = await request(app).post('/api/auth/login').send({ email: unrelatedTeacher.body.user.email, password: 'teacher123' })
  unrelatedTeacherToken = unrelatedTeacherLogin.body.token
})

describe('health records: visibility rule', () => {
  let recordId: string

  it('staff can add a health record for a student', async () => {
    const res = await request(app).post('/api/health').set(authHeader(fx.tokens.staff)).send({
      studentId: fx.ids.studentId, kind: 'Allergy', title: 'Peanuts', detail: 'Anaphylaxis risk', date: '2026-01-01',
    })
    expect(res.status).toBe(201)
    recordId = res.body.item.id
  })

  it('the student themselves can see it', async () => {
    const res = await request(app).get('/api/health').query({ studentId: fx.ids.studentId }).set(authHeader(fx.tokens.student))
    expect(res.status).toBe(200)
    expect(res.body.items.map((r: { id: string }) => r.id)).toContain(recordId)
  })

  it("the student's guardian (fx.parent) can see it", async () => {
    const res = await request(app).get('/api/health').query({ studentId: fx.ids.studentId }).set(authHeader(fx.tokens.parent))
    expect(res.status).toBe(200)
    expect(res.body.items.map((r: { id: string }) => r.id)).toContain(recordId)
  })

  it("the student's class teacher (fx.teacher) can see it", async () => {
    const res = await request(app).get('/api/health').query({ studentId: fx.ids.studentId }).set(authHeader(fx.tokens.teacher))
    expect(res.status).toBe(200)
    expect(res.body.items.map((r: { id: string }) => r.id)).toContain(recordId)
  })

  it("a parent of a DIFFERENT student is forbidden", async () => {
    const res = await request(app).get('/api/health').query({ studentId: fx.ids.studentId }).set(authHeader(otherParentToken))
    expect(res.status).toBe(403)
  })

  it('a teacher who does not teach this student is forbidden', async () => {
    const res = await request(app).get('/api/health').query({ studentId: fx.ids.studentId }).set(authHeader(unrelatedTeacherToken))
    expect(res.status).toBe(403)
  })

  it('a different student cannot see this record (nor add one for someone else)', async () => {
    const view = await request(app).get('/api/health').query({ studentId: fx.ids.studentId }).set(authHeader(otherStudentToken))
    expect(view.status).toBe(403)
    const add = await request(app).post('/api/health').set(authHeader(otherStudentToken)).send({
      studentId: fx.ids.studentId, kind: 'Other', title: 'x', detail: 'x', date: '2026-01-01',
    })
    expect(add.status).toBe(403)
  })

  it('staff/admin can verify the record', async () => {
    const res = await request(app).post(`/api/health/${recordId}/verify`).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(200)
    expect(res.body.item.verifiedById).toBeTruthy()
  })
})

describe('activities: capacity, waitlist, and promotion', () => {
  let activityId: string

  it('a teacher cannot create an activity (staff/admin only)', async () => {
    const res = await request(app).post('/api/activities').set(authHeader(fx.tokens.teacher)).send({
      kind: 'club', title: 'Chess Club', description: 'Weekly chess', capacity: 1, forRoles: ['student'],
    })
    expect(res.status).toBe(403)
  })

  it('staff creates an activity with capacity 1, open to students', async () => {
    const res = await request(app).post('/api/activities').set(authHeader(fx.tokens.staff)).send({
      kind: 'club', title: 'Chess Club', description: 'Weekly chess', capacity: 1, forRoles: ['student'],
    })
    expect(res.status).toBe(201)
    activityId = res.body.item.id
  })

  it('the first student registers and is Registered', async () => {
    const res = await request(app).post(`/api/activities/${activityId}/register`).set(authHeader(fx.tokens.student))
    expect(res.status).toBe(201)
    expect(res.body.item.status).toBe('Registered')
  })

  it('a second student registering for the same (full) activity is Waitlisted', async () => {
    const res = await request(app).post(`/api/activities/${activityId}/register`).set(authHeader(otherStudentToken))
    expect(res.status).toBe(201)
    expect(res.body.item.status).toBe('Waitlisted')
  })

  it('cancelling the first registration promotes the waitlisted student to Registered', async () => {
    const cancel = await request(app).post(`/api/activities/${activityId}/cancel`).set(authHeader(fx.tokens.student))
    expect(cancel.status).toBe(200)
    expect(cancel.body.item.status).toBe('Cancelled')

    const regs = await request(app).get(`/api/activities/${activityId}/registrations`).set(authHeader(fx.tokens.staff))
    const promoted = regs.body.items.find((r: { userId: string }) => r.userId === otherStudentId)
    expect(promoted.status).toBe('Registered')
  })

  it('a role not in forRoles cannot register', async () => {
    const res = await request(app).post(`/api/activities/${activityId}/register`).set(authHeader(fx.tokens.parent))
    expect(res.status).toBe(403)
  })
})
