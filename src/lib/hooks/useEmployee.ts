import { qs, useList, useOne } from './useAcademics'
import type {
  EmployeeDocumentRec, EmploymentHistoryEntry, PerformanceReviewRec, ReviewStatus, StaffConductCategory, StaffConductRecord, StaffConductStatus,
} from '../data'

// Data hooks and pure helpers for Phase 11: reporting line, performance reviews, employment history,
// staff conduct records, employee documents/ID card. Components live in src/portal/modules/employee.tsx
// (plus small additions to office.tsx's PeopleMod and profile.tsx). See .agents/edunova/phase-11-employee-management.md
//
// The server side of this phase was being built concurrently — endpoint paths below follow the spec's
// described shapes (`GET /employment-history/:userId`, `/reviews`, `/staff-conduct`, `/users/:id/documents`,
// `/users/:id/id-card.pdf`) and may need adjusting once verified against the real running server.

/* ── employment history (A4) ───────────────────────────────── */

/** `GET /employment-history/:userId` — self, HR/admin/superadmin, or (per A2) that user's manager. Newest-first. */
export function useEmploymentHistory(userId?: string, enabled = true) {
  return useList<EmploymentHistoryEntry>(enabled && userId ? `/employment-history/${encodeURIComponent(userId)}` : null)
}

/* ── performance reviews (A3) ──────────────────────────────── */

export const REVIEW_STATUSES: ReviewStatus[] = ['Draft', 'Shared', 'Acknowledged']
export const reviewTone = (s: ReviewStatus): 'green' | 'amber' | 'slate' => (s === 'Acknowledged' ? 'green' : s === 'Shared' ? 'amber' : 'slate')
/** Index 1-5 → human label for `overallRating`. Shared by employee.tsx and the routed
 * `/portal/reviews/:id` page (src/pages/portal/ReviewDetail.tsx). */
export const RATING_LABEL = ['', 'Needs improvement', 'Below expectations', 'Meets expectations', 'Exceeds expectations', 'Outstanding']

/** `GET /reviews?employeeId=` — self sees own; HR/admin sees anyone; a manager sees their direct reports'. */
export function useReviews(employeeId?: string, enabled = true) {
  return useList<PerformanceReviewRec>(enabled ? `/reviews${qs({ employeeId })}` : null)
}

/** `GET /reviews/:id` — single review, used by the routed `/portal/reviews/:id` detail page
 * (see .agents/edunova/ui-architecture-fix.md Phase D). Same visibility rule as the list endpoint. */
export function useReview(id?: string, enabled = true) {
  return useOne<PerformanceReviewRec>(enabled && id ? `/reviews/${encodeURIComponent(id)}` : null)
}

/* ── staff conduct (A5 — admin/superadmin only) ────────────── */

export const STAFF_CONDUCT_CATEGORIES: StaffConductCategory[] = ['Conduct', 'Performance', 'Policy', 'Attendance', 'Other']
export const staffConductTone = (s: StaffConductStatus): 'amber' | 'sky' | 'green' => (s === 'Resolved' ? 'green' : s === 'UnderReview' ? 'sky' : 'amber')

/** `GET /staff-conduct?employeeId=` — admin/superadmin only. */
export function useStaffConduct(employeeId?: string, enabled = true) {
  return useList<StaffConductRecord>(enabled ? `/staff-conduct${qs({ employeeId })}` : null)
}

/* ── employee documents (A6) ───────────────────────────────── */

/** `GET /users/:id/documents` — HR/admin only. */
export function useEmployeeDocuments(userId?: string, enabled = true) {
  return useList<EmployeeDocumentRec>(enabled && userId ? `/users/${encodeURIComponent(userId)}/documents` : null)
}
