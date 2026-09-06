import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const createGuardian = z.object({
  parentId: idStr,
  studentId: idStr,
  relation: z.string().min(1).default('guardian'),
})
