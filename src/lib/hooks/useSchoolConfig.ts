import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, errorMessage } from '../api'
import type { PeriodDef, PeriodTemplateOverride, SaturdayPattern, Weekday, WorkingDayPattern } from '../data'

// Data hooks for Phase T1's school-config screen (working days + day-scoped period template overrides).
// Both live under /api/timetable, not /api/academic/bootstrap — school-year-scoped and template-scoped
// respectively, not part of the always-loaded AcademicState. See phase-t1-timetable-foundations.md §5.
// Same shape as `useFetch` in useTimetable.ts: `loading` is derived from whether the current key has
// resolved yet (no direct setState calls in the effect body itself — only inside the .then/.catch, which
// react-hooks/set-state-in-effect doesn't flag), `reload()` bumps a nonce to force a refetch.

/** The one `WorkingDayPattern` row for an academic year, if the school has configured one yet. */
export function useWorkingDayPattern(academicYearId: string) {
  const [state, setState] = useState<{ key: string; items: WorkingDayPattern[] }>({ key: '', items: [] })
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)
  const key = academicYearId ? `${academicYearId}#${nonce}` : ''

  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    api.get<{ items: WorkingDayPattern[] }>(`/timetable/working-day-patterns?academicYearId=${encodeURIComponent(academicYearId)}`)
      .then(r => { if (!cancelled) setState({ key, items: r.items }) })
      .catch((e: unknown) => { if (!cancelled) toast.error(errorMessage(e)) })
    return () => { cancelled = true }
  }, [key, academicYearId])

  const loading = !!academicYearId && state.key !== key
  const item = (state.key === key ? state.items[0] : undefined) ?? null
  const reload = () => setNonce(n => n + 1)

  const run = async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | null> => {
    setBusy(true)
    try {
      const out = await fn()
      reload()
      if (okMsg) toast.success(okMsg)
      return out
    } catch (e) {
      toast.error(errorMessage(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  const save = (body: { workingDays: Weekday[]; saturdayPattern: SaturdayPattern }, okMsg?: string) =>
    item
      ? run(() => api.patch<{ item: WorkingDayPattern }>(`/timetable/working-day-patterns/${item.id}`, body).then(r => r.item), okMsg)
      : run(() => api.post<{ item: WorkingDayPattern }>('/timetable/working-day-patterns', { academicYearId, ...body }).then(r => r.item), okMsg)

  return { item, loading, busy, save, reload }
}

/** Day-of-week override rows (dayOfWeek 1-6) for one base period template. */
export function usePeriodTemplateOverrides(baseTemplateId: string) {
  const [state, setState] = useState<{ key: string; items: PeriodTemplateOverride[] }>({ key: '', items: [] })
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)
  const key = baseTemplateId ? `${baseTemplateId}#${nonce}` : ''

  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    api.get<{ items: PeriodTemplateOverride[] }>(`/timetable/period-templates/${baseTemplateId}/overrides`)
      .then(r => { if (!cancelled) setState({ key, items: r.items }) })
      .catch((e: unknown) => { if (!cancelled) toast.error(errorMessage(e)) })
    return () => { cancelled = true }
  }, [key, baseTemplateId])

  const loading = !!baseTemplateId && state.key !== key
  const items = state.key === key ? state.items : []
  const reload = () => setNonce(n => n + 1)

  const run = async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | null> => {
    setBusy(true)
    try {
      const out = await fn()
      reload()
      if (okMsg) toast.success(okMsg)
      return out
    } catch (e) {
      toast.error(errorMessage(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  const create = (body: { dayOfWeek: number; name: string; periods: PeriodDef[] }, okMsg?: string) =>
    run(() => api.post<{ item: PeriodTemplateOverride }>('/timetable/period-templates/overrides', { baseTemplateId, ...body }).then(r => r.item), okMsg)

  const update = (id: string, body: { name?: string; periods?: PeriodDef[] }, okMsg?: string) =>
    run(() => api.patch<{ item: PeriodTemplateOverride }>(`/timetable/period-templates/overrides/${id}`, body).then(r => r.item), okMsg)

  const remove = (id: string, okMsg?: string) =>
    run(() => api.del<{ ok: true }>(`/timetable/period-templates/overrides/${id}`), okMsg)

  return { items, loading, busy, create, update, remove, reload }
}
