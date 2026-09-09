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

// ───────────────────────────── Phase 24: outpasses ─────────────────────────────
// See phase-24-boarding-hostel-extensions.md → item 1. `Overdue` is a computed read-time status (never
// accepted as input) — see service.ts.
export const OUTPASS_STATUSES = ['Pending', 'Approved', 'Declined', 'Departed', 'Returned', 'Overdue'] as const

export const createOutpass = z.object({
  studentId: idStr,
  requestedDepartureAt: z.string().datetime(),
  expectedReturnAt: z.string().datetime(),
  reason: z.string().trim().min(1).max(1000),
  destination: z.string().trim().max(300).nullable().optional(),
})

export const decideOutpass = z.object({ note: z.string().trim().max(1000).optional() })

export const outpassQuery = z.object({
  studentId: idStr.optional(),
  hostelId: idStr.optional(),
  status: z.enum(OUTPASS_STATUSES).optional(),
})

// ───────────────────────────── Phase 24: roll-call ─────────────────────────────

export const createRollCall = z.object({
  hostelId: idStr,
  date: dateStr,
})

export const rollCallEntryInput = z.object({
  allocationId: idStr,
  present: z.boolean(),
  notes: z.string().trim().max(500).nullable().optional(),
})

export const patchRollCallEntries = z.object({ entries: z.array(rollCallEntryInput).min(1) })

export const rollCallQuery = z.object({
  hostelId: idStr.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
})

// ───────────────────────────── Phase 24: mess menu + meal feedback ─────────────────────────────

export const MEAL_TYPES = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'] as const

export const createMenu = z.object({
  hostelId: idStr,
  date: dateStr,
  mealType: z.enum(MEAL_TYPES),
  items: z.array(z.string().trim().min(1).max(200)).max(50),
})
export const patchMenu = createMenu.omit({ hostelId: true, date: true, mealType: true }).partial()

export const menuQuery = z.object({
  hostelId: idStr.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  mealType: z.enum(MEAL_TYPES).optional(),
})

export const createFeedback = z.object({
  menuId: idStr,
  studentId: idStr,
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).nullable().optional(),
})

export const feedbackQuery = z.object({
  menuId: idStr.optional(),
  studentId: idStr.optional(),
  hostelId: idStr.optional(),
})
