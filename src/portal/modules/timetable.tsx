import { Fragment, useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { DAYS, TIMESLOTS } from '@/lib/data'
import type { Subject, TTCell } from '@/lib/data'
import { Card, PageHead, TermTabs } from '../ui'
import { useTerm } from '../Portal'
import { Coffee, Sun, Utensils, Clock, MapPin, User } from 'lucide-react'

const BREAK_META: Record<string, { icon: React.ReactNode; bg: string; text: string }> = {
  'Morning Break': { icon: <Sun size={14} />, bg: 'bg-amber-400/10 dark:bg-amber-400/10', text: 'text-amber-700 dark:text-amber-300' },
  'Lunch Break': { icon: <Utensils size={14} />, bg: 'bg-emerald-400/10 dark:bg-emerald-400/10', text: 'text-emerald-700 dark:text-emerald-300' },
  'Evening Break': { icon: <Coffee size={14} />, bg: 'bg-sky-400/10 dark:bg-sky-400/10', text: 'text-sky-700 dark:text-sky-300' },
}

function isBreak(cell: TTCell | undefined) {
  if (!cell) return false
  return cell.subject === 'Morning Break' || cell.subject === 'Lunch Break' || cell.subject === 'Evening Break'
}

export function TimetableMod() {
  const { db } = useStore()
  const { term, setTerm } = useTerm()
  const grid = db.timetable[term] ?? []
  const [dayIdx, setDayIdx] = useState(0)

  const subjects = useMemo(() => {
    const map = new Map<string, Subject>()
    for (const s of db.subjects) map.set(s.name, s)
    return map
  }, [db.subjects])

  // column widths: classes get 1fr, breaks get 0.7fr
  const colTemplate = `72px ${TIMESLOTS.map(s => s.kind === 'break' ? '0.7fr' : '1fr').join(' ')}`

  return (
    <div>
      <PageHead title="Timetable" sub="Class X-A · 09:00 to 17:00 · breaks highlighted">
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>

      {/* Desktop */}
      <Card className="hidden md:block overflow-hidden p-0">
        <div className="overflow-x-auto thin-scroll">
          <div className="min-w-[980px] p-4 lg:min-w-0">
            {/* header */}
            <div
              className="sticky top-0 z-10 gap-2 border-b border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] pb-3"
              style={{ display: 'grid', gridTemplateColumns: colTemplate }}
            >
              <div />
              {TIMESLOTS.map(slot => (
                <div key={slot.time} className="px-1 py-2 text-center">
                  {slot.kind === 'break' ? (
                    <div className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${BREAK_META[slot.label].bg} ${BREAK_META[slot.label].text}`}>
                      {BREAK_META[slot.label].icon}
                      Break
                    </div>
                  ) : (
                    <p className="text-[12px] font-bold text-black/50 dark:text-white/50">{slot.label}</p>
                  )}
                  {slot.duration && (
                    <p className="mt-1 text-[10px] text-black/40 dark:text-white/40">{slot.duration}</p>
                  )}
                </div>
              ))}
            </div>

            {/* grid */}
            <div className="gap-2 pt-3" style={{ display: 'grid', gridTemplateColumns: colTemplate }}>
              {DAYS.map((day, di) => (
                <Fragment key={day}>
                  <div className="flex items-center py-4 text-[12px] font-bold uppercase tracking-wider text-black/40 dark:text-white/40">
                    {day.slice(0, 3)}
                  </div>
                  {TIMESLOTS.map(slot => {
                    const cell = grid[di]?.find(c => c.time === slot.time)
                    if (!cell) return <div key={`${day}-${slot.time}`} className="rounded-xl border border-dashed border-black/[.08] dark:border-white/[.10] bg-black/[.02] dark:bg-white/[.03]" />

                    if (isBreak(cell)) {
                      const meta = BREAK_META[cell.subject]
                      return (
                        <div
                          key={`${day}-${slot.time}`}
                          className={`flex flex-col items-center justify-center gap-1 rounded-xl border border-transparent ${meta.bg} py-4 text-center`}
                        >
                          <span className={meta.text}>{meta.icon}</span>
                          <span className={`text-[10px] font-semibold uppercase tracking-wide ${meta.text}`}>{cell.subject}</span>
                        </div>
                      )
                    }

                    const sub = subjects.get(cell.subject)
                    const col = sub?.color ?? '#6366f1'
                    return (
                      <div
                        key={`${day}-${slot.time}`}
                        className="group relative overflow-hidden rounded-xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-3 transition-all hover:shadow-md"
                      >
                        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: col }} />
                        {/* default compact view */}
                        <div className="transition-opacity group-hover:opacity-0">
                          <p className="pl-2.5 text-[13px] font-semibold leading-tight" style={{ color: col }}>
                            {cell.subject}
                          </p>
                          <p className="mt-1 pl-2.5 text-[11px] text-black/50 dark:text-white/50 truncate">
                            {sub?.teacher ?? '—'}
                          </p>
                          <div className="mt-2 pl-2.5">
                            <span className="inline-block rounded-md bg-black/[.04] dark:bg-white/[.06] px-1.5 py-0.5 text-[10px] font-semibold text-black/50 dark:text-white/50">
                              {cell.room}
                            </span>
                          </div>
                        </div>
                        {/* hover detail overlay */}
                        <div className="absolute inset-0 z-10 flex flex-col justify-center gap-1.5 rounded-xl bg-white/95 dark:bg-[#14141f]/95 p-3 opacity-0 transition-opacity group-hover:opacity-100">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full" style={{ background: col }} />
                            <p className="text-[13px] font-semibold" style={{ color: col }}>{cell.subject}</p>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-black/60 dark:text-white/60">
                            <Clock size={12} />
                            <span>{slot.time}{slot.duration ? ` · ${slot.duration}` : ''}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-black/60 dark:text-white/60">
                            <MapPin size={12} />
                            <span>{cell.room}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-black/60 dark:text-white/60">
                            <User size={12} />
                            <span className="truncate">{sub?.teacher ?? '—'}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Mobile */}
      <div className="md:hidden">
        <div className="mb-4 grid grid-cols-5 gap-2">
          {DAYS.map((d, i) => (
            <button
              key={d}
              onClick={() => setDayIdx(i)}
              className={`rounded-xl py-2.5 text-[13px] font-semibold transition-all ${dayIdx === i ? 'bg-black text-white shadow-sm' : 'border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60'}`}
            >
              {d.slice(0, 3)}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {TIMESLOTS.map(slot => {
            const cell = grid[dayIdx]?.find(c => c.time === slot.time)
            if (!cell) return null
            if (isBreak(cell)) {
              const meta = BREAK_META[cell.subject]
              return (
                <div key={slot.time} className={`flex items-center gap-3 rounded-xl border border-transparent ${meta.bg} p-4`}>
                  <span className={meta.text}>{meta.icon}</span>
                  <div className="flex-1">
                    <p className={`text-[14px] font-semibold ${meta.text}`}>{cell.subject}</p>
                    <p className="text-[12px] text-black/50 dark:text-white/50">{slot.duration}</p>
                  </div>
                  <span className="text-[11px] font-medium text-black/40 dark:text-white/40">{slot.time}</span>
                </div>
              )
            }
            const sub = subjects.get(cell.subject)
            const col = sub?.color ?? '#6366f1'
            return (
              <div
                key={slot.time}
                className="relative overflow-hidden rounded-xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-4"
              >
                <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: col }} />
                <div className="flex items-start justify-between gap-3 pl-2.5">
                  <div className="flex-1">
                    <p className="text-[15px] font-semibold" style={{ color: col }}>{cell.subject}</p>
                    <p className="mt-0.5 text-[12px] text-black/50 dark:text-white/50">{sub?.teacher ?? '—'} · {cell.room}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-black/[.04] dark:bg-white/[.06] px-2 py-0.5 text-[11px] font-semibold text-black/50 dark:text-white/50">{slot.time}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-2 rounded-2xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-4">
        {db.subjects.map(s => (
          <div key={s.id} className="flex items-center gap-2 rounded-full bg-black/[.03] dark:bg-white/[.06] px-3 py-1.5">
            <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />
            <span className="text-[12px] font-medium text-black/70 dark:text-white/70">{s.name}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 rounded-full bg-amber-50 dark:bg-amber-500/10 px-3 py-1.5">
          <Sun size={12} className="text-amber-600 dark:text-amber-400" />
          <span className="text-[12px] font-medium text-amber-700 dark:text-amber-300">Break</span>
        </div>
      </div>
    </div>
  )
}
