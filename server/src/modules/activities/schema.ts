import { z } from 'zod'

export const ACTIVITY_KINDS = ['club', 'house', 'exc', 'event', 'faculty'] as const
export const ACTIVITY_ROLES = ['student', 'parent', 'teacher', 'staff', 'admin'] as const

export const createActivity = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4000),
  capacity: z.number().int().min(1).optional(),
  opensAt: z.string().datetime().optional(),
  closesAt: z.string().datetime().optional(),
  forRoles: z.array(z.enum(ACTIVITY_ROLES)).min(1),
})

export const patchActivity = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(4000).optional(),
  capacity: z.number().int().min(1).nullable().optional(),
  opensAt: z.string().datetime().nullable().optional(),
  closesAt: z.string().datetime().nullable().optional(),
  forRoles: z.array(z.enum(ACTIVITY_ROLES)).min(1).optional(),
})

export const activitiesQuery = z.object({ kind: z.enum(ACTIVITY_KINDS).optional() })
