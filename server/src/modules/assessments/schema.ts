import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const createAssessment = z.object({
  classSubjectId: idStr,
  termId: idStr,
  name: z.string().trim().min(1).max(120),
  maxMarks: z.number().positive().max(1000),
  weight: z.number().positive().max(100).optional(),
  date: dateStr.nullable().optional(),
})

export const patchAssessment = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  maxMarks: z.number().positive().max(1000).optional(),
  weight: z.number().positive().max(100).optional(),
  date: dateStr.nullable().optional(),
})

export const markInput = z.object({
  studentId: idStr,
  score: z.number().min(0),
  remark: z.string().max(500).nullable().optional(),
})
export const putMarks = z.object({ marks: z.array(markInput) })

export const listQuery = z.object({
  termId: idStr,
  classSubjectId: idStr.optional(),
  classId: idStr.optional(),
}).refine(q => !!q.classSubjectId || !!q.classId, { message: 'Provide classSubjectId or classId' })

export const band = z.object({
  min: z.number().min(0).max(100),
  grade: z.string().trim().min(1).max(10),
  points: z.number().min(0).max(10).optional(),
})
// Bands must be strictly decreasing by `min` once sorted (no two bands share a threshold).
const bandsSchema = z.array(band).min(1).superRefine((bands, ctx) => {
  const sorted = bands.slice().sort((a, b) => b.min - a.min)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].min >= sorted[i - 1].min) ctx.addIssue({ code: 'custom', message: 'Band thresholds must be strictly decreasing', path: [i, 'min'] })
  }
})

export const createGradeScale = z.object({
  name: z.string().trim().min(1).max(80),
  boardId: idStr.nullable().optional(),
  bands: bandsSchema,
})
export const patchGradeScale = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  boardId: idStr.nullable().optional(),
  bands: bandsSchema.optional(),
})

export const reportCardQuery = z.object({ studentId: idStr, termId: idStr })
export const ranksQuery = z.object({ classId: idStr, termId: idStr })

// Phase 20 item 3 — the one teacher-editable overall remark per (student, term); see
// schema.prisma#Enrollment.remarks and reports.ts#setReportCardRemark.
export const reportCardRemarkBody = z.object({
  studentId: idStr,
  termId: idStr,
  remark: z.string().trim().min(1).max(1000),
})
