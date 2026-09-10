import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import type { PeriodDef } from '../periodTemplates/service'
import { getClass, getTerm, assertSameYear, listEntries, replaceGrid, type EntryInput } from './service'
import type { autoGenerateBody, autoGenerateCommitBody } from './schema'

// ───────────────────────────── Phase 26: timetable auto-generation (draft/commit primitives) ─────────────
//
// Phase 26's original ClassSubject-scoped `autoGenerate()` draft-builder was retired in Phase T10 §2 — see
// the note further below, just above `commitDraftEntries`. What remains here are the shared primitives
// (occupancy-map tracking, lab-matching, double-period pairing) and the commit path, both still depended
// on by the Cohort/TeachingRequirement-scoped solver (./solver.ts) and everything built on top of it.

// No explicit "needs a lab" flag exists anywhere in the schema (Subject/CurriculumSubject/ClassSubject
// all lack one — checked before writing this). Rather than invent a new column for a first-draft
// generator, infer it from the subject name/code, same heuristic a human scheduler would use at a
// glance. Good enough to route Chemistry/Physics/Biology/Computer practicals into a Lab-kind room;
// documented in the final report as the one spot a future `CurriculumSubject.needsLabRoom` boolean
// would clean up if this heuristic ever misfires on a real school's subject naming.
export const LAB_SUBJECT_RE = /lab|practical|chemistry|physics|biology|computer/i
export const needsLab = (name: string, code: string) => LAB_SUBJECT_RE.test(name) || LAB_SUBJECT_RE.test(code)

export interface DraftEntry {
  classId: string
  classLabel: string
  dayOfWeek: number
  periodIdx: number
  classSubjectId: string
  subjectName: string
  subjectColor: string
  roomId: string | null
  roomName?: string
  teacherId: string | null
  teacherName?: string
  isDoublePeriod: boolean
}

export interface UnplacedItem {
  classId: string
  classLabel: string
  classSubjectId: string | null
  subjectName: string | null
  teacherId: string | null
  teacherName: string | null
  remaining: number
  reason: string
}

// Occupancy-map pattern (T0's benchmark confirmed this ports cleanly — phase-t4-solver-core.md §3). Also
// used, unchanged, by the cohort-scoped solver (./solver.ts) so the two generation paths never disagree
// on how teacher/room busy-ness is tracked.
export type Occupancy = Map<string, Set<string>> // key (teacherId/roomId) -> set of "day:period"

export function markBusy(map: Occupancy, key: string, slot: string) {
  const set = map.get(key) ?? new Set<string>()
  set.add(slot)
  map.set(key, set)
}
export const isBusy = (map: Occupancy, key: string | null, slot: string) => !!key && !!map.get(key)?.has(slot)

// GET the double-period pairs a template supports: two adjacent class periods with no break between
// them (the second's start equals the first's end). Used to place lab/practical subjects as a block.
export function doublePairs(periods: PeriodDef[]): [number, number][] {
  const sorted = periods.slice().sort((a, b) => a.idx - b.idx)
  const pairs: [number, number][] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1]
    if (a.kind === 'class' && b.kind === 'class' && a.end === b.start) pairs.push([a.idx, b.idx])
  }
  return pairs
}

// Phase T10 §2 — the legacy ClassSubject-scoped `autoGenerate()` (classId, or omitted for "every class in
// the year") that used to live here was retired: the Cohort/TeachingRequirement/TeachingAssignment-scoped
// solver in ./solver.ts (`generateForCohorts`) is now the only generation path, reached via the same
// POST /auto-generate endpoint with `cohortIds` (now required — see schema.ts). Every class already has an
// auto-generated 1:1 "section cohort" (D2), so "this class"/"all classes" scope is unchanged from the
// caller's point of view — just expressed as cohort selection. The primitives this legacy function used
// (`markBusy`/`isBusy`/`doublePairs`/`needsLab`, `DraftEntry`/`UnplacedItem`) are NOT retired — solver.ts,
// assignmentModes.ts, whatif.ts, overrides.ts, teachingRequirements.ts, diagnostics.ts, jobs.ts and
// electives.ts all still depend on them, per T0/T4's "reuse the occupancy-map pattern" decision.

// Shared commit primitive — grouped-per-class replaceGrid write, extracted unchanged from what
// commitAutoGenerate always did (see phase-t6-sessions-jobs.md §2: "commit already does this — this phase
// formalizes what it reads from, not what it does"). commitAutoGenerate below still calls this with
// draftEntries exactly as before (byte-identical behavior/response shape); the new session-materialization
// path (./sessions.ts#commitSessions) and job-commit path (./jobs.ts) call it too, with entries derived from
// TimetableSession/TimetableGenerationJob instead of from a caller-supplied flat draft — same validation
// (validateGrid, via replaceGrid), same audit action name, same full-regenerate stale-row pre-pass fix.
export async function commitDraftEntries(
  ctx: Ctx,
  term: Awaited<ReturnType<typeof getTerm>>,
  mode: 'fill-empty' | 'full-regenerate',
  draftEntries: { classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId?: string | null; teacherId?: string | null; sessionId?: string | null }[],
) {
  if (!draftEntries.length) throw new HttpError(400, 'No draft entries to commit')

  const byClass = new Map<string, EntryInput[]>()
  for (const e of draftEntries) {
    const arr = byClass.get(e.classId) ?? []
    arr.push({ dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId, roomId: e.roomId ?? null, teacherId: e.teacherId ?? null, sessionId: e.sessionId ?? null })
    byClass.set(e.classId, arr)
  }

  // Phase T4 fix (found while live-verifying a genuinely multi-cohort generation — see this phase's final
  // report): full-regenerate wipes each class's whole grid, one class at a time below via replaceGrid. When
  // a single commit spans MULTIPLE classes (always true for a cohort-scoped draft touching 2+ member
  // classes, and also true for the legacy generator's own "whole academic year" mode, which this bug
  // predates and affects identically), class N's validateGrid call checks for teacher/room clashes against
  // every OTHER class's CURRENT rows — including class N+1's still-present OLD rows, which are about to be
  // wiped by this same commit but haven't been yet. That produces false-positive 409s between two classes
  // whose NEW schedules were generated together and never actually clash. Deleting every target class's
  // stale rows up front (before any of them is individually validated/rewritten below) removes that
  // staleness window; fill-empty is unaffected (it merges onto each class's existing grid, never wipes it).
  if (mode === 'full-regenerate') {
    await prisma.timetableEntry.deleteMany({ where: { schoolId: ctx.schoolId, termId: term.id, classId: { in: [...byClass.keys()] } } })
  }

  const results: { classId: string; entries: number }[] = []
  for (const [classId, newEntries] of byClass) {
    const cls = await getClass(ctx, classId)
    assertSameYear(cls, term)
    let finalEntries = newEntries
    if (mode === 'fill-empty') {
      const existing = await listEntries(classId, term.id)
      finalEntries = [
        ...existing.map(e => ({ dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId, roomId: e.roomId, teacherId: e.teacherId, sessionId: e.sessionId })),
        ...newEntries,
      ]
    }
    const after = await replaceGrid(ctx, { classId, termId: term.id, entries: finalEntries })
    results.push({ classId, entries: after.length })
  }

  await audit(ctx.schoolId, ctx.actorId, 'auto-generate-commit', 'timetable', term.id, undefined, {
    mode, classes: [...byClass.keys()], entriesCommitted: draftEntries.length,
  })
  return { committed: draftEntries.length, classes: results }
}

// POST /auto-generate/commit — writes the draft via the exact same path the manual "add entry" endpoint
// uses (replaceGrid → validateGrid), grouped per class. fill-empty merges the draft onto each class's
// current grid (nothing already placed is touched or deleted); full-regenerate replaces the whole grid,
// so any manually-placed entries not present in draftEntries are deleted — the destructive path the
// frontend must gate behind an explicit confirmation.
export async function commitAutoGenerate(ctx: Ctx, input: z.infer<typeof autoGenerateCommitBody>) {
  const term = await getTerm(ctx, input.termId)
  return commitDraftEntries(ctx, term, input.mode, input.draftEntries)
}
