import { useEffect, useState } from 'react'
import { api, ApiError, errorMessage } from '../api'
import { qs, useList } from './useAcademics'
import type { BoardingType, MyStopRec, RouteRec, StopRec, StudentStopAssignmentRec, VehicleLocationRec, VehicleRec } from '../data'

// Data hooks and pure helpers for Phase 12: transport routes/stops, vehicles, student-stop assignments, and
// vehicle location (last-seen) reads. The location-ping endpoint (POST /transport/vehicles/:id/ping) is
// deliberately not wrapped here — nothing in this web app calls it, that's for the future native driver app.
// Components live in src/portal/modules/transport.tsx. See .agents/edunova/phase-12-transport.md

export const BOARDING_TYPES: BoardingType[] = ['Pickup', 'Drop', 'Both']
export const boardingTone = (b: BoardingType): 'sky' | 'amber' | 'green' => (b === 'Pickup' ? 'sky' : b === 'Drop' ? 'amber' : 'green')

/** `/transport/routes` — everyone can read; staff/admin/superadmin write. */
export function useRoutes(enabled = true) {
  return useList<RouteRec>(enabled ? '/transport/routes' : null)
}

/** `/transport/stops?routeId` — omit routeId for every stop (the admin screen groups them client-side by route). */
export function useStops(routeId?: string, enabled = true) {
  return useList<StopRec>(enabled ? `/transport/stops${qs({ routeId })}` : null)
}

/** `/transport/vehicles` — staff/admin/superadmin. */
export function useVehicles(enabled = true) {
  return useList<VehicleRec>(enabled ? '/transport/vehicles' : null)
}

/** `/transport/assignments?studentId&stopId` — staff/admin manage everyone's; a parent/student may read their own. */
export function useAssignments(params: { studentId?: string; stopId?: string } = {}, enabled = true) {
  return useList<StudentStopAssignmentRec>(enabled ? `/transport/assignments${qs(params)}` : null)
}

/**
 * A single GET that tolerates a 404/"not found" as a legitimate empty state instead of surfacing it as an
 * error — used for `/transport/my-stop` (no assignment yet) and `/transport/vehicles/:id/location` (no ping
 * recorded yet), both of which the spec explicitly wants to answer with null rather than an error.
 */
function useOptionalFetch<T>(path: string | null) {
  const [state, setState] = useState<{ path: string; data?: T | null; error?: string }>({ path: '' })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!path) return
    let cancelled = false
    api.get<{ item?: T | null } | T | null>(path)
      .then(res => {
        if (cancelled) return
        const data = res && typeof res === 'object' && 'item' in res ? (res as { item?: T | null }).item ?? null : (res as T | null) ?? null
        setState({ path, data })
      })
      .catch(e => {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 404) setState({ path, data: null })
        else setState({ path, error: errorMessage(e) })
      })
    return () => { cancelled = true }
  }, [path, nonce])
  const current = path && state.path === path ? state : undefined
  return { data: current?.data, error: current?.error, loading: !!path && !current, reload: () => setNonce(n => n + 1) }
}

/** `/transport/my-stop` — parent/student convenience: their stop, route, vehicle and its latest location in
 * one call. `studentId` lets a parent with several wards pick which one (same convention as `/leave/balance`
 * etc.) — omit for a student viewing themself. `null` data means "no stop assigned yet," not an error. */
export function useMyStop(studentId?: string, enabled = true) {
  return useOptionalFetch<MyStopRec>(enabled ? `/transport/my-stop${qs({ studentId })}` : null)
}

/** `/transport/vehicles/:id/location` — latest location, or `null` if none has been recorded yet. */
export function useVehicleLocation(vehicleId?: string, enabled = true) {
  return useOptionalFetch<VehicleLocationRec>(enabled && vehicleId ? `/transport/vehicles/${encodeURIComponent(vehicleId)}/location` : null)
}

/** Anything older than this is "not currently tracked" per the spec — don't show a stale ping as if it's live. */
export const LOCATION_STALE_MIN = 30
export function isLocationStale(recordedAt?: string | null): boolean {
  if (!recordedAt) return true
  const t = new Date(recordedAt).getTime()
  if (Number.isNaN(t)) return true
  return Date.now() - t > LOCATION_STALE_MIN * 60_000
}

export function minutesAgo(recordedAt: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(recordedAt).getTime()) / 60_000))
}

/** Straight-line distance in km (haversine) — used to show a cheap "~X km from your stop" estimate when both
 * the vehicle's last ping and the stop itself carry coordinates. Not a road-network distance/ETA. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
