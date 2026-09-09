import { useMemo } from 'react'
import { qs, useList } from './useAcademics'
import type {
  HostelAllocationRec, HostelAllocationStatus, HostelBedRec, HostelOutpassRec, HostelOutpassStatus, HostelRec, HostelRollCallRec,
  HostelRoomRec, HostelType, MealFeedbackRec, MealType, MessMenuRec,
} from '../data'

// Data hooks and pure helpers for Phase 14: hostels → rooms → beds (one row per physical bed, so occupancy is
// exact) and student allocations. Components live in src/portal/modules/hostel.tsx.
// See .agents/edunova/phase-14-hostel.md and server/src/modules/hostel/{router,service}.ts (verified live —
// see the phase report for the reconciliation notes). Two things this module does NOT have, unlike Transport:
// (1) no `/hostel/my-allocation` convenience endpoint — `GET /hostel/allocations` already self/guardian-scopes
// when `studentId` is the caller's own/ward's, so `useMyHostel` below composes it with the list hooks instead;
// (2) allocations carry no name/label decorations — components cross-reference bed/room/hostel/user lists.

export const HOSTEL_TYPES: HostelType[] = ['Boys', 'Girls', 'Mixed']
export const ALLOCATION_STATUSES: HostelAllocationStatus[] = ['Active', 'Vacated', 'Transferred']

/** `/hostel/hostels` — read is open to any authenticated role (occupancy isn't sensitive the way a driver's
 * phone number is), staff/admin/superadmin write. Decorated with `totalBeds`/`occupiedBeds`. */
export function useHostels(enabled = true) {
  return useList<HostelRec>(enabled ? '/hostel/hostels' : null)
}

/** `/hostel/rooms?hostelId=` — omit hostelId for every room (the admin screen groups them client-side).
 * Decorated with `bedCount`/`occupiedCount`. */
export function useHostelRooms(hostelId?: string, enabled = true) {
  return useList<HostelRoomRec>(enabled ? `/hostel/rooms${qs({ hostelId })}` : null)
}

/** `/hostel/beds?roomId=&hostelId=&status=occupied|vacant` — decorated with `occupant` (`null` while vacant)
 * so the hierarchy view and the "pick an available bed" allocation picker don't need a second lookup. */
export function useHostelBeds(params: { roomId?: string; hostelId?: string; status?: 'occupied' | 'vacant' } = {}, enabled = true) {
  return useList<HostelBedRec>(enabled ? `/hostel/beds${qs(params)}` : null)
}

/** `/hostel/allocations?studentId=&hostelId=&roomId=&bedId=&status=` — staff/admin/superadmin see everything;
 * a parent/student sees only their own/their ward's (server-scoped — omitting `studentId` there defaults to
 * "all of mine/my wards'"). Rows carry no decorations; see the lookup helpers below. */
export function useHostelAllocations(params: { studentId?: string; hostelId?: string; roomId?: string; bedId?: string; status?: HostelAllocationStatus } = {}, enabled = true) {
  return useList<HostelAllocationRec>(enabled ? `/hostel/allocations${qs(params)}` : null)
}

export const hostelTypeTone = (t: HostelType): 'sky' | 'rose' | 'indigo' => (t === 'Boys' ? 'sky' : t === 'Girls' ? 'rose' : 'indigo')
export const allocationStatusTone = (s: HostelAllocationStatus): 'green' | 'slate' | 'amber' =>
  s === 'Active' ? 'green' : s === 'Transferred' ? 'amber' : 'slate'

/** Occupancy fraction as "42/60" text. */
export const occupancyLabel = (occupied: number, total: number): string => `${occupied}/${total}`

/**
 * A student/parent's current (Active) hostel allocation, decorated with its bed/room/hostel by
 * cross-referencing the always-open `/hostel/beds`, `/hostel/rooms` and `/hostel/hostels` reads — there is no
 * dedicated `/hostel/my-allocation` endpoint. `studentId` lets a parent with several wards pick which one
 * (same convention as `/transport/my-stop`) — omit for a student viewing themself.
 */
export function useMyHostel(studentId?: string, enabled = true) {
  const allocations = useHostelAllocations({ studentId, status: 'Active' }, enabled)
  const hostels = useHostels(enabled)
  const rooms = useHostelRooms(undefined, enabled)
  const beds = useHostelBeds({}, enabled)

  const allocation = allocations.items?.[0] ?? null
  const bed = useMemo(() => (allocation ? (beds.items ?? []).find(b => b.id === allocation.bedId) : undefined), [allocation, beds.items])
  const room = useMemo(() => (bed ? (rooms.items ?? []).find(r => r.id === bed.roomId) : undefined), [bed, rooms.items])
  const hostel = useMemo(() => (room ? (hostels.items ?? []).find(h => h.id === room.hostelId) : undefined), [room, hostels.items])

  const loading = allocations.loading || (!!allocation && (hostels.loading || rooms.loading || beds.loading))
  const error = allocations.error || hostels.error || rooms.error || beds.error
  return { allocation, bed, room, hostel, loading, error, reload: allocations.reload }
}

/* ── Phase 24: outpass / leave, night roll-call, mess menu + feedback ────────
 * See .agents/edunova/phase-24-boarding-hostel-extensions.md. Components live in
 * src/portal/modules/hostelExtras.tsx. Same scoping convention as allocations above: staff/admin/superadmin
 * see everything (optionally filtered), student/parent see only their own/their ward's. */

export const OUTPASS_STATUSES: HostelOutpassStatus[] = ['Pending', 'Approved', 'Declined', 'Departed', 'Returned', 'Overdue']
export const MEAL_TYPES: MealType[] = ['Breakfast', 'Lunch', 'Snacks', 'Dinner']

export const outpassStatusTone = (s: HostelOutpassStatus): 'green' | 'slate' | 'amber' | 'rose' | 'indigo' | 'sky' => {
  switch (s) {
    case 'Approved': return 'green'
    case 'Declined': return 'rose'
    case 'Pending': return 'amber'
    case 'Departed': return 'sky'
    case 'Returned': return 'slate'
    case 'Overdue': return 'rose'
  }
}

/** `/hostel/outpasses?studentId=&hostelId=&status=` — self/guardian-scoped for student/parent, staff/admin/
 * superadmin see their hostel/any. */
export function useOutpasses(params: { studentId?: string; hostelId?: string; status?: HostelOutpassStatus } = {}, enabled = true) {
  return useList<HostelOutpassRec>(enabled ? `/hostel/outpasses${qs(params)}` : null)
}

/** `/hostel/roll-calls?hostelId=&from=&to=` — one session per hostel per night, with nested entries. */
export function useRollCalls(params: { hostelId?: string; from?: string; to?: string } = {}, enabled = true) {
  return useList<HostelRollCallRec>(enabled ? `/hostel/roll-calls${qs(params)}` : null)
}

/** `/hostel/mess-menu?hostelId=&from=&to=&date=` — open to anyone with a hostel allocation, write is warden/
 * staff/admin. */
export function useMessMenu(params: { hostelId?: string; from?: string; to?: string; date?: string } = {}, enabled = true) {
  return useList<MessMenuRec>(enabled ? `/hostel/mess-menu${qs(params)}` : null)
}

/** `/hostel/meal-feedback?menuId=&studentId=&hostelId=` — student/parent create for own/ward's meals, warden/
 * staff/admin read/aggregate. */
export function useMealFeedback(params: { menuId?: string; studentId?: string; hostelId?: string } = {}, enabled = true) {
  return useList<MealFeedbackRec>(enabled ? `/hostel/meal-feedback${qs(params)}` : null)
}

/** Hostels this user wardens (`Hostel.wardenUserId === user.id`) — used to scope the warden-facing outpass
 * approval queue, roll-call and mess-menu screens to "my hostel" the same way the spec calls out. Admin/
 * superadmin/staff who aren't a warden of any hostel fall back to a picker over every hostel. */
export function useMyWardenHostels(userId?: string) {
  const hostels = useHostels(!!userId)
  return useMemo(() => (hostels.items ?? []).filter(h => h.wardenUserId === userId), [hostels.items, userId])
}

export const mealTypeOrder: Record<MealType, number> = { Breakfast: 0, Lunch: 1, Snacks: 2, Dinner: 3 }
export const isoDate = (d: Date) => d.toISOString().slice(0, 10)
export const startOfWeek = (base = new Date()) => {
  const d = new Date(base)
  const day = d.getDay() // 0=Sun
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d
}
export const weekDates = (base = new Date()) => {
  const start = startOfWeek(base)
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return isoDate(d) })
}
