import { z } from 'zod'
import { idStr, dateStr } from '../../lib/validate'

// See phase-12-transport.md.

export const BOARDING_TYPES = ['Pickup', 'Drop', 'Both'] as const

// ───────────────────────────── routes ─────────────────────────────

export const createRoute = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
})
export const patchRoute = createRoute.partial()

// ───────────────────────────── stops ─────────────────────────────

export const createStop = z.object({
  routeId: idStr,
  name: z.string().trim().min(1).max(120),
  sequence: z.number().int().min(0),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  arrivalOffsetMin: z.number().int().min(0).nullable().optional(),
})
// routeId is fixed at creation — moving a stop to a different route is a delete+recreate, not a patch.
export const patchStop = createStop.omit({ routeId: true }).partial()
export const stopQuery = z.object({ routeId: idStr.optional() })

// ───────────────────────────── vehicles ─────────────────────────────

export const createVehicle = z.object({
  registrationNo: z.string().trim().min(1).max(30),
  capacity: z.number().int().positive(),
  routeId: idStr.nullable().optional(),
  driverName: z.string().trim().min(1).max(120),
  driverPhone: z.string().trim().min(1).max(30),
  conductorName: z.string().trim().max(120).nullable().optional(),
  conductorPhone: z.string().trim().max(30).nullable().optional(),
  // Optional link to an existing staff/teacher/admin User — see schema.prisma comment on Vehicle.driverUserId.
  driverUserId: idStr.nullable().optional(),
})
export const patchVehicle = createVehicle.partial()

// ───────────────────────────── assignments ─────────────────────────────

export const createAssignment = z.object({
  studentId: idStr,
  stopId: idStr,
  boardingType: z.enum(BOARDING_TYPES).default('Both'),
})
export const assignmentQuery = z.object({
  studentId: idStr.optional(),
  stopId: idStr.optional(),
  routeId: idStr.optional(),
})

// ───────────────────────────── location ping / read ─────────────────────────────

// See router.ts for the auth-gate rationale. tripDate defaults to "today" server-side when omitted.
export const pingBody = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  tripDate: dateStr.optional(),
})

export const myStopQuery = z.object({ studentId: idStr.optional() })
