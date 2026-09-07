import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const APPLICATION_KINDS = ['Admission', 'TC', 'Bonafide', 'Character'] as const
export const APPLICATION_STATUSES = ['Pending', 'Verified', 'Approved', 'Declined'] as const
export type ApplicationKind = (typeof APPLICATION_KINDS)[number]

export const guardianInfo = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().optional(),
  relation: z.string().trim().max(40).optional(),
})

// Admission: applicantName + guardian required, targetClassId required at approval time.
// TC / Bonafide / Character: studentId required (applicantName defaults to the student's name).
export const createApplication = z.object({
  kind: z.enum(APPLICATION_KINDS),
  applicantName: z.string().trim().min(1).max(120).optional(),
  dob: dateStr.nullable().optional(),
  gender: z.string().trim().max(20).nullable().optional(),
  guardian: guardianInfo.nullable().optional(),
  targetClassId: idStr.nullable().optional(),
  targetBoardId: idStr.nullable().optional(),
  studentId: idStr.optional(),
  documents: z.array(idStr).max(20).optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export const patchApplication = createApplication.omit({ kind: true, studentId: true }).partial()

export const listQuery = z.object({
  kind: z.enum(APPLICATION_KINDS).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
})

export const declineBody = z.object({ notes: z.string().max(2000).optional() })
