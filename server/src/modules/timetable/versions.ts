import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { getClass, getTerm, assertSameYear, validateGrid, type EntryInput } from './service'
import { getJob } from './jobs'
import type { forkVersionBody, publishVersionBody } from './schema'

// ───────────────────────── Phase T7 §1/§2 — TimetableVersion lineage + enforced publish-immutability ─────────────────────────
// See phase-t7-versioning-override.md. Read the schema.prisma doc comment above `model TimetableVersion`
// first — the short version: a version's `entries` JSON snapshot is the source of truth at every status;
// only a PUBLISHED version's snapshot is ever materialized into real, live TimetableEntry rows (tagged
// with timetableVersionId), and only by publishVersion below — the ONE sanctioned writer that is ever
// allowed to replace a PUBLISHED version's live rows (by superseding it with a new version). Every other
// write path to TimetableEntry (service.ts#replaceGrid/removeEntry — the pre-existing manual builder this
// phase upgrades) explicitly refuses to touch a class/term currently governed by a PUBLISHED version — see
// service.ts#assertGridEditable/assertEntryEditable, called from both.

export interface VersionEntry {
  classId: string
  dayOfWeek: number
  periodIdx: number
  classSubjectId: string
  roomId: string | null
  teacherId: string | null
  sessionId: string | null
}

type VersionRow = Awaited<ReturnType<typeof getVersion>>

const slotKey = (e: { classId: string; dayOfWeek: number; periodIdx: number }) => `${e.classId}:${e.dayOfWeek}:${e.periodIdx}`

// A version created before this phase's diff/entries invariants existed cannot occur (additive migration,
// no backfill needed) — every TimetableVersion row is created by this module, always with `entries` set.
export const serializeVersion = (v: {
  id: string; schoolId: string; academicYearId: string; termId: string
  scopeCohortIds: unknown; scopeClassIds: unknown; status: string
  parentVersionId: string | null; generationJobId: string | null; changeReason: string | null
  entries: unknown; diffFromParent: unknown
  publishedAt: Date | null; archivedAt: Date | null
  createdById: string; createdAt: Date
}) => ({
  id: v.id,
  schoolId: v.schoolId,
  academicYearId: v.academicYearId,
  termId: v.termId,
  scopeCohortIds: v.scopeCohortIds as string[],
  scopeClassIds: v.scopeClassIds as string[],
  status: v.status,
  parentVersionId: v.parentVersionId ?? undefined,
  generationJobId: v.generationJobId ?? undefined,
  changeReason: v.changeReason ?? undefined,
  entryCount: (v.entries as VersionEntry[]).length,
  entries: v.entries as VersionEntry[],
  diffFromParent: v.diffFromParent ?? undefined,
  publishedAt: v.publishedAt?.toISOString(),
  archivedAt: v.archivedAt?.toISOString(),
  createdById: v.createdById,
  createdAt: v.createdAt.toISOString(),
})

export async function listVersions(ctx: Ctx, filter?: { termId?: string; status?: string; cohortId?: string }) {
  const rows = await prisma.timetableVersion.findMany({
    where: { schoolId: ctx.schoolId, termId: filter?.termId, status: filter?.status },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  // Filtered in JS rather than a JSON `array_contains` query — scopeCohortIds is a small array and this
  // keeps the query portable/simple; the list is already narrowed by schoolId+termId+status above.
  return filter?.cohortId ? rows.filter(r => (r.scopeCohortIds as string[]).includes(filter.cohortId!)) : rows
}

export async function getVersion(ctx: Ctx, id: string) {
  const row = await prisma.timetableVersion.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Timetable version')
  return row
}

// Only DRAFT/GENERATED/MODIFIED/APPROVED versions are hand-editable (§4's override actions operate here);
// PUBLISHED/ARCHIVED are always read-only regardless of caller.
const EDITABLE_STATUSES = new Set(['DRAFT', 'GENERATED', 'MODIFIED', 'APPROVED'])
export function assertVersionEditable(v: { status: string; id: string }) {
  if (!EDITABLE_STATUSES.has(v.status)) {
    throw new HttpError(409, `Timetable version ${v.id} is ${v.status} and cannot be hand-edited — ${v.status === 'PUBLISHED' ? 'fork a new modification draft first (POST /timetable/versions/fork)' : 'only DRAFT/GENERATED/MODIFIED/APPROVED versions accept overrides'}`)
  }
}

// Order-independent diff of two entry snapshots, keyed by (classId, day, period) — §1's "diffs stored where
// practical" so lineage never requires a full-entry-set comparison on demand.
export function computeDiff(before: VersionEntry[], after: VersionEntry[]) {
  const beforeBySlot = new Map(before.map(e => [slotKey(e), e]))
  const afterBySlot = new Map(after.map(e => [slotKey(e), e]))
  const added: VersionEntry[] = []
  const removed: VersionEntry[] = []
  const changed: { before: VersionEntry; after: VersionEntry }[] = []
  for (const [key, a] of afterBySlot) {
    const b = beforeBySlot.get(key)
    if (!b) { added.push(a); continue }
    if (b.classSubjectId !== a.classSubjectId || b.roomId !== a.roomId || b.teacherId !== a.teacherId || b.sessionId !== a.sessionId) {
      changed.push({ before: b, after: a })
    }
  }
  for (const [key, b] of beforeBySlot) if (!afterBySlot.has(key)) removed.push(b)
  return { added, removed, changed }
}

async function resolveScopeClassIds(ctx: Ctx, input: { classIds?: string[]; cohortIds?: string[] }): Promise<string[]> {
  if (input.classIds?.length) return [...new Set(input.classIds)]
  if (input.cohortIds?.length) {
    const cohorts = await prisma.cohort.findMany({ where: { id: { in: input.cohortIds }, schoolId: ctx.schoolId }, include: { members: true } })
    if (cohorts.length !== input.cohortIds.length) throw notFound('Cohort')
    return [...new Set(cohorts.flatMap(c => c.members.map(m => m.classId)))]
  }
  throw new HttpError(400, 'classIds or cohortIds is required')
}

// POST /timetable/versions/fork — starts (or continues, see note below) a hand-edit: snapshots whatever is
// CURRENTLY live for the given classes/cohorts into a brand-new DRAFT version, parented to the PUBLISHED
// version that currently governs that scope (if any) — this is §2's "modification request -> new DRAFT
// version (parent = the published one)" step. If the scope isn't governed by any version yet (the common
// case for a school that hasn't published through this system before — every entry has timetableVersionId
// null), the fork still succeeds with parentVersionId null: it's simply the first version this scope has
// ever had, and can be published directly once approved.
export async function forkVersion(ctx: Ctx, input: z.infer<typeof forkVersionBody>) {
  const term = await getTerm(ctx, input.termId)
  const classIds = await resolveScopeClassIds(ctx, input)
  if (!classIds.length) throw new HttpError(400, 'No classes resolved for this scope')

  const liveRows = await prisma.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, termId: term.id, classId: { in: classIds } } })
  const entries: VersionEntry[] = liveRows.map(e => ({ classId: e.classId, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId, roomId: e.roomId, teacherId: e.teacherId, sessionId: e.sessionId }))

  const governingVersionIds = [...new Set(liveRows.map(r => r.timetableVersionId).filter((x): x is string => !!x))]
  let parentVersionId: string | null = null
  if (governingVersionIds.length) {
    const governing = await prisma.timetableVersion.findMany({ where: { id: { in: governingVersionIds } } })
    parentVersionId = governing.find(g => g.status === 'PUBLISHED')?.id ?? null
  }

  const version = await prisma.timetableVersion.create({
    data: {
      schoolId: ctx.schoolId, academicYearId: term.academicYearId, termId: term.id,
      scopeCohortIds: input.cohortIds ?? [], scopeClassIds: classIds,
      status: 'DRAFT', parentVersionId, changeReason: input.changeReason ?? null,
      entries: entries as unknown as object, diffFromParent: { added: [], removed: [], changed: [] } as unknown as object,
      createdById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'fork-version', 'timetableVersion', version.id, undefined, {
    termId: term.id, classIds, parentVersionId, entries: entries.length, changeReason: input.changeReason,
  })
  return version
}

// POST /timetable/versions/from-job — wraps a completed TimetableGenerationJob's own draft as a real,
// lineage-tracked GENERATED version (§1). Distinct from forkVersion: the job's draftEntries are the
// starting snapshot (not whatever is currently live), and generationJobId records provenance.
export async function versionFromJob(ctx: Ctx, jobId: string) {
  const job = await getJob(ctx, jobId)
  if (job.status !== 'COMPLETED') throw new HttpError(400, `Job is ${job.status}, not COMPLETED — nothing to version`)
  if (!job.draftEntries) throw new HttpError(400, 'Job has no draft entries')
  const raw = job.draftEntries as unknown as { classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId?: string | null; teacherId?: string | null; sessionId?: string | null }[]
  const entries: VersionEntry[] = raw.map(e => ({ classId: e.classId, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId, roomId: e.roomId ?? null, teacherId: e.teacherId ?? null, sessionId: e.sessionId ?? null }))
  const cohortIds = job.scopeCohortIds as string[]
  const classIds = [...new Set(entries.map(e => e.classId))]

  const predecessor = await prisma.timetableVersion.findFirst({
    where: { schoolId: ctx.schoolId, termId: job.termId, status: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
  })
  const parentVersionId = predecessor && classIds.some(c => (predecessor.scopeClassIds as string[]).includes(c)) ? predecessor.id : null

  const version = await prisma.timetableVersion.create({
    data: {
      schoolId: ctx.schoolId, academicYearId: job.academicYearId, termId: job.termId,
      scopeCohortIds: cohortIds, scopeClassIds: classIds, status: 'GENERATED',
      generationJobId: job.id, parentVersionId,
      entries: entries as unknown as object,
      diffFromParent: computeDiff((parentVersionId && predecessor ? predecessor.entries as unknown as VersionEntry[] : []), entries) as unknown as object,
      createdById: ctx.actorId,
    },
  })
  await prisma.timetableGenerationJob.update({ where: { id: job.id }, data: { resultVersionId: version.id } })
  await audit(ctx.schoolId, ctx.actorId, 'version-from-job', 'timetableVersion', version.id, undefined, { jobId: job.id, entries: entries.length, parentVersionId })
  return version
}

// POST /timetable/versions/:id/approve — DRAFT/GENERATED/MODIFIED -> APPROVED (§2's flow step immediately
// before PUBLISHED). Kept as its own explicit action (not folded into publish) so an approval can be a
// distinct, separately-audited sign-off even when the same person does both in one sitting.
export async function approveVersion(ctx: Ctx, id: string) {
  const version = await getVersion(ctx, id)
  if (!EDITABLE_STATUSES.has(version.status)) throw new HttpError(409, `Version is ${version.status} — only DRAFT/GENERATED/MODIFIED/APPROVED versions can be approved`)
  const updated = await prisma.timetableVersion.update({ where: { id: version.id }, data: { status: 'APPROVED' } })
  await audit(ctx.schoolId, ctx.actorId, 'approve-version', 'timetableVersion', version.id, { status: version.status }, { status: 'APPROVED' })
  return updated
}

// Materializes an APPROVED version's own `entries` snapshot into real, live TimetableEntry rows — the ONE
// sanctioned code path allowed to replace whatever is currently live for these classes (§2: publishing a
// new version is the only way a published timetable ever effectively "changes"). Reuses service.ts's own
// validateGrid (pure validation, no writes, no immutability guard of its own) per class for the exact same
// teacher/room 409+conflicts[] rigor replaceGrid always applied — deliberately does NOT call replaceGrid
// itself, since replaceGrid's immutability guard would (correctly) refuse to touch rows that are about to
// be superseded by this very operation.
async function materializeVersion(ctx: Ctx, term: Awaited<ReturnType<typeof getTerm>>, classIds: string[], entries: VersionEntry[], versionId: string) {
  // The ONE sanctioned write path allowed to replace a PUBLISHED version's live rows: every OTHER writer
  // (service.ts#replaceGrid/removeEntry — the manual builder this phase upgrades) explicitly refuses to
  // touch a class/term currently governed by a PUBLISHED version (see assertGridEditable/assertEntryEditable
  // there) — this function is deliberately the only place that bypasses that check, because superseding a
  // published version with a new one IS the sanctioned way a published timetable ever changes (§2).
  await prisma.timetableEntry.deleteMany({ where: { schoolId: ctx.schoolId, termId: term.id, classId: { in: classIds } } })

  const byClass = new Map<string, EntryInput[]>()
  for (const e of entries) {
    const arr = byClass.get(e.classId) ?? []
    arr.push({ dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId, roomId: e.roomId, teacherId: e.teacherId, sessionId: e.sessionId })
    byClass.set(e.classId, arr)
  }
  for (const classId of classIds) {
    const list = byClass.get(classId)
    if (!list?.length) continue
    const cls = await getClass(ctx, classId)
    assertSameYear(cls, term)
    const resolved = await validateGrid(ctx, cls, term.id, list)
    await prisma.timetableEntry.createMany({ data: resolved.map(e => ({ schoolId: ctx.schoolId, classId: cls.id, termId: term.id, timetableVersionId: versionId, ...e })) })
  }
}

// POST /timetable/versions/:id/publish — the terminal §2 transition: materializes this version's entries
// live (tagged with this version's id), archives whatever PUBLISHED version(s) it supersedes (their own
// `entries` snapshot is left completely untouched — only their `status`/`archivedAt` change), and marks
// this version PUBLISHED. From this moment its own entries are immutable (service.ts's guards + the Prisma
// extension in lib/timetableImmutability.ts both refuse further writes) until a NEW version supersedes it.
export async function publishVersion(ctx: Ctx, id: string, input: z.infer<typeof publishVersionBody>) {
  const version = await getVersion(ctx, id)
  if (version.status === 'PUBLISHED') throw new HttpError(400, 'Already published')
  if (version.status === 'ARCHIVED') throw new HttpError(400, 'Cannot publish an archived version')
  if (version.status !== 'APPROVED') throw new HttpError(409, `Version is ${version.status} — call POST /timetable/versions/:id/approve first`)

  const term = await getTerm(ctx, version.termId)
  const classIds = version.scopeClassIds as string[]
  if (!classIds.length) throw new HttpError(400, 'Version has no scoped classes to publish')
  const entries = version.entries as unknown as VersionEntry[]

  await materializeVersion(ctx, term, classIds, entries, version.id)

  const toArchive = new Set<string>()
  if (version.parentVersionId) {
    const parent = await prisma.timetableVersion.findUnique({ where: { id: version.parentVersionId } })
    if (parent && parent.status === 'PUBLISHED') toArchive.add(parent.id)
  }
  const others = await prisma.timetableVersion.findMany({ where: { schoolId: ctx.schoolId, termId: term.id, status: 'PUBLISHED', id: { not: version.id } } })
  for (const o of others) {
    const oClassIds = new Set(o.scopeClassIds as string[])
    if (classIds.some(c => oClassIds.has(c))) toArchive.add(o.id)
  }
  for (const archiveId of toArchive) {
    await prisma.timetableVersion.update({ where: { id: archiveId }, data: { status: 'ARCHIVED', archivedAt: new Date() } })
  }

  const published = await prisma.timetableVersion.update({
    where: { id: version.id },
    data: { status: 'PUBLISHED', publishedAt: new Date(), changeReason: input.changeReason ?? version.changeReason },
  })
  await audit(ctx.schoolId, ctx.actorId, 'publish-version', 'timetableVersion', version.id, { status: version.status }, {
    status: 'PUBLISHED', archivedVersionIds: [...toArchive], entries: entries.length, changeReason: input.changeReason,
  })
  return { version: published, archivedVersionIds: [...toArchive] }
}

// POST /timetable/versions/:id/discard — abandons an editable (never-published) version outright, e.g. an
// admin decides a draft's changes aren't wanted. Distinct from archiving a superseded PUBLISHED version
// (which happens automatically inside publishVersion) — this is a manual discard of work-in-progress.
export async function discardVersion(ctx: Ctx, id: string) {
  const version = await getVersion(ctx, id)
  if (!EDITABLE_STATUSES.has(version.status)) throw new HttpError(409, `Version is ${version.status} — only an editable (unpublished) version can be discarded`)
  const updated = await prisma.timetableVersion.update({ where: { id: version.id }, data: { status: 'ARCHIVED', archivedAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'discard-version', 'timetableVersion', version.id, { status: version.status }, { status: 'ARCHIVED' })
  return updated
}

export type { VersionRow }
