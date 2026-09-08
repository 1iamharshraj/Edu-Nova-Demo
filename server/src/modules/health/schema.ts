import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const HEALTH_KINDS = ['Vaccination', 'Allergy', 'Condition', 'Checkup', 'Other'] as const

export const createHealthRecord = z.object({
  studentId: idStr,
  kind: z.enum(HEALTH_KINDS),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(4000),
  date: dateStr,
  fileIds: z.array(idStr).max(20).optional(),
})

export const patchHealthRecord = z.object({
  kind: z.enum(HEALTH_KINDS).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().trim().min(1).max(4000).optional(),
  date: dateStr.optional(),
  fileIds: z.array(idStr).max(20).optional(),
})

export const healthQuery = z.object({ studentId: idStr.optional() })
