import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

// See phase-11-employee-management.md → A3.
export const REVIEW_STATUSES = ['Draft', 'Shared', 'Acknowledged'] as const

// overallRating: 1 (Needs improvement) .. 5 (Outstanding) — a plain 1-5 int, no separate enum.
export const createReview = z.object({
  employeeId: idStr,
  cycle: z.string().trim().min(1).max(80),
  periodStart: dateStr,
  periodEnd: dateStr,
  overallRating: z.number().int().min(1).max(5),
  strengths: z.string().trim().min(1).max(4000),
  areasForImprovement: z.string().trim().min(1).max(4000),
  goals: z.string().trim().min(1).max(4000),
})

export const patchReview = createReview.omit({ employeeId: true }).partial()

export const employeeCommentsBody = z.object({ employeeComments: z.string().trim().min(1).max(4000) })

export const acknowledgeBody = z.object({ employeeComments: z.string().trim().min(1).max(4000).optional() })

export const reviewsQuery = z.object({ employeeId: idStr.optional() })
