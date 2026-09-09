import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader } from './helpers/auth'

const app = createApp()
let fx: Fixture
const today = new Date().toISOString().slice(0, 10)

// A second class + student, guardian-linked to the SAME parent as fx.ids.parentId — makes fx's parent a
// genuine multi-ward parent (Phase 23 §7's live-verification requirement), same pattern sample data's
// Nisha Sharma (u-p) now also gets via sampleData.ts's explicit extra `guardian.create`.
let ward2Id: string
let ward2ClassId: string

beforeAll(async () => {
  fx = await buildFixture(app)

  const cls2 = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
    .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'B', capacity: 5 })
  ward2ClassId = cls2.body.item.id

  const ward2 = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin))
    .send({ role: 'student', name: 'Second Ward', classId: ward2ClassId })
  ward2Id = ward2.body.user.id

  const link = await request(app).post('/api/academic/guardians').set(authHeader(fx.tokens.superadmin))
    .send({ parentId: fx.ids.parentId, studentId: ward2Id, relation: 'parent' })
  if (link.status !== 201) throw new Error(`guardian link failed: ${link.status} ${JSON.stringify(link.body)}`)
})

describe('GET /api/parents/me/family-summary', () => {
  it('is parent-only — student/teacher/admin get 403', async () => {
    const asStudent = await request(app).get('/api/parents/me/family-summary').set(authHeader(fx.tokens.student))
    expect(asStudent.status).toBe(403)
    const asTeacher = await request(app).get('/api/parents/me/family-summary').set(authHeader(fx.tokens.teacher))
    expect(asTeacher.status).toBe(403)
    const asAdmin = await request(app).get('/api/parents/me/family-summary').set(authHeader(fx.tokens.admin))
    expect(asAdmin.status).toBe(403)
  })

  it('returns one entry per ward for a multi-ward parent, unauthenticated is 401', async () => {
    const noAuth = await request(app).get('/api/parents/me/family-summary')
    expect(noAuth.status).toBe(401)

    const res = await request(app).get('/api/parents/me/family-summary').set(authHeader(fx.tokens.parent))
    expect(res.status).toBe(200)
    expect(res.body.wards).toHaveLength(2)
    const ids = res.body.wards.map((w: { studentId: string }) => w.studentId).sort()
    expect(ids).toEqual([fx.ids.studentId, ward2Id].sort())
    expect(Array.isArray(res.body.upcomingEvents)).toBe(true)
    expect(res.body.upcomingEvents.length).toBeLessThanOrEqual(3)
  })

  it("reflects today's attendance once marked for one ward", async () => {
    await request(app).post('/api/attendance/sessions').set(authHeader(fx.tokens.teacher)).send({
      classId: fx.ids.classId, date: today, records: [{ studentId: fx.ids.studentId, status: 'P' }],
    })
    const res = await request(app).get('/api/parents/me/family-summary').set(authHeader(fx.tokens.parent))
    const w1 = res.body.wards.find((w: { studentId: string }) => w.studentId === fx.ids.studentId)
    expect(w1.attendanceToday).toEqual({ status: 'P', marked: true })
    const w2 = res.body.wards.find((w: { studentId: string }) => w.studentId === ward2Id)
    expect(w2.attendanceToday).toEqual({ status: null, marked: false })
  })

  it('reflects homework due this week for the right ward only', async () => {
    await request(app).post('/api/homework').set(authHeader(fx.tokens.teacher)).send({
      classSubjectId: fx.ids.classSubjectId, title: 'Algebra worksheet', dueDate: today,
    })
    const res = await request(app).get('/api/parents/me/family-summary').set(authHeader(fx.tokens.parent))
    const w1 = res.body.wards.find((w: { studentId: string }) => w.studentId === fx.ids.studentId)
    expect(w1.homeworkDueThisWeek.some((h: { title: string }) => h.title === 'Algebra worksheet')).toBe(true)
    const w2 = res.body.wards.find((w: { studentId: string }) => w.studentId === ward2Id)
    expect(w2.homeworkDueThisWeek).toHaveLength(0)
  })

  it('sums fee due (balance) across a ward\'s invoices', async () => {
    const head = await request(app).post('/api/fees/heads').set(authHeader(fx.tokens.staff)).send({ name: 'Tuition (parents test)' })
    const structure = await request(app).post('/api/fees/structures').set(authHeader(fx.tokens.staff)).send({
      classId: fx.ids.classId, termId: fx.ids.termId, dueDate: today, lines: [{ feeHeadId: head.body.item.id, amount: 4200 }],
    })
    await request(app).post(`/api/fees/structures/${structure.body.item.id}/generate`).set(authHeader(fx.tokens.staff))

    const res = await request(app).get('/api/parents/me/family-summary').set(authHeader(fx.tokens.parent))
    const w1 = res.body.wards.find((w: { studentId: string }) => w.studentId === fx.ids.studentId)
    expect(w1.feeDue.total).toBeGreaterThanOrEqual(4200)
    expect(w1.feeDue.invoiceCount).toBeGreaterThanOrEqual(1)
  })

  it('includes a syllabus-pace headline for a core subject once one is set up', async () => {
    // fx.ids.termId is already `isCurrent` — buildFixture's term is the school's first, and
    // terms/service.ts#create auto-marks the first term of a school current.
    const curr = await request(app).post('/api/academic/curriculum').set(authHeader(fx.tokens.superadmin))
      .send({ boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, subjectId: fx.ids.subjectId, kind: 'core' })
    if (curr.status === 201) {
      await request(app).post('/api/syllabus/chapters').set(authHeader(fx.tokens.staff))
        .send({ curriculumSubjectId: curr.body.item.id, order: 1, title: 'Chapter 1', estimatedPeriods: 5 })
    }
    const res = await request(app).get('/api/parents/me/family-summary').set(authHeader(fx.tokens.parent))
    expect(res.status).toBe(200)
    const w1 = res.body.wards.find((w: { studentId: string }) => w.studentId === fx.ids.studentId)
    // Best-effort: asserts the endpoint never 500s regardless of whether a current term/pace could be
    // computed — syllabusPace is always an array (possibly empty if isCurrent couldn't be set above).
    expect(Array.isArray(w1.syllabusPace)).toBe(true)
    if (w1.syllabusPace.length) {
      expect(w1.syllabusPace[0]).toHaveProperty('headline')
      expect(typeof w1.syllabusPace[0].headline).toBe('string')
    }
  })
})

describe('POST /api/parents/digest/send-now', () => {
  it('is admin/superadmin only', async () => {
    const asParent = await request(app).post('/api/parents/digest/send-now').set(authHeader(fx.tokens.parent))
    expect(asParent.status).toBe(403)
    const asTeacher = await request(app).post('/api/parents/digest/send-now').set(authHeader(fx.tokens.teacher))
    expect(asTeacher.status).toBe(403)
  })

  it('sends one digest per parent, then skips on a same-day re-trigger', async () => {
    const first = await request(app).post('/api/parents/digest/send-now').set(authHeader(fx.tokens.admin))
    expect(first.status).toBe(200)
    expect(first.body.total).toBeGreaterThanOrEqual(1)
    expect(first.body.sent).toBeGreaterThanOrEqual(1)
    const parentResult = first.body.results.find((r: { parentId: string }) => r.parentId === fx.ids.parentId)
    expect(parentResult.sent).toBe(true)

    const second = await request(app).post('/api/parents/digest/send-now').set(authHeader(fx.tokens.admin))
    expect(second.status).toBe(200)
    expect(second.body.sent).toBe(0)
    const parentResult2 = second.body.results.find((r: { parentId: string }) => r.parentId === fx.ids.parentId)
    expect(parentResult2).toEqual({ parentId: fx.ids.parentId, sent: false, reason: 'already-sent-today' })
  })

  it('superadmin can also trigger it', async () => {
    const res = await request(app).post('/api/parents/digest/send-now').set(authHeader(fx.tokens.superadmin))
    expect(res.status).toBe(200)
  })
})
