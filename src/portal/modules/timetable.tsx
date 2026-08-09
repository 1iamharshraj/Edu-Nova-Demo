import { Fragment, useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { DAYS, TIMESLOTS } from '@/lib/data'
import type { Subject, TTCell } from '@/lib/data'
import { Avatar, Card, PageHead, TermTabs } from '../ui'
import { useTerm } from '../Portal'
import { Coffee, Utensils, Sun } from 'lucide-react'

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h /= 6
  return Math.round(h * 360)
}

const BREAK_META: Record<string, { icon: React.ReactNode; tone: string; bg: string; border: string; text: string }> = {
  'Morning Break': { icon: <Sun size={14} />, tone: 'amber', bg: 'bg-amber-50/60 dark:bg-amber-500/10', border: 'border-amber-200/70 dark:border-amber-500/20', text: 'text-amber-700 dark:text-amber-300' },
  'Lunch Break': { icon: <Utensils size={14} />, tone: 'emerald', bg: 'bg-emerald-50/60 dark:bg-emerald-500/10', border: 'border-emerald-200/70 dark:border-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-300' },
  'Evening Break': { icon: <Coffee size={14} />, tone: 'sky', bg: 'bg-sky-50/60 dark:bg-sky-500/10', border: 'border-sky-200/70 dark:border-sky-500/20', text: 'text-sky-700 dark:text-sky-300' },
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

  return (
    <div>
      <PageHead title="Timetable" sub="Class X-A · 09:00 to 17:00 · breaks shown in colour">
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>

      {/* Desktop */}
      <Card className="hidden md:block overflow-hidden p-0">
        <div className="overflow-auto thin-scroll">
          <div className="min-w-[720px] p-4 lg:min-w-0">
            {/* header: time slots */}
            <div className="sticky top-0 z-10 grid grid-cols-[96px_repeat(11,1fr)] gap-2 border-b border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] pb-3">
              <div />
              {TIMESLOTS.map(slot => (
                <div key={slot.time} className="px-1 py-2 text-center">
                  <p className={`text-[11px] font-bold uppercase tracking-wider ${slot.kind === 'break' ? 'text-amber-600 dark:text-amber-400' : 'text-black/40 dark:text-white/40'}`}>
                    {slot.kind === 'break' ? 'Break' : slot.label}
                  </p>
                  {slot.kind === 'break' && (
                    <p className="mt-0.5 text-[10px] font-medium text-black/50 dark:text-white/50">{slot.duration}</p>
                  )}
                </div>
              ))}
            </div>
            {/* grid: days as rows */}
            <div className="grid grid-cols-[96px_repeat(11,1fr)] gap-2 pt-3">
              {DAYS.map((day, di) => (
                <Fragment key={day}>
                  <div className="flex items-center justify-start py-3 text-[12px] font-bold uppercase tracking-wider text-black/40 dark:text-white/40">
                    {day.slice(0, 3)}
                  </div>
                  {TIMESLOTS.map(slot => {
                    const cell = grid[di]?.find(c => c.time === slot.time)
                    if (!cell) return <div key={`${day}-${slot.time}`} className="rounded-2xl border border-dashed border-black/[.08] dark:border-white/[.10] bg-black/[.02] dark:bg-white/[.03]" />
                    if (isBreak(cell)) {
                      const meta = BREAK_META[cell.subject]
                      return (
                        <div
                          key={`${day}-${slot.time}`}
                          className={`flex flex-col items-center justify-center gap-1 rounded-2xl border ${meta.border} ${meta.bg} p-2 text-center`}
                        >
                          <span className={`${meta.text}`}>{meta.icon}</span>
                          <span className={`text-[10px] font-semibold leading-tight ${meta.text}`}>{cell.subject}</span>
                        </div>
                      )
                    }
                    const sub = subjects.get(cell.subject)
                    const col = sub?.color ?? '#6366f1'
                    return (
                      <div
                        key={`${day}-${slot.time}`}
                        className="group relative overflow-hidden rounded-2xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-3 transition-all hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full" style={{ background: col }} />
                        <p className="pl-2.5 text-[13px] font-semibold leading-tight" style={{ color: col }}>
                          {cell.subject}
                        </p>
                        <div className="mt-2.5 flex items-center justify-between pl-2.5 text-[11px] text-black/50 dark:text-white/50">
                          <span>{cell.time}</span>
                          <span className="rounded-md bg-black/[.04] dark:bg-white/[.06] px-1.5 py-0.5 font-medium">{cell.room}</span>
                        </div>
                        <div className="mt-2.5 flex items-center gap-2 pl-2.5">
                          <Avatar name={sub?.teacher ?? cell.subject} hue={hexToHue(col)} size={24} />
                          <span className="truncate text-[11px] font-medium text-black/60 dark:text-white/60">
                            {sub?.teacher ?? '—'}
                          </span>
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
                <div key={slot.time} className={`flex items-center gap-3 rounded-2xl border ${meta.border} ${meta.bg} p-4`}>
                  <span className={`${meta.text}`}>{meta.icon}</span>
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
                className="relative overflow-hidden rounded-2xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-4"
              >
                <div className="absolute left-0 top-3 bottom-3 w-1 rounded-full" style={{ background: col }} />
                <div className="flex items-start justify-between gap-3 pl-2.5">
                  <div className="flex-1">
                    <p className="text-[14.5px] font-semibold" style={{ color: col }}>
                      {cell.subject}
                    </p>
                    <p className="mt-0.5 text-[12px] text-black/45 dark:text-white/45">{cell.room}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-black/[.04] dark:bg-white/[.06] px-2 py-0.5 text-[11px] font-semibold text-black/50 dark:text-white/50">{slot.time}</span>
                </div>
                <div className="mt-3 flex items-center gap-2.5 pl-2.5">
                  <Avatar name={sub?.teacher ?? cell.subject} hue={hexToHue(col)} size={32} />
                  <span className="text-[12px] font-medium text-black/60 dark:text-white/60">{sub?.teacher ?? '—'}</span>
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
