import { qs, useList } from './useAcademics'
import type {
  ActivityKind, ActivityRec, ActivityRegistrationRec, AchievementCategory, AchievementRec, CallLogRec, CallOutcome, CallReason,
  DisciplinaryActionRec, DisciplinaryCaseRec, DisciplinaryCaseStatus, DisciplinaryNote, HealthKind, HealthRecordRec,
  MedicationLog, MedicationSchedule, PermissionSlipRec, SlipResponseRec,
} from '../data'

// Data hooks and pure helpers for Phase 8: health, permission slips, achievements, discipline, call log, activities.
// Components live in src/portal/modules/{actions,disciplinary,feeDefaulters,office}.tsx.
// See .agents/edunova/phase-8-welfare.md

/* ── health ─────────────────────────────────────────────── */

export const HEALTH_KINDS: HealthKind[] = ['Vaccination', 'Allergy', 'Condition', 'Checkup', 'Other']

/** `/health?studentId` — scoped server-side (student self, guardians, class teacher, staff/admin). */
export function useHealthRecords(studentId?: string, enabled = true) {
  return useList<HealthRecordRec>(enabled && studentId ? `/health${qs({ studentId })}` : null)
}

/** true if any of the student's health records are of the Allergy kind — drives allergy badges elsewhere. */
export function hasAllergyRecord(records?: HealthRecordRec[]): boolean {
  return (records ?? []).some(h => h.kind === 'Allergy')
}

/* ── medication schedule & administration log (Phase 22 item 4) ───────────────────────── */
// Extends the health module rather than forking it — same RBAC/visibility as HealthRecord
// (student/guardians/class-teacher/staff/admin). See phase-22-campus-safety.md.

/** `/health/medication-schedules?studentId=` — scoped like health records. */
export function useMedicationSchedules(studentId?: string, enabled = true) {
  return useList<MedicationSchedule>(enabled && studentId ? `/health/medication-schedules${qs({ studentId })}` : null)
}

/** `/health/medication-logs?scheduleId=` — the dose-by-dose administration log for one schedule. */
export function useMedicationLogs(scheduleId?: string, enabled = true) {
  return useList<MedicationLog>(enabled && scheduleId ? `/health/medication-logs${qs({ scheduleId })}` : null)
}

/* ── permission slips ───────────────────────────────────── */

/** `/slips` — scoped server-side (parent/student: applicable to their class(es); teacher/staff/admin: created or all). */
export function useSlips(enabled = true) {
  return useList<PermissionSlipRec>(enabled ? '/slips' : null)
}

/** `/slips/:id/responses` — teacher/staff tally of who has (not) responded. */
export function useSlipResponses(slipId?: string, enabled = true) {
  return useList<SlipResponseRec>(enabled && slipId ? `/slips/${encodeURIComponent(slipId)}/responses` : null)
}

export const slipDecisionTone = (d?: string): 'green' | 'rose' | 'slate' => (d === 'Approved' ? 'green' : d === 'Declined' ? 'rose' : 'slate')

/* ── achievements ───────────────────────────────────────── */

export const ACHIEVEMENT_CATEGORIES: AchievementCategory[] = ['Academic', 'Sports', 'Arts', 'Service', 'Other']

/** `/achievements?userId` — omit for every achievement the caller may see (own/wards' + verified public wall). */
export function useAchievements(userId?: string, enabled = true) {
  return useList<AchievementRec>(enabled ? `/achievements${qs({ userId })}` : null)
}

/* ── discipline ─────────────────────────────────────────── */

export const DISCIPLINARY_STATUS_CHAIN: DisciplinaryCaseStatus[] = ['Reported', 'Scheduled', 'Heard', 'Decision', 'Action Taken', 'Appealed', 'Closed']
export const DISCIPLINARY_ACTIONS: DisciplinaryActionRec[] = ['Warning', 'Suspension', 'Expulsion', 'Community Service', 'Parent Meeting', 'Fine', 'No Action']

export function nextDisciplinaryStatus(current: DisciplinaryCaseStatus): DisciplinaryCaseStatus | null {
  const i = DISCIPLINARY_STATUS_CHAIN.indexOf(current)
  return i >= 0 && i < DISCIPLINARY_STATUS_CHAIN.length - 1 ? DISCIPLINARY_STATUS_CHAIN[i + 1] : null
}

export function disciplinaryTone(s: DisciplinaryCaseStatus): 'amber' | 'rose' | 'green' | 'slate' {
  if (s === 'Closed') return 'green'
  if (s === 'Reported') return 'rose'
  if (s === 'Action Taken' || s === 'Appealed') return 'amber'
  return 'slate'
}

/** `/discipline` — scoped server-side (reporters/staff/admin: theirs or all; parent/student: own; soft-deleted hidden unless `includeArchived`). */
export function useDisciplinaryCases(params: { includeArchived?: boolean } = {}, enabled = true) {
  return useList<DisciplinaryCaseRec>(enabled ? `/discipline${qs({ includeArchived: params.includeArchived ? '1' : undefined })}` : null)
}

/** `/discipline/:id/notes` — the status-change log + free notes timeline for one case. */
export function useDisciplinaryNotes(caseId?: string, enabled = true) {
  return useList<DisciplinaryNote>(enabled && caseId ? `/discipline/${encodeURIComponent(caseId)}/notes` : null)
}

/* ── call log ───────────────────────────────────────────── */

export const CALL_REASONS: { value: CallReason; label: string }[] = [
  { value: 'fee', label: 'Fee due' },
  { value: 'attendance', label: 'Attendance concern' },
  { value: 'disciplinary', label: 'Disciplinary issue' },
  { value: 'general', label: 'General follow-up' },
]
export const CALL_OUTCOMES: { value: CallOutcome; label: string }[] = [
  { value: 'confirmed', label: 'Confirmed / resolved' },
  { value: 'callback', label: 'Asked for a callback' },
  { value: 'unreachable', label: 'Unreachable' },
  { value: 'refused', label: 'Refused to engage' },
  { value: 'other', label: 'Other' },
]
export const callOutcomeTone = (o: CallOutcome): 'green' | 'amber' | 'rose' | 'slate' =>
  o === 'confirmed' ? 'green' : o === 'callback' ? 'amber' : o === 'unreachable' || o === 'refused' ? 'rose' : 'slate'

/** `/calls?studentId` — real calls staff/teacher/admin actually made. */
export function useCallLog(studentId?: string, enabled = true) {
  return useList<CallLogRec>(enabled && studentId ? `/calls${qs({ studentId })}` : null)
}

/* ── activities ─────────────────────────────────────────── */

export const ACTIVITY_KINDS: ActivityKind[] = ['club', 'house', 'exc', 'event', 'faculty', 'track']
export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = { club: 'Club / Chapter', house: 'Inter-house', exc: 'Extra-curricular', event: 'Event', faculty: 'Faculty', track: 'Track / Stream (T3)' }

/** `/activities?kind` */
export function useActivities(kind?: ActivityKind, enabled = true) {
  return useList<ActivityRec>(enabled ? `/activities${qs({ kind })}` : null)
}

/** `/activities/:id/registrations` — staff/admin only. */
export function useActivityRegistrations(activityId?: string, enabled = true) {
  return useList<ActivityRegistrationRec>(enabled && activityId ? `/activities/${encodeURIComponent(activityId)}/registrations` : null)
}

export const activityRegTone = (s?: ActivityRegStatusLike): 'green' | 'amber' | 'slate' =>
  s === 'Registered' ? 'green' : s === 'Waitlisted' ? 'amber' : 'slate'
type ActivityRegStatusLike = 'Registered' | 'Waitlisted' | 'Cancelled' | null | undefined
