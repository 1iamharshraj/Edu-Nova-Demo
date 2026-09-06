import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, BadgeCheck, Briefcase, CalendarPlus, Check, Copy, FileBadge, FileText, Pencil, Plus, Save, School, ScrollText, Search, Send, ShieldAlert, Trash2, UserPlus, X } from 'lucide-react'
import { useAcademic, useStore, type CreateUserInput } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { canManage, isSuperAdmin } from '@/lib/access'
import { fmtINR, type Application, type AttendanceStatus, type Board, type BoardDetail, type BoardDetailStatus, type CalEvent, type Contract, type ContractStatus, type Resignation, type Role, type Term, type User } from '@/lib/data'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, TermTabs, inputCls, statusTone } from '../ui'
import { StudentReportMod } from './studentReport'
import { useTerm } from '../Portal'
import { toast } from 'sonner'

const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}
function parseMonthAbbr(s: string): number {
  return MONTH_ABBR[s.trim().toLowerCase().slice(0, 3)] ?? 0
}

const todayISO = () => new Date().toISOString().slice(0, 10)

/** Current term id from the legacy `db.terms` shape — falls back to the first term, else ''. */
function defaultTermId(terms: Term[]): string {
  return terms.find(t => t.current)?.id ?? terms[0]?.id ?? ''
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

/** Classes the signed-in teacher teaches (or is class teacher of), with a picker when there is more than one. */
function useMyClass() {
  const { db, user } = useStore()
  const { classesTaughtBy, classOf } = useAcademic()
  const myClasses = useMemo(() => user ? classesTaughtBy(user.id) : [], [classesTaughtBy, user])
  const [picked, setPicked] = useState('')
  const activeId = myClasses.some(c => c.id === picked) ? picked : (myClasses[0]?.id ?? '')
  const activeClass = myClasses.find(c => c.id === activeId)
  const classStudents = useMemo(
    () => activeId ? db.users.filter(u => u.role === 'student' && classOf(u.id)?.id === activeId).sort((a, b) => a.name.localeCompare(b.name)) : [],
    [db.users, classOf, activeId],
  )
  const picker = myClasses.length > 1 ? (
    <select value={activeId} onChange={e => setPicked(e.target.value)} className={`${inputCls} w-auto py-1.5 text-[12.5px]`}>
      {myClasses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  ) : null
  const emptyText = myClasses.length === 0
    ? 'No classes assigned to you yet. Ask the admin to assign you in Academic Setup.'
    : `No students enrolled in ${activeClass?.label ?? 'this class'} yet.`
  return { myClasses, activeClass, classStudents, picker, emptyText }
}

export function TakeAttendanceMod() {
  const { activeClass, classStudents, picker, emptyText } = useMyClass()
  const defaults = useMemo(() => Object.fromEntries(classStudents.map(s => [s.name, true])), [classStudents])
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState(false)
  const marks = useMemo(() => ({ ...defaults, ...overrides }), [defaults, overrides])
  const present = Object.values(marks).filter(Boolean).length
  const setMark = (name: string, value: boolean) => { setOverrides(o => ({ ...o, [name]: value })); setSaved(false) }
  const markAllPresent = () => { setOverrides(Object.fromEntries(classStudents.map(s => [s.name, true]))); setSaved(false) }
  const save = () => { setSaved(true); toast.success(`Attendance saved — ${present}/${classStudents.length} present`) }
  return (
    <div>
      <PageHead title="Take Attendance" sub={`${activeClass?.label ?? 'No class'} · ${classStudents.length} students · Period 1 · today`}>{picker}</PageHead>
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-black/[.06] dark:border-white/[.08] px-6 py-4">
          <p className="text-[14px] font-semibold">{present} of {classStudents.length} present</p>
          <button onClick={markAllPresent} className="text-[12.5px] font-semibold text-indigo-600 hover:underline">Mark all present</button>
        </div>
        {classStudents.map((s, i) => (
          <div key={s.id} className="flex items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0">
            <span className="w-7 text-[13px] font-semibold text-black/35 dark:text-white/35">{i + 1}</span>
            <Avatar name={s.name} hue={s.avatarHue} size={34} />
            <span className="flex-1 text-[14.5px] font-medium">{s.name}</span>
            <div className="flex rounded-full bg-black/[.05] dark:bg-white/[.07] p-1">
              {([true, false] as const).map(v => (
                <button key={String(v)} onClick={() => setMark(s.name, v)}
                  className={`rounded-full px-4 py-1.5 text-[12.5px] font-bold transition-all ${marks[s.name] === v ? (v ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white') : 'text-black/40 dark:text-white/40'}`}>
                  {v ? 'P' : 'A'}
                </button>
              ))}
            </div>
          </div>
        ))}
        {classStudents.length === 0 && <div className="p-6"><Empty text={emptyText} /></div>}
        <div className="p-5">
          <button onClick={save} disabled={classStudents.length === 0} className="btn-ink flex w-full items-center justify-center gap-2 py-3.5 text-[14.5px] font-semibold disabled:opacity-40">
            {saved ? <Check size={17} /> : <Save size={16} />} {saved ? 'Saved' : 'Save attendance'}
          </button>
        </div>
      </Card>
    </div>
  )
}

/* ── Teacher: upload grades ────────────────────────────── */

export function GradeUploadMod() {
  const { db, update } = useStore()
  const { term, setTerm } = useTerm()
  const { activeClass, classStudents, picker, emptyText } = useMyClass()
  const [subjectPick, setSubject] = useState('')
  const subject = db.subjects.some(s => s.name === subjectPick) ? subjectPick : (db.subjects[0]?.name ?? '')
  const [assessment, setAssessment] = useState('Term Exam')
  const [max, setMax] = useState(80)
  const [scores, setScores] = useState<Record<string, string>>({})
  const canPublish = !!subject && !!term && classStudents.length > 0

  const save = () => {
    if (!canPublish) return
    let count = 0
    update(d => {
      if (!d.marks[term]) d.marks[term] = []
      let row = d.marks[term].find(r => r.subject === subject)
      if (!row) { row = { subject, assessments: [] }; d.marks[term].push(row) }
      classStudents.forEach(s => {
        const val = parseInt(scores[s.name] || '')
        if (isNaN(val)) return
        const a = row.assessments.find(x => x.name === assessment)
        if (a) { a.score = Math.min(val, max); a.max = max }
        else row.assessments.push({ name: assessment, score: Math.min(val, max), max })
        count++
      })
      return d
    })
    toast.success(`Grades published for ${subject} · ${assessment} · ${count} students`)
  }

  return (
    <div>
      <PageHead title="Upload Grades" sub={`Publish marks for ${activeClass?.label ?? 'your class'}`}>
        <div className="flex flex-wrap items-center gap-2">
          {picker}
          <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
        </div>
      </PageHead>
      <Card>
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Field label="Subject">
            <select value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} disabled={db.subjects.length === 0}>
              {db.subjects.length === 0 && <option value="">No subjects yet — add them in Academic Setup</option>}
              {db.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Assessment">
            <select value={assessment} onChange={e => setAssessment(e.target.value)} className={inputCls}>
              {['Unit Test', 'Mid Term', 'Term Exam'].map(a => <option key={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Max marks"><input type="number" value={max} onChange={e => setMax(+e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="space-y-2.5">
          {classStudents.map((s) => (
            <div key={s.id} className="flex items-center gap-4">
              <Avatar name={s.name} hue={s.avatarHue} size={32} />
              <span className="flex-1 text-[14px] font-medium">{s.name}</span>
              <input value={scores[s.name] ?? ''} onChange={e => setScores(sc => ({ ...sc, [s.name]: e.target.value.replace(/\D/g, '') }))}
                placeholder={`/ ${max}`} className={`${inputCls} w-24 text-center`} inputMode="numeric" />
            </div>
          ))}
          {classStudents.length === 0 && <Empty text={emptyText} />}
        </div>
        <button onClick={save} disabled={!canPublish} className="btn-ink mt-6 w-full py-3.5 text-[14.5px] font-semibold disabled:opacity-40">Publish grades</button>
      </Card>
    </div>
  )
}

/* ── Teacher: create assignment ────────────────────────── */

export function CreateAssignmentMod() {
  const { db, update } = useStore()
  const { term, setTerm } = useTerm()
  const [subjectPick, setSubject] = useState('')
  const subject = db.subjects.some(s => s.name === subjectPick) ? subjectPick : (db.subjects[0]?.name ?? '')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [due, setDue] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
  const canPost = !!title.trim() && !!subject && !!term
  const live = db.homework.filter(h => h.term === term)

  const create = () => {
    if (!canPost) return
    update(d => {
      d.homework.unshift({ id: 'h' + Date.now(), subject, title, due, term, status: 'Pending', description: desc || '—' })
      return d
    })
    setTitle(''); setDesc('')
    toast.success('Assignment posted')
  }

  return (
    <div>
      <PageHead title="Create Assignment" sub="Homework lands instantly in parent & student portals">
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <div className="space-y-4">
            <Field label="Subject">
              <select value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} disabled={db.subjects.length === 0}>
                {db.subjects.length === 0 && <option value="">No subjects yet — add them in Academic Setup</option>}
                {db.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Circle theorems — worksheet 3" className={inputCls} /></Field>
            <Field label="Instructions"><textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} className={inputCls} /></Field>
            <Field label="Due date"><input type="date" value={due} onChange={e => setDue(e.target.value)} className={inputCls} /></Field>
            <button onClick={create} disabled={!canPost} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Post assignment</button>
          </div>
        </Card>
        <Card>
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Live for this term</p>
          <div className="space-y-3">
            {live.length === 0 && <Empty text="No assignments posted for this term yet." />}
            {live.map(h => (
              <div key={h.id} className="flex items-center gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                <div className="flex-1">
                  <p className="text-[13.5px] font-semibold">{h.title}</p>
                  <p className="text-[11.5px] text-black/45 dark:text-white/45">{h.subject} · due {new Date(h.due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                </div>
                <Pill tone={statusTone(h.status)}>{h.status}</Pill>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ── Teacher: contract & notice period ─────────────────── */

export function ContractMod() {
  const { db, user } = useStore()
  const [notice, setNotice] = useState(false)
  const [declared, setDeclared] = useState(false)
  const contract = db.contracts.find(c => c.userId === user?.id)
  return (
    <div>
      <PageHead title="My Contract" sub="Employment terms and declarations" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><ScrollText size={15} /> Current contract</p>
          {contract ? (
            <div>
              {[
                ['Employee', `${user?.name} · ${contract.userId.toUpperCase()}`],
                ['Designation', contract.designation],
                ['Department', contract.department || '—'],
                ['Tenure', `${contract.startDate} → ${contract.endDate}`],
                ['Base salary', fmtINR(contract.salary) + ' / month'],
                ['Leave policy', '18 paid days / year · deductions per day beyond'],
                ['Notice period', '60 days, either side'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-black/[.05] dark:border-white/[.07] py-3 text-[14px] last:border-0">
                  <span className="text-black/50 dark:text-white/50">{k}</span><span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No contract on file. Contact the admin office." />
          )}
        </Card>
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><FileBadge size={15} /> Notice period declaration</p>
          {declared ? (
            <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 p-5 text-center">
              <BadgeCheck size={36} className="mx-auto text-emerald-600" />
              <p className="mt-3 text-[15px] font-semibold text-emerald-700 dark:text-emerald-400">Declaration submitted</p>
              <p className="mt-1 text-[13px] text-emerald-600/80 dark:text-emerald-400/80">Your 60-day notice clock started on {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}. HR has been notified.</p>
            </div>
          ) : (
            <>
              <p className="text-[13.5px] leading-relaxed text-black/55 dark:text-white/55">
                Declaring notice starts your formal exit process. Your timetable duties stay assigned until HR assigns a handover.
              </p>
              <label className="mt-4 flex items-start gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4 text-[13px] text-black/60 dark:text-white/60">
                <input type="checkbox" checked={notice} onChange={e => setNotice(e.target.checked)} className="mt-0.5" />
                I understand this begins a 60-day notice period as per my contract.
              </label>
              <button onClick={() => { setDeclared(true); toast.success('Notice period declared') }} disabled={!notice}
                className="btn-ink mt-4 w-full py-3 text-[14px] font-semibold disabled:opacity-40">Declare notice period</button>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ── Teacher/staff: work assignments ───────────────────── */

export function WorkAssignMod({ manage = false }: { manage?: boolean }) {
  const { db, update } = useStore()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [event, setEvent] = useState('Tech Fest ‘26')
  const toggle = (id: string) => {
    update(d => { const w = d.workAssign.find(x => x.id === id); if (w) w.status = w.status === 'Done' ? 'Assigned' : 'Done'; return d })
  }
  const create = () => {
    update(d => { d.workAssign.unshift({ id: 'w' + Date.now(), title, event, due: '2026-04-30', status: 'Assigned' }); return d })
    setOpen(false); setTitle(''); toast.success('Work assignment generated')
  }
  return (
    <div>
      <PageHead title={manage ? 'Faculty Work Assignment' : 'My Event Duties'} sub={manage ? 'Generate duties from the event seed' : 'Everything you’re rostered for, in one place'}>
        {manage && <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> Generate duty</button>}
      </PageHead>
      <div className="grid gap-4 md:grid-cols-2">
        {db.workAssign.map(w => (
          <Card key={w.id} className="flex items-center gap-4">
            <button onClick={() => toggle(w.id)}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${w.status === 'Done' ? 'bg-emerald-500 text-white' : 'bg-black/[.06] dark:bg-white/[.08] text-black/30 dark:text-white/30 hover:bg-black/10 dark:hover:bg-white/15'}`}>
              <Check size={18} />
            </button>
            <div className="flex-1">
              <p className={`text-[14.5px] font-semibold ${w.status === 'Done' ? 'text-black/40 dark:text-white/40 line-through' : ''}`}>{w.title}</p>
              <p className="text-[12.5px] text-black/45 dark:text-white/45">{w.event} · due {new Date(w.due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
            </div>
            <Pill tone={statusTone(w.status)}>{w.status}</Pill>
          </Card>
        ))}
        {db.workAssign.length === 0 && <div className="md:col-span-2"><Empty text={manage ? 'No duties generated yet.' : 'No event duties assigned to you yet.'} /></div>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Generate duty">
        <div className="space-y-4">
          <Field label="Duty"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Stage lights coordination" className={inputCls} /></Field>
          <Field label="Event">
            <select value={event} onChange={e => setEvent(e.target.value)} className={inputCls}>
              {['Tech Fest ‘26', 'Annual Sports Day', 'Science Exhibition', 'Founders’ Day'].map(e => <option key={e}>{e}</option>)}
            </select>
          </Field>
          <button onClick={create} disabled={!title.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Assign</button>
        </div>
      </Modal>
    </div>
  )
}

/* ── Student: registrations (FFCS / events / IHA / EXC) ── */

const CATALOG: Record<string, { name: string; detail: string; tag: string }[]> = {
  ffcs: [
    { name: 'Robotics Chapter', detail: 'Tue & Fri · CS Lab · 24 seats', tag: 'Chapter' },
    { name: 'Astronomy Club', detail: 'Wed · Observatory deck', tag: 'Club' },
    { name: 'Debate Society', detail: 'Mon · Seminar Hall', tag: 'Club' },
    { name: 'Photography Circle', detail: 'Thu · Media room', tag: 'Club' },
  ],
  iha: [
    { name: 'Inter-house Basketball', detail: 'Trials 12 Apr · Main court', tag: 'Sport' },
    { name: 'Inter-house Quiz', detail: 'Prelims 15 Apr', tag: 'Literary' },
    { name: 'House Choir', detail: 'Auditions 9 Apr', tag: 'Arts' },
  ],
  exc: [
    { name: 'Classical Dance', detail: 'Sat 9 AM · Arts block', tag: 'EXC' },
    { name: 'Chess Coaching', detail: 'Sat 10 AM · Library annexe', tag: 'EXC' },
    { name: 'Swimming', detail: 'Sun 7 AM · Aquatic centre', tag: 'EXC' },
  ],
  events: [
    { name: 'Tech Fest ‘26', detail: '24 Apr · Senior block · team of 3', tag: 'Event' },
    { name: 'Inter-school MUN', detail: '10 May · Kochi · delegate slots', tag: 'Event' },
    { name: 'Art Exhibition “Chromatic”', detail: 'Open entries till 20 Apr', tag: 'Event' },
  ],
  faculty: [
    { name: 'Tech Fest ‘26 — Judges panel', detail: '24 Apr · Senior block', tag: 'Faculty' },
    { name: 'STEM Teaching Workshop', detail: '3 May · Kochi convention centre', tag: 'Faculty' },
  ],
}

export function RegistrationsMod({ kind, title, sub }: { kind: keyof typeof CATALOG; title: string; sub: string }) {
  const { user } = useStore()
  const key = 'regs_' + kind + '_' + (user?.id ?? 'x')
  const [regs, setRegs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('edunova_x_' + key) ?? '[]') } catch { return [] }
  })
  const toggle = (name: string) => {
    const next = regs.includes(name) ? regs.filter(r => r !== name) : [...regs, name]
    setRegs(next); localStorage.setItem('edunova_x_' + key, JSON.stringify(next))
    toast.success(regs.includes(name) ? 'Registration withdrawn' : `Registered for ${name}`)
  }
  return (
    <div>
      <PageHead title={title} sub={sub} />
      <div className="grid gap-4 md:grid-cols-2">
        {CATALOG[kind].map(c => {
          const on = regs.includes(c.name)
          return (
            <Card key={c.name} className="card-lift">
              <div className="flex items-start justify-between">
                <div>
                  <Pill tone="indigo">{c.tag}</Pill>
                  <p className="font-display mt-2.5 text-[16.5px] font-medium">{c.name}</p>
                  <p className="mt-1 text-[13px] text-black/50 dark:text-white/50">{c.detail}</p>
                </div>
                <button onClick={() => toggle(c.name)}
                  className={`rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors ${on ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-black text-white hover:bg-black/85'}`}>
                  {on ? '✓ Registered' : 'Register'}
                </button>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

/* ── Applications: admissions / TC / bonafide / discipline ─ */

export function ApplicationsMod({ approver = true }: { approver?: boolean }) {
  const { db, update, user } = useStore()
  const { classOf, wardsOf } = useAcademic()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Application['kind']>('Bonafide')
  const [detail, setDetail] = useState('')
  const [kindFilter, setKindFilter] = useState<'All' | Application['kind']>('All')
  const [notes, setNotes] = useState<Record<string, string>>({})

  const mine = useMemo(() => {
    if (approver) return db.applications
    if (!user) return []
    return db.applications.filter(a => {
      if (user.role === 'student') return a.name.includes(user.name)
      if (user.role === 'parent') {
        const wardNames = wardsOf(user.id).map(id => db.users.find(u => u.id === id)?.name).filter((n): n is string => !!n)
        const wards = [...wardNames, ...(user.wards || '').split(',').map(w => w.trim()).filter(Boolean)]
        return wards.some(w => a.name.includes(w))
      }
      return false
    })
  }, [db.applications, db.users, approver, user, wardsOf])

  const rows = useMemo(() => {
    if (kindFilter === 'All') return mine
    return mine.filter(a => a.kind === kindFilter)
  }, [mine, kindFilter])

  const setStatus = (id: string, status: Application['status']) => {
    update(d => {
      const a = d.applications.find(x => x.id === id)
      if (!a) return d
      a.status = status
      a.notes = notes[id] ?? a.notes
      return d
    })
    toast.success(`Application ${status.toLowerCase()}`)
  }

  const apply = () => {
    if (!user) return
    const cls = classOf(user.id)?.label ?? user.class ?? ''
    update(d => {
      const label = user.role === 'student' ? `${user.name}${cls ? ' — ' + cls : ''}` : `${user.name} — ${user.title || user.role}`
      d.applications.unshift({ id: 'ap' + Date.now(), kind, name: label, detail, date: new Date().toISOString().slice(0, 10), status: 'Pending', notes: '' })
      return d
    })
    setOpen(false); setDetail(''); toast.success(`${kind} application submitted`)
  }

  const toneFor = (k: string) => k === 'Admission' ? 'indigo' : k === 'TC' ? 'sky' : k === 'Bonafide' ? 'green' : 'rose'
  return (
    <div>
      <PageHead title={approver ? 'Applications & Certificates' : 'TC & Bonafide Applications'}
        sub={approver ? 'Admissions, transfer & bonafide certificates, disciplinary records' : 'Apply and track certificate requests'}>
        {!approver && (
          <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> New application</button>
        )}
        {approver && (
          <select value={kindFilter} onChange={e => setKindFilter(e.target.value as 'All' | Application['kind'])} className={`${inputCls} w-auto py-1.5 text-[12.5px]`}>
            <option value="All">All types</option>
            <option value="Admission">Admission</option>
            <option value="TC">TC</option>
            <option value="Bonafide">Bonafide</option>
            <option value="Disciplinary">Disciplinary</option>
          </select>
        )}
      </PageHead>
      <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
        {rows.map(a => (
          <div key={a.id} className="px-6 py-4">
            <div className="flex flex-wrap items-center gap-4">
              <Pill tone={toneFor(a.kind)}>{a.kind}</Pill>
              <div className="min-w-52 flex-1">
                <p className="text-[14.5px] font-semibold">{a.name}</p>
                <p className="text-[12.5px] text-black/45 dark:text-white/45">{a.detail} · {new Date(a.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
              </div>
              <Pill tone={statusTone(a.status)}>{a.status}</Pill>
              {approver && (
                <div className="flex flex-wrap items-center gap-2">
                  {a.status === 'Pending' && (
                    <>
                      <button onClick={() => setStatus(a.id, 'Verified')} className="rounded-full bg-sky-600 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-sky-700">Verify</button>
                      <button onClick={() => setStatus(a.id, 'Declined')} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-1.5 text-[12.5px] font-semibold">Decline</button>
                    </>
                  )}
                  {a.status === 'Verified' && (
                    <>
                      <button onClick={() => setStatus(a.id, 'Approved')} className="rounded-full bg-emerald-600 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700">Approve</button>
                      <button onClick={() => setStatus(a.id, 'Declined')} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-1.5 text-[12.5px] font-semibold">Decline</button>
                    </>
                  )}
                  {a.status === 'Approved' && <span className="text-[12px] font-semibold text-emerald-600">Queued for issue</span>}
                  {a.status === 'Declined' && <span className="text-[12px] font-semibold text-rose-500">Declined</span>}
                </div>
              )}
            </div>
            {approver && (
              <div className="mt-3">
                <Field label="Admin/staff note">
                  <textarea value={notes[a.id] ?? a.notes ?? ''} onChange={e => setNotes(n => ({ ...n, [a.id]: e.target.value }))} placeholder="Add a note before acting..." className={`${inputCls} min-h-[60px] text-[13px]`} />
                </Field>
              </div>
            )}
            {!approver && a.notes && <p className="mt-2 text-[12.5px] text-black/50 dark:text-white/50">Note: {a.notes}</p>}
          </div>
        ))}
        {rows.length === 0 && <div className="p-6"><Empty text="No applications yet." /></div>}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="New application">
        <div className="space-y-4">
          <Field label="Type">
            <select value={kind} onChange={e => setKind(e.target.value as Application['kind'])} className={inputCls}>
              <option value="Bonafide">Bonafide certificate</option>
              <option value="TC">Transfer certificate</option>
            </select>
          </Field>
          <Field label="Reason"><textarea value={detail} onChange={e => setDetail(e.target.value)} rows={3} placeholder="Why do you need this document?" className={inputCls} /></Field>
          <button onClick={apply} disabled={!detail.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Submit application</button>
        </div>
      </Modal>
    </div>
  )
}

/* ── People management (students, teachers, staff, parents, admins) ── */

type PeopleTabId = 'students' | 'teachers' | 'staff' | 'parents' | 'admins'
type PeopleTab = { id: PeopleTabId; label: string; singular: string; roles: Role[] }

const ALL_TABS: PeopleTab[] = [
  { id: 'students', label: 'Students', singular: 'student', roles: ['student'] },
  { id: 'teachers', label: 'Teachers', singular: 'teacher', roles: ['teacher'] },
  { id: 'staff', label: 'Staff', singular: 'staff', roles: ['staff'] },
  { id: 'parents', label: 'Parents', singular: 'parent', roles: ['parent'] },
  { id: 'admins', label: 'Admins', singular: 'admin', roles: ['admin', 'superadmin'] },
]

/** Placeholder hint only — the server derives the real default (server/src/userDefaults.ts). */
function emailHint(name: string, role: Role) {
  const base = name.trim().toLowerCase().replace(/[^a-z]+/g, '.').replace(/(^\.|\.$)/g, '') || 'first.last'
  return role === 'parent' ? `parent.${base}@edunova.in` : `${base}@edunova.in`
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

interface PersonForm {
  name: string
  email: string
  role: Role
  // student
  classId: string
  rollNo: string
  board: Board
  dob: string
  parentIds: string[]
  // parent
  studentIds: string[]
  phone: string
  // teacher
  classTeacherOf: string
  joinDate: string
  salary: number
  // staff / admin
  department: string
  designation: string
}

const emptyPersonForm = (role: Role): PersonForm => ({
  name: '', email: '', role,
  classId: '', rollNo: '', board: 'CBSE', dob: '', parentIds: [],
  studentIds: [], phone: '',
  classTeacherOf: '', joinDate: todayISO(), salary: 0,
  department: '', designation: '',
})

function PickList({ items, selected, onToggle, empty }: { items: { id: string; label: string; sub?: string }[]; selected: string[]; onToggle: (id: string) => void; empty: string }) {
  if (items.length === 0) return <p className="rounded-xl border border-dashed border-black/15 dark:border-white/15 px-3 py-2.5 text-[13px] text-black/45 dark:text-white/45">{empty}</p>
  return (
    <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto thin-scroll sm:grid-cols-2">
      {items.map(it => (
        <label key={it.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-[13px] transition-colors ${selected.includes(it.id) ? 'border-indigo-300 bg-indigo-50/60 dark:border-indigo-500/40 dark:bg-indigo-500/10' : 'border-black/10 dark:border-white/15'}`}>
          <input type="checkbox" checked={selected.includes(it.id)} onChange={() => onToggle(it.id)} />
          <span className="min-w-0 flex-1 truncate font-medium">{it.label}</span>
          {it.sub && <span className="shrink-0 text-[11.5px] text-black/45 dark:text-white/45">{it.sub}</span>}
        </label>
      ))}
    </div>
  )
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); toast.success(`${label} copied`) }
    catch { toast.error('Could not copy — select the text manually') }
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">{label}</p>
        <p className="select-all truncate font-mono text-[14px]">{value}</p>
      </div>
      <button onClick={copy} className="flex items-center gap-1 rounded-full bg-white dark:bg-[#14141f] px-3 py-1.5 text-[12px] font-semibold ring-1 ring-black/10 dark:ring-white/15 hover:bg-black/[.04] dark:hover:bg-white/[.08]" title={`Copy ${label.toLowerCase()}`}>
        <Copy size={13} /> Copy
      </button>
    </div>
  )
}

export function PeopleMod() {
  const { db, user, createUser, updateUser, deleteUser, refreshAcademic, refreshDB } = useStore()
  const academic = useAcademic()
  const { currentYear, classById, subjectById, classOf, wardsOf, classesTaughtBy } = academic
  const current = user!
  const isSuper = isSuperAdmin(current)

  const tabs = ALL_TABS.filter(t => t.id !== 'admins' || isSuper)
  const [tab, setTabState] = useState<PeopleTabId>('students')

  const [search, setSearch] = useState('')
  const [cls, setCls] = useState('')
  const [subject, setSubject] = useState('')
  const [department, setDepartment] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [viewReportId, setViewReportId] = useState<string | null>(null)
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null)

  const setTab = (t: PeopleTabId) => { setTabState(t); setCls(''); setSubject(''); setDepartment('') }

  const activeTab = tabs.find(t => t.id === tab) ?? tabs[0]
  const activeRoles = activeTab.roles

  /* ── entity lookups ── */
  const yearClasses = useMemo(
    () => academic.classes.filter(c => !currentYear || c.academicYearId === currentYear.id).slice().sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    [academic.classes, currentYear],
  )
  const userById = useMemo(() => new Map(db.users.map(u => [u.id, u])), [db.users])
  const students = useMemo(() => db.users.filter(u => u.role === 'student').sort(byName), [db.users])
  const parents = useMemo(() => db.users.filter(u => u.role === 'parent').sort(byName), [db.users])

  const enrollmentOf = (studentId: string) =>
    academic.enrollments.find(e => e.studentId === studentId && e.status === 'active' && (!currentYear || e.academicYearId === currentYear.id))
    ?? academic.enrollments.find(e => e.studentId === studentId)
  const guardiansOf = (studentId: string) => academic.guardians.filter(g => g.studentId === studentId)
  const classTeacherOf = (teacherId: string) => academic.classes.find(c => c.classTeacherId === teacherId)
  const teachingOf = (teacherId: string) => academic.classSubjects
    .filter(cs => cs.teacherId === teacherId)
    .map(cs => ({ id: cs.id, label: `${subjectById.get(cs.subjectId)?.name ?? 'Subject'} · ${classById.get(cs.classId)?.label ?? '—'}` }))

  const departmentOptions = useMemo(
    () => Array.from(new Set(db.users.map(u => u.department).filter((d): d is string => !!d))).sort(),
    [db.users],
  )

  const filtersActive = !!(search || cls || subject || department)
  // Class option text: "X-A · CBSE" (plus " · Science" when the class has a stream)
  const classOption = (c: { label: string; boardCode: string; stream?: string }) => `${c.label} · ${c.boardCode}${c.stream ? ' · ' + c.stream : ''}`

  // Plain derivation (no manual useMemo): the React Compiler memoizes it, and the
  // preserve-manual-memoization rule can't prove `activeRoles` stable otherwise.
  const q = search.trim().toLowerCase()
  const filtered = db.users.filter(u => {
    if (!activeRoles.includes(u.role)) return false
    if (cls) {
      if (u.role === 'student' && classOf(u.id)?.id !== cls) return false
      if (u.role === 'teacher' && !classesTaughtBy(u.id).some(c => c.id === cls)) return false
    }
    if (subject && u.role === 'teacher' && !academic.classSubjects.some(cs => cs.teacherId === u.id && cs.subjectId === subject)) return false
    if (department && u.department !== department) return false
    if (q) return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    return true
  }).sort(byName)

  /* ── form ── */
  const [form, setForm] = useState<PersonForm>(() => emptyPersonForm('student'))
  const patch = (p: Partial<PersonForm>) => setForm(f => ({ ...f, ...p }))
  const toggleIn = (key: 'parentIds' | 'studentIds', id: string) =>
    setForm(f => ({ ...f, [key]: f[key].includes(id) ? f[key].filter(x => x !== id) : [...f[key], id] }))

  const openAdd = () => {
    setEditing(null)
    setForm(emptyPersonForm(tab === 'admins' ? 'admin' : activeTab.singular as Role))
    setModalOpen(true)
  }

  const openEdit = (u: User) => {
    const e = enrollmentOf(u.id)
    const c = classOf(u.id)
    setEditing(u)
    setForm({
      ...emptyPersonForm(u.role),
      name: u.name,
      email: u.email,
      classId: c && yearClasses.some(x => x.id === c.id) ? c.id : '',
      rollNo: e?.rollNo ?? u.roll ?? '',
      board: u.board ?? 'CBSE',
      dob: u.dob ?? '',
      parentIds: guardiansOf(u.id).map(g => g.parentId),
      studentIds: wardsOf(u.id),
      phone: u.phone ?? '',
      classTeacherOf: classTeacherOf(u.id)?.id ?? '',
      joinDate: u.joinDate ?? todayISO(),
      salary: u.salary ?? 0,
      department: u.department ?? '',
      designation: u.designation ?? '',
    })
    setModalOpen(true)
  }

  const noClassForStudent = form.role === 'student' && yearClasses.length === 0
  const canSave = !!form.name.trim() && !saving && (form.role !== 'student' || !!form.classId)

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    const name = form.name.trim()
    try {
      if (editing) {
        const id = editing.id
        let touchedAcademic = false
        if (form.role === 'student') {
          await updateUser(id, { name, classId: form.classId, rollNo: form.rollNo.trim(), board: form.board, dob: form.dob || undefined })
          const existing = guardiansOf(id)
          const want = new Set(form.parentIds)
          const toAdd = form.parentIds.filter(pid => !existing.some(g => g.parentId === pid))
          const toRemove = existing.filter(g => !want.has(g.parentId))
          if (toAdd.length || toRemove.length) {
            await Promise.all([
              ...toAdd.map(parentId => api.post('/academic/guardians', { parentId, studentId: id })),
              ...toRemove.map(g => api.del('/academic/guardians/' + g.id)),
            ])
            touchedAcademic = true
          }
        } else if (form.role === 'parent') {
          await updateUser(id, { name, phone: form.phone.trim(), studentIds: form.studentIds })
        } else if (form.role === 'teacher') {
          const prev = classTeacherOf(id)
          await updateUser(id, { name, joinDate: form.joinDate, salary: form.salary, classTeacherOf: form.classTeacherOf || undefined })
          if (prev && !form.classTeacherOf) {
            // Unassign: PATCH /users can only (re)assign, so clear the class directly.
            await api.patch('/academic/classes/' + prev.id, { classTeacherId: null })
            touchedAcademic = true
          }
        } else if (form.role === 'staff') {
          await updateUser(id, { name, department: form.department, designation: form.designation.trim(), joinDate: form.joinDate })
        } else {
          await updateUser(id, { name, designation: form.designation.trim(), department: form.department })
        }
        if (touchedAcademic) await Promise.all([refreshAcademic(), refreshDB()])
        toast.success(`${name} updated`)
      } else {
        const email = form.email.trim() || undefined
        const base = { role: form.role, name, email }
        const input: CreateUserInput =
          form.role === 'student' ? { ...base, classId: form.classId, rollNo: form.rollNo.trim() || undefined, board: form.board, dob: form.dob || undefined }
          : form.role === 'parent' ? { ...base, phone: form.phone.trim() || undefined, studentIds: form.studentIds }
          : form.role === 'teacher' ? { ...base, joinDate: form.joinDate, salary: form.salary, classTeacherOf: form.classTeacherOf || undefined }
          : form.role === 'staff' ? { ...base, department: form.department || undefined, designation: form.designation.trim() || undefined, joinDate: form.joinDate }
          : { ...base, designation: form.designation.trim() || undefined, department: form.department || undefined }
        const res = await createUser(input)
        if (form.role === 'student' && form.parentIds.length) {
          await Promise.all(form.parentIds.map(parentId => api.post('/academic/guardians', { parentId, studentId: res.user.id })))
          await Promise.all([refreshAcademic(), refreshDB()])
        }
        setCreated({ name: res.user.name, email: res.user.email, password: res.password })
        toast.success(`${res.user.name} onboarded as ${res.user.role}`)
      }
      setModalOpen(false)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!confirmId) return
    const ok = await deleteUser(confirmId)
    if (ok) toast.success('Access revoked')
    else toast.error('Cannot delete yourself or the last superadmin')
    setConfirmId(null)
  }

  const canEdit = (u: User) => user ? canManage(user, u, db.users) : false

  const tabLabel = activeTab.label
  const addBlocked = tab === 'students' && yearClasses.length === 0
  const showClassFilter = (tab === 'students' || tab === 'teachers') && yearClasses.length > 0
  const showSubjectFilter = tab === 'teachers' && academic.subjects.length > 0
  const showDeptFilter = (tab === 'staff' || tab === 'admins') && departmentOptions.length > 0

  const emptyText = filtersActive
    ? 'No people match the filters.'
    : tab === 'students'
      ? (yearClasses.length === 0 ? 'No classes yet. Create a class in Academic Setup, then add students.' : 'No students yet. Add the first one.')
      : `No ${tabLabel.toLowerCase()} yet.`

  const roleTone = (r: Role) => r === 'student' ? 'sky' : r === 'teacher' ? 'indigo' : r === 'parent' ? 'green' : r === 'staff' ? 'amber' : 'rose'
  const muted = 'text-[12.5px] text-black/50 dark:text-white/50'

  const details = (u: User) => {
    if (u.role === 'student') {
      const c = classOf(u.id)
      const e = enrollmentOf(u.id)
      const gs = guardiansOf(u.id).map(g => userById.get(g.parentId)?.name).filter(Boolean)
      return (
        <>
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            <span>Class {c?.label ?? '—'}</span>
            {c && <Pill tone="indigo">{c.boardCode}</Pill>}
            {c?.stream && <Pill tone="sky">{c.stream}</Pill>}
            <span>· Roll {e?.rollNo || '—'}</span>
          </p>
          <p className={muted}>Board: {u.board ?? '—'}{u.dob ? ` · DOB ${u.dob}` : ''}</p>
          <p className={muted}>Parent(s): {gs.length ? gs.join(', ') : '—'}</p>
        </>
      )
    }
    if (u.role === 'teacher') {
      const ct = classTeacherOf(u.id)
      const t = teachingOf(u.id)
      return (
        <>
          <p className="font-medium">Class teacher of {ct?.label ?? '—'}{u.salary ? ` · ${fmtINR(u.salary)}` : ''}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {t.length ? t.map(x => <Pill key={x.id} tone="indigo">{x.label}</Pill>) : <span className={muted}>No subjects assigned</span>}
          </div>
        </>
      )
    }
    if (u.role === 'parent') {
      const wards = wardsOf(u.id).map(id => userById.get(id)).filter((w): w is User => !!w)
      return (
        <>
          <p className="font-medium">{wards.length ? `Parent of ${wards.map(w => w.name).join(', ')}` : 'No wards linked'}</p>
          {wards.length > 0 && <p className={muted}>{wards.map(w => `${w.name} · ${classOf(w.id)?.label ?? '—'}`).join(' / ')}</p>}
        </>
      )
    }
    if (u.role === 'staff') {
      return (
        <>
          <p className="font-medium">{u.designation || u.title || '—'}</p>
          <p className={muted}>{u.department || '—'}{u.joinDate ? ` · since ${u.joinDate}` : ''}</p>
        </>
      )
    }
    return (
      <>
        <p className="font-medium">{u.designation || u.title || u.role}</p>
        <p className={muted}>Access: {u.department || '—'}</p>
      </>
    )
  }

  return (
    <div>
      <PageHead title="People Management" sub={`${tabLabel} · search, filter, add, edit and revoke access`}>
        <button onClick={openAdd} disabled={addBlocked} title={addBlocked ? 'Create a class first in Academic Setup' : undefined}
          className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40">
          <UserPlus size={15} /> Add {activeTab.singular}
        </button>
      </PageHead>

      {/* tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${tab === t.id ? 'bg-black text-white' : 'bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white border border-black/[.06] dark:border-white/[.08]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* filters */}
      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#14141f] px-3 py-2">
            <Search size={16} className="text-black/40 dark:text-white/40" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email" className="flex-1 bg-transparent text-[14px] outline-none" />
          </div>
          {showClassFilter && (
            <select value={cls} onChange={e => setCls(e.target.value)} className={inputCls + ' w-auto min-w-[120px]'}>
              <option value="">All classes</option>
              {yearClasses.map(c => <option key={c.id} value={c.id}>{classOption(c)}</option>)}
            </select>
          )}
          {showSubjectFilter && (
            <select value={subject} onChange={e => setSubject(e.target.value)} className={inputCls + ' w-auto min-w-[140px]'}>
              <option value="">All subjects</option>
              {academic.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {showDeptFilter && (
            <select value={department} onChange={e => setDepartment(e.target.value)} className={inputCls + ' w-auto min-w-[140px]'}>
              <option value="">All departments</option>
              {departmentOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {filtersActive && (
            <button onClick={() => { setSearch(''); setCls(''); setSubject(''); setDepartment('') }}
              className="flex items-center gap-1 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
              <X size={13} /> Clear
            </button>
          )}
        </div>
      </Card>

      {/* desktop table */}
      <Card className="hidden p-0 md:block">
        <table className="w-full text-left text-[14px]">
          <thead className="border-b border-black/[.06] dark:border-white/[.08]">
            <tr className="text-[12px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
              <th className="px-6 py-3.5">Person</th>
              <th className="px-6 py-3.5">Role details</th>
              <th className="px-6 py-3.5">Contact</th>
              <th className="px-6 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={u.name} hue={u.avatarHue} size={40} />
                    <div>
                      <p className="font-semibold">{u.name}</p>
                      <Pill tone={roleTone(u.role)}>{u.role}</Pill>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">{details(u)}</td>
                <td className="px-6 py-4">
                  <p className="text-[13.5px]">{u.email}</p>
                  {u.phone && <p className={muted}>{u.phone}</p>}
                </td>
                <td className="px-6 py-4 text-right">
                  {canEdit(u) ? (
                    <div className="flex items-center justify-end gap-2">
                      {u.role === 'student' && (
                        <button onClick={() => setViewReportId(u.id)} className="rounded-full bg-indigo-50 dark:bg-indigo-500/10 p-2 text-indigo-600 hover:bg-indigo-100 dark:hover:bg-indigo-500/20" title="View full report"><FileBadge size={15} /></button>
                      )}
                      <button onClick={() => openEdit(u)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15" title="Edit"><Pencil size={15} /></button>
                      <button onClick={() => setConfirmId(u.id)} className="rounded-full bg-rose-50 p-2 text-rose-500 hover:bg-rose-100" title="Revoke access"><Trash2 size={15} /></button>
                    </div>
                  ) : (
                    <span className="text-[12px] text-black/40 dark:text-white/40">Protected</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="p-6"><Empty text={emptyText} /></div>}
      </Card>

      {/* mobile card list */}
      <div className="space-y-3 md:hidden">
        {filtered.map(u => (
          <Card key={u.id} className="flex items-start gap-3">
            <Avatar name={u.name} hue={u.avatarHue} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-semibold">{u.name}</p>
                <Pill tone={roleTone(u.role)}>{u.role}</Pill>
              </div>
              <p className="truncate text-[13px]">{u.email}</p>
              {u.phone && <p className={muted}>{u.phone}</p>}
              <div className="mt-1.5 text-[13px]">{details(u)}</div>
              {canEdit(u) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {u.role === 'student' && (
                    <button onClick={() => setViewReportId(u.id)} className="btn-ink flex flex-1 items-center justify-center gap-1 py-2 text-[13px] font-semibold"><FileBadge size={14} /> Report</button>
                  )}
                  <button onClick={() => openEdit(u)} className="btn-ink flex flex-1 items-center justify-center gap-1 py-2 text-[13px] font-semibold"><Pencil size={14} /> Edit</button>
                  <button onClick={() => setConfirmId(u.id)} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-rose-50 py-2 text-[13px] font-semibold text-rose-500"><Trash2 size={14} /> Delete</button>
                </div>
              )}
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <Card><Empty text={emptyText} /></Card>}
      </div>

      {/* add/edit modal */}
      <Modal open={modalOpen} onClose={() => !saving && setModalOpen(false)} title={editing ? `Edit ${editing.name}` : `Add ${form.role}`} wide>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <input value={form.name} onChange={e => patch({ name: e.target.value })} placeholder="e.g. Kavya Nair" className={inputCls} autoFocus />
            </Field>
            {editing ? (
              <Field label="Email"><input value={form.email} readOnly className={`${inputCls} bg-black/[.03] dark:bg-white/[.04] text-black/60 dark:text-white/60`} /></Field>
            ) : (
              <Field label="Email (optional)">
                <input type="email" value={form.email} onChange={e => patch({ email: e.target.value })} placeholder={emailHint(form.name, form.role)} className={inputCls} />
              </Field>
            )}
          </div>

          {!editing && (
            <Field label="Role">
              <select value={form.role} onChange={e => setForm(emptyPersonForm(e.target.value as Role))} className={inputCls}>
                {(['student', 'teacher', 'staff', 'parent', ...(isSuper ? ['admin'] : [])] as Role[]).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          )}

          {form.role === 'student' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Class">
                  {noClassForStudent ? (
                    <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-800 dark:text-amber-300">Create a class first in Academic Setup.</p>
                  ) : (
                    <select value={form.classId} onChange={e => patch({ classId: e.target.value })} className={inputCls}>
                      <option value="">Select class</option>
                      {yearClasses.map(c => <option key={c.id} value={c.id}>{classOption(c)}</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Roll number"><input value={form.rollNo} onChange={e => patch({ rollNo: e.target.value })} placeholder="e.g. 12" className={inputCls} /></Field>
                <Field label="Board">
                  <select value={form.board} onChange={e => patch({ board: e.target.value as Board })} className={inputCls}>
                    <option value="CBSE">CBSE</option>
                    <option value="Matric">Matric</option>
                  </select>
                </Field>
                <Field label="Date of birth"><input type="date" value={form.dob} onChange={e => patch({ dob: e.target.value })} className={inputCls} /></Field>
              </div>
              <Field label="Parent(s) — optional">
                <PickList
                  items={parents.map(p => ({ id: p.id, label: p.name, sub: p.phone || p.email }))}
                  selected={form.parentIds}
                  onToggle={id => toggleIn('parentIds', id)}
                  empty="No parent accounts yet. Add parents from the Parents tab and link them here later."
                />
              </Field>
            </div>
          )}

          {form.role === 'parent' && (
            <div className="space-y-4">
              <Field label="Phone"><input value={form.phone} onChange={e => patch({ phone: e.target.value })} placeholder="+91 98765 43210" className={inputCls} /></Field>
              <Field label="Wards">
                <PickList
                  items={students.map(s => ({ id: s.id, label: s.name, sub: classOf(s.id)?.label ?? 'No class' }))}
                  selected={form.studentIds}
                  onToggle={id => toggleIn('studentIds', id)}
                  empty="No students yet. Add students first, then link them here."
                />
              </Field>
            </div>
          )}

          {form.role === 'teacher' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Class teacher of">
                  <select value={form.classTeacherOf} onChange={e => patch({ classTeacherOf: e.target.value })} className={inputCls}>
                    <option value="">{yearClasses.length ? 'None' : 'No classes yet'}</option>
                    {yearClasses.map(c => {
                      const other = c.classTeacherId && c.classTeacherId !== editing?.id ? userById.get(c.classTeacherId)?.name : undefined
                      return <option key={c.id} value={c.id}>{c.label}{other ? ` · currently ${other}` : ''}</option>
                    })}
                  </select>
                </Field>
                <Field label="Joining date"><input type="date" value={form.joinDate} onChange={e => patch({ joinDate: e.target.value })} className={inputCls} /></Field>
                <Field label="Salary (₹)"><input type="number" value={form.salary} onChange={e => patch({ salary: +e.target.value })} className={inputCls} /></Field>
              </div>
              <div>
                <span className="text-[13px] font-semibold text-black/60 dark:text-white/60">Subjects taught</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {editing && teachingOf(editing.id).length > 0
                    ? teachingOf(editing.id).map(x => <Pill key={x.id} tone="indigo">{x.label}</Pill>)
                    : <span className="text-[13px] text-black/45 dark:text-white/45">No subjects assigned yet.</span>}
                </div>
                <p className="mt-1.5 text-[12px] text-black/45 dark:text-white/45">Assign subjects in Classes & Sections → Subjects & teachers.</p>
              </div>
            </div>
          )}

          {form.role === 'staff' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Department">
                <select value={form.department} onChange={e => patch({ department: e.target.value })} className={inputCls}>
                  <option value="">Select department</option>
                  {Array.from(new Set([...departmentOptions, 'Administration', 'Finance', 'Admissions', 'Operations'])).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Designation"><input value={form.designation} onChange={e => patch({ designation: e.target.value })} placeholder="e.g. Office Superintendent" className={inputCls} /></Field>
              <Field label="Joining date"><input type="date" value={form.joinDate} onChange={e => patch({ joinDate: e.target.value })} className={inputCls} /></Field>
            </div>
          )}

          {(form.role === 'admin' || form.role === 'superadmin') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Designation"><input value={form.designation} onChange={e => patch({ designation: e.target.value })} placeholder="e.g. School Administrator" className={inputCls} /></Field>
              <Field label="Access scope">
                <select value={form.department} onChange={e => patch({ department: e.target.value })} className={inputCls}>
                  <option value="">Select scope</option>
                  <option value="Full access">Full access</option>
                  <option value="Finance">Finance only</option>
                  <option value="Academics">Academics only</option>
                  <option value="Admissions">Admissions only</option>
                </select>
              </Field>
            </div>
          )}

          {!editing && (
            <p className="text-[12.5px] text-black/45 dark:text-white/45">A one-time password is generated on creation and shown once — copy it for the new user.</p>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={!canSave} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
            </button>
            <button onClick={() => setModalOpen(false)} disabled={saving} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* one-time credentials */}
      <Modal open={!!created} onClose={() => setCreated(null)} title="Account created">
        {created && (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-black/60 dark:text-white/60">
              Share these credentials with <b>{created.name}</b>. The password is shown only once; they will be asked to change it on first login.
            </p>
            <CredentialRow label="Email" value={created.email} />
            <CredentialRow label="Password" value={created.password} />
            <button onClick={() => setCreated(null)} className="btn-ink w-full py-3 text-[14px] font-semibold">Done</button>
          </div>
        )}
      </Modal>

      {/* delete confirmation */}
      <Modal open={!!confirmId} onClose={() => setConfirmId(null)} title="Revoke access?">
        <div className="space-y-4">
          <p className="text-[14px] text-black/60 dark:text-white/60">This will permanently remove the account. You cannot delete your own account or the last remaining superadmin.</p>
          <div className="flex gap-3">
            <button onClick={confirmDelete} className="btn-ink flex-1 py-3 text-[14px] font-semibold bg-rose-600 hover:bg-rose-700">Revoke access</button>
            <button onClick={() => setConfirmId(null)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!viewReportId} onClose={() => setViewReportId(null)} title="Student Profile Report" wide>
        {viewReportId ? <StudentReportMod studentId={viewReportId} /> : <Empty text="Select a student to view the report." />}
      </Modal>
    </div>
  )
}

/* ── Fees management (admin/staff) ─────────────────────── */

export function FeesMod() {
  const { db, update } = useStore()
  const [label, setLabel] = useState('Lab & Activity Fee')
  const [amount, setAmount] = useState(6500)
  const termId = defaultTermId(db.terms)
  const assign = () => {
    if (!label.trim()) return
    update(d => {
      d.receipts.push({ id: 'r' + Date.now(), label: label.trim(), date: todayISO(), amount, status: 'Due', term: termId, kind: 'fee' })
      return d
    })
    toast.success(`Fee assigned to all students: ${label.trim()}`)
  }
  const fees = db.receipts.filter(r => r.kind === 'fee')
  return (
    <div>
      <PageHead title="Fees" sub="Update and assign fees across classes" />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Assign new fee</p>
          <div className="space-y-4">
            <Field label="Fee head"><input value={label} onChange={e => setLabel(e.target.value)} className={inputCls} /></Field>
            <Field label="Amount (₹)"><input type="number" value={amount} onChange={e => setAmount(+e.target.value)} className={inputCls} /></Field>
            <button onClick={assign} disabled={!label.trim() || !termId} title={termId ? undefined : 'Create a term first in Academic Setup'} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Assign to all classes</button>
            {!termId && <p className="text-[12.5px] text-black/45 dark:text-white/45">Fees are tied to a term — create one in Academic Setup first.</p>}
          </div>
        </Card>
        <Card className="p-0">
          <p className="border-b border-black/[.06] dark:border-white/[.08] px-6 py-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Active fee heads</p>
          {fees.length === 0 && <div className="p-6"><Empty text="No fee heads assigned yet." /></div>}
          {fees.map(f => (
            <div key={f.id} className="flex items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0">
              <span className="flex-1 text-[14px] font-medium">{f.label}</span>
              <span className="text-[14px] font-bold">{fmtINR(f.amount)}</span>
              <Pill tone={statusTone(f.status)}>{f.status}</Pill>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}

/* ── Calendar & curriculum admin ───────────────────────── */

export function CalendarAdminMod() {
  const { db, update } = useStore()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayISO)
  const [type, setType] = useState<'holiday' | 'exam' | 'event'>('event')
  const [termPick, setTerm] = useState('')
  // Fall back to the current term whenever the picked one is unset or no longer exists.
  const term = db.terms.some(t => t.id === termPick) ? termPick : defaultTermId(db.terms)
  const [editing, setEditing] = useState<CalEvent | null>(null)

  const reset = () => {
    setTitle(''); setDate(todayISO()); setType('event'); setTerm(''); setEditing(null)
  }

  const matches = (a: CalEvent, b: CalEvent) => a.date === b.date && a.title === b.title && a.type === b.type && a.term === b.term

  const save = () => {
    if (!title.trim() || !term) return
    update(d => {
      if (editing) {
        const idx = d.events.findIndex(e => matches(e, editing))
        if (idx >= 0) {
          d.events[idx] = { date, title, type, term }
          d.events.sort((a, b) => a.date.localeCompare(b.date))
        }
      } else {
        d.events.push({ date, title, type, term })
        d.events.sort((a, b) => a.date.localeCompare(b.date))
      }
      return d
    })
    toast.success(editing ? 'Event updated' : 'Calendar updated — visible to all portals')
    reset()
  }

  const remove = (e: CalEvent) => {
    update(d => { d.events = d.events.filter(x => !matches(x, e)); return d })
    toast.success('Event removed')
    if (editing && matches(editing, e)) reset()
  }

  const edit = (e: CalEvent) => {
    setEditing(e)
    setTitle(e.title)
    setDate(e.date)
    setType(e.type)
    setTerm(e.term)
  }

  return (
    <div>
      <PageHead title="Calendar Management" sub="Add, edit and remove holidays, exams and events per term" />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <div className="space-y-4">
            <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Founders’ Day rehearsal" className={inputCls} /></Field>
            <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select value={type} onChange={e => setType(e.target.value as 'holiday' | 'exam' | 'event')} className={inputCls}>
                  <option value="event">Event</option><option value="holiday">Holiday</option><option value="exam">Exam</option>
                </select>
              </Field>
              <Field label="Term">
                <select value={term} onChange={e => setTerm(e.target.value)} className={inputCls} disabled={db.terms.length === 0}>
                  {db.terms.length === 0 && <option value="">No terms yet</option>}
                  {db.terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            </div>
            {db.terms.length === 0 && <p className="text-[12.5px] text-black/45 dark:text-white/45">Events belong to a term — create one in Academic Setup first.</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={!title.trim() || !term} className="btn-ink flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">
                <CalendarPlus size={16} /> {editing ? 'Update event' : 'Add to calendar'}
              </button>
              {editing && (
                <button onClick={reset} className="rounded-2xl border border-black/10 dark:border-white/15 px-4 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06]">Cancel</button>
              )}
            </div>
          </div>
        </Card>
        <Card className="p-0">
          <p className="border-b border-black/[.06] dark:border-white/[.08] px-6 py-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Upcoming</p>
          <div className="max-h-[380px] overflow-y-auto thin-scroll">
            {db.events.length === 0 && <div className="p-6"><Empty text="No calendar entries yet." /></div>}
            {db.events.map(e => (
              <div key={e.date + e.title + e.type} className="flex items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3 last:border-0">
                <span className="flex-1 text-[13.5px] font-medium">{e.title}</span>
                <span className="text-[12px] text-black/40 dark:text-white/40">{e.date}</span>
                <Pill tone={e.type === 'holiday' ? 'rose' : e.type === 'exam' ? 'amber' : 'indigo'}>{e.type}</Pill>
                <button onClick={() => edit(e)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15" aria-label="Edit"><Pencil size={14} className="text-black/50 dark:text-white/50" /></button>
                <button onClick={() => remove(e)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-rose-50 dark:hover:bg-rose-500/10" aria-label="Delete"><Trash2 size={14} className="text-rose-500" /></button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ── Board registration details validation ─────────────── */

const BOARD_DETAIL_STATUS: BoardDetailStatus[] = ['Draft', 'Pending', 'Validated', 'SentToBoard']

function boardDetailStatusTone(s: BoardDetailStatus): 'amber' | 'green' | 'sky' | 'slate' {
  if (s === 'SentToBoard') return 'sky'
  if (s === 'Validated') return 'green'
  if (s === 'Pending') return 'amber'
  return 'slate'
}

export function MarksheetMod() {
  const { db, update, user } = useStore()
  const { currentYear, classOf, wardsOf, classesTaughtBy } = useAcademic()
  const [search, setSearch] = useState('')
  const [boardFilter, setBoardFilter] = useState<'All' | Board>('All')
  const [statusFilter, setStatusFilter] = useState<BoardDetailStatus | 'All'>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const visibleStudents = useMemo(() => {
    const all = db.users.filter(u => u.role === 'student')
    if (!user) return []
    if (user.role === 'student') return all.filter(s => s.id === user.id)
    if (user.role === 'parent') {
      const wardIds = new Set(wardsOf(user.id))
      const wards = (user.wards || '').split(',').map(w => w.trim()).filter(Boolean)
      return all.filter(s => wardIds.has(s.id) || s.parentEmail === user.email || wards.some(w => s.name.includes(w)))
    }
    if (user.role === 'teacher') {
      const mine = new Set(classesTaughtBy(user.id).map(c => c.id))
      return all.filter(s => { const c = classOf(s.id); return !!c && mine.has(c.id) })
    }
    return all
  }, [db.users, user, classOf, wardsOf, classesTaughtBy])

  const students = visibleStudents
  const selected = selectedId ? students.find(s => s.id === selectedId) : null
  const detail = selected ? db.boardDetails[selected.id] : null

  const filtered = useMemo(() => {
    return students.filter(s => {
      const d = db.boardDetails[s.id]
      if (!d) return false
      if (boardFilter !== 'All' && d.board !== boardFilter) return false
      if (statusFilter !== 'All' && d.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return s.name.toLowerCase().includes(q) || s.roll?.toLowerCase().includes(q) || d.registrationNo.toLowerCase().includes(q)
      }
      return true
    })
  }, [students, db.boardDetails, boardFilter, statusFilter, search])

  const ensureDetail = (s: User): BoardDetail => {
    const existing = db.boardDetails[s.id]
    if (existing) return existing
    const c = classOf(s.id)
    const created: BoardDetail = {
      studentId: s.id,
      name: s.name,
      board: s.board ?? 'CBSE',
      registrationNo: '',
      schoolName: 'EduNova Senior Secondary School',
      dob: s.dob ?? '',
      rollNo: s.roll ?? '',
      class: c?.grade ?? s.class ?? '',
      section: c?.section ?? s.section ?? '',
      year: currentYear?.label ?? '',
      status: 'Draft',
    }
    update(d => { d.boardDetails[s.id] = created; return d })
    return created
  }

  const openDetail = (s: User) => {
    setSelectedId(s.id)
    ensureDetail(s)
  }

  return (
    <div>
      <PageHead title="Board Registration Details" sub="Validate student data before it is sent to CBSE / Matric boards">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] px-3 py-2">
            <Search size={15} className="text-black/40 dark:text-white/40" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student / reg no." className="bg-transparent text-[13px] outline-none" />
          </div>
          <select value={boardFilter} onChange={e => setBoardFilter(e.target.value as 'All' | Board)} className={`${inputCls} w-auto py-1.5 text-[12.5px]`}>
            <option value="All">All boards</option>
            <option value="CBSE">CBSE</option>
            <option value="Matric">Matric</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as BoardDetailStatus | 'All')} className={`${inputCls} w-auto py-1.5 text-[12.5px]`}>
            <option value="All">All statuses</option>
            {BOARD_DETAIL_STATUS.map(s => <option key={s} value={s}>{s === 'SentToBoard' ? 'Sent to board' : s}</option>)}
          </select>
        </div>
      </PageHead>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-0">
          <div className="border-b border-black/[.06] dark:border-white/[.08] px-6 py-4">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Students ({filtered.length})</p>
          </div>
          {filtered.length === 0 && <div className="p-6"><Empty text={students.length === 0 ? 'No students yet.' : 'No students match the filters.'} /></div>}
          <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
            {filtered.map(s => {
              const d = db.boardDetails[s.id]
              return (
                <button key={s.id} onClick={() => openDetail(s)}
                  className={`flex w-full items-center gap-4 px-6 py-4 text-left transition-colors ${selectedId === s.id ? 'bg-indigo-50/50 dark:bg-indigo-500/10' : 'hover:bg-black/[.02] dark:hover:bg-white/[.04]'}`}>
                  <Avatar name={s.name} hue={s.avatarHue} size={42} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">{s.name}</p>
                    <p className="text-[12.5px] text-black/50 dark:text-white/50">{classOf(s.id)?.label ?? s.class ?? '—'} · Roll {s.roll ?? '–'} · {d?.board}</p>
                  </div>
                  <Pill tone={boardDetailStatusTone(d?.status ?? 'Draft')}>{d?.status === 'SentToBoard' ? 'Sent' : d?.status}</Pill>
                </button>
              )
            })}
          </div>
        </Card>

        <Card>
          {!selected || !detail ? (
            <div className="py-10 text-center">
              <School size={40} className="mx-auto text-black/20 dark:text-white/20" />
              <p className="mt-4 text-[15px] font-semibold text-black/50 dark:text-white/50">Select a student to review board details</p>
            </div>
          ) : (
            <BoardDetailView key={selected.id} student={selected} detail={detail} onEdit={() => setEditOpen(true)} />
          )}
        </Card>
      </div>

      {selected && detail && (
        <EditBoardDetailModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          student={selected}
          detail={detail}
        />
      )}
    </div>
  )
}

function BoardDetailView({ student, detail, onEdit }: { student: User; detail: BoardDetail; onEdit: () => void }) {
  const { update, user } = useStore()
  const { classOf } = useAcademic()
  const [mismatchNote, setMismatchNote] = useState(detail.mismatchNote || '')

  const nameMatch = detail.name.trim().toLowerCase() === student.name.trim().toLowerCase()
  const dobMatch = !!student.dob && detail.dob === student.dob

  const validate = () => {
    update(d => {
      const bd = d.boardDetails[student.id]
      if (!bd) return d
      bd.status = 'Validated'
      bd.validatedBy = user?.name
      bd.validatedAt = new Date().toISOString().slice(0, 10)
      return d
    })
    toast.success('Board details validated')
  }

  const sendToBoard = () => {
    update(d => {
      const bd = d.boardDetails[student.id]
      if (!bd) return d
      bd.status = 'SentToBoard'
      bd.sentToBoard = true
      bd.sentAt = new Date().toISOString().slice(0, 10)
      return d
    })
    toast.success('Details sent to board')
  }

  const updateMismatchNote = (note: string) => {
    setMismatchNote(note)
    update(d => {
      const bd = d.boardDetails[student.id]
      if (!bd) return d
      bd.mismatchNote = note
      return d
    })
  }

  const checklist = [
    { label: 'Student name matches school records (or mismatch noted)', ok: nameMatch || mismatchNote.trim().length > 0 },
    { label: 'Date of birth matches school records (or mismatch noted)', ok: dobMatch || mismatchNote.trim().length > 0 },
    { label: 'Board registration number filled', ok: detail.registrationNo.trim().length > 0 },
    { label: 'Board roll number filled', ok: detail.rollNo.trim().length > 0 },
    { label: 'Class & section filled', ok: !!detail.class && !!detail.section },
    { label: 'Academic year filled', ok: !!detail.year },
    { label: 'School name filled', ok: detail.schoolName.trim().length > 0 },
    { label: 'CBSE affiliation number (if applicable)', ok: detail.board !== 'CBSE' || !!detail.affiliationNo },
  ]

  const allOk = checklist.every(c => c.ok)
  const mismatch = !nameMatch || !dobMatch
  const canValidate = allOk

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={student.name} hue={student.avatarHue} size={48} />
          <div>
            <p className="text-[17px] font-semibold">{student.name}</p>
            <p className="text-[13px] text-black/50 dark:text-white/50">{classOf(student.id)?.label ?? student.class ?? '—'} · Roll {student.roll ?? '–'}</p>
          </div>
        </div>
        <Pill tone={boardDetailStatusTone(detail.status)}>{detail.status === 'SentToBoard' ? 'Sent to board' : detail.status}</Pill>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[14px]">
        <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
          <p className="text-[12px] text-black/50 dark:text-white/50">Board</p>
          <p className="font-semibold">{detail.board}</p>
        </div>
        <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
          <p className="text-[12px] text-black/50 dark:text-white/50">Registration no.</p>
          <p className="font-semibold">{detail.registrationNo}</p>
        </div>
        <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
          <p className="text-[12px] text-black/50 dark:text-white/50">Roll no.</p>
          <p className="font-semibold">{detail.rollNo}</p>
        </div>
        <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
          <p className="text-[12px] text-black/50 dark:text-white/50">Date of birth (board record)</p>
          <p className="font-semibold">{detail.dob}</p>
        </div>
        <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
          <p className="text-[12px] text-black/50 dark:text-white/50">Class & section</p>
          <p className="font-semibold">{detail.class}-{detail.section}</p>
        </div>
        <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
          <p className="text-[12px] text-black/50 dark:text-white/50">Academic year</p>
          <p className="font-semibold">{detail.year}</p>
        </div>
        <div className="col-span-2 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
          <p className="text-[12px] text-black/50 dark:text-white/50">School name</p>
          <p className="font-semibold">{detail.schoolName}</p>
        </div>
        {detail.affiliationNo && (
          <div className="col-span-2 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
            <p className="text-[12px] text-black/50 dark:text-white/50">Affiliation no.</p>
            <p className="font-semibold">{detail.affiliationNo}</p>
          </div>
        )}
      </div>

      <div className={`rounded-2xl border p-4 ${mismatch ? 'border-amber-300 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-500/10' : 'border-black/[.06] dark:border-white/[.08]'}`}>
        <div className="mb-3 flex items-center gap-2">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">School record vs Board record</p>
          {mismatch && <Pill tone="amber"><AlertTriangle size={12} /> Mismatch</Pill>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ComparisonRow label="Student name" school={student.name} board={detail.name} match={nameMatch} />
          <ComparisonRow label="Date of birth" school={student.dob ?? 'Not set'} board={detail.dob} match={dobMatch} />
        </div>
        {mismatch && (
          <div className="mt-3">
            <Field label="Mismatch note (required to validate)">
              <textarea value={mismatchNote} onChange={e => updateMismatchNote(e.target.value)} placeholder="e.g., Board record has the official name; school record is missing middle name." className={`${inputCls} min-h-[80px]`} />
            </Field>
            {!mismatchNote.trim() && <p className="mt-2 flex items-center gap-1.5 text-[12px] text-rose-600"><AlertCircle size={13} /> Add a note to explain why the mismatch is acceptable before validating.</p>}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-black/[.06] dark:border-white/[.08] p-4">
        <p className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Validation checklist</p>
        <div className="space-y-2">
          {checklist.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px]">
              {c.ok ? <Check size={14} className="text-emerald-500" /> : <X size={14} className="text-rose-500" />}
              <span className={c.ok ? 'text-black/70 dark:text-white/70' : 'text-black/50 dark:text-white/50'}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      {detail.validatedBy && (
        <p className="text-[12.5px] text-black/50 dark:text-white/50">Validated by {detail.validatedBy} on {detail.validatedAt}</p>
      )}
      {detail.sentToBoard && (
        <p className="text-[12.5px] text-black/50 dark:text-white/50">Sent to board on {detail.sentAt}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={onEdit} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
          <Pencil size={15} /> Edit details
        </button>
        {detail.status !== 'Validated' && detail.status !== 'SentToBoard' && (
          <button onClick={validate} disabled={!canValidate} title={canValidate ? '' : 'Resolve mismatches or add a note to validate'} className="flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
            <Check size={15} /> Validate
          </button>
        )}
        {detail.status === 'Validated' && (
          <button onClick={sendToBoard} className="flex items-center gap-2 rounded-full bg-sky-600 px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-sky-700">
            <Send size={15} /> Send to board
          </button>
        )}
      </div>
    </div>
  )
}

function ComparisonRow({ label, school, board, match }: { label: string; school: string; board: string; match: boolean }) {
  return (
    <div className={`rounded-2xl p-3 ${match ? 'bg-black/[.03] dark:bg-white/[.05]' : 'bg-amber-50/60 dark:bg-amber-500/10 ring-1 ring-amber-200 dark:ring-amber-500/30'}`}>
      <p className="mb-2 text-[12px] font-semibold text-black/50 dark:text-white/50">{label}</p>
      <div className="space-y-1.5 text-[13px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-black/50 dark:text-white/50">School</span>
          <span className="font-medium">{school}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-black/50 dark:text-white/50">Board</span>
          <span className={`font-medium ${match ? '' : 'text-amber-700 dark:text-amber-400'}`}>{board}</span>
        </div>
      </div>
      {!match && <p className="mt-2 flex items-center gap-1 text-[11.5px] font-semibold text-amber-700 dark:text-amber-400"><AlertTriangle size={12} /> Does not match</p>}
    </div>
  )
}

function EditBoardDetailModal({ open, onClose, student, detail }: { open: boolean; onClose: () => void; student: User; detail: BoardDetail }) {
  const { update } = useStore()
  const [name, setName] = useState(detail.name)
  const [board, setBoard] = useState<Board>(detail.board)
  const [registrationNo, setRegistrationNo] = useState(detail.registrationNo)
  const [schoolName, setSchoolName] = useState(detail.schoolName)
  const [dob, setDob] = useState(detail.dob)
  const [rollNo, setRollNo] = useState(detail.rollNo)
  const [cls, setCls] = useState(detail.class)
  const [section, setSection] = useState(detail.section)
  const [year, setYear] = useState(detail.year)
  const [affiliationNo, setAffiliationNo] = useState(detail.affiliationNo ?? '')
  const [mismatchNote, setMismatchNote] = useState(detail.mismatchNote ?? '')

  const save = () => {
    update(d => {
      const bd = d.boardDetails[student.id]
      if (!bd) return d
      bd.name = name.trim()
      bd.board = board
      bd.registrationNo = registrationNo.trim()
      bd.schoolName = schoolName.trim()
      bd.dob = dob
      bd.rollNo = rollNo.trim()
      bd.class = cls.trim()
      bd.section = section.trim()
      bd.year = year.trim()
      bd.affiliationNo = affiliationNo.trim() || undefined
      bd.mismatchNote = mismatchNote.trim() || undefined
      bd.status = bd.status === 'SentToBoard' ? 'Validated' : bd.status
      return d
    })
    onClose()
    toast.success('Board details updated')
  }

  return (
    <Modal open={open} onClose={onClose} title={`Edit board details — ${student.name}`} wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Board">
            <select value={board} onChange={e => setBoard(e.target.value as Board)} className={inputCls}>
              <option value="CBSE">CBSE</option>
              <option value="Matric">Matric</option>
            </select>
          </Field>
          <Field label="Student name (board record)"><input value={name} onChange={e => setName(e.target.value)} className={inputCls} /></Field>
          <Field label="Registration no."><input value={registrationNo} onChange={e => setRegistrationNo(e.target.value)} className={inputCls} /></Field>
          <Field label="Roll no."><input value={rollNo} onChange={e => setRollNo(e.target.value)} className={inputCls} /></Field>
          <Field label="Date of birth"><input type="date" value={dob} onChange={e => setDob(e.target.value)} className={inputCls} /></Field>
          <Field label="Class"><input value={cls} onChange={e => setCls(e.target.value)} className={inputCls} /></Field>
          <Field label="Section"><input value={section} onChange={e => setSection(e.target.value)} className={inputCls} /></Field>
          <Field label="Academic year"><input value={year} onChange={e => setYear(e.target.value)} className={inputCls} /></Field>
          <Field label="Affiliation no. (CBSE)"><input value={affiliationNo} onChange={e => setAffiliationNo(e.target.value)} placeholder="Leave blank for Matric" className={inputCls} /></Field>
        </div>
        <Field label="School name"><input value={schoolName} onChange={e => setSchoolName(e.target.value)} className={inputCls} /></Field>
        <Field label="Mismatch note (optional)">
          <textarea value={mismatchNote} onChange={e => setMismatchNote(e.target.value)} placeholder="Explain any mismatch between school and board records." className={`${inputCls} min-h-[80px]`} />
        </Field>
        <button onClick={save} disabled={!name.trim() || !registrationNo.trim() || !rollNo.trim() || !dob || !cls.trim() || !section.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
          Save details
        </button>
      </div>
    </Modal>
  )
}

/* ── Attendance management (staff overview) ────────────── */

export function AttendanceMgmtMod() {
  const { db, update } = useStore()
  const { classOf } = useAcademic()
  const { term, setTerm } = useTerm()
  const termObj = db.terms.find(t => t.id === term) ?? db.terms.find(t => t.id === defaultTermId(db.terms))
  const bounds = termObj ? termBounds(termObj) : { start: todayISO(), end: '' }

  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [date, setDate] = useState(bounds.start)

  useEffect(() => { setDate(bounds.start) }, [bounds.start]) // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => { setGroupFilter('all') }, [roleFilter]) // eslint-disable-line react-hooks/set-state-in-effect

  // Students group by their enrolled class; teachers by legacy class-teacher label; others by department.
  const groupOf = (u: User) => u.role === 'student' ? (classOf(u.id)?.label ?? u.class) : u.role === 'teacher' ? u.class : u.department

  const groupOptions = useMemo(() => {
    const groups = new Set<string>()
    db.users.forEach(u => {
      if (u.role === 'parent' || u.role === 'superadmin') return
      if (roleFilter !== 'all' && u.role !== roleFilter) return
      const group = groupOf(u)
      if (group) groups.add(group)
    })
    return ['all', ...Array.from(groups).sort()]
  }, [db.users, roleFilter, classOf]) // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => {
    return db.users.filter(u => {
      if (u.role === 'parent' || u.role === 'superadmin') return false
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (groupFilter !== 'all') return groupOf(u) === groupFilter
      return true
    })
  }, [db.users, roleFilter, groupFilter, classOf]) // eslint-disable-line react-hooks/exhaustive-deps

  const personStatus = useMemo(() => {
    const map: Record<string, AttendanceStatus> = {}
    people.forEach(p => {
      const rec = db.attendanceRecords.find(r => r.userId === p.id && r.date === date)
      map[p.id] = rec ? rec.status : 'P'
    })
    return map
  }, [db.attendanceRecords, people, date])

  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({})
  useEffect(() => { setDraft(personStatus) }, [personStatus]) // eslint-disable-line react-hooks/set-state-in-effect

  const counts = useMemo(() => {
    const c = { P: 0, A: 0, L: 0, H: 0 }
    Object.values(draft).forEach(s => c[s]++)
    return c
  }, [draft])

  const isHoliday = db.events.some(e => e.date === date && e.type === 'holiday')

  const save = () => {
    update(d => {
      Object.entries(draft).forEach(([userId, status]) => {
        const idx = d.attendanceRecords.findIndex(r => r.userId === userId && r.date === date)
        const person = d.users.find(u => u.id === userId)
        if (idx >= 0) d.attendanceRecords[idx].status = status
        else if (person) d.attendanceRecords.push({ id: 'att_' + Date.now() + '_' + userId, userId, role: person.role, date, status, notes: '' })
      })
      return d
    })
    toast.success(`Attendance saved for ${new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`)
  }

  const setStatus = (userId: string, status: AttendanceStatus) => setDraft(d => ({ ...d, [userId]: status }))

  return (
    <div>
      <PageHead title="Attendance Management" sub={`Daily attendance · ${termObj?.name ?? 'No term set up yet'}`}>
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card>
          <Field label="Date">
            <input type="date" value={date} min={termObj ? bounds.start : undefined} max={termObj ? bounds.end : undefined} onChange={e => setDate(e.target.value)} className={inputCls} />
          </Field>
        </Card>
        <Card>
          <Field label="Role">
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as Role | 'all')} className={inputCls}>
              <option value="all">All</option>
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
        </Card>
        <Card>
          <Field label="Class / Department">
            <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} className={inputCls}>
              {groupOptions.map(g => <option key={g} value={g}>{g === 'all' ? 'All' : g}</option>)}
            </select>
          </Field>
        </Card>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        {([
          ['Present', counts.P, 'green'],
          ['Absent', counts.A, 'rose'],
          ['Leave', counts.L, 'amber'],
          ['Holiday', counts.H, 'sky'],
        ] as const).map(([label, count]) => (
          <Card key={label}>
            <p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">{label}</p>
            <p className="font-display mt-2 text-3xl font-medium">{count}</p>
          </Card>
        ))}
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[.06] dark:border-white/[.08] px-6 py-4">
          <div className="flex items-center gap-3">
            <p className="text-[14px] font-semibold">{people.length} people</p>
            {isHoliday && <Pill tone="rose">Holiday</Pill>}
          </div>
          <button onClick={save} disabled={people.length === 0} className="btn-ink px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">Save attendance</button>
        </div>
        {people.map((p, i) => (
          <div key={p.id} className="flex flex-wrap items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0">
            <span className="w-7 text-[13px] font-semibold text-black/35 dark:text-white/35">{i + 1}</span>
            <Avatar name={p.name} hue={p.avatarHue} size={36} />
            <div className="flex-1">
              <p className="text-[14px] font-semibold">{p.name}</p>
              <p className="text-[12px] text-black/45 dark:text-white/45">{p.role}{groupOf(p) ? ` · ${groupOf(p)}` : ''}</p>
            </div>
            <div className="flex gap-1">
              {(['P', 'A', 'L', 'H'] as AttendanceStatus[]).map(s => (
                <button key={s} onClick={() => setStatus(p.id, s)}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg text-[12px] font-bold transition-colors ${draft[p.id] === s
                    ? s === 'P' ? 'bg-emerald-500 text-white' : s === 'A' ? 'bg-rose-500 text-white' : s === 'L' ? 'bg-amber-500 text-white' : 'bg-sky-500 text-white'
                    : 'bg-black/[.05] dark:bg-white/[.07] text-black/40 dark:text-white/40 hover:bg-black/10 dark:hover:bg-white/15'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ))}
        {people.length === 0 && <div className="p-6"><Empty text="No people match the selected filters." /></div>}
      </Card>
    </div>
  )
}

/* ── Admin / HR: contracts & resignations ──────────────── */

const CONTRACT_STATUSES: ContractStatus[] = ['Draft', 'Active', 'Resigned', 'Terminated']

function contractStatusTone(s: ContractStatus): 'green' | 'amber' | 'rose' | 'slate' {
  if (s === 'Active') return 'green'
  if (s === 'Draft') return 'amber'
  if (s === 'Resigned' || s === 'Terminated') return 'rose'
  return 'slate'
}

export function ContractsResignationsMod() {
  const { db, user, update } = useStore()
  const [tab, setTab] = useState<'contracts' | 'resignations'>('contracts')
  const [editContract, setEditContract] = useState<Contract | null>(null)
  const [editResignation, setEditResignation] = useState<Resignation | null>(null)
  const [notes, setNotes] = useState('')

  const activeContracts = useMemo(() => db.contracts.map(c => ({ c, u: db.users.find(u => u.id === c.userId) })), [db.contracts, db.users])

  const resignations = db.resignations.slice().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

  const approveResignation = (r: Resignation) => {
    update(d => {
      const res = d.resignations.find(x => x.id === r.id)
      if (res) {
        res.status = 'Approved'
        res.approvedBy = user?.name
        res.approvedAt = new Date().toISOString().slice(0, 10)
        res.adminNotes = notes.trim() || undefined
      }
      const c = d.contracts.find(x => x.userId === r.userId)
      if (c && c.status === 'Active') c.status = 'Resigned'
      return d
    })
    setEditResignation(null)
    setNotes('')
    toast.success('Resignation approved · contract status updated')
  }

  const declineResignation = (r: Resignation) => {
    update(d => {
      const res = d.resignations.find(x => x.id === r.id)
      if (res) {
        res.status = 'Declined'
        res.approvedBy = user?.name
        res.approvedAt = new Date().toISOString().slice(0, 10)
        res.adminNotes = notes.trim() || undefined
      }
      return d
    })
    setEditResignation(null)
    setNotes('')
    toast.success('Resignation declined')
  }

  const saveContract = () => {
    if (!editContract) return
    update(d => {
      const c = d.contracts.find(x => x.id === editContract.id)
      if (c) {
        c.designation = editContract.designation
        c.department = editContract.department
        c.salary = editContract.salary
        c.startDate = editContract.startDate
        c.endDate = editContract.endDate
        c.status = editContract.status
        c.clauses = editContract.clauses
      }
      return d
    })
    setEditContract(null)
    toast.success('Contract updated')
  }

  return (
    <div>
      <PageHead title="Contracts & Resignations" sub="Manage employment contracts and approve exit requests">
        <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
          {(['contracts', 'resignations'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${tab === t ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
              {t === 'contracts' ? 'Contracts' : 'Resignations'}
            </button>
          ))}
        </div>
      </PageHead>

      {tab === 'contracts' ? (
        <div className="grid gap-4 md:grid-cols-2">
          {activeContracts.map(({ c, u }) => (
            <Card key={c.id} className="card-lift">
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${c.status === 'Active' ? 'bg-emerald-50 text-emerald-600' : c.status === 'Draft' ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}`}>
                  <Briefcase size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{u?.name ?? 'Unknown'}</p>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">{c.designation}{c.department ? ' · ' + c.department : ''} · {fmtINR(c.salary)}/mo</p>
                  <p className="text-[12px] text-black/40 dark:text-white/40">{c.startDate} → {c.endDate}</p>
                </div>
                <Pill tone={contractStatusTone(c.status)}>{c.status}</Pill>
              </div>
              <div className="mt-4 flex items-start gap-2 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
                <FileText size={16} className="mt-0.5 text-black/40 dark:text-white/40" />
                <p className="text-[12.5px] leading-relaxed text-black/60 dark:text-white/60">{c.clauses}</p>
              </div>
              <button onClick={() => setEditContract(c)} className="btn-ink mt-4 flex w-full items-center justify-center gap-2 py-2.5 text-[13px] font-semibold">
                <Pencil size={14} /> Edit contract
              </button>
            </Card>
          ))}
          {activeContracts.length === 0 && <div className="md:col-span-2"><Empty text="No contracts on file." /></div>}
        </div>
      ) : (
        <div className="grid gap-4">
          {resignations.map(r => {
            const u = db.users.find(x => x.id === r.userId)
            return (
              <Card key={r.id} className="card-lift">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={r.status === 'Approved' ? 'green' : r.status === 'Pending' ? 'amber' : 'rose'}>{r.status}</Pill>
                      {r.status === 'Pending' && <Pill tone="slate"><ShieldAlert size={10} /> awaiting approval</Pill>}
                    </div>
                    <p className="font-display mt-3 text-[17px] font-medium">{u?.name ?? 'Unknown'}</p>
                    <p className="text-[13px] text-black/55 dark:text-white/55">{u?.title}</p>
                    <p className="mt-2 text-[13px] leading-relaxed text-black/70 dark:text-white/70">{r.reason}</p>
                    <p className="mt-1 text-[12.5px] text-black/45 dark:text-white/45">Submitted {new Date(r.submittedAt).toLocaleDateString('en-IN')} · Last working day {new Date(r.lastWorkingDate).toLocaleDateString('en-IN')}</p>
                    {r.adminNotes && <p className="mt-2 text-[12.5px] text-black/50 dark:text-white/50">Admin note: {r.adminNotes}</p>}
                  </div>
                  {r.status === 'Pending' && (
                    <div className="flex gap-2">
                      <button onClick={() => setEditResignation(r)} className="btn-ink px-4 py-2 text-[13px] font-semibold">Review</button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
          {resignations.length === 0 && <Empty text="No resignation requests." />}
        </div>
      )}

      <Modal open={!!editContract} onClose={() => setEditContract(null)} title="Edit contract" wide>
        {editContract && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Designation"><input value={editContract.designation} onChange={e => setEditContract({ ...editContract, designation: e.target.value })} className={inputCls} /></Field>
              <Field label="Department"><input value={editContract.department ?? ''} onChange={e => setEditContract({ ...editContract, department: e.target.value })} className={inputCls} /></Field>
              <Field label="Salary"><input type="number" value={editContract.salary} onChange={e => setEditContract({ ...editContract, salary: Number(e.target.value) })} className={inputCls} /></Field>
              <Field label="Status">
                <select value={editContract.status} onChange={e => setEditContract({ ...editContract, status: e.target.value as ContractStatus })} className={inputCls}>
                  {CONTRACT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Start date"><input type="date" value={editContract.startDate} onChange={e => setEditContract({ ...editContract, startDate: e.target.value })} className={inputCls} /></Field>
              <Field label="End date"><input type="date" value={editContract.endDate} onChange={e => setEditContract({ ...editContract, endDate: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="Clauses"><textarea value={editContract.clauses} onChange={e => setEditContract({ ...editContract, clauses: e.target.value })} rows={3} className={inputCls} /></Field>
            <button onClick={saveContract} className="btn-ink w-full py-3 text-[14px] font-semibold">Save contract</button>
          </div>
        )}
      </Modal>

      <Modal open={!!editResignation} onClose={() => { setEditResignation(null); setNotes('') }} title="Review resignation">
        {editResignation && (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-black/70 dark:text-white/70">{editResignation.reason}</p>
            <Field label="Admin note">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Notes for the employee file…" className={inputCls} />
            </Field>
            <div className="flex gap-2">
              <button onClick={() => approveResignation(editResignation)} className="btn-ink flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-semibold">
                <Check size={16} /> Approve
              </button>
              <button onClick={() => declineResignation(editResignation)} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-rose-50 dark:bg-rose-500/10 py-3 text-[14px] font-semibold text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20">
                <X size={16} /> Decline
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export { FeeDefaultersAndCallsMod } from './feeDefaulters'
export { DisciplinaryCommitteeMod } from './disciplinary'

