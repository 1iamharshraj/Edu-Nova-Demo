import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const VERIFICATION_METHODS = ['Document', 'InPerson', 'Aadhaar'] as const
export const VERIFICATION_STATUSES = ['Pending', 'Verified', 'Rejected'] as const

export const submitBody = z.object({
  method: z.enum(VERIFICATION_METHODS),
  documentFileId: idStr.nullable().optional(),
})

export const listQuery = z.object({ status: z.enum(VERIFICATION_STATUSES).optional() })
export const rejectBody = z.object({ note: z.string().max(2000).optional() })
