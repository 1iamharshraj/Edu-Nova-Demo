import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const roomKind = z.enum(['classroom', 'lab', 'ground', 'hall', 'other'])

// Phase T1 §2 — capabilities are additive detail on top of `kind`, not a replacement for it.
export const createRoom = z.object({
  name: z.string().min(1),
  kind: roomKind,
  capacity: z.number().int().positive().nullable().optional(),
  capabilityIds: z.array(idStr).optional(),
})

export const patchRoom = createRoom.partial()

export const setRoomCapabilities = z.object({ capabilityIds: z.array(idStr) })
