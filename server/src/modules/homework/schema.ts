import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const createHomework = z.object({
  classSubjectId: idStr,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  dueDate: dateStr,
  attachments: z.array(idStr).max(20).optional(),
})

export const patchHomework = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  dueDate: dateStr.optional(),
  attachments: z.array(idStr).max(20).optional(),
})

export const listQuery = z.object({ classId: idStr, termId: idStr.optional() })

export const submitBody = z.object({
  files: z.array(idStr).max(20).optional(),
  note: z.string().max(2000).nullable().optional(),
})

export const gradeBody = z.object({
  grade: z.string().trim().max(20).nullable().optional(),
  feedback: z.string().max(2000).nullable().optional(),
  status: z.enum(['Submitted', 'Late', 'Graded', 'Returned']).optional(),
})
