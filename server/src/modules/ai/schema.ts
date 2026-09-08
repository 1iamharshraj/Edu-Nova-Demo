import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const askBody = z.object({
  question: z.string().trim().min(1).max(4000),
  subjectId: idStr.optional(),
})
