import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader } from './helpers/auth'

const app = createApp()
let fx: Fixture

beforeAll(async () => {
  fx = await buildFixture(app)
})

describe('admissions: apply -> verify -> approve -> accounts created', () => {
  let applicationId: string

  it('teacher cannot file any application', async () => {
    const res = await request(app).post('/api/applications').set(authHeader(fx.tokens.teacher)).send({ kind: 'Admission', applicantName: 'X', guardian: { name: 'Y' } })
    expect(res.status).toBe(403)
  })

  it('a student/parent cannot file an Admission application (office only)', async () => {
    const res = await request(app).post('/api/applications').set(authHeader(fx.tokens.parent)).send({ kind: 'Admission', applicantName: 'X', guardian: { name: 'Y' } })
    expect(res.status).toBe(403)
  })

  it('staff can file an Admission application', async () => {
    const res = await request(app).post('/api/applications').set(authHeader(fx.tokens.staff)).send({
      kind: 'Admission',
      applicantName: 'New Applicant',
      guardian: { name: 'Applicant Guardian', email: 'guardian.newapplicant@fixture.test', phone: '9999999999' },
      targetClassId: fx.ids.classId,
    })
    expect(res.status).toBe(201)
    expect(res.body.item.status).toBe('Pending')
    applicationId = res.body.item.id
  })

  it('a parent unrelated to the application cannot view it', async () => {
    const res = await request(app).get(`/api/applications/${applicationId}`).set(authHeader(fx.tokens.parent))
    expect(res.status).toBe(403)
  })

  it('staff can verify the application', async () => {
    const res = await request(app).post(`/api/applications/${applicationId}/verify`).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('Verified')
  })

  it('a teacher cannot approve an application (staff/admin only)', async () => {
    const res = await request(app).post(`/api/applications/${applicationId}/approve`).set(authHeader(fx.tokens.teacher))
    expect(res.status).toBe(403)
  })

  it('staff approves it: a student account and a parent account are created', async () => {
    const res = await request(app).post(`/api/applications/${applicationId}/approve`).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('Approved')
    expect(res.body.created.student.id).toBeTruthy()
    expect(res.body.created.parent.id).toBeTruthy()

    // the new student account can actually log in with the returned one-time password
    const login = await request(app).post('/api/auth/login').send({ email: res.body.created.student.email, password: res.body.created.student.password })
    expect(login.status).toBe(200)
    expect(login.body.mustChangePassword).toBe(true)
  })

  it('approving an already-approved application is rejected (409)', async () => {
    const res = await request(app).post(`/api/applications/${applicationId}/approve`).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(409)
  })

  it('a TC application requires studentId and marks the enrollment transferred on approval', async () => {
    const tc = await request(app).post('/api/applications').set(authHeader(fx.tokens.staff)).send({ kind: 'TC', studentId: fx.ids.studentId })
    expect(tc.status).toBe(201)
    const approve = await request(app).post(`/api/applications/${tc.body.item.id}/approve`).set(authHeader(fx.tokens.staff))
    expect(approve.status).toBe(200)
    const roster = await request(app).get(`/api/academic/classes/${fx.ids.classId}/roster`).set(authHeader(fx.tokens.staff))
    expect(roster.body.items.map((s: { user: { id: string } }) => s.user.id)).not.toContain(fx.ids.studentId)
  })
})
