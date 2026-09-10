import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const proficiency = z.enum(['PRIMARY', 'SECONDARY'])

export const createTeacherQualification = z.object({
  teacherId: idStr,
  subjectId: idStr,
  gradeRangeMin: z.number().int().min(1),
  gradeRangeMax: z.number().int().min(1),
  proficiency,
  isPrimarySubject: z.boolean().optional(),
}).refine(v => v.gradeRangeMin <= v.gradeRangeMax, { message: 'gradeRangeMin must be <= gradeRangeMax', path: ['gradeRangeMin'] })

export const patchTeacherQualification = z.object({
  gradeRangeMin: z.number().int().min(1).optional(),
  gradeRangeMax: z.number().int().min(1).optional(),
  proficiency: proficiency.optional(),
  isPrimarySubject: z.boolean().optional(),
})
