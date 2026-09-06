import { z } from 'zod'

export const createSubject = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  color: z.string().min(1),
})

export const patchSubject = createSubject.partial()
