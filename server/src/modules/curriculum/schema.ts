import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const curriculumKind = z.enum(['core', 'elective', 'language'])

export const createCurriculum = z.object({
  boardId: idStr,
  gradeId: idStr,
  streamId: idStr.nullable().optional(),
  subjectId: idStr,
  kind: curriculumKind.default('core'),
  textbook: z.string().nullable().optional(),
  syllabusRef: z.string().nullable().optional(),
})

// Only the descriptive fields are editable — moving a row between board/grade/stream/subject is delete + create.
export const patchCurriculum = z.object({
  kind: curriculumKind.optional(),
  textbook: z.string().nullable().optional(),
  syllabusRef: z.string().nullable().optional(),
})

export const curriculumQuery = z.object({
  boardId: idStr.optional(),
  gradeId: idStr.optional(),
  streamId: idStr.optional(),
})
