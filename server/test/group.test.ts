import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { createApp } from '../src/app'
import { prisma } from './helpers/db'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { login, authHeader } from './helpers/auth'

// See phase-28-multi-school-group.md. Two independent schools (fx.schoolId, built with the normal
// buildFixture helper, plus a second hand-built "Second Campus" school) grouped together, so the overview
// endpoint has genuinely two different `schoolId`s to compare side by side.

const app = createApp()
let fx: Fixture
let schoolBId: string
let schoolBSuperadminToken: string
let schoolBSuperadminId: string
let groupId: string

const SCHOOL_B_SUPERADMIN = { email: 'superadmin-b@fixture.test', password: 'principal123' }

beforeAll(async () => {
  fx = await buildFixture(app)

  const schoolB = await prisma.school.create({ data: { name: 'Second Campus' } })
  schoolBId = schoolB.id
  const userB = await prisma.user.create({
    data: {
      id: 'fx-superadmin-b',
      schoolId: schoolB.id,
      role: 'superadmin',
      name: 'Second Campus Principal',
      email: SCHOOL_B_SUPERADMIN.email,
      passwordHash: await bcrypt.hash(SCHOOL_B_SUPERADMIN.password, 10),
      title: 'Principal',
      avatarHue: 40,
      verified: true,
    },
  })
  schoolBSuperadminId = userB.id
  const loginB = await login(app, SCHOOL_B_SUPERADMIN.email, SCHOOL_B_SUPERADMIN.password)
  schoolBSuperadminToken = loginB.token
})

describe('group: creation + membership is a platform-level action gated by ordinary requireRole', () => {
  it('a non-superadmin cannot create a group', async () => {
    const res = await request(app).post('/api/group').set(authHeader(fx.tokens.admin)).send({ name: 'Nope Trust' })
    expect(res.status).toBe(403)
  })

  it('a superadmin (of any school — documented platform-level limitation) can create a group, and becomes its first GroupAdmin', async () => {
    const res = await request(app).post('/api/group').set(authHeader(fx.tokens.superadmin)).send({ name: 'Edkonic Trust' })
    expect(res.status).toBe(201)
    groupId = res.body.item.id
    expect(res.body.item.name).toBe('Edkonic Trust')

    const mine = await request(app).get('/api/group/mine').set(authHeader(fx.tokens.superadmin))
    expect(mine.status).toBe(200)
    expect(mine.body.memberships).toEqual([{ groupId, groupName: 'Edkonic Trust', role: 'GroupAdmin' }])
  })

  it('rejects a malformed create body', async () => {
    const res = await request(app).post('/api/group').set(authHeader(fx.tokens.superadmin)).send({})
    expect(res.status).toBe(400)
  })
})

describe('group: /:id/schools is gated by "superadmin of that specific school", never assertGroupAccess', () => {
  it("school A's own superadmin can add school A to the group", async () => {
    const res = await request(app).post(`/api/group/${groupId}/schools`).set(authHeader(fx.tokens.superadmin)).send({})
    expect(res.status).toBe(201)
    expect(res.body.item.id).toBe(fx.schoolId)
    expect(res.body.item.groupId).toBe(groupId)
  })

  it('an admin (not superadmin) of the school cannot add it to a group', async () => {
    const secondGroup = await request(app).post('/api/group').set(authHeader(schoolBSuperadminToken)).send({ name: 'Other Trust' })
    const res = await request(app).post(`/api/group/${secondGroup.body.item.id}/schools`).set(authHeader(fx.tokens.admin)).send({})
    expect(res.status).toBe(403)
  })

  it('cannot pass a schoolId belonging to someone else — only your own school can be added', async () => {
    const res = await request(app).post(`/api/group/${groupId}/schools`).set(authHeader(schoolBSuperadminToken)).send({ schoolId: fx.schoolId })
    expect(res.status).toBe(403)
  })

  it("school B's own superadmin can add school B to the SAME group", async () => {
    const res = await request(app).post(`/api/group/${groupId}/schools`).set(authHeader(schoolBSuperadminToken)).send({})
    expect(res.status).toBe(201)
    expect(res.body.item.id).toBe(schoolBId)
  })

  it('adding an already-grouped school to a different group is rejected (409)', async () => {
    const other = await request(app).post('/api/group').set(authHeader(fx.tokens.superadmin)).send({ name: 'Rival Trust' })
    const res = await request(app).post(`/api/group/${other.body.item.id}/schools`).set(authHeader(fx.tokens.superadmin)).send({})
    expect(res.status).toBe(409)
  })
})

describe('group: assertGroupAccess is fully separate from requireRole/Ctx — 403 for every non-member', () => {
  it('a regular teacher (not a group member) gets 403 on every /api/group/* group-scoped route', async () => {
    const routes: [string, string][] = [
      ['get', `/api/group/${groupId}/schools`],
      ['get', `/api/group/${groupId}/overview`],
      ['get', `/api/group/${groupId}/school/${fx.schoolId}/drilldown`],
      ['get', `/api/group/${groupId}/admins`],
    ]
    for (const [method, url] of routes) {
      const res = await (request(app) as any)[method](url).set(authHeader(fx.tokens.teacher))
      expect(res.status).toBe(403)
    }
    const post = await request(app).post(`/api/group/${groupId}/admins`).set(authHeader(fx.tokens.teacher)).send({ userId: fx.ids.teacherId, role: 'GroupViewer' })
    expect(post.status).toBe(403)
  })

  it('a school SUPERADMIN who is simply not a group member also gets 403 (schools of the group ≠ automatic group access)', async () => {
    // fx superadmin's school is IN the group, but that alone does not grant group access — only the
    // explicit GroupAdmin grant from group creation does. staff/admin of that same school still 403s.
    const res = await request(app).get(`/api/group/${groupId}/overview`).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(403)
  })

  it('an unknown/garbage groupId also 403s for a non-member (never leaks existence)', async () => {
    const res = await request(app).get('/api/group/does-not-exist/schools').set(authHeader(fx.tokens.teacher))
    expect(res.status).toBe(403)
  })
})

describe('group: cross-campus overview — N separate per-school calls combined, side by side', () => {
  it('the group creator (GroupAdmin) sees both member schools listed', async () => {
    const res = await request(app).get(`/api/group/${groupId}/schools`).set(authHeader(fx.tokens.superadmin))
    expect(res.status).toBe(200)
    const ids = res.body.items.map((s: { id: string }) => s.id).sort()
    expect(ids).toEqual([fx.schoolId, schoolBId].sort())
  })

  it('the overview returns one row per member school with independently-scoped aggregates', async () => {
    const res = await request(app).get(`/api/group/${groupId}/overview`).set(authHeader(fx.tokens.superadmin))
    expect(res.status).toBe(200)
    expect(res.body.groupId).toBe(groupId)
    expect(res.body.items).toHaveLength(2)
    const bySchool = new Map(res.body.items.map((r: { schoolId: string }) => [r.schoolId, r]))
    expect(bySchool.has(fx.schoolId)).toBe(true)
    expect(bySchool.has(schoolBId)).toBe(true)
    for (const row of res.body.items) {
      expect(row).toHaveProperty('syllabusPace')
      expect(row).toHaveProperty('fees')
      expect(row).toHaveProperty('attendance')
      expect(row).toHaveProperty('teacherLoad')
    }
  })

  it('drilldown into one member school returns only that school\'s own report, refusing a schoolId outside the group', async () => {
    const ok = await request(app).get(`/api/group/${groupId}/school/${fx.schoolId}/drilldown`).query({ report: 'fees' }).set(authHeader(fx.tokens.superadmin))
    expect(ok.status).toBe(200)
    expect(ok.body.schoolId).toBe(fx.schoolId)
    expect(ok.body.report).toBe('fees')

    const otherSchool = await prisma.school.create({ data: { name: 'Not In Group' } })
    const bad = await request(app).get(`/api/group/${groupId}/school/${otherSchool.id}/drilldown`).set(authHeader(fx.tokens.superadmin))
    expect(bad.status).toBe(404)
  })
})

describe('group: admin management — group\'s existing GroupAdmins only, GroupViewer is read-only', () => {
  it('the GroupAdmin grants school B\'s superadmin GroupViewer access', async () => {
    const res = await request(app).post(`/api/group/${groupId}/admins`).set(authHeader(fx.tokens.superadmin))
      .send({ userId: schoolBSuperadminId, role: 'GroupViewer' })
    expect(res.status).toBe(201)
    expect(res.body.item.role).toBe('GroupViewer')
  })

  it('a GroupViewer can read the overview but cannot grant admin access to someone else', async () => {
    const read = await request(app).get(`/api/group/${groupId}/overview`).set(authHeader(schoolBSuperadminToken))
    expect(read.status).toBe(200)

    const write = await request(app).post(`/api/group/${groupId}/admins`).set(authHeader(schoolBSuperadminToken))
      .send({ userId: fx.ids.adminId, role: 'GroupViewer' })
    expect(write.status).toBe(403)
  })

  it('re-granting an existing member a different role upgrades in place (no duplicate row)', async () => {
    const res = await request(app).post(`/api/group/${groupId}/admins`).set(authHeader(fx.tokens.superadmin))
      .send({ userId: schoolBSuperadminId, role: 'GroupAdmin' })
    expect(res.status).toBe(201)
    const list = await request(app).get(`/api/group/${groupId}/admins`).set(authHeader(fx.tokens.superadmin))
    expect(list.body.items.filter((a: { userId: string }) => a.userId === schoolBSuperadminId)).toHaveLength(1)
    expect(list.body.items.find((a: { userId: string }) => a.userId === schoolBSuperadminId).role).toBe('GroupAdmin')
  })
})

describe('regression: zero change to existing single-school behaviour for regular users', () => {
  it('admin login + a pre-existing endpoint (academic classes) behaves exactly as before', async () => {
    const res = await request(app).get('/api/academic/classes').set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.items.some((c: { id: string }) => c.id === fx.ids.classId)).toBe(true)
  })

  it('teacher login + attendance summary still works and is still scoped to their own school', async () => {
    const res = await request(app).get('/api/attendance/summary').query({ classId: fx.ids.classId, termId: fx.ids.termId }).set(authHeader(fx.tokens.teacher))
    expect(res.status).toBe(200)
  })

  it('student login + fee invoices still self-scoped, unaffected by the group system', async () => {
    const res = await request(app).get('/api/fees/invoices').query({ studentId: fx.ids.studentId }).set(authHeader(fx.tokens.student))
    expect(res.status).toBe(200)
  })

  it("a plain login for school B's own superadmin still logs into their own single school, unaffected", async () => {
    const res = await request(app).get('/api/auth/me').set(authHeader(schoolBSuperadminToken))
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(SCHOOL_B_SUPERADMIN.email)
    expect(res.body.user.role).toBe('superadmin')
  })
})
