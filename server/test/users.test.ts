import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { createApp } from '../src/app'
import { prisma } from './helpers/db'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { login, authHeader } from './helpers/auth'

const app = createApp()
let fx: Fixture

// A second, independent school (same pattern as group.test.ts) — used to prove search results never
// cross the schoolId boundary, even when a same-named user exists in both schools.
let schoolBToken: string

const CROSS_SCHOOL_NAME = 'CrossSchoolProbeStudent'

beforeAll(async () => {
  fx = await buildFixture(app)

  // Same name in the fixture's own school, to prove it's scoping — not just "no match anywhere".
  await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'student', name: CROSS_SCHOOL_NAME })

  const schoolB = await prisma.school.create({ data: { name: 'Second Search School' } })
  const SCHOOL_B_SUPERADMIN = { email: 'superadmin-b-search@fixture.test', password: 'principal123' }
  await prisma.user.create({
    data: {
      id: 'fx-superadmin-b-search',
      schoolId: schoolB.id,
      role: 'superadmin',
      name: 'Second School Principal',
      email: SCHOOL_B_SUPERADMIN.email,
      passwordHash: await bcrypt.hash(SCHOOL_B_SUPERADMIN.password, 10),
      title: 'Principal',
      avatarHue: 40,
      verified: true,
    },
  })
  const loginB = await login(app, SCHOOL_B_SUPERADMIN.email, SCHOOL_B_SUPERADMIN.password)
  schoolBToken = loginB.token
  // A user in school B that also matches the CROSS_SCHOOL_NAME query — so a leak would surface a real
  // match, not a coincidental empty result. Can't reuse the exact same name: User.email is unique
  // *globally* (not per-school) and makeEmail() derives it deterministically from the name, so an
  // identical name in a second school would collide on create — use a name sharing the same substring instead.
  const created = await request(app).post('/api/users').set(authHeader(schoolBToken)).send({ role: 'student', name: `${CROSS_SCHOOL_NAME} B` })
  if (created.status !== 201) throw new Error(`school B probe user create failed: ${created.status} ${JSON.stringify(created.body)}`)
})

describe('GET /api/users/search', () => {
  it('matches by name substring, case-insensitively', async () => {
    const res = await request(app).get('/api/users/search').query({ q: 'ishAAN' }).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.items.some((i: { id: string }) => i.id === fx.ids.studentId)).toBe(true)
  })

  it('matches by email substring too', async () => {
    // Fixture-created emails are derived from the person's name — reuse that instead of guessing the format.
    const all = await request(app).get('/api/users').set(authHeader(fx.tokens.admin))
    const email = all.body.users.find((u: { id: string }) => u.id === fx.ids.studentId).email as string
    const res = await request(app).get('/api/users/search').query({ q: email.slice(0, 6) }).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.items.some((i: { id: string }) => i.id === fx.ids.studentId)).toBe(true)
  })

  it('filters by role', async () => {
    const res = await request(app).get('/api/users/search').query({ role: 'teacher' }).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.items.length).toBeGreaterThan(0)
    for (const item of res.body.items) expect(item.role).toBe('teacher')
    expect(res.body.items.some((i: { id: string }) => i.id === fx.ids.teacherId)).toBe(true)
  })

  it('returns a disambiguating context string per row (class/roll for students, employeeId/designation for staff)', async () => {
    const students = await request(app).get('/api/users/search').query({ role: 'student', q: 'Ishaan' }).set(authHeader(fx.tokens.admin))
    const row = students.body.items.find((i: { id: string }) => i.id === fx.ids.studentId)
    expect(row.context).toContain('VIII-A')

    const teachers = await request(app).get('/api/users/search').query({ role: 'teacher' }).set(authHeader(fx.tokens.admin))
    const teacherRow = teachers.body.items.find((i: { id: string }) => i.id === fx.ids.teacherId)
    expect(teacherRow.context).toMatch(/^EMP-/)
  })

  it('filters students by classId via Enrollment', async () => {
    const res = await request(app).get('/api/users/search').query({ role: 'student', classId: fx.ids.classId }).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.items.some((i: { id: string }) => i.id === fx.ids.studentId)).toBe(true)

    const otherClass = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
      .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'B', capacity: 5 })
    const wrongClass = await request(app).get('/api/users/search').query({ role: 'student', classId: otherClass.body.item.id }).set(authHeader(fx.tokens.admin))
    expect(wrongClass.status).toBe(200)
    expect(wrongClass.body.items.some((i: { id: string }) => i.id === fx.ids.studentId)).toBe(false)
  })

  it('paginates with limit + cursor', async () => {
    // makeEmail() strips non-letters, so numeric suffixes ("Zzpage Student 0"/"1"/...) all collapse to the
    // same email and collide on the unique constraint — use distinct letter suffixes instead.
    const suffixes = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']
    for (const suffix of suffixes) {
      const res = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'student', name: `Zzpage Student ${suffix}` })
      if (res.status !== 201) throw new Error(`pagination fixture create failed: ${res.status} ${JSON.stringify(res.body)}`)
    }
    const page1 = await request(app).get('/api/users/search').query({ q: 'Zzpage', limit: 2 }).set(authHeader(fx.tokens.admin))
    expect(page1.status).toBe(200)
    expect(page1.body.items.length).toBe(2)
    expect(page1.body.nextCursor).toBeTruthy()

    const page2 = await request(app).get('/api/users/search').query({ q: 'Zzpage', limit: 2, cursor: page1.body.nextCursor }).set(authHeader(fx.tokens.admin))
    expect(page2.status).toBe(200)
    expect(page2.body.items.length).toBeGreaterThan(0)
    const page1Ids = new Set(page1.body.items.map((i: { id: string }) => i.id))
    for (const item of page2.body.items) expect(page1Ids.has(item.id)).toBe(false)
  })

  it('never returns users from a different school, even with a matching name', async () => {
    const fromSchoolA = await request(app).get('/api/users/search').query({ q: CROSS_SCHOOL_NAME }).set(authHeader(fx.tokens.admin))
    expect(fromSchoolA.status).toBe(200)
    expect(fromSchoolA.body.items.length).toBe(1) // only school A's own copy

    const fromSchoolB = await request(app).get('/api/users/search').query({ q: CROSS_SCHOOL_NAME }).set(authHeader(schoolBToken))
    expect(fromSchoolB.status).toBe(200)
    expect(fromSchoolB.body.items.length).toBe(1) // only school B's own copy
    expect(fromSchoolB.body.items[0].id).not.toBe(fromSchoolA.body.items[0].id)
  })
})
