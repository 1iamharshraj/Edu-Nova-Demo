import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const HEALTH_KINDS = ['Vaccination', 'Allergy', 'Condition', 'Checkup', 'Other'] as const

export const createHealthRecord = z.object({
  studentId: idStr,
  kind: z.enum(HEALTH_KINDS),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(4000),
  date: dateStr,
  fileIds: z.array(idStr).max(20).optional(),
})

export const patchHealthRecord = z.object({
  kind: z.enum(HEALTH_KINDS).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().trim().min(1).max(4000).optional(),
  date: dateStr.optional(),
  fileIds: z.array(idStr).max(20).optional(),
})

export const healthQuery = z.object({ studentId: idStr.optional() })

// ── Phase 22 item 4: medication schedule + administration log. See phase-22-campus-safety.md → item 4.
// A schedule + an administration log is a different concept from a one-off HealthRecord entry (hence new
// models), but RBAC reuses modules/health's existing canViewHealth scope verbatim — see service.ts.

export const createMedicationSchedule = z.object({
  studentId: idStr,
  medicationName: z.string().trim().min(1).max(200),
  dosage: z.string().trim().min(1).max(200),
  times: z.array(z.string().trim().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM')).min(1).max(12),
  startDate: dateStr,
  endDate: dateStr.optional(),
  notes: z.string().trim().max(2000).optional(),
})

export const patchMedicationSchedule = z.object({
  medicationName: z.string().trim().min(1).max(200).optional(),
  dosage: z.string().trim().min(1).max(200).optional(),
  times: z.array(z.string().trim().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM')).min(1).max(12).optional(),
  startDate: dateStr.optional(),
  endDate: dateStr.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export const medicationScheduleQuery = z.object({ studentId: idStr.optional() })

export const createMedicationLog = z.object({
  scheduleId: idStr,
  administeredAt: z.string().datetime().optional(),
  notes: z.string().trim().max(1000).optional(),
})

export const medicationLogQuery = z.object({ scheduleId: idStr.optional() })
