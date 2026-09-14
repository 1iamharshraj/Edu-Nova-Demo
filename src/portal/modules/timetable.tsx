import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Coffee, Sun, Utensils, Clock, Lightbulb, MapPin, Sparkles, User, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import type { Diagnostic, PeriodDef, PeriodTemplate } from '@/lib/data'
import {
  DAY_LABELS, cellKey, daysFor, hhmm, isRunning, isoDate, sortedPeriods, useClock, useEntryLookup, useFetch, useMyTimetable,
  type ClassTimetable, type EntryLookup, type TeacherTimetable, type TimetableEntryView,
} from '@/lib/hooks/useTimetable'
import { useSubstituteSuggestions } from '@/lib/hooks/useAnalytics'
import { Card, Empty, Field, PageHead, Pill, TermTabs, inputCls } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'
import { useActiveTerm, useViewedStudents } from './viewer'

// Data hooks and helpers live in src/lib/hooks/useTimetable.ts; this file only exports components.

interface BreakMeta { icon: React.ReactNode; bg: string; text: string }
const BREAKS: BreakMeta[] = [
  { icon: <Sun size={14} />, bg: 'bg-amber-400/10 dark:bg-amber-400/10', text: 'text-amber-700 dark:text-amber-300' },
  { icon: <Utensils size={14} />, bg: 'bg-emerald-400/10 dark:bg-emerald-400/10', text: 'text-emerald-700 dark:text-emerald-300' },
  { icon: <Coffee size={14} />, bg: 'bg-sky-400/10 dark:bg-sky-400/10', text: 'text-sky-700 dark:text-sky-300' },
]
/** Pick an icon/colour for a break by its label (lunch → cutlery, morning → sun, anything else → coffee). */
function breakMeta(label: string): BreakMeta {
  const l = label.toLowerCase()
  if (l.includes('lunch')) return BREAKS[1]
  if (l.includes('morning')) return BREAKS[0]
  return BREAKS[2]
}

/**
 * Tracks whether a horizontally-scrollable element currently has more content hidden to its left/right,
 * so the grid can show an edge-fade affordance instead of relying on a barely-visible native scrollbar.
 */
function useHScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft < el.scrollWidth - el.clientWidth - 2 })
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', update); ro.disconnect() }
  }, [])
  return { ref, ...edges }
}

/* ── grid (desktop) + day list (mobile) ─────────────────── */

export function TimetableGrid({ template, days, renderCell, now, dense }: {
  template: PeriodTemplate
  days: number[]
  /** Return the cell for a class period; breaks are drawn by the grid itself. */
  renderCell: (dayOfWeek: number, period: PeriodDef) => React.ReactNode
  /** When given, today's row and the running period are highlighted. */
  now?: Date
  dense?: boolean
}) {
  const periods = sortedPeriods(template)
  const [dayIdx, setDayIdx] = useState(0)
  const activeDay = days[dayIdx] ?? days[0]
  const dayColWidth = 48
  // minmax(0, …fr) — plain `fr` tracks refuse to shrink below their content's intrinsic min-width (long
  // room/teacher text, badges), which silently pushed the grid wider than `minWidth` below and defeated
  // the whole point of sizing it to fit. minmax(0, …) lets a track actually shrink to its share of the
  // available space, so cell text truncates (compact view) instead of the grid overflowing further.
  const colTemplate = `${dayColWidth}px ${periods.map(p => p.kind === 'break' ? 'minmax(0,0.36fr)' : 'minmax(0,1fr)').join(' ')}`
  // Sized to fit a full 8-period school day on a 1280–1440px laptop screen without scrolling (a short
  // subject/teacher label reads fine at this width; the full label is available on hover/focus via
  // PeriodCard's detail overlay, so this doesn't need to be wide enough for the longest possible name).
  // Longer templates still scroll horizontally — the edge-fade + sticky day column below make that obvious.
  const minWidth = dayColWidth + periods.reduce((w, p) => w + (p.kind === 'break' ? 34 : 92), 0)
  const { ref: scrollRef, left: canScrollLeft, right: canScrollRight } = useHScrollEdges<HTMLDivElement>()
  const t = now ? hhmm(now) : ''
  const isNow = (p: PeriodDef) => !!now && p.start <= t && t < p.end
  const today = now?.getDay()
  const minH = dense ? 'min-h-[76px]' : 'min-h-[92px]'

  const breakCell = (p: PeriodDef, key: string, extra = '') => {
    const meta = breakMeta(p.label)
    return (
      <div key={key} className={`flex ${minH} flex-col items-center justify-center gap-1 rounded-xl border border-transparent ${meta.bg} py-3 text-center ${extra}`}>
        <span className={meta.text}>{meta.icon}</span>
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${meta.text}`}>{p.label}</span>
      </div>
    )
  }

  return (
    <>
      {/* Desktop */}
      <Card className="relative hidden overflow-hidden p-0 md:block">
        <div ref={scrollRef} data-timetable-scroll className="overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black/20 dark:[&::-webkit-scrollbar-thumb]:bg-white/20">
          <div className="p-3" style={{ minWidth }}>
            <div className="sticky top-0 z-20 gap-1.5 border-b border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] pb-3" style={{ display: 'grid', gridTemplateColumns: colTemplate }}>
              <div className="sticky left-0 z-10 bg-white dark:bg-[#14141f]" />
              {periods.map(p => (
                <div key={p.idx} className={`overflow-hidden rounded-xl px-1 py-2 text-center ${isNow(p) ? 'bg-indigo-50 dark:bg-indigo-500/10' : ''}`}>
                  {p.kind === 'break' ? (
                    // Break columns are the narrowest — a full "☀ Break" pill doesn't fit and was spilling
                    // into the next column's label, so the header shows only the icon (the day-row break
                    // cells below still spell out "MORNING BREAK" etc. in full).
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${breakMeta(p.label).bg} ${breakMeta(p.label).text}`} title={p.label}>
                      {breakMeta(p.label).icon}
                    </span>
                  ) : (
                    <p className="truncate text-[12px] font-bold text-black/50 dark:text-white/50">{p.label}</p>
                  )}
                  {p.kind !== 'break' && <p className="mt-1 truncate text-[10px] text-black/40 dark:text-white/40">{p.start} – {p.end}</p>}
                </div>
              ))}
            </div>
            <div className="gap-1.5 pt-3" style={{ display: 'grid', gridTemplateColumns: colTemplate }}>
              {/* `contents` wrappers keep the grid flat without keyed Fragments (the dev inspector plugin decorates every JSX element) */}
              {days.map(d => (
                <div key={d} className="contents">
                  <div className={`sticky left-0 z-10 flex items-center bg-white py-4 text-[12px] font-bold uppercase tracking-wider dark:bg-[#14141f] ${today === d ? 'text-indigo-600 dark:text-indigo-400' : 'text-black/40 dark:text-white/40'}`}>
                    {DAY_LABELS[d].slice(0, 3)}
                  </div>
                  {periods.map(p => p.kind === 'break'
                    ? breakCell(p, cellKey(d, p.idx))
                    : <div key={cellKey(d, p.idx)} className="contents">{renderCell(d, p)}</div>)}
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Edge-fade affordance: a barely-visible native scrollbar was the only clue there was more to
            see, so periods 7-8 read as "the day ends here" instead of "scroll for more". */}
        {canScrollRight && <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white dark:from-[#14141f] to-transparent" />}
        {canScrollLeft && <div className="pointer-events-none absolute inset-y-0 left-12 z-10 w-8 bg-gradient-to-r from-white dark:from-[#14141f] to-transparent" />}
      </Card>

      {/* Mobile */}
      <div className="md:hidden">
        <div className="mb-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((d, i) => (
            <button key={d} onClick={() => setDayIdx(i)}
              className={`rounded-xl py-2.5 text-[13px] font-semibold transition-all ${activeDay === d ? 'bg-black text-white shadow-sm' : 'border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60'}`}>
              {DAY_LABELS[d].slice(0, 3)}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {periods.map(p => {
            if (p.kind === 'break') {
              const meta = breakMeta(p.label)
              return (
                <div key={p.idx} className={`flex items-center gap-3 rounded-xl ${meta.bg} px-4 py-3`}>
                  <span className={meta.text}>{meta.icon}</span>
                  <p className={`flex-1 text-[13.5px] font-semibold ${meta.text}`}>{p.label}</p>
                  <span className="text-[11px] font-medium text-black/40 dark:text-white/40">{p.start} – {p.end}</span>
                </div>
              )
            }
            return (
              <div key={p.idx} className="flex items-stretch gap-3">
                <div className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-xl text-[11px] font-bold ${isNow(p) && today === activeDay ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'bg-black/[.03] dark:bg-white/[.05] text-black/50 dark:text-white/50'}`}>
                  <span>{p.label}</span><span className="mt-0.5 font-medium opacity-70">{p.start}</span>
                </div>
                <div className="min-w-0 flex-1">{renderCell(activeDay, p)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

/**
 * The readable card used for a scheduled period. At narrow column widths the compact view truncates
 * subject/teacher names, so hovering (or focusing, for keyboard users) reveals a real detail overlay
 * with the untruncated text instead of relying on the native title tooltip alone.
 * `focusable` should be false when the card is already wrapped in its own interactive element (e.g. the
 * builder's edit button) — the group-hover/focus classes work either way since :hover/:focus-visible
 * cascade through the DOM regardless of which ancestor carries the `group` class.
 */
export function PeriodCard({ title, color, teacher, room, note, time, highlight, badge, className = '', focusable = true }: {
  title: string; color: string; teacher?: string; room?: string; note?: string; time?: string
  highlight?: boolean; badge?: React.ReactNode; className?: string; focusable?: boolean
}) {
  return (
    <div title={[title, teacher, room].filter(Boolean).join(' · ')} tabIndex={focusable ? 0 : undefined}
      className={`group relative flex min-h-[92px] flex-col overflow-hidden rounded-xl border bg-white dark:bg-[#14141f] py-2.5 pl-2 pr-2 outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-400 ${highlight ? 'border-indigo-300 ring-2 ring-indigo-200 dark:border-indigo-500/50 dark:ring-indigo-500/30' : 'border-black/[.06] dark:border-white/[.08]'} ${className}`}>
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />

      {/* compact view — fades out on hover/focus so the detail overlay can take over */}
      <div className="flex h-full flex-col transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0">
        <p className="truncate pl-2 text-[12.5px] font-semibold leading-tight" style={{ color }}>{title}</p>
        {teacher && (
          <p className="mt-1 flex items-center gap-1 truncate pl-2 text-[11px] text-black/50 dark:text-white/50">
            <User size={11} className="shrink-0" /><span className="truncate">{teacher}</span>
          </p>
        )}
        {note && <p className="mt-1 truncate pl-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">{note}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pl-2 pt-2">
          {room && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-black/[.04] dark:bg-white/[.06] px-1.5 py-0.5 text-[10px] font-semibold text-black/50 dark:text-white/50">
              <MapPin size={10} />{room}
            </span>
          )}
          {badge}
        </div>
      </div>

      {/* hover/focus detail overlay — untruncated subject, teacher, room, time */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-center gap-1 rounded-xl bg-white p-2.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-[#14141f]">
        <p className="break-words pl-1.5 text-[12px] font-semibold leading-tight" style={{ color }}>{title}</p>
        {time && (
          <p className="flex items-center gap-1.5 pl-1.5 text-[10.5px] text-black/55 dark:text-white/55">
            <Clock size={10} className="shrink-0" />{time}
          </p>
        )}
        {teacher && (
          <p className="flex items-center gap-1.5 pl-1.5 text-[10.5px] text-black/55 dark:text-white/55">
            <User size={10} className="shrink-0" /><span className="break-words">{teacher}</span>
          </p>
        )}
        {room && (
          <p className="flex items-center gap-1.5 pl-1.5 text-[10.5px] text-black/55 dark:text-white/55">
            <MapPin size={10} className="shrink-0" />{room}
          </p>
        )}
        {note && <p className="break-words pl-1.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-300">{note}</p>}
      </div>
    </div>
  )
}

export function FreeCell({ dense }: { dense?: boolean }) {
  return <div className={`${dense ? 'min-h-[76px]' : 'min-h-[92px]'} rounded-xl border border-dashed border-black/[.08] dark:border-white/[.10] bg-black/[.02] dark:bg-white/[.03]`} />
}

const DIAG_LABEL: Record<Diagnostic['type'], string> = { CAPACITY_EXCEEDED: 'Not enough periods exist', REQUIREMENT_UNSATISFIED: 'Requirement couldn\'t be placed' }

/**
 * Phase T6 §4 — the structured infeasibility diagnosis: real conflicting numbers and concrete suggested
 * actions, computed deterministically from the actual constraint model (never free-text guesswork or an
 * LLM call — see server/src/modules/timetable/diagnostics.ts). Replaces a bare "needs manual attention"
 * reason list per D9 — a dead-end error here is a real trust regression, so every card names the exact
 * numbers involved and what to do about it, never just "failed". Shared between Phase 26/T6's Auto-Generate
 * draft review (timetableBuilder.tsx) and Phase T8's what-if review (timetableWhatIf.tsx) — both surface the
 * exact same diagnostics shape, so one panel serves both rather than two near-duplicates.
 */
export function DiagnosticsPanel({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const capacity = diagnostics.filter((d): d is Extract<Diagnostic, { type: 'CAPACITY_EXCEEDED' }> => d.type === 'CAPACITY_EXCEEDED')
  const requirements = diagnostics.filter((d): d is Extract<Diagnostic, { type: 'REQUIREMENT_UNSATISFIED' }> => d.type === 'REQUIREMENT_UNSATISFIED')
  return (
    <Card className="border-rose-200 dark:border-rose-500/30 bg-rose-50/50 dark:bg-rose-500/[.05] p-5">
      <p className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold text-rose-700 dark:text-rose-300">
        <AlertTriangle size={15} /> Why generation couldn't place everything ({diagnostics.length})
      </p>
      <div className="space-y-3">
        {capacity.map((d, i) => (
          <div key={`cap-${i}`} className="rounded-2xl border border-rose-200 dark:border-rose-500/25 bg-white dark:bg-[#14141f] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="rose">{DIAG_LABEL[d.type]}</Pill>
              <p className="text-[13.5px] font-semibold">{d.cohortLabel}</p>
            </div>
            <p className="mt-2 text-[13px] text-black/70 dark:text-white/70">
              Requires <strong className="tabular-nums">{d.requiredPeriodsPerWeek}</strong> periods/week, but only <strong className="tabular-nums">{d.availablePeriodsPerWeek}</strong> class periods/week exist
              {' '}— short by <strong className="tabular-nums text-rose-600 dark:text-rose-400">{d.deficit}</strong>.
            </p>
            <SuggestedActions actions={d.suggestedActions} />
          </div>
        ))}
        {requirements.map((d, i) => (
          <div key={`req-${i}`} className="rounded-2xl border border-amber-200 dark:border-amber-500/25 bg-white dark:bg-[#14141f] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="amber">{DIAG_LABEL[d.type]}</Pill>
              <p className="text-[13.5px] font-semibold">{d.cohortLabel}{d.subjectName ? ` · ${d.subjectName}` : ''}</p>
              <span className="text-[12px] text-black/45 dark:text-white/45">{d.unplacedPeriods} period{d.unplacedPeriods === 1 ? '' : 's'} unplaced</span>
            </div>
            <p className="mt-2 text-[13px] text-black/70 dark:text-white/70">{d.reason}</p>
            <SuggestedActions actions={d.suggestedActions} />
          </div>
        ))}
      </div>
    </Card>
  )
}

function SuggestedActions({ actions }: { actions: string[] }) {
  if (!actions.length) return null
  return (
    <div className="mt-3 rounded-xl bg-black/[.03] dark:bg-white/[.05] p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-black/45 dark:text-white/45">
        <Lightbulb size={12} /> Suggested actions
      </p>
      <ul className="space-y-1 text-[12.5px] text-black/65 dark:text-white/65">
        {actions.map((a, i) => <li key={i}>• {a}</li>)}
      </ul>
    </div>
  )
}

function Legend({ entries, lookup, template }: { entries: TimetableEntryView[]; lookup: EntryLookup; template: PeriodTemplate }) {
  const subjects = new Map<string, string>()
  entries.forEach(e => subjects.set(lookup.subjectOf(e), lookup.colorOf(e)))
  const breaks = sortedPeriods(template).filter(p => p.kind === 'break')
  if (subjects.size === 0 && breaks.length === 0) return null
  return (
    <div className="mt-4 flex flex-wrap gap-2 rounded-2xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-4">
      {[...subjects.entries()].map(([name, color]) => (
        <div key={name} className="flex items-center gap-2 rounded-full bg-black/[.03] dark:bg-white/[.06] px-3 py-1.5">
          <span className="h-3 w-3 rounded-full" style={{ background: color }} />
          <span className="text-[12px] font-medium text-black/70 dark:text-white/70">{name}</span>
        </div>
      ))}
      {breaks.map(b => {
        const meta = breakMeta(b.label)
        return (
          <div key={b.idx} className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${meta.bg}`}>
            <span className={meta.text}>{meta.icon}</span>
            <span className={`text-[12px] font-medium ${meta.text}`}>{b.label} · {b.start} – {b.end}</span>
          </div>
        )
      })}
    </div>
  )
}

const Loading = () => <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading timetable…</div>

/* ── module ─────────────────────────────────────────────── */

export function TimetableMod() {
  const { db, user } = useStore()
  const { term, setTerm } = useActiveTerm()
  const role = user?.role
  const isTeacher = role === 'teacher'
  const isOwn = role === 'student' || role === 'parent'

  return (
    <div>
      <PageHead title={isTeacher ? 'My Timetable' : 'Timetable'} sub={isTeacher ? 'Your periods across classes · substitutions this week highlighted' : isOwn ? 'Weekly class schedule · breaks highlighted' : 'Published and draft timetables per class'}>
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>
      {!term ? (
        <Empty text="No term set up yet — timetables belong to a term." />
      ) : isOwn ? (
        <OwnTimetable term={term} />
      ) : isTeacher ? (
        <TeacherView term={term} teacherId={user!.id} />
      ) : (
        <ClassPicker term={term} />
      )}
    </div>
  )
}

/** Student / parent: `/timetable/me` for the viewed student; only published grids are shown. */
function OwnTimetable({ term }: { term: string }) {
  const { user } = useStore()
  const students = useViewedStudents()
  const [pickedWard, setPickedWard] = useState('')
  const student = students.find(s => s.id === pickedWard) ?? students[0]
  const isParent = user?.role === 'parent'
  const { data, loading, error } = useMyTimetable(term, { enabled: !!student, studentId: isParent ? student?.id : undefined })
  const { classOf, templateFor } = useAcademic()
  const lookup = useEntryLookup()
  const now = useClock()

  if (!student) return <Empty text={isParent ? 'No student is linked to this parent account yet.' : 'You are not enrolled in a class yet.'} />
  const cls = classOf(student.id)
  const template = data?.template ?? templateFor(cls?.id)
  const entries = data?.entries ?? []
  const byKey = new Map(entries.map(e => [cellKey(e.dayOfWeek, e.periodIdx), e]))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {cls && <Pill tone="indigo">Class {cls.label}</Pill>}
        {isParent && students.length > 1 && (
          <select value={student.id} onChange={e => setPickedWard(e.target.value)} className={inputCls + ' w-auto min-w-[180px] py-2 text-[13.5px]'} aria-label="Ward">
            {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {isParent && students.length === 1 && <span className="text-[13px] text-black/50 dark:text-white/50">{student.name}</span>}
        {data?.published && data.publishedAt && <span className="text-[12px] text-black/40 dark:text-white/40">Published {new Date(data.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
      </div>
      {loading ? <Loading />
        : error ? <Empty text={error} />
        : !data?.published || entries.length === 0 ? <Empty text="Timetable not published yet." />
        : !template ? <Empty text="No period template is defined for this class yet." />
        : (
          <>
            <TimetableGrid template={template} days={daysFor(entries)} now={now} renderCell={(d, p) => {
              const e = byKey.get(cellKey(d, p.idx))
              if (!e) return <FreeCell />
              return <PeriodCard title={lookup.subjectOf(e)} color={lookup.colorOf(e)} teacher={lookup.teacherOf(e)} room={lookup.roomOf(e)}
                time={`${p.start} – ${p.end}`} highlight={isRunning(p, d, now)} />
            }} />
            <Legend entries={entries} lookup={lookup} template={template} />
          </>
        )}
    </div>
  )
}

/** Teacher: `/timetable/teacher/:id` — cells show class + subject + room; this week's substitutions are called out. */
function TeacherView({ term, teacherId }: { term: string; teacherId: string }) {
  const { data, loading, error } = useFetch<TeacherTimetable>(`/timetable/teacher/${encodeURIComponent(teacherId)}?termId=${encodeURIComponent(term)}`)
  const { templateFor } = useAcademic()
  const lookup = useEntryLookup()
  const now = useClock()
  const entries = useMemo(() => data?.entries ?? [], [data])
  const template = templateFor(entries[0]?.classId)
  const byKey = new Map(entries.map(e => [cellKey(e.dayOfWeek, e.periodIdx), e]))

  // substitutions in the current Mon–Sat week
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0)
  const saturday = new Date(monday); saturday.setDate(monday.getDate() + 5)
  const weekSubs = (data?.substitutions ?? []).filter(s => s.date >= isoDate(monday) && s.date <= isoDate(saturday))
  const entryById = new Map(entries.map(e => [e.id, e]))
  // my own periods someone else covers → "Covered by"; other teachers' periods I cover → drawn into the free slot
  const coveredByEntry = new Map(weekSubs.filter(s => entryById.has(s.timetableEntryId)).map(s => [s.timetableEntryId, s]))
  const covering = weekSubs.filter(s => !entryById.has(s.timetableEntryId) && s.entry)
  const coveringByKey = new Map(covering.map(s => [cellKey(s.entry!.dayOfWeek, s.entry!.periodIdx), s]))
  const fmtDay = (d: string) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  const gridDays = daysFor([...entries, ...covering.map(s => s.entry!)])

  if (loading) return <Loading />
  if (error) return <Empty text={error} />
  if (entries.length === 0 && covering.length === 0) return <Empty text="No periods assigned to you in this term yet." />
  if (!template) return <Empty text="No period template is defined yet — ask the office to set one up under Periods." />

  return (
    <div>
      <TimetableGrid template={template} days={gridDays} now={now} renderCell={(d, p) => {
        const e = byKey.get(cellKey(d, p.idx))
        if (!e) {
          const cover = coveringByKey.get(cellKey(d, p.idx))
          if (!cover?.entry) return <FreeCell />
          return <PeriodCard title={lookup.classLabelOf(cover.entry) ?? lookup.subjectOf(cover.entry)} color={lookup.colorOf(cover.entry)} room={lookup.roomOf(cover.entry)}
            teacher={lookup.subjectOf(cover.entry)} time={`${p.start} – ${p.end}`}
            note={`You cover · ${fmtDay(cover.date)}`} highlight={isRunning(p, d, now)}
            badge={<Pill tone="amber">Substitution</Pill>} className="border-dashed bg-amber-50/60 dark:bg-amber-500/5" />
        }
        const sub = coveredByEntry.get(e.id)
        // teachers scan by class first, so the class label leads and the subject sits underneath
        return <PeriodCard title={lookup.classLabelOf(e) ?? lookup.subjectOf(e)} color={lookup.colorOf(e)} room={lookup.roomOf(e)}
          teacher={lookup.subjectOf(e)} time={`${p.start} – ${p.end}`}
          note={sub ? `Covered by ${lookup.userName(sub.substituteTeacherId) ?? 'a colleague'} · ${fmtDay(sub.date)}` : undefined}
          highlight={isRunning(p, d, now)}
          className={sub ? 'bg-amber-50/60 dark:bg-amber-500/5' : ''} />
      }} />
      {weekSubs.length > 0 && (
        <Card className="mt-4 p-5">
          <p className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Substitutions this week</p>
          <div className="space-y-2">
            {weekSubs.map(s => {
              const own = entryById.get(s.timetableEntryId)
              const en = own ?? s.entry
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-400/10 px-4 py-2.5 text-[13.5px]">
                  <Users size={14} className="text-amber-700 dark:text-amber-300" />
                  <span className="font-semibold">{fmtDay(s.date)}</span>
                  <span className="text-black/60 dark:text-white/60">
                    {own ? `${lookup.userName(s.substituteTeacherId) ?? 'A colleague'} covers your` : 'You cover'}
                    {en ? ` ${lookup.classLabelOf(en) ?? ''} ${lookup.subjectOf(en)}`.replace(/\s+/g, ' ') : ' period'}
                    {s.reason ? ` · ${s.reason}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}
      <Legend entries={entries} lookup={lookup} template={template} />
    </div>
  )
}

/** Admin / staff: pick a class, see its grid (draft or published). */
function ClassPicker({ term }: { term: string }) {
  const { classes, currentYear, templateFor } = useAcademic()
  const list = useMemo(() => classes.filter(c => !currentYear || c.academicYearId === currentYear.id).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })), [classes, currentYear])
  const [picked, setPicked] = useState('')
  const classId = list.some(c => c.id === picked) ? picked : (list[0]?.id ?? '')
  const { data, loading, error, reload } = useFetch<ClassTimetable>(classId ? `/timetable?classId=${encodeURIComponent(classId)}&termId=${encodeURIComponent(term)}` : null)
  const lookup = useEntryLookup()
  const now = useClock()
  const entries = data?.entries ?? []
  const template = data?.template ?? templateFor(classId)
  const byKey = new Map(entries.map(e => [cellKey(e.dayOfWeek, e.periodIdx), e]))

  if (list.length === 0) return <Empty text="No classes in the current year yet." />
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={classId} onChange={e => setPicked(e.target.value)} className={inputCls + ' w-auto min-w-[160px] py-2 text-[13.5px]'} aria-label="Class">
          {list.map(c => <option key={c.id} value={c.id}>{c.label} · {c.boardCode}</option>)}
        </select>
        {data && (data.published ? <Pill tone="green">Published</Pill> : <Pill tone="amber">Draft</Pill>)}
        <span className="flex items-center gap-1 text-[12px] text-black/40 dark:text-white/40"><Clock size={12} /> {entries.length} period{entries.length === 1 ? '' : 's'} scheduled</span>
      </div>
      {loading ? <Loading />
        : error ? <Empty text={error} />
        : entries.length === 0 ? <Empty text="Nothing scheduled for this class yet — build it under Timetable Builder." />
        : !template ? <Empty text="No period template is defined for this class yet." />
        : (
          <>
            <TimetableGrid template={template} days={daysFor(entries)} now={now} renderCell={(d, p) => {
              const e = byKey.get(cellKey(d, p.idx))
              if (!e) return <FreeCell />
              return <PeriodCard title={lookup.subjectOf(e)} color={lookup.colorOf(e)} teacher={lookup.teacherOf(e)} room={lookup.roomOf(e)}
                time={`${p.start} – ${p.end}`} highlight={isRunning(p, d, now)} />
            }} />
            <Legend entries={entries} lookup={lookup} template={template} />
            <AssignSubstitute entries={entries} lookup={lookup} template={template} onAssigned={reload} />
          </>
        )}
    </div>
  )
}

/**
 * Phase 19 item 5 — smart substitute suggestion. Extends the existing `Substitution` model (`POST
 * /substitutions`, see server/src/modules/substitutions/) with the picker itself, which didn't exist in the
 * frontend yet — no prior screen called that endpoint. Placed under the staff/admin class timetable view
 * since that's where an office user already sees which teacher is on which period. The "Suggested" list
 * (free that period, teaches the subject preferred, sorted by current workload) sits above a manual
 * teacher dropdown so the ranked suggestions augment rather than replace picking anyone by hand.
 */
function AssignSubstitute({ entries, lookup, template, onAssigned }: { entries: TimetableEntryView[]; lookup: EntryLookup; template: PeriodTemplate; onAssigned: () => void }) {
  const [entryId, setEntryId] = useState('')
  const [date, setDate] = useState(() => isoDate(new Date()))
  const [reason, setReason] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [busy, setBusy] = useState(false)
  const periods = sortedPeriods(template).filter(p => p.kind === 'class')
  const sortedEntries = useMemo(() => [...entries].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.periodIdx - b.periodIdx), [entries])
  const entry = sortedEntries.find(e => e.id === entryId) ?? sortedEntries[0]
  const periodLabel = (e?: TimetableEntryView) => e ? `${DAY_LABELS[e.dayOfWeek].slice(0, 3)} · ${periods.find(p => p.idx === e.periodIdx)?.label ?? `Period ${e.periodIdx}`} · ${lookup.subjectOf(e)}` : ''

  const { items: suggestions, loading: suggestLoading } = useSubstituteSuggestions(
    { classSubjectId: entry?.classSubjectId, date, periodIdx: entry?.periodIdx }, !!entry && !!date,
  )
  const assign = async (substituteTeacherId: string) => {
    if (!entry) return
    setBusy(true)
    try {
      await api.post('/substitutions', { timetableEntryId: entry.id, date, substituteTeacherId, reason: reason.trim() || undefined })
      toast.success('Substitute assigned')
      setReason(''); setTeacherId('')
      onAssigned()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  if (sortedEntries.length === 0) return null
  return (
    <Card className="mt-4">
      <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Assign a substitute</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Period">
          <select value={entry?.id ?? ''} onChange={e => setEntryId(e.target.value)} className={inputCls}>
            {sortedEntries.map(e => <option key={e.id} value={e.id}>{periodLabel(e)}</option>)}
          </select>
        </Field>
        <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Reason (optional)"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. sick leave" className={inputCls} /></Field>
      </div>

      <p className="mb-2 mt-4 flex items-center gap-1.5 text-[12.5px] font-semibold text-black/50 dark:text-white/50"><Sparkles size={13} /> Suggested</p>
      {suggestLoading ? <p className="text-[12.5px] text-black/40 dark:text-white/40">Finding free teachers…</p>
        : (suggestions ?? []).length === 0 ? <p className="text-[12.5px] text-black/40 dark:text-white/40">No free, matching teacher found for this slot — pick manually below.</p>
        : (
          <div className="flex flex-wrap gap-2">
            {(suggestions ?? []).slice(0, 5).map(s => (
              <button key={s.teacherId} onClick={() => assign(s.teacherId)} disabled={busy}
                className="flex items-center gap-2 rounded-full border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/70 dark:bg-indigo-500/10 px-3.5 py-2 text-[12.5px] font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 disabled:opacity-40">
                {s.teacherName}
                {s.teachesSubject && <Pill tone="indigo">teaches subject</Pill>}
                <span className="font-normal opacity-70">{s.periodsPerWeek}/wk</span>
              </button>
            ))}
          </div>
        )}

      <div className="mt-4 flex flex-wrap items-start gap-2">
        <div className="w-auto min-w-[200px]">
          <AsyncEntityPicker role="teacher" value={teacherId} onChange={id => setTeacherId(id)} placeholder="Pick manually…" />
        </div>
        <button onClick={() => teacherId && assign(teacherId)} disabled={!teacherId || busy} className="btn-ink px-5 py-2 text-[13px] font-semibold disabled:opacity-40">{busy ? 'Assigning…' : 'Assign'}</button>
      </div>
    </Card>
  )
}
