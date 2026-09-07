import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const entryInput = z.object({
  dayOfWeek: z.number().int().min(1).max(6),
  periodIdx: z.number().int().min(0),
  classSubjectId: idStr,
  roomId: idStr.nullable().optional(),
  teacherId: idStr.nullable().optional(),
})

export const putEntries = z.object({
  classId: idStr,
  termId: idStr,
  entries: z.array(entryInput),
})

export const copyBody = z.object({
  fromClassId: idStr,
  fromTermId: idStr,
  toClassId: idStr,
  toTermId: idStr,
})

export const publishBody = z.object({
  classId: idStr,
  termId: idStr,
  published: z.boolean(),
})

export const gridQuery = z.object({ classId: idStr, termId: idStr })
export const termQuery = z.object({ termId: idStr })
export const meQuery = z.object({ termId: idStr, studentId: idStr.optional() })
