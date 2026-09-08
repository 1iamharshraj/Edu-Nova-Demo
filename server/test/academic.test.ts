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

describe('academic setup: empty school -> full term lifecycle (built by buildFixture)', () => {
  it('bootstrap reflects everything the fixture created', async () => {
    const res = await request(app).get('/api/academic/bootstrap').set(authHeader(fx.tokens.superadmin))
    expect(res.status).toBe(200)
    expect(res.body.years).toHaveLength(1)
    expect(res.body.terms).toHaveLength(1)
    expect(res.body.boards).toHaveLength(1)
    expect(res.body.grades).toHaveLength(1)
    expect(res.body.classes).toHaveLength(1)
    expect(res.body.classSubjects).toHaveLength(1)
    expect(res.body.enrollments).toHaveLength(1)
  })

  it('the year created first is current automatically', async () => {
    const res = await request(app).get('/api/academic/years').set(authHeader(fx.tokens.superadmin))
    expect(res.body.items[0].isCurrent).toBe(true)
  })

  it('the class roster contains the enrolled student', async () => {
    const res = await request(app).get(`/api/academic/classes/${fx.ids.classId}/roster`).set(authHeader(fx.tokens.superadmin))
    expect(res.status).toBe(200)
    expect(res.body.items.map((s: { user: { id: string } }) => s.user.id)).toContain(fx.ids.studentId)
  })

  it('duplicate board code is rejected (409)', async () => {
    const res = await request(app).post('/api/academic/boards').set(authHeader(fx.tokens.superadmin)).send({ name: 'Central Board dup', code: 'CBSE' })
    expect(res.status).toBe(409)
  })

  it('duplicate class (same board+grade+section+year) is rejected', async () => {
    const res = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
      .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'A' })
    expect(res.status).toBe(409)
  })

  it('term end date before start date is rejected', async () => {
    const res = await request(app).post('/api/academic/terms').set(authHeader(fx.tokens.superadmin))
      .send({ academicYearId: fx.ids.yearId, name: 'Bad Term', startDate: '2026-09-01', endDate: '2026-08-01' })
    expect(res.status).toBe(400)
  })
})

describe('academic setup: RBAC', () => {
  const writeEndpoints: Array<{ method: 'post' | 'patch' | 'delete'; path: string; body?: object }> = [
    { method: 'post', path: '/api/academic/boards', body: { name: 'ICSE Board', code: 'ICSE-RBAC' } },
    { method: 'post', path: '/api/academic/grades', body: { label: 'IX-RBAC' } },
    { method: 'post', path: '/api/academic/rooms', body: { name: 'Lab-RBAC', kind: 'lab' } },
  ]

  for (const ep of writeEndpoints) {
    it(`teacher cannot ${ep.method.toUpperCase()} ${ep.path}`, async () => {
      const res = await request(app)[ep.method](ep.path).set(authHeader(fx.tokens.teacher)).send(ep.body)
      expect(res.status).toBe(403)
    })
    it(`student cannot ${ep.method.toUpperCase()} ${ep.path}`, async () => {
      const res = await request(app)[ep.method](ep.path).set(authHeader(fx.tokens.student)).send(ep.body)
      expect(res.status).toBe(403)
    })
    it(`parent cannot ${ep.method.toUpperCase()} ${ep.path}`, async () => {
      const res = await request(app)[ep.method](ep.path).set(authHeader(fx.tokens.parent)).send(ep.body)
      expect(res.status).toBe(403)
    })
    it(`staff cannot ${ep.method.toUpperCase()} ${ep.path} (write is admin/superadmin only)`, async () => {
      const res = await request(app)[ep.method](ep.path).set(authHeader(fx.tokens.staff)).send(ep.body)
      expect(res.status).toBe(403)
    })
    it(`admin CAN ${ep.method.toUpperCase()} ${ep.path}`, async () => {
      const res = await request(app)[ep.method](ep.path).set(authHeader(fx.tokens.admin)).send(ep.body)
      expect([200, 201]).toContain(res.status)
    })
  }

  it('everyone authenticated can read academic bootstrap', async () => {
    for (const role of ['teacher', 'student', 'parent', 'staff'] as const) {
      const res = await request(app).get('/api/academic/bootstrap').set(authHeader(fx.tokens[role]))
      expect(res.status).toBe(200)
    }
  })

  it('unauthenticated requests are rejected', async () => {
    const res = await request(app).get('/api/academic/bootstrap')
    expect(res.status).toBe(401)
  })
})
