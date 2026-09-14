import { useMemo, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useAcademic, useStore } from '@/lib/store'
import { compareClasses, type RiskLevel } from '@/lib/data'
import { fmtDate, useClassStudents } from '@/lib/hooks/useAcademics'
import { riskTone, useLostTimeReport, useRiskRecompute, useRiskSnapshots } from '@/lib/hooks/useAnalytics'
import { Avatar, Card, Empty, PageHead, Pill, TermTabs, inputCls } from '../ui'
import { StudentReportMod } from './studentReport'
import { useActiveTerm } from './viewer'

// Live-verified against the real router/service once they landed (built in parallel by the server agent).
// `StudentRiskSnapshot` rows come pre-decorated with `studentName`/`classLabel`; the class roster is still
// fetched (`useClassStudents`) for roll numbers and avatar hues, which the snapshot doesn't carry.

// Phase 19 — early warning & teaching analytics. See .agents/edunova/phase-19-early-warning-analytics.md.
// Items 3/4/5 (teacher workload, homework load, substitute suggestions) are small augmentations to existing
// screens (timetableBuilder.tsx, classroom.tsx's CreateAssignmentMod, timetable.tsx's ClassPicker) — this
// file holds only the two new standalone screens: Students at Risk (item 1) and the Lost Instructional Time
// report (item 2).

const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
const RISK_LEVELS: RiskLevel[] = ['High', 'Medium', 'Low']

/* ── 1. Students at Risk ─────────────────────────────────────────── */

export function StudentsAtRiskMod() {
  const { user } = useStore()
  const { classes, currentYear, gradeById, classById } = useAcademic()
  const isStaffAdmin = user?.role === 'staff' || user?.role === 'admin' || user?.role === 'superadmin'

  const classList = useMemo(() => {
    const all = classes.filter(c => !currentYear || c.academicYearId === currentYear.id).sort(compareClasses(gradeById))
    return isStaffAdmin ? all : all.filter(c => c.classTeacherId === user?.id)
  }, [classes, currentYear, gradeById, isStaffAdmin, user])

  const { term } = useActiveTerm()
  const [picked, setPicked] = useState('')
  const classId = classList.some(c => c.id === picked) ? picked : (classList[0]?.id ?? '')
  const cls = classById.get(classId)
  const [levelFilter, setLevelFilter] = useState<'' | RiskLevel>('')
  const { items, loading, error, reload } = useRiskSnapshots({ classId, riskLevel: levelFilter || undefined, termId: term }, !!classId)
  const { busy, recompute } = useRiskRecompute()
  const students = useClassStudents(classId)
  const studentById = useMemo(() => new Map(students.map(s => [s.id, s])), [students])
  const [openStudent, setOpenStudent] = useState<string | null>(null)
  const [openFactorsId, setOpenFactorsId] = useState<string | null>(null)

  const rows = useMemo(() => [...(items ?? [])].sort((a, b) => b.riskScore - a.riskScore), [items])

  const runRecompute = async () => { await recompute({ classId, termId: term }); reload() }

  if (openStudent) {
    return (
      <div>
        <button onClick={() => setOpenStudent(null)} className="mb-4 flex items-center gap-1.5 text-[13px] font-semibold text-indigo-600 hover:underline"><ArrowLeft size={14} /> Back to Students at Risk</button>
        <StudentReportMod studentId={openStudent} />
      </div>
    )
  }

  return (
    <div>
      <PageHead title="Students at Risk" sub={isStaffAdmin ? 'Flagged students in any class, with the factors behind each score' : 'Flagged students in your class, with the factors behind each score'}>
        <div className="flex flex-wrap items-center gap-2">
          {classList.length > 1 && (
            <select value={classId} onChange={e => setPicked(e.target.value)} className={`${inputCls} w-auto min-w-[150px] py-2 text-[13.5px]`} aria-label="Class">
              {classList.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}
          <select value={levelFilter} onChange={e => setLevelFilter(e.target.value as '' | RiskLevel)} className={`${inputCls} w-auto py-2 text-[13.5px]`} aria-label="Risk level">
            <option value="">All levels</option>
            {RISK_LEVELS.map(l => <option key={l} value={l}>{l} risk</option>)}
          </select>
          <button onClick={runRecompute} disabled={!classId || busy} className={ghostBtn}>
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? 'Recomputing…' : 'Recompute'}
          </button>
        </div>
      </PageHead>

      {classList.length === 0 ? (
        <Empty text={isStaffAdmin ? 'No classes yet — set up classes first.' : 'You are not the class teacher of any class.'} />
      ) : loading ? <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</div>
        : error ? <Empty text={error} />
        : rows.length === 0 ? <Empty text={`No risk snapshots for ${cls?.label ?? 'this class'} yet — click Recompute to generate them.`} />
        : (
          <div className="space-y-3">
            {rows.map(r => {
              const s = studentById.get(r.studentId)
              const expanded = openFactorsId === r.id
              return (
                <Card key={r.id} className="p-0">
                  <div className="flex flex-wrap items-center gap-3.5 p-4">
                    <Avatar name={r.studentName ?? s?.name ?? r.studentId} hue={s?.avatarHue} size={38} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14.5px] font-semibold">{r.studentName ?? s?.name ?? 'Unknown student'}</p>
                      <p className="text-[12px] text-black/45 dark:text-white/45">Roll {s?.rollNo ?? '—'} · updated {fmtDate(r.computedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <div className="hidden flex-wrap gap-x-4 gap-y-1 text-[12px] text-black/50 dark:text-white/50 sm:flex">
                      <span>Attendance {Math.round(r.attendancePct)}%</span>
                      <span>Marks {Math.round(r.avgMarksPct)}%</span>
                      {r.homeworkOverdueCount > 0 && <span className="text-amber-600 dark:text-amber-400">{r.homeworkOverdueCount} overdue HW</span>}
                      {r.feeOverdueAmount > 0 && <span className="text-rose-500">₹{r.feeOverdueAmount.toLocaleString('en-IN')} fee due</span>}
                      {r.openDisciplineCaseCount > 0 && <span className="text-rose-500">{r.openDisciplineCaseCount} discipline</span>}
                    </div>
                    <Pill tone={riskTone(r.riskLevel)}>{r.riskLevel} · {Math.round(r.riskScore)}</Pill>
                    <button onClick={() => setOpenFactorsId(expanded ? null : r.id)} className="text-[12.5px] font-semibold text-indigo-600 hover:underline">{expanded ? 'Hide why' : 'Why?'}</button>
                    {(s || r.studentId) && <button onClick={() => setOpenStudent(r.studentId)} className="rounded-full bg-black/[.05] dark:bg-white/[.08] px-3.5 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Full report</button>}
                  </div>
                  {expanded && (
                    <div className="space-y-2 border-t border-black/[.06] dark:border-white/[.08] bg-black/[.02] dark:bg-white/[.03] p-4">
                      {r.factors.map((f, i) => (
                        <div key={i} className="flex items-center gap-3 text-[13px]">
                          <span className="w-40 shrink-0 truncate font-medium">{f.factor}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
                            <div className="h-full rounded-full bg-rose-400" style={{ width: `${f.weight ? Math.min(100, (f.contribution / f.weight) * 100) : 0}%` }} />
                          </div>
                          <span className="w-24 shrink-0 text-right tabular-nums text-black/45 dark:text-white/45">{f.contribution.toFixed(1)} / {f.weight}</span>
                        </div>
                      ))}
                      {r.factors.length === 0 && <p className="text-[12.5px] text-black/40 dark:text-white/40">No contributing factors.</p>}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
    </div>
  )
}

/* ── 2. Lost Instructional Time report ─────────────────────────────── */

const GROUP_BY: { id: 'class' | 'subject' | 'teacher'; label: string }[] = [
  { id: 'class', label: 'By class' }, { id: 'subject', label: 'By subject' }, { id: 'teacher', label: 'By teacher' },
]

export function LostInstructionalTimeMod() {
  const { db } = useStore()
  const { term, setTerm } = useActiveTerm()
  const [groupBy, setGroupBy] = useState<'class' | 'subject' | 'teacher'>('class')
  const { data, loading, error } = useLostTimeReport({ termId: term, groupBy })
  const rows = useMemo(() => [...(data?.items ?? [])].sort((a, b) => b.lostTotal - a.lostTotal), [data])
  const totals = data?.totals

  return (
    <div>
      <PageHead title="Lost Instructional Time" sub="Scheduled vs. delivered periods this term, broken down by cause — built on Phase 18's per-class-subject lost-periods calculation">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-full bg-black/[.04] dark:bg-white/[.06] p-1">
            {GROUP_BY.map(g => (
              <button key={g.id} onClick={() => setGroupBy(g.id)} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${groupBy === g.id ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-black/55 dark:text-white/55 hover:bg-black/[.04] dark:hover:bg-white/[.08]'}`}>{g.label}</button>
            ))}
          </div>
          <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
        </div>
      </PageHead>

      {!term ? <Empty text="Create a term first — this report is scoped to one term." />
        : loading ? <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</div>
        : error ? <Empty text={error} />
        : rows.length === 0 ? <Empty text="Nothing scheduled for this term yet." />
        : (
          <>
            <div className="mb-5 grid gap-4 sm:grid-cols-4">
              {[
                { k: 'Scheduled so far', v: totals?.scheduledPeriodsSoFar ?? 0, tone: 'from-sky-500 to-cyan-400' },
                { k: 'Deliverable', v: totals?.deliverablePeriods ?? 0, tone: 'from-emerald-500 to-teal-400' },
                { k: 'Lost · holiday', v: totals?.lostHoliday ?? 0, tone: 'from-amber-500 to-orange-400' },
                { k: 'Lost · staff absence', v: totals?.lostTeacherAbsence ?? 0, tone: 'from-rose-500 to-pink-400' },
              ].map(c => (
                <div key={c.k} className="relative overflow-hidden rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-5">
                  <div className={`absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${c.tone} opacity-[.13]`} />
                  <p className="text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">{c.k}</p>
                  <p className="font-display mt-2 text-3xl font-medium">{c.v}</p>
                </div>
              ))}
            </div>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-[13.5px]">
                <thead>
                  <tr className="border-b border-black/[.06] dark:border-white/[.08] text-left">
                    <th className="px-5 py-3 font-semibold text-black/50 dark:text-white/50">{GROUP_BY.find(g => g.id === groupBy)?.label.replace('By ', '')}</th>
                    <th className="px-4 py-3 text-center font-semibold text-black/50 dark:text-white/50">Scheduled so far</th>
                    <th className="px-4 py-3 text-center font-semibold text-black/50 dark:text-white/50">Deliverable</th>
                    <th className="px-4 py-3 text-center font-semibold text-black/50 dark:text-white/50">Lost (holiday)</th>
                    <th className="px-4 py-3 text-center font-semibold text-black/50 dark:text-white/50">Lost (staff absence)</th>
                    <th className="px-4 py-3 text-center font-semibold text-black/50 dark:text-white/50">% deliverable</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const pct = r.scheduledPeriodsSoFar > 0 ? Math.round((r.deliverablePeriods / r.scheduledPeriodsSoFar) * 100) : 0
                    return (
                      <tr key={r.key} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                        <td className="px-5 py-2.5 font-medium">{r.label}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums">{r.scheduledPeriodsSoFar}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums">{r.deliverablePeriods}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums text-amber-600 dark:text-amber-400">{r.lostHoliday}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums text-rose-500">{r.lostTeacherAbsence}</td>
                        <td className="px-4 py-2.5 text-center"><Pill tone={pct >= 90 ? 'green' : pct >= 75 ? 'amber' : 'rose'}>{pct}%</Pill></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          </>
        )}
    </div>
  )
}
