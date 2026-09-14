import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, errorMessage } from '../api'
import type { ChapterProgress, ChapterProgressStatus, ChapterResource, CoverageRow, SyllabusChapter, SyllabusPace, TermSyllabusTarget } from '../data'
import { qs, useList } from './useAcademics'

// Thin wrapper hooks for Phase 18 (syllabus & teaching-progress tracking) — /api/syllabus/*.
// See .agents/edunova/phase-18-syllabus-tracking.md and server/src/modules/syllabus/{router,service,schema}.ts
// (built in parallel — these hooks were adjusted to match its actual response shapes once it landed; see the
// frontend report for the specific mismatches vs. the spec's endpoint list).

/* ── chapters (curriculum-subject level, staff/admin/superadmin write) ── */

export function useChapters(curriculumSubjectId?: string) {
  return useList<SyllabusChapter>(curriculumSubjectId ? `/syllabus/chapters${qs({ curriculumSubjectId })}` : null)
}

export function useChapterActions() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | null> => {
    setBusy(true)
    try {
      const out = await fn()
      if (okMsg) toast.success(okMsg)
      return out
    } catch (e) {
      toast.error(errorMessage(e))
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  /** `order` is required server-side (no auto-increment) — callers pass the next free slot, typically `chapters.length + 1`. */
  const create = useCallback((body: { curriculumSubjectId: string; order: number; title: string; estimatedPeriods: number; examWeightagePct?: number | null }, okMsg = 'Chapter added') =>
    run(() => api.post<{ item: SyllabusChapter }>('/syllabus/chapters', body).then(r => r.item), okMsg), [run])

  const update = useCallback((id: string, body: Partial<Pick<SyllabusChapter, 'title' | 'estimatedPeriods' | 'examWeightagePct' | 'order'>>, okMsg?: string) =>
    run(() => api.patch<{ item: SyllabusChapter }>(`/syllabus/chapters/${id}`, body).then(r => r.item), okMsg), [run])

  const remove = useCallback((id: string, okMsg = 'Chapter removed') =>
    run(() => api.del(`/syllabus/chapters/${id}`), okMsg), [run])

  /**
   * Swaps two chapters' `order`. `@@unique([curriculumSubjectId, order])` on the server (enforced with a 409,
   * checked per-request, not deferred) means writing the target order directly would collide with the row
   * that currently holds it — this parks the first chapter on a scratch order well above any real chapter
   * count before the second chapter takes its old slot. `order` must be >= 1, so `-1` (the obvious sentinel)
   * isn't valid; a value comfortably past the highest real order in the list is used instead.
   */
  const swapOrder = useCallback(async (a: SyllabusChapter, b: SyllabusChapter, allOrders: number[]) => {
    setBusy(true)
    const scratch = Math.max(...allOrders, 0) + 1000
    try {
      await api.patch(`/syllabus/chapters/${a.id}`, { order: scratch })
      await api.patch(`/syllabus/chapters/${b.id}`, { order: a.order })
      await api.patch(`/syllabus/chapters/${a.id}`, { order: b.order })
      return true
    } catch (e) {
      toast.error(errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, create, update, remove, swapOrder }
}

/* ── chapter resources (shared teaching-resource library per chapter) ── */

export function useChapterResources(chapterId?: string) {
  return useList<ChapterResource>(chapterId ? `/syllabus/chapter-resources${qs({ chapterId })}` : null)
}

export async function addChapterResource(chapterId: string, fileId: string, label: string) {
  return api.post<{ item: ChapterResource }>('/syllabus/chapter-resources', { chapterId, fileId, label }).then(r => r.item)
}

export async function removeChapterResource(id: string) {
  return api.del(`/syllabus/chapter-resources/${id}`)
}

/* ── progress (per class-subject, write scoped to its assigned teacher(s) + staff/admin/superadmin) ── */

/** A chapter joined with its progress on one class-subject — untouched chapters come back `NotStarted` with no saved row. */
export interface ChapterProgressRow {
  chapter: SyllabusChapter
  progress: ChapterProgress
}

export function useProgress(classSubjectId?: string) {
  return useList<ChapterProgressRow>(classSubjectId ? `/syllabus/progress${qs({ classSubjectId })}` : null)
}

/** `PATCH /syllabus/progress/:classSubjectId/:chapterId` — both ids are path segments, not a query string. */
export async function updateProgress(classSubjectId: string, chapterId: string, body: { status?: ChapterProgressStatus; notes?: string | null; startedAt?: string | null; completedAt?: string | null }) {
  return api.patch<{ item: ChapterProgress }>(`/syllabus/progress/${classSubjectId}/${chapterId}`, body).then(r => r.item)
}

/* ── term targets (staff/admin/superadmin only) ── */

export function useTargets(params: { curriculumSubjectId?: string; termId?: string } = {}) {
  const path = params.curriculumSubjectId || params.termId ? `/syllabus/targets${qs(params)}` : '/syllabus/targets'
  return useList<TermSyllabusTarget>(path)
}

export function useTargetActions() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | null> => {
    setBusy(true)
    try {
      const out = await fn()
      if (okMsg) toast.success(okMsg)
      return out
    } catch (e) {
      toast.error(errorMessage(e))
      return null
    } finally {
      setBusy(false)
    }
  }, [])
  const create = useCallback((body: { curriculumSubjectId: string; termId: string; targetChapterId: string; classId?: string | null }, okMsg = 'Target set') =>
    run(() => api.post<{ item: TermSyllabusTarget }>('/syllabus/targets', body).then(r => r.item), okMsg), [run])
  // The server only accepts `targetChapterId` on PATCH — classId/curriculumSubjectId/termId are set once at creation.
  const update = useCallback((id: string, body: { targetChapterId: string }, okMsg = 'Target updated') =>
    run(() => api.patch<{ item: TermSyllabusTarget }>(`/syllabus/targets/${id}`, body).then(r => r.item), okMsg), [run])
  const remove = useCallback((id: string, okMsg = 'Target removed') =>
    run(() => api.del(`/syllabus/targets/${id}`), okMsg), [run])
  return { busy, create, update, remove }
}

/* ── computed views ── */

// `/syllabus/pace/:id` answers the object directly (no `{ item }` wrapper), so this doesn't go through
// `useOne` (which expects that wrapper convention) — a small dedicated fetcher instead, same shape as
// `useFetch` in useTimetable.ts.
export function usePace(classSubjectId?: string, asOf?: string) {
  const path = classSubjectId ? `/syllabus/pace/${classSubjectId}${qs({ asOf })}` : null
  const [state, setState] = useState<{ path: string; data?: SyllabusPace; error?: string }>({ path: '' })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!path) return
    let cancelled = false
    api.get<SyllabusPace>(path)
      .then(data => { if (!cancelled) setState({ path, data }) })
      .catch(e => { if (!cancelled) setState({ path, error: errorMessage(e) }) })
    return () => { cancelled = true }
  }, [path, nonce])
  const current = path && state.path === path ? state : undefined
  return { data: current?.data, error: current?.error, loading: !!path && !current, reload: () => setNonce(n => n + 1) }
}

export function useCoverage(classSubjectId?: string) {
  return useList<CoverageRow>(classSubjectId ? `/syllabus/coverage/${classSubjectId}` : null)
}

/* ── pace presentation ───────────────────────────────────
 * "Chapter 6 of 14 · on pace, adjusted for 5 lost periods" — not raw numbers. Deliberately spells out the
 * lost-periods adjustment inline instead of hiding it, since that's the number that answers "is the class
 * really behind, or did the timetable just not run". `totalChapters` is optional — the pace endpoint itself
 * doesn't return a chapter-list length, so callers that have it (from a `useChapters` call already in flight)
 * pass it through for the fuller "chapter N of M" framing; without it the headline falls back to a plain count.
 */
export function paceHeadline(p: SyllabusPace, totalChapters?: number): string {
  const doneCount = p.actual?.chaptersCompleted ?? 0
  const at = totalChapters ? `Chapter ${Math.min(doneCount + 1, totalChapters)} of ${totalChapters}` : `${doneCount} chapter${doneCount === 1 ? '' : 's'} done`
  const lost = p.lostPeriods.total
  const lostNote = lost > 0 ? `, adjusted for ${lost} lost period${lost === 1 ? '' : 's'}` : ''
  const delta = p.paceDeltaChapters
  if (delta >= 0) return `${at} · on pace${delta > 0 ? ` — ${delta} ahead` : ''}${lostNote}`
  return `${at} · behind by ~${Math.abs(delta)} chapter${Math.abs(delta) === 1 ? '' : 's'}${lostNote}`
}

export type PaceTone = 'green' | 'amber' | 'rose'
export function paceTone(p: SyllabusPace): PaceTone {
  if (p.paceDeltaChapters >= 0) return 'green'
  return p.paceDeltaChapters === -1 ? 'amber' : 'rose'
}
