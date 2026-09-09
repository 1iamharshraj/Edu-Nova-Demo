import { z } from 'zod'
import { idStr } from '../../lib/validate'

// See phase-21-financial-intelligence.md item 4.

export const SCHOLARSHIP_TYPES = ['MeritBased', 'NeedBased', 'SiblingDiscount', 'StaffWard', 'Other'] as const
export const DISCOUNT_TYPES = ['Percentage', 'FixedAmount'] as const
export const AWARD_STATUSES = ['Pending', 'Approved', 'Rejected'] as const

export const createScholarship = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.enum(SCHOLARSHIP_TYPES),
  discountType: z.enum(DISCOUNT_TYPES),
  discountValue: z.number().positive(),
  criteria: z.string().trim().max(1000).optional(),
  active: z.boolean().optional(),
}).refine(s => s.discountType !== 'Percentage' || s.discountValue <= 100, {
  message: 'A percentage discount cannot exceed 100', path: ['discountValue'],
})

export const patchScholarship = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  criteria: z.string().trim().max(1000).nullable().optional(),
  active: z.boolean().optional(),
})
// type/discountType/discountValue are immutable after creation — changing them after awards already
// exist against this scholarship would silently misrepresent what was actually approved/applied
// historically (same reasoning as accounting/schema.ts#patchAccount keeping code/type immutable).

export const scholarshipQuery = z.object({ active: z.enum(['true', 'false']).optional() })

export const createAward = z.object({
  scholarshipId: idStr,
  studentId: idStr,
  academicYearId: idStr,
})

export const awardQuery = z.object({
  status: z.enum(AWARD_STATUSES).optional(),
  studentId: idStr.optional(),
  academicYearId: idStr.optional(),
  scholarshipId: idStr.optional(),
})

export const rejectAward = z.object({ reason: z.string().trim().max(500).optional() })
