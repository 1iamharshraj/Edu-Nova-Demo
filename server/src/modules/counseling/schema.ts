import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

// See phase-22-campus-safety.md → item 3.

export const CATEGORIES = ['Bullying', 'Safety', 'Wellbeing', 'Other'] as const
export const REPORT_STATUSES = ['New', 'Reviewing', 'Resolved'] as const

export const createCounselingRecord = z.object({
  studentId: idStr,
  sessionDate: dateStr,
  notes: z.string().trim().min(1).max(8000),
  category: z.string().trim().max(120).optional(),
  followUpNeeded: z.boolean().optional(),
})

export const patchCounselingRecord = z.object({
  sessionDate: dateStr.optional(),
  notes: z.string().trim().min(1).max(8000).optional(),
  category: z.string().trim().max(120).nullable().optional(),
  followUpNeeded: z.boolean().optional(),
})

export const counselingQuery = z.object({ studentId: idStr.optional() })

export const counselingSettingsBody = z.object({ oversightEnabled: z.boolean() })

// No identity fields whatsoever — see service.ts#createAnonymousReport.
export const createAnonymousReport = z.object({
  category: z.enum(CATEGORIES),
  description: z.string().trim().min(1).max(4000),
})

export const patchAnonymousReport = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  resolutionNotes: z.string().trim().max(4000).nullable().optional(),
})

export const anonymousReportQuery = z.object({ status: z.enum(REPORT_STATUSES).optional() })
