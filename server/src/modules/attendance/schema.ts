import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const recordStatus = z.enum(['P', 'A', 'L', 'E', 'H'])
export const staffStatus = z.enum(['P', 'A', 'L', 'H'])

export const recordInput = z.object({
  studentId: idStr,
  status: recordStatus,
  note: z.string().max(500).nullable().optional(),
})

export const createSession = z.object({
  classId: idStr,
  date: dateStr,
  periodIdx: z.number().int().min(0).nullable().optional(),
  records: z.array(recordInput),
})

export const patchRecords = z.object({ records: z.array(recordInput).min(1) })

export const sessionsQuery = z.object({
  classId: idStr,
  from: dateStr.optional(),
  to: dateStr.optional(),
})

export const summaryQuery = z.object({
  termId: idStr,
  studentId: idStr.optional(),
  classId: idStr.optional(),
}).refine(q => !!q.studentId !== !!q.classId, { message: 'Provide exactly one of studentId or classId' })

export const staffQuery = z.object({ date: dateStr.optional() })
export const staffBody = z.object({ userId: idStr, date: dateStr, status: staffStatus })
export const staffSummaryQuery = z.object({ userId: idStr, from: dateStr.optional(), to: dateStr.optional() })
