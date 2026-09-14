import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { api, errorMessage } from '../api'
import type {
  AnalyticsSettings, HomeworkLoadResult, LostTimeReport, RiskLevel, StudentRiskSnapshot,
  SubstituteSuggestion, TeacherWorkloadOne, TeacherWorkloadReport,
} from '../data'
import { qs, useList, useOne } from './useAcademics'

// Thin wrapper hooks for Phase 19 (early warning & teaching analytics) — /api/analytics/*.
// See .agents/edunova/phase-19-early-warning-analytics.md and server/src/modules/analytics/{router,service,schema}.ts
// (built in parallel — live-verified against the real router/service once they landed; a few response shapes
// differ from the spec's plain description, noted per hook below).

/* ── 1. student risk snapshots ─────────────────────────────────────── */

/** `GET /analytics/risk-snapshots?classId=&riskLevel=&termId=` — class teachers get their own class only
 * (403 if they pass a classId they don't own; omitting classId returns every class they own), staff/admin
 * see any class. `classId` is required here since every screen using this picks one class at a time. */
export function useRiskSnapshots(params: { classId?: string; riskLevel?: RiskLevel; termId?: string }, enabled = true) {
  const path = enabled && params.classId ? `/analytics/risk-snapshots${qs(params)}` : null
  return useList<StudentRiskSnapshot>(path)
}

/** `POST /analytics/risk-snapshots/recompute` — `{ classId? }` (omit for whole-school); staff/admin only. */
export function useRiskRecompute() {
  const [busy, setBusy] = useState(false)
  const recompute = useCallback(async (body: { classId?: string; termId?: string } = {}) => {
    setBusy(true)
    try {
      const res = await api.post<{ items: StudentRiskSnapshot[] }>('/analytics/risk-snapshots/recompute', body)
      toast.success(`Risk scores recomputed for ${res.items.length} student${res.items.length === 1 ? '' : 's'}`)
      return res.items
    } catch (e) {
      toast.error(errorMessage(e))
      return null
    } finally { setBusy(false) }
  }, [])
  return { busy, recompute }
}

/* ── 2. lost instructional time report ─────────────────────────────── */

/** `GET /analytics/lost-time?termId=&groupBy=` — answers the report object directly (`{ termId, groupBy,
 * totals, items }`), not a bare list, so this goes through `useOne` rather than `useList`. */
export function useLostTimeReport(params: { termId?: string; groupBy: 'class' | 'subject' | 'teacher' }) {
  return useOne<LostTimeReport>(params.termId ? `/analytics/lost-time${qs(params)}` : null)
}

/* ── 3. teacher workload ───────────────────────────────────────────── */

/** `GET /analytics/teacher-workload?termId=` — the full school-wide report (used by nothing standalone yet
 * per the spec, but available for future use). */
export function useTeacherWorkload(termId?: string, enabled = true) {
  return useOne<TeacherWorkloadReport>(enabled && termId ? `/analytics/teacher-workload${qs({ termId })}` : null)
}

/** `GET /analytics/teacher-workload/:teacherId?termId=` — the lightweight single-teacher lookup the
 * Timetable Builder uses inline for its warning banner. */
export function useTeacherWorkloadOne(teacherId?: string, termId?: string, enabled = true) {
  return useOne<TeacherWorkloadOne>(enabled && teacherId && termId ? `/analytics/teacher-workload/${encodeURIComponent(teacherId)}${qs({ termId })}` : null)
}

/** `GET /analytics/settings` (`{ item }`) — the school's high-load threshold; `PATCH` is admin/superadmin only. */
export function useAnalyticsSettings(enabled = true) {
  return useOne<AnalyticsSettings>(enabled ? '/analytics/settings' : null)
}

/* ── 4. homework load ──────────────────────────────────────────────── */

export function useHomeworkLoad(classId?: string, date?: string, enabled = true) {
  return useOne<HomeworkLoadResult>(enabled && classId && date ? `/analytics/homework-load${qs({ classId, date })}` : null)
}

/* ── 5. smart substitute suggestions ───────────────────────────────── */

/** `GET /analytics/substitute-suggestions?classSubjectId=&date=&periodIdx=` — answers `{ …, items }`; `useList`
 * unwraps the `items` array fine even though the object also carries `timetableEntryId`/`subjectName`/etc. */
export function useSubstituteSuggestions(params: { classSubjectId?: string; date?: string; periodIdx?: number }, enabled = true) {
  const ready = enabled && !!params.classSubjectId && !!params.date && params.periodIdx !== undefined
  return useList<SubstituteSuggestion>(ready ? `/analytics/substitute-suggestions${qs(params)}` : null)
}

/* ── presentation helpers ──────────────────────────────────────────── */

export const riskTone = (l: RiskLevel): 'green' | 'amber' | 'rose' => (l === 'High' ? 'rose' : l === 'Medium' ? 'amber' : 'green')
