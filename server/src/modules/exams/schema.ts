import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

// ── item 1: seating plans ──

export const createSeatingPlan = z.object({
  assessmentIds: z.array(idStr).min(1),
  date: dateStr,
  roomId: idStr,
})

// ── item 2: invigilation ──

export const autoAssignInvigilation = z.object({
  assessmentIds: z.array(idStr).min(1),
  date: dateStr,
})

export const createInvigilationDuty = z.object({
  assessmentId: idStr,
  roomId: idStr,
  teacherId: idStr,
  date: dateStr,
})

export const patchInvigilationDuty = z.object({
  roomId: idStr.optional(),
  teacherId: idStr.optional(),
  date: dateStr.optional(),
  status: z.enum(['Assigned', 'Confirmed', 'Completed']).optional(),
})

export const invigilationQuery = z.object({
  date: dateStr.optional(),
  teacherId: idStr.optional(),
  assessmentId: idStr.optional(),
})

// ── item 3: hall ticket ──

export const hallTicketQuery = z.object({ termId: idStr })

// ── item 4: board-exam readiness ──

export const boardReadinessQuery = z.object({ classId: idStr })
