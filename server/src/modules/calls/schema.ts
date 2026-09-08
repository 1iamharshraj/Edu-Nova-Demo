import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const CALL_REASONS = ['fee', 'attendance', 'disciplinary', 'general'] as const
export const CALL_OUTCOMES = ['confirmed', 'callback', 'unreachable', 'refused', 'other'] as const

export const createCall = z.object({
  studentId: idStr,
  parentId: idStr.optional(),
  reason: z.enum(CALL_REASONS),
  summary: z.string().trim().min(1).max(4000),
  outcome: z.enum(CALL_OUTCOMES),
  calledAt: z.string().datetime().optional(),
  durationMin: z.number().int().min(0).max(600).optional(),
})

export const callsQuery = z.object({ studentId: idStr.optional() })
