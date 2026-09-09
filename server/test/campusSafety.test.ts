import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader, login } from './helpers/auth'
import { prisma } from './helpers/db'

const app = createApp()
let fx: Fixture

beforeAll(async () => {
  fx = await buildFixture(app)
})

// ═══════════════════════════ Item 1: authorized pickup + OTP ═══════════════════════════

describe('safety: authorized pickup people', () => {
  it('parent can add an authorized pickup person for their own ward', async () => {
    const res = await request(app).post('/api/safety/authorized-pickups').set(authHeader(fx.tokens.parent)).send({
      studentId: fx.ids.studentId, name: 'Uncle Rahul', relation: 'Uncle', phone: '9999900000',
    })
    expect(res.status).toBe(201)
    expect(res.body.item.studentId).toBe(fx.ids.studentId)
  })

  it('a parent cannot add a pickup person for a student who is not their ward', async () => {
    const other = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'student', name: 'Not A Ward' })
    const res = await request(app).post('/api/safety/authorized-pickups').set(authHeader(fx.tokens.parent)).send({
      studentId: other.body.user.id, name: 'X', relation: 'Y', phone: '1',
    })
    expect(res.status).toBe(403)
  })

  it('staff can add and list pickup people for any student', async () => {
    const res = await request(app).post('/api/safety/authorized-pickups').set(authHeader(fx.tokens.staff)).send({
      studentId: fx.ids.studentId, name: 'Driver Suresh', relation: 'Driver', phone: '8888800000',
    })
    expect(res.status).toBe(201)
    const list = await request(app).get('/api/safety/authorized-pickups').query({ studentId: fx.ids.studentId }).set(authHeader(fx.tokens.staff))
    expect(list.status).toBe(200)
    expect(list.body.items.length).toBeGreaterThanOrEqual(2)
  })
})

describe('safety: pickup events + OTP flow', () => {
  it('a regular pickup by a listed person needs no OTP and completes immediately', async () => {
    const res = await request(app).post('/api/safety/pickup-events').set(authHeader(fx.tokens.staff)).send({
      studentId: fx.ids.studentId, pickedUpByName: 'Uncle Rahul', pickedUpByRelation: 'Uncle', pickupType: 'Regular',
    })
    expect(res.status).toBe(201)
    expect(res.body.item.otpRequired).toBe(false)
    expect(res.body.item.status).toBe('Completed')
  })

  it('a pickup by an UNLISTED person requires OTP and is flagged PendingOtp, not silently allowed through', async () => {
    const res = await request(app).post('/api/safety/pickup-events').set(authHeader(fx.tokens.staff)).send({
      studentId: fx.ids.studentId, pickedUpByName: 'Random Stranger', pickedUpByRelation: 'Neighbor', pickupType: 'Regular',
    })
    expect(res.status).toBe(201)
    expect(res.body.item.otpRequired).toBe(true)
    expect(res.body.item.status).toBe('PendingOtp')
    const id = res.body.item.id as string

    const wrongVerify = await request(app).post(`/api/safety/pickup-events/${id}/verify-otp`).set(authHeader(fx.tokens.staff)).send({ code: '000000' })
    expect(wrongVerify.status).toBe(400) // no OTP requested yet

    const otpRes = await request(app).post(`/api/safety/pickup-events/${id}/request-otp`).set(authHeader(fx.tokens.staff))
    expect(otpRes.status).toBe(200)
    const code = otpRes.body.item.devCode as string
    expect(code).toMatch(/^\d{6}$/)

    const badCode = await request(app).post(`/api/safety/pickup-events/${id}/verify-otp`).set(authHeader(fx.tokens.staff)).send({ code: '111111' })
    expect(badCode.status).toBe(400)

    const goodCode = await request(app).post(`/api/safety/pickup-events/${id}/verify-otp`).set(authHeader(fx.tokens.staff)).send({ code })
    expect(goodCode.status).toBe(200)
    expect(goodCode.body.item.approvedByOtp).toBe(true)
    expect(goodCode.body.item.status).toBe('Completed')
  })

  it('an early/unlisted pickup that never gets OTP-verified stays clearly flagged as PendingOtp, never silently Completed', async () => {
    const res = await request(app).post('/api/safety/pickup-events').set(authHeader(fx.tokens.staff)).send({
      studentId: fx.ids.studentId, pickedUpByName: 'Nobody Listed', pickedUpByRelation: 'Friend', pickupType: 'EarlyOrUnlisted',
    })
    expect(res.body.item.status).toBe('PendingOtp')
    const list = await request(app).get('/api/safety/pickup-events').query({ status: 'PendingOtp' }).set(authHeader(fx.tokens.staff))
    expect(list.status).toBe(200)
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(res.body.item.id)
  })

  it('parent/teacher/student cannot log pickups or view the log (staff/admin only)', async () => {
    for (const token of [fx.tokens.parent, fx.tokens.teacher, fx.tokens.student]) {
      const create = await request(app).post('/api/safety/pickup-events').set(authHeader(token)).send({
        studentId: fx.ids.studentId, pickedUpByName: 'X', pickedUpByRelation: 'Y',
      })
      expect(create.status).toBe(403)
      const list = await request(app).get('/api/safety/pickup-events').set(authHeader(token))
      expect(list.status).toBe(403)
    }
  })
})

// ═══════════════════════════ Item 2: visitor management ═══════════════════════════

describe('safety: visitor management', () => {
  let visitorId: string

  it('staff can check in a visitor', async () => {
    const res = await request(app).post('/api/safety/visitors').set(authHeader(fx.tokens.staff)).send({
      name: 'Delivery Person', phone: '7777700000', purpose: 'Package drop-off', hostUserId: fx.ids.staffId,
    })
    expect(res.status).toBe(201)
    expect(res.body.item.checkOutAt).toBeUndefined()
    visitorId = res.body.item.id
  })

  it('a parent/teacher cannot check in a visitor', async () => {
    const res = await request(app).post('/api/safety/visitors').set(authHeader(fx.tokens.parent)).send({ name: 'X', phone: '1', purpose: 'Y' })
    expect(res.status).toBe(403)
  })

  it('currently-on-campus filter includes the checked-in visitor; checkout removes them from it', async () => {
    const onCampus = await request(app).get('/api/safety/visitors').query({ onCampus: 'true' }).set(authHeader(fx.tokens.staff))
    expect(onCampus.body.items.map((v: { id: string }) => v.id)).toContain(visitorId)

    const checkout = await request(app).post(`/api/safety/visitors/${visitorId}/checkout`).set(authHeader(fx.tokens.staff))
    expect(checkout.status).toBe(200)
    expect(checkout.body.item.checkOutAt).toBeTruthy()

    const again = await request(app).post(`/api/safety/visitors/${visitorId}/checkout`).set(authHeader(fx.tokens.staff))
    expect(again.status).toBe(409)

    const onCampusAfter = await request(app).get('/api/safety/visitors').query({ onCampus: 'true' }).set(authHeader(fx.tokens.staff))
    expect(onCampusAfter.body.items.map((v: { id: string }) => v.id)).not.toContain(visitorId)
  })
})

// ═══════════════════════════ Item 3: confidential counseling ═══════════════════════════

describe('counseling: CounselingRecord — strictly counselor-only by default', () => {
  let counselorToken: string
  let counselorId: string

  beforeAll(async () => {
    // Promote fx.teacher to counselor via the dedicated admin-only endpoint.
    const grant = await request(app).patch(`/api/users/${fx.ids.teacherId}/counselor`).set(authHeader(fx.tokens.admin)).send({ isCounselor: true })
    expect(grant.status).toBe(200)
    expect(grant.body.user.isCounselor).toBe(true)
    counselorId = fx.ids.teacherId
    // isCounselor is read fresh from the DB on every request, never cached in the JWT — fx's existing
    // teacher token works as-is, no need to re-login after the grant above.
    counselorToken = fx.tokens.teacher
  })

  it('a non-designated staff/admin account is refused isCounselor grants effect: only admin/superadmin can grant it', async () => {
    const asStaff = await request(app).patch(`/api/users/${fx.ids.staffId}/counselor`).set(authHeader(fx.tokens.staff)).send({ isCounselor: true })
    expect(asStaff.status).toBe(403)
  })

  let recordId: string

  it('the designated counselor can create a counseling record', async () => {
    const res = await request(app).post('/api/safety/counseling-records').set(authHeader(counselorToken)).send({
      studentId: fx.ids.studentId, sessionDate: '2026-06-10', notes: 'Confidential session notes.', followUpNeeded: true,
    })
    expect(res.status).toBe(201)
    expect(res.body.item.counselorId).toBe(counselorId)
    recordId = res.body.item.id
  })

  it('the counselor who owns it can read and list it', async () => {
    const get = await request(app).get(`/api/safety/counseling-records/${recordId}`).set(authHeader(counselorToken))
    expect(get.status).toBe(200)
    const list = await request(app).get('/api/safety/counseling-records').set(authHeader(counselorToken))
    expect(list.status).toBe(200)
    expect(list.body.items.map((r: { id: string }) => r.id)).toContain(recordId)
  })

  // ── The mandatory live check: a non-counselor staff/admin account gets a clean 403 ──
  it('LIVE CHECK: a non-counselor staff account gets a clean 403 on every counseling-record endpoint', async () => {
    const list = await request(app).get('/api/safety/counseling-records').set(authHeader(fx.tokens.staff))
    expect(list.status).toBe(200) // returns [] rather than 403 — the service filters, it does not throw, for list
    expect(list.body.items).toEqual([])

    const get = await request(app).get(`/api/safety/counseling-records/${recordId}`).set(authHeader(fx.tokens.staff))
    expect(get.status).toBe(403)

    const patch = await request(app).patch(`/api/safety/counseling-records/${recordId}`).set(authHeader(fx.tokens.staff)).send({ notes: 'tampered' })
    expect(patch.status).toBe(403)

    const del = await request(app).delete(`/api/safety/counseling-records/${recordId}`).set(authHeader(fx.tokens.staff))
    expect(del.status).toBe(403)

    const create = await request(app).post('/api/safety/counseling-records').set(authHeader(fx.tokens.staff)).send({
      studentId: fx.ids.studentId, sessionDate: '2026-06-11', notes: 'x',
    })
    expect(create.status).toBe(403)
  })

  it('LIVE CHECK: a non-counselor ADMIN also gets 403/empty — oversight defaults OFF', async () => {
    const list = await request(app).get('/api/safety/counseling-records').set(authHeader(fx.tokens.admin))
    expect(list.body.items).toEqual([])
    const get = await request(app).get(`/api/safety/counseling-records/${recordId}`).set(authHeader(fx.tokens.admin))
    expect(get.status).toBe(403)
  })

  it('not visible to class teacher-as-teacher (not counselor), the student, or the parent', async () => {
    // fx.teacher IS the counselor in this suite, so use a second, unrelated teacher instead.
    const otherTeacher = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'teacher', name: 'Other Teacher' })
    const otherTeacherLogin = await login(app, otherTeacher.body.user.email, otherTeacher.body.password)
    const asOtherTeacher = await request(app).get(`/api/safety/counseling-records/${recordId}`).set(authHeader(otherTeacherLogin.token))
    expect(asOtherTeacher.status).toBe(403)

    const asStudent = await request(app).get(`/api/safety/counseling-records/${recordId}`).set(authHeader(fx.tokens.student))
    expect(asStudent.status).toBe(403)

    const asParent = await request(app).get(`/api/safety/counseling-records/${recordId}`).set(authHeader(fx.tokens.parent))
    expect(asParent.status).toBe(403)
  })

  it('turning oversight ON lets admin/superadmin VIEW (but not edit) — turning it off again removes access', async () => {
    const enable = await request(app).patch('/api/safety/counseling-settings').set(authHeader(fx.tokens.admin)).send({ oversightEnabled: true })
    expect(enable.status).toBe(200)
    expect(enable.body.item.oversightEnabled).toBe(true)

    const get = await request(app).get(`/api/safety/counseling-records/${recordId}`).set(authHeader(fx.tokens.admin))
    expect(get.status).toBe(200)

    const patch = await request(app).patch(`/api/safety/counseling-records/${recordId}`).set(authHeader(fx.tokens.admin)).send({ notes: 'admin trying to edit' })
    expect(patch.status).toBe(403) // oversight is view-only, not edit

    const disable = await request(app).patch('/api/safety/counseling-settings').set(authHeader(fx.tokens.admin)).send({ oversightEnabled: false })
    expect(disable.status).toBe(200)
    const getAfter = await request(app).get(`/api/safety/counseling-records/${recordId}`).set(authHeader(fx.tokens.admin))
    expect(getAfter.status).toBe(403)
  })

  it('every access to a counseling record is itself audited (who accessed what)', async () => {
    const logs = await prisma.auditLog.findMany({ where: { schoolId: fx.schoolId, entity: 'counselingRecord', entityId: recordId }, orderBy: { at: 'asc' } })
    const actions = logs.map(l => l.action)
    expect(actions).toContain('create')
    expect(actions).toContain('view')
  })
})

describe('counseling: AnonymousReport — genuinely anonymous', () => {
  let reportId: string

  it('a student can submit an anonymous report', async () => {
    const res = await request(app).post('/api/safety/anonymous-reports').set(authHeader(fx.tokens.student)).send({
      category: 'Bullying', description: 'Something concerning happened near the lockers.',
    })
    expect(res.status).toBe(201)
    reportId = res.body.item.id
    expect(res.body.item).not.toHaveProperty('submittedById')
    expect(res.body.item).not.toHaveProperty('studentId')
    expect(res.body.item).not.toHaveProperty('actorId')
  })

  it('a teacher cannot submit an anonymous report (only student/parent)', async () => {
    const res = await request(app).post('/api/safety/anonymous-reports').set(authHeader(fx.tokens.teacher)).send({
      category: 'Safety', description: 'x',
    })
    expect(res.status).toBe(403)
  })

  it('a plain staff account (not counselor, not admin) cannot view anonymous reports', async () => {
    const res = await request(app).get('/api/safety/anonymous-reports').set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(403)
  })

  it('admin/superadmin can review and resolve it', async () => {
    const list = await request(app).get('/api/safety/anonymous-reports').set(authHeader(fx.tokens.admin))
    expect(list.status).toBe(200)
    expect(list.body.items.map((r: { id: string }) => r.id)).toContain(reportId)

    const patch = await request(app).patch(`/api/safety/anonymous-reports/${reportId}`).set(authHeader(fx.tokens.admin)).send({ status: 'Resolved', resolutionNotes: 'Followed up with the class teacher.' })
    expect(patch.status).toBe(200)
    expect(patch.body.item.status).toBe('Resolved')
    expect(patch.body.item.reviewedById).toBe(fx.ids.adminId)
  })

  // ── The mandatory live check: no identifying trace of the submitter, in the row OR the audit log ──
  it('LIVE CHECK: the stored row has no submitter-identifying field whatsoever', async () => {
    const row = await prisma.anonymousReport.findUniqueOrThrow({ where: { id: reportId } })
    const keys = Object.keys(row)
    for (const forbidden of ['submittedById', 'studentId', 'actorId', 'userId', 'createdById', 'authorId']) {
      expect(keys).not.toContain(forbidden)
    }
    // Full column dump, for the record: id/schoolId/category/description/submittedAt/status/reviewedById/resolutionNotes only.
    expect(keys.sort()).toEqual(['category', 'description', 'id', 'reviewedById', 'resolutionNotes', 'schoolId', 'status', 'submittedAt'].sort())
  })

  it("LIVE CHECK: the audit log entry for the report's CREATION carries no trace of the student who submitted it", async () => {
    const creationLogs = await prisma.auditLog.findMany({ where: { schoolId: fx.schoolId, entity: 'anonymousReport', entityId: reportId, action: 'create' } })
    // The whole point: there must be NO 'create' audit entry at all for this entity — logging one would
    // necessarily carry actorId (the submitter), which is exactly the trace this model promises not to keep.
    expect(creationLogs).toEqual([])

    // Sanity: the student's own actorId never appears anywhere in this report's audit trail (create OR
    // the later admin review), confirming the submitter is unrecoverable even by cross-referencing audit rows.
    const allLogsForReport = await prisma.auditLog.findMany({ where: { schoolId: fx.schoolId, entity: 'anonymousReport', entityId: reportId } })
    expect(allLogsForReport.every(l => l.actorId !== fx.ids.studentId)).toBe(true)
    // Only the reviewing admin's action is logged (the 'review' entry), never a 'create'.
    expect(allLogsForReport.map(l => l.action).sort()).toEqual(['review'])
  })
})

// ═══════════════════════════ Item 4: medication log + allergy alerts ═══════════════════════════

describe('health: medication schedule + administration log (reuses HealthRecord RBAC scope)', () => {
  let scheduleId: string

  it('staff can create a medication schedule for a student', async () => {
    const res = await request(app).post('/api/health/medication-schedules').set(authHeader(fx.tokens.staff)).send({
      studentId: fx.ids.studentId, medicationName: 'Cetirizine', dosage: '10mg', times: ['08:00', '20:00'], startDate: '2026-06-01',
    })
    expect(res.status).toBe(201)
    scheduleId = res.body.item.id
  })

  it('a parent/student cannot create a schedule (nurse/staff only), but CAN view it (same as HealthRecord scope)', async () => {
    const create = await request(app).post('/api/health/medication-schedules').set(authHeader(fx.tokens.parent)).send({
      studentId: fx.ids.studentId, medicationName: 'X', dosage: 'Y', times: ['09:00'], startDate: '2026-06-01',
    })
    expect(create.status).toBe(403)

    const view = await request(app).get('/api/health/medication-schedules').query({ studentId: fx.ids.studentId }).set(authHeader(fx.tokens.parent))
    expect(view.status).toBe(200)
    expect(view.body.items.map((s: { id: string }) => s.id)).toContain(scheduleId)
  })

  it('an unrelated parent cannot view the schedule (mirrors HealthRecord cross-student privacy)', async () => {
    const otherStudent = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'student', name: 'Unrelated Student' })
    const otherParent = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'parent', name: 'Unrelated Parent', studentIds: [otherStudent.body.user.id] })
    const otherParentLogin = await login(app, otherParent.body.user.email, otherParent.body.password)
    const res = await request(app).get('/api/health/medication-schedules').query({ studentId: fx.ids.studentId }).set(authHeader(otherParentLogin.token))
    expect(res.status).toBe(403)
  })

  it('staff can log a dose administered against the schedule', async () => {
    const res = await request(app).post('/api/health/medication-logs').set(authHeader(fx.tokens.staff)).send({ scheduleId, notes: 'Given after breakfast' })
    expect(res.status).toBe(201)
    expect(res.body.item.scheduleId).toBe(scheduleId)
    expect(res.body.item.administeredById).toBe(fx.ids.staffId)

    const logs = await request(app).get('/api/health/medication-logs').query({ scheduleId }).set(authHeader(fx.tokens.staff))
    expect(logs.status).toBe(200)
    expect(logs.body.items.length).toBe(1)
  })

  it('the existing HealthRecord Allergy kind already exists and is unaffected by this extension', async () => {
    const res = await request(app).post('/api/health').set(authHeader(fx.tokens.staff)).send({
      studentId: fx.ids.studentId, kind: 'Allergy', title: 'Peanuts', detail: 'Anaphylaxis risk', date: '2026-01-01',
    })
    expect(res.status).toBe(201)
    expect(res.body.item.kind).toBe('Allergy')
  })
})
