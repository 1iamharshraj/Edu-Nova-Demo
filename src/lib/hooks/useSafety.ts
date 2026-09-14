import { qs, useList } from './useAcademics'
import type { AuthorizedPickupPerson, PickupEvent, PickupType, Visitor } from '../data'

// Data hooks for Phase 22 items 1-2: authorized pickup + OTP, visitor management.
// Components live in src/portal/modules/safety.tsx. See .agents/edunova/phase-22-campus-safety.md

/* ── authorized pickup list ────────────────────────────────── */

/** `/safety/authorized-pickups?studentId=` — parent sees their own ward's list, staff/admin any student's. */
export function useAuthorizedPickups(studentId?: string, enabled = true) {
  return useList<AuthorizedPickupPerson>(enabled && studentId ? `/safety/authorized-pickups${qs({ studentId })}` : null)
}

export const PICKUP_TYPES: PickupType[] = ['Regular', 'EarlyOrUnlisted']
export const pickupTypeLabel = (t: PickupType) => (t === 'Regular' ? 'Regular dismissal' : 'Early / unlisted person')

/* ── daily pickup log ──────────────────────────────────────── */

/** `/safety/pickup-events?date=&studentId=` — staff/admin (gate) view; scoped server-side otherwise. */
export function usePickupEvents(params: { date?: string; studentId?: string } = {}, enabled = true) {
  return useList<PickupEvent>(enabled ? `/safety/pickup-events${qs(params)}` : null)
}

/* ── visitors ──────────────────────────────────────────────── */

/** `/safety/visitors?date=&onCampus=true|false` — staff/admin only. */
export function useVisitors(params: { date?: string; onCampus?: boolean } = {}, enabled = true) {
  return useList<Visitor>(enabled ? `/safety/visitors${qs({ date: params.date, onCampus: params.onCampus !== undefined ? String(params.onCampus) : undefined })}` : null)
}
