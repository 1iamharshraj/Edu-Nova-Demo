import { z } from 'zod'

export const createCapability = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
})

export const patchCapability = createCapability.partial()
