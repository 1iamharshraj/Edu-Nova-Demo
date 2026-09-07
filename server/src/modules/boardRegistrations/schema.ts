import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const BOARD_REG_STATUSES = ['Draft', 'Pending', 'Validated', 'SentToBoard'] as const

export const createBoardRegistration = z.object({
  studentId: idStr,
  boardId: idStr.optional(),
  academicYearId: idStr.optional(),
  registrationNo: z.string().trim().max(60).nullable().optional(),
  rollNo: z.string().trim().max(40).nullable().optional(),
  nameOnCertificate: z.string().trim().min(1).max(120).optional(),
  dob: dateStr.nullable().optional(),
  affiliationNo: z.string().trim().max(60).nullable().optional(),
  status: z.enum(['Draft', 'Pending']).optional(),
  mismatchNote: z.string().max(2000).nullable().optional(),
})

export const patchBoardRegistration = createBoardRegistration.omit({ studentId: true, academicYearId: true }).partial()

export const listQuery = z.object({
  studentId: idStr.optional(),
  classId: idStr.optional(),
  status: z.enum(BOARD_REG_STATUSES).optional(),
})

export const prefillBody = z.object({ studentId: idStr, academicYearId: idStr.optional() })
export const validateBody = z.object({ mismatchNote: z.string().max(2000).nullable().optional() })
export const marksheetQuery = z.object({ termId: idStr })
