import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Mail, Phone, Trophy } from 'lucide-react'
import { useAcademic, useStore } from '@/lib/store'
import { compareClasses, type SessionStatus, type Term, type User } from '@/lib/data'
import {
  STATUS_LABEL, STATUS_SOFT, bandsForClass, gradeFromBands, pctTone, useAttendanceSummary, useGradeScales, useRanks, useReportCard, useStaffSummary,
} from '@/lib/hooks/useAcademics'
import { useCalendarEvents } from '@/lib/hooks/useComms'
import { Avatar, Card, Empty, PageHead, Pill, Progress, TermTabs, inputCls } from '../ui'
import { firstName, useActiveTerm, useWard } from './viewer'

const MONTH_INDEX: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5, July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
}
function monthIndexFromName(name: string): number { return MONTH_INDEX[name] ?? 0 }

const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}
function parseMonthAbbr(s: string): number {
  return MONTH_ABBR[s.trim().toLowerCase().slice(0, 3)] ?? 0
}

function termBounds(term: Term): { start: string; end: string } {
  const parts = term.range.split('–').map(s => s.trim())
  if (parts.length !== 2) return { start: '2025-01-01', end: '2026-12-31' }
  const [startStr, endStr] = parts
  const endMatch = endStr.match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (!endMatch) return { start: '2025-01-01', end: '2026-12-31' }
  const endMonth = parseMonthAbbr(endMatch[1])
  const endYear = parseInt(endMatch[2])
  const end = new Date(endYear, endMonth + 1, 0).toISOString().slice(0, 10)
  const startMonth = parseMonthAbbr(startStr)
  const startYear = startMonth > endMonth ? endYear - 1 : endYear
  const start = `${startYear}-${String(startMonth + 1).padStart(2, '0')}-01`
  return { start, end }
}

function termMonthYear(term: Term, monthIndex: number): number {
  const bounds = termBounds(term)
  const start = new Date(bounds.start)
  return monthIndex >= start.getMonth() ? start.getFullYear() : start.getFullYear() + 1
}

/* ── shared: ward picker ───────────────────────────────── */

/** Parent with several wards → select; everyone else renders nothing. */
export function WardPicker({ students, value, onChange }: { students: User[]; value: string; onChange: (id: string) => void }) {
  if (students.length < 2) return null
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={`${inputCls} w-auto py-2 text-[13.5px]`} aria-label="Student">
      {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  )
}

const loadingRow = (text: string) => <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">{text}</div>

/* ── Attendance ────────────────────────────────────────── */

/** Month-by-month calendar of daily statuses. */
function DayCalendar({ days }: { days: { date: string; status: SessionStatus }[] }) {
  const months = useMemo(() => {
    const m = new Map<string, Map<number, SessionStatus>>()
    for (const d of days) {
      const k = d.date.slice(0, 7)
      if (!m.has(k)) m.set(k, new Map())
      m.get(k)!.set(Number(d.date.slice(8, 10)), d.status)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [days])
  return (
    <div className="max-h-[440px] space-y-5 overflow-y-auto pr-1 thin-scroll">
      {months.map(([ym, byDay]) => {
        const [y, mo] = ym.split('-').map(Number)
        const first = new Date(y, mo - 1, 1).getDay()
        const daysIn = new Date(y, mo, 0).getDate()
        return (
          <div key={ym}>
            <p className="mb-2 font-display text-sm font-medium">{new Date(y, mo - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })}</p>
            <div className="grid grid-cols-7 gap-1.5">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-black/35 dark:text-white/35">{d}</span>)}
              {Array.from({ length: first }, (_, i) => <span key={`b${i}`} />)}
              {Array.from({ length: daysIn }, (_, i) => i + 1).map(d => {
                const s = byDay.get(d)
                return (
                  <div key={d} title={s ? `${ym}-${String(d).padStart(2, '0')} · ${STATUS_LABEL[s]}` : ''}
                    className={`flex aspect-square flex-col items-center justify-center rounded-lg text-[11px] font-semibold ${s ? STATUS_SOFT[s] : 'text-black/30 dark:text-white/30'}`}>
                    {d}
                    {s && <span className="text-[9px] opacity-70">{s}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const LEGEND: SessionStatus[] = ['P', 'A', 'L', 'E']
function Legend({ statuses = LEGEND }: { statuses?: SessionStatus[] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-4 text-[12px] text-black/50 dark:text-white/50">
      {statuses.map(s => <span key={s} className="flex items-center gap-1.5"><i className={`h-2.5 w-2.5 rounded-sm ${STATUS_SOFT[s].split(' ')[0]}`} /> {STATUS_LABEL[s]}</span>)}
    </div>
  )
}

export function AttendanceMod() {
  const { db, user } = useStore()
  const { terms: termRecs } = useAcademic()
  const { term, setTerm, termObj } = useActiveTerm()
  const { students, ward, wardId, setWardId } = useWard()
  const isViewer = user?.role === 'student' || user?.role === 'parent'
  const termRec = termRecs.find(t => t.id === term)
  // Students/parents read the ward's session summary; everyone else reads their own staff attendance for the term.
  const studentQ = useAttendanceSummary({ studentId: wardId, termId: term }, isViewer)
  const staffQ = useStaffSummary(user?.id, termRec?.startDate, termRec?.endDate, !isViewer)
  const { data, loading, error } = isViewer ? studentQ : staffQ

  const who = isViewer ? (user?.role === 'parent' ? (ward?.name ?? 'your child') : 'you') : (user?.name ?? '')
  const title = isViewer ? 'Attendance' : 'My Attendance'
  const sub = isViewer ? `Subject-wise and daily record for ${who}${termObj ? ` · ${termObj.name}` : ''}` : `${who}${termObj ? ` · ${termObj.name}` : ''}`
  const head = (
    <PageHead title={title} sub={sub}>
      <div className="flex flex-wrap items-center gap-2">
        <WardPicker students={students} value={wardId} onChange={setWardId} />
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </div>
    </PageHead>
  )

  if (isViewer && !ward) return <div>{head}<Empty text="No student is linked to your account yet." /></div>
  if (!term) return <div>{head}<Empty text="No terms configured yet." /></div>
  if (loading) return <div>{head}{loadingRow('Loading attendance…')}</div>
  if (error) return <div>{head}<Empty text={error} /></div>
  const days = data?.days ?? []
  const overall = data?.overall ?? { present: 0, total: 0, pct: 0 }
  if (!data || (overall.total === 0 && days.length === 0)) return <div>{head}<Empty text="No attendance recorded for this term yet." /></div>

  const pct = Math.round(overall.pct ?? (overall.total ? (overall.present / overall.total) * 100 : 0))
  const counts = days.reduce((acc, d) => { acc[d.status] = (acc[d.status] ?? 0) + 1; return acc }, {} as Partial<Record<SessionStatus, number>>)
  const bySubject = data.bySubject ?? []
  const unit = isViewer ? (bySubject.length ? 'periods' : 'days') : 'working days'

  return (
    <div>
      {head}
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Overall</p>
            <Pill tone={pctTone(pct)}>{pct}%</Pill>
          </div>
          <div className="mt-4 flex items-end gap-2">
            <span className="font-display text-6xl font-medium">{pct}<span className="text-3xl">%</span></span>
            <span className="pb-2 text-[13px] text-black/45 dark:text-white/45">{overall.present}/{overall.total} {unit}</span>
          </div>
          {bySubject.length > 0 ? (
            <div className="mt-6 space-y-4">
              {bySubject.map(s => {
                const p = Math.round(s.pct ?? (s.total ? (s.present / s.total) * 100 : 0))
                return (
                  <div key={s.subjectId ?? s.subject}>
                    <div className="mb-1.5 flex justify-between text-[13px]">
                      <span className="font-medium">{s.subject}</span>
                      <span className="text-black/45 dark:text-white/45">{s.present}/{s.total} · {p}%</span>
                    </div>
                    <Progress pct={p} color={p >= 90 ? '#10b981' : p >= 75 ? '#f59e0b' : '#ef4444'} />
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-3">
              {(['P', 'A', 'L', isViewer ? 'E' : 'H'] as SessionStatus[]).map(s => (
                <div key={s} className={`rounded-2xl p-3 ${STATUS_SOFT[s]}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider opacity-70">{STATUS_LABEL[s]}</p>
                  <p className="mt-1 font-display text-2xl font-medium">{counts[s] ?? 0}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Daily log</p>
          {days.length === 0 ? <Empty text="No daily records yet." /> : <DayCalendar days={days} />}
          <Legend statuses={isViewer ? LEGEND : ['P', 'A', 'L', 'H']} />
        </Card>
      </div>
    </div>
  )
}

/* ── Marks ─────────────────────────────────────────────── */

export function MarksMod() {
  const { db } = useStore()
  const { subjectById, classSubjects, classOf } = useAcademic()
  const { term, setTerm } = useActiveTerm()
  const { students, ward, wardId, setWardId } = useWard()
  const { data, loading, error } = useReportCard(wardId, term)
  const cls = ward ? classOf(ward.id) : undefined
  const subjects = data?.subjects ?? []
  const overall = data?.overall
  const sub = subjects.length && overall
    ? `Overall ${Math.round(overall.pct)}% · Grade ${overall.grade}${overall.rank ? ` · Rank #${overall.rank}${overall.classSize ? ` of ${overall.classSize}` : ''}` : ''}${ward ? ` · ${ward.name}` : ''}`
    : (ward?.name ?? 'No marks published yet')
  const teacherOf = (r: { classSubjectId?: string; subjectId?: string }) => {
    const cs = classSubjects.find(c => (r.classSubjectId ? c.id === r.classSubjectId : !!cls && c.classId === cls.id && c.subjectId === r.subjectId))
    return cs?.teacherId ? db.users.find(u => u.id === cs.teacherId)?.name : undefined
  }
  const colorOf = (s: { subjectId?: string; subject: string; color?: string }) =>
    s.color ?? (s.subjectId ? subjectById.get(s.subjectId)?.color : undefined) ?? db.subjects.find(x => x.name === s.subject)?.color ?? '#6366f1'

  return (
    <div>
      <PageHead title="Marks & Grades" sub={sub}>
        <div className="flex flex-wrap items-center gap-2">
          <WardPicker students={students} value={wardId} onChange={setWardId} />
          <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
        </div>
      </PageHead>
      {!ward ? <Empty text="No student is linked to your account yet." />
        : loading ? loadingRow('Loading report card…')
        : error ? <Empty text={error} />
        : subjects.length === 0 ? <Empty text="No marks published for this term yet." />
        : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {subjects.map(r => {
              const col = colorOf(r)
              const teacher = teacherOf(r)
              return (
                <Card key={r.classSubjectId ?? r.subjectId ?? r.subject} className="card-lift">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-display text-lg font-medium">{r.subject}</p>
                      {teacher && <p className="text-[12.5px] text-black/45 dark:text-white/45">{teacher}</p>}
                    </div>
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-[17px] font-bold" style={{ background: col + '16', color: col }}>{r.grade}</span>
                  </div>
                  <div className="mt-5 space-y-3">
                    {r.assessments.map(a => (
                      <div key={a.id}>
                        <div className="mb-1 flex justify-between text-[12.5px]">
                          <span className="text-black/60 dark:text-white/60">{a.name}</span>
                          <span className="font-semibold">{a.score ?? '—'}<span className="text-black/35 dark:text-white/35">/{a.maxMarks}</span></span>
                        </div>
                        <Progress pct={a.maxMarks ? ((a.score ?? 0) / a.maxMarks) * 100 : 0} color={col} />
                      </div>
                    ))}
                    {r.assessments.length === 0 && <p className="text-[12.5px] text-black/40 dark:text-white/40">No published assessments yet.</p>}
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-black/[.06] dark:border-white/[.08] pt-4 text-[13px]">
                    <span className="text-black/45 dark:text-white/45">Aggregate · {r.total}/{r.max}</span>
                    <span className="font-bold" style={{ color: col }}>{Math.round(r.pct)}%</span>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
    </div>
  )
}

/* ── Rank list ─────────────────────────────────────────── */

export function RanksMod() {
  const { db, user } = useStore()
  const { classOf, classesTaughtBy, classes, classById, currentYear, gradeById } = useAcademic()
  const { term, setTerm } = useActiveTerm()
  const { students, ward, wardId, setWardId } = useWard()
  const isViewer = user?.role === 'student' || user?.role === 'parent'
  // Teachers rank the classes they teach; staff/admin any class in the current year.
  const pickable = useMemo(() => {
    if (!user || isViewer) return []
    const list = user.role === 'teacher' ? classesTaughtBy(user.id) : classes.filter(c => !currentYear || c.academicYearId === currentYear.id)
    return [...list].sort(compareClasses(gradeById))
  }, [user, isViewer, classesTaughtBy, classes, currentYear, gradeById])
  const [picked, setPicked] = useState('')
  const classId = isViewer ? classOf(wardId)?.id : (pickable.some(c => c.id === picked) ? picked : pickable[0]?.id)
  const cls = classId ? classById.get(classId) : undefined
  const { items, loading, error } = useRanks(classId, term)
  const { items: scales } = useGradeScales(!!classId)
  const bands = bandsForClass(scales, cls)
  const rows = items ?? []

  return (
    <div>
      <PageHead title="Rank List" sub={`${cls ? `Class ${cls.label} · ` : ''}standings from published assessments`}>
        <div className="flex flex-wrap items-center gap-2">
          <WardPicker students={students} value={wardId} onChange={setWardId} />
          {pickable.length > 1 && (
            <select value={classId ?? ''} onChange={e => setPicked(e.target.value)} className={`${inputCls} w-auto py-2 text-[13.5px]`} aria-label="Class">
              {pickable.map(c => <option key={c.id} value={c.id}>{c.label} · {c.boardCode}</option>)}
            </select>
          )}
          <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
        </div>
      </PageHead>
      <Card className="p-0">
        {!classId ? <div className="p-6"><Empty text={isViewer ? (ward ? `${firstName(ward.name)} isn't enrolled in a class yet.` : 'No student is linked to your account yet.') : 'No classes to rank yet.'} /></div>
          : loading ? loadingRow('Loading ranks…')
          : error ? <div className="p-6"><Empty text={error} /></div>
          : rows.length === 0 ? <div className="p-6"><Empty text="No rankings for this term yet — ranks appear once assessments are published." /></div>
          : rows.map(r => {
            const me = !!ward && r.studentId === ward.id
            const pct = Math.round(r.pct)
            return (
              <div key={r.studentId} className={`flex items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0 ${me ? 'bg-indigo-50/60 dark:bg-indigo-500/10' : ''}`}>
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold ${r.rank <= 3 ? 'bg-gradient-to-br from-amber-400 to-orange-400 text-white' : 'bg-black/[.05] dark:bg-white/[.07] text-black/50 dark:text-white/50'}`}>
                  {r.rank}
                </span>
                <Avatar name={r.name} hue={(r.rank * 47) % 360} size={34} />
                <span className="flex flex-1 items-center gap-2 text-[14.5px] font-medium">{r.name}{me && <Pill tone="indigo">{user?.role === 'student' ? 'You' : firstName(ward?.name)}</Pill>}</span>
                <span className="hidden text-[12.5px] text-black/45 dark:text-white/45 sm:block">{r.total}</span>
                <span className="text-[14px] font-semibold text-black/70 dark:text-white/70">{pct}%</span>
                <Pill tone={r.rank <= 3 ? 'green' : 'slate'}><Trophy size={11} className={r.rank <= 3 ? '' : 'hidden'} />{r.grade ?? gradeFromBands(pct, bands)}</Pill>
              </div>
            )
          })}
      </Card>
    </div>
  )
}

/* ── Calendar ──────────────────────────────────────────── */

export function CalendarMod() {
  const { db, user } = useStore()
  const { classOf } = useAcademic()
  const { ward } = useWard()
  const { term, setTerm, termObj } = useActiveTerm()
  const [mi, setMi] = useState(0)
  const { items: allEvents } = useCalendarEvents({ termId: term })
  const myClassId = user?.role === 'student' ? classOf(user.id)?.id : ward ? classOf(ward.id)?.id : undefined
  const events = (allEvents ?? []).filter(e => e.audience === 'School' || e.classId === myClassId)
  if (!termObj) {
    return (
      <div>
        <PageHead title="Academic Calendar" sub="Holidays, exams and events" />
        <Empty text="No terms configured yet." />
      </div>
    )
  }
  const monthIndex = monthIndexFromName(termObj.months[mi])
  const year = termMonthYear(termObj, monthIndex)
  const daysIn = new Date(year, monthIndex + 1, 0).getDate()
  const first = new Date(year, monthIndex, 1).getDay()
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)]
  const evOf = (day: number) => events.filter(e => {
    const d = new Date(e.date)
    return d.getDate() === day && d.getMonth() === monthIndex && d.getFullYear() === year
  })
  return (
    <div>
      <PageHead title="Academic Calendar" sub={`${termObj.name} · ${termObj.range}`}>
        <TermTabs terms={db.terms} term={term} setTerm={(t) => { setTerm(t); setMi(0) }} />
      </PageHead>
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card className="p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between sm:mb-6">
            <button disabled={mi === 0} onClick={() => setMi(mi - 1)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 disabled:opacity-30 hover:bg-black/10 dark:hover:bg-white/15"><ChevronLeft size={18} /></button>
            <p className="font-display text-lg font-medium sm:text-xl">{termObj.months[mi]} {year}</p>
            <button disabled={mi === termObj.months.length - 1} onClick={() => setMi(mi + 1)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 disabled:opacity-30 hover:bg-black/10 dark:hover:bg-white/15"><ChevronRight size={18} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => <span key={i} className="hidden pb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-black/35 dark:text-white/35 sm:block">{d}</span>)}
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="pb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-black/35 dark:text-white/35 sm:hidden">{d}</span>)}
            {cells.map((d, i) => {
              const evs = d ? evOf(d) : []
              const top = evs[0]
              return (
                <div key={i} className={`flex aspect-square flex-col items-center justify-center rounded-xl text-[13px] font-medium transition-colors sm:text-[15px]
                  ${!d ? '' : top?.type === 'holiday' ? 'bg-rose-50 text-rose-600' : top?.type === 'exam' ? 'bg-amber-50 text-amber-700' : top ? 'bg-indigo-50 text-indigo-600' : 'hover:bg-black/[.04] dark:hover:bg-white/[.08]'}`}>
                  {d}
                  {evs.length > 0 && (
                    <div className="mt-1 flex gap-0.5">
                      {evs.slice(0, 3).map((e, idx) => (
                        <span key={idx} className={`h-1.5 w-1.5 rounded-full ${e.type === 'holiday' ? 'bg-rose-400' : e.type === 'exam' ? 'bg-amber-400' : 'bg-indigo-400'}`} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
        <Card>
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">This term</p>
          <div className="space-y-3">
            {events.map((e) => (
              <div key={e.id} className="flex items-center gap-3.5 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                <span className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl text-[11px] font-bold leading-none
                  ${e.type === 'holiday' ? 'bg-rose-100 text-rose-600' : e.type === 'exam' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-600'}`}>
                  {new Date(e.date).getDate()}
                  <span className="text-[8px] font-semibold uppercase">{new Date(e.date).toLocaleString('en', { month: 'short' })}</span>
                </span>
                <div className="flex-1">
                  <p className="text-[13.5px] font-semibold leading-tight">{e.title}</p>
                  <p className="text-[11.5px] capitalize text-black/45 dark:text-white/45">{e.type}</p>
                </div>
                <Pill tone={e.type === 'holiday' ? 'rose' : e.type === 'exam' ? 'amber' : 'indigo'}>{e.type}</Pill>
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

interface TeacherRow { teacher: User; subjects: string[]; classTeacherOf: string[] }

export function TeachersMod() {
  const { db, user } = useStore()
  const { classOf, classSubjects, subjectById, classes } = useAcademic()
  const { students, ward, wardId, setWardId } = useWard()
  const isViewer = user?.role === 'student' || user?.role === 'parent'
  const cls = ward ? classOf(ward.id) : undefined

  // Derived from users + class-subjects: the viewer's class (student/parent) or the whole faculty (everyone else).
  const rows = useMemo(() => {
    const map = new Map<string, TeacherRow>()
    const add = (id: string | undefined, subject?: string, classTeacherOf?: string) => {
      if (!id) return
      const t = db.users.find(u => u.id === id && u.role === 'teacher')
      if (!t) return
      const r = map.get(id) ?? { teacher: t, subjects: [], classTeacherOf: [] }
      if (subject && !r.subjects.includes(subject)) r.subjects.push(subject)
      if (classTeacherOf && !r.classTeacherOf.includes(classTeacherOf)) r.classTeacherOf.push(classTeacherOf)
      map.set(id, r)
    }
    if (isViewer) {
      if (!cls) return []
      add(cls.classTeacherId, undefined, cls.label)
      classSubjects.filter(cs => cs.classId === cls.id).forEach(cs => add(cs.teacherId, subjectById.get(cs.subjectId)?.name))
    } else {
      db.users.filter(u => u.role === 'teacher').forEach(u => add(u.id))
      classes.forEach(c => add(c.classTeacherId, undefined, c.label))
      classSubjects.forEach(cs => add(cs.teacherId, subjectById.get(cs.subjectId)?.name))
    }
    return [...map.values()].sort((a, b) => (b.classTeacherOf.length - a.classTeacherOf.length) || a.teacher.name.localeCompare(b.teacher.name))
  }, [isViewer, cls, db.users, classSubjects, subjectById, classes])

  const who = user?.role === 'student' ? 'you' : ward ? firstName(ward.name) : 'the school'
  return (
    <div>
      <PageHead title="Teachers" sub={isViewer ? `Everyone teaching ${who}${cls ? ` in ${cls.label}` : ''}` : 'Faculty directory'}>
        <WardPicker students={students} value={wardId} onChange={setWardId} />
      </PageHead>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {rows.length === 0 && (
          <div className="sm:col-span-2 xl:col-span-3">
            <Empty text={isViewer && !cls ? (ward ? `${firstName(ward.name)} isn't enrolled in a class yet.` : 'No student is linked to your account yet.') : 'No teachers assigned yet.'} />
          </div>
        )}
        {rows.map(({ teacher: t, subjects, classTeacherOf }, i) => (
          <Card key={t.id} className="card-lift">
            <div className="flex items-center gap-4">
              <Avatar name={t.name} hue={t.avatarHue || (i * 53) % 360} size={52} />
              <div className="min-w-0">
                <p className="truncate font-display text-[17px] font-medium">{t.name}</p>
                <p className="text-[12.5px] text-black/50 dark:text-white/50">
                  {classTeacherOf.length ? `Class Teacher ${classTeacherOf.join(', ')}` : 'Teacher'}{subjects.length ? ` · ${subjects.join(', ')}` : ''}
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-2.5 text-[13.5px]">
              <p className="flex items-center gap-2.5 text-black/60 dark:text-white/60"><Mail size={14} className="text-black/35 dark:text-white/35" /> {t.email}</p>
              {t.phone && <p className="flex items-center gap-2.5 text-black/60 dark:text-white/60"><Phone size={14} className="text-black/35 dark:text-white/35" /> {t.phone}</p>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
