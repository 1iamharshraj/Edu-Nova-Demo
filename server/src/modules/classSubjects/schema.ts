import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const createClassSubject = z.object({
  classId: idStr,
  subjectId: idStr,
  teacherId: idStr.nullable().optional(),
  periodsPerWeek: z.number().int().min(0).default(5),
})

export const patchClassSubject = createClassSubject.partial()
