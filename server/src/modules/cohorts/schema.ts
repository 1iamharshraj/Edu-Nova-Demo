import { z } from 'zod'
import { idStr } from '../../lib/validate'

// SECTION is reserved for the auto-generated 1:1 cohort (roadmap D2) — manual creation only offers the
// cross-cutting types. See phase-t1-timetable-foundations.md §1.
export const manualCohortType = z.enum(['GRADE', 'CROSS_SECTION', 'TRACK', 'ELECTIVE'])

export const createCohort = z.object({
  name: z.string().min(1),
  academicYearId: idStr,
  gradeId: idStr.nullable().optional(),
  type: manualCohortType,
  classIds: z.array(idStr).min(1),
})

// Membership (classIds) and academicYearId are immutable via PATCH for auto-generated cohorts (enforced
// in the service, not here) — name/gradeId can still be relabeled.
export const patchCohort = z.object({
  name: z.string().min(1).optional(),
  gradeId: idStr.nullable().optional(),
  classIds: z.array(idStr).min(1).optional(),
})
