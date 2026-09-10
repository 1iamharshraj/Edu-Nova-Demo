import type { z } from 'zod'
import type { Prisma, PerformanceBand, SectioningTemplate as SectioningTemplateRow } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isStaff } from '../../lib/scope'
import { syncUserTitle } from '../../lib/titleSync'
import * as activitiesSvc from '../activities/service'
import { computeOverallScore, evaluateSubjectRule, type ScoreSource, type SubjectScoreRule, type SubjectRuleResult } from './scoring'
import {
  runBalanced, runRanked, runBanded, runStratifiedCapped, runRandomParity, runSkimThenBalance, hashSeed, bandOf,
  type ScoredStudent, type Band, type Assignment, type StrategyOutput, type StrategyFn, type StrategyName,
} from './strategies'
import type { createBand, patchBand, createTemplate, patchTemplate, createRule, patchRule, moveBody, trackRegisterBody } from './schema'

// ─────────────────────────────────── §1 Bands ───────────────────────────────────

export const serializeBand = (b: PerformanceBand) => ({
  id: b.id, academicYearId: b.academicYearId, label: b.label, minScore: b.minScore, maxScore: b.maxScore,
})

export function listBands(ctx: Ctx, academicYearId?: string) {
  return prisma.performanceBand.findMany({ where: { schoolId: ctx.schoolId, academicYearId }, orderBy: [{ minScore: 'asc' }] })
}

async function getBand(ctx: Ctx, id: string) {
  const row = await prisma.performanceBand.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Performance band')
  return row
}

export async function createBandSvc(ctx: Ctx, input: z.infer<typeof createBand>) {
  if (!(await prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId: ctx.schoolId } }))) throw notFound('Academic year')
  const row = await prisma.performanceBand.create({ data: { schoolId: ctx.schoolId, ...input } })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'performanceBand', row.id, undefined, serializeBand(row))
  return row
}

export async function updateBand(ctx: Ctx, id: string, input: z.infer<typeof patchBand>) {
  const before = await getBand(ctx, id)
  const row = await prisma.performanceBand.update({ where: { id }, data: input })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'performanceBand', id, serializeBand(before), serializeBand(row))
  return row
}

export async function removeBand(ctx: Ctx, id: string) {
  const before = await getBand(ctx, id)
  await prisma.performanceBand.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'performanceBand', id, serializeBand(before))
}

// ─────────────────────────────────── §2 SectioningTemplate ───────────────────────────────────

export const serializeTemplate = (t: SectioningTemplateRow) => ({
  id: t.id, academicYearId: t.academicYearId, gradeId: t.gradeId, name: t.name, strategy: t.strategy, scoreSource: t.scoreSource,
  subjectWeights: t.subjectWeights ?? undefined, bandIds: t.bandIds, distributionConfig: t.distributionConfig ?? undefined,
  sectionOrder: t.sectionOrder, respectExisting: t.respectExisting, createdAt: t.createdAt.toISOString(),
})

export function listTemplates(ctx: Ctx, filter?: { academicYearId?: string; gradeId?: string }) {
  return prisma.sectioningTemplate.findMany({ where: { schoolId: ctx.schoolId, academicYearId: filter?.academicYearId, gradeId: filter?.gradeId }, orderBy: { createdAt: 'desc' } })
}

async function getTemplate(ctx: Ctx, id: string) {
  const row = await prisma.sectioningTemplate.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Sectioning template')
  return row
}

async function assertTemplateRefs(ctx: Ctx, input: { academicYearId: string; gradeId: string; bandIds: string[]; sectionOrder: string[] }) {
  if (!(await prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId: ctx.schoolId } }))) throw notFound('Academic year')
  if (!(await prisma.grade.findFirst({ where: { id: input.gradeId, schoolId: ctx.schoolId } }))) throw notFound('Grade')
  if (input.bandIds.length) {
    const bands = await prisma.performanceBand.count({ where: { id: { in: input.bandIds }, schoolId: ctx.schoolId } })
    if (bands !== input.bandIds.length) throw notFound('Performance band')
  }
  const cohorts = await prisma.cohort.count({ where: { id: { in: input.sectionOrder }, schoolId: ctx.schoolId } })
  if (cohorts !== new Set(input.sectionOrder).size) throw notFound('Target section Cohort')
}

export async function createTemplateSvc(ctx: Ctx, input: z.infer<typeof createTemplate>) {
  await assertTemplateRefs(ctx, input)
  const row = await prisma.sectioningTemplate.create({
    data: {
      schoolId: ctx.schoolId, academicYearId: input.academicYearId, gradeId: input.gradeId, name: input.name,
      strategy: input.strategy, scoreSource: input.scoreSource, subjectWeights: input.subjectWeights as Prisma.InputJsonValue | undefined,
      bandIds: input.bandIds, distributionConfig: input.distributionConfig as Prisma.InputJsonValue | undefined,
      sectionOrder: input.sectionOrder, respectExisting: input.respectExisting ?? true,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'sectioningTemplate', row.id, undefined, serializeTemplate(row))
  return row
}

export async function updateTemplateSvc(ctx: Ctx, id: string, input: z.infer<typeof patchTemplate>) {
  const before = await getTemplate(ctx, id)
  await assertTemplateRefs(ctx, {
    academicYearId: input.academicYearId ?? before.academicYearId, gradeId: input.gradeId ?? before.gradeId,
    bandIds: input.bandIds ?? before.bandIds, sectionOrder: input.sectionOrder ?? before.sectionOrder,
  })
  const row = await prisma.sectioningTemplate.update({
    where: { id },
    data: {
      name: input.name, strategy: input.strategy, scoreSource: input.scoreSource,
      subjectWeights: input.subjectWeights as Prisma.InputJsonValue | undefined, bandIds: input.bandIds,
      distributionConfig: input.distributionConfig as Prisma.InputJsonValue | undefined, sectionOrder: input.sectionOrder,
      respectExisting: input.respectExisting,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'sectioningTemplate', id, serializeTemplate(before), serializeTemplate(row))
  return row
}

export async function removeTemplate(ctx: Ctx, id: string) {
  const before = await getTemplate(ctx, id)
  await prisma.sectioningTemplate.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'sectioningTemplate', id, serializeTemplate(before))
}

// ─────────────────────────────────── §4 draft generation, validation, approval, moves ───────────────────────────────────

const versionInclude = { assignments: true } satisfies Prisma.SectioningVersionInclude
type VersionWithAssignments = Prisma.SectioningVersionGetPayload<{ include: typeof versionInclude }>

export const serializeVersion = (v: VersionWithAssignments) => ({
  id: v.id, templateId: v.templateId, academicYearId: v.academicYearId, scopeCohortId: v.scopeCohortId ?? undefined,
  status: v.status, parentVersionId: v.parentVersionId ?? undefined, summary: v.summary as Record<string, unknown>,
  approvedAt: v.approvedAt?.toISOString(), approvedById: v.approvedById ?? undefined, createdAt: v.createdAt.toISOString(),
  assignments: v.assignments.map(a => ({
    studentId: a.studentId, cohortId: a.cohortId, previousCohortId: a.previousCohortId ?? undefined,
    band: a.band ?? undefined, score: a.score ?? undefined,
  })),
})

export function listVersions(ctx: Ctx, templateId?: string) {
  return prisma.sectioningVersion.findMany({ where: { schoolId: ctx.schoolId, templateId }, include: versionInclude, orderBy: { createdAt: 'desc' } })
}

export async function getVersion(ctx: Ctx, id: string) {
  const row = await prisma.sectioningVersion.findFirst({ where: { id, schoolId: ctx.schoolId }, include: versionInclude })
  if (!row) throw notFound('Sectioning version')
  return row
}

// A section-backed Cohort is the auto-generated 1:1 SECTION cohort of exactly one Class — for those,
// "writing section_id" means moving Enrollment.classId (there is no separate section_id column; Class
// already *is* board+grade+stream+section — see phase-t3-sectioning-engine.md header note). Anything else
// (TRACK / a Stage-2 merit sub-cohort with no backing Class) is written to CohortMembership instead.
async function classIfSectionBacked(cohortId: string) {
  const cohort = await prisma.cohort.findUnique({ where: { id: cohortId }, include: { members: true } })
  if (cohort?.autoGenerated && cohort.type === 'SECTION' && cohort.members.length === 1) return cohort.members[0].classId
  return null
}

async function previousCohortFor(ctx: Ctx, templateId: string, studentId: string, fallbackClassId?: string) {
  const last = await prisma.sectioningAssignment.findFirst({
    where: { schoolId: ctx.schoolId, studentId, version: { templateId, status: 'APPROVED' } },
    orderBy: { createdAt: 'desc' },
  })
  if (last) return last.cohortId
  if (fallbackClassId) {
    const cc = await prisma.cohortClass.findFirst({ where: { classId: fallbackClassId, cohort: { autoGenerated: true, type: 'SECTION' } } })
    return cc?.cohortId
  }
  return undefined
}

interface PopulationEntry { studentId: string; name: string; rollNo: string; previousCohortId?: string }

async function regularPopulation(ctx: Ctx, template: SectioningTemplateRow): Promise<PopulationEntry[]> {
  const enrollments = await prisma.enrollment.findMany({
    where: { schoolId: ctx.schoolId, academicYearId: template.academicYearId, status: 'active', class: { gradeId: template.gradeId } },
    include: { student: true },
  })
  return Promise.all(enrollments.map(async e => ({
    studentId: e.studentId, name: e.student.name, rollNo: e.rollNo ?? e.studentId,
    previousCohortId: await previousCohortFor(ctx, template.id, e.studentId, e.classId),
  })))
}

async function scopedPopulation(ctx: Ctx, template: SectioningTemplateRow, cohortId: string): Promise<PopulationEntry[]> {
  const members = await prisma.cohortMembership.findMany({ where: { schoolId: ctx.schoolId, cohortId }, include: { student: true } })
  return Promise.all(members.map(async m => {
    const enrollment = await prisma.enrollment.findUnique({ where: { studentId_academicYearId: { studentId: m.studentId, academicYearId: template.academicYearId } } })
    return { studentId: m.studentId, name: m.student.name, rollNo: enrollment?.rollNo ?? m.studentId, previousCohortId: await previousCohortFor(ctx, template.id, m.studentId) }
  }))
}

async function sectionCapacities(sectionOrder: string[]): Promise<Record<string, number | undefined>> {
  const out: Record<string, number | undefined> = {}
  for (const cohortId of sectionOrder) {
    const classId = await classIfSectionBacked(cohortId)
    if (!classId) { out[cohortId] = undefined; continue }
    const cls = await prisma.class.findUnique({ where: { id: classId } })
    out[cohortId] = cls?.capacity ?? undefined
  }
  return out
}

async function siblingsOf(ctx: Ctx, studentId: string): Promise<string[]> {
  const guardians = await prisma.guardian.findMany({ where: { schoolId: ctx.schoolId, studentId } })
  const parentIds = guardians.map(g => g.parentId)
  if (!parentIds.length) return []
  const siblingGuardians = await prisma.guardian.findMany({ where: { schoolId: ctx.schoolId, parentId: { in: parentIds }, studentId: { not: studentId } } })
  return [...new Set(siblingGuardians.map(g => g.studentId))]
}

function runStrategy(strategy: StrategyName, students: ScoredStudent[], sections: string[], bands: Band[], config: Record<string, unknown>, templateId: string): StrategyOutput {
  switch (strategy) {
    case 'BALANCED': return runBalanced(students, sections, bands)
    case 'RANKED': return runRanked(students, sections, bands)
    case 'BANDED': return runBanded(students, sections, bands, (config.broadGroups as number) ?? 3)
    case 'STRATIFIED_CAPPED': return runStratifiedCapped(students, sections, bands, (config.caps as Record<string, Record<string, number>>) ?? {})
    case 'RANDOM_PARITY': return runRandomParity(students, sections, bands, { seed: hashSeed(templateId), tolerancePct: config.tolerancePct as number | undefined })
    case 'SKIM_THEN_BALANCE': {
      const remainderName = (config.remainderStrategy as StrategyName) ?? 'BALANCED'
      const remainderFn: StrategyFn = (s, sec, b) => runStrategy(remainderName, s, sec, b, config, templateId)
      return runSkimThenBalance(students, sections, bands, (config.skim as { sectionId: string; count?: number; percentage?: number }[]) ?? [], remainderFn)
    }
  }
}

function validateAssignments(
  assignments: Assignment[], scored: ScoredStudent[], sections: string[], bands: Band[],
  capacities: Record<string, number | undefined>, tolerancePct: number, overflowIds: Set<string>,
) {
  const errors: string[] = []
  const countBySection = new Map<string, number>()
  for (const a of assignments) countBySection.set(a.sectionId, (countBySection.get(a.sectionId) ?? 0) + 1)
  for (const sec of sections) {
    const cap = capacities[sec]
    const count = countBySection.get(sec) ?? 0
    if (cap !== undefined && count > cap) errors.push(`Section ${sec} would have ${count} student(s), exceeding its capacity of ${cap}`)
  }

  const assignedIds = new Set(assignments.map(a => a.studentId))
  const missing = scored.filter(s => !assignedIds.has(s.studentId) && !overflowIds.has(s.studentId))
  if (missing.length) errors.push(`${missing.length} scored student(s) were not assigned to any section`)

  const totalByBand = new Map<string, number>()
  for (const s of scored) { const b = bandOf(s.score, bands); if (b) totalByBand.set(b, (totalByBand.get(b) ?? 0) + 1) }
  const totalScored = scored.length || 1
  const sectionBandMix: Record<string, Record<string, number>> = {}
  for (const sec of sections) {
    const secAssignments = assignments.filter(a => a.sectionId === sec)
    const secTotal = secAssignments.length || 1
    sectionBandMix[sec] = {}
    for (const [band, total] of totalByBand) {
      const secCount = secAssignments.filter(a => a.band === band).length
      const secPct = (secCount / secTotal) * 100
      const targetPct = (total / totalScored) * 100
      sectionBandMix[sec][band] = Math.round(secPct * 10) / 10
      if (secAssignments.length && Math.abs(secPct - targetPct) > tolerancePct) {
        errors.push(`Section ${sec}: band "${band}" mix is ${secPct.toFixed(1)}%, outside tolerance of target ${targetPct.toFixed(1)}% (±${tolerancePct}pp)`)
      }
    }
  }
  return { errors, sectionBandMix }
}

export async function generateDraft(ctx: Ctx, templateId: string, scopeCohortId?: string) {
  const template = await getTemplate(ctx, templateId)
  if (scopeCohortId && !(await prisma.cohort.findFirst({ where: { id: scopeCohortId, schoolId: ctx.schoolId } }))) throw notFound('Scope cohort')

  const bandRows = await prisma.performanceBand.findMany({ where: { schoolId: ctx.schoolId, id: { in: template.bandIds } } })
  const bandList: Band[] = bandRows.map(b => ({ label: b.label, minScore: b.minScore, maxScore: b.maxScore }))

  const population = scopeCohortId ? await scopedPopulation(ctx, template, scopeCohortId) : await regularPopulation(ctx, template)

  const scored: ScoredStudent[] = []
  const unscoredStudentIds: string[] = []
  const nameOf = new Map<string, string>()
  for (const p of population) {
    nameOf.set(p.studentId, p.name)
    const score = await computeOverallScore(ctx.schoolId, p.studentId, template.academicYearId, template.scoreSource as ScoreSource, template.subjectWeights as Record<string, number> | null)
    if (score === null) unscoredStudentIds.push(p.studentId)
    else scored.push({ studentId: p.studentId, name: p.name, rollNo: p.rollNo, score })
  }

  const capacities = await sectionCapacities(template.sectionOrder)
  const config = (template.distributionConfig as Record<string, unknown>) ?? {}
  const result = runStrategy(template.strategy as StrategyName, scored, template.sectionOrder, bandList, config, templateId)
  const overflowIds = new Set(result.overflow ?? [])
  const tolerancePct = (config.bandMixTolerancePct as number) ?? 15

  const { errors, sectionBandMix } = validateAssignments(result.assignments, scored, template.sectionOrder, bandList, capacities, tolerancePct, overflowIds)
  const warnings = [...result.warnings]

  if (config.siblingsTogether) {
    const assignMap = new Map(result.assignments.map(a => [a.studentId, a.sectionId]))
    const checked = new Set<string>()
    for (const s of scored) {
      if (checked.has(s.studentId)) continue
      const sibs = (await siblingsOf(ctx, s.studentId)).filter(id => assignMap.has(id))
      for (const sibId of sibs) {
        if (checked.has(sibId)) continue
        const mySec = assignMap.get(s.studentId)
        const sibSec = assignMap.get(sibId)
        if (mySec && sibSec && mySec !== sibSec) {
          warnings.push(`Siblings ${nameOf.get(s.studentId) ?? s.studentId} and ${nameOf.get(sibId) ?? sibId} were placed in different sections`)
        }
      }
      checked.add(s.studentId)
    }
  }

  const scoreOf = new Map(scored.map(s => [s.studentId, s.score]))
  const prevOf = new Map(population.map(p => [p.studentId, p.previousCohortId]))

  const version = await prisma.sectioningVersion.create({
    data: {
      schoolId: ctx.schoolId, templateId, academicYearId: template.academicYearId, scopeCohortId: scopeCohortId ?? null, status: 'DRAFT',
      summary: {
        scoredCount: scored.length, unscoredStudentIds, overflowStudentIds: [...overflowIds], warnings,
        sectionBandMix, validation: { errors, warnings },
      } as Prisma.InputJsonValue,
      assignments: {
        create: result.assignments.map(a => ({
          schoolId: ctx.schoolId, studentId: a.studentId, cohortId: a.sectionId, previousCohortId: prevOf.get(a.studentId) ?? null,
          band: a.band ?? null, score: scoreOf.get(a.studentId) ?? null,
        })),
      },
    },
    include: versionInclude,
  })
  await audit(ctx.schoolId, ctx.actorId, 'generate', 'sectioningVersion', version.id, undefined, {
    templateId, scopeCohortId, assignmentCount: version.assignments.length, unscoredCount: unscoredStudentIds.length, errorCount: errors.length,
  })
  return version
}

export async function approveVersion(ctx: Ctx, versionId: string, force: boolean) {
  const version = await getVersion(ctx, versionId)
  if (version.status !== 'DRAFT') throw new HttpError(400, 'Only a DRAFT version can be approved')
  const validation = (version.summary as Record<string, unknown>).validation as { errors: string[] } | undefined
  if (!force && validation?.errors.length) {
    throw new HttpError(409, 'This draft has blocking validation errors — resolve them or approve with force', { errors: validation.errors })
  }

  const movedStudentIds: string[] = []
  await prisma.$transaction(async tx => {
    for (const a of version.assignments) {
      const cohort = await tx.cohort.findUnique({ where: { id: a.cohortId }, include: { members: true } })
      if (cohort?.autoGenerated && cohort.type === 'SECTION' && cohort.members.length === 1) {
        const classId = cohort.members[0].classId
        const enrollment = await tx.enrollment.findUnique({ where: { studentId_academicYearId: { studentId: a.studentId, academicYearId: version.academicYearId } } })
        if (enrollment && enrollment.classId !== classId) {
          await tx.enrollment.update({ where: { id: enrollment.id }, data: { classId } })
          movedStudentIds.push(a.studentId)
        }
      } else {
        await tx.cohortMembership.upsert({
          where: { cohortId_studentId: { cohortId: a.cohortId, studentId: a.studentId } },
          create: { schoolId: ctx.schoolId, cohortId: a.cohortId, studentId: a.studentId },
          update: {},
        })
      }
    }
    await tx.sectioningVersion.update({ where: { id: versionId }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: ctx.actorId } })
  })
  if (movedStudentIds.length) await syncUserTitle(movedStudentIds)
  await audit(ctx.schoolId, ctx.actorId, 'approve', 'sectioningVersion', versionId, undefined, { assignmentCount: version.assignments.length, forced: !!force })
  return getVersion(ctx, versionId)
}

// Individual move — an audited edit outside the version pipeline (mid-term rebalance / one-off
// reassignment). Movement is a feature, not a bug (§4 edge cases).
export async function moveStudent(ctx: Ctx, input: z.infer<typeof moveBody>) {
  const cohort = await prisma.cohort.findFirst({ where: { id: input.toCohortId, schoolId: ctx.schoolId }, include: { members: true } })
  if (!cohort) throw notFound('Target cohort')
  const student = await prisma.user.findFirst({ where: { id: input.studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')

  let before: Record<string, unknown>
  if (cohort.autoGenerated && cohort.type === 'SECTION' && cohort.members.length === 1) {
    const classId = cohort.members[0].classId
    const cls = await prisma.class.findUnique({ where: { id: classId } })
    if (!cls) throw notFound('Class')
    const enrollment = await prisma.enrollment.findUnique({ where: { studentId_academicYearId: { studentId: input.studentId, academicYearId: cls.academicYearId } } })
    if (!enrollment) throw notFound('Enrollment')
    before = { classId: enrollment.classId }
    await prisma.enrollment.update({ where: { id: enrollment.id }, data: { classId } })
    await syncUserTitle([input.studentId])
  } else {
    const existing = await prisma.cohortMembership.findMany({ where: { schoolId: ctx.schoolId, studentId: input.studentId } })
    before = { cohortIds: existing.map(e => e.cohortId) }
    await prisma.cohortMembership.upsert({
      where: { cohortId_studentId: { cohortId: cohort.id, studentId: input.studentId } },
      create: { schoolId: ctx.schoolId, cohortId: cohort.id, studentId: input.studentId },
      update: {},
    })
  }
  await audit(ctx.schoolId, ctx.actorId, 'move', 'student-section', input.studentId, before, { toCohortId: input.toCohortId, reason: input.reason })
  return { studentId: input.studentId, toCohortId: input.toCohortId }
}

// ─────────────────────────────────── §3 Track/stream two-stage pipeline ───────────────────────────────────

export const serializeRule = (r: { id: string; trackActivityId: string; label: string; subjectScoreRules: unknown; enforcementMode: string; createdAt: Date }) => ({
  id: r.id, trackActivityId: r.trackActivityId, label: r.label, subjectScoreRules: r.subjectScoreRules, enforcementMode: r.enforcementMode, createdAt: r.createdAt.toISOString(),
})

export function listRules(ctx: Ctx, trackActivityId?: string) {
  return prisma.trackEligibilityRule.findMany({ where: { schoolId: ctx.schoolId, trackActivityId }, orderBy: { createdAt: 'asc' } })
}

async function getRule(ctx: Ctx, id: string) {
  const row = await prisma.trackEligibilityRule.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Track eligibility rule')
  return row
}

async function assertTrackActivity(ctx: Ctx, trackActivityId: string) {
  const a = await prisma.activity.findFirst({ where: { id: trackActivityId, schoolId: ctx.schoolId } })
  if (!a) throw notFound('Track activity')
  return a
}

export async function createRuleSvc(ctx: Ctx, input: z.infer<typeof createRule>) {
  await assertTrackActivity(ctx, input.trackActivityId)
  const row = await prisma.trackEligibilityRule.create({
    data: { schoolId: ctx.schoolId, trackActivityId: input.trackActivityId, label: input.label, subjectScoreRules: input.subjectScoreRules as Prisma.InputJsonValue, enforcementMode: input.enforcementMode },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'trackEligibilityRule', row.id, undefined, serializeRule(row))
  return row
}

export async function updateRuleSvc(ctx: Ctx, id: string, input: z.infer<typeof patchRule>) {
  const before = await getRule(ctx, id)
  const row = await prisma.trackEligibilityRule.update({
    where: { id },
    data: { label: input.label, subjectScoreRules: input.subjectScoreRules as Prisma.InputJsonValue | undefined, enforcementMode: input.enforcementMode },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'trackEligibilityRule', id, serializeRule(before), serializeRule(row))
  return row
}

export async function removeRule(ctx: Ctx, id: string) {
  const before = await getRule(ctx, id)
  await prisma.trackEligibilityRule.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'trackEligibilityRule', id, serializeRule(before))
}

interface RuleEvaluation { ruleId: string; label: string; enforcementMode: string; results: SubjectRuleResult[]; passed: boolean }

export async function trackRegister(ctx: Ctx, activityId: string, body: z.infer<typeof trackRegisterBody>) {
  const activity = await assertTrackActivity(ctx, activityId)

  let studentId: string
  if (ctx.role === 'student') {
    if (body.studentId && body.studentId !== ctx.actorId) throw new HttpError(403, 'Students may only register themselves')
    studentId = ctx.actorId
  } else {
    if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may register a student for a track')
    if (!body.studentId) throw new HttpError(400, 'studentId is required')
    studentId = body.studentId
  }
  const student = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')

  const enrollment = await prisma.enrollment.findFirst({ where: { schoolId: ctx.schoolId, studentId, status: 'active' }, orderBy: { createdAt: 'desc' } })
  const academicYearId = enrollment?.academicYearId ?? ''

  const rules = await prisma.trackEligibilityRule.findMany({ where: { schoolId: ctx.schoolId, trackActivityId: activityId } })
  const ruleResults: RuleEvaluation[] = []
  for (const rule of rules) {
    const subjectRules = rule.subjectScoreRules as unknown as SubjectScoreRule[]
    const results = await Promise.all(subjectRules.map(r => evaluateSubjectRule(ctx.schoolId, studentId, academicYearId, r)))
    ruleResults.push({ ruleId: rule.id, label: rule.label, enforcementMode: rule.enforcementMode, results, passed: results.every(r => r.passed) })
  }
  const failedStrict = ruleResults.filter(r => !r.passed && r.enforcementMode === 'STRICT')
  const failedAdvisory = ruleResults.filter(r => !r.passed && r.enforcementMode === 'ADVISORY')

  let overridden = false
  if (failedStrict.length) {
    if (!isStaff(ctx) || !body.overrideReason) {
      throw new HttpError(409, 'This student does not meet a STRICT eligibility rule for this track — an authorized staff/admin override with a reason is required', {
        failedRules: failedStrict.map(r => ({ ruleId: r.ruleId, label: r.label, unmet: r.results.filter(x => !x.passed) })),
      })
    }
    overridden = true
    for (const r of failedStrict) {
      await prisma.trackEligibilityException.create({
        data: {
          schoolId: ctx.schoolId, trackActivityId: activityId, ruleId: r.ruleId, studentId, type: 'STRICT_OVERRIDE',
          unmetDetails: r.results.filter(x => !x.passed) as unknown as Prisma.InputJsonValue, reason: body.overrideReason, approvedById: ctx.actorId,
        },
      })
    }
    await audit(ctx.schoolId, ctx.actorId, 'override', 'trackEligibilityRule', activityId, undefined, { studentId, reason: body.overrideReason, ruleIds: failedStrict.map(r => r.ruleId) })
  }
  if (failedAdvisory.length) {
    for (const r of failedAdvisory) {
      await prisma.trackEligibilityException.create({
        data: {
          schoolId: ctx.schoolId, trackActivityId: activityId, ruleId: r.ruleId, studentId, type: 'ADVISORY_FLAG',
          unmetDetails: r.results.filter(x => !x.passed) as unknown as Prisma.InputJsonValue,
        },
      })
    }
  }

  const studentCtx: Ctx = { schoolId: ctx.schoolId, actorId: studentId, role: 'student' }
  const registration = await activitiesSvc.register(studentCtx, activityId)
  if (ctx.actorId !== studentId) {
    await audit(ctx.schoolId, ctx.actorId, 'register-on-behalf', 'trackActivity', activityId, undefined, { studentId, registrationId: registration.id })
  }

  // A confirmed (non-waitlisted) registration is the real Stage-1 outcome: write it into the T1 Cohort
  // (type=TRACK) this Activity is linked to — §3's "a track is just a Cohort spanning the relevant base
  // classes". A student who is Waitlisted is not yet a member; ActivityRegistration's existing
  // waitlist-promotion (see modules/activities/service.ts#cancelRegistration) is generic Phase 8 code that
  // doesn't know about track cohorts, so a promotion there does not yet sync membership — a follow-up
  // phase should either teach that promotion path about `Activity.trackCohortId` or have callers re-check.
  if (activity.trackCohortId && registration.status === 'Registered') {
    await prisma.cohortMembership.upsert({
      where: { cohortId_studentId: { cohortId: activity.trackCohortId, studentId } },
      create: { schoolId: ctx.schoolId, cohortId: activity.trackCohortId, studentId },
      update: {},
    })
  }
  return {
    registration: activitiesSvc.serializeRegistration(registration),
    eligibility: {
      passed: !failedStrict.length && !failedAdvisory.length, overridden,
      failedStrict: failedStrict.map(r => ({ ruleId: r.ruleId, label: r.label })),
      failedAdvisory: failedAdvisory.map(r => ({ ruleId: r.ruleId, label: r.label })),
    },
  }
}

export async function exceptionsReport(ctx: Ctx, q: { trackActivityId?: string }) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may view the eligibility exceptions report')
  const rows = await prisma.trackEligibilityException.findMany({
    where: { schoolId: ctx.schoolId, trackActivityId: q.trackActivityId },
    include: { student: true, approvedBy: true },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(r => ({
    id: r.id, trackActivityId: r.trackActivityId, ruleId: r.ruleId ?? undefined, type: r.type,
    studentId: r.studentId, studentName: r.student.name, unmetDetails: r.unmetDetails,
    reason: r.reason ?? undefined, approvedById: r.approvedById ?? undefined, approvedByName: r.approvedBy?.name ?? undefined,
    createdAt: r.createdAt.toISOString(),
  }))
}
