import type { FamilySummary } from '../data'
import { useOne } from './useAcademics'

// Phase 23 — parent experience: the combined "all my children" aggregation.
// See .agents/edunova/phase-23-parent-experience.md and server/src/modules/parents/ (built in parallel;
// live-verified against the real router once it landed — see the Family Overview screen for the consumer).

/** `GET /parents/me/family-summary` — parent-only; 403 for any other role. One row per ward the caller
 * has as a guardian, aggregating attendance/homework/fees/pace via existing per-domain logic server-side. */
export function useFamilySummary(enabled = true) {
  return useOne<FamilySummary>(enabled ? '/parents/me/family-summary' : null)
}
