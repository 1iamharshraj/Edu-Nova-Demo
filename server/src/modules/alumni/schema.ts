import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

// See phase-13-alumni.md.
export const RSVP_STATUSES = ['Interested', 'Going', 'Declined'] as const

// ---- alumni profiles ----

export const createProfile = z.object({
  studentUserId: idStr.nullable().optional(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  graduationYear: z.number().int().min(1950).max(2100),
  lastClassLabel: z.string().trim().max(80).nullable().optional(),
  currentOccupation: z.string().trim().max(160).nullable().optional(),
  currentOrganization: z.string().trim().max(160).nullable().optional(),
  currentCity: z.string().trim().max(120).nullable().optional(),
  linkedInUrl: z.string().trim().url().max(300).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export const patchProfile = createProfile.omit({ studentUserId: true }).partial()

export const profileQuery = z.object({
  graduationYear: z.coerce.number().int().optional(),
  q: z.string().trim().max(120).optional(),
})

// ---- student -> alumnus conversion ----

export const convertStudentBody = z.object({
  studentId: idStr,
  graduationYear: z.number().int().min(1950).max(2100).optional(),
  currentOccupation: z.string().trim().max(160).optional(),
  currentOrganization: z.string().trim().max(160).optional(),
  currentCity: z.string().trim().max(120).optional(),
  linkedInUrl: z.string().trim().url().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
  // Default true: end the student's active Enrollment (status -> 'graduated') as part of conversion.
  // Pass false when the enrollment was already ended elsewhere (e.g. the TC-approval integration hook
  // in applications/service.ts, which has already set it to 'transferred').
  endEnrollment: z.boolean().optional(),
})

// ---- events ----

export const createEvent = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  date: dateStr,
  location: z.string().trim().max(200).nullable().optional(),
})

export const patchEvent = createEvent.partial()

// ---- rsvp (staff-recorded on an alumnus's behalf) ----

export const rsvpBody = z.object({
  alumniId: idStr,
  status: z.enum(RSVP_STATUSES),
})

// ---- donations (manual record-keeping, not a payment gateway) ----

export const createDonation = z.object({
  alumniId: idStr,
  amount: z.number().positive(),
  purpose: z.string().trim().max(200).nullable().optional(),
  donatedAt: dateStr.optional(),
  note: z.string().trim().max(2000).nullable().optional(),
})

export const patchDonation = createDonation.omit({ alumniId: true }).partial()

export const donationQuery = z.object({ alumniId: idStr.optional() })
