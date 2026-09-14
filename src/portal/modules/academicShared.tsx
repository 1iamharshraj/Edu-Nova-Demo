import type { BoardRec, ClassRec, Enrollment, Grade, PeriodKind, Stream } from '@/lib/data'
import { Pill } from '../ui'

// Non-component helpers shared between academic.tsx's modules and the routed pages that used to be modals
// there (src/pages/portal/SubjectChapters.tsx, ClassSubjects.tsx, ClassRoster.tsx) — see
// .agents/edunova/ui-architecture-fix.md, Phase C. Split into its own file (rather than exported from
// academic.tsx directly) because a file mixing component and non-component exports breaks React Fast Refresh
// (react-refresh/only-export-components).

export const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
export const iconBtn = 'rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-black/[.05]'
export const dangerBtn = 'rounded-full bg-rose-50 dark:bg-rose-500/10 p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-40'
export const ghostBtn = 'rounded-full border border-black/10 dark:border-white/15 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
export const muted = 'text-[12.5px] text-black/50 dark:text-white/50'

export const swatch = (color: string, size = 12) => <span className="inline-block shrink-0 rounded-full ring-1 ring-black/10" style={{ width: size, height: size, background: color }} />

export const byRoll = (a: Enrollment, b: Enrollment) => (a.rollNo ?? '').localeCompare(b.rollNo ?? '', undefined, { numeric: true })

/** Human label for a board + grade (+ stream) combination, e.g. "CBSE · XI · Science". */
export const comboLabel = (board?: BoardRec, grade?: Grade, stream?: Stream) =>
  [board?.code, grade?.label, stream?.name].filter(Boolean).join(' · ')

/** Board + stream pills for a class card/detail header, e.g. shown atop the Subjects & Roster pages. */
export const classPills = (c: ClassRec) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <Pill tone="indigo">{c.boardCode}</Pill>
    {c.stream && <Pill tone="sky">{c.stream}</Pill>}
  </div>
)

export interface ChapterForm { title: string; estimatedPeriods: string; examWeightagePct: string }
export const emptyChapterForm = (): ChapterForm => ({ title: '', estimatedPeriods: '', examWeightagePct: '' })

// ── Period-row editing (shared by academic.tsx's PeriodsMod and schoolConfig.tsx's day-override editor,
// Phase T1 §5 — roadmap D7) ──
export interface PeriodRow { label: string; start: string; end: string; kind: PeriodKind }

export const STARTER_ROWS: PeriodRow[] = [
  { label: 'P1', start: '09:00', end: '09:45', kind: 'class' },
  { label: 'P2', start: '09:45', end: '10:30', kind: 'class' },
  { label: 'Morning Break', start: '10:30', end: '10:45', kind: 'break' },
  { label: 'P3', start: '10:45', end: '11:30', kind: 'class' },
  { label: 'P4', start: '11:30', end: '12:15', kind: 'class' },
  { label: 'Lunch Break', start: '12:15', end: '13:00', kind: 'break' },
  { label: 'P5', start: '13:00', end: '13:45', kind: 'class' },
  { label: 'P6', start: '13:45', end: '14:30', kind: 'class' },
]

/** Next row that continues where the last one ends: a 45-minute class slot with the next P-number. */
export function nextRow(rows: PeriodRow[]): PeriodRow {
  const last = rows[rows.length - 1]
  const classCount = rows.filter(r => r.kind === 'class').length
  const start = last?.end || '09:00'
  const [h, m] = start.split(':').map(Number)
  const endMin = Math.min(23 * 60 + 59, h * 60 + m + 45)
  const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`
  return { label: `P${classCount + 1}`, start, end, kind: 'class' }
}

export const rowsValid = (rows: PeriodRow[]) => rows.length > 0 && rows.every(r => r.label.trim() && r.start && r.end && r.start < r.end)
