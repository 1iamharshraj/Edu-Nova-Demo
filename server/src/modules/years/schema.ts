import { z } from 'zod'
import { dateStr } from '../../lib/validate'

export const createYear = z.object({
  label: z.string().min(1),
  startDate: dateStr,
  endDate: dateStr,
}).refine(y => y.endDate > y.startDate, { message: 'endDate must be after startDate', path: ['endDate'] })

export const patchYear = z.object({
  label: z.string().min(1).optional(),
  startDate: dateStr.optional(),
  endDate: dateStr.optional(),
}).refine(y => !(y.startDate && y.endDate) || y.endDate > y.startDate, { message: 'endDate must be after startDate', path: ['endDate'] })
