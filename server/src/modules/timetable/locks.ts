import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { getVersion } from './versions'
import type { createLockBody } from './schema'

// ───────────────────────── Phase T7 §3 — TimetableLock ─────────────────────────
// See phase-t7-versioning-override.md §3. Exactly the granularities the spec's own examples distinguish:
// a whole-DAY lock (targetId null, dayOfWeek set — nothing may be placed/moved into that day anywhere in
// scope) is a materially different, broader constraint than a TEACHER lock (targetId = teacherId, day/
// period null — that teacher untouchable anywhere in this version) which is itself different again from one
// exact slot's own ASSIGNMENT lock (targetId = classSubjectId, both day/period set — only THAT class-
// subject's THAT slot is frozen). This phase builds the model + the override system's own enforcement
// (§4 always refuses a hand-edit into a locked target) and a MINIMAL solver integration (see solver.ts/
// autogen.ts — full-regenerate/refine skip anything in an active lock's scope); full "every lock type
// genuinely respected mid-solve" is T8's job, explicitly out of scope here.

export const serializeLock = (l: {
  id: string; schoolId: string; timetableVersionId: string; lockType: string; targetType: string; targetId: string | null
  dayOfWeek: number | null; periodIdx: number | null; reason: string | null
  createdById: string; createdAt: Date; releasedAt: Date | null; releasedById: string | null
}) => ({
  id: l.id,
  timetableVersionId: l.timetableVersionId,
  lockType: l.lockType,
  targetType: l.targetType,
  targetId: l.targetId ?? undefined,
  dayOfWeek: l.dayOfWeek ?? undefined,
  periodIdx: l.periodIdx ?? undefined,
  reason: l.reason ?? undefined,
  createdById: l.createdById,
  createdAt: l.createdAt.toISOString(),
  active: !l.releasedAt,
  releasedAt: l.releasedAt?.toISOString(),
  releasedById: l.releasedById ?? undefined,
})

export function listLocks(ctx: Ctx, timetableVersionId: string, opts?: { activeOnly?: boolean }) {
  return prisma.timetableLock.findMany({
    where: { schoolId: ctx.schoolId, timetableVersionId, releasedAt: opts?.activeOnly ? null : undefined },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

const LOCK_TYPES = new Set(['SESSION', 'TEACHER', 'ROOM', 'COHORT', 'DAY', 'PERIOD', 'ASSIGNMENT'])

export async function createLock(ctx: Ctx, versionId: string, input: z.infer<typeof createLockBody>) {
  const version = await getVersion(ctx, versionId)
  if (!LOCK_TYPES.has(input.lockType)) throw new HttpError(400, `Unknown lockType "${input.lockType}"`)
  if ((input.lockType === 'DAY' || input.lockType === 'PERIOD' || input.lockType === 'ASSIGNMENT') && input.dayOfWeek == null && input.lockType !== 'PERIOD') {
    throw new HttpError(400, `${input.lockType} locks require dayOfWeek`)
  }
  if (input.lockType === 'ASSIGNMENT' && (input.dayOfWeek == null || input.periodIdx == null || !input.targetId)) {
    throw new HttpError(400, 'ASSIGNMENT locks require targetId (classSubjectId), dayOfWeek and periodIdx')
  }
  if ((input.lockType === 'TEACHER' || input.lockType === 'ROOM' || input.lockType === 'COHORT' || input.lockType === 'SESSION') && !input.targetId) {
    throw new HttpError(400, `${input.lockType} locks require targetId`)
  }

  const lock = await prisma.timetableLock.create({
    data: {
      schoolId: ctx.schoolId, timetableVersionId: version.id, lockType: input.lockType, targetType: input.targetType,
      targetId: input.targetId ?? null, dayOfWeek: input.dayOfWeek ?? null, periodIdx: input.periodIdx ?? null,
      reason: input.reason ?? null, createdById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create-lock', 'timetableLock', lock.id, undefined, {
    timetableVersionId: version.id, lockType: input.lockType, targetType: input.targetType, targetId: input.targetId, dayOfWeek: input.dayOfWeek, periodIdx: input.periodIdx, reason: input.reason,
  })
  return lock
}

export async function releaseLock(ctx: Ctx, id: string, reason?: string) {
  const lock = await prisma.timetableLock.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!lock) throw notFound('Timetable lock')
  if (lock.releasedAt) throw new HttpError(400, 'Lock is already released')
  const updated = await prisma.timetableLock.update({ where: { id: lock.id }, data: { releasedAt: new Date(), releasedById: ctx.actorId } })
  await audit(ctx.schoolId, ctx.actorId, 'release-lock', 'timetableLock', lock.id, { active: true }, { active: false, reason })
  return updated
}

export interface EntryLike { classId: string; classSubjectId: string; teacherId: string | null; roomId: string | null; sessionId: string | null; dayOfWeek: number; periodIdx: number }

// Does an active lock (any status version, not just PUBLISHED — a lock set while still drafting protects
// that draft's own placements too) forbid touching this entry/slot? Used by both the override system (§4 —
// always blocks a hand-edit into a locked target, with a clear message) and the minimal solver integration
// (§3 — full-regenerate/refine pre-mark locked teachers/rooms/days/periods/assignments as unavailable).
export function lockBlocks(lock: { lockType: string; targetId: string | null; dayOfWeek: number | null; periodIdx: number | null }, cohortIdsOfEntry: string[], e: EntryLike): boolean {
  switch (lock.lockType) {
    case 'TEACHER': return !!e.teacherId && lock.targetId === e.teacherId
    case 'ROOM': return !!e.roomId && lock.targetId === e.roomId
    case 'SESSION': return !!e.sessionId && lock.targetId === e.sessionId
    case 'COHORT': return !!lock.targetId && cohortIdsOfEntry.includes(lock.targetId)
    case 'DAY': return lock.dayOfWeek === e.dayOfWeek
    case 'PERIOD': return lock.periodIdx === e.periodIdx
    case 'ASSIGNMENT': return lock.targetId === e.classSubjectId && lock.dayOfWeek === e.dayOfWeek && lock.periodIdx === e.periodIdx
    default: return false
  }
}

// Fetches every active (not-released) lock touching this school+term, for the minimal generation-time
// integration (§3) — collected across ALL versions for the term (a lock is a real-world "hands off"
// instruction from an admin; it should be honored by ANY generation run touching that term, not just the
// one version it happens to be recorded against).
export async function activeLocksForTerm(ctx: Ctx, termId: string) {
  return prisma.timetableLock.findMany({ where: { schoolId: ctx.schoolId, releasedAt: null, version: { termId } } })
}
