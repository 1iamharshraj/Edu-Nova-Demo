import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const HIGHLIGHT_AUDIENCES = ['School', 'Class'] as const

export const createHighlight = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(2000),
  thumbnailFileId: idStr.optional(),
  audience: z.enum(HIGHLIGHT_AUDIENCES),
  classId: idStr.optional(),
  publishedAt: z.string().datetime().optional(),
}).refine(v => v.audience !== 'Class' || !!v.classId, { message: 'classId is required for Class audience', path: ['classId'] })

export const patchHighlight = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  url: z.string().trim().url().max(2000).optional(),
  thumbnailFileId: idStr.nullable().optional(),
  audience: z.enum(HIGHLIGHT_AUDIENCES).optional(),
  classId: idStr.nullable().optional(),
  publishedAt: z.string().datetime().optional(),
})
