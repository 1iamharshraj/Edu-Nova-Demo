import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { buildFixture, type Fixture } from './helpers/fixtures'
import { authHeader } from './helpers/auth'

// Phase T8 — What-If / partial re-optimization (phase-t8-what-if.md). Read T7's own versioning test file
// first — this file exercises T8's own required live-verification checks: a change event's affected-region
// summary correctly identifies only the truly-touched sessions (not the whole timetable), an active T7 lock
// is genuinely respected during the re-solve (not just skipped at the top level), and the patch publishes
// as a proper new TimetableVersion with correct lineage back to the parent, through T7's existing
// approve/publish flow (no new approval mechanism).

const app = createApp()
let fx: Fixture
let teacherBId: string
let classBId: string, classSubjectBId: string
let classCId: string, classSubjectCId: string

beforeAll(async () => {
  fx = await buildFixture(app)
  await request(app).post('/api/timetable/constraints/seed-defaults').set(authHeader(fx.tokens.admin))
  await request(app).post('/api/timetable/period-templates').set(authHeader(fx.tokens.superadmin)).send({
    name: 'T8 day',
    periods: [
      { idx: 0, label: 'P1', start: '09:00', end: '09:45', kind: 'class' },
      { idx: 1, label: 'P2', start: '09:45', end: '10:30', kind: 'class' },
      { idx: 2, label: 'P3', start: '10:30', end: '11:15', kind: 'class' },
    ],
  })

  const teacherRes = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'teacher', name: 'Rohan Teacher B' })
  teacherBId = teacherRes.body.user.id as string

  const clsB = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
    .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'Y', capacity: 2 })
  classBId = clsB.body.item.id
  const csB = await request(app).post('/api/academic/class-subjects').set(authHeader(fx.tokens.superadmin))
    .send({ classId: classBId, subjectId: fx.ids.subjectId, teacherId: fx.ids.teacherId, periodsPerWeek: 5 })
  classSubjectBId = csB.body.item.id

  const clsC = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
    .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'X', capacity: 2 })
  classCId = clsC.body.item.id
  const csC = await request(app).post('/api/academic/class-subjects').set(authHeader(fx.tokens.superadmin))
    .send({ classId: classCId, subjectId: fx.ids.subjectId, teacherId: teacherBId, periodsPerWeek: 5 })
  classSubjectCId = csC.body.item.id
})

async function seedGrid(classId: string, classSubjectId: string, teacherId: string, entries: { dayOfWeek: number; periodIdx: number }[]) {
  const res = await request(app).put('/api/timetable/entries').set(authHeader(fx.tokens.admin)).send({
    classId, termId: fx.ids.termId,
    entries: entries.map(e => ({ ...e, classSubjectId, roomId: fx.ids.roomId, teacherId })),
  })
  expect(res.status).toBe(200)
  return res.body.items as { id: string; dayOfWeek: number; periodIdx: number }[]
}

describe('T8 — affected-region identification + partial re-optimization', () => {
  let parentVersionId: string
  let patchVersionId: string
  let lockId: string

  it('sets up a committed (PUBLISHED) 3-class timetable spanning two teachers', async () => {
    await seedGrid(fx.ids.classId, fx.ids.classSubjectId, fx.ids.teacherId, [{ dayOfWeek: 1, periodIdx: 0 }, { dayOfWeek: 2, periodIdx: 1 }])
    await seedGrid(classBId, classSubjectBId, fx.ids.teacherId, [{ dayOfWeek: 3, periodIdx: 2 }])
    await seedGrid(classCId, classSubjectCId, teacherBId, [{ dayOfWeek: 4, periodIdx: 0 }])

    const fork = await request(app).post('/api/timetable/versions/fork').set(authHeader(fx.tokens.admin))
      .send({ termId: fx.ids.termId, classIds: [fx.ids.classId, classBId, classCId], changeReason: 'T8 setup' })
    expect(fork.status).toBe(201)
    expect(fork.body.item.entries).toHaveLength(4)
    parentVersionId = fork.body.item.id

    await request(app).post(`/api/timetable/versions/${parentVersionId}/approve`).set(authHeader(fx.tokens.admin))
    const publish = await request(app).post(`/api/timetable/versions/${parentVersionId}/publish`).set(authHeader(fx.tokens.admin)).send({})
    expect(publish.status).toBe(200)
    expect(publish.body.item.status).toBe('PUBLISHED')
  })

  it('locks classB\'s session so it must survive the re-solve untouched even though its teacher becomes unavailable there', async () => {
    const lock = await request(app).post(`/api/timetable/versions/${parentVersionId}/locks`).set(authHeader(fx.tokens.admin)).send({
      lockType: 'ASSIGNMENT', targetType: 'classSubjectId', targetId: classSubjectBId, dayOfWeek: 3, periodIdx: 2, reason: 'Protected — do not move',
    })
    expect(lock.status).toBe(201)
    lockId = lock.body.item.id
  })

  it('POST /api/timetable/what-if TEACHER_UNAVAILABLE identifies the minimal affected region, relocates only the unlocked session, and leaves the locked one genuinely untouched', async () => {
    const res = await request(app).post('/api/timetable/what-if').set(authHeader(fx.tokens.admin)).send({
      versionId: parentVersionId,
      changeEvent: { type: 'TEACHER_UNAVAILABLE', teacherId: fx.ids.teacherId, slots: [{ dayOfWeek: 2, periodIdx: 1 }, { dayOfWeek: 3, periodIdx: 2 }] },
    })
    expect(res.status).toBe(200)
    expect(res.body.item.parentVersionId).toBe(parentVersionId)
    expect(res.body.item.status).toBe('GENERATED')
    patchVersionId = res.body.item.id

    // Exactly ONE of the 4 sessions in the whole timetable is genuinely affected: classId's (2,1) session
    // (unlocked, teacher becomes unavailable there) — NOT classB's (3,2) session (same trigger, but locked).
    expect(res.body.summary.affectedSessionCount).toBe(1)
    expect(res.body.summary.unaffectedSessionCount).toBe(3)
    expect(res.body.summary.affectedCohorts.length).toBeGreaterThan(0)

    // The lock conflict is surfaced, not silently dropped.
    expect(res.body.lockConflicts).toHaveLength(1)
    expect(res.body.lockConflicts[0].lockId).toBe(lockId)
    expect(res.body.lockConflicts[0].entry.classId).toBe(classBId)

    const patched = res.body.item.entries as { classId: string; dayOfWeek: number; periodIdx: number; teacherId: string | null }[]
    // classB's locked session: byte-identical, still at (3,2).
    const classBEntry = patched.find(e => e.classId === classBId)
    expect(classBEntry).toMatchObject({ dayOfWeek: 3, periodIdx: 2, teacherId: fx.ids.teacherId })
    // classC's unrelated session: completely untouched.
    const classCEntry = patched.find(e => e.classId === classCId)
    expect(classCEntry).toMatchObject({ dayOfWeek: 4, periodIdx: 0, teacherId: teacherBId })
    // classId's session moved OFF (2,1) and its (1,0) session is untouched.
    const classIdEntries = patched.filter(e => e.classId === fx.ids.classId)
    expect(classIdEntries).toHaveLength(2)
    expect(classIdEntries.some(e => e.dayOfWeek === 1 && e.periodIdx === 0)).toBe(true)
    expect(classIdEntries.some(e => e.dayOfWeek === 2 && e.periodIdx === 1)).toBe(false)
    // The relocated session never lands on either of the now-unavailable slots.
    expect(classIdEntries.some(e => e.dayOfWeek === 2 && e.periodIdx === 1)).toBe(false)
    expect(classIdEntries.some(e => e.dayOfWeek === 3 && e.periodIdx === 2)).toBe(false)
  })

  it('the what-if patch reuses T7\'s existing approve/publish flow and publishes with correct lineage', async () => {
    const approve = await request(app).post(`/api/timetable/versions/${patchVersionId}/approve`).set(authHeader(fx.tokens.admin))
    expect(approve.status).toBe(200)
    expect(approve.body.item.status).toBe('APPROVED')

    const publish = await request(app).post(`/api/timetable/versions/${patchVersionId}/publish`).set(authHeader(fx.tokens.admin)).send({})
    expect(publish.status).toBe(200)
    expect(publish.body.item.status).toBe('PUBLISHED')
    expect(publish.body.archivedVersionIds).toEqual([parentVersionId])

    const grid = await request(app).get('/api/timetable').query({ classId: fx.ids.classId, termId: fx.ids.termId }).set(authHeader(fx.tokens.admin))
    expect(grid.body.entries).toHaveLength(2)
    expect(grid.body.entries.some((e: { dayOfWeek: number; periodIdx: number }) => e.dayOfWeek === 2 && e.periodIdx === 1)).toBe(false)

    const parent = await request(app).get(`/api/timetable/versions/${parentVersionId}`).set(authHeader(fx.tokens.admin))
    expect(parent.body.item.status).toBe('ARCHIVED')
  })

  it('produced a real, inspectable "what-if" audit entry', async () => {
    const res = await request(app).get('/api/admin/audit').query({ entity: 'timetableVersion', limit: 500 }).set(authHeader(fx.tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.items.some((i: { action: string; entityId: string }) => i.action === 'what-if' && i.entityId === patchVersionId)).toBe(true)
  })
})

describe('T8 — PERIOD_REMOVED', () => {
  it('relocates every session sitting in a removed period, and nothing else', async () => {
    const clsD = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
      .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'W', capacity: 2 })
    const classDId = clsD.body.item.id as string
    const csD = await request(app).post('/api/academic/class-subjects').set(authHeader(fx.tokens.superadmin))
      .send({ classId: classDId, subjectId: fx.ids.subjectId, teacherId: fx.ids.teacherId, periodsPerWeek: 5 })
    const classSubjectDId = csD.body.item.id as string

    await seedGrid(classDId, classSubjectDId, fx.ids.teacherId, [{ dayOfWeek: 5, periodIdx: 0 }, { dayOfWeek: 6, periodIdx: 1 }])
    const fork = await request(app).post('/api/timetable/versions/fork').set(authHeader(fx.tokens.admin))
      .send({ termId: fx.ids.termId, classIds: [classDId] })
    const versionId = fork.body.item.id as string

    const res = await request(app).post('/api/timetable/what-if').set(authHeader(fx.tokens.admin)).send({
      versionId, changeEvent: { type: 'PERIOD_REMOVED', dayOfWeek: 5, periodIdx: 0 },
    })
    expect(res.status).toBe(200)
    expect(res.body.summary.affectedSessionCount).toBe(1)
    expect(res.body.summary.unaffectedSessionCount).toBe(1)
    const patched = res.body.item.entries as { dayOfWeek: number; periodIdx: number }[]
    expect(patched.some(e => e.dayOfWeek === 5 && e.periodIdx === 0)).toBe(false)
    expect(patched.some(e => e.dayOfWeek === 6 && e.periodIdx === 1)).toBe(true)
  })
})

describe('T8 — SA-polish step never double-books a class against its own frozen sessions (regression)', () => {
  // Root-caused regression (live-tested during T8): whatif.ts's SA-polish step (step 4) only threads
  // teacher/room occupancy of the frozen region into refinement.ts's ExternalOccupancy — never class
  // occupancy. Because refineDraft's own T5 callers always group a class's ENTIRE set of entries together
  // (so within-group idx.classSlot already caught same-class collisions), that omission was invisible until
  // T8 started passing only a FEW touched entries into SA while the rest of that same class's sessions sat
  // in `frozen`, invisible to the SA group's own idx. This test builds a class whose grid is almost
  // completely full (16 of 18 slots, by a DIFFERENT teacher than the touched sessions, and no rooms at all
  // — so neither the teacher- nor room-collision checks can incidentally catch the bug), marks the touched
  // sessions' own teacher unavailable so exactly 2 sessions become movable (triggering the SA branch, which
  // only runs when touchedForSA.length > 1), and asserts the patched result never lands two classE sessions
  // on the same day/period.
  it('what-if with 2 touched sessions in the same class produces zero same-class double-bookings after SA polish', async () => {
    const teacherXRes = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'teacher', name: 'T8 Teacher X' })
    const teacherXId = teacherXRes.body.user.id as string
    const teacherYRes = await request(app).post('/api/users').set(authHeader(fx.tokens.superadmin)).send({ role: 'teacher', name: 'T8 Teacher Y' })
    const teacherYId = teacherYRes.body.user.id as string

    const clsE = await request(app).post('/api/academic/classes').set(authHeader(fx.tokens.superadmin))
      .send({ academicYearId: fx.ids.yearId, boardId: fx.ids.boardId, gradeId: fx.ids.gradeId, section: 'V', capacity: 2 })
    const classEId = clsE.body.item.id as string
    const csE = await request(app).post('/api/academic/class-subjects').set(authHeader(fx.tokens.superadmin))
      .send({ classId: classEId, subjectId: fx.ids.subjectId, teacherId: teacherXId, periodsPerWeek: 18 })
    const classSubjectEId = csE.body.item.id as string

    // 2 sessions with teacherX (these become movable once teacherX is marked unavailable there); 14
    // sessions with teacherY filling every other slot except two (day 6, periods 1 and 2) left genuinely
    // free — so greedy relocation has exactly enough room to place both touched sessions, and the SA-polish
    // pass then has a full 18-slot neighborhood (its own class's whole grid) to explore around them, 14 of
    // which are occupied by a DIFFERENT teacher's own frozen classE sessions. No rooms are used anywhere in
    // this grid, so a same-class collision can only ever be caught by class-slot tracking, never as a
    // teacher or room collision side effect.
    const touchedSlots = [{ dayOfWeek: 1, periodIdx: 0 }, { dayOfWeek: 1, periodIdx: 1 }]
    const frozenSlots: { dayOfWeek: number; periodIdx: number }[] = []
    for (let day = 1; day <= 6; day++) {
      for (let idx = 0; idx <= 2; idx++) {
        if (day === 1 && (idx === 0 || idx === 1)) continue // touched
        if (day === 6 && (idx === 1 || idx === 2)) continue // left free
        frozenSlots.push({ dayOfWeek: day, periodIdx: idx })
      }
    }
    expect(frozenSlots).toHaveLength(14)

    const putRes = await request(app).put('/api/timetable/entries').set(authHeader(fx.tokens.admin)).send({
      classId: classEId, termId: fx.ids.termId,
      entries: [
        ...touchedSlots.map(s => ({ ...s, classSubjectId: classSubjectEId, roomId: null, teacherId: teacherXId })),
        ...frozenSlots.map(s => ({ ...s, classSubjectId: classSubjectEId, roomId: null, teacherId: teacherYId })),
      ],
    })
    expect(putRes.status).toBe(200)
    expect(putRes.body.items).toHaveLength(16)

    const fork = await request(app).post('/api/timetable/versions/fork').set(authHeader(fx.tokens.admin))
      .send({ termId: fx.ids.termId, classIds: [classEId] })
    expect(fork.status).toBe(201)
    const versionId = fork.body.item.id as string

    const res = await request(app).post('/api/timetable/what-if').set(authHeader(fx.tokens.admin)).send({
      versionId,
      changeEvent: { type: 'TEACHER_UNAVAILABLE', teacherId: teacherXId, slots: touchedSlots },
    })
    expect(res.status).toBe(200)

    // Both teacherX sessions were genuinely movable (unlocked) and both had a free slot to land in —
    // confirms the SA branch (touchedForSA.length > 1) actually ran, not just the greedy step.
    expect(res.body.summary.affectedSessionCount).toBe(2)
    expect(res.body.unplaced).toHaveLength(0)

    const patched = res.body.item.entries as { classId: string; dayOfWeek: number; periodIdx: number }[]
    const classEEntries = patched.filter(e => e.classId === classEId)
    expect(classEEntries).toHaveLength(16) // no entries lost or duplicated in the patch itself

    const seen = new Map<string, number>()
    for (const e of classEEntries) {
      const key = `${e.dayOfWeek}:${e.periodIdx}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1)
    expect(duplicates).toEqual([]) // the actual regression: SA-polish must never double-book classE against its own frozen sessions
  })
})

describe('T8 RBAC', () => {
  it('teacher cannot call what-if', async () => {
    const res = await request(app).post('/api/timetable/what-if').set(authHeader(fx.tokens.teacher)).send({
      versionId: 'does-not-matter', changeEvent: { type: 'PERIOD_REMOVED', dayOfWeek: 1, periodIdx: 0 },
    })
    expect(res.status).toBe(403)
  })
})
