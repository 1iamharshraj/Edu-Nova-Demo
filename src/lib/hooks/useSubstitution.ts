import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { api, errorMessage } from '../api'
import { qs, useList } from './useAcademics'
import { useFetch } from './useTimetable'
import type {
  SubstitutionPeriodRef, SubstitutionPolicy, SubstitutionPolicyMode, SubstitutionRequest,
  SubstitutionRequestStatus, SubstituteFinderResult,
} from '../data'

// Data hooks for Phase T9 — Substitution workflow (roadmap D6). See .agents/edunova/phase-t9-substitution.md
// and the T9 section of data.ts. Confirmed against the real server implementation — see
// server/src/modules/timetable/{substitution.ts,schema.ts,router.ts} and schema.prisma's own T9 doc
// comments (built in parallel by a separate agent from the same spec). Every T9 call site lives in this one
// file.

/* ── policy (admin config — a school-level singleton) ── */

export function useSubstitutionPolicy() {
  const { data, loading, error, reload } = useFetch<{ item: SubstitutionPolicy }>('/timetable/substitution-policy')
  const [busy, setBusy] = useState(false)

  const save = useCallback(async (body: {
    mode?: SubstitutionPolicyMode; minNoticeHoursForSubstitution?: number
    allowCrossSubject?: boolean; maxWeeklySubstitutePeriods?: number; tentativeHoldExpiryMinutes?: number
  }, okMsg?: string) => {
    setBusy(true)
    try {
      const out = await api.put<{ item: SubstitutionPolicy }>('/timetable/substitution-policy', body)
      reload()
      if (okMsg) toast.success(okMsg)
      return out.item
    } catch (e) { toast.error(errorMessage(e)); return null } finally { setBusy(false) }
  }, [reload])

  return { item: data?.item ?? null, loading, error, busy, save }
}

/** One-time seeding for the Finder's ranking weights (`Preference(scope: 'SUBSTITUTION')` rows) — mirrors
 * T5's `usePreferences().seedDefaults`; use `usePreferences('SUBSTITUTION')` (useTimetable.ts) to read/edit
 * the weights themselves, the same table and `PATCH /timetable/preferences/:type` T5's Mode 4 already uses. */
export function useSeedSubstitutionPreferences(onDone?: () => void) {
  const [busy, setBusy] = useState(false)
  const seed = useCallback(async () => {
    setBusy(true)
    try {
      const out = await api.post<{ added: number }>('/timetable/substitution-preferences/seed-defaults', {})
      onDone?.()
      if (out.added > 0) toast.success(`${out.added} default ranking weight${out.added === 1 ? '' : 's'} created`)
      return out.added
    } catch (e) { toast.error(errorMessage(e)); return null } finally { setBusy(false) }
  }, [onDone])
  return { busy, seed }
}

/* ── Substitute Finder (§2 — reuses T4/T5's hard-constraint + ranking machinery server-side) ── */

/** Runs the Finder — either for an existing leave request's own covered periods (`leaveRequestId`, the
 * normal path: a leave request always exists before a substitution request can reference it), or for an
 * explicit `teacherId` + period list. Returns one ranked (eligible) + excluded (hard-failed) breakdown PER
 * PERIOD, since eligibility/scoring can genuinely differ period to period — never cached, a fresh compute
 * call every time (like T8's `useWhatIf`), since availability changes between runs. */
export function useSubstituteFinder() {
  const [busy, setBusy] = useState(false)
  const find = useCallback(async (body: { leaveRequestId: string } | { teacherId: string; periods: SubstitutionPeriodRef[] }): Promise<SubstituteFinderResult | null> => {
    setBusy(true)
    try { return await api.post<SubstituteFinderResult>('/timetable/substitution-finder', body) }
    catch (e) { toast.error(errorMessage(e)); return null }
    finally { setBusy(false) }
  }, [])
  return { busy, find }
}

/* ── Substitution requests (send / accept / decline) ── */

export function useSubstitutionRequests(params: { leaveRequestId?: string; substituteTeacherId?: string; status?: SubstitutionRequestStatus | '' } = {}, enabled = true) {
  return useList<SubstitutionRequest>(enabled ? `/timetable/substitution-requests${qs(params)}` : null)
}

export interface SendSubstitutionBody {
  leaveRequestId: string
  substituteTeacherId: string
  periods: SubstitutionPeriodRef[]
  /** §4 — force a candidate through who only failed the qualification/cross-subject check (never a genuine
   * hard constraint — collision, an active hold, their own approved leave; the server re-checks and 409s if
   * `override` is used against a real hard failure). Requires `overrideNote`. */
  override?: boolean
  overrideNote?: string
}

export function useSubstitutionActions(onDone?: () => void) {
  const [busy, setBusy] = useState<'send' | 'accept' | 'decline' | null>(null)

  const send = useCallback(async (body: SendSubstitutionBody, okMsg?: string) => {
    setBusy('send')
    try {
      const out = await api.post<{ item: SubstitutionRequest }>('/timetable/substitution-requests', body)
      onDone?.()
      if (okMsg) toast.success(okMsg)
      return out.item
    } catch (e) { toast.error(errorMessage(e)); return null } finally { setBusy(null) }
  }, [onDone])

  const accept = useCallback(async (id: string) => {
    setBusy('accept')
    try {
      const out = await api.post<{ item: SubstitutionRequest }>(`/timetable/substitution-requests/${id}/accept`, {})
      onDone?.()
      toast.success('Accepted — you are now the tentative substitute for these periods')
      return out.item
    } catch (e) { toast.error(errorMessage(e)); return null } finally { setBusy(null) }
  }, [onDone])

  const decline = useCallback(async (id: string, note?: string) => {
    setBusy('decline')
    try {
      const out = await api.post<{ item: SubstitutionRequest }>(`/timetable/substitution-requests/${id}/decline`, { note: note || undefined })
      onDone?.()
      toast.success('Declined')
      return out.item
    } catch (e) { toast.error(errorMessage(e)); return null } finally { setBusy(null) }
  }, [onDone])

  return { busy, send, accept, decline }
}

/* ── pure helpers ─────────────────────────────────────── */

/** How many whole hours of notice a leave submitted right now gives before its own start — the client-side
 * echo of the server's `minNoticeHoursForSubstitution` gate (see substitution.ts#createSubstitutionRequest),
 * so the UI can explain the emergency-routing gate before the server enforces it. */
export function noticeHours(fromDate: string): number {
  if (!fromDate) return 0
  const start = new Date(`${fromDate}T00:00:00`)
  if (Number.isNaN(start.getTime())) return 0
  return Math.round((start.getTime() - Date.now()) / 3_600_000)
}

/** Expands a teacher's recurring weekly timetable entries across a [from, to] date range into concrete
 * dated periods — used client-side ONLY to decide whether to show a "find a substitute" affordance on a
 * leave row at all (the server's own `resolveLeavePeriods` is the source of truth once the Finder actually
 * runs, via `leaveRequestId`). `id` must be each entry's own TimetableEntry id (`timetableEntryId` below). */
export function periodsInRange(
  entries: { id: string; dayOfWeek: number; periodIdx: number }[],
  fromDate: string, toDate: string,
): SubstitutionPeriodRef[] {
  if (!fromDate || !toDate) return []
  const from = new Date(`${fromDate}T00:00:00`)
  const to = new Date(`${toDate}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return []
  const out: SubstitutionPeriodRef[] = []
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    if (dow === 0) continue // Sundays never scheduled
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    for (const e of entries.filter(en => en.dayOfWeek === dow)) {
      out.push({ date: dateStr, dayOfWeek: dow, periodIdx: e.periodIdx, timetableEntryId: e.id })
    }
  }
  return out.sort((a, b) => a.date === b.date ? a.periodIdx - b.periodIdx : a.date.localeCompare(b.date))
}

export const periodKey = (p: { date: string; periodIdx: number }) => `${p.date}:${p.periodIdx}`
