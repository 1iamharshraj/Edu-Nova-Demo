import type { BoardRec, ClassRec, Enrollment, Grade, Stream } from '@/lib/data'
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
