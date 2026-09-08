import { z } from 'zod'
import { idStr } from '../../lib/validate'

// See phase-11-employee-management.md → A5.
export const CONDUCT_CATEGORIES = ['Conduct', 'Performance', 'Policy', 'Attendance', 'Other'] as const
export const CONDUCT_STATUSES = ['Reported', 'UnderReview', 'Resolved'] as const

export const createConduct = z.object({
  employeeId: idStr,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(4000),
  category: z.enum(CONDUCT_CATEGORIES),
  fileIds: z.array(idStr).max(20).optional(),
})

export const patchConduct = z.object({
  status: z.enum(CONDUCT_STATUSES).optional(),
  actionTaken: z.string().trim().max(2000).optional(),
})

export const conductQuery = z.object({ employeeId: idStr.optional() })
