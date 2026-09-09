import { z } from 'zod'
import { idStr } from '../../lib/validate'

// GET /api/compliance/udise-export?academicYearId=&format=
export const udiseExportQuery = z.object({
  academicYearId: idStr,
  format: z.enum(['json', 'csv']).default('json'),
})
