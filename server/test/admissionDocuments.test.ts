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

// Phase T2 — Strong Admissions. Part A (admission data expansion) + Part B (document/custody management,
// including the TC-issuance document-return workflow). See phase-t2-strong-admissions.md.
describe('T2 strong admissions', () => {
  let scCategoryId: string
  let casteDocTypeId: string
  let birthDocTypeId: string
  let applicationId: string
  let studentId: string

  it('seeds default categories and document types (idempotent)', async () => {
    const cats1 = await request(app).post('/api/admission-documents/categories/seed-defaults').set(authHeader(fx.tokens.staff))
    expect(cats1.status).toBe(200)
    expect(cats1.body.added).toBeGreaterThan(0)
    const cats2 = await request(app).post('/api/admission-documents/categories/seed-defaults').set(authHeader(fx.tokens.staff))
    expect(cats2.body.added).toBe(0)

    const types1 = await request(app).post('/api/admission-documents/types/seed-defaults').set(authHeader(fx.tokens.staff))
    expect(types1.status).toBe(200)
    expect(types1.body.added).toBeGreaterThan(0)

    const cats = await request(app).get('/api/admission-documents/categories').set(authHeader(fx.tokens.staff))
    scCategoryId = cats.body.items.find((c: { code: string }) => c.code === 'SC').id

    const types = await request(app).get('/api/admission-documents/types').set(authHeader(fx.tokens.staff))
    casteDocTypeId = types.body.items.find((d: { code: string }) => d.code === 'CASTE_CERTIFICATE').id
    birthDocTypeId = types.body.items.find((d: { code: string }) => d.code === 'BIRTH_CERTIFICATE').id
    expect(casteDocTypeId).toBeTruthy()
    expect(birthDocTypeId).toBeTruthy()
  })

  it('a teacher cannot manage the admission-documents catalog', async () => {
    const res = await request(app).get('/api/admission-documents/categories').set(authHeader(fx.tokens.teacher))
    expect(res.status).toBe(403)
  })

  it('files an SC-category admission application with prior scores and health/transport flags', async () => {
    const res = await request(app).post('/api/applications').set(authHeader(fx.tokens.staff)).send({
      kind: 'Admission',
      applicantName: 'Strong Admissions Applicant',
      guardian: { name: 'Applicant Guardian', email: 'guardian.strongadmissions@fixture.test', phone: '9812345678' },
      targetClassId: fx.ids.classId,
      targetBoardId: fx.ids.boardId,
      admissionCategoryId: scCategoryId,
      admissionMode: 'Regular',
      previousSchoolName: 'Old Public School',
      lastGradeCompleted: 'VII',
      priorSubjectScores: [{ subjectName: 'Maths', score: 88, maxScore: 100 }, { subjectName: 'Science', score: 76, maxScore: 100 }],
      declaredTrackPreference: 'Science',
      healthFlags: { allergies: 'Peanuts', bloodGroup: 'O+' },
      transportRequired: true,
      transportPreferredArea: 'Green Park',
    })
    expect(res.status).toBe(201)
    expect(res.body.item.priorSubjectScores).toHaveLength(2)
    expect(res.body.item.transportRequired).toBe(true)
    applicationId = res.body.item.id
  })

  it('the completeness checklist shows the SC-conditional and always-required documents as missing', async () => {
    const res = await request(app).get(`/api/admission-documents/checklist/${applicationId}`).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(200)
    expect(res.body.complete).toBe(false)
    const caste = res.body.items.find((i: { code: string }) => i.code === 'CASTE_CERTIFICATE')
    expect(caste.required).toBe(true)
    expect(caste.submitted).toBe(false)
    expect(res.body.missingRequired).toContain('Caste Certificate')
    expect(res.body.missingRequired).toContain('Birth Certificate')
  })

  it('turning on admissionDocumentsBlockApproval blocks approval while documents are missing', async () => {
    const set = await request(app).patch('/api/admission-documents/settings').set(authHeader(fx.tokens.staff)).send({ admissionDocumentsBlockApproval: true })
    expect(set.body.admissionDocumentsBlockApproval).toBe(true)

    const approve = await request(app).post(`/api/applications/${applicationId}/approve`).set(authHeader(fx.tokens.staff))
    expect(approve.status).toBe(409)
    expect(approve.body.missingRequired).toContain('Caste Certificate')
  })

  it('submits the required documents (originals get a physical location), then the checklist clears and approval proceeds', async () => {
    for (const requiredDocumentTypeId of [casteDocTypeId, birthDocTypeId]) {
      const sub = await request(app).post('/api/admission-documents').set(authHeader(fx.tokens.staff)).send({
        applicationId, requiredDocumentTypeId, isOriginal: true, receivedDate: '2026-09-01',
        physicalLocationRoom: 'Records Room', physicalLocationShelf: 'Shelf 3', physicalLocationFolder: 'Folder A-12',
      })
      expect(sub.status).toBe(201)
      expect(sub.body.item.status).toBe('HELD')
    }
    // remaining always-required types (Aadhaar, photos, address proof, declaration) — submit as non-original digital copies.
    const remainingTypes = await request(app).get('/api/admission-documents/types').set(authHeader(fx.tokens.staff))
    for (const t of remainingTypes.body.items.filter((d: { alwaysRequired: boolean; code: string }) => d.alwaysRequired && d.code !== 'BIRTH_CERTIFICATE')) {
      await request(app).post('/api/admission-documents').set(authHeader(fx.tokens.staff)).send({ applicationId, requiredDocumentTypeId: t.id, isOriginal: false })
    }

    const check = await request(app).get(`/api/admission-documents/checklist/${applicationId}`).set(authHeader(fx.tokens.staff))
    expect(check.body.complete).toBe(true)

    const approve = await request(app).post(`/api/applications/${applicationId}/approve`).set(authHeader(fx.tokens.staff))
    expect(approve.status).toBe(200)
    studentId = approve.body.item.studentId
    expect(studentId).toBeTruthy()
    // turn the blocking setting back off so it doesn't affect other test files sharing this fixture's school.
    await request(app).patch('/api/admission-documents/settings').set(authHeader(fx.tokens.staff)).send({ admissionDocumentsBlockApproval: false })
  })

  it('the health-flag handoff created HealthRecord rows for the new student', async () => {
    const res = await request(app).get(`/api/health?studentId=${studentId}`).set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(200)
    const kinds = res.body.items.map((h: { kind: string }) => h.kind)
    expect(kinds).toContain('Allergy')
    expect(kinds).toContain('Other')
  })

  it('the transport requirement surfaces as a staff to-do until handled', async () => {
    const todos = await request(app).get('/api/applications/transport-todos').set(authHeader(fx.tokens.staff))
    expect(todos.status).toBe(200)
    expect(todos.body.items.some((t: { studentId: string }) => t.studentId === studentId)).toBe(true)

    const handled = await request(app).post(`/api/applications/${applicationId}/transport-handled`).set(authHeader(fx.tokens.staff))
    expect(handled.status).toBe(200)
    const todosAfter = await request(app).get('/api/applications/transport-todos').set(authHeader(fx.tokens.staff))
    expect(todosAfter.body.items.some((t: { studentId: string }) => t.studentId === studentId)).toBe(false)
  })

  it('sibling suggestions surface an existing active student sharing the same guardian contact', async () => {
    const res = await request(app).get('/api/applications/sibling-suggestions?email=guardian.strongadmissions@fixture.test').set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(200)
    expect(res.body.items.some((s: { studentId: string }) => s.studentId === studentId)).toBe(true)
  })

  it('the records report lists the held original documents by physical location', async () => {
    const res = await request(app).get('/api/admission-documents/records-report?room=Records').set(authHeader(fx.tokens.staff))
    expect(res.status).toBe(200)
    expect(res.body.items.length).toBeGreaterThanOrEqual(2)
    expect(res.body.items.every((i: { isOriginal: boolean; status: string }) => i.isOriginal && i.status === 'HELD')).toBe(true)
  })

  it('TC issuance is blocked until held originals are resolved, then succeeds once resolved', async () => {
    const tc = await request(app).post('/api/applications').set(authHeader(fx.tokens.staff)).send({ kind: 'TC', studentId })
    expect(tc.status).toBe(201)

    const preview = await request(app).get(`/api/admission-documents/tc-return-checklist/${studentId}`).set(authHeader(fx.tokens.staff))
    expect(preview.status).toBe(200)
    expect(preview.body.blocksIssuance).toBe(true)
    expect(preview.body.heldOriginals.length).toBe(2)

    const blocked = await request(app).post(`/api/applications/${tc.body.item.id}/approve`).set(authHeader(fx.tokens.staff))
    expect(blocked.status).toBe(409)
    expect(blocked.body.outstanding.length).toBe(2)

    const [first, second] = preview.body.heldOriginals
    const approve = await request(app).post(`/api/applications/${tc.body.item.id}/approve`).set(authHeader(fx.tokens.staff)).send({
      documentReturns: [
        { submittedDocumentId: first.id, action: 'RETURNED', returnedTo: 'Applicant Guardian' },
        { submittedDocumentId: second.id, action: 'EXCEPTION', exceptionReason: 'Original retained pending a duplicate request' },
      ],
    })
    expect(approve.status).toBe(200)

    const after = await request(app).get(`/api/admission-documents/tc-return-checklist/${studentId}`).set(authHeader(fx.tokens.staff))
    expect(after.body.heldOriginals.length).toBe(1) // the EXCEPTION document stays HELD, by design
  })
})
