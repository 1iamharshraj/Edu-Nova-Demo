import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const createTerm = z.object({
  academicYearId: idStr,
  name: z.string().min(1),
  startDate: dateStr,
  endDate: dateStr,
})

export const patchTerm = createTerm.partial()
