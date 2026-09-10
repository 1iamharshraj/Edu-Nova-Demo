import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader } from './helpers/auth'

// Phase T3 — sectioning engine (phase-t3-sectioning-engine.md). buildFixture gives us VIII-A with the
// fixture student enrolled + a Maths ClassSubject with published-assessment machinery already wired up
// (Phase 3). This file adds a second/third section (classB/classC) under the same grade, five more
// students with real Mark scores spread across bands, then exercises: BALANCED + SKIM_THEN_BALANCE
// generation, an intentionally-broken band-mix config caught by validation, and the track two-stage
// pipeline (STRICT rejection, ADVISORY flag-through, authorized override + exceptions report).

const app = createApp()
let fx: Fixture

let classBId: string
let classCId: string
let cohortAId: string
let cohortBId: string
let cohortCId: string
let studentIds: string[] // fixture student + 5 more, 6 total
let termId: string
let balancedTemplateId: string
let balancedVersionId: string

async function createStudent(name: string) {
  const res = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'student', name, classId: fx.ids.classId })
  expect(res.status).toBe(201)
  return res.body.user.id as string
}

beforeAll(async () => {
  fx = await buildFixture(app)
  termId = fx.ids.termId

  // The fixture's own class A ships with capacity 2 (fine for its own single-student tests) — this file
  // puts 6 students through it, so widen it before any sectioning run that might land several there.
  await request(app).patch(`/api/academic/classes/${fx.ids.classId}`).set(authHeader(fx.tokens.superadmin)).send({ capacity: 10 })

  const clsB = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
    .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'B', capacity: 10 })
  classBId = clsB.body.item.id
  const clsC = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
    .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'C', capacity: 10 })
  classCId = clsC.body.item.id

  const cohorts = await request(app).get('/api/academic/cohorts').query({ academicYearId: fx.ids.yearId }).set(authHeader(fx.tokens.admin))
  cohortAId = cohorts.body.items.find((c: { classIds: string[] }) => c.classIds.includes(fx.ids.classId)).id
  cohortBId = cohorts.body.items.find((c: { classIds: string[] }) => c.classIds.includes(classBId)).id
  cohortCId = cohorts.body.items.find((c: { classIds: string[] }) => c.classIds.includes(classCId)).id

  // 5 more students (all start in class A, per createUser) alongside the fixture's own student — 6 total.
  const extra = await Promise.all(['Aditi', 'Rohan', 'Kiran', 'Meera', 'Sameer'].map(createStudent))
  studentIds = [fx.ids.studentId, ...extra]

  // Real Phase 3 marks: a published assessment on the fixture's Maths ClassSubject, one score per student,
  // deliberately spread across low/mid/high so BALANCED has real band mixing to do.
  const assessment = await request(app).post('/api/assessments').set(authHeader(fx.tokens.teacher))
    .send({ classSubjectId: fx.ids.classSubjectId, termId, name: 'Unit Test 1', maxMarks: 100 })
  const assessmentId = assessment.body.item.id as string
  const scores = [30, 40, 55, 60, 85, 92] // studentIds[i] -> scores[i]
  await request(app).put(`/api/assessments/${assessmentId}/marks`).set(authHeader(fx.tokens.teacher))
    .send({ marks: studentIds.map((studentId, i) => ({ studentId, score: scores[i] })) })
  await request(app).post(`/api/assessments/${assessmentId}/publish`).set(authHeader(fx.tokens.teacher))
})

describe('T3 §1 — PerformanceBand', () => {
  let bandLowId: string, bandMidId: string, bandHighId: string

  it('creates 3 neutral-label bands spanning 0-100', async () => {
    const low = await request(app).post('/api/sectioning/bands').set(authHeader(fx.tokens.admin))
      .send({ academicYearId: fx.ids.yearId, label: 'Band C', minScore: 0, maxScore: 49 })
    const mid = await request(app).post('/api/sectioning/bands').set(authHeader(fx.tokens.admin))
      .send({ academicYearId: fx.ids.yearId, label: 'Band B', minScore: 50, maxScore: 74 })
    const high = await request(app).post('/api/sectioning/bands').set(authHeader(fx.tokens.admin))
      .send({ academicYearId: fx.ids.yearId, label: 'Band A', minScore: 75, maxScore: 100 })
    expect(low.status).toBe(201); expect(mid.status).toBe(201); expect(high.status).toBe(201)
    bandLowId = low.body.item.id; bandMidId = mid.body.item.id; bandHighId = high.body.item.id
  })

  it('non-admin roles cannot create a band', async () => {
    const res = await request(app).post('/api/sectioning/bands').set(authHeader(fx.tokens.staff))
      .send({ academicYearId: fx.ids.yearId, label: 'nope', minScore: 0, maxScore: 10 })
    expect(res.status).toBe(403)
  })

  describe('T3 §2/§4 — BALANCED generation, validation, approval', () => {
    it('creates a BALANCED template targeting sections A and B', async () => {
      const res = await request(app).post('/api/sectioning/templates').set(authHeader(fx.tokens.admin)).send({
        academicYearId: fx.ids.yearId, gradeId: fx.ids.gradeId, name: 'Grade VIII rebalance', strategy: 'BALANCED',
        scoreSource: 'EXAM_AVERAGE', bandIds: [bandLowId, bandMidId, bandHighId], sectionOrder: [cohortAId, cohortBId],
      })
      expect(res.status).toBe(201)
      balancedTemplateId = res.body.item.id
    })

    it('generates a real DRAFT and every scored student lands in exactly one section with no validation errors', async () => {
      const res = await request(app).post(`/api/sectioning/templates/${balancedTemplateId}/generate`).set(authHeader(fx.tokens.admin)).send({})
      expect(res.status).toBe(201)
      expect(res.body.item.status).toBe('DRAFT')
      const assignments = res.body.item.assignments as { studentId: string; cohortId: string; score?: number }[]
      expect(assignments).toHaveLength(6)
      // every scored student assigned exactly once
      expect(new Set(assignments.map(a => a.studentId)).size).toBe(6)
      expect(res.body.item.summary.validation.errors).toEqual([])
      // band mix should be non-trivially split across both sections, not all-or-nothing.
      const secA = assignments.filter(a => a.cohortId === cohortAId).length
      const secB = assignments.filter(a => a.cohortId === cohortBId).length
      expect(secA).toBeGreaterThan(0)
      expect(secB).toBeGreaterThan(0)
      balancedVersionId = res.body.item.id
    })

    // Deliberately deferred to the very end of this file (see the final describe block below) — it's the
    // only test in this file that actually moves students between classes (writes Enrollment.classId), and
    // every score computed here is scoped to a student's *current* class's assessments (real system
    // behavior — a school's own assessments live per-class). Running it last keeps every earlier
    // generate-only test's population fully scored, exactly as a school would see the first time they use
    // this template before ever having approved a re-section.
  })

  describe('T3 §2 — SKIM_THEN_BALANCE composition', () => {
    it('skims the top scorer into section C, balances the remainder across A and B via the real BALANCED function', async () => {
      const tpl = await request(app).post('/api/sectioning/templates').set(authHeader(fx.tokens.admin)).send({
        academicYearId: fx.ids.yearId, gradeId: fx.ids.gradeId, name: 'Skim top scorer', strategy: 'SKIM_THEN_BALANCE',
        scoreSource: 'EXAM_AVERAGE', bandIds: [bandLowId, bandMidId, bandHighId], sectionOrder: [cohortAId, cohortBId, cohortCId],
        distributionConfig: { skim: [{ sectionId: cohortCId, count: 1 }], remainderStrategy: 'BALANCED' },
      })
      expect(tpl.status).toBe(201)

      const gen = await request(app).post(`/api/sectioning/templates/${tpl.body.item.id}/generate`).set(authHeader(fx.tokens.admin)).send({})
      expect(gen.status).toBe(201)
      const assignments = gen.body.item.assignments as { studentId: string; cohortId: string; score?: number }[]
      // the highest-scoring student (score 92, studentIds[5]) must be the one skimmed into section C.
      const topScorer = studentIds[5]
      const topAssignment = assignments.find(a => a.studentId === topScorer)
      expect(topAssignment?.cohortId).toBe(cohortCId)
      // nobody else landed in section C — the skim took exactly 1.
      expect(assignments.filter(a => a.cohortId === cohortCId)).toHaveLength(1)
      // the remainder (5 students) is split across A and B, not dumped entirely into one.
      const remainderA = assignments.filter(a => a.cohortId === cohortAId).length
      const remainderB = assignments.filter(a => a.cohortId === cohortBId).length
      expect(remainderA + remainderB).toBe(5)
      expect(remainderA).toBeGreaterThan(0)
      expect(remainderB).toBeGreaterThan(0)
    })
  })

  describe('T3 §4 — band-mix validation catches an intentionally-broken config', () => {
    it('RANKED (no band balancing at all) against a near-zero tolerance produces validation errors, blocking approval without force', async () => {
      const tpl = await request(app).post('/api/sectioning/templates').set(authHeader(fx.tokens.admin)).send({
        academicYearId: fx.ids.yearId, gradeId: fx.ids.gradeId, name: 'Broken config', strategy: 'RANKED',
        scoreSource: 'EXAM_AVERAGE', bandIds: [bandLowId, bandMidId, bandHighId], sectionOrder: [cohortAId, cohortBId],
        distributionConfig: { bandMixTolerancePct: 1 },
      })
      const gen = await request(app).post(`/api/sectioning/templates/${tpl.body.item.id}/generate`).set(authHeader(fx.tokens.admin)).send({})
      expect(gen.status).toBe(201)
      expect(gen.body.item.summary.validation.errors.length).toBeGreaterThan(0)

      const approve = await request(app).post(`/api/sectioning/versions/${gen.body.item.id}/approve`).set(authHeader(fx.tokens.admin)).send({})
      expect(approve.status).toBe(409)
      expect(approve.body.details.errors.length).toBeGreaterThan(0)

      const approveForced = await request(app).post(`/api/sectioning/versions/${gen.body.item.id}/approve`).set(authHeader(fx.tokens.admin)).send({ force: true })
      expect(approveForced.status).toBe(200)
      expect(approveForced.body.item.status).toBe('APPROVED')
    })
  })
})

describe('T3 §3 — track two-stage pipeline', () => {
  let trackCohortId: string
  let strictActivityId: string
  let advisoryActivityId: string
  const failingStudent = () => studentIds[0] // score 30 — fails any realistic minScore rule

  beforeAll(async () => {
    const cohort = await request(app).post('/api/academic/cohorts').set(authHeader(fx.tokens.superadmin)).send({
      name: 'VIII-JEE', academicYearId: fx.ids.yearId, gradeId: fx.ids.gradeId, type: 'TRACK', classIds: [fx.ids.classId, classBId],
    })
    trackCohortId = cohort.body.item.id
  })

  it('sets up a STRICT-rule track activity and an ADVISORY-rule track activity', async () => {
    const strict = await request(app).post('/api/activities').set(authHeader(fx.tokens.staff)).send({
      kind: 'track', title: 'JEE Track (strict)', description: 'Strict eligibility', forRoles: ['student'], trackCohortId,
    })
    expect(strict.status).toBe(201)
    strictActivityId = strict.body.item.id
    const rule = await request(app).post('/api/sectioning/track-eligibility-rules').set(authHeader(fx.tokens.admin)).send({
      trackActivityId: strictActivityId, label: 'Maths >= 80', enforcementMode: 'STRICT',
      subjectScoreRules: [{ subjectId: fx.ids.subjectId, minScore: 80 }],
    })
    expect(rule.status).toBe(201)

    const advisory = await request(app).post('/api/activities').set(authHeader(fx.tokens.staff)).send({
      kind: 'track', title: 'JEE Track (advisory)', description: 'Advisory eligibility', forRoles: ['student'], trackCohortId,
    })
    advisoryActivityId = advisory.body.item.id
    const advisoryRule = await request(app).post('/api/sectioning/track-eligibility-rules').set(authHeader(fx.tokens.admin)).send({
      trackActivityId: advisoryActivityId, label: 'Maths >= 80 (advisory)', enforcementMode: 'ADVISORY',
      subjectScoreRules: [{ subjectId: fx.ids.subjectId, minScore: 80 }],
    })
    expect(advisoryRule.status).toBe(201)
  })

  it('rejects a STRICT-failing self-registration outright, naming the unmet rule', async () => {
    // failingStudent (score 30) needs their own login — reuse the student endpoint isn't available here,
    // so register via staff-on-behalf path is what we exercise for the rejection (staff without a reason).
    const res = await request(app).post(`/api/sectioning/tracks/${strictActivityId}/register`).set(authHeader(fx.tokens.staff))
      .send({ studentId: failingStudent() })
    expect(res.status).toBe(409)
    expect(res.body.details.failedRules[0].label).toBe('Maths >= 80')
  })

  it('an authorized override with a mandatory reason succeeds and appears in the exceptions report', async () => {
    const res = await request(app).post(`/api/sectioning/tracks/${strictActivityId}/register`).set(authHeader(fx.tokens.staff))
      .send({ studentId: failingStudent(), overrideReason: 'Principal-approved exception — strong extracurricular record' })
    expect(res.status).toBe(201)
    expect(res.body.eligibility.overridden).toBe(true)

    const exceptions = await request(app).get('/api/sectioning/track-eligibility-exceptions').query({ trackActivityId: strictActivityId }).set(authHeader(fx.tokens.admin))
    expect(exceptions.status).toBe(200)
    const mine = exceptions.body.items.find((e: { studentId: string; type: string }) => e.studentId === failingStudent() && e.type === 'STRICT_OVERRIDE')
    expect(mine).toBeTruthy()
    expect(mine.reason).toContain('Principal-approved')
    expect(mine.approvedByName).toBeTruthy()
  })

  it('an override without a reason is rejected even for staff', async () => {
    const res = await request(app).post(`/api/sectioning/tracks/${strictActivityId}/register`).set(authHeader(fx.tokens.staff))
      .send({ studentId: studentIds[1] })
    expect(res.status).toBe(409)
  })

  it('an ADVISORY-failing registration is allowed through but flagged in the exceptions report', async () => {
    const res = await request(app).post(`/api/sectioning/tracks/${advisoryActivityId}/register`).set(authHeader(fx.tokens.staff))
      .send({ studentId: failingStudent() })
    expect(res.status).toBe(201)
    expect(res.body.eligibility.overridden).toBe(false)
    expect(res.body.eligibility.passed).toBe(false)
    expect(res.body.eligibility.failedAdvisory).toHaveLength(1)

    const exceptions = await request(app).get('/api/sectioning/track-eligibility-exceptions').query({ trackActivityId: advisoryActivityId }).set(authHeader(fx.tokens.admin))
    const mine = exceptions.body.items.find((e: { studentId: string; type: string }) => e.studentId === failingStudent() && e.type === 'ADVISORY_FLAG')
    expect(mine).toBeTruthy()
    expect(mine.reason).toBeUndefined()
  })

  it('non-staff cannot view the exceptions report', async () => {
    const res = await request(app).get('/api/sectioning/track-eligibility-exceptions').set(authHeader(fx.tokens.parent))
    expect(res.status).toBe(403)
  })

  it('Stage 2 — a BALANCED sub-sectioning run scoped to the track cohort only sees its registered members', async () => {
    const subA = await request(app).post('/api/academic/cohorts').set(authHeader(fx.tokens.superadmin)).send({
      name: 'JEE-A', academicYearId: fx.ids.yearId, gradeId: fx.ids.gradeId, type: 'TRACK', classIds: [fx.ids.classId],
    })
    const subB = await request(app).post('/api/academic/cohorts').set(authHeader(fx.tokens.superadmin)).send({
      name: 'JEE-B', academicYearId: fx.ids.yearId, gradeId: fx.ids.gradeId, type: 'TRACK', classIds: [classBId],
    })
    const tpl = await request(app).post('/api/sectioning/templates').set(authHeader(fx.tokens.admin)).send({
      academicYearId: fx.ids.yearId, gradeId: fx.ids.gradeId, name: 'JEE sub-sections', strategy: 'BALANCED', scoreSource: 'EXAM_AVERAGE',
      bandIds: [], sectionOrder: [subA.body.item.id, subB.body.item.id],
    })
    const gen = await request(app).post(`/api/sectioning/templates/${tpl.body.item.id}/generate`).set(authHeader(fx.tokens.admin))
      .send({ scopeCohortId: trackCohortId })
    expect(gen.status).toBe(201)
    // only failingStudent was ever confirmed into trackCohortId via the two register() calls above, so the
    // Stage-2 population (assigned + unscored — they may have no assessment recorded in whatever class the
    // earlier section-reassignment tests left them in) must be exactly that one student, nobody else.
    const assignedIds = (gen.body.item.assignments as { studentId: string }[]).map(a => a.studentId)
    const unscored = gen.body.item.summary.unscoredStudentIds as string[]
    const population = new Set([...assignedIds, ...unscored])
    expect(population.has(failingStudent())).toBe(true)
    expect(population.size).toBe(1)
  })
})

// Kept as the final describe in the file — the only test that actually approves the original BALANCED
// draft from earlier and writes real Enrollment.classId changes (see the comment left in its place above).
describe('T3 §4 — approve() writes real Enrollment.classId + Cohort membership changes', () => {
  it('approving the BALANCED draft moves each student to the class backing their assigned section', async () => {
    const draft = await request(app).get(`/api/sectioning/versions/${balancedVersionId}`).set(authHeader(fx.tokens.admin))
    expect(draft.status).toBe(200)

    const approve = await request(app).post(`/api/sectioning/versions/${balancedVersionId}/approve`).set(authHeader(fx.tokens.admin)).send({})
    expect(approve.status).toBe(200)
    expect(approve.body.item.status).toBe('APPROVED')

    const enrollments = await request(app).get('/api/academic/enrollments').set(authHeader(fx.tokens.admin))
    const bySection = new Map<string, string>()
    for (const a of approve.body.item.assignments as { studentId: string; cohortId: string }[]) bySection.set(a.studentId, a.cohortId)
    for (const e of enrollments.body.items as { studentId: string; classId: string }[]) {
      const targetCohortId = bySection.get(e.studentId)
      if (targetCohortId === cohortAId) expect(e.classId).toBe(fx.ids.classId)
      if (targetCohortId === cohortBId) expect(e.classId).toBe(classBId)
    }

    // Re-approving an already-APPROVED version is rejected.
    const again = await request(app).post(`/api/sectioning/versions/${balancedVersionId}/approve`).set(authHeader(fx.tokens.admin)).send({})
    expect(again.status).toBe(400)
  })

  it('an individual audited move reassigns one student outside the version pipeline', async () => {
    const target = studentIds[2]
    const res = await request(app).post('/api/sectioning/moves').set(authHeader(fx.tokens.admin)).send({
      studentId: target, toCohortId: cohortBId, reason: 'Parent request — moving to be with a specific teacher',
    })
    expect(res.status).toBe(201)
    const enrollments = await request(app).get('/api/academic/enrollments').set(authHeader(fx.tokens.admin))
    const enr = enrollments.body.items.find((e: { studentId: string }) => e.studentId === target)
    expect(enr.classId).toBe(classBId)
  })

  it('a move without a reason is rejected by validation', async () => {
    const res = await request(app).post('/api/sectioning/moves').set(authHeader(fx.tokens.admin)).send({ studentId: studentIds[2], toCohortId: cohortAId, reason: '' })
    expect(res.status).toBe(400)
  })
})
