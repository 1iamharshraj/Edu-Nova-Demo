import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const createClass = z.object({
  academicYearId: idStr,
  boardId: idStr,
  gradeId: idStr,
  streamId: idStr.nullable().optional(),
  section: z.string().min(1),
  classTeacherId: idStr.nullable().optional(),
  capacity: z.number().int().positive().nullable().optional(),
})

export const patchClass = createClass.partial()
