import { z } from 'zod'
import { idStr, dateStr } from '../../lib/validate'

// See phase-14-hostel.md.

export const HOSTEL_TYPES = ['Boys', 'Girls', 'Mixed'] as const
export const ALLOCATION_STATUSES = ['Active', 'Vacated', 'Transferred'] as const

// ───────────────────────────── hostels ─────────────────────────────

export const createHostel = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(HOSTEL_TYPES),
  wardenUserId: idStr.nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
})
export const patchHostel = createHostel.partial()

// ───────────────────────────── rooms ─────────────────────────────

// `bedLabels`, if given, must have exactly `capacity` entries and becomes the label for beds 1..N in
// order; otherwise beds are auto-labelled "1".."N". See service.ts#syncRoomBeds.
export const createRoom = z.object({
  hostelId: idStr,
  roomNumber: z.string().trim().min(1).max(30),
  floor: z.string().trim().max(30).nullable().optional(),
  capacity: z.number().int().positive().max(50),
  roomType: z.string().trim().max(40).nullable().optional(),
  bedLabels: z.array(z.string().trim().min(1).max(20)).max(50).optional(),
})
// hostelId is fixed at creation, same reasoning as Transport's Stop.routeId — moving a room to a
// different hostel is a delete+recreate, not a patch. Changing `capacity` here auto-adds/removes beds
// (see service.ts#resizeRoom); shrinking below the number of currently-occupied beds is rejected.
export const patchRoom = createRoom.omit({ hostelId: true, bedLabels: true }).partial()

export const roomQuery = z.object({ hostelId: idStr.optional() })

// ───────────────────────────── beds ─────────────────────────────

// Manually adding one bed to an existing room (on top of the auto-generated set) bumps the room's
// capacity to match — see service.ts#createBedRow.
export const createBed = z.object({
  roomId: idStr,
  bedLabel: z.string().trim().min(1).max(20),
})
export const patchBed = z.object({ bedLabel: z.string().trim().min(1).max(20) })
export const bedQuery = z.object({ roomId: idStr.optional(), hostelId: idStr.optional(), status: z.enum(['occupied', 'vacant']).optional() })

// ───────────────────────────── allocations ─────────────────────────────

export const createAllocation = z.object({
  studentId: idStr,
  bedId: idStr,
  checkInDate: dateStr.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
})

export const vacateBody = z.object({
  checkOutDate: dateStr.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
})

export const transferBody = z.object({
  bedId: idStr,
  checkInDate: dateStr.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
})

export const allocationQuery = z.object({
  studentId: idStr.optional(),
  hostelId: idStr.optional(),
  roomId: idStr.optional(),
  bedId: idStr.optional(),
  status: z.enum(ALLOCATION_STATUSES).optional(),
})
