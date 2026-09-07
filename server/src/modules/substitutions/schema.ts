import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const createSubstitution = z.object({
  timetableEntryId: idStr,
  date: dateStr,
  substituteTeacherId: idStr,
  reason: z.string().nullable().optional(),
})

export const substitutionQuery = z.object({
  date: dateStr.optional(),
  teacherId: idStr.optional(),
  classId: idStr.optional(),
})
