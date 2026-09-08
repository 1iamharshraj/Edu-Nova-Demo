import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const LEAVE_APPLIES_TO = ['student', 'staff'] as const
export const LEAVE_STATUSES = ['Pending', 'Approved', 'Declined', 'Cancelled'] as const

export const createLeaveType = z.object({
  name: z.string().trim().min(1).max(80),
  daysPerYear: z.number().int().nonnegative(),
  appliesTo: z.enum(LEAVE_APPLIES_TO),
})
export const patchLeaveType = createLeaveType.partial()

export const createLeaveRequest = z.object({
  forUserId: idStr,
  leaveTypeId: idStr.optional(),
  fromDate: dateStr,
  toDate: dateStr,
  reason: z.string().trim().min(1).max(1000),
})

export const requestsQuery = z.object({
  forUserId: idStr.optional(),
  status: z.enum(LEAVE_STATUSES).optional(),
  scope: z.enum(['mine', 'approvals']).optional(),
})

export const decideBody = z.object({ note: z.string().trim().max(1000).optional() })

export const balanceQuery = z.object({ userId: idStr.optional(), year: z.string().regex(/^\d{4}$/, 'Expected YYYY').optional() })
