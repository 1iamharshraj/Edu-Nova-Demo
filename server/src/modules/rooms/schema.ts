import { z } from 'zod'

export const roomKind = z.enum(['classroom', 'lab', 'ground', 'hall', 'other'])

export const createRoom = z.object({
  name: z.string().min(1),
  kind: roomKind,
  capacity: z.number().int().positive().nullable().optional(),
})

export const patchRoom = createRoom.partial()
