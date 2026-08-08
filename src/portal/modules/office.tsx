import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Briefcase, CalendarPlus, Check, FileBadge, FileText, Pencil, Plus, Save, School, ScrollText, Search, Send, ShieldAlert, Trash2, UserPlus, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { canManage, isSuperAdmin } from '@/lib/access'
import { fmtINR, type AttendanceStatus, type Board, type BoardDetail, type BoardDetailStatus, type CalEvent, type Contract, type ContractStatus, type Resignation, type Role, type Term, type User } from '@/lib/data'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, TermTabs, inputCls, statusTone } from '../ui'
import { useTerm } from '../Portal'
import { toast } from 'sonner'

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

const ROSTER = ['Aarav Sharma', 'Diya Patel', 'Kabir Singh', 'Anika Menon', 'Rohan Gupta', 'Ira Choudhary', 'Aditya Rao', 'Myra Kapoor', 'Vihaan Joshi', 'Sara Ali']

/* ── Teacher: take attendance ──────────────────────────── */

export function TakeAttendanceMod() {
  const [marks, setMarks] = useState<Record<string, boolean>>(() => Object.fromEntries(ROSTER.map(n => [n, true])))
  const [saved, setSaved] = useState(false)
  const present = Object.values(marks).filter(Boolean).length
  const save = () => { setSaved(true); toast.success(`Attendance saved — ${present}/${ROSTER.length} present`) }
  return (
    <div>
      <PageHead title="Take Attendance" sub="Class X-A · Period 1 · today" />
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-black/[.06] dark:border-white/[.08] px-6 py-4">
          <p className="text-[14px] font-semibold">{present} of {ROSTER.length} present</p>
          <button onClick={() => setMarks(Object.fromEntries(ROSTER.map(n => [n, true])))} className="text-[12.5px] font-semibold text-indigo-600 hover:underline">Mark all present</button>
        </div>
        {ROSTER.map((n, i) => (
          <div key={n} className="flex items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0">
            <span className="w-7 text-[13px] font-semibold text-black/35 dark:text-white/35">{i + 1}</span>
            <Avatar name={n} hue={(i * 47) % 360} size={34} />
            <span className="flex-1 text-[14.5px] font-medium">{n}</span>
            <div className="flex rounded-full bg-black/[.05] dark:bg-white/[.07] p-1">
              {([true, false] as const).map(v => (
                <button key={String(v)} onClick={() => { setMarks(m => ({ ...m, [n]: v })); setSaved(false) }}
                  className={`rounded-full px-4 py-1.5 text-[12.5px] font-bold transition-all ${marks[n] === v ? (v ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white') : 'text-black/40 dark:text-white/40'}`}>
                  {v ? 'P' : 'A'}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="p-5">
          <button onClick={save} className="btn-ink flex w-full items-center justify-center gap-2 py-3.5 text-[14.5px] font-semibold">
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
  const [subject, setSubject] = useState('Mathematics')
  const [assessment, setAssessment] = useState('Term Exam')
  const [max, setMax] = useState(80)
  const [scores, setScores] = useState<Record<string, string>>({})

  const save = () => {
    const row = db.marks[term].find(r => r.subject === subject)
    const aarav = parseInt(scores['Aarav Sharma'] || '')
    if (row && !isNaN(aarav)) {
      update(d => {
        const r = d.marks[term].find(x => x.subject === subject)!
        const a = r.assessments.find(x => x.name === assessment)
        if (a) { a.score = Math.min(aarav, max); a.max = max }
        else r.assessments.push({ name: assessment, score: aarav, max })
        return d
      })
    }
    toast.success(`Grades published for ${subject} · ${assessment}`)
  }

  return (
    <div>
      <PageHead title="Upload Grades" sub="Publish marks for the classes you teach">
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>
      <Card>
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Field label="Subject">
            <select value={subject} onChange={e => setSubject(e.target.value)} className={inputCls}>
              {db.subjects.map(s => <option key={s.id}>{s.name}</option>)}
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
          {ROSTER.map((n, i) => (
            <div key={n} className="flex items-center gap-4">
              <Avatar name={n} hue={(i * 47) % 360} size={32} />
              <span className="flex-1 text-[14px] font-medium">{n}</span>
              <input value={scores[n] ?? ''} onChange={e => setScores(s => ({ ...s, [n]: e.target.value.replace(/\D/g, '') }))}
                placeholder={`/ ${max}`} className={`${inputCls} w-24 text-center`} inputMode="numeric" />
            </div>
          ))}
        </div>
        <button onClick={save} className="btn-ink mt-6 w-full py-3.5 text-[14.5px] font-semibold">Publish grades</button>
      </Card>
    </div>
  )
}

/* ── Teacher: create assignment ────────────────────────── */

export function CreateAssignmentMod() {
  const { db, update } = useStore()
  const { term, setTerm } = useTerm()
  const [subject, setSubject] = useState('Mathematics')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [due, setDue] = useState('2026-04-20')

  const create = () => {
    update(d => {
      d.homework.unshift({ id: 'h' + Date.now(), subject, title, due, term, status: 'Pending', description: desc || '—' })
      return d
    })
    setTitle(''); setDesc('')
    toast.success('Assignment posted to Class X-A')
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
              <select value={subject} onChange={e => setSubject(e.target.value)} className={inputCls}>
                {db.subjects.map(s => <option key={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Circle theorems — worksheet 3" className={inputCls} /></Field>
            <Field label="Instructions"><textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} className={inputCls} /></Field>
            <Field label="Due date"><input type="date" value={due} onChange={e => setDue(e.target.value)} className={inputCls} /></Field>
            <button onClick={create} disabled={!title.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Post assignment</button>
          </div>
        </Card>
        <Card>
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Live for this term</p>
          <div className="space-y-3">
            {db.homework.filter(h => h.term === term).map(h => (
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
  const [notice, setNotice] = useState(false)
  const [declared, setDeclared] = useState(false)
  return (
    <div>
      <PageHead title="My Contract" sub="Employment terms and declarations" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><ScrollText size={15} /> Current contract</p>
          {[
            ['Employee', 'Meera Krishnan · T-0142'],
            ['Designation', 'Senior Mathematics Teacher'],
            ['Class teacher of', 'Class X-A'],
            ['Tenure', '1 Jun 2024 → 31 May 2027'],
            ['Base salary', fmtINR(78400) + ' / month'],
            ['Leave policy', '18 paid days / year · deductions per day beyond'],
            ['Notice period', '60 days, either side'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-black/[.05] dark:border-white/[.07] py-3 text-[14px] last:border-0">
              <span className="text-black/50 dark:text-white/50">{k}</span><span className="font-semibold">{v}</span>
            </div>
          ))}
        </Card>
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><FileBadge size={15} /> Notice period declaration</p>
          {declared ? (
            <div className="rounded-2xl bg-emerald-50 p-5 text-center">
              <BadgeCheck size={36} className="mx-auto text-emerald-600" />
              <p className="mt-3 text-[15px] font-semibold text-emerald-700">Declaration submitted</p>
              <p className="mt-1 text-[13px] text-emerald-600/80">Your 60-day notice clock started on {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}. HR has been notified.</p>
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
    update(d => { const w = d.workAssign.find(x => x.id === id)!; w.status = w.status === 'Done' ? 'Assigned' : 'Done'; return d })
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
  const { db, update } = useStore()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'TC' | 'Bonafide'>('Bonafide')
  const [detail, setDetail] = useState('')

  const rows = approver ? db.applications : db.applications.filter(a => a.name.includes('Aarav'))
  const decide = (id: string, ok: boolean) => {
    update(d => { const a = d.applications.find(x => x.id === id)!; a.status = ok ? 'Approved' : 'Declined'; return d })
    toast.success(ok ? 'Application approved — document queued for issue' : 'Application declined')
  }
  const apply = () => {
    update(d => {
      d.applications.unshift({ id: 'ap' + Date.now(), kind, name: 'Aarav Sharma — X-A', detail, date: new Date().toISOString().slice(0, 10), status: 'Pending' })
      return d
    })
    setOpen(false); setDetail(''); toast.success(kind + ' application submitted')
  }

  const toneFor = (k: string) => k === 'Admission' ? 'indigo' : k === 'TC' ? 'sky' : k === 'Bonafide' ? 'green' : 'rose'
  return (
    <div>
      <PageHead title={approver ? 'Applications & Certificates' : 'TC & Bonafide Applications'}
        sub={approver ? 'Admissions, transfer & bonafide certificates, disciplinary records' : 'Apply and track certificate requests'}>
        {!approver && (
          <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> New application</button>
        )}
      </PageHead>
      <Card className="p-0">
        {rows.map(a => (
          <div key={a.id} className="flex flex-wrap items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-4 last:border-0">
            <Pill tone={toneFor(a.kind)}>{a.kind}</Pill>
            <div className="min-w-52 flex-1">
              <p className="text-[14.5px] font-semibold">{a.name}</p>
              <p className="text-[12.5px] text-black/45 dark:text-white/45">{a.detail} · {new Date(a.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
            </div>
            <Pill tone={statusTone(a.status)}>{a.status}</Pill>
            {approver && a.status === 'Pending' && (
              <div className="flex gap-2">
                <button onClick={() => decide(a.id, true)} className="rounded-full bg-emerald-600 px-4 py-1.5 text-[12.5px] font-semibold text-white">Approve</button>
                <button onClick={() => decide(a.id, false)} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-1.5 text-[12.5px] font-semibold">Decline</button>
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <div className="p-6"><Empty text="No applications yet." /></div>}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="New application">
        <div className="space-y-4">
          <Field label="Type">
            <select value={kind} onChange={e => setKind(e.target.value as 'TC' | 'Bonafide')} className={inputCls}>
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
type PeopleTab = { id: PeopleTabId; label: string; roles: Role[] }

const ALL_TABS: PeopleTab[] = [
  { id: 'students', label: 'Students', roles: ['student'] },
  { id: 'teachers', label: 'Teachers', roles: ['teacher'] },
  { id: 'staff', label: 'Staff', roles: ['staff'] },
  { id: 'parents', label: 'Parents', roles: ['parent'] },
  { id: 'admins', label: 'Admins', roles: ['admin', 'superadmin'] },
]

function rolePassword(role: Role) {
  if (role === 'superadmin') return 'principal123'
  if (role === 'admin') return 'admin123'
  if (role === 'staff') return 'staff123'
  if (role === 'teacher') return 'teacher123'
  if (role === 'parent') return 'parent123'
  return 'student123'
}

function makeEmail(name: string, role: Role) {
  const base = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/(^\.|\.$)/g, '')
  if (role === 'parent') return `parent.${base}@edunova.in`
  return `${base}@edunova.in`
}

export function PeopleMod() {
  const { db, user, update, deleteUser } = useStore()
  const current = user!
  const isSuper = isSuperAdmin(current)

  const tabs = ALL_TABS.filter(t => t.id !== 'admins' || isSuper)
  const [tab, setTab] = useState<PeopleTab['id']>('students')

  const [search, setSearch] = useState('')
  const [cls, setCls] = useState('')
  const [section, setSection] = useState('')
  const [subject, setSubject] = useState('')
  const [department, setDepartment] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const activeRoles = useMemo(() => ALL_TABS.find(t => t.id === tab)?.roles ?? ['student'], [tab])

  const { classOptions, sectionOptions, subjectOptions, departmentOptions } = useMemo(() => {
    const pool = db.users.filter(u => activeRoles.includes(u.role))
    const classes = Array.from(new Set(pool.map(u => u.class).filter(Boolean)))
    const sections = Array.from(new Set(pool.map(u => u.section).filter(Boolean)))
    const subjects = Array.from(new Set([...db.subjects.map(s => s.name), ...db.users.flatMap(u => u.subjects ?? [])]))
    const departments = Array.from(new Set(db.users.map(u => u.department).filter(Boolean)))
    return { classOptions: classes, sectionOptions: sections, subjectOptions: subjects, departmentOptions: departments }
  }, [db.users, db.subjects, activeRoles])

  const filtered = useMemo(() => {
    return db.users.filter(u => {
      if (!activeRoles.includes(u.role)) return false
      if (cls && u.class !== cls) return false
      if (section && u.section !== section) return false
      if (subject && !(u.subjects?.includes(subject))) return false
      if (department && u.department !== department) return false
      if (search) {
        const q = search.toLowerCase()
        return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      }
      return true
    })
  }, [db.users, activeRoles, cls, section, subject, department, search])

  // form state
  const [form, setForm] = useState({
    name: '',
    role: 'student' as Role,
    class: '',
    section: '',
    roll: '',
    parentEmail: '',
    board: 'CBSE' as Board,
    subjects: [] as string[],
    classTeacher: '',
    joinDate: new Date().toISOString().slice(0, 10),
    salary: 0,
    department: '',
    designation: '',
    phone: '',
    wards: '',
  })

  const openAdd = () => {
    const r = (tab === 'admins' ? 'admin' : tab) as Role
    setEditing(null)
    setForm({
      name: '',
      role: r,
      class: '',
      section: '',
      roll: '',
      parentEmail: '',
      board: 'CBSE',
      subjects: [],
      classTeacher: '',
      joinDate: new Date().toISOString().slice(0, 10),
      salary: 0,
      department: '',
      designation: '',
      phone: '',
      wards: '',
    })
    setModalOpen(true)
  }

  const openEdit = (u: User) => {
    setEditing(u)
    setForm({
      name: u.name,
      role: u.role,
      class: u.class ?? '',
      section: u.section ?? '',
      roll: u.roll ?? '',
      parentEmail: u.parentEmail ?? '',
      board: u.board ?? 'CBSE',
      subjects: u.subjects ?? [],
      classTeacher: u.role === 'teacher' ? (u.class ?? '') : '',
      joinDate: u.joinDate ?? new Date().toISOString().slice(0, 10),
      salary: u.salary ?? 0,
      department: u.department ?? '',
      designation: u.designation ?? '',
      phone: u.phone ?? '',
      wards: u.wards ?? '',
    })
    setModalOpen(true)
  }

  const buildTitle = (): string => {
    switch (form.role) {
      case 'student':
        return `Class ${form.class}${form.section ? '-' + form.section : ''} · Roll ${form.roll}`
      case 'teacher':
        return `${form.subjects.join(', ') || '—'} · Class Teacher ${form.classTeacher || '—'}`
      case 'staff':
        return `${form.designation}${form.department ? ' · ' + form.department : ''}`
      case 'admin':
        return `${form.designation}${form.department ? ' · ' + form.department : ''}`
      case 'parent':
        return `Parent of ${form.wards || '—'}`
      default:
        return form.role
    }
  }

  const save = () => {
    if (!form.name.trim()) return
    const title = buildTitle()
    if (editing) {
      update(d => {
        const u = d.users.find(x => x.id === editing.id)
        if (!u) return d
        u.name = form.name.trim()
        u.title = title
        u.role = form.role
        if (form.role === 'student') {
          u.class = form.class
          u.section = form.section
          u.roll = form.roll
          u.parentEmail = form.parentEmail
          u.board = form.board
        } else if (form.role === 'teacher') {
          u.subjects = form.subjects
          u.class = form.classTeacher
          u.joinDate = form.joinDate
          u.salary = form.salary
        } else if (form.role === 'staff') {
          u.department = form.department
          u.designation = form.designation
          u.joinDate = form.joinDate
        } else if (form.role === 'admin') {
          u.designation = form.designation
          u.department = form.department
        } else if (form.role === 'parent') {
          u.phone = form.phone
          u.wards = form.wards
        }
        return d
      })
      toast.success(`${form.name} updated`)
    } else {
      const newUser: User = {
        id: `u_${form.role}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        role: form.role,
        name: form.name.trim(),
        email: makeEmail(form.name.trim(), form.role),
        password: rolePassword(form.role),
        title,
        avatarHue: Math.floor(Math.random() * 360),
        verified: true,
        class: form.role === 'student' ? form.class : form.role === 'teacher' ? form.classTeacher : undefined,
        section: form.role === 'student' ? form.section : undefined,
        roll: form.role === 'student' ? form.roll : undefined,
        parentEmail: form.role === 'student' ? form.parentEmail : undefined,
        board: form.role === 'student' ? form.board : undefined,
        subjects: form.role === 'teacher' ? form.subjects : undefined,
        joinDate: (form.role === 'teacher' || form.role === 'staff') ? form.joinDate : undefined,
        salary: form.role === 'teacher' ? form.salary : undefined,
        department: (form.role === 'staff' || form.role === 'admin') ? form.department : undefined,
        designation: (form.role === 'staff' || form.role === 'admin') ? form.designation : undefined,
        phone: form.role === 'parent' ? form.phone : undefined,
        wards: form.role === 'parent' ? form.wards : undefined,
      }
      update(d => { d.users.push(newUser); return d })
      toast.success(`${newUser.name} onboarded as ${newUser.role}`)
    }
    setModalOpen(false)
  }

  const confirmDelete = () => {
    if (!confirmId) return
    const ok = deleteUser(confirmId)
    if (ok) toast.success('Access revoked')
    else toast.error('Cannot delete yourself or the last superadmin')
    setConfirmId(null)
  }

  const canEdit = (u: User) => user ? canManage(user, u, db.users) : false

  const tabLabel = tabs.find(t => t.id === tab)?.label ?? 'People'

  return (
    <div>
      <PageHead title="People Management" sub={`${tabLabel} · search, filter, add, edit and revoke access`}>
        <button onClick={openAdd} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
          <UserPlus size={15} /> Add person
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
          {classOptions.length > 0 && (
            <select value={cls} onChange={e => setCls(e.target.value)} className={inputCls + ' w-auto min-w-[120px]'}>
              <option value="">All classes</option>
              {classOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {sectionOptions.length > 0 && (
            <select value={section} onChange={e => setSection(e.target.value)} className={inputCls + ' w-auto min-w-[120px]'}>
              <option value="">All sections</option>
              {sectionOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {subjectOptions.length > 0 && (
            <select value={subject} onChange={e => setSubject(e.target.value)} className={inputCls + ' w-auto min-w-[140px]'}>
              <option value="">All subjects</option>
              {subjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {departmentOptions.length > 0 && (
            <select value={department} onChange={e => setDepartment(e.target.value)} className={inputCls + ' w-auto min-w-[140px]'}>
              <option value="">All departments</option>
              {departmentOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {(search || cls || section || subject || department) && (
            <button onClick={() => { setSearch(''); setCls(''); setSection(''); setSubject(''); setDepartment('') }}
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
                      <Pill tone={u.role === 'student' ? 'sky' : u.role === 'teacher' ? 'indigo' : u.role === 'parent' ? 'green' : u.role === 'staff' ? 'amber' : 'rose'}>{u.role}</Pill>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <p className="font-medium">{u.title}</p>
                  {u.role === 'student' && <p className="text-[12.5px] text-black/50 dark:text-white/50">Board: {u.board ?? '—'} · Roll {u.roll ?? '—'}</p>}
                  {u.role === 'teacher' && <p className="text-[12.5px] text-black/50 dark:text-white/50">Subjects: {u.subjects?.join(', ') || '—'} · Salary: {u.salary ? fmtINR(u.salary) : '—'}</p>}
                  {u.role === 'staff' && <p className="text-[12.5px] text-black/50 dark:text-white/50">{u.designation}{u.department ? ' · ' + u.department : ''}</p>}
                  {u.role === 'admin' && <p className="text-[12.5px] text-black/50 dark:text-white/50">{u.designation}{u.department ? ' · Access: ' + u.department : ''}</p>}
                  {u.role === 'parent' && <p className="text-[12.5px] text-black/50 dark:text-white/50">Ward(s): {u.wards ?? '—'}</p>}
                </td>
                <td className="px-6 py-4">
                  <p className="text-[13.5px]">{u.email}</p>
                  {u.phone && <p className="text-[12.5px] text-black/50 dark:text-white/50">{u.phone}</p>}
                  {u.parentEmail && <p className="text-[12.5px] text-black/50 dark:text-white/50">Parent: {u.parentEmail}</p>}
                </td>
                <td className="px-6 py-4 text-right">
                  {canEdit(u) ? (
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(u)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15"><Pencil size={15} /></button>
                      <button onClick={() => setConfirmId(u.id)} className="rounded-full bg-rose-50 p-2 text-rose-500 hover:bg-rose-100"><Trash2 size={15} /></button>
                    </div>
                  ) : (
                    <span className="text-[12px] text-black/40 dark:text-white/40">Protected</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="p-6"><Empty text="No people match the filters." /></div>}
      </Card>

      {/* mobile card list */}
      <div className="space-y-3 md:hidden">
        {filtered.map(u => (
          <Card key={u.id} className="flex items-start gap-3">
            <Avatar name={u.name} hue={u.avatarHue} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-semibold">{u.name}</p>
                <Pill tone={u.role === 'student' ? 'sky' : u.role === 'teacher' ? 'indigo' : u.role === 'parent' ? 'green' : u.role === 'staff' ? 'amber' : 'rose'}>{u.role}</Pill>
              </div>
              <p className="mt-0.5 text-[12.5px] text-black/50 dark:text-white/50">{u.title}</p>
              <p className="truncate text-[13px]">{u.email}</p>
              {u.phone && <p className="text-[12.5px] text-black/50 dark:text-white/50">{u.phone}</p>}
              {u.role === 'student' && <p className="text-[12.5px] text-black/50 dark:text-white/50">{u.class}{u.section ? '-' + u.section : ''} · Roll {u.roll ?? '—'} · {u.board ?? '—'}</p>}
              {u.role === 'teacher' && <p className="text-[12.5px] text-black/50 dark:text-white/50">{u.subjects?.join(', ') || '—'} · {u.salary ? fmtINR(u.salary) : '—'}</p>}
              {u.role === 'staff' && <p className="text-[12.5px] text-black/50 dark:text-white/50">{u.designation}{u.department ? ' · ' + u.department : ''}</p>}
              {u.role === 'admin' && <p className="text-[12.5px] text-black/50 dark:text-white/50">{u.designation}{u.department ? ' · ' + u.department : ''}</p>}
              {u.role === 'parent' && <p className="text-[12.5px] text-black/50 dark:text-white/50">Ward(s): {u.wards ?? '—'}</p>}
              {canEdit(u) && (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => openEdit(u)} className="btn-ink flex flex-1 items-center justify-center gap-1 py-2 text-[13px] font-semibold"><Pencil size={14} /> Edit</button>
                  <button onClick={() => setConfirmId(u.id)} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-rose-50 py-2 text-[13px] font-semibold text-rose-500"><Trash2 size={14} /> Delete</button>
                </div>
              )}
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <Card><Empty text="No people match the filters." /></Card>}
      </div>

      {/* add/edit modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${form.name}` : 'Add person'} wide>
        <div className="space-y-4">
          <Field label="Full name">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Kavya Nair" className={inputCls} />
          </Field>

          <Field label="Role">
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))} disabled={!!editing} className={inputCls}>
              {['student', 'teacher', 'staff', 'parent', 'admin'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>

          {form.role === 'student' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Class"><input value={form.class} onChange={e => setForm(f => ({ ...f, class: e.target.value }))} placeholder="e.g. X" className={inputCls} /></Field>
              <Field label="Section"><input value={form.section} onChange={e => setForm(f => ({ ...f, section: e.target.value }))} placeholder="e.g. A" className={inputCls} /></Field>
              <Field label="Roll number"><input value={form.roll} onChange={e => setForm(f => ({ ...f, roll: e.target.value }))} placeholder="e.g. 12" className={inputCls} /></Field>
              <Field label="Parent email"><input value={form.parentEmail} onChange={e => setForm(f => ({ ...f, parentEmail: e.target.value }))} placeholder="parent@edunova.in" className={inputCls} /></Field>
              <Field label="Board">
                <select value={form.board} onChange={e => setForm(f => ({ ...f, board: e.target.value as Board }))} className={inputCls}>
                  <option value="CBSE">CBSE</option>
                  <option value="Matric">Matric</option>
                </select>
              </Field>
            </div>
          )}

          {form.role === 'teacher' && (
            <div className="space-y-4">
              <Field label="Subjects">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {db.subjects.map(s => (
                    <label key={s.id} className="flex items-center gap-2 rounded-xl border border-black/10 dark:border-white/15 p-2.5 text-[13px]">
                      <input type="checkbox" checked={form.subjects.includes(s.name)} onChange={e => {
                        setForm(f => ({ ...f, subjects: e.target.checked ? [...f.subjects, s.name] : f.subjects.filter(x => x !== s.name) }))
                      }} />
                      {s.name}
                    </label>
                  ))}
                </div>
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Class teacher of"><input value={form.classTeacher} onChange={e => setForm(f => ({ ...f, classTeacher: e.target.value }))} placeholder="e.g. X-A" className={inputCls} /></Field>
                <Field label="Joining date"><input type="date" value={form.joinDate} onChange={e => setForm(f => ({ ...f, joinDate: e.target.value }))} className={inputCls} /></Field>
                <Field label="Salary (₹)"><input type="number" value={form.salary} onChange={e => setForm(f => ({ ...f, salary: +e.target.value }))} className={inputCls} /></Field>
              </div>
            </div>
          )}

          {form.role === 'staff' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Department">
                <select value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className={inputCls}>
                  <option value="">Select department</option>
                  {departmentOptions.map(d => <option key={d} value={d}>{d}</option>)}
                  <option value="Administration">Administration</option>
                  <option value="Finance">Finance</option>
                  <option value="Admissions">Admissions</option>
                  <option value="Operations">Operations</option>
                </select>
              </Field>
              <Field label="Designation"><input value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="e.g. Office Superintendent" className={inputCls} /></Field>
              <Field label="Joining date"><input type="date" value={form.joinDate} onChange={e => setForm(f => ({ ...f, joinDate: e.target.value }))} className={inputCls} /></Field>
            </div>
          )}

          {form.role === 'admin' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Designation"><input value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="e.g. School Administrator" className={inputCls} /></Field>
              <Field label="Access scope">
                <select value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className={inputCls}>
                  <option value="">Select scope</option>
                  <option value="Full access">Full access</option>
                  <option value="Finance">Finance only</option>
                  <option value="Academics">Academics only</option>
                  <option value="Admissions">Admissions only</option>
                </select>
              </Field>
            </div>
          )}

          {form.role === 'parent' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone"><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 98765 43210" className={inputCls} /></Field>
              <Field label="Ward(s)"><input value={form.wards} onChange={e => setForm(f => ({ ...f, wards: e.target.value }))} placeholder="e.g. Aarav Sharma, Diya Patel" className={inputCls} /></Field>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={!form.name.trim()} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{editing ? 'Save changes' : 'Create account'}</button>
            <button onClick={() => setModalOpen(false)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
          </div>
        </div>
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
    </div>
  )
}

/* ── Fees management (admin/staff) ─────────────────────── */

export function FeesMod() {
  const { db, update } = useStore()
  const [label, setLabel] = useState('Lab & Activity Fee — Term 3')
  const [amount, setAmount] = useState(6500)
  const assign = () => {
    update(d => {
      d.receipts.push({ id: 'r' + Date.now(), label, date: new Date().toISOString().slice(0, 10), amount, status: 'Due', term: 't3', kind: 'fee' })
      return d
    })
    toast.success(`Fee assigned to all students: ${label}`)
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
            <button onClick={assign} className="btn-ink w-full py-3 text-[14px] font-semibold">Assign to all classes</button>
          </div>
        </Card>
        <Card className="p-0">
          <p className="border-b border-black/[.06] dark:border-white/[.08] px-6 py-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Active fee heads</p>
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
  const [date, setDate] = useState('2026-04-15')
  const [type, setType] = useState<'holiday' | 'exam' | 'event'>('event')
  const [term, setTerm] = useState('t3')
  const [editing, setEditing] = useState<CalEvent | null>(null)

  const reset = () => {
    setTitle(''); setDate('2026-04-15'); setType('event'); setTerm('t3'); setEditing(null)
  }

  const matches = (a: CalEvent, b: CalEvent) => a.date === b.date && a.title === b.title && a.type === b.type && a.term === b.term

  const save = () => {
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
                <select value={term} onChange={e => setTerm(e.target.value)} className={inputCls}>
                  {db.terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex gap-2">
              <button onClick={save} disabled={!title.trim()} className="btn-ink flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">
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
  const { db, update } = useStore()
  const [search, setSearch] = useState('')
  const [boardFilter, setBoardFilter] = useState<'All' | Board>('All')
  const [statusFilter, setStatusFilter] = useState<BoardDetailStatus | 'All'>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const students = useMemo(() => db.users.filter(u => u.role === 'student'), [db.users])
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
    const created: BoardDetail = {
      studentId: s.id,
      board: 'CBSE',
      registrationNo: '',
      schoolName: 'EduNova Senior Secondary School',
      dob: '2010-01-01',
      rollNo: '',
      class: s.class ?? 'X',
      section: s.section ?? 'A',
      year: '2025-26',
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
          {filtered.length === 0 && <div className="p-6"><Empty text="No students match the filters." /></div>}
          <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
            {filtered.map(s => {
              const d = db.boardDetails[s.id]
              return (
                <button key={s.id} onClick={() => openDetail(s)}
                  className={`flex w-full items-center gap-4 px-6 py-4 text-left transition-colors ${selectedId === s.id ? 'bg-indigo-50/50 dark:bg-indigo-500/10' : 'hover:bg-black/[.02] dark:hover:bg-white/[.04]'}`}>
                  <Avatar name={s.name} hue={s.avatarHue} size={42} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">{s.name}</p>
                    <p className="text-[12.5px] text-black/50 dark:text-white/50">{s.class}{s.section ? '-' + s.section : ''} · Roll {s.roll ?? '–'} · {d?.board}</p>
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
            <BoardDetailView student={selected} detail={detail} onEdit={() => setEditOpen(true)} />
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

  const checklist = [
    { label: 'Student name matches school records', ok: student.name.trim().length > 0 },
    { label: 'Date of birth filled', ok: !!detail.dob },
    { label: 'Board registration number filled', ok: detail.registrationNo.trim().length > 0 },
    { label: 'Board roll number filled', ok: detail.rollNo.trim().length > 0 },
    { label: 'Class & section filled', ok: !!detail.class && !!detail.section },
    { label: 'Academic year filled', ok: !!detail.year },
    { label: 'School name filled', ok: detail.schoolName.trim().length > 0 },
    { label: 'CBSE affiliation number (if applicable)', ok: detail.board !== 'CBSE' || !!detail.affiliationNo },
  ]

  const allOk = checklist.every(c => c.ok)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={student.name} hue={student.avatarHue} size={48} />
          <div>
            <p className="text-[17px] font-semibold">{student.name}</p>
            <p className="text-[13px] text-black/50 dark:text-white/50">{student.class}{student.section ? '-' + student.section : ''} · Roll {student.roll ?? '–'}</p>
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
          <p className="text-[12px] text-black/50 dark:text-white/50">Date of birth</p>
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
          <button onClick={validate} disabled={!allOk} className="flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
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

function EditBoardDetailModal({ open, onClose, student, detail }: { open: boolean; onClose: () => void; student: User; detail: BoardDetail }) {
  const { update } = useStore()
  const [board, setBoard] = useState<Board>(detail.board)
  const [registrationNo, setRegistrationNo] = useState(detail.registrationNo)
  const [schoolName, setSchoolName] = useState(detail.schoolName)
  const [dob, setDob] = useState(detail.dob)
  const [rollNo, setRollNo] = useState(detail.rollNo)
  const [cls, setCls] = useState(detail.class)
  const [section, setSection] = useState(detail.section)
  const [year, setYear] = useState(detail.year)
  const [affiliationNo, setAffiliationNo] = useState(detail.affiliationNo ?? '')

  const save = () => {
    update(d => {
      const bd = d.boardDetails[student.id]
      if (!bd) return d
      bd.board = board
      bd.registrationNo = registrationNo.trim()
      bd.schoolName = schoolName.trim()
      bd.dob = dob
      bd.rollNo = rollNo.trim()
      bd.class = cls.trim()
      bd.section = section.trim()
      bd.year = year.trim()
      bd.affiliationNo = affiliationNo.trim() || undefined
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
          <Field label="Registration no."><input value={registrationNo} onChange={e => setRegistrationNo(e.target.value)} className={inputCls} /></Field>
          <Field label="Roll no."><input value={rollNo} onChange={e => setRollNo(e.target.value)} className={inputCls} /></Field>
          <Field label="Date of birth"><input type="date" value={dob} onChange={e => setDob(e.target.value)} className={inputCls} /></Field>
          <Field label="Class"><input value={cls} onChange={e => setCls(e.target.value)} className={inputCls} /></Field>
          <Field label="Section"><input value={section} onChange={e => setSection(e.target.value)} className={inputCls} /></Field>
          <Field label="Academic year"><input value={year} onChange={e => setYear(e.target.value)} className={inputCls} /></Field>
          <Field label="Affiliation no. (CBSE)"><input value={affiliationNo} onChange={e => setAffiliationNo(e.target.value)} placeholder="Leave blank for Matric" className={inputCls} /></Field>
        </div>
        <Field label="School name"><input value={schoolName} onChange={e => setSchoolName(e.target.value)} className={inputCls} /></Field>
        <button onClick={save} disabled={!registrationNo.trim() || !rollNo.trim() || !dob || !cls.trim() || !section.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
          Save details
        </button>
      </div>
    </Modal>
  )
}

/* ── Attendance management (staff overview) ────────────── */

export function AttendanceMgmtMod() {
  const { db, update } = useStore()
  const { term, setTerm } = useTerm()
  const termObj = db.terms.find(t => t.id === term)!
  const bounds = termBounds(termObj)

  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [date, setDate] = useState(bounds.start)

  useEffect(() => { setDate(bounds.start) }, [bounds.start]) // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => { setGroupFilter('all') }, [roleFilter]) // eslint-disable-line react-hooks/set-state-in-effect

  const groupOptions = useMemo(() => {
    const groups = new Set<string>()
    db.users.forEach(u => {
      if (u.role === 'parent' || u.role === 'superadmin') return
      if (roleFilter !== 'all' && u.role !== roleFilter) return
      const group = u.role === 'student' || u.role === 'teacher' ? u.class : u.department
      if (group) groups.add(group)
    })
    return ['all', ...Array.from(groups).sort()]
  }, [db.users, roleFilter])

  const people = useMemo(() => {
    return db.users.filter(u => {
      if (u.role === 'parent' || u.role === 'superadmin') return false
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (groupFilter !== 'all') {
        const group = u.role === 'student' || u.role === 'teacher' ? u.class : u.department
        return group === groupFilter
      }
      return true
    })
  }, [db.users, roleFilter, groupFilter])

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
      <PageHead title="Attendance Management" sub={`Daily attendance · ${termObj.name}`}>
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card>
          <Field label="Date">
            <input type="date" value={date} min={bounds.start} max={bounds.end} onChange={e => setDate(e.target.value)} className={inputCls} />
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
          <button onClick={save} className="btn-ink px-5 py-2.5 text-[13.5px] font-semibold">Save attendance</button>
        </div>
        {people.map((p, i) => (
          <div key={p.id} className="flex flex-wrap items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0">
            <span className="w-7 text-[13px] font-semibold text-black/35 dark:text-white/35">{i + 1}</span>
            <Avatar name={p.name} hue={p.avatarHue} size={36} />
            <div className="flex-1">
              <p className="text-[14px] font-semibold">{p.name}</p>
              <p className="text-[12px] text-black/45 dark:text-white/45">{p.role}{p.class ? ` · ${p.class}` : p.department ? ` · ${p.department}` : ''}</p>
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

