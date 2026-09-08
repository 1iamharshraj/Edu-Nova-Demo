import { useMemo } from 'react'
import { qs, useList } from './useAcademics'
import type { HostelAllocationRec, HostelAllocationStatus, HostelBedRec, HostelRec, HostelRoomRec, HostelType } from '../data'

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
