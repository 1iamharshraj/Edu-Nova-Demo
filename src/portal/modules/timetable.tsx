import { Fragment, useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { DAYS, PERIODS } from '@/lib/data'
import type { Subject } from '@/lib/data'
import { Avatar, Card, PageHead, TermTabs } from '../ui'
import { useTerm } from '../Portal'

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
      <PageHead title="Timetable" sub="Class X-A · switch terms to compare schedules">
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>

      {/* Desktop */}
      <Card className="hidden md:block overflow-hidden p-0">
        <div className="overflow-auto thin-scroll">
          <div className="min-w-[620px] p-4 lg:min-w-0">
            {/* header */}
            <div className="sticky top-0 z-10 grid grid-cols-[72px_repeat(5,1fr)] gap-2 border-b border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] pb-3">
              <div />
              {DAYS.map(d => (
                <div key={d} className="px-2 py-2 text-center text-[12px] font-bold uppercase tracking-wider text-black/40 dark:text-white/40">
                  {d}
                </div>
              ))}
            </div>
            {/* grid */}
            <div className="grid grid-cols-[72px_repeat(5,1fr)] gap-2 pt-3">
              {PERIODS.map((p) => (
                <Fragment key={p}>
                  <div className="flex flex-col items-end justify-center pr-2 text-[11px] font-semibold text-black/40 dark:text-white/40">
                    <span>{p}</span>
                  </div>
                  {DAYS.map((d, di) => {
                    const cell = grid[di]?.find(c => c.time === p)
                    if (!cell) return <div key={`${d}-${p}`} className="rounded-2xl border border-dashed border-black/[.08] dark:border-white/[.10] bg-black/[.02] dark:bg-white/[.03]" />
                    const sub = subjects.get(cell.subject)
                    const col = sub?.color ?? '#6366f1'
                    return (
                      <div
                        key={`${d}-${p}`}
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
          {PERIODS.map((p) => {
            const cell = grid[dayIdx]?.find(c => c.time === p)
            if (!cell) return null
            const sub = subjects.get(cell.subject)
            const col = sub?.color ?? '#6366f1'
            return (
              <div
                key={p}
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
                  <span className="shrink-0 rounded-md bg-black/[.04] dark:bg-white/[.06] px-2 py-0.5 text-[11px] font-semibold text-black/50 dark:text-white/50">{p}</span>
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
      </div>
    </div>
  )
}
