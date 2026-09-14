// Core timetable surface: the plain class/term grid (`/timetable`, `/timetable/me`, `/timetable/teacher/:id`,
// `/timetable/entries`, `/timetable/copy`, `/timetable/publish` — Phase 2, pre-dating the T-series work),
// plus T4/T5's TeachingRequirement/TeachingAssignment/pool/availability/constraints/preferences/profiles,
// the auto-generate/refine/commit trio, and the T1 period-template/working-day-pattern config screens.
// See server/src/modules/timetable/router.ts (definitive endpoint list) and schema.ts (exact input shapes)
// — both read in full before writing this file. Sessions/elective-blocks/generation-jobs live in
// timetableSessionsJobs.ts; versions/locks/overrides/what-if live in timetableVersions.ts; the T9
// substitution workflow lives in substitution.ts.

import { route, crud, requireAuth, requireRole, status } from '../router'
import { table, uid, nowIso, SCHOOL_ID, type Row, type Collections } from '../store'
import { badRequest, conflict, notFound } from '../http'
import {
  PERIOD_TEMPLATE_ID, greedyPlace, labRoomIds, ensureClassSubject, needsLab,
  type Occupancy, type PlacementRequest,
} from './timetableEngine'

const WRITE_ROLES = ['admin', 'superadmin']

// ───────────────────────── shared lookups / decoration ─────────────────────────

function classLabel(classId: string): string {
  const c = table('Class').find(r => r.id === classId)
  if (!c) return classId
  const grade = table('Grade').find(g => g.id === c.gradeId)
  return `${grade?.label ?? '?'}-${c?.section ?? ''}`
}

function decorateEntry(e: Row) {
  const cs = table('ClassSubject').find(r => r.id === e.classSubjectId)
  const subject = cs ? table('Subject').find(s => s.id === cs.subjectId) : undefined
  const room = e.roomId ? table('Room').find(r => r.id === e.roomId) : undefined
  const teacher = e.teacherId ? table('User').find(u => u.id === e.teacherId) : undefined
  return {
    id: e.id, classId: e.classId, termId: e.termId, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx,
    classSubjectId: e.classSubjectId, roomId: e.roomId, teacherId: e.teacherId, sessionId: e.sessionId,
    classLabel: classLabel(String(e.classId)), subjectName: subject?.name, roomName: room?.name, teacherName: teacher?.name,
  }
}

function currentPublishedVersionFor(classId: string, termId: string) {
  return table('TimetableVersion').find(v => v.status === 'PUBLISHED' && v.termId === termId && (v.scopeClassIds as string[]).includes(classId))
}

// ───────────────────────── legacy grid: GET/PUT /timetable, /timetable/me, /timetable/teacher/:id ─────────────────────────

route('GET', '/timetable', (ctx) => {
  requireAuth(ctx)
  const { classId, termId } = ctx.query
  if (!classId || !termId) throw badRequest('classId and termId are required')
  const entries = table('TimetableEntry').filter(e => e.classId === classId && e.termId === termId).map(decorateEntry)
  const cls = table('Class').find(c => c.id === classId)
  const template = table('PeriodTemplate').find(t => t.id === (cls?.periodTemplateId ?? PERIOD_TEMPLATE_ID))
  const gov = currentPublishedVersionFor(classId, termId)
  return { template, entries, published: entries.length > 0, publishedAt: gov?.publishedAt }
})

route('GET', '/timetable/me', (ctx) => {
  const actor = requireAuth(ctx)
  const { termId, studentId } = ctx.query
  if (!termId) throw badRequest('termId is required')
  if (actor.role === 'teacher') {
    const entries = table('TimetableEntry').filter(e => e.termId === termId && e.teacherId === actor.userId).map(decorateEntry)
    const subs = table('Substitution').filter(s => entries.some(e => e.id === s.timetableEntryId))
      .map(s => ({ id: s.id, timetableEntryId: s.timetableEntryId, date: s.date, substituteTeacherId: s.substituteTeacherId, reason: s.reason, entry: decorateEntry(table('TimetableEntry').find(e => e.id === s.timetableEntryId)!) }))
    return { entries, substitutions: subs }
  }
  let classId: string | undefined
  if (actor.role === 'student') {
    classId = table('Enrollment').find(e => e.studentId === actor.userId && e.status === 'active')?.classId as string | undefined
  } else if (actor.role === 'parent') {
    if (!studentId) throw badRequest('studentId is required for a parent')
    classId = table('Enrollment').find(e => e.studentId === studentId && e.status === 'active')?.classId as string | undefined
  }
  if (!classId) return { entries: [] }
  const entries = table('TimetableEntry').filter(e => e.classId === classId && e.termId === termId).map(decorateEntry)
  const cls = table('Class').find(c => c.id === classId)
  const template = table('PeriodTemplate').find(t => t.id === (cls?.periodTemplateId ?? PERIOD_TEMPLATE_ID))
  const gov = currentPublishedVersionFor(classId, termId)
  return { template, entries, published: entries.length > 0, publishedAt: gov?.publishedAt }
})

route('GET', '/timetable/teacher/:userId', (ctx) => {
  requireAuth(ctx)
  const { termId } = ctx.query
  const teacherId = ctx.params.userId
  if (!termId) throw badRequest('termId is required')
  const entries = table('TimetableEntry').filter(e => e.termId === termId && e.teacherId === teacherId).map(decorateEntry)
  const subs = table('Substitution').filter(s => entries.some(e => e.id === s.timetableEntryId))
    .map(s => ({ id: s.id, timetableEntryId: s.timetableEntryId, date: s.date, substituteTeacherId: s.substituteTeacherId, reason: s.reason, entry: decorateEntry(table('TimetableEntry').find(e => e.id === s.timetableEntryId)!) }))
  return { entries, substitutions: subs }
})

route('PUT', '/timetable/entries', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { classId, termId, entries } = ctx.body as { classId: string; termId: string; entries: Array<{ dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId?: string | null; teacherId?: string | null; sessionId?: string | null }> }
  if (!classId || !termId || !Array.isArray(entries)) throw badRequest('classId, termId and entries are required')
  const gov = currentPublishedVersionFor(classId, termId)
  if (gov) throw conflict(`This class/term is governed by a published timetable version (${gov.id}) — fork a new modification draft first (POST /timetable/versions/fork)`)

  // Real teacher/room collision check against the rest of the term's live schedule (excluding this class).
  const rest = table('TimetableEntry').filter(e => e.termId === termId && e.classId !== classId)
  for (const e of entries) {
    const clash = rest.find(o => o.dayOfWeek === e.dayOfWeek && o.periodIdx === e.periodIdx &&
      ((e.teacherId && o.teacherId === e.teacherId) || (e.roomId && o.roomId === e.roomId)))
    if (clash) throw conflict('Timetable conflict', { conflicts: [{ rule: clash.teacherId === e.teacherId ? 'teacher' : 'room', classId: clash.classId, classLabel: classLabel(String(clash.classId)), dayOfWeek: clash.dayOfWeek, periodIdx: clash.periodIdx }] })
  }
  const others = table('TimetableEntry').filter(e => e.classId !== classId)
  const mine = entries.map(e => ({ id: uid('tte'), schoolId: SCHOOL_ID, classId, termId, ...e } as Row))
  table('TimetableEntry').length = 0
  table('TimetableEntry').push(...others, ...mine)
  return { items: mine.map(decorateEntry) }
})

route('DELETE', '/timetable/entries/:id', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const rows = table('TimetableEntry')
  const idx = rows.findIndex(r => r.id === ctx.params.id)
  if (idx === -1) throw notFound('Timetable entry')
  const e = rows[idx]
  const gov = currentPublishedVersionFor(String(e.classId), String(e.termId))
  if (gov) throw conflict(`This class/term is governed by a published timetable version (${gov.id}) — fork a new modification draft first`)
  rows.splice(idx, 1)
  return { ok: true }
})

route('POST', '/timetable/copy', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { fromClassId, fromTermId, toClassId, toTermId } = ctx.body as { fromClassId: string; fromTermId: string; toClassId: string; toTermId: string }
  const gov = currentPublishedVersionFor(toClassId, toTermId)
  if (gov) throw conflict(`Target class/term is governed by a published timetable version (${gov.id})`)
  const source = table('TimetableEntry').filter(e => e.classId === fromClassId && e.termId === fromTermId)
  const dbLike: Collections = { ClassSubject: table('ClassSubject') }
  const created: Row[] = []
  for (const e of source) {
    const cs = table('ClassSubject').find(r => r.id === e.classSubjectId)
    const newCs = cs ? ensureClassSubject(dbLike, toClassId, String(cs.subjectId), (e.teacherId as string) ?? null, Number(cs.periodsPerWeek ?? 1)) : undefined
    created.push({ id: uid('tte'), schoolId: SCHOOL_ID, classId: toClassId, termId: toTermId, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: newCs?.id ?? e.classSubjectId, roomId: e.roomId, teacherId: e.teacherId, sessionId: undefined } as Row)
  }
  table('TimetableEntry').push(...created)
  return { items: created.map(decorateEntry) }
})

route('POST', '/timetable/publish', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { published } = ctx.body as { classId: string; termId: string; published: boolean }
  // Legacy pre-T7 publish toggle. In this demo every TimetableEntry row only ever exists via a published
  // TimetableVersion (see seed/timetable.ts + versions.ts#publishVersion), so there's no separate
  // draft-not-yet-published state to flip — accepted as a no-op for API-shape compatibility.
  return { ok: true, published }
})

// ───────────────────────── T4 §1/§2 — TeachingRequirement / TeachingAssignment ─────────────────────────

function serializeRequirement(r: Row) { return r }
function serializeAssignment(r: Row) { return r }

crud('/timetable/teaching-requirements', 'TeachingRequirement', {
  writeRoles: WRITE_ROLES,
  filter: (r, q) => !q.cohortId || r.cohortId === q.cohortId,
  deserialize: (b) => ({ sessionDuration: 'SINGLE', roomRequirement: 'ANY', labDoubleAllowed: true, assignmentMode: 'FIXED', ...b }),
})

route('POST', '/timetable/teaching-requirements/seed-from-class-subjects', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { cohortId } = ctx.body as { cohortId?: string; academicYearId: string }
  const cohorts = cohortId ? [table('Cohort').find(c => c.id === cohortId)].filter((c): c is Row => !!c) : table('Cohort').filter(c => c.type === 'SECTION')
  const created: Row[] = []
  for (const cohort of cohorts) {
    const classIds = (cohort.classIds as string[] | undefined) ?? []
    for (const classId of classIds) {
      for (const cs of table('ClassSubject').filter(r => r.classId === classId)) {
        const exists = table('TeachingRequirement').find(r => r.cohortId === cohort.id && r.subjectId === cs.subjectId)
        if (exists) continue
        const row: Row = { id: uid('trq'), schoolId: SCHOOL_ID, cohortId: cohort.id, subjectId: cs.subjectId, requiredPeriodsPerWeek: cs.periodsPerWeek ?? 1, sessionDuration: 'SINGLE', roomRequirement: 'ANY', specificRoomId: undefined, labDoubleAllowed: true, assignmentMode: 'FIXED' }
        table('TeachingRequirement').push(row)
        created.push(row)
        if (cs.teacherId) {
          table('TeachingAssignment').push({ id: uid('tas'), schoolId: SCHOOL_ID, teachingRequirementId: row.id, teacherId: cs.teacherId, assignmentMode: 'FIXED', selectionReason: 'Seeded from existing ClassSubject', createdAt: nowIso(), createdBy: ctx.actor!.userId } as Row)
        }
      }
    }
  }
  return { created: created.length, requirementIds: created.map(r => r.id) }
})

route('GET', '/timetable/teaching-assignments', (ctx) => {
  requireAuth(ctx)
  const { teachingRequirementId } = ctx.query
  const items = table('TeachingAssignment').filter(r => !teachingRequirementId || r.teachingRequirementId === teachingRequirementId)
  return { items: items.map(serializeAssignment) }
})
route('POST', '/timetable/teaching-assignments', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { teachingRequirementId, teacherId, selectionReason } = ctx.body as { teachingRequirementId: string; teacherId: string; selectionReason?: string }
  const rows = table('TeachingAssignment')
  const idx = rows.findIndex(r => r.teachingRequirementId === teachingRequirementId)
  const row: Row = { id: idx >= 0 ? rows[idx].id : uid('tas'), schoolId: SCHOOL_ID, teachingRequirementId, teacherId, assignmentMode: 'FIXED', selectionReason: selectionReason ?? undefined, createdAt: nowIso(), createdBy: ctx.actor!.userId }
  if (idx >= 0) rows[idx] = row; else rows.push(row)
  return status(201, { item: serializeAssignment(row) })
})
route('DELETE', '/timetable/teaching-assignments/:id', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const rows = table('TeachingAssignment')
  const idx = rows.findIndex(r => r.id === ctx.params.id)
  if (idx === -1) throw notFound('Teaching assignment')
  rows.splice(idx, 1)
  return { ok: true }
})

// ───────────────────────── T5 §1 — assignment modes + pool ─────────────────────────

route('PATCH', '/timetable/teaching-requirements/:id/assignment-mode', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const rows = table('TeachingRequirement')
  const idx = rows.findIndex(r => r.id === ctx.params.id)
  if (idx === -1) throw notFound('Teaching requirement')
  rows[idx] = { ...rows[idx], assignmentMode: (ctx.body as { assignmentMode: string }).assignmentMode }
  return { item: serializeRequirement(rows[idx]) }
})

crud('/timetable/teaching-assignment-pool', 'TeachingAssignmentPoolMember', {
  writeRoles: WRITE_ROLES,
  filter: (r, q) => !q.teachingRequirementId || r.teachingRequirementId === q.teachingRequirementId,
  disable: ['get'],
})

route('POST', '/timetable/teaching-assignments/resolve', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { teachingRequirementId } = ctx.body as { teachingRequirementId: string; termId: string }
  const req = table('TeachingRequirement').find(r => r.id === teachingRequirementId)
  if (!req) throw notFound('Teaching requirement')
  const pool = table('TeachingAssignmentPoolMember').filter(m => m.teachingRequirementId === teachingRequirementId)
  const candidateIds = pool.length ? pool.map(m => String(m.teacherId)) : table('User').filter(u => u.role === 'teacher').map(u => String(u.id))
  // Simplified Mode 2-4 resolution: pick whoever currently has the lowest weekly load among candidates —
  // real, cheap logic; explainable, not the full T5 scoring formula.
  const loadOf = (teacherId: string) => table('TimetableEntry').filter(e => e.teacherId === teacherId).length
  const best = candidateIds.map(id => ({ id, load: loadOf(id) })).sort((a, b) => a.load - b.load)[0]
  if (!best) throw badRequest('No candidate teachers available to resolve this requirement')
  const teacherName = table('User').find(u => u.id === best.id)?.name
  const rows = table('TeachingAssignment')
  const idx = rows.findIndex(r => r.teachingRequirementId === teachingRequirementId)
  const row: Row = { id: idx >= 0 ? rows[idx].id : uid('tas'), schoolId: SCHOOL_ID, teachingRequirementId, teacherId: best.id, assignmentMode: req.assignmentMode ?? 'POOL', selectionReason: `Selected ${teacherName} (current load ${best.load} periods/week) — lowest current load among ${candidateIds.length} candidate(s)`, createdAt: nowIso(), createdBy: ctx.actor!.userId }
  if (idx >= 0) rows[idx] = row; else rows.push(row)
  return { item: serializeAssignment(row) }
})

route('POST', '/timetable/teaching-assignments/resolve-for-cohorts', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { cohortIds } = ctx.body as { cohortIds: string[]; termId: string }
  const reqs = table('TeachingRequirement').filter(r => cohortIds.includes(String(r.cohortId)) && !table('TeachingAssignment').some(a => a.teachingRequirementId === r.id))
  const resolved: Row[] = []
  for (const req of reqs) {
    const loadOf = (teacherId: string) => table('TimetableEntry').filter(e => e.teacherId === teacherId).length
    const teachers = table('User').filter(u => u.role === 'teacher')
    const best = teachers.map(t => ({ id: String(t.id), load: loadOf(String(t.id)) })).sort((a, b) => a.load - b.load)[0]
    if (!best) continue
    const row: Row = { id: uid('tas'), schoolId: SCHOOL_ID, teachingRequirementId: req.id, teacherId: best.id, assignmentMode: req.assignmentMode ?? 'RANDOM', selectionReason: `Auto-resolved: lowest current load (${best.load})`, createdAt: nowIso(), createdBy: ctx.actor!.userId }
    table('TeachingAssignment').push(row)
    resolved.push(row)
  }
  return { items: resolved.map(serializeAssignment) }
})

// ───────────────────────── T5 — TeacherAvailability ─────────────────────────

route('GET', '/timetable/teacher-availability/:teacherId', (ctx) => {
  requireAuth(ctx)
  const items = table('TeacherAvailability').filter(r => r.teacherId === ctx.params.teacherId)
  return { items }
})
route('PUT', '/timetable/teacher-availability', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { teacherId, entries } = ctx.body as { teacherId: string; entries: Array<{ dayOfWeek: number; periodIdx: number; status: string }> }
  const rows = table('TeacherAvailability').filter(r => r.teacherId !== teacherId)
  const mine = entries.map(e => ({ id: uid('ta'), schoolId: SCHOOL_ID, teacherId, ...e } as Row))
  table('TeacherAvailability').length = 0
  table('TeacherAvailability').push(...rows, ...mine)
  return { items: mine }
})

// ───────────────────────── T4 §3 — Constraint Builder ─────────────────────────

const DEFAULT_CONSTRAINT_TYPES = ['TEACHER_COLLISION', 'ROOM_COLLISION', 'COHORT_COLLISION', 'TEACHER_AVAILABILITY', 'ROOM_CAPABILITY_MATCH', 'REQUIRED_WEEKLY_PERIODS', 'FIXED_SESSION']

crud('/timetable/constraints', 'Constraint', {
  writeRoles: WRITE_ROLES,
  filter: (r, q) => (!q.type || r.type === q.type) && (!q.scope || r.scope === q.scope) && (q.enabled === undefined || String(r.enabled) === q.enabled),
})
route('POST', '/timetable/constraints/seed-defaults', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const existing = new Set(table('Constraint').map(r => r.type))
  let added = 0
  for (const type of DEFAULT_CONSTRAINT_TYPES) {
    if (existing.has(type)) continue
    table('Constraint').push({ id: uid('constraint'), schoolId: SCHOOL_ID, type, scope: 'SCHOOL', scopeId: undefined, severity: 'HARD', enabled: true, parameters: {}, source: 'SYSTEM' } as Row)
    added++
  }
  return { added }
})

// ───────────────────────── T5 §2/§3 — Preference / PreferenceProfile ─────────────────────────

const ASSIGNMENT_TYPES = ['QUALIFICATION_MATCH', 'AVAILABILITY_MATCH', 'WORKLOAD_BALANCE', 'CLASS_SUITABILITY', 'TEACHER_PREFERENCE', 'CONFLICT_MINIMIZATION', 'BAND_AFFINITY']
const REFINEMENT_TYPES = ['LAB_SPLIT', 'TEACHER_DAILY_OVERLOAD', 'TEACHER_WEEKLY_OVERLOAD', 'WORKLOAD_VARIANCE', 'TEACHER_GAPS', 'UNPREFERRED_SLOT', 'FORCED_SAME_DAY_REPEAT', 'ADJACENT_SAME_SUBJECT']
const DEFAULT_WEIGHTS: Record<string, number> = { QUALIFICATION_MATCH: 30, AVAILABILITY_MATCH: 15, WORKLOAD_BALANCE: 20, CLASS_SUITABILITY: 10, TEACHER_PREFERENCE: 10, CONFLICT_MINIMIZATION: 10, BAND_AFFINITY: 5, LAB_SPLIT: 25, TEACHER_DAILY_OVERLOAD: 20, TEACHER_WEEKLY_OVERLOAD: 15, WORKLOAD_VARIANCE: 15, TEACHER_GAPS: 10, UNPREFERRED_SLOT: 10, FORCED_SAME_DAY_REPEAT: 3, ADJACENT_SAME_SUBJECT: 2 }

route('GET', '/timetable/preferences', (ctx) => {
  requireAuth(ctx)
  const { scope } = ctx.query
  return { items: table('Preference').filter(r => !scope || r.scope === scope) }
})
route('POST', '/timetable/preferences/seed-defaults', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const existing = new Set(table('Preference').filter(r => r.scope === 'ASSIGNMENT' || r.scope === 'REFINEMENT').map(r => `${r.scope}:${r.type}`))
  let added = 0
  for (const [scope, types] of [['ASSIGNMENT', ASSIGNMENT_TYPES], ['REFINEMENT', REFINEMENT_TYPES]] as const) {
    for (const type of types) {
      if (existing.has(`${scope}:${type}`)) continue
      table('Preference').push({ id: uid('pref'), schoolId: SCHOOL_ID, type, scope, weight: DEFAULT_WEIGHTS[type] ?? 10, priority: 0, enabled: true, parameters: {} } as Row)
      added++
    }
  }
  return { added }
})
route('PATCH', '/timetable/preferences/:type', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const rows = table('Preference')
  const idx = rows.findIndex(r => r.type === ctx.params.type)
  if (idx === -1) throw notFound('Preference')
  rows[idx] = { ...rows[idx], ...(ctx.body as object) }
  return { item: rows[idx] }
})

const PROFILE_NAMES = ['DEFAULT', 'BALANCED', 'TEACHER_FRIENDLY', 'STUDENT_FRIENDLY', 'EXAM_PREP', 'PRIMARY_SCHOOL', 'LAB_HEAVY']
route('GET', '/timetable/preference-profiles', (ctx) => { requireAuth(ctx); return { items: table('PreferenceProfile') } })
route('POST', '/timetable/preference-profiles/seed-defaults', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const existing = new Set(table('PreferenceProfile').map(r => r.name))
  let added = 0
  for (const name of PROFILE_NAMES) {
    if (existing.has(name)) continue
    table('PreferenceProfile').push({ id: uid('profile'), schoolId: SCHOOL_ID, name, description: undefined, weightOverrides: {}, active: name === 'DEFAULT' } as Row)
    added++
  }
  return { added }
})
route('POST', '/timetable/preference-profiles/activate', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { name } = ctx.body as { name: string }
  const rows = table('PreferenceProfile')
  const idx = rows.findIndex(r => r.name === name)
  if (idx === -1) throw notFound('Preference profile')
  for (const r of rows) r.active = r.name === name
  return { item: rows[idx] }
})
route('PATCH', '/timetable/preference-profiles/:name', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const rows = table('PreferenceProfile')
  const idx = rows.findIndex(r => r.name === ctx.params.name)
  if (idx === -1) throw notFound('Preference profile')
  const { weightOverrides } = ctx.body as { weightOverrides?: Record<string, number> }
  rows[idx] = { ...rows[idx], weightOverrides: { ...(rows[idx].weightOverrides as object ?? {}), ...(weightOverrides ?? {}) } }
  return { item: rows[idx] }
})

// ───────────────────────── T1 — PeriodTemplate / WorkingDayPattern ─────────────────────────

crud('/timetable/period-templates', 'PeriodTemplate', { writeRoles: WRITE_ROLES })
crud('/timetable/working-day-patterns', 'WorkingDayPattern', { writeRoles: WRITE_ROLES, filter: (r, q) => !q.academicYearId || r.academicYearId === q.academicYearId })

// Day-of-week override rows for a base PeriodTemplate (T1 D7 — e.g. a shorter Saturday). Registered after
// the plain crud() above; different segment counts (`.../overrides`, `.../:baseTemplateId/overrides`,
// `.../overrides/:id`) never collide with crud's `/timetable/period-templates`(/:id) patterns.
route('GET', '/timetable/period-templates/:baseTemplateId/overrides', (ctx) => {
  requireAuth(ctx)
  return { items: table('PeriodTemplateOverride').filter(r => r.baseTemplateId === ctx.params.baseTemplateId) }
})
route('POST', '/timetable/period-templates/overrides', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { baseTemplateId, dayOfWeek, name, periods } = ctx.body as { baseTemplateId: string; dayOfWeek: number; name: string; periods: unknown }
  const row: Row = { id: uid('pto'), schoolId: SCHOOL_ID, baseTemplateId, dayOfWeek, name, periods }
  table('PeriodTemplateOverride').push(row)
  return status(201, { item: row })
})
route('PATCH', '/timetable/period-templates/overrides/:id', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const rows = table('PeriodTemplateOverride')
  const idx = rows.findIndex(r => r.id === ctx.params.id)
  if (idx === -1) throw notFound('Period template override')
  rows[idx] = { ...rows[idx], ...(ctx.body as object) }
  return { item: rows[idx] }
})
route('DELETE', '/timetable/period-templates/overrides/:id', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const rows = table('PeriodTemplateOverride')
  const idx = rows.findIndex(r => r.id === ctx.params.id)
  if (idx === -1) throw notFound('Period template override')
  rows.splice(idx, 1)
  return { ok: true }
})

// ───────────────────────── Auto-generate / refine / commit ─────────────────────────
// SIMULATED FOR SPEED: deterministic greedy round-robin (see timetableEngine.ts), not the real
// backtracking + simulated-annealing solver. Refine is a no-op pass-through that reports a small synthetic
// improvement — genuinely running SA over a demo-sized draft isn't the point of the mock.

function requirementsToPlacementRequests(cohortIds: string[]): PlacementRequest[] {
  const out: PlacementRequest[] = []
  for (const cohortId of cohortIds) {
    const cohort = table('Cohort').find(c => c.id === cohortId)
    const classIds = (cohort?.classIds as string[] | undefined) ?? []
    const reqs = table('TeachingRequirement').filter(r => r.cohortId === cohortId)
    for (const req of reqs) {
      const assignment = table('TeachingAssignment').find(a => a.teachingRequirementId === req.id)
      const subject = table('Subject').find(s => s.id === req.subjectId)
      for (const classId of classIds) {
        out.push({
          classId, subjectId: String(req.subjectId), subjectName: subject?.name as string ?? String(req.subjectId),
          teacherId: assignment ? String(assignment.teacherId) : null, teacherName: assignment ? (table('User').find(u => u.id === assignment.teacherId)?.name as string ?? null) : null,
          periodsPerWeek: Number(req.requiredPeriodsPerWeek ?? 1), sessionDuration: (req.sessionDuration as PlacementRequest['sessionDuration']) ?? 'SINGLE',
          roomId: req.roomRequirement === 'SPECIFIC_ROOM' ? (req.specificRoomId as string ?? null) : null,
          wantsLab: req.roomRequirement === 'LAB_TYPE' || needsLab(String(req.subjectId)),
        })
      }
    }
  }
  return out
}

route('POST', '/timetable/auto-generate', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { cohortIds, termId, mode } = ctx.body as { cohortIds: string[]; termId: string; mode: 'fill-empty' | 'full-regenerate' }
  if (!cohortIds?.length) throw badRequest('cohortIds is required')
  const classBusy: Occupancy = new Map(); const teacherBusy: Occupancy = new Map(); const roomBusy: Occupancy = new Map()
  const allClassIds = new Set(cohortIds.flatMap(id => (table('Cohort').find(c => c.id === id)?.classIds as string[] | undefined) ?? []))
  // fill-empty seeds occupancy with whatever's already there for these classes so it's never overwritten;
  // full-regenerate starts from a clean slate for these classes but still respects everyone ELSE's schedule.
  const existing = table('TimetableEntry').filter(e => e.termId === termId)
  for (const e of existing) {
    if (mode === 'fill-empty' && !allClassIds.has(String(e.classId))) continue
    if (mode === 'full-regenerate' && allClassIds.has(String(e.classId))) continue
    const slot = `${e.dayOfWeek}:${e.periodIdx}`
    const mark = (o: Occupancy, id: string) => { const s = o.get(id) ?? new Set<string>(); s.add(slot); o.set(id, s) }
    mark(classBusy, String(e.classId))
    if (e.teacherId) mark(teacherBusy, String(e.teacherId))
    if (e.roomId) mark(roomBusy, String(e.roomId))
  }
  const requests = requirementsToPlacementRequests(cohortIds)
  const dbLike: Collections = { ClassSubject: table('ClassSubject'), Class: table('Class'), Grade: table('Grade'), Room: table('Room') }
  const { placed, unplaced } = greedyPlace(dbLike, requests, classBusy, teacherBusy, roomBusy, labRoomIds(dbLike))
  const draftEntries = placed.map(e => {
    const cs = table('ClassSubject').find(r => r.id === e.classSubjectId)
    const subject = cs ? table('Subject').find(s => s.id === cs.subjectId) : undefined
    return {
      classId: e.classId, classLabel: classLabel(e.classId), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId,
      subjectName: subject?.name ?? '', subjectColor: subject?.color ?? '#6366f1', roomId: e.roomId, roomName: e.roomId ? table('Room').find(r => r.id === e.roomId)?.name : undefined,
      teacherId: e.teacherId, teacherName: e.teacherId ? table('User').find(u => u.id === e.teacherId)?.name : undefined, isDoublePeriod: false,
    }
  })
  return { draftEntries, unplaced, conflictsAvoided: 0 }
})

route('POST', '/timetable/auto-generate/refine', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { draftEntries } = ctx.body as { draftEntries: Array<Record<string, unknown>> }
  // No-op pass-through — see this file's module doc comment. Reports a small synthetic score improvement
  // so the Timetable Builder's "Refine" UI has something honest-looking to show without a real SA pass.
  return {
    draftEntries, groups: [], scoreBefore: 100, scoreAfter: 92, improvementPct: 8, hardViolationsBefore: 0, hardViolationsAfter: 0,
  }
})

function commitEntries(termId: string, mode: 'fill-empty' | 'full-regenerate', draftEntries: Array<{ classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId?: string | null; teacherId?: string | null; sessionId?: string | null }>) {
  const classIds = [...new Set(draftEntries.map(e => e.classId))]
  for (const classId of classIds) {
    const gov = currentPublishedVersionFor(classId, termId)
    if (gov) throw conflict(`Class ${classLabel(classId)} is governed by a published timetable version (${gov.id})`)
  }
  const rows = table('TimetableEntry')
  const touchedSlot = (r: Row) => draftEntries.some(d => d.classId === r.classId && d.dayOfWeek === r.dayOfWeek && d.periodIdx === r.periodIdx)
  const kept = rows.filter(r => {
    if (r.termId !== termId || !classIds.includes(String(r.classId))) return true // untouched class/term — always kept
    return mode === 'fill-empty' && !touchedSlot(r) // full-regenerate clears the whole class; fill-empty only clears touched slots
  })
  const created = draftEntries.map(e => ({ id: uid('tte'), schoolId: SCHOOL_ID, termId, ...e } as Row))
  table('TimetableEntry').length = 0
  table('TimetableEntry').push(...kept, ...created)
  const byClass = new Map<string, number>()
  for (const e of created) byClass.set(e.classId as string, (byClass.get(e.classId as string) ?? 0) + 1)
  return { committed: created.length, classes: [...byClass.entries()].map(([classId, entries]) => ({ classId, entries })) }
}

route('POST', '/timetable/auto-generate/commit', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const { termId, mode, draftEntries } = ctx.body as { termId: string; mode: 'fill-empty' | 'full-regenerate'; draftEntries: Array<{ classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId?: string | null; teacherId?: string | null }> }
  return commitEntries(termId, mode, draftEntries)
})

export { commitEntries, requirementsToPlacementRequests, decorateEntry, classLabel, currentPublishedVersionFor }
