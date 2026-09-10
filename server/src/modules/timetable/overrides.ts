import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { classLabel } from './shared'
import { getVersion, assertVersionEditable, type VersionEntry } from './versions'
import { activeLocksForTerm, lockBlocks } from './locks'
import { needsLab } from './autogen'
import type { moveEntryBody, swapEntriesBody, regenerateSlotBody, revertToBody } from './schema'

// ───────────────────────── Phase T7 §4 — the override system (centerpiece) ─────────────────────────
// See phase-t7-versioning-override.md §4. Every action here operates on ONE editable (DRAFT/GENERATED/
// MODIFIED/APPROVED) TimetableVersion's own `entries` JSON snapshot — never on live TimetableEntry rows
// directly (those stay untouched until the version is actually published, see versions.ts#publishVersion).
// Every action: (1) computes the proposed new entry set, (2) runs the EXACT SAME conflict check the caller
// used to preview it live (§4's "live, real-time conflict detection AS THE ADMIN EDITS" — `dryRun: true`
// runs this same function and returns before persisting anything, so the live-preview call and the actual
// save can never disagree), reusing the app's own 409+conflicts[] convention verbatim, (3) on success,
// writes the new snapshot, a TimetableEditEvent (structured before/after — undo's raw material), and an
// audit() call (who/when/what/why — the ground rules' non-negotiable requirement on every override).

const slotKey = (e: { classId: string; dayOfWeek: number; periodIdx: number }) => `${e.classId}:${e.dayOfWeek}:${e.periodIdx}`
const teacherSlotKey = (dayOfWeek: number, periodIdx: number, teacherId: string) => `${teacherId}@${dayOfWeek}:${periodIdx}`
const roomSlotKey = (dayOfWeek: number, periodIdx: number, roomId: string) => `${roomId}@${dayOfWeek}:${periodIdx}`

export interface OverrideConflict {
  rule: 'teacher' | 'room' | 'occupied' | 'locked'
  classId: string
  classLabel: string
  dayOfWeek: number
  periodIdx: number
  teacherId?: string
  roomId?: string
  lockId?: string
  lockReason?: string
}

type VersionRow = Awaited<ReturnType<typeof getVersion>>

async function computeConflicts(ctx: Ctx, version: VersionRow, nextEntries: VersionEntry[], touchedSlots: Set<string>): Promise<OverrideConflict[]> {
  const classIds = [...new Set(nextEntries.map(e => e.classId))]
  const classes = classIds.length ? await prisma.class.findMany({ where: { id: { in: classIds } }, include: { grade: true } }) : []
  const classById = new Map(classes.map(c => [c.id, c]))
  const labelOf = (id: string) => { const c = classById.get(id); return c ? classLabel(c) : id }

  const conflicts: OverrideConflict[] = []

  // Duplicate slot within the proposed set itself (defensive — callers shouldn't be able to construct this).
  const bySlot = new Map<string, VersionEntry>()
  for (const e of nextEntries) {
    const k = slotKey(e)
    if (bySlot.has(k) && bySlot.get(k) !== e) {
      conflicts.push({ rule: 'occupied', classId: e.classId, classLabel: labelOf(e.classId), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx })
    }
    bySlot.set(k, e)
  }

  // Teacher/room clashes — checked across the WHOLE proposed set (small, always resident in memory for one
  // version) so a clash introduced between two of this version's own classes is caught exactly like one
  // against the rest of the school. Same SharedSession exemption as service.ts#validateGrid (T6 §1).
  const sameSession = (a: { sessionId: string | null }, b: { sessionId: string | null }) => !!a.sessionId && !!b.sessionId && a.sessionId === b.sessionId
  const byTeacher = new Map<string, VersionEntry>()
  const byRoom = new Map<string, VersionEntry>()
  for (const e of nextEntries) {
    if (e.teacherId) {
      const k = teacherSlotKey(e.dayOfWeek, e.periodIdx, e.teacherId)
      const other = byTeacher.get(k)
      if (other && other.classId !== e.classId && !sameSession(e, other)) {
        conflicts.push({ rule: 'teacher', classId: e.classId, classLabel: labelOf(e.classId), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, teacherId: e.teacherId })
      }
      byTeacher.set(k, e)
    }
    if (e.roomId) {
      const k = roomSlotKey(e.dayOfWeek, e.periodIdx, e.roomId)
      const other = byRoom.get(k)
      if (other && other.classId !== e.classId && !sameSession(e, other)) {
        conflicts.push({ rule: 'room', classId: e.classId, classLabel: labelOf(e.classId), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, roomId: e.roomId })
      }
      byRoom.set(k, e)
    }
  }

  // Cross-check against the rest of the LIVE schedule: any other class's current TimetableEntry rows that
  // are NOT part of this version's own scope (this version's scope classes' current live rows are exactly
  // what this version is going to supersede on publish — comparing against them here would be comparing a
  // draft against its own soon-to-be-replaced past self, not a real conflict).
  const scopeClassIds = new Set(version.scopeClassIds as string[])
  const others = await prisma.timetableEntry.findMany({
    where: { schoolId: ctx.schoolId, termId: version.termId, classId: { notIn: [...scopeClassIds] } },
    include: { class: { include: { grade: true } } },
  })
  for (const o of others) {
    for (const e of nextEntries) {
      if (!touchedSlots.has(slotKey(e))) continue // only re-check what actually changed — keeps this fast for live preview
      if (e.dayOfWeek !== o.dayOfWeek || e.periodIdx !== o.periodIdx) continue
      if (e.teacherId && e.teacherId === o.teacherId && !sameSession(e, o)) {
        conflicts.push({ rule: 'teacher', classId: o.classId, classLabel: classLabel(o.class), dayOfWeek: o.dayOfWeek, periodIdx: o.periodIdx, teacherId: e.teacherId })
      }
      if (e.roomId && e.roomId === o.roomId && !sameSession(e, o)) {
        conflicts.push({ rule: 'room', classId: o.classId, classLabel: classLabel(o.class), dayOfWeek: o.dayOfWeek, periodIdx: o.periodIdx, roomId: e.roomId })
      }
    }
  }

  // Locks — an active lock anywhere in this term blocks a hand-edit that touches its target, full stop
  // (§3/§4: "set a lock on a specific slot, attempt to edit that locked slot, confirm it's blocked").
  const locks = await activeLocksForTerm(ctx, version.termId)
  if (locks.length) {
    const cohortIds = version.scopeCohortIds as string[]
    for (const e of nextEntries) {
      if (!touchedSlots.has(slotKey(e))) continue
      for (const lock of locks) {
        if (lockBlocks(lock, cohortIds, { classId: e.classId, classSubjectId: e.classSubjectId, teacherId: e.teacherId, roomId: e.roomId, sessionId: e.sessionId, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx })) {
          conflicts.push({ rule: 'locked', classId: e.classId, classLabel: labelOf(e.classId), dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, lockId: lock.id, lockReason: lock.reason ?? undefined })
        }
      }
    }
  }

  return conflicts
}

function throwIfConflicts(conflicts: OverrideConflict[]) {
  if (conflicts.length) {
    throw new HttpError(409, `${conflicts.length} timetable conflict${conflicts.length === 1 ? '' : 's'}`, undefined, { conflicts })
  }
}

// Union-of-touched-slots diff apply: removes any current entry occupying a touched slot, then adds back
// whatever `after` says should be there (nothing, if that slot is meant to end up empty) — see the module
// doc comment in versions.ts and this file's undo functions for why events are stored this way.
function applyDiff(current: VersionEntry[], before: VersionEntry[], after: VersionEntry[]): VersionEntry[] {
  const touched = new Set([...before, ...after].map(slotKey))
  return [...current.filter(e => !touched.has(slotKey(e))), ...after]
}

async function nextSeq(versionId: string) {
  const last = await prisma.timetableEditEvent.findFirst({ where: { timetableVersionId: versionId }, orderBy: { seq: 'desc' } })
  return (last?.seq ?? 0) + 1
}

async function recordEvent(ctx: Ctx, versionId: string, action: string, before: VersionEntry[], after: VersionEntry[], reason?: string | null) {
  const seq = await nextSeq(versionId)
  return prisma.timetableEditEvent.create({
    data: { schoolId: ctx.schoolId, timetableVersionId: versionId, seq, action, before: before as unknown as object, after: after as unknown as object, reason: reason ?? null, createdById: ctx.actorId },
  })
}

async function saveEntries(ctx: Ctx, version: VersionRow, entries: VersionEntry[]) {
  return prisma.timetableVersion.update({
    where: { id: version.id },
    data: { entries: entries as unknown as object, status: version.status === 'PUBLISHED' || version.status === 'ARCHIVED' ? version.status : 'MODIFIED' },
  })
}

// POST /timetable/versions/:id/move
export async function moveEntry(ctx: Ctx, versionId: string, input: z.infer<typeof moveEntryBody>) {
  const version = await getVersion(ctx, versionId)
  assertVersionEditable(version)
  const current = version.entries as unknown as VersionEntry[]
  const from = current.find(e => e.classId === input.classId && e.dayOfWeek === input.fromDayOfWeek && e.periodIdx === input.fromPeriodIdx)
  if (!from) throw notFound('Timetable entry at the source slot')
  if (current.some(e => e.classId === input.classId && e.dayOfWeek === input.toDayOfWeek && e.periodIdx === input.toPeriodIdx)) {
    throw new HttpError(400, 'Target slot is already occupied for this class — use swap instead')
  }
  const moved: VersionEntry = { ...from, dayOfWeek: input.toDayOfWeek, periodIdx: input.toPeriodIdx }
  const next = applyDiff(current, [from], [moved])
  const touched = new Set([slotKey(from), slotKey(moved)])
  const conflicts = await computeConflicts(ctx, version, next, touched)
  if (input.dryRun) return { ok: conflicts.length === 0, conflicts }
  throwIfConflicts(conflicts)

  await recordEvent(ctx, version.id, 'MOVE', [from], [moved], input.reason)
  await saveEntries(ctx, version, next)
  await audit(ctx.schoolId, ctx.actorId, 'move-entry', 'timetableVersion', version.id, from, moved)
  return { ok: true, conflicts: [], entries: next }
}

// POST /timetable/versions/:id/swap — exchanges the day/period two entries occupy (their own subject/
// teacher/room travel WITH them, i.e. a genuine position swap, the natural "drag card A onto card B" move).
export async function swapEntries(ctx: Ctx, versionId: string, input: z.infer<typeof swapEntriesBody>) {
  const version = await getVersion(ctx, versionId)
  assertVersionEditable(version)
  const current = version.entries as unknown as VersionEntry[]
  const a = current.find(e => e.classId === input.a.classId && e.dayOfWeek === input.a.dayOfWeek && e.periodIdx === input.a.periodIdx)
  const b = current.find(e => e.classId === input.b.classId && e.dayOfWeek === input.b.dayOfWeek && e.periodIdx === input.b.periodIdx)
  if (!a) throw notFound('Timetable entry at slot A')
  if (!b) throw notFound('Timetable entry at slot B')
  const aAfter: VersionEntry = { ...a, dayOfWeek: b.dayOfWeek, periodIdx: b.periodIdx }
  const bAfter: VersionEntry = { ...b, dayOfWeek: a.dayOfWeek, periodIdx: a.periodIdx }
  const next = applyDiff(current, [a, b], [aAfter, bAfter])
  const touched = new Set([slotKey(a), slotKey(b)])
  const conflicts = await computeConflicts(ctx, version, next, touched)
  if (input.dryRun) return { ok: conflicts.length === 0, conflicts }
  throwIfConflicts(conflicts)

  await recordEvent(ctx, version.id, 'SWAP', [a, b], [aAfter, bAfter], input.reason)
  await saveEntries(ctx, version, next)
  await audit(ctx.schoolId, ctx.actorId, 'swap-entries', 'timetableVersion', version.id, { a, b }, { a: aAfter, b: bAfter })
  return { ok: true, conflicts: [], entries: next }
}

// POST /timetable/versions/:id/regenerate-slot — a deliberately narrow "let the system redo just this one
// slot" (not a full re-solve — that stays a whole generation-job concern). Re-derives the best available
// room for whatever classSubject already occupies the slot (if the subject wants a lab, tries every lab
// room not busy elsewhere in this version/the live schedule/an active lock; otherwise leaves the room as
// the ClassSubject's own default). The teacher never changes here (ClassSubject.teacherId already fixes
// it) — this action's value is fixing a stale/conflicting room pick without a full manual re-place.
export async function regenerateSlot(ctx: Ctx, versionId: string, input: z.infer<typeof regenerateSlotBody>) {
  const version = await getVersion(ctx, versionId)
  assertVersionEditable(version)
  const current = version.entries as unknown as VersionEntry[]
  const existing = current.find(e => e.classId === input.classId && e.dayOfWeek === input.dayOfWeek && e.periodIdx === input.periodIdx)
  if (!existing) throw notFound('Timetable entry at this slot')

  const cs = await prisma.classSubject.findUnique({ where: { id: existing.classSubjectId }, include: { subject: true } })
  if (!cs) throw notFound('ClassSubject')

  let roomId = existing.roomId
  if (needsLab(cs.subject.name, cs.subject.code)) {
    const rooms = await prisma.room.findMany({ where: { schoolId: ctx.schoolId, kind: 'lab' } })
    const busyRoomIds = new Set<string>()
    for (const e of current) if (e !== existing && e.roomId && e.dayOfWeek === input.dayOfWeek && e.periodIdx === input.periodIdx) busyRoomIds.add(e.roomId)
    const others = await prisma.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, termId: version.termId, dayOfWeek: input.dayOfWeek, periodIdx: input.periodIdx, roomId: { not: null } } })
    for (const o of others) if (o.roomId) busyRoomIds.add(o.roomId)
    roomId = rooms.find(r => !busyRoomIds.has(r.id))?.id ?? null
  }

  const regenerated: VersionEntry = { ...existing, roomId }
  const next = applyDiff(current, [existing], [regenerated])
  const touched = new Set([slotKey(existing)])
  const conflicts = await computeConflicts(ctx, version, next, touched)
  if (input.dryRun) return { ok: conflicts.length === 0, conflicts }
  throwIfConflicts(conflicts)

  await recordEvent(ctx, version.id, 'REGENERATE_SLOT', [existing], [regenerated], input.reason)
  await saveEntries(ctx, version, next)
  await audit(ctx.schoolId, ctx.actorId, 'regenerate-slot', 'timetableVersion', version.id, existing, regenerated)
  return { ok: true, conflicts: [], entries: next }
}

// Reverts one edit event's effect on `entries` (does not itself write — callers wrap in a transaction with
// the new UNDO event + version.entries update). Shared by undoLast and revertTo below.
function revertOne(current: VersionEntry[], event: { before: unknown; after: unknown }): VersionEntry[] {
  return applyDiff(current, event.after as VersionEntry[], event.before as VersionEntry[])
}

// POST /timetable/versions/:id/undo — reverts the most recent NOT-YET-UNDONE entry-touching event. Minimum
// bar from §4 ("undo-the-last-change within an editing session").
export async function undoLast(ctx: Ctx, versionId: string) {
  const version = await getVersion(ctx, versionId)
  assertVersionEditable(version)
  const last = await prisma.timetableEditEvent.findFirst({
    where: { timetableVersionId: version.id, undone: false, action: { in: ['MOVE', 'SWAP', 'REGENERATE_SLOT'] } },
    orderBy: { seq: 'desc' },
  })
  if (!last) throw new HttpError(400, 'Nothing to undo for this version')

  const current = version.entries as unknown as VersionEntry[]
  const reverted = revertOne(current, last)
  await recordEvent(ctx, version.id, 'UNDO', last.after as unknown as VersionEntry[], last.before as unknown as VersionEntry[], `undo of #${last.seq} (${last.action})`)
  await prisma.timetableEditEvent.update({ where: { id: last.id }, data: { undone: true, undoneAt: new Date() } })
  await saveEntries(ctx, version, reverted)
  await audit(ctx.schoolId, ctx.actorId, 'undo', 'timetableVersion', version.id, { undidEventSeq: last.seq, action: last.action }, { entries: reverted.length })
  return { ok: true, revertedEventSeq: last.seq, entries: reverted }
}

// POST /timetable/versions/:id/revert-to — "ideally revert-to-any-prior-point-in-this-version's-edit-
// history" (§4's stretch goal, built for real): undoes every not-yet-undone entry-touching event with
// seq > target, most-recent-first, until the version's entries match the state right after event #target
// (target = 0 reverts to the version's very first snapshot, i.e. undoes everything).
export async function revertTo(ctx: Ctx, versionId: string, input: z.infer<typeof revertToBody>) {
  const version = await getVersion(ctx, versionId)
  assertVersionEditable(version)
  const toUndo = await prisma.timetableEditEvent.findMany({
    where: { timetableVersionId: version.id, undone: false, action: { in: ['MOVE', 'SWAP', 'REGENERATE_SLOT'] }, seq: { gt: input.seq } },
    orderBy: { seq: 'desc' },
  })
  if (!toUndo.length) throw new HttpError(400, `Nothing to revert — no undone-eligible change after event #${input.seq}`)

  let current = version.entries as unknown as VersionEntry[]
  for (const event of toUndo) {
    current = revertOne(current, event)
    await recordEvent(ctx, version.id, 'UNDO', event.after as unknown as VersionEntry[], event.before as unknown as VersionEntry[], `revert-to #${input.seq} (undoing #${event.seq})`)
    await prisma.timetableEditEvent.update({ where: { id: event.id }, data: { undone: true, undoneAt: new Date() } })
  }
  await saveEntries(ctx, version, current)
  await audit(ctx.schoolId, ctx.actorId, 'revert-to', 'timetableVersion', version.id, { targetSeq: input.seq, undidCount: toUndo.length }, { entries: current.length })
  return { ok: true, revertedEventSeqs: toUndo.map(e => e.seq), entries: current }
}

export function listEditEvents(ctx: Ctx, versionId: string) {
  return prisma.timetableEditEvent.findMany({ where: { schoolId: ctx.schoolId, timetableVersionId: versionId }, orderBy: { seq: 'asc' } })
}

export const serializeEditEvent = (e: {
  id: string; timetableVersionId: string; seq: number; action: string; before: unknown; after: unknown
  reason: string | null; createdById: string; createdAt: Date; undone: boolean; undoneAt: Date | null
}) => ({
  id: e.id, timetableVersionId: e.timetableVersionId, seq: e.seq, action: e.action,
  before: e.before, after: e.after, reason: e.reason ?? undefined,
  createdById: e.createdById, createdAt: e.createdAt.toISOString(), undone: e.undone, undoneAt: e.undoneAt?.toISOString(),
})
