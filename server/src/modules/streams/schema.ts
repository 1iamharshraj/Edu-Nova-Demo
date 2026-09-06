import { z } from 'zod'

export const createStream = z.object({
  name: z.string().min(1),
})

export const patchStream = createStream.partial()
