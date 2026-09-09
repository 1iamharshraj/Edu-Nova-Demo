import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

// ═══════════════════════════ risk snapshots (item 1) ═══════════════════════════

export const RISK_LEVELS = ['Low', 'Medium', 'High'] as const

export const recomputeBody = z.object({
  classId: idStr.optional(), // omit → whole school
  termId: idStr.optional(), // omit → current term
})

export const riskSnapshotsQuery = z.object({
  classId: idStr.optional(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  termId: idStr.optional(),
})

// ═══════════════════════════ lost instructional time (item 2) ═══════════════════════════

export const lostTimeQuery = z.object({
  termId: idStr.optional(),
  groupBy: z.enum(['class', 'subject', 'teacher']).default('class'),
})

// ═══════════════════════════ teacher workload (item 3) ═══════════════════════════

export const teacherWorkloadQuery = z.object({ termId: idStr.optional() })

export const patchAnalyticsSettings = z.object({
  highLoadThreshold: z.number().int().min(1).max(80).optional(),
})

// ═══════════════════════════ homework load (item 4) ═══════════════════════════

export const homeworkLoadQuery = z.object({ classId: idStr, date: dateStr })

// ═══════════════════════════ substitute suggestions (item 5) ═══════════════════════════

export const substituteSuggestionsQuery = z.object({
  classSubjectId: idStr,
  date: dateStr,
  periodIdx: z.coerce.number().int().min(0),
})
