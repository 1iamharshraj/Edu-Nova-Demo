import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const createSlip = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(4000),
  dueDate: dateStr,
  classId: idStr.optional(),
  requiresVerifiedParent: z.boolean().optional(),
})

export const patchSlip = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().trim().min(1).max(4000).optional(),
  dueDate: dateStr.optional(),
  requiresVerifiedParent: z.boolean().optional(),
})

export const respondSlip = z.object({
  studentId: idStr,
  decision: z.enum(['Approved', 'Declined']),
  note: z.string().trim().max(1000).optional(),
})

export const slipsQuery = z.object({ classId: idStr.optional() })
