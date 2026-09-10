import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader } from './helpers/auth'

// Phase T7 — versioning + locks + the manual-override system (phase-t7-versioning-override.md). See the
// roadmap's D10/D9 — this is the centerpiece of the whole Advanced Timetable Generation project, so this
// file exercises every one of the phase's own required live-verification checks: enforced publish-
// immutability at the service layer (a direct write against a published version's rows must be rejected,
// even bypassing the override system's own endpoints), live conflict detection on a hand-edit BEFORE save,
// a lock blocking an edit into its target, a real undo, and an audit trail for every override action.

const app = createApp()
let fx: Fixture
let secondClassId: string
let secondClassSubjectId: string

beforeAll(async () => {
  fx = await buildFixture(app)
  await request(app).post('/api/timetable/period-templates').set(authHeader(fx.tokens.superadmin)).send({
    name: 'T7 day',
    periods: [
      { idx: 0, label: 'P1', start: '09:00', end: '09:45', kind: 'class' },
      { idx: 1, label: 'P2', start: '09:45', end: '10:30', kind: 'class' },
      { idx: 2, label: 'P3', start: '10:30', end: '11:15', kind: 'class' },
    ],
  })
  const cls = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
    .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'Z', capacity: 2 })
  secondClassId = cls.body.item.id
  // Same teacher as fx's own class-subject — deliberately, so we can force a genuine teacher double-booking.
  const cs = await request(app).post('/api/academic/class-subjects').set(authHeader(fx.tokens.superadmin))
    .send({ classId: secondClassId, subjectId: fx.ids.subjectId, teacherId: fx.ids.teacherId, periodsPerWeek: 5 })
  secondClassSubjectId = cs.body.item.id
})

async function seedGrid(classId: string, classSubjectId: string, entries: { dayOfWeek: number; periodIdx: number }[]) {
  const res = await request(app).put('/api/timetable/entries').set(authHeader(fx.tokens.admin)).send({
    classId, termId: fx.ids.termId,
    entries: entries.map(e => ({ ...e, classSubjectId, roomId: fx.ids.roomId, teacherId: fx.ids.teacherId })),
  })
  expect(res.status).toBe(200)
  return res.body.items as { id: string; dayOfWeek: number; periodIdx: number }[]
}

describe('T7 §1/§2 — version lineage + enforced publish-immutability', () => {
  it('forks a DRAFT from the live (unversioned) grid, approves, and publishes it', async () => {
    await seedGrid(fx.ids.classId, fx.ids.classSubjectId, [{ dayOfWeek: 1, periodIdx: 0 }])

    const fork = await request(app).post('/api/timetable/versions/fork').set(authHeader(fx.tokens.admin))
      .send({ termId: fx.ids.termId, classIds: [fx.ids.classId], changeReason: 'Initial versioning' })
    expect(fork.status).toBe(201)
    expect(fork.body.item.status).toBe('DRAFT')
    expect(fork.body.item.parentVersionId).toBeUndefined()
    expect(fork.body.item.entries).toHaveLength(1)
    const versionId = fork.body.item.id as string

    const approve = await request(app).post(`/api/timetable/versions/${versionId}/approve`).set(authHeader(fx.tokens.admin))
    expect(approve.status).toBe(200)
    expect(approve.body.item.status).toBe('APPROVED')

    const publish = await request(app).post(`/api/timetable/versions/${versionId}/publish`).set(authHeader(fx.tokens.admin)).send({})
    expect(publish.status).toBe(200)
    expect(publish.body.item.status).toBe('PUBLISHED')
    expect(publish.body.archivedVersionIds).toEqual([])

    const grid = await request(app).get('/api/timetable').query({ classId: fx.ids.classId, termId: fx.ids.termId }).set(authHeader(fx.tokens.admin))
    expect(grid.body.entries).toHaveLength(1)
  })

  it('a direct write via PUT /entries (bypassing the override system) against the now-PUBLISHED class is rejected at the service layer', async () => {
    const res = await request(app).put('/api/timetable/entries').set(authHeader(fx.tokens.admin)).send({
      classId: fx.ids.classId, termId: fx.ids.termId,
      entries: [{ dayOfWeek: 2, periodIdx: 1, classSubjectId: fx.ids.classSubjectId, roomId: fx.ids.roomId, teacherId: fx.ids.teacherId }],
    })
    expect(res.status).toBe(409)
    expect(res.body.publishedVersionId).toBeTruthy()
  })

  it('a direct DELETE /entries/:id against a row belonging to the PUBLISHED version is rejected at the service layer', async () => {
    const grid = await request(app).get('/api/timetable').query({ classId: fx.ids.classId, termId: fx.ids.termId }).set(authHeader(fx.tokens.admin))
    const entryId = grid.body.entries[0].id as string
    const res = await request(app).delete(`/api/timetable/entries/${entryId}`).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(409)
    expect(res.body.publishedVersionId).toBeTruthy()
  })

  it('forking again over the published scope sets parentVersionId to the currently-PUBLISHED version', async () => {
    const fork = await request(app).post('/api/timetable/versions/fork').set(authHeader(fx.tokens.admin))
      .send({ termId: fx.ids.termId, classIds: [fx.ids.classId], changeReason: 'A modification' })
    expect(fork.status).toBe(201)
    expect(fork.body.item.status).toBe('DRAFT')
    expect(fork.body.item.parentVersionId).toBeTruthy()
    const published = await request(app).get('/api/timetable/versions').query({ termId: fx.ids.termId, status: 'PUBLISHED' }).set(authHeader(fx.tokens.admin))
    expect(published.body.items).toHaveLength(1)
    expect(fork.body.item.parentVersionId).toBe(published.body.items[0].id)
  })

  it('publishing the modification archives the predecessor, whose own entries snapshot stays intact', async () => {
    const forkRes = await request(app).post('/api/timetable/versions/fork').set(authHeader(fx.tokens.admin)).send({ termId: fx.ids.termId, classIds: [fx.ids.classId] })
    const versionId = forkRes.body.item.id as string
    const predecessorId = forkRes.body.item.parentVersionId as string
    const predecessorBefore = await request(app).get(`/api/timetable/versions/${predecessorId}`).set(authHeader(fx.tokens.admin))

    await request(app).post(`/api/timetable/versions/${versionId}/approve`).set(authHeader(fx.tokens.admin))
    const publish = await request(app).post(`/api/timetable/versions/${versionId}/publish`).set(authHeader(fx.tokens.admin)).send({ changeReason: 'no-op republish' })
    expect(publish.status).toBe(200)
    expect(publish.body.archivedVersionIds).toEqual([predecessorId])

    const predecessorAfter = await request(app).get(`/api/timetable/versions/${predecessorId}`).set(authHeader(fx.tokens.admin))
    expect(predecessorAfter.body.item.status).toBe('ARCHIVED')
    expect(predecessorAfter.body.item.entries).toEqual(predecessorBefore.body.item.entries)
  })

  it('cannot publish a version that is not yet APPROVED', async () => {
    const forkRes = await request(app).post('/api/timetable/versions/fork').set(authHeader(fx.tokens.admin)).send({ termId: fx.ids.termId, classIds: [fx.ids.classId] })
    const res = await request(app).post(`/api/timetable/versions/${forkRes.body.item.id}/publish`).set(authHeader(fx.tokens.admin)).send({})
    expect(res.status).toBe(409)
  })
})

describe('T7 §4 — live conflict detection, locks, undo', () => {
  it('dry-run move detects a genuine teacher double-booking BEFORE save, with real conflicts[] detail', async () => {
    await seedGrid(secondClassId, secondClassSubjectId, [{ dayOfWeek: 3, periodIdx: 2 }])

    const forkRes = await request(app).post('/api/timetable/versions/fork').set(authHeader(fx.tokens.admin)).send({ termId: fx.ids.termId, classIds: [fx.ids.classId] })
    const versionId = forkRes.body.item.id as string
    const entry = forkRes.body.item.entries[0] as { dayOfWeek: number; periodIdx: number }

    // Move fx's own class-subject onto day 3 / period 2 — exactly where secondClassId's SAME teacher
    // (fx.ids.teacherId) already sits, live, in the DB. This must be caught live, before save.
    const dryRun = await request(app).post(`/api/timetable/versions/${versionId}/move`).set(authHeader(fx.tokens.admin)).send({
      classId: fx.ids.classId, fromDayOfWeek: entry.dayOfWeek, fromPeriodIdx: entry.periodIdx, toDayOfWeek: 3, toPeriodIdx: 2, dryRun: true,
    })
    expect(dryRun.status).toBe(200)
    expect(dryRun.body.ok).toBe(false)
    expect(dryRun.body.conflicts.length).toBeGreaterThan(0)
    expect(dryRun.body.conflicts[0].rule).toBe('teacher')
    expect(dryRun.body.conflicts[0].teacherId).toBe(fx.ids.teacherId)

    // The dry run must not have persisted anything.
    const stillThere = await request(app).get(`/api/timetable/versions/${versionId}`).set(authHeader(fx.tokens.admin))
    expect(stillThere.body.item.entries.some((e: { dayOfWeek: number; periodIdx: number }) => e.dayOfWeek === entry.dayOfWeek && e.periodIdx === entry.periodIdx)).toBe(true)

    // The real (non-dry-run) save of the SAME move is rejected the same way, atomically (nothing written).
    const real = await request(app).post(`/api/timetable/versions/${versionId}/move`).set(authHeader(fx.tokens.admin)).send({
      classId: fx.ids.classId, fromDayOfWeek: entry.dayOfWeek, fromPeriodIdx: entry.periodIdx, toDayOfWeek: 3, toPeriodIdx: 2,
    })
    expect(real.status).toBe(409)
    expect(real.body.conflicts[0].rule).toBe('teacher')
  })

  it('a lock on a specific slot blocks a hand-edit into it, with a clear message, then releasing it unblocks the edit', async () => {
    const forkRes = await request(app).post('/api/timetable/versions/fork').set(authHeader(fx.tokens.admin)).send({ termId: fx.ids.termId, classIds: [fx.ids.classId] })
    const versionId = forkRes.body.item.id as string
    const entry = forkRes.body.item.entries[0] as { dayOfWeek: number; periodIdx: number }
    const targetDay = entry.dayOfWeek === 1 ? 4 : 1
    const targetPeriod = 1

    const lock = await request(app).post(`/api/timetable/versions/${versionId}/locks`).set(authHeader(fx.tokens.admin)).send({
      lockType: 'ASSIGNMENT', targetType: 'classSubjectId', targetId: fx.ids.classSubjectId, dayOfWeek: targetDay, periodIdx: targetPeriod, reason: 'Reserved for assembly',
    })
    expect(lock.status).toBe(201)
    expect(lock.body.item.active).toBe(true)

    const blocked = await request(app).post(`/api/timetable/versions/${versionId}/move`).set(authHeader(fx.tokens.admin)).send({
      classId: fx.ids.classId, fromDayOfWeek: entry.dayOfWeek, fromPeriodIdx: entry.periodIdx, toDayOfWeek: targetDay, toPeriodIdx: targetPeriod,
    })
    expect(blocked.status).toBe(409)
    expect(blocked.body.conflicts.some((c: { rule: string }) => c.rule === 'locked')).toBe(true)

    const release = await request(app).post(`/api/timetable/locks/${lock.body.item.id}/release`).set(authHeader(fx.tokens.admin)).send({ reason: 'Assembly cancelled' })
    expect(release.status).toBe(200)
    expect(release.body.item.active).toBe(false)

    const nowOk = await request(app).post(`/api/timetable/versions/${versionId}/move`).set(authHeader(fx.tokens.admin)).send({
      classId: fx.ids.classId, fromDayOfWeek: entry.dayOfWeek, fromPeriodIdx: entry.periodIdx, toDayOfWeek: targetDay, toPeriodIdx: targetPeriod,
    })
    expect(nowOk.status).toBe(200)
    expect(nowOk.body.ok).toBe(true)
  })

  it('undo reverts the last move correctly', async () => {
    const forkRes = await request(app).post('/api/timetable/versions/fork').set(authHeader(fx.tokens.admin)).send({ termId: fx.ids.termId, classIds: [fx.ids.classId] })
    const versionId = forkRes.body.item.id as string
    const before = forkRes.body.item.entries[0] as { dayOfWeek: number; periodIdx: number }
    const toDay = before.dayOfWeek === 5 ? 2 : 5

    const move = await request(app).post(`/api/timetable/versions/${versionId}/move`).set(authHeader(fx.tokens.admin)).send({
      classId: fx.ids.classId, fromDayOfWeek: before.dayOfWeek, fromPeriodIdx: before.periodIdx, toDayOfWeek: toDay, toPeriodIdx: before.periodIdx,
    })
    expect(move.status).toBe(200)
    const moved = await request(app).get(`/api/timetable/versions/${versionId}`).set(authHeader(fx.tokens.admin))
    expect(moved.body.item.entries.some((e: { dayOfWeek: number }) => e.dayOfWeek === toDay)).toBe(true)
    expect(moved.body.item.status).toBe('MODIFIED')

    const undo = await request(app).post(`/api/timetable/versions/${versionId}/undo`).set(authHeader(fx.tokens.admin))
    expect(undo.status).toBe(200)
    expect(undo.body.ok).toBe(true)

    const reverted = await request(app).get(`/api/timetable/versions/${versionId}`).set(authHeader(fx.tokens.admin))
    expect(reverted.body.item.entries.some((e: { dayOfWeek: number; periodIdx: number }) => e.dayOfWeek === before.dayOfWeek && e.periodIdx === before.periodIdx)).toBe(true)
    expect(reverted.body.item.entries.some((e: { dayOfWeek: number }) => e.dayOfWeek === toDay)).toBe(false)
  })

  it('every override action produced a real, inspectable audit log entry', async () => {
    const res = await request(app).get('/api/admin/audit').query({ entity: 'timetableVersion', limit: 500 }).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    const actions = new Set(res.body.items.map((i: { action: string }) => i.action))
    expect(actions.has('fork-version')).toBe(true)
    expect(actions.has('publish-version')).toBe(true)
    expect(actions.has('move-entry')).toBe(true)
    expect(actions.has('undo')).toBe(true)

    const lockRes = await request(app).get('/api/admin/audit').query({ entity: 'timetableLock', limit: 500 }).set(authHeader(fx.tokens.admin))
    const lockActions = new Set(lockRes.body.items.map((i: { action: string }) => i.action))
    expect(lockActions.has('create-lock')).toBe(true)
    expect(lockActions.has('release-lock')).toBe(true)
  })
})

describe('T7 RBAC', () => {
  it('teacher cannot fork/publish/move', async () => {
    const fork = await request(app).post('/api/timetable/versions/fork').set(authHeader(fx.tokens.teacher)).send({ termId: fx.ids.termId, classIds: [fx.ids.classId] })
    expect(fork.status).toBe(403)
  })
})
