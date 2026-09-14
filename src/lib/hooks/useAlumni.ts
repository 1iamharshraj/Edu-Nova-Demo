import { qs, useList } from './useAcademics'
import type { AlumniDonation, AlumniEvent, AlumniEventRsvp, AlumniProfile, AlumniRsvpStatus } from '../data'

// Data hooks and pure helpers for Phase 13: alumni directory, events/RSVPs, donations.
// Components live in src/portal/modules/alumni.tsx. See .agents/edunova/phase-13-alumni.md
//
// Alumni are NOT portal users (no `User` role, no login) — everything here is staff/admin-recorded on an
// alumnus's behalf. The server side was being built concurrently — endpoint paths below follow the spec's
// described shapes (`/alumni/profiles`, `/alumni/events`, `/alumni/events/:id/rsvp`, `/alumni/donations`,
// `POST /alumni/convert-student`) and may need adjusting once verified against the real running server.

/* ── alumni profiles / directory ───────────────────────── */

/** `GET /alumni/profiles?q&graduationYear` — staff/teacher/admin/superadmin read, staff/admin write. */
export function useAlumniProfiles(params: { q?: string; graduationYear?: number | '' } = {}, enabled = true) {
  return useList<AlumniProfile>(enabled ? `/alumni/profiles${qs(params)}` : null)
}

/** Distinct graduation years present in a profile list, newest first — for the filter dropdown. */
export function graduationYears(items: AlumniProfile[] | undefined): number[] {
  return [...new Set((items ?? []).map(a => a.graduationYear))].sort((a, b) => b - a)
}

/* ── events & RSVPs ─────────────────────────────────────── */

/** `GET /alumni/events` — broad read. */
export function useAlumniEvents(enabled = true) {
  return useList<AlumniEvent>(enabled ? '/alumni/events' : null)
}

/** `GET /alumni/events/:id/rsvp` — RSVPs recorded (by staff, on an alumnus's behalf) for one event. */
export function useAlumniEventRsvps(eventId?: string, enabled = true) {
  return useList<AlumniEventRsvp>(enabled && eventId ? `/alumni/events/${encodeURIComponent(eventId)}/rsvp` : null)
}

export const ALUMNI_RSVP_STATUSES: AlumniRsvpStatus[] = ['Interested', 'Going', 'Declined']
export const rsvpTone = (s: AlumniRsvpStatus): 'green' | 'amber' | 'rose' =>
  s === 'Going' ? 'green' : s === 'Interested' ? 'amber' : 'rose'

/* ── donations ──────────────────────────────────────────── */

/** `GET /alumni/donations?alumniId` — staff/admin/superadmin only (financial data). */
export function useAlumniDonations(params: { alumniId?: string } = {}, enabled = true) {
  return useList<AlumniDonation>(enabled ? `/alumni/donations${qs(params)}` : null)
}

/** School-wide and per-alumnus running totals from a donations list. */
export function donationTotals(items: AlumniDonation[] | undefined) {
  const list = items ?? []
  const total = list.reduce((sum, d) => sum + d.amount, 0)
  const byAlumni = new Map<string, number>()
  for (const d of list) byAlumni.set(d.alumniId, (byAlumni.get(d.alumniId) ?? 0) + d.amount)
  return { total, byAlumni }
}
