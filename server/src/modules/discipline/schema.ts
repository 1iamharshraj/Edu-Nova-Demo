import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const DISCIPLINARY_STATUSES = ['Reported', 'Scheduled', 'Heard', 'Decision', 'Action Taken', 'Appealed', 'Closed'] as const

export const createCase = z.object({
  studentId: idStr,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(8000),
  witnesses: z.string().trim().max(500).optional(),
  fileIds: z.array(idStr).max(20).optional(),
  hearingDate: dateStr.optional(),
})

export const patchCase = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(8000).optional(),
  witnesses: z.string().trim().max(500).optional(),
  fileIds: z.array(idStr).max(20).optional(),
  hearingDate: dateStr.optional(),
  decision: z.string().trim().max(4000).optional(),
  actionTaken: z.string().trim().max(200).optional(),
  appeal: z.string().trim().max(4000).optional(),
  relatedPeople: z.string().trim().max(500).optional(),
})

export const setStatus = z.object({
  status: z.enum(DISCIPLINARY_STATUSES),
  note: z.string().trim().max(2000).optional(),
})

export const addNote = z.object({ body: z.string().trim().min(1).max(4000) })

export const disciplineQuery = z.object({ studentId: idStr.optional(), classId: idStr.optional() })
