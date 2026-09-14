// T7 (versioning + locks + the override system) and T8 (what-if / partial re-optimization). See
// server/src/modules/timetable/{versions,locks,overrides,whatif}.ts for the real shapes/state machine this
// mirrors (read in full before writing this file). Version/lock/publish state transitions are cheap, real
// conditional logic — implemented genuinely, per the batch's "simulate only the algorithmic parts"
// instruction. What-if's TEACHER_UNAVAILABLE/ROOM_UNAVAILABLE/PERIOD_REMOVED/EVENT_BLOCKING_SLOTS handling
// does real, minimal-affected-region relocation with real conflict-checking; REQUIREMENT_ADDED/CHANGED is a
// documented simplification (see that handler below).

import { route, requireAuth, requireRole, status } from '../router'
import { table, uid, nowIso, SCHOOL_ID, type Row } from '../store'
import { badRequest, notFound, conflict } from '../http'
import { classLabel } from './timetableCore'
import { isBusy, markBusy, needsLab, slotKey, type Occupancy } from './timetableEngine'

const WRITE_ROLES = ['admin', 'superadmin']
const EDITABLE_STATUSES = new Set(['DRAFT', 'GENERATED', 'MODIFIED', 'APPROVED'])

interface VersionEntry { classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId: string | null; teacherId: string | null; sessionId: string | null }

function getVersion(id: string): Row {
  const v = table('TimetableVersion').find(r => r.id === id)
  if (!v) throw notFound('Timetable version')
  return v
}
function assertEditable(v: Row) {
  if (!EDITABLE_STATUSES.has(String(v.status))) {
    throw conflict(`Timetable version ${v.id} is ${v.status} and cannot be hand-edited — ${v.status === 'PUBLISHED' ? 'fork a new modification draft first' : 'only DRAFT/GENERATED/MODIFIED/APPROVED versions accept overrides'}`)
  }
}
function serializeVersion(v: Row) {
  return { ...v, entryCount: (v.entries as unknown[] | undefined)?.length ?? 0 }
}
const vSlotKey = (e: { classId: string; dayOfWeek: number; periodIdx: number }) => `${e.classId}:${e.dayOfWeek}:${e.periodIdx}`
function computeDiff(before: VersionEntry[], after: VersionEntry[]) {
  const beforeBySlot = new Map(before.map(e => [vSlotKey(e), e]))
  const afterBySlot = new Map(after.map(e => [vSlotKey(e), e]))
  const added: VersionEntry[] = []; const removed: VersionEntry[] = []; const changed: { before: VersionEntry; after: VersionEntry }[] = []
  for (const [key, a] of afterBySlot) {
    const b = beforeBySlot.get(key)
    if (!b) { added.push(a); continue }
    if (b.classSubjectId !== a.classSubjectId || b.roomId !== a.roomId || b.teacherId !== a.teacherId || b.sessionId !== a.sessionId) changed.push({ before: b, after: a })
  }
  for (const [key, b] of beforeBySlot) if (!afterBySlot.has(key)) removed.push(b)
  return { added, removed, changed }
}

// ───────────────────────── T7 §1/§2 — TimetableVersion lineage ─────────────────────────

route('GET', '/timetable/versions', (ctx) => {
  requireAuth(ctx)
  const { termId, status: st, cohortId } = ctx.query
  let items = table('TimetableVersion').filter(v => (!termId || v.termId === termId) && (!st || v.status === st))
  if (cohortId) items = items.filter(v => (v.scopeCohortIds as string[] | undefined)?.includes(cohortId))
  return { items: items.map(serializeVersion) }
})
route('GET', '/timetable/versions/:id', (ctx) => { requireAuth(ctx); return { item: serializeVersion(getVersion(ctx.params.id)) } })

route('POST', '/timetable/versions/fork', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const { termId, classIds, cohortIds, changeReason } = ctx.body as { termId: string; classIds?: string[]; cohortIds?: string[]; changeReason?: string }
  let resolvedClassIds = classIds ?? []
  if (!resolvedClassIds.length && cohortIds?.length) {
    resolvedClassIds = [...new Set(cohortIds.flatMap(id => (table('Cohort').find(c => c.id === id)?.classIds as string[] | undefined) ?? []))]
  }
  if (!resolvedClassIds.length) throw badRequest('classIds or cohortIds is required')
  const liveRows = table('TimetableEntry').filter(e => e.termId === termId && resolvedClassIds.includes(String(e.classId)))
  const entries: VersionEntry[] = liveRows.map(e => ({ classId: String(e.classId), dayOfWeek: Number(e.dayOfWeek), periodIdx: Number(e.periodIdx), classSubjectId: String(e.classSubjectId), roomId: (e.roomId as string) ?? null, teacherId: (e.teacherId as string) ?? null, sessionId: (e.sessionId as string) ?? null }))
  const governingIds = [...new Set(liveRows.map(r => r.timetableVersionId).filter(Boolean))] as string[]
  const governing = governingIds.map(id => table('TimetableVersion').find(v => v.id === id)).filter((v): v is Row => !!v)
  const parentVersionId = governing.find(v => v.status === 'PUBLISHED')?.id
  const version: Row = {
    id: uid('tv'), schoolId: SCHOOL_ID, academicYearId: 'ay-2025', termId,
    scopeCohortIds: cohortIds ?? [], scopeClassIds: resolvedClassIds, status: 'DRAFT', parentVersionId, generationJobId: undefined,
    changeReason: changeReason ?? undefined, entries, diffFromParent: { added: [], removed: [], changed: [] },
    publishedAt: undefined, archivedAt: undefined, createdById: actor.userId, createdAt: nowIso(),
  }
  table('TimetableVersion').push(version)
  return status(201, { item: serializeVersion(version) })
})

route('POST', '/timetable/versions/from-job', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const { jobId } = ctx.body as { jobId: string }
  const job = table('TimetableGenerationJob').find(j => j.id === jobId)
  if (!job) throw notFound('Timetable generation job')
  if (job.status !== 'COMPLETED') throw badRequest(`Job is ${job.status}, not COMPLETED — nothing to version`)
  const raw = (job.draftEntries as Array<{ classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId?: string | null; teacherId?: string | null; sessionId?: string | null }>) ?? []
  const entries: VersionEntry[] = raw.map(e => ({ classId: e.classId, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId, roomId: e.roomId ?? null, teacherId: e.teacherId ?? null, sessionId: e.sessionId ?? null }))
  const cohortIds = job.scopeCohortIds as string[]
  const classIds = [...new Set(entries.map(e => e.classId))]
  const predecessor = table('TimetableVersion').filter(v => v.termId === job.termId && v.status === 'PUBLISHED').sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))[0]
  const parentVersionId = predecessor && classIds.some(c => (predecessor.scopeClassIds as string[]).includes(c)) ? predecessor.id : undefined
  const version: Row = {
    id: uid('tv'), schoolId: SCHOOL_ID, academicYearId: job.academicYearId, termId: job.termId,
    scopeCohortIds: cohortIds, scopeClassIds: classIds, status: 'GENERATED', generationJobId: job.id, parentVersionId,
    changeReason: undefined, entries, diffFromParent: computeDiff(parentVersionId && predecessor ? predecessor.entries as VersionEntry[] : [], entries),
    publishedAt: undefined, archivedAt: undefined, createdById: actor.userId, createdAt: nowIso(),
  }
  table('TimetableVersion').push(version)
  return status(201, { item: serializeVersion(version) })
})

route('POST', '/timetable/versions/:id/approve', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const version = getVersion(ctx.params.id)
  if (!EDITABLE_STATUSES.has(String(version.status))) throw conflict(`Version is ${version.status} — only DRAFT/GENERATED/MODIFIED/APPROVED versions can be approved`)
  version.status = 'APPROVED'
  return { item: serializeVersion(version) }
})

route('POST', '/timetable/versions/:id/publish', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const version = getVersion(ctx.params.id)
  if (version.status === 'PUBLISHED') throw badRequest('Already published')
  if (version.status === 'ARCHIVED') throw badRequest('Cannot publish an archived version')
  if (version.status !== 'APPROVED') throw conflict(`Version is ${version.status} — call POST /timetable/versions/:id/approve first`)
  const classIds = version.scopeClassIds as string[]
  if (!classIds.length) throw badRequest('Version has no scoped classes to publish')
  const entries = version.entries as VersionEntry[]

  // Materialize: delete this scope's current live rows, write the version's snapshot as real TimetableEntry
  // rows tagged with this version's id. This is the ONE sanctioned writer allowed to bypass the "governed by
  // a PUBLISHED version" guard the legacy PUT /entries path enforces (see timetableCore.ts).
  const rows = table('TimetableEntry')
  const kept = rows.filter(r => r.termId !== version.termId || !classIds.includes(String(r.classId)))
  const created = entries.map(e => ({ id: uid('tte'), schoolId: SCHOOL_ID, classId: e.classId, termId: version.termId, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId, roomId: e.roomId ?? undefined, teacherId: e.teacherId ?? undefined, sessionId: e.sessionId ?? undefined, timetableVersionId: version.id } as Row))
  table('TimetableEntry').length = 0
  table('TimetableEntry').push(...kept, ...created)

  const toArchive = new Set<string>()
  if (version.parentVersionId) {
    const parent = table('TimetableVersion').find(v => v.id === version.parentVersionId)
    if (parent?.status === 'PUBLISHED') toArchive.add(String(parent.id))
  }
  for (const other of table('TimetableVersion').filter(v => v.termId === version.termId && v.status === 'PUBLISHED' && v.id !== version.id)) {
    const otherClasses = new Set(other.scopeClassIds as string[])
    if (classIds.some(c => otherClasses.has(c))) toArchive.add(String(other.id))
  }
  for (const id of toArchive) {
    const v = table('TimetableVersion').find(r => r.id === id)!
    v.status = 'ARCHIVED'; v.archivedAt = nowIso()
  }
  const { changeReason } = ctx.body as { changeReason?: string }
  version.status = 'PUBLISHED'; version.publishedAt = nowIso(); version.changeReason = changeReason ?? version.changeReason
  void actor
  return { item: serializeVersion(version), archivedVersionIds: [...toArchive] }
})

route('POST', '/timetable/versions/:id/discard', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  const version = getVersion(ctx.params.id)
  if (!EDITABLE_STATUSES.has(String(version.status))) throw conflict(`Version is ${version.status} — only an editable (unpublished) version can be discarded`)
  version.status = 'ARCHIVED'; version.archivedAt = nowIso()
  return { item: serializeVersion(version) }
})

// ───────────────────────── T7 §3 — TimetableLock ─────────────────────────

route('GET', '/timetable/versions/:id/locks', (ctx) => {
  requireAuth(ctx)
  const activeOnly = ctx.query.activeOnly === 'true'
  return { items: table('TimetableLock').filter(l => l.timetableVersionId === ctx.params.id && (!activeOnly || l.active)) }
})
route('POST', '/timetable/versions/:id/locks', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const version = getVersion(ctx.params.id)
  const { lockType, targetType, targetId, dayOfWeek, periodIdx, reason } = ctx.body as { lockType: string; targetType?: string; targetId?: string | null; dayOfWeek?: number | null; periodIdx?: number | null; reason?: string | null }
  if (lockType === 'ASSIGNMENT' && (dayOfWeek == null || periodIdx == null || !targetId)) throw badRequest('ASSIGNMENT locks require targetId, dayOfWeek and periodIdx')
  if (['TEACHER', 'ROOM', 'COHORT', 'SESSION'].includes(lockType) && !targetId) throw badRequest(`${lockType} locks require targetId`)
  if (lockType === 'DAY' && dayOfWeek == null) throw badRequest('DAY locks require dayOfWeek')
  const lock: Row = { id: uid('lock'), schoolId: SCHOOL_ID, timetableVersionId: version.id, lockType, targetType: targetType ?? 'none', targetId: targetId ?? undefined, dayOfWeek: dayOfWeek ?? undefined, periodIdx: periodIdx ?? undefined, reason: reason ?? undefined, createdById: actor.userId, createdAt: nowIso(), active: true, releasedAt: undefined, releasedById: undefined }
  table('TimetableLock').push(lock)
  return status(201, { item: lock })
})
route('POST', '/timetable/locks/:id/release', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const lock = table('TimetableLock').find(l => l.id === ctx.params.id)
  if (!lock) throw notFound('Timetable lock')
  if (!lock.active) throw badRequest('Lock is already released')
  lock.active = false; lock.releasedAt = nowIso(); lock.releasedById = actor.userId
  return { item: lock }
})

function lockBlocks(lock: Row, e: { classSubjectId: string; teacherId: string | null; roomId: string | null; sessionId: string | null; dayOfWeek: number; periodIdx: number }): boolean {
  switch (lock.lockType) {
    case 'TEACHER': return !!e.teacherId && lock.targetId === e.teacherId
    case 'ROOM': return !!e.roomId && lock.targetId === e.roomId
    case 'SESSION': return !!e.sessionId && lock.targetId === e.sessionId
    case 'DAY': return lock.dayOfWeek === e.dayOfWeek
    case 'PERIOD': return lock.periodIdx === e.periodIdx
    case 'ASSIGNMENT': return lock.targetId === e.classSubjectId && lock.dayOfWeek === e.dayOfWeek && lock.periodIdx === e.periodIdx
    default: return false
  }
}
function activeLocksForTerm(termId: string): Row[] {
  const versionIds = new Set(table('TimetableVersion').filter(v => v.termId === termId).map(v => v.id))
  return table('TimetableLock').filter(l => l.active && versionIds.has(String(l.timetableVersionId)))
}

// ───────────────────────── T7 §4 — override system (move/swap/regenerate-slot/undo/revert-to) ─────────────────────────

interface OverrideConflict { rule: 'teacher' | 'room' | 'occupied' | 'locked'; classId: string; classLabel: string; dayOfWeek: number; periodIdx: number; teacherId?: string; roomId?: string; lockId?: string; lockReason?: string }

function computeConflicts(version: Row, nextEntries: VersionEntry[], touched: Set<string>): OverrideConflict[] {
  const conflicts: OverrideConflict[] = []
  const bySlot = new Map<string, VersionEntry>()
  for (const e of nextEntries) {
    const k = vSlotKey(e)
    if (bySlot.has(k) && bySlot.get(k) !== e) conflicts.push({ rule: 'occupied', classId: e.classId, classLabel: classLabel(e.classId), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx })
    bySlot.set(k, e)
  }
  const sameSession = (a: { sessionId: string | null }, b: { sessionId: string | null }) => !!a.sessionId && !!b.sessionId && a.sessionId === b.sessionId
  const byTeacher = new Map<string, VersionEntry>(); const byRoom = new Map<string, VersionEntry>()
  for (const e of nextEntries) {
    if (e.teacherId) {
      const k = `${e.teacherId}@${e.dayOfWeek}:${e.periodIdx}`
      const other = byTeacher.get(k)
      if (other && other.classId !== e.classId && !sameSession(e, other)) conflicts.push({ rule: 'teacher', classId: e.classId, classLabel: classLabel(e.classId), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, teacherId: e.teacherId })
      byTeacher.set(k, e)
    }
    if (e.roomId) {
      const k = `${e.roomId}@${e.dayOfWeek}:${e.periodIdx}`
      const other = byRoom.get(k)
      if (other && other.classId !== e.classId && !sameSession(e, other)) conflicts.push({ rule: 'room', classId: e.classId, classLabel: classLabel(e.classId), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, roomId: e.roomId })
      byRoom.set(k, e)
    }
  }
  const scope = new Set(version.scopeClassIds as string[])
  const others = table('TimetableEntry').filter(r => r.termId === version.termId && !scope.has(String(r.classId)))
  for (const o of others) {
    for (const e of nextEntries) {
      if (!touched.has(vSlotKey(e))) continue
      if (e.dayOfWeek !== o.dayOfWeek || e.periodIdx !== o.periodIdx) continue
      if (e.teacherId && e.teacherId === o.teacherId && !sameSession(e, { sessionId: (o.sessionId as string) ?? null })) conflicts.push({ rule: 'teacher', classId: String(o.classId), classLabel: classLabel(String(o.classId)), dayOfWeek: Number(o.dayOfWeek), periodIdx: Number(o.periodIdx), teacherId: e.teacherId })
      if (e.roomId && e.roomId === o.roomId && !sameSession(e, { sessionId: (o.sessionId as string) ?? null })) conflicts.push({ rule: 'room', classId: String(o.classId), classLabel: classLabel(String(o.classId)), dayOfWeek: Number(o.dayOfWeek), periodIdx: Number(o.periodIdx), roomId: e.roomId })
    }
  }
  const locks = activeLocksForTerm(String(version.termId))
  for (const e of nextEntries) {
    if (!touched.has(vSlotKey(e))) continue
    for (const lock of locks) {
      if (lockBlocks(lock, e)) conflicts.push({ rule: 'locked', classId: e.classId, classLabel: classLabel(e.classId), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, lockId: String(lock.id), lockReason: lock.reason as string | undefined })
    }
  }
  return conflicts
}
function throwIfConflicts(conflicts: OverrideConflict[]) {
  if (conflicts.length) throw conflict(`${conflicts.length} timetable conflict${conflicts.length === 1 ? '' : 's'}`, { conflicts })
}
function applyDiff(current: VersionEntry[], before: VersionEntry[], after: VersionEntry[]): VersionEntry[] {
  const touched = new Set([...before, ...after].map(vSlotKey))
  return [...current.filter(e => !touched.has(vSlotKey(e))), ...after]
}
function nextSeq(versionId: string) {
  const last = table('TimetableEditEvent').filter(e => e.timetableVersionId === versionId).sort((a, b) => Number(b.seq) - Number(a.seq))[0]
  return (Number(last?.seq) || 0) + 1
}
function recordEvent(actorId: string, versionId: string, action: string, before: VersionEntry[], after: VersionEntry[], reason?: string | null) {
  const row: Row = { id: uid('evt'), schoolId: SCHOOL_ID, timetableVersionId: versionId, seq: nextSeq(versionId), action, before, after, reason: reason ?? undefined, createdById: actorId, createdAt: nowIso(), undone: false, undoneAt: undefined }
  table('TimetableEditEvent').push(row)
  return row
}
function saveEntries(version: Row, entries: VersionEntry[]) {
  version.entries = entries
  if (version.status !== 'PUBLISHED' && version.status !== 'ARCHIVED') version.status = 'MODIFIED'
}

route('POST', '/timetable/versions/:id/move', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const version = getVersion(ctx.params.id)
  assertEditable(version)
  const { classId, fromDayOfWeek, fromPeriodIdx, toDayOfWeek, toPeriodIdx, reason, dryRun } = ctx.body as { classId: string; fromDayOfWeek: number; fromPeriodIdx: number; toDayOfWeek: number; toPeriodIdx: number; reason?: string | null; dryRun?: boolean }
  const current = version.entries as VersionEntry[]
  const from = current.find(e => e.classId === classId && e.dayOfWeek === fromDayOfWeek && e.periodIdx === fromPeriodIdx)
  if (!from) throw notFound('Timetable entry at the source slot')
  if (current.some(e => e.classId === classId && e.dayOfWeek === toDayOfWeek && e.periodIdx === toPeriodIdx)) throw badRequest('Target slot is already occupied for this class — use swap instead')
  const moved: VersionEntry = { ...from, dayOfWeek: toDayOfWeek, periodIdx: toPeriodIdx }
  const next = applyDiff(current, [from], [moved])
  const touched = new Set([vSlotKey(from), vSlotKey(moved)])
  const conflicts = computeConflicts(version, next, touched)
  if (dryRun) return { ok: conflicts.length === 0, conflicts }
  throwIfConflicts(conflicts)
  recordEvent(actor.userId, version.id, 'MOVE', [from], [moved], reason)
  saveEntries(version, next)
  return { ok: true, conflicts: [], entries: next }
})

route('POST', '/timetable/versions/:id/swap', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const version = getVersion(ctx.params.id)
  assertEditable(version)
  const { a, b, reason, dryRun } = ctx.body as { a: { classId: string; dayOfWeek: number; periodIdx: number }; b: { classId: string; dayOfWeek: number; periodIdx: number }; reason?: string | null; dryRun?: boolean }
  const current = version.entries as VersionEntry[]
  const ea = current.find(e => e.classId === a.classId && e.dayOfWeek === a.dayOfWeek && e.periodIdx === a.periodIdx)
  const eb = current.find(e => e.classId === b.classId && e.dayOfWeek === b.dayOfWeek && e.periodIdx === b.periodIdx)
  if (!ea) throw notFound('Timetable entry at slot A')
  if (!eb) throw notFound('Timetable entry at slot B')
  const aAfter: VersionEntry = { ...ea, dayOfWeek: eb.dayOfWeek, periodIdx: eb.periodIdx }
  const bAfter: VersionEntry = { ...eb, dayOfWeek: ea.dayOfWeek, periodIdx: ea.periodIdx }
  const next = applyDiff(current, [ea, eb], [aAfter, bAfter])
  const touched = new Set([vSlotKey(ea), vSlotKey(eb)])
  const conflicts = computeConflicts(version, next, touched)
  if (dryRun) return { ok: conflicts.length === 0, conflicts }
  throwIfConflicts(conflicts)
  recordEvent(actor.userId, version.id, 'SWAP', [ea, eb], [aAfter, bAfter], reason)
  saveEntries(version, next)
  return { ok: true, conflicts: [], entries: next }
})

route('POST', '/timetable/versions/:id/regenerate-slot', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const version = getVersion(ctx.params.id)
  assertEditable(version)
  const { classId, dayOfWeek, periodIdx, reason, dryRun } = ctx.body as { classId: string; dayOfWeek: number; periodIdx: number; reason?: string | null; dryRun?: boolean }
  const current = version.entries as VersionEntry[]
  const existing = current.find(e => e.classId === classId && e.dayOfWeek === dayOfWeek && e.periodIdx === periodIdx)
  if (!existing) throw notFound('Timetable entry at this slot')
  const cs = table('ClassSubject').find(r => r.id === existing.classSubjectId)
  let roomId = existing.roomId
  if (cs && needsLab(String(cs.subjectId))) {
    const rooms = table('Room').filter(r => r.kind === 'LAB')
    const busyRoomIds = new Set<string>()
    for (const e of current) if (e !== existing && e.roomId && e.dayOfWeek === dayOfWeek && e.periodIdx === periodIdx) busyRoomIds.add(e.roomId)
    for (const o of table('TimetableEntry').filter(r => r.termId === version.termId && r.dayOfWeek === dayOfWeek && r.periodIdx === periodIdx && r.roomId)) busyRoomIds.add(String(o.roomId))
    roomId = rooms.find(r => !busyRoomIds.has(String(r.id)))?.id as string ?? null
  }
  const regenerated: VersionEntry = { ...existing, roomId }
  const next = applyDiff(current, [existing], [regenerated])
  const touched = new Set([vSlotKey(existing)])
  const conflicts = computeConflicts(version, next, touched)
  if (dryRun) return { ok: conflicts.length === 0, conflicts }
  throwIfConflicts(conflicts)
  recordEvent(actor.userId, version.id, 'REGENERATE_SLOT', [existing], [regenerated], reason)
  saveEntries(version, next)
  return { ok: true, conflicts: [], entries: next }
})

route('POST', '/timetable/versions/:id/undo', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const version = getVersion(ctx.params.id)
  assertEditable(version)
  const last = table('TimetableEditEvent').filter(e => e.timetableVersionId === version.id && !e.undone && ['MOVE', 'SWAP', 'REGENERATE_SLOT'].includes(String(e.action))).sort((a, b) => Number(b.seq) - Number(a.seq))[0]
  if (!last) throw badRequest('Nothing to undo for this version')
  const current = version.entries as VersionEntry[]
  const reverted = applyDiff(current, last.after as VersionEntry[], last.before as VersionEntry[])
  recordEvent(actor.userId, version.id, 'UNDO', last.after as VersionEntry[], last.before as VersionEntry[], `undo of #${last.seq} (${last.action})`)
  last.undone = true; last.undoneAt = nowIso()
  saveEntries(version, reverted)
  return { ok: true, revertedEventSeq: last.seq, entries: reverted }
})

route('POST', '/timetable/versions/:id/revert-to', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const version = getVersion(ctx.params.id)
  assertEditable(version)
  const { seq } = ctx.body as { seq: number }
  const toUndo = table('TimetableEditEvent').filter(e => e.timetableVersionId === version.id && !e.undone && ['MOVE', 'SWAP', 'REGENERATE_SLOT'].includes(String(e.action)) && Number(e.seq) > seq).sort((a, b) => Number(b.seq) - Number(a.seq))
  if (!toUndo.length) throw badRequest(`Nothing to revert — no undone-eligible change after event #${seq}`)
  let current = version.entries as VersionEntry[]
  for (const event of toUndo) {
    current = applyDiff(current, event.after as VersionEntry[], event.before as VersionEntry[])
    recordEvent(actor.userId, version.id, 'UNDO', event.after as VersionEntry[], event.before as VersionEntry[], `revert-to #${seq} (undoing #${event.seq})`)
    event.undone = true; event.undoneAt = nowIso()
  }
  saveEntries(version, current)
  return { ok: true, revertedEventSeqs: toUndo.map(e => e.seq), entries: current }
})

route('GET', '/timetable/versions/:id/edit-events', (ctx) => {
  requireAuth(ctx)
  return { items: table('TimetableEditEvent').filter(e => e.timetableVersionId === ctx.params.id).sort((a, b) => Number(a.seq) - Number(b.seq)) }
})

// ───────────────────────── T8 — What-If / partial re-optimization ─────────────────────────
// Real, minimal-affected-region relocation for TEACHER_UNAVAILABLE / ROOM_UNAVAILABLE / PERIOD_REMOVED /
// EVENT_BLOCKING_SLOTS (the four event types that reduce to "these sessions must leave their current
// slot" — real conflict-checking, real lock-respecting). REQUIREMENT_ADDED/CHANGED is a documented
// simplification: it reports the delta as unplaced/diagnostics rather than genuinely re-placing, since
// doing that for real needs the same multi-class-simultaneous solve `/auto-generate` already does.

route('POST', '/timetable/what-if', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const { versionId, changeEvent } = ctx.body as { versionId: string; changeEvent: { type: string; teacherId?: string; roomId?: string; slots?: Array<{ dayOfWeek: number; periodIdx: number }>; dayOfWeek?: number; periodIdx?: number; classIds?: string[]; cohortIds?: string[]; teachingRequirementId?: string } }
  const version = getVersion(versionId)
  const scopeClassIds = version.scopeClassIds as string[]
  if (!scopeClassIds.length) throw badRequest('Version has no scoped classes to patch')
  const entries = version.entries as VersionEntry[]
  const locks = activeLocksForTerm(String(version.termId))
  const lockBlockingEntry = (e: VersionEntry) => locks.find(l => lockBlocks(l, e))

  let movableSeed: VersionEntry[] = []
  const slotKeyOf = (s: { dayOfWeek: number; periodIdx: number }) => `${s.dayOfWeek}:${s.periodIdx}`
  const unplaced: Array<{ classId: string; classLabel: string; classSubjectId: string | null; subjectName: string | null; teacherId: string | null; teacherName: string | null; remaining: number; reason: string }> = []

  switch (changeEvent.type) {
    case 'TEACHER_UNAVAILABLE': {
      const bad = new Set((changeEvent.slots ?? []).map(slotKeyOf))
      movableSeed = entries.filter(e => e.teacherId === changeEvent.teacherId && bad.has(slotKeyOf(e)))
      break
    }
    case 'ROOM_UNAVAILABLE': {
      const bad = new Set((changeEvent.slots ?? []).map(slotKeyOf))
      movableSeed = entries.filter(e => e.roomId === changeEvent.roomId && bad.has(slotKeyOf(e)))
      break
    }
    case 'PERIOD_REMOVED': {
      movableSeed = entries.filter(e => e.dayOfWeek === changeEvent.dayOfWeek && e.periodIdx === changeEvent.periodIdx)
      break
    }
    case 'EVENT_BLOCKING_SLOTS': {
      let targetClassIds = scopeClassIds
      if (changeEvent.classIds?.length) targetClassIds = changeEvent.classIds.filter(id => scopeClassIds.includes(id))
      else if (changeEvent.cohortIds?.length) {
        const members = new Set(changeEvent.cohortIds.flatMap(id => (table('Cohort').find(c => c.id === id)?.classIds as string[] | undefined) ?? []))
        targetClassIds = scopeClassIds.filter(id => members.has(id))
      }
      const bad = new Set((changeEvent.slots ?? []).map(slotKeyOf))
      const targetSet = new Set(targetClassIds)
      movableSeed = entries.filter(e => targetSet.has(e.classId) && bad.has(slotKeyOf(e)))
      break
    }
    case 'REQUIREMENT_ADDED':
    case 'REQUIREMENT_CHANGED': {
      const req = table('TeachingRequirement').find(r => r.id === changeEvent.teachingRequirementId)
      if (!req) throw notFound('Teaching requirement')
      const cohort = table('Cohort').find(c => c.id === req.cohortId)
      unplaced.push({
        classId: (cohort?.classIds as string[] | undefined)?.[0] ?? '', classLabel: cohort?.name as string ?? String(req.cohortId),
        classSubjectId: null, subjectName: table('Subject').find(s => s.id === req.subjectId)?.name as string ?? null,
        teacherId: null, teacherName: null, remaining: Number(req.requiredPeriodsPerWeek ?? 0),
        reason: 'Simulated demo: requirement-delta re-placement is not run for real — re-run /timetable/auto-generate for this cohort to place the new/changed requirement.',
      })
      break
    }
  }

  const lockConflicts: Array<{ entry: VersionEntry; lockId: string; lockType: string; reason?: string }> = []
  const movable: VersionEntry[] = []
  for (const e of movableSeed) {
    const blocker = lockBlockingEntry(e)
    if (blocker) lockConflicts.push({ entry: e, lockId: String(blocker.id), lockType: String(blocker.lockType), reason: blocker.reason as string | undefined })
    else movable.push(e)
  }

  const movableKeys = new Set(movable.map(vSlotKey))
  const frozen = entries.filter(e => !movableKeys.has(vSlotKey(e)))
  const classBusy: Occupancy = new Map(); const teacherBusy: Occupancy = new Map(); const roomBusy: Occupancy = new Map()
  for (const e of frozen) {
    const slot = slotKey(e.dayOfWeek, e.periodIdx)
    markBusy(classBusy, e.classId, slot)
    if (e.teacherId) markBusy(teacherBusy, e.teacherId, slot)
    if (e.roomId) markBusy(roomBusy, e.roomId, slot)
  }
  for (const o of table('TimetableEntry').filter(r => r.termId === version.termId && !scopeClassIds.includes(String(r.classId)))) {
    const slot = slotKey(Number(o.dayOfWeek), Number(o.periodIdx))
    if (o.teacherId) markBusy(teacherBusy, String(o.teacherId), slot)
    if (o.roomId) markBusy(roomBusy, String(o.roomId), slot)
  }
  const WORKING_DAYS = [1, 2, 3, 4, 5]; const CLASS_IDXS = [1, 2, 3, 5, 6, 7, 9, 10]
  const labRooms = table('Room').filter(r => r.kind === 'LAB').map(r => String(r.id))

  const relocated: VersionEntry[] = []; const stuck: VersionEntry[] = []
  for (const e of movable) {
    let placed: VersionEntry | null = null
    outer: for (const day of WORKING_DAYS) {
      for (const idx of CLASS_IDXS) {
        if (day === e.dayOfWeek && idx === e.periodIdx) continue
        const slot = slotKey(day, idx)
        if (isBusy(classBusy, e.classId, slot)) continue
        if (e.teacherId && isBusy(teacherBusy, e.teacherId, slot)) continue
        const cs = table('ClassSubject').find(r => r.id === e.classSubjectId)
        const wantsLab = cs ? needsLab(String(cs.subjectId)) : false
        let roomId = e.roomId
        if (wantsLab || (e.roomId && labRooms.includes(e.roomId))) {
          if (e.roomId && !isBusy(roomBusy, e.roomId, slot)) roomId = e.roomId
          else { const alt = labRooms.find(id => !isBusy(roomBusy, id, slot)); if (!alt) continue; roomId = alt }
        } else if (e.roomId && isBusy(roomBusy, e.roomId, slot)) continue
        const candidate = { classId: e.classId, classSubjectId: e.classSubjectId, teacherId: e.teacherId, roomId, sessionId: e.sessionId, dayOfWeek: day, periodIdx: idx }
        if (locks.some(l => lockBlocks(l, candidate))) continue
        markBusy(classBusy, e.classId, slot)
        if (e.teacherId) markBusy(teacherBusy, e.teacherId, slot)
        if (roomId) markBusy(roomBusy, roomId, slot)
        placed = { ...e, dayOfWeek: day, periodIdx: idx, roomId }
        break outer
      }
    }
    if (placed) relocated.push(placed)
    else {
      const cs = table('ClassSubject').find(r => r.id === e.classSubjectId)
      const subject = cs ? table('Subject').find(s => s.id === cs.subjectId) : undefined
      unplaced.push({ classId: e.classId, classLabel: classLabel(e.classId), classSubjectId: e.classSubjectId, subjectName: subject?.name as string ?? null, teacherId: e.teacherId, teacherName: null, remaining: 1, reason: `No conflict-free slot found for this session once the triggering change (${changeEvent.type}) is applied` })
      const slot = slotKey(e.dayOfWeek, e.periodIdx)
      markBusy(classBusy, e.classId, slot)
      if (e.teacherId) markBusy(teacherBusy, e.teacherId, slot)
      if (e.roomId) markBusy(roomBusy, e.roomId, slot)
      stuck.push(e)
    }
  }

  const patchedEntries: VersionEntry[] = [...frozen, ...stuck, ...relocated]
  const diff = computeDiff(entries, patchedEntries)
  const affectedSessionCount = relocated.length
  const unaffectedSessionCount = entries.length - relocated.length
  const touchedClassIds = new Set(relocated.map(e => e.classId))
  const affectedCohorts = table('Cohort').filter(c => (c.classIds as string[] | undefined)?.some(id => touchedClassIds.has(id))).map(c => ({ id: c.id, name: c.name }))

  const changeReason = `What-if: ${changeEvent.type}`
  const newVersion: Row = {
    id: uid('tv'), schoolId: SCHOOL_ID, academicYearId: version.academicYearId, termId: version.termId,
    scopeCohortIds: version.scopeCohortIds, scopeClassIds: version.scopeClassIds, status: 'GENERATED',
    parentVersionId: version.id, generationJobId: undefined, changeReason, entries: patchedEntries, diffFromParent: diff,
    publishedAt: undefined, archivedAt: undefined, createdById: actor.userId, createdAt: nowIso(),
  }
  table('TimetableVersion').push(newVersion)

  return {
    item: serializeVersion(newVersion), changeEvent, draftEntries: relocated, unplaced, diagnostics: [],
    lockConflicts, summary: { affectedSessionCount, unaffectedSessionCount, affectedCohorts },
  }
})

export { getVersion, activeLocksForTerm, lockBlocks, serializeVersion }
