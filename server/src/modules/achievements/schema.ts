import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const ACHIEVEMENT_CATEGORIES = ['Academic', 'Sports', 'Arts', 'Service', 'Other'] as const

export const createAchievement = z.object({
  userId: idStr.optional(),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(4000),
  date: dateStr,
  category: z.enum(ACHIEVEMENT_CATEGORIES),
  fileIds: z.array(idStr).max(20).optional(),
})

export const patchAchievement = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().trim().min(1).max(4000).optional(),
  date: dateStr.optional(),
  category: z.enum(ACHIEVEMENT_CATEGORIES).optional(),
  fileIds: z.array(idStr).max(20).optional(),
})

export const achievementsQuery = z.object({ userId: idStr.optional() })
