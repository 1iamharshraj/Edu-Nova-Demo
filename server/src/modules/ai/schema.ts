import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const askBody = z.object({
  question: z.string().trim().min(1).max(4000),
  subjectId: idStr.optional(),
})

// ═══════════════════════════ worksheets (item 2) ═══════════════════════════

export const worksheetDifficulty = z.enum(['easy', 'medium', 'hard'])

export const generateWorksheetBody = z.object({
  classSubjectId: idStr,
  chapterIds: z.array(idStr).min(1).max(30),
  questionCount: z.number().int().min(1).max(50).optional(),
  difficulty: worksheetDifficulty.optional(),
})

export const saveWorksheetBody = z.object({
  classSubjectId: idStr,
  chapterIds: z.array(idStr).min(1).max(30),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20000),
})

export const worksheetsQuery = z.object({ classSubjectId: idStr.optional() })

// ═══════════════════════════ report-card remarks (item 3) ═══════════════════════════

export const draftRemarkBody = z.object({
  studentId: idStr,
  termId: idStr,
})

// ═══════════════════════════ translate (item 4) ═══════════════════════════

export const translateTargetLanguage = z.enum(['Hindi', 'Tamil', 'Telugu', 'Kannada', 'Marathi', 'Bengali', 'Gujarati'])

export const translateBody = z.object({
  text: z.string().trim().min(1).max(4000),
  targetLanguage: translateTargetLanguage,
})
