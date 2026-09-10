import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf, WRITE_ROLES } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import { periodTemplatesRouter } from '../periodTemplates/router'
import { substitutionsRouter } from '../substitutions/router'
import { workingDayPatternsRouter } from '../workingDayPatterns/router'
import * as svc from './service'
import * as autogen from './autogen'
import * as solver from './solver'
import * as reqSvc from './teachingRequirements'
import * as constraintSvc from './constraints'
import * as assignmentModesSvc from './assignmentModes'
import * as preferencesSvc from './preferences'
import * as profilesSvc from './preferenceProfiles'
import { refineDraft } from './refinement'
import { serializeEntry } from './shared'
import * as sessionsSvc from './sessions'
import * as electivesSvc from './electives'
import * as jobsSvc from './jobs'
import * as versionsSvc from './versions'
import * as locksSvc from './locks'
import * as overridesSvc from './overrides'
import { whatIf } from './whatif'
import * as subSvc from './substitution'
import {
  putEntries, copyBody, publishBody, gridQuery, termQuery, meQuery, autoGenerateBody, autoGenerateCommitBody,
  createTeachingRequirement, patchTeachingRequirement, seedTeachingRequirementsBody, createTeachingAssignment,
  createConstraint, patchConstraint,
  patchTeachingRequirementMode, addPoolMember, resolveAssignmentBody, resolveAssignmentsForCohortsBody,
  setAvailabilityBody, patchPreference, activateProfileBody, patchPreferenceProfile, refineBody,
  createSharedSessionBody, commitSessionsBody, createElectiveBlockBody, electiveChoiceBody, commitElectiveBlockBody,
  createGenerationJobBody, commitJobBody,
  forkVersionBody, versionFromJobBody, publishVersionBody, versionsQuery,
  createLockBody, releaseLockBody,
  moveEntryBody, swapEntriesBody, regenerateSlotBody, revertToBody,
  whatIfBody,
  patchSubstitutionPolicyBody, substitutionFinderBody, createSubstitutionRequestBody, decideSubstitutionRequestBody,
} from './schema'

// Everything under /api/timetable (see phase-2-timetable.md). Reads: any authenticated role, with the
// per-role visibility rules applied in the service; writes: admin | superadmin.
export const timetableRouter = Router()
timetableRouter.use(requireAuth)
const write = requireRole(...WRITE_ROLES)

timetableRouter.use('/period-templates', periodTemplatesRouter)
timetableRouter.use('/substitutions', substitutionsRouter)
timetableRouter.use('/working-day-patterns', workingDayPatternsRouter)

// GET /?classId&termId → { template, entries, published, publishedAt? }
timetableRouter.get('/', wrap(async (req, res) => {
  const q = validate(gridQuery, req.query)
  res.json(await svc.getGrid(ctxOf(req as AuthedRequest), q.classId, q.termId))
}))

timetableRouter.get('/me', wrap(async (req, res) => {
  res.json(await svc.me(ctxOf(req as AuthedRequest), validate(meQuery, req.query)))
}))

timetableRouter.get('/teacher/:userId', wrap(async (req, res) => {
  const q = validate(termQuery, req.query)
  res.json(await svc.teacherView(ctxOf(req as AuthedRequest), req.params.userId, q.termId))
}))

// Replaces the whole class×term grid in one validated transaction.
timetableRouter.put('/entries', write, wrap(async (req, res) => {
  const items = await svc.replaceGrid(ctxOf(req as AuthedRequest), validate(putEntries, req.body))
  res.json({ items: items.map(serializeEntry) })
}))

timetableRouter.delete('/entries/:id', write, wrap(async (req, res) => {
  await svc.removeEntry(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

timetableRouter.post('/copy', write, wrap(async (req, res) => {
  res.json(await svc.copy(ctxOf(req as AuthedRequest), validate(copyBody, req.body)))
}))

timetableRouter.post('/publish', write, wrap(async (req, res) => {
  res.json({ item: await svc.publish(ctxOf(req as AuthedRequest), validate(publishBody, req.body)) })
}))

// Auto-generate: draft only, admin-only (significant operation), never writes TimetableEntry rows itself.
// The admin reviews the draft, then commits (or discards) it.
// Phase T10 §2 — Phase 26's legacy ClassSubject-scoped generator (`autogen.autoGenerate`, no `cohortIds`)
// is retired; `cohortIds` is required by the schema now, so this always runs the Cohort/
// TeachingRequirement/TeachingAssignment-scoped solver (T4+, with T5's soft-constraint refinement
// available via the separate /auto-generate/refine step). See phase-t10-migration.md §2.
timetableRouter.post('/auto-generate', write, wrap(async (req, res) => {
  const input = validate(autoGenerateBody, req.body)
  const ctx = ctxOf(req as AuthedRequest)
  res.json(await solver.generateForCohorts(ctx, input))
}))

// Commit is shared unchanged by both generation paths — both produce the same DraftEntry[] shape, and
// commitAutoGenerate already re-validates everything via the manual builder's own replaceGrid/validateGrid.
timetableRouter.post('/auto-generate/commit', write, wrap(async (req, res) => {
  res.json(await autogen.commitAutoGenerate(ctxOf(req as AuthedRequest), validate(autoGenerateCommitBody, req.body)))
}))

// ───────────────────────── Phase T4 §1/§2 — TeachingRequirement / TeachingAssignment ─────────────────────────

timetableRouter.get('/teaching-requirements', wrap(async (req, res) => {
  const items = await reqSvc.list(ctxOf(req as AuthedRequest), { cohortId: req.query.cohortId as string | undefined })
  res.json({ items: items.map(reqSvc.serializeRequirement) })
}))

timetableRouter.post('/teaching-requirements', write, wrap(async (req, res) => {
  const item = await reqSvc.create(ctxOf(req as AuthedRequest), validate(createTeachingRequirement, req.body))
  res.status(201).json({ item: reqSvc.serializeRequirement(item) })
}))

timetableRouter.post('/teaching-requirements/seed-from-class-subjects', write, wrap(async (req, res) => {
  res.json(await reqSvc.seedFromClassSubjects(ctxOf(req as AuthedRequest), validate(seedTeachingRequirementsBody, req.body)))
}))

timetableRouter.patch('/teaching-requirements/:id', write, wrap(async (req, res) => {
  const item = await reqSvc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchTeachingRequirement, req.body))
  res.json({ item: reqSvc.serializeRequirement(item) })
}))

timetableRouter.delete('/teaching-requirements/:id', write, wrap(async (req, res) => {
  await reqSvc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

timetableRouter.get('/teaching-assignments', wrap(async (req, res) => {
  const items = await reqSvc.listAssignments(ctxOf(req as AuthedRequest), { teachingRequirementId: req.query.teachingRequirementId as string | undefined })
  res.json({ items: items.map(reqSvc.serializeAssignment) })
}))

timetableRouter.post('/teaching-assignments', write, wrap(async (req, res) => {
  const item = await reqSvc.createAssignment(ctxOf(req as AuthedRequest), validate(createTeachingAssignment, req.body))
  res.status(201).json({ item: reqSvc.serializeAssignment(item) })
}))

timetableRouter.delete('/teaching-assignments/:id', write, wrap(async (req, res) => {
  await reqSvc.removeAssignment(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ───────────────────────── Phase T4 §3 — Constraint Builder ─────────────────────────

timetableRouter.get('/constraints', wrap(async (req, res) => {
  const items = await constraintSvc.list(ctxOf(req as AuthedRequest), {
    type: req.query.type as string | undefined,
    scope: req.query.scope as string | undefined,
    enabled: req.query.enabled === undefined ? undefined : req.query.enabled === 'true',
  })
  res.json({ items: items.map(constraintSvc.serializeConstraint) })
}))

timetableRouter.post('/constraints', write, wrap(async (req, res) => {
  const item = await constraintSvc.create(ctxOf(req as AuthedRequest), validate(createConstraint, req.body))
  res.status(201).json({ item: constraintSvc.serializeConstraint(item) })
}))

timetableRouter.post('/constraints/seed-defaults', write, wrap(async (req, res) => {
  res.json({ added: await constraintSvc.seedDefaults(ctxOf(req as AuthedRequest)) })
}))

timetableRouter.patch('/constraints/:id', write, wrap(async (req, res) => {
  const item = await constraintSvc.update(ctxOf(req as AuthedRequest), req.params.id, validate(patchConstraint, req.body))
  res.json({ item: constraintSvc.serializeConstraint(item) })
}))

timetableRouter.delete('/constraints/:id', write, wrap(async (req, res) => {
  await constraintSvc.remove(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ───────────────────────── Phase T5 §1 — Assignment Modes 2-4 ─────────────────────────

timetableRouter.patch('/teaching-requirements/:id/assignment-mode', write, wrap(async (req, res) => {
  const input = validate(patchTeachingRequirementMode, req.body)
  const item = await assignmentModesSvc.setAssignmentMode(ctxOf(req as AuthedRequest), req.params.id, input.assignmentMode)
  res.json({ item: reqSvc.serializeRequirement(item) })
}))

timetableRouter.get('/teaching-assignment-pool', wrap(async (req, res) => {
  const items = await assignmentModesSvc.listPool(ctxOf(req as AuthedRequest), req.query.teachingRequirementId as string)
  res.json({ items: items.map(assignmentModesSvc.serializePoolMember) })
}))

timetableRouter.post('/teaching-assignment-pool', write, wrap(async (req, res) => {
  const item = await assignmentModesSvc.addToPool(ctxOf(req as AuthedRequest), validate(addPoolMember, req.body))
  res.status(201).json({ item: assignmentModesSvc.serializePoolMember(item) })
}))

timetableRouter.delete('/teaching-assignment-pool/:id', write, wrap(async (req, res) => {
  await assignmentModesSvc.removeFromPool(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// Explicit preview/pre-resolution — the generation path (solver.ts) also auto-resolves any still-unresolved
// POOL/RANDOM/OPTIMIZED requirement inline, so calling this first is optional but lets an admin review the
// selectionReason before running a full generation.
timetableRouter.post('/teaching-assignments/resolve', write, wrap(async (req, res) => {
  const input = validate(resolveAssignmentBody, req.body)
  const item = await assignmentModesSvc.resolveAssignment(ctxOf(req as AuthedRequest), input.teachingRequirementId, input.termId)
  res.json({ item: reqSvc.serializeAssignment(item) })
}))

timetableRouter.post('/teaching-assignments/resolve-for-cohorts', write, wrap(async (req, res) => {
  const input = validate(resolveAssignmentsForCohortsBody, req.body)
  res.json(await assignmentModesSvc.resolveAssignmentsForCohorts(ctxOf(req as AuthedRequest), input.cohortIds, input.termId))
}))

// ───────────────────────── Phase T5 — TeacherAvailability (T1-promised, T5-delivered) ─────────────────────────

timetableRouter.get('/teacher-availability/:teacherId', wrap(async (req, res) => {
  const items = await assignmentModesSvc.listAvailability(ctxOf(req as AuthedRequest), req.params.teacherId)
  res.json({ items: items.map(assignmentModesSvc.serializeAvailability) })
}))

timetableRouter.put('/teacher-availability', write, wrap(async (req, res) => {
  const items = await assignmentModesSvc.setAvailability(ctxOf(req as AuthedRequest), validate(setAvailabilityBody, req.body))
  res.json({ items: items.map(assignmentModesSvc.serializeAvailability) })
}))

// ───────────────────────── Phase T5 §2/§3 — Preference / PreferenceProfile ─────────────────────────

timetableRouter.get('/preferences', wrap(async (req, res) => {
  const items = await preferencesSvc.list(ctxOf(req as AuthedRequest), { scope: req.query.scope as string | undefined })
  res.json({ items: items.map(preferencesSvc.serializePreference) })
}))

timetableRouter.post('/preferences/seed-defaults', write, wrap(async (req, res) => {
  res.json(await preferencesSvc.seedDefaults(ctxOf(req as AuthedRequest)))
}))

timetableRouter.patch('/preferences/:type', write, wrap(async (req, res) => {
  const item = await preferencesSvc.update(ctxOf(req as AuthedRequest), req.params.type, validate(patchPreference, req.body))
  res.json({ item: preferencesSvc.serializePreference(item) })
}))

timetableRouter.get('/preference-profiles', wrap(async (req, res) => {
  const items = await profilesSvc.list(ctxOf(req as AuthedRequest))
  res.json({ items: items.map(profilesSvc.serializeProfile) })
}))

timetableRouter.post('/preference-profiles/seed-defaults', write, wrap(async (req, res) => {
  res.json({ added: await profilesSvc.seedDefaults(ctxOf(req as AuthedRequest)) })
}))

timetableRouter.post('/preference-profiles/activate', write, wrap(async (req, res) => {
  const input = validate(activateProfileBody, req.body)
  const item = await profilesSvc.activate(ctxOf(req as AuthedRequest), input.name)
  res.json({ item: profilesSvc.serializeProfile(item) })
}))

timetableRouter.patch('/preference-profiles/:name', write, wrap(async (req, res) => {
  const item = await profilesSvc.update(ctxOf(req as AuthedRequest), req.params.name, validate(patchPreferenceProfile, req.body))
  res.json({ item: profilesSvc.serializeProfile(item) })
}))

// ───────────────────────── Phase T5 §2 — SA refinement (additional step, after greedy placement) ─────────────────────────
// Operates on an in-memory draft (exactly the shape POST /auto-generate returns) — never touches the DB.
// The caller (Timetable Builder UI) chains: auto-generate -> [refine] -> auto-generate/commit. Skipping
// this endpoint entirely reproduces T4's original hard-constraint-only behavior byte-for-byte.
timetableRouter.post('/auto-generate/refine', write, wrap(async (req, res) => {
  const input = validate(refineBody, req.body)
  res.json(await refineDraft(ctxOf(req as AuthedRequest), input))
}))

// ───────────────────────── Phase T6 §1 — TimetableSession / SharedSession ─────────────────────────

timetableRouter.get('/sessions', wrap(async (req, res) => {
  const items = await sessionsSvc.listSessions(ctxOf(req as AuthedRequest), { termId: req.query.termId as string | undefined, cohortId: req.query.cohortId as string | undefined })
  res.json({ items: items.map(sessionsSvc.serializeSession) })
}))

timetableRouter.get('/sessions/:id', wrap(async (req, res) => {
  res.json({ item: sessionsSvc.serializeSession(await sessionsSvc.getSession(ctxOf(req as AuthedRequest), req.params.id)) })
}))

timetableRouter.post('/sessions/shared', write, wrap(async (req, res) => {
  const input = validate(createSharedSessionBody, req.body)
  const item = await sessionsSvc.createSharedSession(ctxOf(req as AuthedRequest), input)
  res.status(201).json({ item: sessionsSvc.serializeSession(item) })
}))

timetableRouter.delete('/sessions/:id', write, wrap(async (req, res) => {
  await sessionsSvc.removeSession(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// Materializes the named sessions into real TimetableEntry rows via the exact same primitive T4's commit
// always used (autogen.ts#commitDraftEntries) — same validation/audit behavior, just reading from the
// TimetableSession layer instead of a caller-supplied flat draft (phase-t6-sessions-jobs.md §2).
timetableRouter.post('/sessions/commit', write, wrap(async (req, res) => {
  const input = validate(commitSessionsBody, req.body)
  res.json(await sessionsSvc.commitSessions(ctxOf(req as AuthedRequest), input))
}))

// ───────────────────────── Phase T6 §1b — ElectiveBlock ─────────────────────────

timetableRouter.get('/elective-blocks', wrap(async (req, res) => {
  const items = await electivesSvc.listBlocks(ctxOf(req as AuthedRequest), { termId: req.query.termId as string | undefined, gradeId: req.query.gradeId as string | undefined })
  res.json({ items: items.map(electivesSvc.serializeBlock) })
}))

timetableRouter.get('/elective-blocks/:id', wrap(async (req, res) => {
  res.json({ item: electivesSvc.serializeBlock(await electivesSvc.getBlock(ctxOf(req as AuthedRequest), req.params.id)) })
}))

timetableRouter.post('/elective-blocks', write, wrap(async (req, res) => {
  const input = validate(createElectiveBlockBody, req.body)
  const item = await electivesSvc.createElectiveBlock(ctxOf(req as AuthedRequest), input)
  res.status(201).json({ item: electivesSvc.serializeBlock(item) })
}))

// Any authenticated user may register their own choice; admin/staff may register on behalf of a student —
// no extra role gate beyond requireAuth (same convention as Phase 8's Activity registrations).
timetableRouter.post('/elective-blocks/:id/choices', wrap(async (req, res) => {
  const input = validate(electiveChoiceBody, req.body)
  res.status(201).json({ item: await electivesSvc.chooseElective(ctxOf(req as AuthedRequest), req.params.id, input) })
}))

timetableRouter.post('/elective-blocks/:id/commit', write, wrap(async (req, res) => {
  const input = validate(commitElectiveBlockBody, req.body)
  res.json(await electivesSvc.commitElectiveBlock(ctxOf(req as AuthedRequest), req.params.id, input.mode))
}))

// ───────────────────────── Phase T6 §3 — TimetableGenerationJob ─────────────────────────

timetableRouter.get('/generation-jobs', wrap(async (req, res) => {
  const items = await jobsSvc.listJobs(ctxOf(req as AuthedRequest), { termId: req.query.termId as string | undefined })
  res.json({ items: items.map(jobsSvc.serializeJob) })
}))

timetableRouter.get('/generation-jobs/:id', wrap(async (req, res) => {
  res.json({ item: jobsSvc.serializeJob(await jobsSvc.getJob(ctxOf(req as AuthedRequest), req.params.id)) })
}))

timetableRouter.post('/generation-jobs', write, wrap(async (req, res) => {
  const input = validate(createGenerationJobBody, req.body)
  const item = await jobsSvc.createGenerationJob(ctxOf(req as AuthedRequest), input)
  res.status(201).json({ item: jobsSvc.serializeJob(item) })
}))

// Reproducibility check (§3): re-runs the named job's exact stored scope/mode/seed/preferenceProfileName,
// creating a NEW job row, and reports whether its outputHash matches the original byte-for-byte.
timetableRouter.post('/generation-jobs/:id/regenerate', write, wrap(async (req, res) => {
  res.json(await jobsSvc.regenerateJob(ctxOf(req as AuthedRequest), req.params.id))
}))

timetableRouter.post('/generation-jobs/commit', write, wrap(async (req, res) => {
  const input = validate(commitJobBody, req.body)
  res.json(await jobsSvc.commitJob(ctxOf(req as AuthedRequest), input))
}))

// ───────────────────────── Phase T7 §1/§2 — TimetableVersion lineage + publish-immutability ─────────────────────────

timetableRouter.get('/versions', wrap(async (req, res) => {
  const q = validate(versionsQuery, req.query)
  const items = await versionsSvc.listVersions(ctxOf(req as AuthedRequest), q)
  res.json({ items: items.map(versionsSvc.serializeVersion) })
}))

timetableRouter.get('/versions/:id', wrap(async (req, res) => {
  res.json({ item: versionsSvc.serializeVersion(await versionsSvc.getVersion(ctxOf(req as AuthedRequest), req.params.id)) })
}))

// Starts (or restarts) a hand-edit: snapshots whatever is currently live for the given classes/cohorts into
// a new DRAFT version, parented to the PUBLISHED version that currently governs that scope, if any (§2's
// "modification request -> new DRAFT" step). This is the entry point the upgraded Timetable Builder UI
// calls the moment an admin clicks "Edit" on a published timetable.
timetableRouter.post('/versions/fork', write, wrap(async (req, res) => {
  const input = validate(forkVersionBody, req.body)
  const item = await versionsSvc.forkVersion(ctxOf(req as AuthedRequest), input)
  res.status(201).json({ item: versionsSvc.serializeVersion(item) })
}))

// Wraps a completed TimetableGenerationJob's draft as a real, lineage-tracked GENERATED version (§1).
timetableRouter.post('/versions/from-job', write, wrap(async (req, res) => {
  const input = validate(versionFromJobBody, req.body)
  const item = await versionsSvc.versionFromJob(ctxOf(req as AuthedRequest), input.jobId)
  res.status(201).json({ item: versionsSvc.serializeVersion(item) })
}))

timetableRouter.post('/versions/:id/approve', write, wrap(async (req, res) => {
  const item = await versionsSvc.approveVersion(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: versionsSvc.serializeVersion(item) })
}))

// The terminal §2 transition — materializes this version's entries live and archives whatever it supersedes.
timetableRouter.post('/versions/:id/publish', write, wrap(async (req, res) => {
  const input = validate(publishVersionBody, req.body)
  const { version, archivedVersionIds } = await versionsSvc.publishVersion(ctxOf(req as AuthedRequest), req.params.id, input)
  res.json({ item: versionsSvc.serializeVersion(version), archivedVersionIds })
}))

timetableRouter.post('/versions/:id/discard', write, wrap(async (req, res) => {
  const item = await versionsSvc.discardVersion(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: versionsSvc.serializeVersion(item) })
}))

// ───────────────────────── Phase T7 §3 — TimetableLock ─────────────────────────

timetableRouter.get('/versions/:id/locks', wrap(async (req, res) => {
  const items = await locksSvc.listLocks(ctxOf(req as AuthedRequest), req.params.id, { activeOnly: req.query.activeOnly === 'true' })
  res.json({ items: items.map(locksSvc.serializeLock) })
}))

timetableRouter.post('/versions/:id/locks', write, wrap(async (req, res) => {
  const input = validate(createLockBody, req.body)
  const item = await locksSvc.createLock(ctxOf(req as AuthedRequest), req.params.id, input)
  res.status(201).json({ item: locksSvc.serializeLock(item) })
}))

timetableRouter.post('/locks/:id/release', write, wrap(async (req, res) => {
  const input = validate(releaseLockBody, req.body)
  const item = await locksSvc.releaseLock(ctxOf(req as AuthedRequest), req.params.id, input.reason ?? undefined)
  res.json({ item: locksSvc.serializeLock(item) })
}))

// ───────────────────────── Phase T7 §4 — the override system (centerpiece) ─────────────────────────
// Every mutating action below accepts `dryRun: true` to run the exact same live conflict check the actual
// save uses, without persisting — this is what powers "live, real-time conflict detection as the admin
// edits" (§4). A conflict (dryRun or not) always comes back as the app's standard 409 + `conflicts[]`.

timetableRouter.post('/versions/:id/move', write, wrap(async (req, res) => {
  const input = validate(moveEntryBody, req.body)
  res.json(await overridesSvc.moveEntry(ctxOf(req as AuthedRequest), req.params.id, input))
}))

timetableRouter.post('/versions/:id/swap', write, wrap(async (req, res) => {
  const input = validate(swapEntriesBody, req.body)
  res.json(await overridesSvc.swapEntries(ctxOf(req as AuthedRequest), req.params.id, input))
}))

timetableRouter.post('/versions/:id/regenerate-slot', write, wrap(async (req, res) => {
  const input = validate(regenerateSlotBody, req.body)
  res.json(await overridesSvc.regenerateSlot(ctxOf(req as AuthedRequest), req.params.id, input))
}))

timetableRouter.post('/versions/:id/undo', write, wrap(async (req, res) => {
  res.json(await overridesSvc.undoLast(ctxOf(req as AuthedRequest), req.params.id))
}))

// "Ideally revert-to-any-prior-point" (§4) — reverts every not-yet-undone change after edit-event #seq.
timetableRouter.post('/versions/:id/revert-to', write, wrap(async (req, res) => {
  const input = validate(revertToBody, req.body)
  res.json(await overridesSvc.revertTo(ctxOf(req as AuthedRequest), req.params.id, input))
}))

timetableRouter.get('/versions/:id/edit-events', wrap(async (req, res) => {
  const items = await overridesSvc.listEditEvents(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ items: items.map(overridesSvc.serializeEditEvent) })
}))

// ───────────────────────── Phase T8 — What-If / partial re-optimization ─────────────────────────
// Computes the minimal affected region a change event touches, re-solves ONLY that region (T5's greedy +
// SA, fully respecting active TimetableLocks), and publishes the patch as a new TimetableVersion (parent =
// versionId) via T7's own lineage machinery — review/approve/publish reuses the T7 endpoints above verbatim.
timetableRouter.post('/what-if', write, wrap(async (req, res) => {
  const input = validate(whatIfBody, req.body)
  res.json(await whatIf(ctxOf(req as AuthedRequest), input))
}))

// ───────────────────────── Phase T9 — Substitution Workflow ─────────────────────────
// See phase-t9-substitution.md and modules/timetable/substitution.ts's own doc comment.

timetableRouter.get('/substitution-policy', wrap(async (req, res) => {
  res.json({ item: await subSvc.getPolicy(ctxOf(req as AuthedRequest)) })
}))

timetableRouter.put('/substitution-policy', write, wrap(async (req, res) => {
  const input = validate(patchSubstitutionPolicyBody, req.body)
  res.json({ item: await subSvc.upsertPolicy(ctxOf(req as AuthedRequest), input) })
}))

timetableRouter.post('/substitution-preferences/seed-defaults', write, wrap(async (req, res) => {
  res.json({ added: await subSvc.seedSubstitutionPreferenceDefaults(ctxOf(req as AuthedRequest)) })
}))

// §2 — the Substitute Finder. Any authenticated staff/teacher may run it (read-only, ranks candidates —
// sending an actual request is the gated action below).
timetableRouter.post('/substitution-finder', wrap(async (req, res) => {
  const input = validate(substitutionFinderBody, req.body)
  res.json(await subSvc.findCandidates(ctxOf(req as AuthedRequest), input))
}))

timetableRouter.get('/substitution-requests', wrap(async (req, res) => {
  const items = await subSvc.listRequests(ctxOf(req as AuthedRequest), {
    leaveRequestId: req.query.leaveRequestId as string | undefined,
    substituteTeacherId: req.query.substituteTeacherId as string | undefined,
    status: req.query.status as string | undefined,
  })
  res.json({ items: items.map(subSvc.serializeRequest) })
}))

// Authorization (who may send: the absent teacher, or an admin depending on policy/notice) is enforced
// inside the service, not here — it depends on school policy + notice, not a fixed role gate.
timetableRouter.post('/substitution-requests', wrap(async (req, res) => {
  const input = validate(createSubstitutionRequestBody, req.body)
  const item = await subSvc.createSubstitutionRequest(ctxOf(req as AuthedRequest), input)
  res.status(201).json({ item: subSvc.serializeRequest(item) })
}))

timetableRouter.post('/substitution-requests/:id/accept', wrap(async (req, res) => {
  const item = await subSvc.acceptSubstitutionRequest(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: subSvc.serializeRequest(item) })
}))

timetableRouter.post('/substitution-requests/:id/decline', wrap(async (req, res) => {
  const input = validate(decideSubstitutionRequestBody, req.body)
  const item = await subSvc.declineSubstitutionRequest(ctxOf(req as AuthedRequest), req.params.id, input.note)
  res.json({ item: subSvc.serializeRequest(item) })
}))

// The scheduled/lazy hold-expiry mechanism (this codebase has no cron — same documented pattern as
// leave/service.ts#deactivateIfPastLastWorkingDate: called opportunistically inside the Finder/accept flow,
// and exposed here too so an admin screen (or an external scheduler hitting this endpoint) can force a
// sweep on demand).
timetableRouter.post('/substitution-holds/expire-stale', write, wrap(async (req, res) => {
  res.json({ expired: await subSvc.expireStaleHolds(ctxOf(req as AuthedRequest)) })
}))
