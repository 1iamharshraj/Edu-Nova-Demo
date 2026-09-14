import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useAcademic, useStore } from '../store'
import { isoDate, useFetch } from './useTimetable'
import { compareClasses } from '../data'
import type {
  Assessment, AttendanceSession, AttendanceSummary, ClassRec, ClassSubject, GradeBand, GradeScale, HomeworkRec, RankEntry, ReportCard,
  SessionStatus, StaffAttendance, StaffStatus, SubjectRec, User,
} from '../data'

// Data hooks and pure helpers for attendance, gradebook, report cards, ranks and homework.
// Components live in src/portal/modules/{academics,classroom,actions,studentReport}.tsx.
// See .agents/edunova/phase-3-attendance-assessment.md

/* ── query helpers ─────────────────────────────────────── */

/** `?a=1&b=2` from an object, skipping empty values. */
export const qs = (params: Record<string, string | number | null | undefined>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
  return s ? `?${s}` : ''
}

/** List endpoints answer `{ items }` by convention; a few in the spec are written as bare arrays — accept both. */
export function useList<T>(path: string | null) {
  const r = useFetch<{ items?: T[] } | T[]>(path)
  const items = useMemo(() => (r.data ? (Array.isArray(r.data) ? r.data : r.data.items ?? []) : undefined), [r.data])
  return { items, error: r.error, loading: r.loading, reload: r.reload }
}

/** Single-object endpoints: `{ item }` or the object itself. */
export function useOne<T extends object>(path: string | null) {
  const r = useFetch<{ item?: T } | T>(path)
  const data = useMemo(() => (r.data ? ('item' in r.data && r.data.item ? r.data.item : (r.data as T)) : undefined), [r.data])
  return { data, error: r.error, loading: r.loading, reload: r.reload }
}

/** Several GETs in parallel (e.g. one report card per term), `{ item }` unwrapped. Failed paths yield `undefined`. */
export function useFetchMany<T>(paths: string[]) {
  const key = paths.join('\n')
  const [state, setState] = useState<{ key: string; data: (T | undefined)[] }>({ key: '', data: [] })
  useEffect(() => {
    if (!key) return
    let cancelled = false
    Promise.all(key.split('\n').map(p => api.get<{ item?: T } | T>(p).then(r => (r && typeof r === 'object' && 'item' in r && r.item ? r.item : (r as T))).catch(() => undefined)))
      .then(data => { if (!cancelled) setState({ key, data }) })
    return () => { cancelled = true }
  }, [key])
  return { data: key && state.key === key ? state.data : undefined, loading: !!key && state.key !== key }
}

/* ── attendance ────────────────────────────────────────── */

export const SESSION_STATUSES: SessionStatus[] = ['P', 'A', 'L', 'E']
export const STAFF_STATUSES: StaffStatus[] = ['P', 'A', 'L', 'H']
export const STATUS_LABEL: Record<SessionStatus, string> = { P: 'Present', A: 'Absent', L: 'Leave', E: 'Excused', H: 'Holiday' }
/** Solid (selected) and soft (calendar cell) colour classes per status. */
export const STATUS_SOLID: Record<SessionStatus, string> = { P: 'bg-emerald-500 text-white', A: 'bg-rose-500 text-white', L: 'bg-amber-500 text-white', E: 'bg-sky-500 text-white', H: 'bg-slate-400 text-white' }
export const STATUS_SOFT: Record<SessionStatus, string> = { P: 'bg-emerald-50 text-emerald-600', A: 'bg-rose-100 text-rose-600', L: 'bg-amber-50 text-amber-600', E: 'bg-sky-50 text-sky-600', H: 'bg-black/[.05] dark:bg-white/[.07] text-black/40 dark:text-white/40' }
export const pctTone = (pct: number): 'green' | 'amber' | 'rose' => (pct >= 90 ? 'green' : pct >= 75 ? 'amber' : 'rose')

/** `/attendance/summary` for a student (or a whole class) in a term. */
export function useAttendanceSummary(params: { studentId?: string; classId?: string; termId?: string }, enabled = true) {
  const path = enabled && (params.studentId || params.classId) && params.termId ? `/attendance/summary${qs(params)}` : null
  return useOne<AttendanceSummary>(path)
}

/** Sessions (with records) for a class in a date range. */
export function useSessions(classId?: string, from?: string, to?: string) {
  return useList<AttendanceSession>(classId ? `/attendance/sessions${qs({ classId, from, to })}` : null)
}

export function useStaffAttendance(date?: string) {
  return useList<StaffAttendance>(date ? `/attendance/staff${qs({ date })}` : null)
}

/** Staff attendance summary — same `{ overall, days }` shape as the student summary. */
export function useStaffSummary(userId?: string, from?: string, to?: string, enabled = true) {
  return useOne<AttendanceSummary>(enabled && userId && from && to ? `/attendance/staff/summary${qs({ userId, from, to })}` : null)
}

/* ── assessment ────────────────────────────────────────── */

export function useAssessments(params: { classSubjectId?: string; classId?: string; termId?: string }) {
  const path = (params.classSubjectId || params.classId) && params.termId ? `/assessments${qs(params)}` : null
  return useList<Assessment>(path)
}

export function useReportCard(studentId?: string, termId?: string) {
  return useOne<ReportCard>(studentId && termId ? `/assessments/report-card${qs({ studentId, termId })}` : null)
}

export function useRanks(classId?: string, termId?: string) {
  return useList<RankEntry>(classId && termId ? `/assessments/ranks${qs({ classId, termId })}` : null)
}

export function useGradeScales(enabled = true) {
  return useList<GradeScale>(enabled ? '/assessments/grade-scales' : null)
}

/** CBSE 8-point ladder — the server's fallback when a school has no grade scale. */
export const DEFAULT_BANDS: GradeBand[] = [
  { min: 91, grade: 'A1' }, { min: 81, grade: 'A2' }, { min: 71, grade: 'B1' }, { min: 61, grade: 'B2' },
  { min: 51, grade: 'C1' }, { min: 41, grade: 'C2' }, { min: 33, grade: 'D' }, { min: 0, grade: 'E' },
]
export function gradeFromBands(pct: number, bands: GradeBand[] = DEFAULT_BANDS) {
  const sorted = [...bands].sort((a, b) => b.min - a.min)
  return sorted.find(b => pct >= b.min)?.grade ?? sorted[sorted.length - 1]?.grade ?? '—'
}
/** The scale the server applies to a class: its board's, else the school's first (else the default ladder). */
export function bandsForClass(scales: GradeScale[] | undefined, cls?: ClassRec) {
  const s = (scales ?? []).find(x => cls && x.boardId === cls.boardId) ?? (scales ?? [])[0]
  return s?.bands ?? DEFAULT_BANDS
}

/* ── homework ──────────────────────────────────────────── */

export function useHomework(classId?: string, termId?: string) {
  return useList<HomeworkRec>(classId && termId ? `/homework${qs({ classId, termId })}` : null)
}

export type HomeworkView = 'Pending' | 'Overdue' | 'Submitted' | 'Late' | 'Graded' | 'Returned'
/** A student's status on one homework: their submission's, else Pending / Overdue by the due date. */
export function homeworkStatus(h: HomeworkRec, studentId?: string, today = isoDate(new Date())): HomeworkView {
  const sub = h.submissions?.find(s => s.studentId === studentId)
  if (sub) return sub.status
  return h.dueDate < today ? 'Overdue' : 'Pending'
}
export const isOpen = (s: HomeworkView) => s === 'Pending' || s === 'Overdue'
export const hwTone = (s: HomeworkView): 'green' | 'amber' | 'rose' | 'slate' =>
  s === 'Graded' || s === 'Submitted' ? 'green' : s === 'Pending' ? 'amber' : s === 'Overdue' || s === 'Late' ? 'rose' : 'slate'

/* ── roster & class-subject helpers ────────────────────── */

export type StudentRow = User & { rollNo?: string }
const byRoll = (a: StudentRow, b: StudentRow) => {
  const ra = parseInt(a.rollNo ?? '', 10), rb = parseInt(b.rollNo ?? '', 10)
  if (!isNaN(ra) && !isNaN(rb) && ra !== rb) return ra - rb
  return (a.rollNo ?? '').localeCompare(b.rollNo ?? '', undefined, { numeric: true }) || a.name.localeCompare(b.name)
}

/** Active students of a class from the enrollments slice, ordered by roll number then name. */
export function useClassStudents(classId?: string): StudentRow[] {
  const { db } = useStore()
  const { enrollments } = useAcademic()
  return useMemo(() => {
    if (!classId) return []
    const roll = new Map(enrollments.filter(e => e.classId === classId && e.status === 'active').map(e => [e.studentId, e.rollNo]))
    return db.users.filter(u => u.role === 'student' && roll.has(u.id)).map(u => ({ ...u, rollNo: roll.get(u.id) })).sort(byRoll)
  }, [db.users, enrollments, classId])
}

export interface ClassSubjectRow { cs: ClassSubject; cls: ClassRec; subject?: SubjectRec; teacher?: User; label: string }

/**
 * Class-subjects the signed-in user may write attendance/marks/homework for: teachers get the subjects they teach
 * plus every subject of a class they are class teacher of; staff/admin get every class-subject in the current year.
 */
export function useTeachableClassSubjects(): ClassSubjectRow[] {
  const { db, user } = useStore()
  const { classes, classSubjects, subjectById, classById, classesTaughtBy, currentYear, gradeById } = useAcademic()
  return useMemo(() => {
    if (!user) return []
    const anyClass = user.role === 'staff' || user.role === 'admin' || user.role === 'superadmin'
    const mine = anyClass ? classes.filter(c => !currentYear || c.academicYearId === currentYear.id) : classesTaughtBy(user.id)
    const ids = new Set(mine.map(c => c.id))
    const byClass = compareClasses(gradeById)
    return classSubjects
      .filter(cs => ids.has(cs.classId) && (anyClass || cs.teacherId === user.id || classById.get(cs.classId)?.classTeacherId === user.id))
      .map(cs => {
        const cls = classById.get(cs.classId)!
        const subject = subjectById.get(cs.subjectId)
        return { cs, cls, subject, teacher: cs.teacherId ? db.users.find(u => u.id === cs.teacherId) : undefined, label: `${cls.label} · ${subject?.name ?? 'Subject'}` }
      })
      .sort((a, b) => byClass(a.cls, b.cls) || (a.subject?.name ?? '').localeCompare(b.subject?.name ?? ''))
  }, [user, classes, classSubjects, subjectById, classById, classesTaughtBy, currentYear, gradeById, db.users])
}

/* ── misc ──────────────────────────────────────────────── */

/** Client-side CSV download. */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const blob = new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export const fmtDate = (d?: string | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', opts) : '—'

/** Term (academic slice) whose date range contains `date`, else the given fallback. */
export function termForDate<T extends { startDate: string; endDate: string }>(terms: T[], date: string, fallback?: T) {
  return terms.find(t => t.startDate <= date && date <= t.endDate) ?? fallback
}
