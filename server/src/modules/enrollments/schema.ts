import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const enrollmentStatus = z.enum(['active', 'transferred', 'graduated'])

export const createEnrollment = z.object({
  studentId: idStr,
  classId: idStr,
  rollNo: z.string().nullable().optional(),
})

export const patchEnrollment = z.object({
  classId: idStr.optional(),
  rollNo: z.string().nullable().optional(),
  status: enrollmentStatus.optional(),
})
