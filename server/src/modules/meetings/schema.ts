import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const MEETING_STATUSES = ['Requested', 'Scheduled', 'Completed', 'Cancelled', 'Declined'] as const

export const createMeeting = z.object({
  withUserId: idStr,
  studentId: idStr.optional(),
  purpose: z.string().trim().min(1).max(500),
  scheduledAt: z.string().datetime(),
  durationMin: z.number().int().min(5).max(240).optional(),
})

export const decideMeeting = z.object({ note: z.string().trim().max(1000).optional() })

export const meetingsQuery = z.object({ status: z.enum(MEETING_STATUSES).optional() })
