import type { Scholarship, ScholarshipAward, ScholarshipAwardStatus, ScholarshipDiscountType, ScholarshipType } from '../data'
import { qs, useList } from './useAcademics'

// Data hooks for Phase 21 item 4 — the formal scholarship program: a catalog of `Scholarship`s (admin/
// superadmin define) and `ScholarshipAward`s (staff/admin/superadmin propose, admin/superadmin approve or
// reject — approval retroactively discounts the student's fee invoices for the year, see
// server/src/modules/scholarships/service.ts#approveAward). Components live in
// src/portal/modules/scholarships.tsx. Mutations (create/patch/delete/propose/approve/reject) are plain
// `api.post`/`api.patch`/`api.del` calls made directly in the component, same convention as
// accounting.tsx's Chart of Accounts screen — no dedicated hook wraps a one-shot mutation.
// See .agents/edunova/phase-21-financial-intelligence.md item 4.

export const SCHOLARSHIP_TYPES: ScholarshipType[] = ['MeritBased', 'NeedBased', 'SiblingDiscount', 'StaffWard', 'Other']
export const DISCOUNT_TYPES: ScholarshipDiscountType[] = ['Percentage', 'FixedAmount']
export const AWARD_STATUSES: ScholarshipAwardStatus[] = ['Pending', 'Approved', 'Rejected']

export const scholarshipTypeLabel = (t: ScholarshipType): string => {
  switch (t) {
    case 'MeritBased': return 'Merit-based'
    case 'NeedBased': return 'Need-based'
    case 'SiblingDiscount': return 'Sibling discount'
    case 'StaffWard': return 'Staff ward'
    case 'Other': return 'Other'
  }
}

export const awardStatusTone = (s: ScholarshipAwardStatus): 'green' | 'amber' | 'rose' =>
  s === 'Approved' ? 'green' : s === 'Pending' ? 'amber' : 'rose'

/** Formats a scholarship's discount for display, e.g. "25%" or "₹5,000". */
export const discountLabel = (s: Pick<Scholarship, 'discountType' | 'discountValue'>) =>
  s.discountType === 'Percentage' ? `${s.discountValue}%` : `₹${s.discountValue.toLocaleString('en-IN')}`

/* ── scholarships (programs) ──────────────────────────────
 * `GET /scholarships?active=` — any staff/admin/superadmin (propose-eligible) may list the catalog to
 * propose an award against one; only admin/superadmin may create/edit/delete a scholarship itself. */
export function useScholarships(params: { active?: boolean } = {}, enabled = true) {
  return useList<Scholarship>(enabled ? `/scholarships${qs({ active: params.active === undefined ? undefined : String(params.active) })}` : null)
}

/* ── awards ────────────────────────────────────────────────
 * `GET /scholarships/awards?status=&studentId=&academicYearId=&scholarshipId=` — staff/admin/superadmin
 * see every award; a parent/student must pass `studentId` and only ever sees their own/their ward's. */
export function useScholarshipAwards(
  params: { status?: ScholarshipAwardStatus; studentId?: string; academicYearId?: string; scholarshipId?: string } = {},
  enabled = true,
) {
  return useList<ScholarshipAward>(enabled ? `/scholarships/awards${qs(params)}` : null)
}
