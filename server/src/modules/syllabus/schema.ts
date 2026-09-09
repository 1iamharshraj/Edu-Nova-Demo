import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

// ═══════════════════════════ chapters ═══════════════════════════

export const createChapter = z.object({
  curriculumSubjectId: idStr,
  order: z.number().int().min(1),
  title: z.string().trim().min(1).max(200),
  estimatedPeriods: z.number().int().min(1).max(500),
  examWeightagePct: z.number().min(0).max(100).nullable().optional(),
})

export const patchChapter = z.object({
  order: z.number().int().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  estimatedPeriods: z.number().int().min(1).max(500).optional(),
  examWeightagePct: z.number().min(0).max(100).nullable().optional(),
})

export const chaptersQuery = z.object({ curriculumSubjectId: idStr.optional() })

// ═══════════════════════════ chapter resources ═══════════════════════════

export const createChapterResource = z.object({
  chapterId: idStr,
  fileId: idStr,
  label: z.string().trim().min(1).max(150),
})

export const chapterResourcesQuery = z.object({ chapterId: idStr.optional() })

// ═══════════════════════════ progress ═══════════════════════════

export const progressStatus = z.enum(['NotStarted', 'InProgress', 'Done'])

export const patchProgress = z.object({
  status: progressStatus.optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  startedAt: dateStr.nullable().optional(),
  completedAt: dateStr.nullable().optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'Provide at least one field to update' })

export const progressQuery = z.object({ classSubjectId: idStr })

// ═══════════════════════════ term targets ═══════════════════════════

export const createTarget = z.object({
  curriculumSubjectId: idStr,
  termId: idStr,
  targetChapterId: idStr,
  classId: idStr.nullable().optional(),
})

export const patchTarget = z.object({
  targetChapterId: idStr.optional(),
})

export const targetsQuery = z.object({
  curriculumSubjectId: idStr.optional(),
  termId: idStr.optional(),
  classId: idStr.optional(),
})

// ═══════════════════════════ pace / coverage ═══════════════════════════

export const paceQuery = z.object({ asOf: dateStr.optional(), termId: idStr.optional() })
export const coverageQuery = z.object({ termId: idStr.optional() })
