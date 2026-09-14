import { qs, useList } from './useAcademics'
import type { AnonymousReport, AnonymousReportCategory, AnonymousReportStatus, CounselingCategory, CounselingRecord } from '../data'

// Data hooks for Phase 22 item 3: confidential counseling records + anonymous reporting.
// Components live in src/portal/modules/counseling.tsx. See .agents/edunova/phase-22-campus-safety.md
//
// IMPORTANT: CounselingRecord visibility is server-enforced to the authoring counselor (and principal/
// superadmin only if the school has explicitly designated a counselor-oversight role). The frontend never
// tries to relax that — a non-counselor account hitting these endpoints should just get a 403.

export const COUNSELING_CATEGORIES: CounselingCategory[] = ['Academic', 'Behavioral', 'Emotional', 'Family', 'Other']
export const ANON_REPORT_CATEGORIES: AnonymousReportCategory[] = ['Bullying', 'Safety', 'Wellbeing', 'Other']
export const ANON_REPORT_STATUSES: AnonymousReportStatus[] = ['New', 'Reviewing', 'Resolved']

export const anonReportTone = (s: AnonymousReportStatus): 'rose' | 'amber' | 'green' =>
  s === 'New' ? 'rose' : s === 'Reviewing' ? 'amber' : 'green'

/** `/safety/counseling-records?studentId=` — counselor-only (their own records; principal/superadmin only
 *  if the school designates a counselor-oversight role — server's call, not the frontend's). */
export function useCounselingRecords(studentId?: string, enabled = true) {
  return useList<CounselingRecord>(enabled ? `/safety/counseling-records${qs({ studentId })}` : null)
}

/** `/safety/anonymous-reports?status=` — GET/PATCH counselor + principal/superadmin only. */
export function useAnonymousReports(status?: AnonymousReportStatus | '', enabled = true) {
  return useList<AnonymousReport>(enabled ? `/safety/anonymous-reports${qs({ status: status || undefined })}` : null)
}
