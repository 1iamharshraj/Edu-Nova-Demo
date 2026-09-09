import { qs, useList, useOne } from './useAcademics'
import type {
  BoardReadinessResponse, ExamSeatingPlan, InvigilationDuty, InvigilationDutyStatus,
} from '../data'

// Data hooks and pure helpers for Phase 25: exam seating plans, invigilation rosters, hall tickets and
// board-exam readiness. Components live in src/portal/modules/exams.tsx (+ the existing Duties screen in
// hr.tsx for "My Invigilation Duties", Board Registration in office.tsx for the readiness tab, and
// studentReport.tsx for the hall-ticket download button). See .agents/edunova/phase-25-exam-operations.md

/* ── seating plans ──────────────────────────────────────── */
// No list endpoint exists server-side (server/src/modules/exams/router.ts only exposes POST and GET /:id) —
// the frontend keeps freshly-generated plans in local component state instead of browsing history.

/** `/exams/seating-plans/:id` — the generated chart, with seats. */
export function useSeatingPlan(id?: string) {
  return useOne<ExamSeatingPlan>(id ? `/exams/seating-plans/${encodeURIComponent(id)}` : null)
}

/* ── invigilation ───────────────────────────────────────── */

export const INVIGILATION_STATUSES: InvigilationDutyStatus[] = ['Assigned', 'Confirmed', 'Completed']
export const invigilationTone = (s: InvigilationDutyStatus): 'green' | 'amber' | 'sky' | 'slate' =>
  s === 'Completed' ? 'green' : s === 'Confirmed' ? 'sky' : 'amber'

/** `/exams/invigilation?teacherId&date&assessmentId` — omit `teacherId` for every duty the caller may manage
 * (staff/admin); a non-staff caller is always scoped to their own duties server-side regardless of `teacherId`. */
export function useInvigilationDuties(params: { teacherId?: string; date?: string; assessmentId?: string } = {}, enabled = true) {
  return useList<InvigilationDuty>(enabled ? `/exams/invigilation${qs(params)}` : null)
}

/* ── board-exam readiness ──────────────────────────────────── */

/** `/exams/board-readiness?classId=` — one response per class, with one row per student. */
export function useBoardReadiness(classId?: string, enabled = true) {
  return useOne<BoardReadinessResponse>(enabled && classId ? `/exams/board-readiness${qs({ classId })}` : null)
}
