import crypto from 'node:crypto'
import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { getTerm } from './service'
import { commitDraftEntries, type DraftEntry, type UnplacedItem } from './autogen'
import { generateForCohorts } from './solver'
import { refineDraft } from './refinement'
import { computeDiagnostics, type Diagnostic } from './diagnostics'
import type { createGenerationJobBody, commitJobBody } from './schema'

// ───────────────────────── Phase T6 §3 — TimetableGenerationJob ─────────────────────────
// See phase-t6-sessions-jobs.md §3. Wraps T4/T5's existing generateForCohorts→refineDraft pipeline
// (modules/timetable/solver.ts, modules/timetable/refinement.ts — both completely unchanged by this file)
// as a first-class, reproducible, diagnosable object. For the realistic problem sizes T0 benchmarked (a
// single grade's generation completing in low single-digit seconds), the job runs synchronously within the
// request that creates it; status/progress/currentStage are still recorded faithfully on the row so the
// SAME shape supports genuine async execution later without a breaking response-shape change.

// Bumped whenever generateForCohorts/refineDraft's actual placement/scoring algorithm changes — an old
// job's reproducibility claim ("regenerate with the same snapshot, get the same output") is only honestly
// scoped to runs against the same solver version.
export const SOLVER_VERSION = 't4-greedy+t5-sa@1'

// Canonical, order-independent hash of the final draft — sorted by (classId, dayOfWeek, periodIdx) so two
// runs that produce the identical PLACEMENT but happened to push entries in a different internal
// Map-iteration order still hash identically. This is the reproducibility check (§3).
function outputHashOf(entries: DraftEntry[]): string {
  const sorted = [...entries]
    .map(e => ({ classId: e.classId, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId, roomId: e.roomId, teacherId: e.teacherId, isDoublePeriod: e.isDoublePeriod }))
    .sort((a, b) => (a.classId + a.dayOfWeek + a.periodIdx).localeCompare(b.classId + b.dayOfWeek + b.periodIdx))
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

export const serializeJob = (j: {
  id: string; schoolId: string; academicYearId: string; termId: string; scopeCohortIds: unknown
  status: string; progress: number; currentStage: string | null; startedAt: Date | null; completedAt: Date | null
  solverVersion: string; timeLimit: number; randomSeed: number; solverParameters: unknown
  outputHash: string | null; diagnostics: unknown; errorCode: string | null; errorDetails: unknown
  createdById: string; createdAt: Date
}) => ({
  id: j.id,
  schoolId: j.schoolId,
  academicYearId: j.academicYearId,
  termId: j.termId,
  scopeCohortIds: j.scopeCohortIds as string[],
  status: j.status,
  progress: j.progress,
  currentStage: j.currentStage ?? undefined,
  startedAt: j.startedAt?.toISOString(),
  completedAt: j.completedAt?.toISOString(),
  solverVersion: j.solverVersion,
  timeLimit: j.timeLimit,
  randomSeed: j.randomSeed,
  solverParameters: j.solverParameters,
  outputHash: j.outputHash ?? undefined,
  diagnostics: (j.diagnostics as Diagnostic[] | null) ?? undefined,
  errorCode: j.errorCode ?? undefined,
  errorDetails: j.errorDetails ?? undefined,
  createdById: j.createdById,
  createdAt: j.createdAt.toISOString(),
})

export function listJobs(ctx: Ctx, filter?: { termId?: string }) {
  return prisma.timetableGenerationJob.findMany({ where: { schoolId: ctx.schoolId, termId: filter?.termId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
}

export async function getJob(ctx: Ctx, id: string) {
  const row = await prisma.timetableGenerationJob.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Timetable generation job')
  return row
}

async function snapshotConstraints(ctx: Ctx) {
  const rows = await prisma.constraint.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { id: 'asc' } })
  return rows.map(r => ({ type: r.type, scope: r.scope, scopeId: r.scopeId, severity: r.severity, enabled: r.enabled, parameters: r.parameters }))
}

async function snapshotPreferences(ctx: Ctx, preferenceProfileName?: string) {
  const rows = await prisma.preference.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { id: 'asc' } })
  const profile = preferenceProfileName
    ? await prisma.preferenceProfile.findUnique({ where: { schoolId_name: { schoolId: ctx.schoolId, name: preferenceProfileName } } })
    : await prisma.preferenceProfile.findFirst({ where: { schoolId: ctx.schoolId, active: true } })
  return {
    preferences: rows.map(r => ({ type: r.type, scope: r.scope, weight: r.weight, priority: r.priority, enabled: r.enabled })),
    activeProfile: profile ? { name: profile.name, weightOverrides: profile.weightOverrides } : null,
  }
}

// Runs generateForCohorts + refineDraft exactly as T4/T5 always did (zero changes to either), records a
// snapshot of everything that fed into the result, and computes structured diagnostics whenever any
// requirement was left unplaced — the job COMPLETES (status COMPLETED) if at least some placements were
// made, with diagnostics attached describing what's left; it only goes FAILED when NOTHING could be placed.
async function runJob(ctx: Ctx, jobId: string, input: { cohortIds: string[]; termId: string; mode: 'fill-empty' | 'full-regenerate'; preferenceProfileName?: string; timeBudgetMsPerGroup: number; seed: number; iterationCapsByGroup?: Record<string, number> }) {
  const upd = (data: Record<string, unknown>) => prisma.timetableGenerationJob.update({ where: { id: jobId }, data })

  await upd({ status: 'BUILDING_MODEL', currentStage: 'Resolving cohorts, requirements and constraints', progress: 10, startedAt: new Date() })
  const cohorts = await prisma.cohort.findMany({
    where: { id: { in: input.cohortIds }, schoolId: ctx.schoolId },
    include: { members: { include: { class: true } } },
  })

  await upd({ status: 'SOLVING', currentStage: 'Greedy placement + simulated-annealing refinement', progress: 40 })
  const generated = await generateForCohorts(ctx, { cohortIds: input.cohortIds, termId: input.termId, mode: input.mode })

  let finalDraft: DraftEntry[] = generated.draftEntries
  let refineSummary: Record<string, unknown> | null = null
  let iterationCapsByGroup: Record<string, number> | undefined
  if (generated.draftEntries.length) {
    const refined = await refineDraft(ctx, {
      termId: input.termId,
      draftEntries: generated.draftEntries.map(e => ({ classId: e.classId, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, classSubjectId: e.classSubjectId, subjectName: e.subjectName, roomId: e.roomId, teacherId: e.teacherId, isDoublePeriod: e.isDoublePeriod })),
      preferenceProfileName: input.preferenceProfileName,
      timeBudgetMsPerGroup: input.timeBudgetMsPerGroup,
      seed: input.seed,
      // Reproducibility (§3) — see simulatedAnneal's doc comment in refinement.ts. First run of a job omits
      // this (normal wall-clock SA); a regenerate run passes back the ORIGINAL run's own recorded per-group
      // iteration counts (below) so its SA schedule is iteration-count-driven, not wall-clock-driven.
      iterationCapsByGroup: input.iterationCapsByGroup,
    })
    finalDraft = refined.draftEntries.map(e => {
      // classSubjectId is already class-specific (ClassSubject is unique per classId+subjectId) and never
      // changes under refinement (only day/period/room/teacher move) — safe to recover the display-only
      // fields (classLabel/subjectName/subjectColor) from ANY pre-refine entry sharing it.
      const original = generated.draftEntries.find(d => d.classSubjectId === e.classSubjectId)!
      return { ...original, dayOfWeek: e.dayOfWeek, periodIdx: e.periodIdx, roomId: e.roomId ?? null, teacherId: e.teacherId ?? null, isDoublePeriod: !!e.isDoublePeriod }
    })
    refineSummary = { scoreBefore: refined.scoreBefore, scoreAfter: refined.scoreAfter, improvementPct: refined.improvementPct, hardViolationsAfter: refined.hardViolationsAfter, groups: refined.groups.length }
    iterationCapsByGroup = Object.fromEntries(refined.groups.map(g => [g.groupKey, g.iterations]))
  }

  await upd({ status: 'VALIDATING', currentStage: 'Computing infeasibility diagnostics (if any)', progress: 85 })
  const diagnostics = generated.unplaced.length ? await computeDiagnostics(ctx, cohorts, generated.unplaced as UnplacedItem[]) : []

  const outputHash = finalDraft.length ? outputHashOf(finalDraft) : null
  const feasible = finalDraft.length > 0

  const job = await prisma.timetableGenerationJob.findUniqueOrThrow({ where: { id: jobId } })
  const params = job.solverParameters as Record<string, unknown>

  await upd({
    status: feasible ? 'COMPLETED' : 'FAILED',
    currentStage: feasible ? 'Done' : 'No placements could be made',
    progress: 100,
    completedAt: new Date(),
    draftEntries: finalDraft as unknown as object,
    outputHash,
    diagnostics: diagnostics.length ? (diagnostics as unknown as object) : undefined,
    errorCode: feasible ? null : 'INFEASIBLE',
    errorDetails: feasible ? null : { unplaced: generated.unplaced, diagnostics },
    // Recorded even when this run itself used a wall-clock budget (no incoming cap) — this is what makes a
    // LATER regenerate of THIS job reproducible (§3), and is left untouched (not re-recorded) on a run that
    // already received a cap, so a chain of regenerates keeps replaying the ORIGINAL run's own counts.
    solverParameters: input.iterationCapsByGroup ? params : { ...params, iterationCapsByGroup },
  })

  await audit(ctx.schoolId, ctx.actorId, feasible ? 'complete' : 'fail', 'timetableGenerationJob', jobId, undefined, {
    entries: finalDraft.length, unplaced: generated.unplaced.length, diagnostics: diagnostics.length, outputHash, refineSummary,
  })
}

export async function createGenerationJob(ctx: Ctx, input: z.infer<typeof createGenerationJobBody>) {
  const term = await getTerm(ctx, input.termId)
  const cohorts = await prisma.cohort.findMany({ where: { id: { in: input.cohortIds }, schoolId: ctx.schoolId } })
  if (cohorts.length !== input.cohortIds.length) throw notFound('Cohort')

  const seed = input.seed ?? 1234
  const constraintSnapshot = await snapshotConstraints(ctx)
  const preferenceSnapshot = await snapshotPreferences(ctx, input.preferenceProfileName)

  const job = await prisma.timetableGenerationJob.create({
    data: {
      schoolId: ctx.schoolId, academicYearId: term.academicYearId, termId: term.id,
      scopeCohortIds: input.cohortIds, status: 'QUEUED', progress: 0,
      solverVersion: SOLVER_VERSION, timeLimit: input.timeBudgetMsPerGroup,
      inputSnapshot: { cohortIds: input.cohortIds, mode: input.mode, requirementIds: (await prisma.teachingRequirement.findMany({ where: { schoolId: ctx.schoolId, cohortId: { in: input.cohortIds } }, select: { id: true } })).map(r => r.id) },
      constraintSnapshot, preferenceSnapshot, randomSeed: seed,
      solverParameters: { timeBudgetMsPerGroup: input.timeBudgetMsPerGroup, preferenceProfileName: input.preferenceProfileName ?? null, mode: input.mode },
      createdById: ctx.actorId,
    },
  })

  try {
    await runJob(ctx, job.id, { cohortIds: input.cohortIds, termId: term.id, mode: input.mode, preferenceProfileName: input.preferenceProfileName, timeBudgetMsPerGroup: input.timeBudgetMsPerGroup, seed })
  } catch (err) {
    await prisma.timetableGenerationJob.update({ where: { id: job.id }, data: { status: 'FAILED', progress: 100, completedAt: new Date(), errorCode: 'INTERNAL', errorDetails: { message: err instanceof Error ? err.message : String(err) } } })
    throw err
  }
  return getJob(ctx, job.id)
}

// Re-runs generation with the EXACT SAME stored scope/mode/seed/preferenceProfileName/timeBudget as an
// existing job — this is the reproducibility check (§3): given the same snapshot (and an unchanged DB
// state, which live verification holds constant between the two calls), generateForCohorts+refineDraft are
// deterministic (greedy placement has no randomness; SA uses a seeded mulberry32 PRNG — see refinement.ts),
// so the new job's outputHash must equal the original's byte-for-byte.
export async function regenerateJob(ctx: Ctx, jobId: string) {
  const original = await getJob(ctx, jobId)
  const params = original.solverParameters as { timeBudgetMsPerGroup: number; preferenceProfileName: string | null; mode: 'fill-empty' | 'full-regenerate'; iterationCapsByGroup?: Record<string, number> }
  const cohortIds = original.scopeCohortIds as string[]

  const job = await prisma.timetableGenerationJob.create({
    data: {
      schoolId: ctx.schoolId, academicYearId: original.academicYearId, termId: original.termId,
      scopeCohortIds: cohortIds, status: 'QUEUED', progress: 0,
      solverVersion: SOLVER_VERSION, timeLimit: params.timeBudgetMsPerGroup,
      inputSnapshot: { ...(original.inputSnapshot as object), regeneratedFrom: original.id },
      constraintSnapshot: original.constraintSnapshot as object, preferenceSnapshot: original.preferenceSnapshot as object,
      randomSeed: original.randomSeed,
      solverParameters: original.solverParameters as object,
      createdById: ctx.actorId,
    },
  })
  await runJob(ctx, job.id, {
    cohortIds, termId: original.termId, mode: params.mode, preferenceProfileName: params.preferenceProfileName ?? undefined,
    timeBudgetMsPerGroup: params.timeBudgetMsPerGroup, seed: original.randomSeed, iterationCapsByGroup: params.iterationCapsByGroup,
  })

  const fresh = await getJob(ctx, job.id)
  return { job: serializeJob(fresh), originalOutputHash: original.outputHash ?? undefined, newOutputHash: fresh.outputHash ?? undefined, byteIdentical: !!original.outputHash && original.outputHash === fresh.outputHash }
}

export async function commitJob(ctx: Ctx, input: z.infer<typeof commitJobBody>) {
  const job = await getJob(ctx, input.jobId)
  if (job.status !== 'COMPLETED') throw new HttpError(400, `Job is ${job.status}, not COMPLETED — nothing to commit`)
  if (!job.draftEntries) throw new HttpError(400, 'Job has no draft entries')
  const term = await getTerm(ctx, job.termId)
  const params = job.solverParameters as { mode: 'fill-empty' | 'full-regenerate' }
  const result = await commitDraftEntries(ctx, term, params.mode, job.draftEntries as unknown as DraftEntry[])
  await prisma.timetableGenerationJob.update({ where: { id: job.id }, data: { resultVersionId: `${job.id}:committed` } })
  return result
}
