// T6: TimetableSession/SharedSession, ElectiveBlock, TimetableGenerationJob. See server/src/modules/
// timetable/{sessions,electives,jobs}.ts for the real shapes this mirrors (read in full before writing
// this file) and timetableCore.ts's module doc comment for how the batch is split.

import { route, requireAuth, requireRole, status } from '../router'
import { table, uid, nowIso, SCHOOL_ID, type Row } from '../store'
import { badRequest, notFound, conflict } from '../http'
import { requirementsToPlacementRequests, commitEntries, classLabel } from './timetableCore'
import { greedyPlace, labRoomIds, type Occupancy } from './timetableEngine'
import type { Collections } from '../store'

const WRITE_ROLES = ['admin', 'superadmin']

// ───────────────────────── T6 §1 — TimetableSession / SharedSession ─────────────────────────

route('GET', '/timetable/sessions', (ctx) => {
  requireAuth(ctx)
  const { termId, cohortId } = ctx.query
  const items = table('TimetableSession').filter(s => (!termId || s.termId === termId) && (!cohortId || (s.cohortIds as string[] | undefined)?.includes(cohortId)))
  return { items }
})
route('GET', '/timetable/sessions/:id', (ctx) => {
  requireAuth(ctx)
  const item = table('TimetableSession').find(s => s.id === ctx.params.id)
  if (!item) throw notFound('Timetable session')
  return { item }
})
route('POST', '/timetable/sessions/shared', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { termId, requirementIds, teacherId, roomId, dayOfWeek, periodIdx, durationPeriods, sessionType } = ctx.body as {
    termId: string; requirementIds: string[]; teacherId?: string; roomId?: string | null; dayOfWeek: number; periodIdx: number; durationPeriods?: number; sessionType?: string
  }
  if (!requirementIds || requirementIds.length < 2) throw badRequest('requirementIds must name at least 2 requirements')
  const reqs = requirementIds.map(id => table('TeachingRequirement').find(r => r.id === id))
  if (reqs.some(r => !r)) throw notFound('Teaching requirement')
  const cohortIds = [...new Set(reqs.map(r => String(r!.cohortId)))]
  if (cohortIds.length !== reqs.length) throw badRequest('Each requirement must belong to a distinct cohort')
  const subjectIds = new Set(reqs.map(r => r!.subjectId))
  if (subjectIds.size !== 1) throw badRequest('All linked requirements must be for the same subject')
  const resolvedTeacherId = teacherId ?? table('TeachingAssignment').find(a => a.teachingRequirementId === requirementIds[0])?.teacherId
  if (!resolvedTeacherId) throw badRequest('No teacherId given and the first requirement has no Fixed assignment to infer one from')

  const periods = Array.from({ length: durationPeriods ?? 1 }, (_, i) => periodIdx + i)
  const busy = table('TimetableEntry').find(e => e.termId === termId && e.dayOfWeek === dayOfWeek && periods.includes(Number(e.periodIdx)) && (e.teacherId === resolvedTeacherId || (roomId && e.roomId === roomId)))
  if (busy) throw conflict(`Already booked at day ${dayOfWeek} period ${busy.periodIdx}`, { conflicts: [{ rule: busy.teacherId === resolvedTeacherId ? 'teacher' : 'room', classId: busy.classId, dayOfWeek: busy.dayOfWeek, periodIdx: busy.periodIdx }] })

  const session: Row = {
    id: uid('sess'), schoolId: SCHOOL_ID, termId, subjectId: reqs[0]!.subjectId,
    teachingAssignmentId: table('TeachingAssignment').find(a => a.teachingRequirementId === requirementIds[0])?.id,
    teacherId: resolvedTeacherId, roomId: roomId ?? undefined, sessionType: sessionType ?? 'SHARED', durationPeriods: durationPeriods ?? 1,
    isSplittable: false, jobId: undefined, committed: false, committedAt: undefined, createdAt: nowIso(),
    entries: periods.map(p => ({ dayOfWeek, periodIdx: p })), cohortIds, requirementIds, isShared: true,
  }
  table('TimetableSession').push(session)
  return status(201, { item: session })
})
route('DELETE', '/timetable/sessions/:id', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const rows = table('TimetableSession')
  const idx = rows.findIndex(r => r.id === ctx.params.id)
  if (idx === -1) throw notFound('Timetable session')
  if (rows[idx].committed) throw badRequest('This session has already been committed')
  rows.splice(idx, 1)
  return { ok: true }
})

function materializeSession(session: Row) {
  const cohortIds = (session.cohortIds as string[] | undefined) ?? []
  const classIds = new Set<string>()
  for (const cid of cohortIds) for (const clsId of (table('Cohort').find(c => c.id === cid)?.classIds as string[] | undefined) ?? []) classIds.add(clsId)
  const entries = (session.entries as { dayOfWeek: number; periodIdx: number }[]) ?? []
  const draft: Array<{ classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId?: string | null; teacherId?: string | null; sessionId: string }> = []
  for (const classId of classIds) {
    const rows = table('ClassSubject')
    let cs = rows.find(r => r.classId === classId && r.subjectId === session.subjectId)
    if (!cs) { cs = { id: uid('cs'), schoolId: SCHOOL_ID, classId, subjectId: session.subjectId, teacherId: session.teacherId, periodsPerWeek: session.durationPeriods } as Row; rows.push(cs) }
    for (const e of entries) draft.push({ classId, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: cs.id, roomId: session.roomId as string | undefined ?? null, teacherId: session.teacherId as string | undefined ?? null, sessionId: session.id })
  }
  return draft
}

route('POST', '/timetable/sessions/commit', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { termId, sessionIds, mode } = ctx.body as { termId: string; sessionIds: string[]; mode: 'fill-empty' | 'full-regenerate' }
  const sessions = sessionIds.map(id => table('TimetableSession').find(s => s.id === id)).filter((s): s is Row => !!s)
  const draft = sessions.flatMap(materializeSession)
  const result = commitEntries(termId, mode, draft)
  for (const s of sessions) { s.committed = true; s.committedAt = nowIso() }
  return result
})

// ───────────────────────── T6 §1b — ElectiveBlock ─────────────────────────
// SIMULATE FOR SPEED: offerings carry a synthetic teachingRequirementId (no real Cohort/TeachingRequirement/
// TeachingAssignment/Session row per offering) — the choose/commit flow doesn't need those to exist for the
// demo, and building the full real graph for every offering would be the "genuinely reimplement the
// algorithm" work the ground rules explicitly say to skip. See seed/timetable.ts's own note on this.

route('GET', '/timetable/elective-blocks', (ctx) => {
  requireAuth(ctx)
  const { termId, gradeId } = ctx.query
  return { items: table('ElectiveBlock').filter(b => (!termId || b.termId === termId) && (!gradeId || b.gradeId === gradeId)) }
})
route('GET', '/timetable/elective-blocks/:id', (ctx) => {
  requireAuth(ctx)
  const item = table('ElectiveBlock').find(b => b.id === ctx.params.id)
  if (!item) throw notFound('Elective block')
  return { item }
})
route('POST', '/timetable/elective-blocks', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const body = ctx.body as { termId: string; gradeId: string; name: string; dayOfWeek: number; periodIdx: number; durationPeriods?: number; offerings: Array<{ subjectId: string; teacherId: string; roomId?: string | null; capacity?: number }> }
  if (!body.offerings || body.offerings.length < 2) throw badRequest('At least 2 offerings are required')
  const teacherIds = body.offerings.map(o => o.teacherId)
  if (new Set(teacherIds).size !== teacherIds.length) throw badRequest('The same teacher cannot run two parallel offerings in one elective block')
  const durationPeriods = body.durationPeriods ?? 1
  const periods = Array.from({ length: durationPeriods }, (_, i) => body.periodIdx + i)
  for (const o of body.offerings) {
    const busy = table('TimetableEntry').find(e => e.termId === body.termId && e.dayOfWeek === body.dayOfWeek && periods.includes(Number(e.periodIdx)) && (e.teacherId === o.teacherId || (o.roomId && e.roomId === o.roomId)))
    if (busy) throw conflict(`A teacher/room assigned to this block is already booked at day ${body.dayOfWeek} period ${busy.periodIdx}`)
  }
  const block: Row = {
    id: uid('eb'), schoolId: SCHOOL_ID, termId: body.termId, gradeId: body.gradeId, name: body.name,
    dayOfWeek: body.dayOfWeek, periodIdx: body.periodIdx, durationPeriods, createdAt: nowIso(),
    offerings: body.offerings.map(o => ({ id: uid('eo'), electiveBlockId: '', teachingRequirementId: uid('trq-elective'), subjectId: o.subjectId, teacherId: o.teacherId, roomId: o.roomId ?? undefined, capacity: o.capacity, registered: 0, choices: [] })),
  }
  for (const o of block.offerings as Array<Record<string, unknown>>) o.electiveBlockId = block.id
  table('ElectiveBlock').push(block)
  return status(201, { item: block })
})
route('POST', '/timetable/elective-blocks/:id/choices', (ctx) => {
  requireAuth(ctx)
  const block = table('ElectiveBlock').find(b => b.id === ctx.params.id)
  if (!block) throw notFound('Elective block')
  const { offeringId, studentId } = ctx.body as { offeringId: string; studentId: string }
  const offerings = block.offerings as Array<{ id: string; capacity?: number; choices: Array<{ studentId: string; status: string }>; registered: number }>
  const offering = offerings.find(o => o.id === offeringId)
  if (!offering) throw notFound('Elective offering')
  const already = offerings.flatMap(o => o.choices.map(c => ({ ...c, offeringId: o.id }))).find(c => c.studentId === studentId && c.status === 'Registered')
  if (already && already.offeringId !== offeringId) throw conflict('This student is already registered for a different offering in this block')
  const registeredCount = offering.choices.filter(c => c.status === 'Registered').length
  const chosenStatus = offering.capacity && registeredCount >= offering.capacity ? 'Waitlisted' : 'Registered'
  const existing = offering.choices.find(c => c.studentId === studentId)
  if (existing) existing.status = chosenStatus; else offering.choices.push({ studentId, status: chosenStatus })
  offering.registered = offering.choices.filter(c => c.status === 'Registered').length
  return status(201, { item: { id: uid('echoice'), offeringId, studentId, status: chosenStatus } })
})
route('POST', '/timetable/elective-blocks/:id/commit', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const block = table('ElectiveBlock').find(b => b.id === ctx.params.id)
  if (!block) throw notFound('Elective block')
  const { mode } = ctx.body as { mode?: 'fill-empty' | 'full-regenerate' }
  const classes = table('Class').filter(c => c.gradeId === block.gradeId)
  if (!classes.length) throw badRequest('No classes found in this grade')
  let placeholder = table('Subject').find(s => s.code === 'ELECTIVE_BLOCK')
  if (!placeholder) { placeholder = { id: uid('subject'), schoolId: SCHOOL_ID, name: 'Elective Block', code: 'ELECTIVE_BLOCK', color: '#8b5cf6' } as Row; table('Subject').push(placeholder) }
  const draft: Array<{ classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId: null; teacherId: null }> = []
  for (const cls of classes) {
    const rows = table('ClassSubject')
    let cs = rows.find(r => r.classId === cls.id && r.subjectId === placeholder!.id)
    if (!cs) { cs = { id: uid('cs'), schoolId: SCHOOL_ID, classId: cls.id, subjectId: placeholder!.id, teacherId: undefined, periodsPerWeek: block.durationPeriods } as Row; rows.push(cs) }
    for (let i = 0; i < Number(block.durationPeriods ?? 1); i++) draft.push({ classId: String(cls.id), dayOfWeek: Number(block.dayOfWeek), periodIdx: Number(block.periodIdx) + i, classSubjectId: cs.id, roomId: null, teacherId: null })
  }
  const result = commitEntries(String(block.termId), mode ?? 'fill-empty', draft)
  return result
})

// ───────────────────────── T6 §3 — TimetableGenerationJob ─────────────────────────

route('GET', '/timetable/generation-jobs', (ctx) => {
  requireAuth(ctx)
  const { termId } = ctx.query
  return { items: table('TimetableGenerationJob').filter(j => !termId || j.termId === termId) }
})
route('GET', '/timetable/generation-jobs/:id', (ctx) => {
  requireAuth(ctx)
  const item = table('TimetableGenerationJob').find(j => j.id === ctx.params.id)
  if (!item) throw notFound('Timetable generation job')
  return { item }
})

function runGenerationJob(ctx: { actor: { userId: string } | null }, cohortIds: string[], termId: string, mode: 'fill-empty' | 'full-regenerate', preferenceProfileName: string | undefined, timeBudgetMsPerGroup: number, seed: number): Row {
  const classBusy: Occupancy = new Map(); const teacherBusy: Occupancy = new Map(); const roomBusy: Occupancy = new Map()
  const requests = requirementsToPlacementRequests(cohortIds)
  const dbLike: Collections = { ClassSubject: table('ClassSubject'), Class: table('Class'), Grade: table('Grade'), Room: table('Room') }
  const { placed, unplaced } = greedyPlace(dbLike, requests, classBusy, teacherBusy, roomBusy, labRoomIds(dbLike))
  const outputHash = placed.length ? `mock-hash:${seed}:${placed.map(p => `${p.classId}${p.dayOfWeek}${p.periodIdx}`).sort().join('|')}` : undefined
  const diagnostics = unplaced.map(u => ({ type: 'REQUIREMENT_UNSATISFIED', cohortLabel: u.classLabel, subjectName: u.subjectName, teacherName: u.teacherName, unplacedPeriods: u.remaining, cause: u.teacherId ? 'TEACHER_BUSY' : 'NO_TEACHER_ASSIGNED', reason: u.reason, suggestedActions: ['Assign a qualified teacher', 'Lower required weekly periods'] }))
  const draftEntries = placed.map(e => {
    const cs = table('ClassSubject').find(r => r.id === e.classSubjectId)
    const subject = cs ? table('Subject').find(s => s.id === cs.subjectId) : undefined
    return { classId: e.classId, classLabel: classLabel(e.classId), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId, subjectName: subject?.name ?? '', subjectColor: subject?.color ?? '#6366f1', roomId: e.roomId, teacherId: e.teacherId, isDoublePeriod: false }
  })
  return {
    id: uid('gj'), schoolId: SCHOOL_ID, academicYearId: 'ay-2025', termId, scopeCohortIds: cohortIds,
    status: placed.length ? 'COMPLETED' : 'FAILED', progress: 100, currentStage: placed.length ? 'Done' : 'No placements could be made',
    startedAt: nowIso(), completedAt: nowIso(), solverVersion: 'mock-greedy@1', timeLimit: timeBudgetMsPerGroup, randomSeed: seed,
    solverParameters: { timeBudgetMsPerGroup, preferenceProfileName: preferenceProfileName ?? null, mode },
    outputHash, diagnostics: diagnostics.length ? diagnostics : undefined,
    errorCode: placed.length ? undefined : 'INFEASIBLE', errorDetails: placed.length ? undefined : { unplaced, diagnostics },
    createdById: ctx.actor?.userId ?? 'system', createdAt: nowIso(),
    draftEntries,
  }
}

route('POST', '/timetable/generation-jobs', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { termId, cohortIds, mode, preferenceProfileName, timeBudgetMsPerGroup, seed } = ctx.body as { termId: string; cohortIds: string[]; mode?: 'fill-empty' | 'full-regenerate'; preferenceProfileName?: string; timeBudgetMsPerGroup?: number; seed?: number }
  if (!cohortIds?.length) throw badRequest('cohortIds is required')
  const job = runGenerationJob(ctx, cohortIds, termId, mode ?? 'full-regenerate', preferenceProfileName, timeBudgetMsPerGroup ?? 5000, seed ?? 1234)
  table('TimetableGenerationJob').push(job)
  return status(201, { item: job })
})

route('POST', '/timetable/generation-jobs/:id/regenerate', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const original = table('TimetableGenerationJob').find(j => j.id === ctx.params.id)
  if (!original) throw notFound('Timetable generation job')
  const params = original.solverParameters as { timeBudgetMsPerGroup: number; preferenceProfileName: string | null; mode: 'fill-empty' | 'full-regenerate' }
  const job = runGenerationJob(ctx, original.scopeCohortIds as string[], String(original.termId), params.mode, params.preferenceProfileName ?? undefined, params.timeBudgetMsPerGroup, Number(original.randomSeed))
  table('TimetableGenerationJob').push(job)
  return { job, originalOutputHash: original.outputHash, newOutputHash: job.outputHash, byteIdentical: !!original.outputHash && original.outputHash === job.outputHash }
})

route('POST', '/timetable/generation-jobs/commit', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { jobId } = ctx.body as { jobId: string }
  const job = table('TimetableGenerationJob').find(j => j.id === jobId)
  if (!job) throw notFound('Timetable generation job')
  if (job.status !== 'COMPLETED') throw badRequest(`Job is ${job.status}, not COMPLETED — nothing to commit`)
  const draft = (job.draftEntries as Array<{ classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId?: string | null; teacherId?: string | null }>) ?? []
  const params = job.solverParameters as { mode: 'fill-empty' | 'full-regenerate' }
  return commitEntries(String(job.termId), params.mode, draft)
})
