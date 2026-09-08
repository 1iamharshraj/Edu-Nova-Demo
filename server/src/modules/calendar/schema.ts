import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const CAL_TYPES = ['holiday', 'exam', 'event'] as const
export const CAL_AUDIENCES = ['School', 'Class'] as const

export const createEvent = z.object({
  title: z.string().trim().min(1).max(200),
  date: dateStr,
  endDate: dateStr.optional(),
  type: z.enum(CAL_TYPES),
  audience: z.enum(CAL_AUDIENCES),
  classId: idStr.optional(),
  termId: idStr.optional(),
}).refine(v => v.audience !== 'Class' || !!v.classId, { message: 'classId is required for Class audience', path: ['classId'] })

export const patchEvent = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  date: dateStr.optional(),
  endDate: dateStr.optional(),
  type: z.enum(CAL_TYPES).optional(),
  audience: z.enum(CAL_AUDIENCES).optional(),
  classId: idStr.optional(),
  termId: idStr.optional(),
})

export const eventsQuery = z.object({ termId: idStr.optional(), from: dateStr.optional(), to: dateStr.optional() })
