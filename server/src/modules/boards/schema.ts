import { z } from 'zod'

export const createBoard = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
})

export const patchBoard = createBoard.partial()
