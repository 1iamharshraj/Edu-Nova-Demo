// Phase T3 — Sectioning Engine seed fragment. See .agents/edunova/phase-t3-sectioning-engine.md and
// server/src/modules/sectioning/{router,service,schema,strategies,scoring}.ts (read-only reference).
//
// Seeds: 4 PerformanceBand rows, 2 SectioningTemplate recipes (one per strategy family exercised by the
// e2e spec), a JEE track Activity + TrackEligibilityRule pair (one STRICT, one ADVISORY) with a couple of
// TrackEligibilityException rows showing the override/flag flow, and one already-APPROVED
// SectioningVersion + its SectioningAssignment rows so the draft-review screen has a real "past run" to
// show alongside a freshly generated one.
//
// Cohort targets: `sectionOrder` on both templates points at the T1-style SECTION cohorts the timetable
// batch's seed/timetable.ts already creates 1:1 per Class (`cohort-9a`/`cohort-9b`/`cohort-10a`/
// `cohort-10b`, each with `classIds: [classId]` — the shape src/lib/data.ts's `Cohort` type and
// modules/academic.ts's bootstrap serializer both expect). This fragment deliberately does NOT seed its
// own competing SECTION cohorts: seed/timetable.ts's `db.Cohort = CLASSES.map(...)` is a full overwrite,
// not an append, so any Cohort rows this fragment added would be silently destroyed whenever that
// fragment happens to run after this one (it does, per src/lib/mock/index.ts's import order) — referencing
// its ids directly is both simpler and immune to that ordering.
//
// Score simulation: real scoring reuses Phase 3 Assessment/Mark data (see scoring.ts), which isn't part
// of this batch's seed. Per the static-demo-plan's "simulate the algorithm, not the surrounding logic"
// guidance, this module (and modules/sectioning.ts at runtime) derives a deterministic 0-100 score from
// a hash of the student id instead — stable across reloads, spreads students across every band, and
// looks like a real score without depending on unbuilt Assessment/Mark seed data.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'

const YEAR_ID = 'ay-2025'

export function seedSectioning(db: Collections) {
  // ── §1 Performance bands ──
  db.PerformanceBand = [
    { id: 'band-a', schoolId: SCHOOL_ID, academicYearId: YEAR_ID, label: 'Band A', minScore: 85, maxScore: 100, createdAt: '2025-04-01T00:00:00.000Z' },
    { id: 'band-b', schoolId: SCHOOL_ID, academicYearId: YEAR_ID, label: 'Band B', minScore: 70, maxScore: 84, createdAt: '2025-04-01T00:00:00.000Z' },
    { id: 'band-c', schoolId: SCHOOL_ID, academicYearId: YEAR_ID, label: 'Band C', minScore: 50, maxScore: 69, createdAt: '2025-04-01T00:00:00.000Z' },
    { id: 'band-d', schoolId: SCHOOL_ID, academicYearId: YEAR_ID, label: 'Band D', minScore: 0, maxScore: 49, createdAt: '2025-04-01T00:00:00.000Z' },
  ].map(r => r as Row)

  // ── §2 Sectioning templates — one per strategy family the e2e spec exercises. `cohort-9a/9b/10a/10b`
  // are the timetable batch's pre-existing 1:1-per-Class SECTION cohorts (see file header). ──
  db.SectioningTemplate = [
    {
      id: 'sect-tpl-10-balanced', schoolId: SCHOOL_ID, academicYearId: YEAR_ID, gradeId: 'grade-10',
      name: 'Grade X — Balanced mix', strategy: 'BALANCED', scoreSource: 'LATEST_EXAM',
      bandIds: ['band-a', 'band-b', 'band-c', 'band-d'],
      distributionConfig: { bandMixTolerancePct: 15, siblingsTogether: true },
      sectionOrder: ['cohort-10a', 'cohort-10b'], respectExisting: true, createdAt: '2025-08-01T00:00:00.000Z',
    },
    {
      id: 'sect-tpl-9-skim', schoolId: SCHOOL_ID, academicYearId: YEAR_ID, gradeId: 'grade-9',
      name: 'Grade IX — Skim merit then balance', strategy: 'SKIM_THEN_BALANCE', scoreSource: 'EXAM_AVERAGE',
      bandIds: ['band-a', 'band-b', 'band-c', 'band-d'],
      distributionConfig: { bandMixTolerancePct: 20, skim: [{ sectionId: 'cohort-9a', percentage: 20 }], remainderStrategy: 'BALANCED' },
      sectionOrder: ['cohort-9a', 'cohort-9b'], respectExisting: true, createdAt: '2025-08-01T00:00:00.000Z',
    },
  ].map(r => r as Row)

  // ── §3 Track — a JEE-prep Activity + eligibility rules (one STRICT, one ADVISORY). No dedicated TRACK
  // Cohort is seeded here for the same clobbering reason described in the file header — `trackCohortId`
  // is left unset; §3's Stage-1 registration flow (modules/sectioning.ts#trackRegister) still works fully
  // (eligibility check, STRICT reject/override, ADVISORY flag, exceptions report) without it, it just
  // skips the optional CohortMembership write a real trackCohortId would additionally get. ──
  db.Activity = [...(db.Activity ?? []), {
    id: 'activity-jee-track', schoolId: SCHOOL_ID, kind: 'track', title: 'JEE Track',
    description: 'JEE-aspirant cohort for Grade X/XI — merit-based, subject to eligibility thresholds below.',
    capacity: 30, opensAt: null, closesAt: null, forRoles: ['student'], createdById: 'u-ad',
    createdAt: '2025-08-05T00:00:00.000Z', trackCohortId: null,
  } as Row]

  db.TrackEligibilityRule = [
    {
      id: 'ter-jee-math', schoolId: SCHOOL_ID, trackActivityId: 'activity-jee-track', label: 'JEE Mathematics threshold',
      subjectScoreRules: [{ subjectId: 'math', minScore: 75 }], enforcementMode: 'STRICT', createdAt: '2025-08-05T00:00:00.000Z',
    },
    {
      id: 'ter-jee-phy', schoolId: SCHOOL_ID, trackActivityId: 'activity-jee-track', label: 'JEE Physics threshold (advisory)',
      subjectScoreRules: [{ subjectId: 'physics', minScore: 70 }], enforcementMode: 'ADVISORY', createdAt: '2025-08-05T00:00:00.000Z',
    },
  ].map(r => r as Row)

  // Two examples of the override/flag flow so the Exceptions report isn't empty on first load.
  db.TrackEligibilityException = [
    {
      id: 'tee-1', schoolId: SCHOOL_ID, trackActivityId: 'activity-jee-track', ruleId: 'ter-jee-math', studentId: 'u-s3',
      type: 'STRICT_OVERRIDE',
      unmetDetails: [{ rule: { subjectId: 'math', minScore: 75 }, passed: false, actual: 61, source: 'MARKS' }],
      reason: 'Strong lab performance and counselor recommendation outweigh one term’s math score.',
      approvedById: 'u-ad', createdAt: '2025-08-10T00:00:00.000Z',
    },
    {
      id: 'tee-2', schoolId: SCHOOL_ID, trackActivityId: 'activity-jee-track', ruleId: 'ter-jee-phy', studentId: 'u-s1',
      type: 'ADVISORY_FLAG',
      unmetDetails: [{ rule: { subjectId: 'physics', minScore: 70 }, passed: false, actual: 64, source: 'MARKS' }],
      reason: undefined, approvedById: undefined, createdAt: '2025-08-11T00:00:00.000Z',
    },
  ].map(r => r as Row)

  db.ActivityRegistration = [...(db.ActivityRegistration ?? []), {
    id: 'actreg-jee-s3', activityId: 'activity-jee-track', userId: 'u-s3', registeredAt: '2025-08-10T00:00:00.000Z', status: 'Registered',
  } as Row]

  // ── §4 One already-APPROVED run, so the draft-review screen and TemplateCard's "Recent runs" have a
  // real past example alongside whatever the e2e spec / a demo user generates live. ──
  db.SectioningVersion = [{
    id: 'sectver-demo-1', schoolId: SCHOOL_ID, templateId: 'sect-tpl-10-balanced', academicYearId: YEAR_ID,
    scopeCohortId: null, status: 'APPROVED', parentVersionId: null,
    summary: {
      scoredCount: 3, unscoredStudentIds: [], overflowStudentIds: [], warnings: [],
      sectionBandMix: {
        'cohort-10a': { 'Band B': 100 },
        'cohort-10b': { 'Band A': 50, 'Band C': 50 },
      },
      validation: { errors: [], warnings: [] },
    },
    approvedAt: '2025-08-12T09:00:00.000Z', approvedById: 'u-ad', createdAt: '2025-08-12T08:30:00.000Z',
  } as Row]

  db.SectioningAssignment = [
    { id: 'secta-1', versionId: 'sectver-demo-1', schoolId: SCHOOL_ID, studentId: 'u-s1', cohortId: 'cohort-10a', previousCohortId: 'cohort-10a', band: 'Band B', score: 78, createdAt: '2025-08-12T08:30:00.000Z' },
    { id: 'secta-2', versionId: 'sectver-demo-1', schoolId: SCHOOL_ID, studentId: 'u-s2', cohortId: 'cohort-10b', previousCohortId: 'cohort-10a', band: 'Band A', score: 91, createdAt: '2025-08-12T08:30:00.000Z' },
    { id: 'secta-3', versionId: 'sectver-demo-1', schoolId: SCHOOL_ID, studentId: 'u-s3', cohortId: 'cohort-10b', previousCohortId: 'cohort-10b', band: 'Band C', score: 61, createdAt: '2025-08-12T08:30:00.000Z' },
  ].map(r => r as Row)
}
