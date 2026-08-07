import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Download, Mail, Phone, Trophy } from 'lucide-react'
import { useStore } from '@/lib/store'
import { DAYS, PERIODS, fmtINR, gradeFor, pctFor } from '@/lib/data'
import { Avatar, Card, Empty, PageHead, Pill, Progress, TermTabs } from '../ui'
import { useTerm } from '../Portal'

/* ── Timetable ─────────────────────────────────────────── */

export function TimetableMod() {
  const { db } = useStore()
  const { term, setTerm } = useTerm()
  const grid = db.timetable[term]
  const colors: Record<string, string> = Object.fromEntries(db.subjects.map(s => [s.name, s.color]))
  return (
    <div>
      <PageHead title="Timetable" sub="Class X-A · switch terms to compare schedules">
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>
      <Card className="overflow-x-auto p-4 thin-scroll">
        <table className="w-full min-w-[760px] border-separate border-spacing-1.5">
          <thead>
            <tr>
              <th className="w-20" />
              {DAYS.map(d => <th key={d} className="pb-2 text-left text-[12px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERIODS.map((p, pi) => (
              <tr key={p}>
                <td className="pr-2 text-right text-[12px] font-semibold text-black/40 dark:text-white/40">{p}</td>
                {DAYS.map((d, di) => {
                  const c = grid[di][pi]
                  const col = colors[c.subject] ?? '#6366f1'
                  return (
                    <td key={d}>
                      <div className="rounded-xl px-3 py-2.5 transition-transform hover:scale-[1.03]"
                        style={{ background: col + '14', borderLeft: `3px solid ${col}` }}>
                        <p className="text-[13px] font-semibold leading-tight" style={{ color: col }}>{c.subject}</p>
                        <p className="text-[11px] text-black/45 dark:text-white/45">{c.room}</p>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

/* ── Attendance ────────────────────────────────────────── */

export function AttendanceMod({ readOnly = true }: { readOnly?: boolean }) {
  const { db } = useStore()
  const { term, setTerm } = useTerm()
  const data = db.attendance[term]
  const totalP = data.bySubject.reduce((a, s) => a + s.present, 0)
  const totalT = data.bySubject.reduce((a, s) => a + s.total, 0)
  const overall = Math.round((totalP / totalT) * 100)
  void readOnly
  return (
    <div>
      <PageHead title="Attendance" sub="Subject-wise and daily record for Aarav Sharma">
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Overall</p>
            <Pill tone={overall >= 90 ? 'green' : overall >= 75 ? 'amber' : 'rose'}>{overall}%</Pill>
          </div>
          <div className="mt-4 flex items-end gap-2">
            <span className="font-display text-6xl font-medium">{overall}<span className="text-3xl">%</span></span>
            <span className="pb-2 text-[13px] text-black/45 dark:text-white/45">{totalP}/{totalT} periods</span>
          </div>
          <div className="mt-6 space-y-4">
            {data.bySubject.map((s) => {
              const pct = Math.round((s.present / s.total) * 100)
              return (
                <div key={s.subject}>
                  <div className="mb-1.5 flex justify-between text-[13px]">
                    <span className="font-medium">{s.subject}</span>
                    <span className="text-black/45 dark:text-white/45">{s.present}/{s.total} · {pct}%</span>
                  </div>
                  <Progress pct={pct} color={pct >= 90 ? '#10b981' : pct >= 75 ? '#f59e0b' : '#ef4444'} />
                </div>
              )
            })}
          </div>
        </Card>
        <Card>
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Daily log</p>
          <div className="grid max-h-[380px] grid-cols-7 gap-1.5 overflow-y-auto thin-scroll">
            {data.days.map((d) => (
              <div key={d.date} title={`${d.date} · ${d.status === 'P' ? 'Present' : d.status === 'A' ? 'Absent' : 'Leave'}`}
                className={`flex aspect-square flex-col items-center justify-center rounded-lg text-[11px] font-semibold ${d.status === 'P' ? 'bg-emerald-50 text-emerald-600' : d.status === 'A' ? 'bg-rose-100 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
                {new Date(d.date).getDate()}
                <span className="text-[9px] opacity-70">{d.status}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-4 text-[12px] text-black/50 dark:text-white/50">
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-200" /> Present</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-rose-200" /> Absent</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-amber-200" /> Leave</span>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ── Marks ─────────────────────────────────────────────── */

export function MarksMod() {
  const { db } = useStore()
  const { term, setTerm } = useTerm()
  const rows = db.marks[term]
  const avg = Math.round(rows.reduce((a, r) => a + pctFor(r), 0) / rows.length)
  return (
    <div>
      <PageHead title="Marks & Grades" sub={`Term average ${avg}% · Aarav Sharma`}>
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const pct = pctFor(r)
          const g = gradeFor(r)
          const col = db.subjects.find(s => s.name === r.subject)?.color ?? '#6366f1'
          return (
            <Card key={r.subject} className="card-lift">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-display text-lg font-medium">{r.subject}</p>
                  <p className="text-[12.5px] text-black/45 dark:text-white/45">{db.subjects.find(s => s.name === r.subject)?.teacher}</p>
                </div>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-[17px] font-bold"
                  style={{ background: col + '16', color: col }}>{g}</span>
              </div>
              <div className="mt-5 space-y-3">
                {r.assessments.map((a) => (
                  <div key={a.name}>
                    <div className="mb-1 flex justify-between text-[12.5px]">
                      <span className="text-black/60 dark:text-white/60">{a.name}</span>
                      <span className="font-semibold">{a.score}<span className="text-black/35 dark:text-white/35">/{a.max}</span></span>
                    </div>
                    <Progress pct={(a.score / a.max) * 100} color={col} />
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-black/[.06] dark:border-white/[.08] pt-4 text-[13px]">
                <span className="text-black/45 dark:text-white/45">Aggregate</span>
                <span className="font-bold" style={{ color: col }}>{pct}%</span>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

/* ── Rank list ─────────────────────────────────────────── */

export function RanksMod() {
  const { db } = useStore()
  const { term, setTerm } = useTerm()
  const data = db.ranks[term]
  const [view, setView] = useState('overall')
  const rows = view === 'overall' ? data.overall : data.subjects[view]
  return (
    <div>
      <PageHead title="Rank List" sub="Class X-A · overall and subject-wise standings">
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>
      <div className="mb-5 flex flex-wrap gap-2">
        <button onClick={() => setView('overall')}
          className={`rounded-full px-4 py-2 text-[13px] font-semibold ${view === 'overall' ? 'bg-black text-white' : 'bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60 ring-1 ring-black/10 dark:ring-white/15'}`}>
          <Trophy size={13} className="mr-1.5 inline" /> Overall
        </button>
        {db.subjects.map(s => (
          <button key={s.id} onClick={() => setView(s.name)}
            className={`rounded-full px-4 py-2 text-[13px] font-semibold ${view === s.name ? 'bg-black text-white' : 'bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60 ring-1 ring-black/10 dark:ring-white/15'}`}>
            {s.name}
          </button>
        ))}
      </div>
      <Card className="p-0">
        {rows.map((r) => {
          const me = r.name === 'Aarav Sharma'
          return (
            <div key={r.name} className={`flex items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0 ${me ? 'bg-indigo-50/60' : ''}`}>
              <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold ${r.rank <= 3 ? 'bg-gradient-to-br from-amber-400 to-orange-400 text-white' : 'bg-black/[.05] dark:bg-white/[.07] text-black/50 dark:text-white/50'}`}>
                {r.rank}
              </span>
              <Avatar name={r.name} hue={(r.rank * 47) % 360} size={34} />
              <span className="flex-1 text-[14.5px] font-medium">{r.name}{me && <Pill tone="indigo"><span className="ml-0">You</span></Pill>}</span>
              <span className="text-[14px] font-semibold text-black/70 dark:text-white/70">{view === 'overall' ? r.score / 10 : r.score}%</span>
              <Pill tone={r.rank <= 3 ? 'green' : 'slate'}>{r.grade}</Pill>
            </div>
          )
        })}
      </Card>
    </div>
  )
}

/* ── Calendar ──────────────────────────────────────────── */

export function CalendarMod() {
  const { db } = useStore()
  const { term, setTerm } = useTerm()
  const termObj = db.terms.find(t => t.id === term)!
  const [mi, setMi] = useState(0)
  const events = db.events.filter(e => e.term === term)
  const year = term === 't1' ? 2025 : term === 't2' ? (mi >= 3 ? 2026 : 2025) : 2026
  const monthIndex = useMemo(() => {
    const map: Record<string, number> = { January: 0, February: 1, March: 2, April: 3, May: 4, June: 5, July: 6, August: 7, September: 8, October: 9, November: 10, December: 11 }
    return map[termObj.months[mi]]
  }, [mi, termObj])
  const daysIn = new Date(year, monthIndex + 1, 0).getDate()
  const first = new Date(year, monthIndex, 1).getDay()
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)]
  const evOf = (day: number) => events.filter(e => new Date(e.date).getDate() === day && new Date(e.date).getMonth() === monthIndex)
  return (
    <div>
      <PageHead title="Academic Calendar" sub={`${termObj.name} · ${termObj.range} — only this term's months are shown`}>
        <TermTabs terms={db.terms} term={term} setTerm={(t) => { setTerm(t); setMi(0) }} />
      </PageHead>
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <div className="mb-5 flex items-center justify-between">
            <button disabled={mi === 0} onClick={() => setMi(mi - 1)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 disabled:opacity-30 hover:bg-black/10 dark:hover:bg-white/15"><ChevronLeft size={16} /></button>
            <p className="font-display text-xl font-medium">{termObj.months[mi]} {year}</p>
            <button disabled={mi === termObj.months.length - 1} onClick={() => setMi(mi + 1)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 disabled:opacity-30 hover:bg-black/10 dark:hover:bg-white/15"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-black/35 dark:text-white/35">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="pb-2">{d}</span>)}
            {cells.map((d, i) => {
              const evs = d ? evOf(d) : []
              const top = evs[0]
              return (
                <div key={i} className={`flex aspect-square flex-col items-center justify-center rounded-xl text-[13px] font-medium
                  ${!d ? '' : top?.type === 'holiday' ? 'bg-rose-50 text-rose-600' : top?.type === 'exam' ? 'bg-amber-50 text-amber-700' : top ? 'bg-indigo-50 text-indigo-600' : 'hover:bg-black/[.04] dark:hover:bg-white/[.08]'}`}>
                  {d}
                  {top && <span className={`mt-0.5 h-1 w-1 rounded-full ${top.type === 'holiday' ? 'bg-rose-400' : top.type === 'exam' ? 'bg-amber-400' : 'bg-indigo-400'}`} />}
                </div>
              )
            })}
          </div>
        </Card>
        <Card>
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">This term</p>
          <div className="space-y-3">
            {events.map((e) => (
              <div key={e.date + e.title} className="flex items-center gap-3.5 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                <span className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl text-[11px] font-bold leading-none
                  ${e.type === 'holiday' ? 'bg-rose-100 text-rose-600' : e.type === 'exam' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-600'}`}>
                  {new Date(e.date).getDate()}
                  <span className="text-[8px] font-semibold uppercase">{new Date(e.date).toLocaleString('en', { month: 'short' })}</span>
                </span>
                <div className="flex-1">
                  <p className="text-[13.5px] font-semibold leading-tight">{e.title}</p>
                  <p className="text-[11.5px] capitalize text-black/45 dark:text-white/45">{e.type}</p>
                </div>
                <CalendarDays size={15} className="text-black/25 dark:text-white/25" />
              </div>
            ))}
            {events.length === 0 && <Empty text="No events this term yet." />}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ── Teacher directory ─────────────────────────────────── */

export function TeachersMod() {
  const { db } = useStore()
  const { term, setTerm } = useTerm()
  return (
    <div>
      <PageHead title="Teachers" sub={`Everyone teaching Aarav in ${db.terms.find(t => t.id === term)?.name}`}>
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {db.directory.map((t, i) => (
          <Card key={t.id} className="card-lift">
            <div className="flex items-center gap-4">
              <Avatar name={t.name} hue={(i * 53) % 360} size={52} />
              <div>
                <p className="font-display text-[17px] font-medium">{t.name}</p>
                <p className="text-[12.5px] text-black/50 dark:text-white/50">{t.role}{t.subject ? ` · ${t.subject}` : ''}</p>
              </div>
            </div>
            <div className="mt-5 space-y-2.5 text-[13.5px]">
              <p className="flex items-center gap-2.5 text-black/60 dark:text-white/60"><Mail size={14} className="text-black/35 dark:text-white/35" /> {t.email}</p>
              <p className="flex items-center gap-2.5 text-black/60 dark:text-white/60"><Phone size={14} className="text-black/35 dark:text-white/35" /> {t.phone}</p>
              <p className="flex items-center gap-2.5 text-black/60 dark:text-white/60"><Download size={14} className="opacity-0" /> Room: {t.room}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

export { fmtINR }
