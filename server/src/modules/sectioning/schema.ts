import { z } from 'zod'
import { idStr } from '../../lib/validate'

// ── Bands (§1) ──
export const createBand = z.object({
  academicYearId: idStr,
  label: z.string().trim().min(1).max(60),
  minScore: z.number().min(0).max(100),
  maxScore: z.number().min(0).max(100),
}).refine(b => b.maxScore >= b.minScore, { message: 'maxScore must be >= minScore', path: ['maxScore'] })

export const patchBand = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  minScore: z.number().min(0).max(100).optional(),
  maxScore: z.number().min(0).max(100).optional(),
})

// ── SectioningTemplate (§2) ──
export const strategyEnum = z.enum(['BALANCED', 'RANKED', 'BANDED', 'STRATIFIED_CAPPED', 'RANDOM_PARITY', 'SKIM_THEN_BALANCE'])
export const scoreSourceEnum = z.enum(['LATEST_EXAM', 'EXAM_AVERAGE', 'CUSTOM_WEIGHTING'])

export const createTemplate = z.object({
  academicYearId: idStr,
  gradeId: idStr,
  name: z.string().trim().min(1).max(120),
  strategy: strategyEnum,
  scoreSource: scoreSourceEnum,
  subjectWeights: z.record(z.string(), z.number().positive()).optional(),
  bandIds: z.array(idStr).default([]),
  distributionConfig: z.record(z.string(), z.unknown()).optional(),
  sectionOrder: z.array(idStr).min(1),
  respectExisting: z.boolean().optional(),
})

export const patchTemplate = createTemplate.partial()

// ── Generate / approve / moves ──
export const generateBody = z.object({
  scopeCohortId: idStr.optional(), // Stage-2 run scoped to a track cohort's population
})

export const approveBody = z.object({
  force: z.boolean().optional(), // proceed despite blocking validation (capacity/band-mix/unassigned)
})

export const moveBody = z.object({
  studentId: idStr,
  toCohortId: idStr,
  reason: z.string().trim().min(1).max(2000),
})

// ── Track eligibility (§3) ──
export const enforcementModeEnum = z.enum(['STRICT', 'ADVISORY'])

export const subjectScoreRule = z.object({
  subjectId: idStr.optional(),
  subjectName: z.string().trim().min(1).max(120).optional(),
  minScore: z.number().min(0).max(100),
}).refine(r => r.subjectId || r.subjectName, { message: 'subjectId or subjectName is required' })

export const createRule = z.object({
  trackActivityId: idStr,
  label: z.string().trim().min(1).max(120),
  subjectScoreRules: z.array(subjectScoreRule).min(1),
  enforcementMode: enforcementModeEnum,
})

export const patchRule = createRule.partial()

export const trackRegisterBody = z.object({
  studentId: idStr.optional(), // staff-driven registration on a student's behalf
  overrideReason: z.string().trim().min(1).max(2000).optional(),
})

export const exceptionsQuery = z.object({
  trackActivityId: idStr.optional(),
})
