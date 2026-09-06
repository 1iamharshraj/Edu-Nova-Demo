import { z } from 'zod'
import { dateStr } from '../../lib/validate'

export const createYear = z.object({
  label: z.string().min(1),
  startDate: dateStr,
  endDate: dateStr,
})

export const patchYear = createYear.partial()
