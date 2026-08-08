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

      {/* Desktop: days as columns, periods as rows */}
      <Card className="hidden md:block overflow-hidden p-0">
        <div className="overflow-auto thin-scroll">
          <div className="min-w-[720px] p-5">
            <div className="sticky top-0 z-10 grid grid-cols-[80px_repeat(5,1fr)] gap-3 bg-white dark:bg-[#14141f] pb-2">
              <div />
              {DAYS.map(d => (
                <div key={d} className="px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[80px_repeat(5,1fr)] gap-3">
              {PERIODS.map((p, pi) => (
                <Fragment key={p}>
                  <div className="flex items-center justify-end pr-2 text-[12px] font-semibold text-black/40 dark:text-white/40">
                    {p}
                  </div>
                  {DAYS.map((d, di) => {
                    const cell = grid[di]?.[pi]
                    if (!cell) return <div key={`${d}-${p}`} />
                    const sub = subjects.get(cell.subject)
                    const col = sub?.color ?? '#6366f1'
                    return (
                      <div
                        key={`${d}-${p}`}
                        className="rounded-2xl p-3 shadow-sm transition-all hover:scale-[1.03] hover:shadow-md"
                        style={{ background: `${col}14`, borderLeft: `4px solid ${col}` }}
                      >
                        <p className="text-[13px] font-semibold leading-tight" style={{ color: col }}>
                          {cell.subject}
                        </p>
                        <p className="mt-1 text-[11px] text-black/45 dark:text-white/45">{cell.room}</p>
                        <p className="mt-0.5 text-[11px] text-black/40 dark:text-white/40">{cell.time}</p>
                        <div className="mt-2.5 flex items-center gap-2">
                          <Avatar name={sub?.teacher ?? cell.subject} hue={hexToHue(col)} size={28} />
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

      {/* Mobile: day picker + vertical period list */}
      <div className="md:hidden">
        <div className="mb-4 grid grid-cols-5 gap-2">
          {DAYS.map((d, i) => (
            <button
              key={d}
              onClick={() => setDayIdx(i)}
              className={`rounded-full py-2 text-[13px] font-semibold transition-all ${dayIdx === i ? 'bg-black text-white shadow-sm' : 'border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60'}`}
            >
              {d.slice(0, 3)}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {PERIODS.map((p, pi) => {
            const cell = grid[dayIdx]?.[pi]
            if (!cell) return null
            const sub = subjects.get(cell.subject)
            const col = sub?.color ?? '#6366f1'
            return (
              <div
                key={p}
                className="rounded-3xl border border-black/[.06] dark:border-white/[.08] p-4 shadow-sm"
                style={{ background: `${col}10`, borderLeft: `4px solid ${col}` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-[14px] font-semibold" style={{ color: col }}>
                      {cell.subject}
                    </p>
                    <p className="mt-0.5 text-[12px] text-black/45 dark:text-white/45">{cell.room}</p>
                  </div>
                  <span className="shrink-0 text-[12px] font-semibold text-black/50 dark:text-white/50">{cell.time}</span>
                </div>
                <div className="mt-3 flex items-center gap-2.5">
                  <Avatar name={sub?.teacher ?? cell.subject} hue={hexToHue(col)} size={32} />
                  <span className="text-[12px] font-medium text-black/60 dark:text-white/60">{sub?.teacher ?? '—'}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Subject color legend */}
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
