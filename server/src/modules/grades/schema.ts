import { z } from 'zod'

export const createGrade = z.object({
  label: z.string().min(1),
  // Defaults to max(order) + 1 in the service.
  order: z.number().int().optional(),
})

export const patchGrade = createGrade.partial()
