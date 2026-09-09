import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Download, Sparkles, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, downloadPath, errorMessage } from '@/lib/api'
import type { Assessment, ExamSeatingPlan, InvigilationDuty, InvigilationSuggestions } from '@/lib/data'
import { compareClasses } from '@/lib/data'
import { useAssessments } from '@/lib/hooks/useAcademics'
import { isoDate } from '@/lib/hooks/useTimetable'
import { useEmployees } from '@/lib/hooks/useFinance'
import { invigilationTone, useInvigilationDuties } from '@/lib/hooks/useExams'
import { Card, Empty, Field, PageHead, Pill, inputCls } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'

// Phase 25 items 1-2: exam seating plans and the invigilation roster. "My Invigilation Duties" for
// teachers folds into the existing Duties screen (src/portal/modules/hr.tsx#DutiesMod) instead of living
// here. See .agents/edunova/phase-25-exam-operations.md

const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
const primaryBtn = 'flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40'
const sectionHead = 'border-b border-black/[.06] dark:border-white/[.08] px-6 py-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'

/** Class + term picker shared by both screens below — assessments are scoped to one class/term at a time. */
function useClassTermAssessments() {
  const { classes, currentYear, gradeById } = useAcademic()
  const { db } = useStore()
  const classList = useMemo(() => classes.filter(c => !currentYear || c.academicYearId === currentYear.id).sort(compareClasses(gradeById)), [classes, currentYear, gradeById])
  const [classId, setClassId] = useState('')
  const cls = classId || classList[0]?.id || ''
  const [termId, setTermId] = useState('')
  const term = termId || db.terms[0]?.id || ''
  const { items: assessments, loading } = useAssessments({ classId: cls, termId: term })
  const sorted = useMemo(() => [...(assessments ?? [])].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.name.localeCompare(b.name)), [assessments])
  return { classList, cls, setClassId, term, setTermId, terms: db.terms, sorted, loading }
}

/* ── Item 1: seating plan generation ───────────────────── */

export function SeatingPlanMod() {
  const { classList, cls, setClassId, term, setTermId, terms, sorted, loading } = useClassTermAssessments()
  const { rooms } = useAcademic()

  const [picked, setPicked] = useState<string[]>([])
  const [roomId, setRoomId] = useState('')
  const [date, setDate] = useState(() => isoDate(new Date()))
  const toggle = (a: Assessment) => {
    setPicked(p => p.includes(a.id) ? p.filter(x => x !== a.id) : [...p, a.id])
    if (!picked.length && a.date) setDate(a.date)
  }

  const [plans, setPlans] = useState<ExamSeatingPlan[]>([]) // freshly-generated, this session — no list endpoint server-side
  const [viewingId, setViewingId] = useState<string | null>(null)
  const plan = viewingId ? plans.find(p => p.id === viewingId) : undefined
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  const generate = async () => {
    if (picked.length === 0 || !roomId || !date) return
    setGenerating(true); setGenError(null)
    try {
      const res = await api.post<{ item: ExamSeatingPlan }>('/exams/seating-plans', { assessmentIds: picked, date, roomId })
      const created = res.item
      setPlans(p => [created, ...p])
      setViewingId(created.id)
      setPicked([])
      toast.success('Seating plan generated')
    } catch (e) {
      setGenError(errorMessage(e))
    } finally { setGenerating(false) }
  }

  const print = (id: string, label: string) => downloadPath(`/exams/seating-plans/${id}/pdf`, `Seating-Plan-${label.replace(/\W+/g, '_')}.pdf`).catch(e => toast.error(errorMessage(e)))

  const roomOf = (id: string) => rooms.find(r => r.id === id)
  const seatsByRow = useMemo(() => {
    const cols = 6
    const seats = [...(plan?.seats ?? [])].sort((a, b) => a.seatNumber - b.seatNumber)
    const rowsOut: (typeof seats)[] = []
    for (let i = 0; i < seats.length; i += cols) rowsOut.push(seats.slice(i, i + cols))
    return rowsOut
  }, [plan])

  return (
    <div>
      <PageHead title="Exam Seating Plans" sub="Pick assessments sharing a room and date, generate a seating chart, then review and print it" />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Generate a plan</p>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Class">
                <select value={cls} onChange={e => { setClassId(e.target.value); setPicked([]) }} className={inputCls}>
                  {classList.map(c => <option key={c.id} value={c.id}>{c.label} · {c.boardCode}</option>)}
                </select>
              </Field>
              <Field label="Term">
                <select value={term} onChange={e => { setTermId(e.target.value); setPicked([]) }} className={inputCls}>
                  {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Assessments (select every paper sharing this room/date — e.g. two electives in one hall)">
              {loading ? <p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p>
                : sorted.length === 0 ? <p className="text-[13px] text-black/40 dark:text-white/40">No assessments for this class/term yet.</p>
                : (
                  <div className="max-h-52 space-y-1.5 overflow-y-auto thin-scroll rounded-xl border border-black/10 dark:border-white/15 p-2">
                    {sorted.map(a => (
                      <label key={a.id} className={`flex cursor-pointer items-center gap-2 rounded-lg p-2 text-[13px] transition-colors ${picked.includes(a.id) ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-black/[.03] dark:hover:bg-white/[.05]'}`}>
                        <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a)} />
                        <span className="min-w-0 flex-1 truncate font-medium">{a.name}{a.subjectName ? ` · ${a.subjectName}` : ''}</span>
                        <span className="shrink-0 text-[11.5px] text-black/45 dark:text-white/45">{a.date || 'no date'}</span>
                      </label>
                    ))}
                  </div>
                )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Room">
                <select value={roomId} onChange={e => setRoomId(e.target.value)} className={inputCls}>
                  <option value="">Select a room</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name}{r.capacity ? ` · cap ${r.capacity}` : ''}</option>)}
                </select>
              </Field>
              <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
            </div>
            {genError && (
              <div className="flex items-start gap-2 rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50/70 dark:bg-rose-500/10 p-3 text-[12.5px] text-rose-700 dark:text-rose-300">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> <span>{genError}</span>
              </div>
            )}
            <button onClick={generate} disabled={picked.length === 0 || !roomId || !date || generating} className="btn-ink flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">
              <Sparkles size={15} /> {generating ? 'Generating…' : `Generate seating plan${picked.length ? ` (${picked.length} paper${picked.length === 1 ? '' : 's'})` : ''}`}
            </button>
          </div>
        </Card>

        <Card className="p-0">
          <p className={sectionHead}>Plans generated this session</p>
          {plans.length === 0 ? <div className="p-6"><Empty text="Generate a plan to see it here — plans aren't listed after you navigate away, but stay downloadable by anyone with the link." /></div> : (
            <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
              {plans.map(p => (
                <button key={p.id} onClick={() => setViewingId(p.id)} className={`flex w-full items-center gap-3 px-6 py-3.5 text-left transition-colors ${viewingId === p.id ? 'bg-indigo-50/50 dark:bg-indigo-500/10' : 'hover:bg-black/[.02] dark:hover:bg-white/[.04]'}`}>
                  <CalendarClock size={16} className="shrink-0 text-black/35 dark:text-white/35" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{p.roomName ?? roomOf(p.roomId)?.name ?? 'Room'} · {p.date}</p>
                    <p className="text-[12px] text-black/45 dark:text-white/45">{p.assessmentIds.length} paper{p.assessmentIds.length === 1 ? '' : 's'} · {p.seats.length} seated</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {plan && (
            <div className="border-t border-black/[.06] dark:border-white/[.08] p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[15px] font-semibold">{plan.roomName ?? roomOf(plan.roomId)?.name ?? 'Room'} · {plan.date}</p>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">{plan.seats.length} seat{plan.seats.length === 1 ? '' : 's'} assigned{plan.roomCapacity ? ` of ${plan.roomCapacity} capacity` : ''}</p>
                </div>
                <button onClick={() => print(plan.id, `${plan.roomName ?? 'room'}-${plan.date}`)} className={ghostBtn}><Download size={13} /> Print / PDF</button>
              </div>
              {plan.seats.length === 0 ? <Empty text="No students seated on this plan." /> : (
                <div className="space-y-2">
                  {seatsByRow.map((row, i) => (
                    <div key={i} className="grid grid-cols-6 gap-2">
                      {row.map(s => (
                        <div key={s.id} className="rounded-xl border border-black/10 dark:border-white/15 p-2.5 text-center">
                          <p className="text-[11px] text-black/40 dark:text-white/40">Seat {s.seatNumber}</p>
                          <p className="truncate text-[12.5px] font-semibold">{s.studentName}</p>
                          <p className="truncate text-[10.5px] text-black/45 dark:text-white/45">{s.classLabel}{s.subjectName ? ` · ${s.subjectName}` : ''}</p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ── Item 2: invigilation roster (staff/admin) ─────────── */

export function InvigilationRosterMod() {
  const { classList, cls, setClassId, term, setTermId, terms, sorted } = useClassTermAssessments()
  const { rooms } = useAcademic()
  const employees = useEmployees()
  const teacherName = (id: string) => employees.find(e => e.id === id)?.name ?? id
  const assessmentName = (id: string) => sorted.find(a => a.id === id)?.name ?? id
  const roomName = (id: string) => rooms.find(r => r.id === id)?.name ?? id

  const [picked, setPicked] = useState<string[]>([])
  const [targetAssessmentId, setTargetAssessmentId] = useState('')
  const [date, setDate] = useState(() => isoDate(new Date()))
  const [roomId, setRoomId] = useState('')
  const toggle = (a: Assessment) => {
    setPicked(p => {
      const next = p.includes(a.id) ? p.filter(x => x !== a.id) : [...p, a.id]
      if (!p.includes(a.id)) setTargetAssessmentId(a.id)
      return next
    })
    if (!picked.length && a.date) setDate(a.date)
  }

  const [suggestions, setSuggestions] = useState<InvigilationSuggestions | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const suggest = async () => {
    if (picked.length === 0 || !date) return
    setSuggesting(true)
    try {
      const res = await api.post<InvigilationSuggestions>('/exams/invigilation/auto-assign', { assessmentIds: picked, date })
      setSuggestions(res)
    } catch (e) { toast.error(errorMessage(e)) } finally { setSuggesting(false) }
  }

  const duties = useInvigilationDuties({ date }, !!date)
  const [assigning, setAssigning] = useState<string | null>(null)

  const assign = async (teacherId: string) => {
    if (!roomId) { toast.error('Pick a room first'); return }
    if (!targetAssessmentId) { toast.error('Pick which assessment this invigilator covers'); return }
    setAssigning(teacherId)
    try {
      await api.post('/exams/invigilation', { assessmentId: targetAssessmentId, roomId, teacherId, date })
      duties.reload()
      setSuggestions(s => s ? { ...s, suggestions: s.suggestions.filter(x => x.teacherId !== teacherId) } : s)
      toast.success('Invigilator assigned')
    } catch (e) { toast.error(errorMessage(e)) } finally { setAssigning(null) }
  }

  const [manualTeacher, setManualTeacher] = useState('')
  const manualAssign = async () => {
    if (!manualTeacher || !targetAssessmentId || !roomId) return
    setAssigning('manual')
    try {
      await api.post('/exams/invigilation', { assessmentId: targetAssessmentId, roomId, teacherId: manualTeacher, date })
      duties.reload()
      setManualTeacher('')
      toast.success('Invigilator assigned')
    } catch (e) { toast.error(errorMessage(e)) } finally { setAssigning(null) }
  }

  const remove = async (d: InvigilationDuty) => {
    if (!confirm(`Remove ${teacherName(d.teacherId)}'s duty?`)) return
    try { await api.del(`/exams/invigilation/${d.id}`); duties.reload(); toast.success('Duty removed') }
    catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <div>
      <PageHead title="Invigilation Roster" sub="Auto-suggest free, unconflicted teachers or assign manually, per assessment and date" />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Assign invigilators</p>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Class">
                <select value={cls} onChange={e => { setClassId(e.target.value); setPicked([]) }} className={inputCls}>
                  {classList.map(c => <option key={c.id} value={c.id}>{c.label} · {c.boardCode}</option>)}
                </select>
              </Field>
              <Field label="Term">
                <select value={term} onChange={e => { setTermId(e.target.value); setPicked([]) }} className={inputCls}>
                  {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Assessments needing invigilation (all must share the same term)">
              {sorted.length === 0 ? <p className="text-[13px] text-black/40 dark:text-white/40">No assessments for this class/term yet.</p> : (
                <div className="max-h-40 space-y-1.5 overflow-y-auto thin-scroll rounded-xl border border-black/10 dark:border-white/15 p-2">
                  {sorted.map(a => (
                    <label key={a.id} className={`flex cursor-pointer items-center gap-2 rounded-lg p-2 text-[13px] ${picked.includes(a.id) ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-black/[.03] dark:hover:bg-white/[.05]'}`}>
                      <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a)} />
                      <span className="min-w-0 flex-1 truncate font-medium">{a.name}{a.subjectName ? ` · ${a.subjectName}` : ''}</span>
                    </label>
                  ))}
                </div>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
              <Field label="Room">
                <select value={roomId} onChange={e => setRoomId(e.target.value)} className={inputCls}>
                  <option value="">Select a room</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
            </div>
            {picked.length > 1 && (
              <Field label="Assigning invigilators for">
                <select value={targetAssessmentId} onChange={e => setTargetAssessmentId(e.target.value)} className={inputCls}>
                  {picked.map(id => <option key={id} value={id}>{assessmentName(id)}</option>)}
                </select>
              </Field>
            )}
            <button onClick={suggest} disabled={picked.length === 0 || !date || suggesting} className="btn-ink flex w-full items-center justify-center gap-2 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
              <Sparkles size={14} /> {suggesting ? 'Finding free teachers…' : 'Suggest invigilators'}
            </button>

            {suggestions && (
              <div className="space-y-2 border-t border-black/[.06] dark:border-white/[.08] pt-3">
                {suggestions.suggestions.length === 0 ? <p className="text-[12.5px] text-black/45 dark:text-white/45">No free, unconflicted teachers found for this slot.</p> : suggestions.suggestions.map(s => (
                  <div key={s.teacherId} className="flex items-center gap-3 rounded-xl bg-black/[.03] dark:bg-white/[.05] p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold">{s.name}</p>
                      <p className="text-[11.5px] text-black/45 dark:text-white/45">{s.currentDutyCount} duties this term</p>
                    </div>
                    <button onClick={() => assign(s.teacherId)} disabled={assigning === s.teacherId || !roomId} className={primaryBtn}>{assigning === s.teacherId ? 'Assigning…' : 'Assign'}</button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2 border-t border-black/[.06] dark:border-white/[.08] pt-3">
              <p className="text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Manual override</p>
              <AsyncEntityPicker role="teacher" value={manualTeacher} onChange={id => setManualTeacher(id)} placeholder="Teacher" />
              <button onClick={manualAssign} disabled={!manualTeacher || !targetAssessmentId || !roomId || assigning === 'manual'} className={`${ghostBtn} w-full justify-center`}>{assigning === 'manual' ? 'Assigning…' : 'Assign manually'}</button>
            </div>
          </div>
        </Card>

        <Card className="p-0">
          <p className={sectionHead}>Roster · {date}</p>
          {duties.loading ? <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading roster…</div>
            : duties.error ? <div className="p-6"><Empty text={duties.error} /></div>
            : (duties.items ?? []).length === 0 ? <div className="p-6"><Empty text="No invigilators assigned for this date yet." /></div>
            : (
              <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
                {(duties.items ?? []).map(d => (
                  <div key={d.id} className="flex flex-wrap items-center gap-3 px-6 py-3.5">
                    <Users size={16} className="shrink-0 text-black/35 dark:text-white/35" />
                    <div className="min-w-40 flex-1">
                      <p className="text-[14px] font-semibold">{teacherName(d.teacherId)}</p>
                      <p className="text-[12px] text-black/45 dark:text-white/45">{assessmentName(d.assessmentId)} · {roomName(d.roomId)}</p>
                    </div>
                    <Pill tone={invigilationTone(d.status)}>{d.status}</Pill>
                    <button onClick={() => remove(d)} className="rounded-full p-1.5 text-black/35 hover:bg-rose-50 hover:text-rose-500 dark:text-white/35" title="Remove duty">×</button>
                  </div>
                ))}
              </div>
            )}
        </Card>
      </div>
    </div>
  )
}
