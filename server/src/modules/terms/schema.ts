import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const createTerm = z.object({
  academicYearId: idStr,
  name: z.string().min(1),
  startDate: dateStr,
  endDate: dateStr,
}).refine(t => t.endDate > t.startDate, { message: 'endDate must be after startDate', path: ['endDate'] })

export const patchTerm = z.object({
  academicYearId: idStr.optional(),
  name: z.string().min(1).optional(),
  startDate: dateStr.optional(),
  endDate: dateStr.optional(),
}).refine(t => !(t.startDate && t.endDate) || t.endDate > t.startDate, { message: 'endDate must be after startDate', path: ['endDate'] })
