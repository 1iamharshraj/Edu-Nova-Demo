import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader, login } from './helpers/auth'
import { prisma } from './helpers/db'

// Phase T9 — Substitution Workflow (phase-t9-substitution.md, roadmap D6). Read modules/timetable/
// substitution.ts's own doc comment first. This file exercises the phase's own required live-verification
// checks: the full TEACHER_INITIATED round trip, ADMIN_ASSIGNED skipping it, minimum-notice routing to
// emergency assignment, the PeriodHold race guard, tentative-hold auto-expiry, a genuine hard-constraint
// exclusion (unqualified/unavailable candidate), and — critically — that Phase 6's plain staff/non-teaching
// leave approval flow keeps working completely unchanged.
//
// Dates: TimetableEntry is a RECURRING weekly slot (dayOfWeek + periodIdx, no real calendar date), so there
// are only 6 truly distinct weekdays available for one teacher's schedule, and resolveLeavePeriods
// (substitution.ts) collects EVERY period that teacher has on a given weekday, across every class they
// teach. Rather than fight that with "N days from now" offset arithmetic (which reliably collided —
// discovered live during this phase's own build, see the final report), every independent scenario below
// that asserts an exact covered/uncovered period count is given its OWN dedicated weekday, computed
// deterministically from "today" so the file never depends on which day it happens to run. The shared
// fixture's Term runs 2026-06-01..2026-09-30 (fixed) — if this suite is ever run after that end date these
// date-dependent tests would need a fixture update (a pre-existing constraint of the shared fixture).

const app = createApp()
let fx: Fixture

const fmtUTC = (d: Date) => d.toISOString().slice(0, 10)
// The next date (strictly after today) whose UTC weekday is exactly `isoDow` (1=Mon..6=Sat).
function nextWeekday(isoDow: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  while (d.getUTCDay() !== isoDow) d.setUTCDate(d.getUTCDate() + 1)
  return d
}

// One dedicated weekday per independent scenario that derives periods from a leaveRequestId (Finder-by-
// leave, or leave approval) — see the file-level comment above for why this matters.
const DOW_SHARED = 6 // Saturday — hosts several small, non-count-sensitive checks together
const DOW_FULL_FLOW = 1
const DOW_DECLINE = 2
const DOW_ADMIN2 = 3
const DOW_EMERGENCY2 = 4
const DOW_EXPIRY = 5

let teacherBId: string, teacherBToken: string // qualified substitute
let teacherCId: string // NOT qualified — the hard-exclusion edge case
let teacherKavya2Id: string, teacherKavya2Token: string // second absent teacher, for the race-guard test
let teacherDId: string, teacherDToken: string // third absent teacher, race-guard case 2's "X" side
let classGId: string, classSubjectGId: string
let gradeOrder: number

beforeAll(async () => {
  fx = await buildFixture(app)
  await request(app).post('/api/timetable/constraints/seed-defaults').set(authHeader(fx.tokens.admin))
  // A default period template (auto-applies to every class with no periodTemplateId of its own — see
  // periodTemplates/service.ts#effectiveTemplate) — validateGrid requires one before any entry can be saved.
  // 6 periods (not the usual 3-4) so DOW_SHARED has room for several independent single-period checks.
  await request(app).post('/api/timetable/period-templates').set(authHeader(fx.tokens.superadmin)).send({
    name: 'T9 day',
    periods: [
      { idx: 0, label: 'P1', start: '09:00', end: '09:45', kind: 'class' },
      { idx: 1, label: 'P2', start: '09:45', end: '10:30', kind: 'class' },
      { idx: 2, label: 'P3', start: '10:30', end: '11:15', kind: 'class' },
      { idx: 3, label: 'P4', start: '11:15', end: '12:00', kind: 'class' },
      { idx: 4, label: 'P5', start: '12:00', end: '12:45', kind: 'class' },
      { idx: 5, label: 'P6', start: '12:45', end: '13:30', kind: 'class' },
    ],
  })

  const grades = await request(app).get('/api/academic/grades').set(authHeader(fx.tokens.admin))
  gradeOrder = (grades.body.items as { id: string; order: number }[]).find(g => g.id === fx.ids.gradeId)!.order

  const b = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'teacher', name: 'Priya Substitute' })
  teacherBId = b.body.user.id
  teacherBToken = (await login(app, b.body.user.email, b.body.password)).token
  await request(app).post('/api/academic/teacher-qualifications').set(authHeader(fx.tokens.admin)).send({
    teacherId: teacherBId, subjectId: fx.ids.subjectId, gradeRangeMin: gradeOrder, gradeRangeMax: gradeOrder, proficiency: 'PRIMARY', isPrimarySubject: true,
  })

  const c = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'teacher', name: 'Nikhil NoQual' })
  teacherCId = c.body.user.id
  // deliberately no TeacherQualification for teacherC — the Finder must hard-exclude them (cross-subject
  // substitution is off by default).

  const kavya2 = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'teacher', name: 'Rekha Kavya2' })
  teacherKavya2Id = kavya2.body.user.id
  teacherKavya2Token = (await login(app, kavya2.body.user.email, kavya2.body.password)).token
  const clsG = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
    .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'G', capacity: 2 })
  classGId = clsG.body.item.id
  const csG = await request(app).post('/api/academic/class-subjects').set(authHeader(fx.tokens.superadmin))
    .send({ classId: classGId, subjectId: fx.ids.subjectId, teacherId: teacherKavya2Id, periodsPerWeek: 5 })
  classSubjectGId = csG.body.item.id

  const d = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'teacher', name: 'Deepak D' })
  teacherDId = d.body.user.id
  teacherDToken = (await login(app, d.body.user.email, d.body.password)).token
})

// PUT /timetable/entries REPLACES the whole classId+termId grid, not just the given entry — so every call
// here accumulates onto whatever that class already has, rather than clobbering earlier seeded periods.
// roomId is always null: every class in this fixture would otherwise share the one fixture room, tripping
// the app's genuine room-collision check for scenarios that are deliberately about two different
// teachers/classes at the same day/period.
const entriesByClass = new Map<string, { dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId: null; teacherId: string }[]>()
async function seedEntry(classId: string, classSubjectId: string, teacherId: string, dayOfWeek: number, periodIdx: number) {
  const existing = (entriesByClass.get(classId) ?? []).filter(e => !(e.dayOfWeek === dayOfWeek && e.periodIdx === periodIdx))
  const next = [...existing, { dayOfWeek, periodIdx, classSubjectId, roomId: null, teacherId }]
  entriesByClass.set(classId, next)
  const res = await request(app).put('/api/timetable/entries').set(authHeader(fx.tokens.admin)).send({ classId, termId: fx.ids.termId, entries: next })
  if (res.status !== 200) console.error('seedEntry failed', classId, dayOfWeek, periodIdx, res.status, JSON.stringify(res.body))
  expect(res.status).toBe(200)
  return res.body.items.find((e: { dayOfWeek: number; periodIdx: number }) => e.dayOfWeek === dayOfWeek && e.periodIdx === periodIdx) as { id: string; dayOfWeek: number; periodIdx: number }
}

describe('T9 — Substitute Finder: hard exclusion + soft ranking', () => {
  it('excludes the unqualified teacher (hard constraint) and ranks the qualified one', async () => {
    const date = nextWeekday(DOW_SHARED)
    const entry = await seedEntry(fx.ids.classId, fx.ids.classSubjectId, fx.ids.teacherId, DOW_SHARED, 0)

    const res = await request(app).post('/api/timetable/substitution-finder').set(authHeader(fx.tokens.teacher)).send({
      teacherId: fx.ids.teacherId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_SHARED, periodIdx: 0, timetableEntryId: entry.id }],
    })
    expect(res.status).toBe(200)
    const result = res.body.periods[0]
    expect(result.candidates.some((c: { teacherId: string }) => c.teacherId === teacherBId)).toBe(true)
    expect(result.candidates.some((c: { teacherId: string }) => c.teacherId === teacherCId)).toBe(false)
    const excludedC = result.excluded.find((e: { teacherId: string }) => e.teacherId === teacherCId)
    expect(excludedC).toBeTruthy()
    expect(excludedC.reasons.join(' ')).toMatch(/not qualified/)
    // The Finder never suggests the absent teacher covering their own absence.
    expect(result.candidates.some((c: { teacherId: string }) => c.teacherId === fx.ids.teacherId)).toBe(false)
  })

  it('excludes a candidate declared UNAVAILABLE at that exact slot', async () => {
    const date = nextWeekday(DOW_SHARED)
    const entry = await seedEntry(fx.ids.classId, fx.ids.classSubjectId, fx.ids.teacherId, DOW_SHARED, 1)
    await request(app).put('/api/timetable/teacher-availability').set(authHeader(fx.tokens.admin)).send({
      teacherId: teacherBId, entries: [{ dayOfWeek: DOW_SHARED, periodIdx: 1, status: 'UNAVAILABLE' }],
    })
    const res = await request(app).post('/api/timetable/substitution-finder').set(authHeader(fx.tokens.teacher)).send({
      teacherId: fx.ids.teacherId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_SHARED, periodIdx: 1, timetableEntryId: entry.id }],
    })
    expect(res.status).toBe(200)
    const excluded = res.body.periods[0].excluded.find((e: { teacherId: string }) => e.teacherId === teacherBId)
    expect(excluded).toBeTruthy()
    expect(excluded.reasons.join(' ')).toMatch(/unavailable/)
    // Clear the UNAVAILABLE row so it doesn't leak into later tests reusing teacherB.
    await request(app).put('/api/timetable/teacher-availability').set(authHeader(fx.tokens.admin)).send({ teacherId: teacherBId, entries: [] })
  })
})

describe('T9 — full TEACHER_INITIATED flow', () => {
  let leaveRequestId: string
  let subRequestId: string
  let entry: { id: string; dayOfWeek: number; periodIdx: number }
  const date = nextWeekday(DOW_FULL_FLOW)

  it('sets up Kavya\'s absence and a leave request with sufficient notice', async () => {
    entry = await seedEntry(fx.ids.classId, fx.ids.classSubjectId, fx.ids.teacherId, DOW_FULL_FLOW, 0)

    const leave = await request(app).post('/api/leave/requests').set(authHeader(fx.tokens.teacher)).send({
      forUserId: fx.ids.teacherId, fromDate: fmtUTC(date), toDate: fmtUTC(date), reason: 'Medical',
    })
    expect(leave.status).toBe(201)
    expect(leave.body.item.status).toBe('Pending')
    leaveRequestId = leave.body.item.id
  })

  it('Finder run against the leaveRequestId derives the same periods automatically', async () => {
    const res = await request(app).post('/api/timetable/substitution-finder').set(authHeader(fx.tokens.teacher)).send({ leaveRequestId })
    expect(res.status).toBe(200)
    expect(res.body.periods).toHaveLength(1)
    expect(res.body.periods[0].period.timetableEntryId).toBe(entry.id)
    expect(res.body.periods[0].candidates.some((c: { teacherId: string }) => c.teacherId === teacherBId)).toBe(true)
  })

  it('the absent teacher sends a request — leave flips to PENDING_SUBSTITUTION and admin approval is blocked meanwhile', async () => {
    const res = await request(app).post('/api/timetable/substitution-requests').set(authHeader(fx.tokens.teacher)).send({
      leaveRequestId, substituteTeacherId: teacherBId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_FULL_FLOW, periodIdx: 0, timetableEntryId: entry.id }],
    })
    expect(res.status).toBe(201)
    expect(res.body.item.status).toBe('SENT')
    expect(res.body.item.mode).toBe('TEACHER_INITIATED')
    subRequestId = res.body.item.id

    const leave = await request(app).get('/api/leave/requests').query({ forUserId: fx.ids.teacherId }).set(authHeader(fx.tokens.admin))
    expect(leave.body.items.find((l: { id: string }) => l.id === leaveRequestId).status).toBe('PENDING_SUBSTITUTION')

    const blocked = await request(app).post(`/api/leave/requests/${leaveRequestId}/approve`).set(authHeader(fx.tokens.admin)).send({})
    expect(blocked.status).toBe(409)
  })

  it('a random other teacher may not accept on the invited substitute\'s behalf', async () => {
    const res = await request(app).post(`/api/timetable/substitution-requests/${subRequestId}/accept`).set(authHeader(fx.tokens.teacher))
    expect(res.status).toBe(403)
  })

  it('the substitute accepts — a TENTATIVE hold is placed and the leave request unblocks', async () => {
    // Accept as teacherB themselves (their own token) — proving the "substitute OR admin" authorization
    // really does include the substitute, not just admin acting on their behalf.
    const res = await request(app).post(`/api/timetable/substitution-requests/${subRequestId}/accept`).set(authHeader(teacherBToken))
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('ACCEPTED')

    const hold = await prisma.periodHold.findFirst({ where: { teacherId: teacherBId, sourceSubstitutionRequestId: subRequestId } })
    expect(hold?.holdType).toBe('TENTATIVE')
    expect(hold?.releasedAt).toBeNull()

    const leave = await request(app).get('/api/leave/requests').query({ forUserId: fx.ids.teacherId }).set(authHeader(fx.tokens.admin))
    expect(leave.body.items.find((l: { id: string }) => l.id === leaveRequestId).status).toBe('Pending')
  })

  it('PeriodHold race guard, case 1 — once accepted, a NEW overlapping request to the same substitute+slot is rejected up front (send-time hard-eligibility re-check)', async () => {
    const kEntry = await seedEntry(classGId, classSubjectGId, teacherKavya2Id, DOW_FULL_FLOW, 0) // same date+period, different teacher/class
    const kLeave = await request(app).post('/api/leave/requests').set(authHeader(teacherKavya2Token)).send({
      forUserId: teacherKavya2Id, fromDate: fmtUTC(date), toDate: fmtUTC(date), reason: 'Also absent that day',
    })
    expect(kLeave.status).toBe(201)
    // teacherB already holds a TENTATIVE hold for this exact (date, period) from the previous test's
    // accept — the very same hard-eligibility check the Finder itself uses catches it immediately.
    const kReq = await request(app).post('/api/timetable/substitution-requests').set(authHeader(fx.tokens.admin)).send({
      leaveRequestId: kLeave.body.item.id, substituteTeacherId: teacherBId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_FULL_FLOW, periodIdx: 0, timetableEntryId: kEntry.id }],
    })
    expect(kReq.status).toBe(409)
  })

  it('PeriodHold race guard, case 2 — two requests sent to the same substitute+slot BEFORE either is accepted: only the first accept wins, the second is rejected', async () => {
    // Two brand-new teachers (D and Kavya2) + classes, entirely independent of fx.ids.teacherId's own
    // full-flow leave above — keeps this case's extra periods from leaking into that leave's own
    // resolveLeavePeriods count (both share DOW_FULL_FLOW's weekday, deliberately, to prove the guard is
    // about the (teacher, date, period) triple, not which class/leave/day is involved).
    const cls2 = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
      .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'H', capacity: 2 })
    const cs2 = await request(app).post('/api/academic/class-subjects').set(authHeader(fx.tokens.superadmin))
      .send({ classId: cls2.body.item.id, subjectId: fx.ids.subjectId, teacherId: teacherDId, periodsPerWeek: 5 })
    const cls3 = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
      .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'I', capacity: 2 })
    const cs3 = await request(app).post('/api/academic/class-subjects').set(authHeader(fx.tokens.superadmin))
      .send({ classId: cls3.body.item.id, subjectId: fx.ids.subjectId, teacherId: teacherKavya2Id, periodsPerWeek: 5 })

    const entryX = await seedEntry(cls2.body.item.id, cs2.body.item.id, teacherDId, DOW_FULL_FLOW, 5)
    const entryY = await seedEntry(cls3.body.item.id, cs3.body.item.id, teacherKavya2Id, DOW_FULL_FLOW, 5) // same slot, different teacher/class

    const leaveX = await request(app).post('/api/leave/requests').set(authHeader(teacherDToken)).send({
      forUserId: teacherDId, fromDate: fmtUTC(date), toDate: fmtUTC(date), reason: 'Race case 2 — X',
    })
    const leaveY = await request(app).post('/api/leave/requests').set(authHeader(teacherKavya2Token)).send({
      forUserId: teacherKavya2Id, fromDate: fmtUTC(date), toDate: fmtUTC(date), reason: 'Race case 2 — Y',
    })

    const reqX = await request(app).post('/api/timetable/substitution-requests').set(authHeader(teacherDToken)).send({
      leaveRequestId: leaveX.body.item.id, substituteTeacherId: teacherBId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_FULL_FLOW, periodIdx: 5, timetableEntryId: entryX.id }],
    })
    const reqY = await request(app).post('/api/timetable/substitution-requests').set(authHeader(teacherKavya2Token)).send({
      leaveRequestId: leaveY.body.item.id, substituteTeacherId: teacherBId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_FULL_FLOW, periodIdx: 5, timetableEntryId: entryY.id }],
    })
    // Both SEND cleanly — neither has been accepted yet, so no hold exists for either at send time.
    expect(reqX.status).toBe(201)
    expect(reqY.status).toBe(201)

    const acceptX = await request(app).post(`/api/timetable/substitution-requests/${reqX.body.item.id}/accept`).set(authHeader(teacherBToken))
    expect(acceptX.status).toBe(200)

    // The second accept — same substitute, same exact (date, period), still a DIFFERENT SubstitutionRequest
    // — is correctly rejected by the PeriodHold race guard.
    const acceptY = await request(app).post(`/api/timetable/substitution-requests/${reqY.body.item.id}/accept`).set(authHeader(teacherBToken))
    expect(acceptY.status).toBe(409)

    // Clean up: decline the losing request so it doesn't linger as SENT.
    const decline = await request(app).post(`/api/timetable/substitution-requests/${reqY.body.item.id}/decline`).set(authHeader(teacherBToken)).send({})
    expect(decline.status).toBe(200)
  })

  it('admin approves the leave — the hold is promoted to LOCKED and a real Substitution row is written', async () => {
    const res = await request(app).post(`/api/leave/requests/${leaveRequestId}/approve`).set(authHeader(fx.tokens.admin)).send({})
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('Approved')
    expect(res.body.substitution.covered).toHaveLength(1)
    expect(res.body.substitution.uncovered).toHaveLength(0)

    const hold = await prisma.periodHold.findFirst({ where: { teacherId: teacherBId, sourceSubstitutionRequestId: subRequestId } })
    expect(hold?.holdType).toBe('LOCKED')
    expect(hold?.expiresAt).toBeNull()

    const subs = await request(app).get('/api/timetable/substitutions').query({ date: fmtUTC(date), teacherId: teacherBId }).set(authHeader(fx.tokens.admin))
    expect(subs.body.items.some((s: { substituteTeacherId: string; entry: { id: string } }) => s.substituteTeacherId === teacherBId && s.entry.id === entry.id)).toBe(true)
  })

  it('produced a real, inspectable audit trail for send/accept/apply-on-approval', async () => {
    const res = await request(app).get('/api/admin/audit').query({ entity: 'substitutionRequest', limit: 500 }).set(authHeader(fx.tokens.admin))
    expect(res.body.items.some((i: { action: string; entityId: string }) => i.action === 'send' && i.entityId === subRequestId)).toBe(true)
    expect(res.body.items.some((i: { action: string; entityId: string }) => i.action === 'accept' && i.entityId === subRequestId)).toBe(true)
  })
})

describe('T9 — a substitute declining a request', () => {
  it('declining unblocks the leave and leaves no lingering hold; approving then reports the period uncovered with a what-if suggestion', async () => {
    const date = nextWeekday(DOW_DECLINE)
    const entry = await seedEntry(fx.ids.classId, fx.ids.classSubjectId, fx.ids.teacherId, DOW_DECLINE, 0)
    const leave = await request(app).post('/api/leave/requests').set(authHeader(fx.tokens.teacher)).send({
      forUserId: fx.ids.teacherId, fromDate: fmtUTC(date), toDate: fmtUTC(date), reason: 'Personal',
    })
    const send = await request(app).post('/api/timetable/substitution-requests').set(authHeader(fx.tokens.teacher)).send({
      leaveRequestId: leave.body.item.id, substituteTeacherId: teacherBId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_DECLINE, periodIdx: 0, timetableEntryId: entry.id }],
    })
    expect(send.status).toBe(201)

    const decline = await request(app).post(`/api/timetable/substitution-requests/${send.body.item.id}/decline`).set(authHeader(teacherBToken)).send({ note: 'Not available' })
    expect(decline.status).toBe(200)
    expect(decline.body.item.status).toBe('DECLINED')

    const leaveAfter = await request(app).get('/api/leave/requests').query({ forUserId: fx.ids.teacherId }).set(authHeader(fx.tokens.admin))
    expect(leaveAfter.body.items.find((l: { id: string }) => l.id === leave.body.item.id).status).toBe('Pending')

    // Approving now correctly reports this period as uncovered, with a real explanation and a ready-to-use
    // what-if suggestion — no candidate was ever accepted for it.
    const approve = await request(app).post(`/api/leave/requests/${leave.body.item.id}/approve`).set(authHeader(fx.tokens.admin)).send({})
    expect(approve.status).toBe(200)
    expect(approve.body.substitution.uncovered).toHaveLength(1)
    expect(approve.body.substitution.whatIfSuggestion.changeEvent.type).toBe('TEACHER_UNAVAILABLE')
  })
})

describe('T9 — ADMIN_ASSIGNED mode skips the teacher-to-teacher round trip', () => {
  it('sets the school policy to ADMIN_ASSIGNED', async () => {
    const res = await request(app).put('/api/timetable/substitution-policy').set(authHeader(fx.tokens.admin)).send({ mode: 'ADMIN_ASSIGNED' })
    expect(res.status).toBe(200)
    expect(res.body.item.mode).toBe('ADMIN_ASSIGNED')
  })

  it('a teacher may no longer send a substitution request directly', async () => {
    const date = nextWeekday(DOW_SHARED)
    const entry = await seedEntry(fx.ids.classId, fx.ids.classSubjectId, fx.ids.teacherId, DOW_SHARED, 2)
    const leave = await request(app).post('/api/leave/requests').set(authHeader(fx.tokens.teacher)).send({
      forUserId: fx.ids.teacherId, fromDate: fmtUTC(date), toDate: fmtUTC(date), reason: 'Medical',
    })
    const res = await request(app).post('/api/timetable/substitution-requests').set(authHeader(fx.tokens.teacher)).send({
      leaveRequestId: leave.body.item.id, substituteTeacherId: teacherBId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_SHARED, periodIdx: 2, timetableEntryId: entry.id }],
    })
    expect(res.status).toBe(403)
  })

  it('an admin assigns directly — the request is created already ACCEPTED, no round trip, and the leave never enters PENDING_SUBSTITUTION', async () => {
    const date = nextWeekday(DOW_ADMIN2)
    const entry = await seedEntry(fx.ids.classId, fx.ids.classSubjectId, fx.ids.teacherId, DOW_ADMIN2, 0)
    // Leave creation itself is still self/parent-only (unchanged Phase 6 rule — admin's role here is
    // assigning the substitute, not filing leave on the teacher's behalf).
    const leave = await request(app).post('/api/leave/requests').set(authHeader(fx.tokens.teacher)).send({
      forUserId: fx.ids.teacherId, fromDate: fmtUTC(date), toDate: fmtUTC(date), reason: 'Medical',
    })
    const res = await request(app).post('/api/timetable/substitution-requests').set(authHeader(fx.tokens.admin)).send({
      leaveRequestId: leave.body.item.id, substituteTeacherId: teacherBId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_ADMIN2, periodIdx: 0, timetableEntryId: entry.id }],
    })
    expect(res.status).toBe(201)
    expect(res.body.item.status).toBe('ACCEPTED')
    expect(res.body.item.mode).toBe('ADMIN_ASSIGNED')

    const leaveCheck = await request(app).get('/api/leave/requests').query({ forUserId: fx.ids.teacherId }).set(authHeader(fx.tokens.admin))
    expect(leaveCheck.body.items.find((l: { id: string }) => l.id === leave.body.item.id).status).toBe('Pending')

    const approve = await request(app).post(`/api/leave/requests/${leave.body.item.id}/approve`).set(authHeader(fx.tokens.admin)).send({})
    expect(approve.status).toBe(200)
    expect(approve.body.substitution.covered).toHaveLength(1)
  })

  it('resets the policy back to TEACHER_INITIATED for the remaining tests', async () => {
    const res = await request(app).put('/api/timetable/substitution-policy').set(authHeader(fx.tokens.admin)).send({ mode: 'TEACHER_INITIATED' })
    expect(res.body.item.mode).toBe('TEACHER_INITIATED')
  })
})

describe('T9 — minimum-notice routing to emergency assignment', () => {
  it('sets an artificially huge (but schema-valid, max 720h/30d) notice requirement so ANY leave in this file counts as insufficient notice, deterministically', async () => {
    const res = await request(app).put('/api/timetable/substitution-policy').set(authHeader(fx.tokens.admin)).send({ minNoticeHoursForSubstitution: 720 })
    expect(res.status).toBe(200)
    expect(res.body.item.minNoticeHoursForSubstitution).toBe(720)
  })

  it('a teacher may not send even a well-in-advance request once notice is insufficient by policy', async () => {
    const date = nextWeekday(DOW_SHARED)
    const entry = await seedEntry(fx.ids.classId, fx.ids.classSubjectId, fx.ids.teacherId, DOW_SHARED, 3)
    const leave = await request(app).post('/api/leave/requests').set(authHeader(fx.tokens.teacher)).send({
      forUserId: fx.ids.teacherId, fromDate: fmtUTC(date), toDate: fmtUTC(date), reason: 'Medical',
    })
    const res = await request(app).post('/api/timetable/substitution-requests').set(authHeader(fx.tokens.teacher)).send({
      leaveRequestId: leave.body.item.id, substituteTeacherId: teacherBId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_SHARED, periodIdx: 3, timetableEntryId: entry.id }],
    })
    expect(res.status).toBe(403)
  })

  it('an admin routes it straight to emergency assignment via the same Finder — no round trip', async () => {
    const date = nextWeekday(DOW_EMERGENCY2)
    const entry = await seedEntry(fx.ids.classId, fx.ids.classSubjectId, fx.ids.teacherId, DOW_EMERGENCY2, 0)
    const leave = await request(app).post('/api/leave/requests').set(authHeader(fx.tokens.teacher)).send({
      forUserId: fx.ids.teacherId, fromDate: fmtUTC(date), toDate: fmtUTC(date), reason: 'Medical',
    })
    const finder = await request(app).post('/api/timetable/substitution-finder').set(authHeader(fx.tokens.admin)).send({ leaveRequestId: leave.body.item.id })
    expect(finder.status).toBe(200)
    expect(finder.body.periods[0].candidates.some((c: { teacherId: string }) => c.teacherId === teacherBId)).toBe(true)

    const res = await request(app).post('/api/timetable/substitution-requests').set(authHeader(fx.tokens.admin)).send({
      leaveRequestId: leave.body.item.id, substituteTeacherId: teacherBId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_EMERGENCY2, periodIdx: 0, timetableEntryId: entry.id }],
    })
    expect(res.status).toBe(201)
    expect(res.body.item.status).toBe('ACCEPTED')
    expect(res.body.item.mode).toBe('EMERGENCY')
  })

  it('resets the notice policy back to the default for the remaining tests', async () => {
    const res = await request(app).put('/api/timetable/substitution-policy').set(authHeader(fx.tokens.admin)).send({ minNoticeHoursForSubstitution: 12 })
    expect(res.body.item.minNoticeHoursForSubstitution).toBe(12)
  })
})

describe('T9 — tentative-hold auto-expiry', () => {
  it('a TENTATIVE hold past its expiresAt is released, and its still-ACCEPTED request flips to EXPIRED', async () => {
    const date = nextWeekday(DOW_EXPIRY)
    const entry = await seedEntry(fx.ids.classId, fx.ids.classSubjectId, fx.ids.teacherId, DOW_EXPIRY, 0)
    const leave = await request(app).post('/api/leave/requests').set(authHeader(fx.tokens.teacher)).send({
      forUserId: fx.ids.teacherId, fromDate: fmtUTC(date), toDate: fmtUTC(date), reason: 'Medical',
    })
    const send = await request(app).post('/api/timetable/substitution-requests').set(authHeader(fx.tokens.teacher)).send({
      leaveRequestId: leave.body.item.id, substituteTeacherId: teacherBId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_EXPIRY, periodIdx: 0, timetableEntryId: entry.id }],
    })
    const accept = await request(app).post(`/api/timetable/substitution-requests/${send.body.item.id}/accept`).set(authHeader(teacherBToken))
    expect(accept.status).toBe(200)

    // Force the hold into the past directly (this codebase has no cron/fake-timers harness for a real
    // multi-minute wait) — exactly what the lazy-expiry endpoint is for: sweeping whatever is actually due.
    await prisma.periodHold.updateMany({ where: { sourceSubstitutionRequestId: send.body.item.id }, data: { expiresAt: new Date(Date.now() - 60_000) } })

    const sweep = await request(app).post('/api/timetable/substitution-holds/expire-stale').set(authHeader(fx.tokens.admin))
    expect(sweep.status).toBe(200)
    expect(sweep.body.expired).toBeGreaterThanOrEqual(1)

    const hold = await prisma.periodHold.findFirst({ where: { sourceSubstitutionRequestId: send.body.item.id } })
    expect(hold?.releasedAt).not.toBeNull()
    const reqAfter = await request(app).get('/api/timetable/substitution-requests').query({ leaveRequestId: leave.body.item.id }).set(authHeader(fx.tokens.admin))
    expect(reqAfter.body.items[0].status).toBe('EXPIRED')

    // And the now-stale-freed slot is offered to the Finder again as a live candidate.
    const finder = await request(app).post('/api/timetable/substitution-finder').set(authHeader(fx.tokens.admin)).send({ leaveRequestId: leave.body.item.id })
    expect(finder.body.periods[0].candidates.some((c: { teacherId: string }) => c.teacherId === teacherBId)).toBe(true)
  })
})

describe('T9 — critical regression: plain staff/non-teaching leave keeps working unchanged', () => {
  it('a staff member\'s leave approves directly, with no substitution branch ever touched', async () => {
    const leave = await request(app).post('/api/leave/requests').set(authHeader(fx.tokens.staff)).send({
      forUserId: fx.ids.staffId, fromDate: '2026-07-06', toDate: '2026-07-07', reason: 'Family function',
    })
    expect(leave.status).toBe(201)
    expect(leave.body.item.status).toBe('Pending') // never PENDING_SUBSTITUTION

    const approve = await request(app).post(`/api/leave/requests/${leave.body.item.id}/approve`).set(authHeader(fx.tokens.admin)).send({})
    expect(approve.status).toBe(200)
    expect(approve.body.item.status).toBe('Approved')
    expect(approve.body.substitution).toBeUndefined()
  })

  it('a student\'s leave (Phase 6, class-teacher-approved) is likewise completely untouched', async () => {
    const leave = await request(app).post('/api/leave/requests').set(authHeader(fx.tokens.parent)).send({
      forUserId: fx.ids.studentId, fromDate: '2026-07-06', toDate: '2026-07-06', reason: 'Sick',
    })
    expect(leave.status).toBe(201)
    const approve = await request(app).post(`/api/leave/requests/${leave.body.item.id}/approve`).set(authHeader(fx.tokens.teacher)).send({})
    expect(approve.status).toBe(200)
    expect(approve.body.item.status).toBe('Approved')
    expect(approve.body.substitution).toBeUndefined()
  })

  it('a teacher\'s own leave that happens to touch zero timetabled periods (e.g. a day the teacher has no periods at all) also approves cleanly', async () => {
    // Sunday — resolveLeavePeriods always returns [] for a Sunday-only range (matches leave/service.ts's own
    // countDays Sunday-exclusion convention), so this is a real "teacher leave, zero covered periods" case.
    const leave = await request(app).post('/api/leave/requests').set(authHeader(fx.tokens.teacher)).send({
      forUserId: fx.ids.teacherId, fromDate: '2026-07-05', toDate: '2026-07-05', reason: 'Sunday errand',
    })
    expect(leave.status).toBe(201)
    const approve = await request(app).post(`/api/leave/requests/${leave.body.item.id}/approve`).set(authHeader(fx.tokens.admin)).send({})
    expect(approve.status).toBe(200)
    expect(approve.body.item.status).toBe('Approved')
    expect(approve.body.substitution).toBeUndefined()
  })
})

describe('T9 — chained absence (substitution backfill)', () => {
  it('if an accepted substitute later reports their own overlapping leave, their commitment is expired and flagged', async () => {
    const date = nextWeekday(DOW_SHARED)
    const entry = await seedEntry(fx.ids.classId, fx.ids.classSubjectId, fx.ids.teacherId, DOW_SHARED, 4)
    const leave = await request(app).post('/api/leave/requests').set(authHeader(fx.tokens.teacher)).send({
      forUserId: fx.ids.teacherId, fromDate: fmtUTC(date), toDate: fmtUTC(date), reason: 'Medical',
    })
    const send = await request(app).post('/api/timetable/substitution-requests').set(authHeader(fx.tokens.teacher)).send({
      leaveRequestId: leave.body.item.id, substituteTeacherId: teacherBId,
      periods: [{ date: fmtUTC(date), dayOfWeek: DOW_SHARED, periodIdx: 4, timetableEntryId: entry.id }],
    })
    const accept = await request(app).post(`/api/timetable/substitution-requests/${send.body.item.id}/accept`).set(authHeader(teacherBToken))
    expect(accept.status).toBe(200)

    // Now teacherB (the accepted substitute) reports their own overlapping absence.
    const bLeave = await request(app).post('/api/leave/requests').set(authHeader(teacherBToken)).send({
      forUserId: teacherBId, fromDate: fmtUTC(date), toDate: fmtUTC(date), reason: 'TeacherB also unwell',
    })
    expect(bLeave.status).toBe(201)

    const reqAfter = await request(app).get('/api/timetable/substitution-requests').query({ leaveRequestId: leave.body.item.id }).set(authHeader(fx.tokens.admin))
    expect(reqAfter.body.items.find((r: { id: string }) => r.id === send.body.item.id).status).toBe('EXPIRED')

    const hold = await prisma.periodHold.findFirst({ where: { sourceSubstitutionRequestId: send.body.item.id } })
    expect(hold?.releasedAt).not.toBeNull()

    const auditRes = await request(app).get('/api/admin/audit').query({ entity: 'leaveRequest', limit: 500 }).set(authHeader(fx.tokens.admin))
    expect(auditRes.body.items.some((i: { action: string; entityId: string }) => i.action === 'chained-absence-backfill' && i.entityId === bLeave.body.item.id)).toBe(true)
  })
})

describe('T9 RBAC', () => {
  it('a student cannot update the school substitution policy', async () => {
    const res = await request(app).put('/api/timetable/substitution-policy').set(authHeader(fx.tokens.student)).send({ mode: 'HYBRID' })
    expect(res.status).toBe(403)
  })
})
