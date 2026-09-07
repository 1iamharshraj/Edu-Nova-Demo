import { useEffect, useMemo, useState } from 'react'
import { api, errorMessage } from '../api'
import { useAcademic, useStore } from '../store'
import type { PeriodDef, PeriodTemplate, Substitution, TimetableEntry } from '../data'

// Data hooks and pure helpers for the timetable screens (Timetable, Timetable Builder, Overview tiles).
// Components live in src/portal/modules/timetable.tsx. See .agents/edunova/phase-2-timetable.md

/** An entry as the server returns it — `/teacher/:id` and `/me` decorate it with display names. */
export interface TimetableEntryView extends TimetableEntry { classLabel?: string; subjectName?: string; roomName?: string; teacherName?: string }
export interface ClassTimetable { template?: PeriodTemplate; entries: TimetableEntryView[]; published: boolean; publishedAt?: string }
/** `/teacher/:id` substitutions carry the affected entry (with its class/subject/room names). */
export type SubstitutionView = Substitution & { entry?: TimetableEntryView }
export interface TeacherTimetable { entries: TimetableEntryView[]; substitutions: SubstitutionView[] }
/** `/timetable/me` resolves per role, so the shape is the class view (student/parent) or the teacher view. */
export type MyTimetable = Partial<ClassTimetable> & Partial<TeacherTimetable> & { entries: TimetableEntryView[] }

/** dayOfWeek 1..6 → name. Index 0 (Sunday) is never scheduled. */
export const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const cellKey = (dayOfWeek: number, periodIdx: number) => `${dayOfWeek}-${periodIdx}`
export const sortedPeriods = (t: PeriodTemplate | undefined) => t ? [...t.periods].sort((a, b) => a.idx - b.idx) : []
/** Mon–Fri, plus Saturday when anything is scheduled on it (or the caller forces it). */
export const daysFor = (entries: { dayOfWeek: number }[], forceSat = false) =>
  forceSat || entries.some(e => e.dayOfWeek === 6) ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]

export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** True while `now` falls inside the period on that weekday. */
export const isRunning = (p: PeriodDef, dayOfWeek: number, now: Date) => now.getDay() === dayOfWeek && p.start <= hhmm(now) && hhmm(now) < p.end

/** Re-renders on an interval so "now" based UI (current period, next class) stays fresh. */
export function useClock(everyMs = 30_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

/**
 * GET helper with cancellation: `loading` is true until the current path has answered, `data` keeps the
 * previous answer while `reload()` refetches the same path (no flicker after a save).
 */
export function useFetch<T>(path: string | null) {
  const [state, setState] = useState<{ path: string; data?: T; error?: string }>({ path: '' })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!path) return
    let cancelled = false
    api.get<T>(path)
      .then(data => { if (!cancelled) setState({ path, data }) })
      .catch(e => { if (!cancelled) setState({ path, error: errorMessage(e) }) })
    return () => { cancelled = true }
  }, [path, nonce])
  const current = path && state.path === path ? state : undefined
  return { data: current?.data, error: current?.error, loading: !!path && !current, reload: () => setNonce(n => n + 1) }
}

/** The caller's own timetable for a term (student → own class; parent → `studentId` ward; teacher → own periods). */
export function useMyTimetable(termId: string, opts: { enabled?: boolean; studentId?: string } = {}) {
  const enabled = opts.enabled ?? true
  const path = enabled && termId ? `/timetable/me?termId=${encodeURIComponent(termId)}${opts.studentId ? `&studentId=${encodeURIComponent(opts.studentId)}` : ''}` : null
  return useFetch<MyTimetable>(path)
}

/** Resolves display strings for an entry from the academic slice, preferring names the server already attached. */
export function useEntryLookup() {
  const { classSubjects, subjectById, classById, rooms } = useAcademic()
  const { db } = useStore()
  return useMemo(() => {
    const csById = new Map(classSubjects.map(cs => [cs.id, cs]))
    const roomById = new Map(rooms.map(r => [r.id, r]))
    const userById = new Map(db.users.map(u => [u.id, u]))
    const subjectRec = (e: TimetableEntryView) => { const cs = csById.get(e.classSubjectId); return cs ? subjectById.get(cs.subjectId) : undefined }
    return {
      subjectOf: (e: TimetableEntryView) => e.subjectName ?? subjectRec(e)?.name ?? 'Subject',
      colorOf: (e: TimetableEntryView) => subjectRec(e)?.color ?? '#6366f1',
      teacherOf: (e: TimetableEntryView) => e.teacherName ?? userById.get(e.teacherId ?? csById.get(e.classSubjectId)?.teacherId ?? '')?.name,
      roomOf: (e: TimetableEntryView) => e.roomName ?? (e.roomId ? roomById.get(e.roomId)?.name : undefined),
      classLabelOf: (e: TimetableEntryView) => e.classLabel ?? classById.get(e.classId)?.label,
      userName: (id?: string) => (id ? userById.get(id)?.name : undefined),
    }
  }, [classSubjects, subjectById, classById, rooms, db.users])
}
export type EntryLookup = ReturnType<typeof useEntryLookup>

/** Today's class periods in order, split into what's running now and what comes next. */
export function todayAgenda(entries: TimetableEntryView[], template: PeriodTemplate | undefined, now: Date) {
  const day = now.getDay()
  const t = hhmm(now)
  const periods = sortedPeriods(template).filter(p => p.kind === 'class')
  const byIdx = new Map(entries.filter(e => e.dayOfWeek === day).map(e => [e.periodIdx, e]))
  const today = periods.map(p => ({ period: p, entry: byIdx.get(p.idx) })).filter((x): x is { period: PeriodDef; entry: TimetableEntryView } => !!x.entry)
  const running = today.find(x => x.period.start <= t && t < x.period.end)
  const next = today.find(x => x.period.start > t)
  return { today, running, next }
}
