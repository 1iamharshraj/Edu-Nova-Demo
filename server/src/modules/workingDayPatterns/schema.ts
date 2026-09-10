import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const weekday = z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
export const saturdayPattern = z.enum(['NONE', 'ALL', 'ALTERNATE_1_3', 'ALTERNATE_2_4', 'HALF_DAY_ALL'])

export const createWorkingDayPattern = z.object({
  academicYearId: idStr,
  workingDays: z.array(weekday).min(1),
  saturdayPattern,
})

export const patchWorkingDayPattern = z.object({
  workingDays: z.array(weekday).min(1).optional(),
  saturdayPattern: saturdayPattern.optional(),
})
