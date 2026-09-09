import { z } from 'zod'
import { idStr } from '../../lib/validate'

// See phase-27-culture-engagement.md item 1. sourceType is a loose free-text tag on the ledger entry
// (Sports win, Academic quiz, Discipline demerit, School event, or a plain Manual award) — not a
// constraint on the point value's sign, since a Discipline entry may legitimately deduct points.
export const HOUSE_POINTS_SOURCE_TYPES = ['Sports', 'Academic', 'Discipline', 'Event', 'Manual'] as const

export const createHousePoints = z.object({
  houseActivityId: idStr,
  points: z.number().int().min(-1000).max(1000).refine(v => v !== 0, { message: 'points must not be zero' }),
  reason: z.string().trim().min(1).max(500),
  sourceType: z.enum(HOUSE_POINTS_SOURCE_TYPES).optional(),
  sourceRefId: idStr.optional(),
})

export const leaderboardQuery = z.object({ termId: idStr.optional() })

export const ledgerQuery = z.object({ houseActivityId: idStr })
