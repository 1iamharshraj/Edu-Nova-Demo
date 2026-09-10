import { qs, useList, useOne } from './useAcademics'
import type {
  ContractRec, ContractRecStatus, Duty, LeaveBalanceLine, LeaveRequest, LeaveRequestStatus, LeaveType, ResignationRec,
} from '../data'

// Data hooks and pure helpers for Phase 6: leave, contracts, resignations, duties.
// Components live in src/portal/modules/hr.tsx and src/portal/modules/actions.tsx (LeaveMod).
// See .agents/edunova/phase-6-hr.md

/* ── leave types ────────────────────────────────────────── */

export const LEAVE_APPLIES_TO: Array<'student' | 'staff'> = ['staff', 'student']

/** `/leave/types` — every role can read; admin manages via direct api calls. */
export function useLeaveTypes(enabled = true) {
  return useList<LeaveType>(enabled ? '/leave/types' : null)
}

/* ── leave requests ─────────────────────────────────────── */

// 'PENDING_SUBSTITUTION' deliberately omitted from this list (and from `requestsQuery`'s own status enum
// server-side) — it's a transient in-flight state the UI surfaces via the row itself, not a status an admin
// filters the list by.
export const LEAVE_STATUSES: LeaveRequestStatus[] = ['Pending', 'Approved', 'Declined', 'Cancelled']
export const leaveTone = (s: LeaveRequestStatus): 'green' | 'amber' | 'rose' | 'slate' | 'indigo' =>
  s === 'Approved' ? 'green' : s === 'Pending' ? 'amber' : s === 'PENDING_SUBSTITUTION' ? 'indigo' : s === 'Declined' ? 'rose' : 'slate'
export const leaveStatusLabel = (s: LeaveRequestStatus) => s === 'PENDING_SUBSTITUTION' ? 'Arranging substitute' : s

/**
 * `/leave/requests?forUserId&status&scope`. `scope: 'mine'` — own/wards' requests (student self, parent wards,
 * teacher/staff self); `scope: 'approvals'` — requests the caller may decide (teacher: students in their classes;
 * staff/admin: everyone).
 */
export function useLeaveRequests(params: { forUserId?: string; status?: LeaveRequestStatus | ''; scope?: 'mine' | 'approvals' } = {}, enabled = true) {
  return useList<LeaveRequest>(enabled ? `/leave/requests${qs(params)}` : null)
}

/** `/leave/balance?userId&year` — per leave-type allowed/used/remaining for one user. */
export function useLeaveBalance(userId?: string, year?: number, enabled = true) {
  return useList<LeaveBalanceLine>(enabled && userId ? `/leave/balance${qs({ userId, year })}` : null)
}

/** Resolves a leave type's display name from the school's leave types (the request/balance payloads carry the id only). */
export function leaveTypeName(types: LeaveType[] | undefined, id?: string | null, fallback?: string) {
  return fallback ?? (types ?? []).find(t => t.id === id)?.name ?? 'Leave'
}

/** Inclusive day count between two ISO dates, excluding Sundays — a live client-side echo of the server's `days` field. */
export function countLeaveDays(from: string, to: string): number {
  if (!from || !to) return 0
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0
  let days = 0
  for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) days++
  }
  return days
}

/* ── contracts ──────────────────────────────────────────── */

export const CONTRACT_REC_STATUSES: ContractRecStatus[] = ['Draft', 'Active', 'Ended']
export const contractRecTone = (s: ContractRecStatus): 'green' | 'amber' | 'rose' | 'slate' =>
  s === 'Active' ? 'green' : s === 'Draft' ? 'amber' : 'slate'

/** `/hr/contracts?userId&status` — employee sees own, admin sees all. */
export function useContracts(params: { userId?: string; status?: ContractRecStatus | '' } = {}, enabled = true) {
  return useList<ContractRec>(enabled ? `/hr/contracts${qs(params)}` : null)
}

/** `GET /hr/contracts/:id` — single contract, used by the routed `/portal/hr/contracts/:id` detail/edit page
 * (see .agents/edunova/ui-architecture-fix.md Phase D). */
export function useContract(id?: string, enabled = true) {
  return useOne<ContractRec>(enabled && id ? `/hr/contracts/${encodeURIComponent(id)}` : null)
}

/* ── resignations ───────────────────────────────────────── */

/** `/hr/resignations` — employee sees own, admin sees all (server-scoped). */
export function useResignations(enabled = true) {
  return useList<ResignationRec>(enabled ? '/hr/resignations' : null)
}

/** Client echo of the server's notice-period rule: `lastWorkingDate` should be ≥ 30 days out. 0 when the notice is long enough. */
export const MIN_NOTICE_DAYS = 30
export function noticeShortfallDays(lastWorkingDate: string): number {
  if (!lastWorkingDate) return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const last = new Date(`${lastWorkingDate}T00:00:00`)
  if (Number.isNaN(last.getTime())) return 0
  const diff = Math.round((last.getTime() - today.getTime()) / 86400000)
  return Math.max(0, MIN_NOTICE_DAYS - diff)
}

/* ── duties ─────────────────────────────────────────────── */

/** `/hr/duties?assigneeId` — omit for every duty the caller may manage/see. */
export function useDuties(assigneeId?: string, enabled = true) {
  return useList<Duty>(enabled ? `/hr/duties${qs({ assigneeId })}` : null)
}
