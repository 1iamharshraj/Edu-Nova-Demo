import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const CONTRACT_STATUSES = ['Draft', 'Active', 'Ended'] as const
export const DUTY_STATUSES = ['Assigned', 'Done'] as const

// ── contracts ──
export const createContract = z.object({
  userId: idStr,
  designation: z.string().trim().min(1).max(120),
  department: z.string().trim().max(120).optional(),
  startDate: dateStr,
  endDate: dateStr.optional(),
  terms: z.string().trim().min(1).max(10_000),
})
export const patchContract = createContract.omit({ userId: true }).partial()

export const contractsQuery = z.object({ userId: idStr.optional(), status: z.enum(CONTRACT_STATUSES).optional() })

export const endContractBody = z.object({ reason: z.string().trim().min(1).max(1000) })

// ── resignations ──
export const createResignation = z.object({
  reason: z.string().trim().min(1).max(1000),
  lastWorkingDate: dateStr,
})

export const RESIGNATION_STATUSES = ['Pending', 'Approved', 'Declined', 'Withdrawn'] as const
export const resignationsQuery = z.object({ userId: idStr.optional(), status: z.enum(RESIGNATION_STATUSES).optional() })

export const decideResignationBody = z.object({ notes: z.string().trim().max(1000).optional() })

// ── duties ──
export const createDuty = z.object({
  title: z.string().trim().min(1).max(160),
  eventTitle: z.string().trim().min(1).max(160),
  eventDate: dateStr,
  assigneeId: idStr.optional(),
  notes: z.string().trim().max(1000).optional(),
})
export const patchDuty = createDuty.partial().extend({ status: z.enum(DUTY_STATUSES).optional() })

export const dutiesQuery = z.object({ assigneeId: idStr.optional() })
