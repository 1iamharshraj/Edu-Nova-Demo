import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

// See phase-22-campus-safety.md → items 1-2.

export const PICKUP_TYPES = ['Regular', 'EarlyOrUnlisted'] as const

// ── Item 1: authorized pickup people + pickup events ──

export const createPickupPerson = z.object({
  studentId: idStr,
  name: z.string().trim().min(1).max(120),
  relation: z.string().trim().min(1).max(60),
  phone: z.string().trim().min(1).max(40),
  photoFileId: idStr.optional(),
})

export const patchPickupPerson = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  relation: z.string().trim().min(1).max(60).optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  photoFileId: idStr.nullable().optional(),
  active: z.boolean().optional(),
})

export const pickupPersonQuery = z.object({ studentId: idStr.optional() })

export const createPickupEvent = z.object({
  studentId: idStr,
  pickedUpByName: z.string().trim().min(1).max(120),
  pickedUpByRelation: z.string().trim().min(1).max(60),
  pickupType: z.enum(PICKUP_TYPES).optional(),
})

export const pickupEventQuery = z.object({
  studentId: idStr.optional(),
  date: dateStr.optional(),
  status: z.enum(['PendingOtp', 'Completed', 'Flagged']).optional(),
})

export const verifyOtpBody = z.object({ code: z.string().trim().min(4).max(10) })

// ── Item 2: visitors ──

export const createVisitor = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(1).max(40),
  purpose: z.string().trim().min(1).max(500),
  hostUserId: idStr.optional(),
  badgeNo: z.string().trim().max(40).optional(),
})

export const visitorQuery = z.object({
  date: dateStr.optional(),
  onCampus: z.enum(['true', 'false']).optional(),
})
