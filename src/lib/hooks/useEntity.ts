import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { api, errorMessage } from '../api'
import { useStore } from '../store'
import type { AcademicState } from '../data'

// Maps a slice of AcademicState to its REST collection under /api/academic. A value starting with '/'
// is a full path under /api instead (for slices served by another router).
const COLLECTION: Record<keyof AcademicState, string> = {
  years: 'years',
  terms: 'terms',
  boards: 'boards',
  grades: 'grades',
  streams: 'streams',
  curriculum: 'curriculum',
  classes: 'classes',
  subjects: 'subjects',
  classSubjects: 'class-subjects',
  rooms: 'rooms',
  enrollments: 'enrollments',
  guardians: 'guardians',
  periodTemplates: '/timetable/period-templates',
  cohorts: 'cohorts',
  capabilities: 'capabilities',
  teacherQualifications: 'teacher-qualifications',
}

/**
 * CRUD helpers for one academic collection. Every successful write refreshes the shared
 * `academic` state in the store so every screen sees the change; every failure toasts.
 */
export function useEntity<K extends keyof AcademicState>(key: K) {
  type Item = AcademicState[K][number]
  const { academic, refreshAcademic } = useStore()
  const [busy, setBusy] = useState(false)
  const path = COLLECTION[key]
  const base = path.startsWith('/') ? path : `/academic/${path}`

  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | null> => {
    setBusy(true)
    try {
      const out = await fn()
      await refreshAcademic()
      if (okMsg) toast.success(okMsg)
      return out
    } catch (e) {
      toast.error(errorMessage(e))
      return null
    } finally {
      setBusy(false)
    }
  }, [refreshAcademic])

  const create = useCallback((body: Partial<Item>, okMsg?: string) =>
    run(() => api.post<{ item: Item }>(base, body).then(r => r.item), okMsg), [base, run])

  const update = useCallback((id: string, body: Partial<Item>, okMsg?: string) =>
    run(() => api.patch<{ item: Item }>(`${base}/${id}`, body).then(r => r.item), okMsg), [base, run])

  const remove = useCallback((id: string, okMsg?: string) =>
    run(() => api.del<{ ok: true }>(`${base}/${id}`), okMsg), [base, run])

  const action = useCallback((id: string, verb: string, okMsg?: string) =>
    run(() => api.post(`${base}/${id}/${verb}`), okMsg), [base, run])

  return { items: academic[key] as AcademicState[K], create, update, remove, action, busy }
}
