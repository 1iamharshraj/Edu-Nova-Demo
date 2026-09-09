import { qs, useList, useOne } from './useAcademics'
import type { HouseLeaderboardRow, HousePointsRec, HousePointsSourceType, StudentPortfolio } from '../data'

// Data hooks for Phase 27: inter-house points leaderboard + student digital portfolio.
// Components live in src/portal/modules/culture.tsx. See .agents/edunova/phase-27-culture-engagement.md
// and server/src/modules/culture/{router,service,schema}.ts.

export const HOUSE_POINTS_SOURCE_TYPES: HousePointsSourceType[] = ['Sports', 'Academic', 'Discipline', 'Event', 'Manual']

/** `GET /culture/house-points/leaderboard?termId=` — every house, ranked by summed points. Open to everyone. */
export function useHouseLeaderboard(termId?: string, enabled = true) {
  return useList<HouseLeaderboardRow>(enabled ? `/culture/house-points/leaderboard${qs({ termId })}` : null)
}

/** `GET /culture/house-points?houseActivityId=` — the itemized ledger for one house (transparency). */
export function useHousePointsLedger(houseActivityId?: string, enabled = true) {
  return useList<HousePointsRec>(enabled && houseActivityId ? `/culture/house-points${qs({ houseActivityId })}` : null)
}

/** `GET /culture/portfolio/:studentId` — self/guardian, class teacher, staff, admin. */
export function usePortfolio(studentId?: string, enabled = true) {
  return useOne<StudentPortfolio>(enabled && studentId ? `/culture/portfolio/${encodeURIComponent(studentId)}` : null)
}
