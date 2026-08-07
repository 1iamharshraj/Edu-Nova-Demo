import { useState } from 'react'
import { BadgeCheck, CalendarPlus, Check, FileBadge, Minus, Plus, Save, ScrollText, UserPlus } from 'lucide-react'
import { useStore } from '@/lib/store'
import { fmtINR } from '@/lib/data'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, TermTabs, inputCls, statusTone } from '../ui'
import { useTerm } from '../Portal'
import { toast } from 'sonner'

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
            <Pill tone={toneFor(a.kind) as any}>{a.kind}</Pill>
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
            <select value={kind} onChange={e => setKind(e.target.value as any)} className={inputCls}>
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

/* ── People management (staff/admin) ───────────────────── */

export function PeopleMod() {
  const { db, update } = useStore()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('teacher')
  const addUser = () => {
    update(d => {
      d.users.push({ id: 'u' + Date.now(), role: role as any, name, email: name.toLowerCase().replace(/\W+/g, '.') + '@edunova.in', password: 'welcome123', title: 'Newly onboarded', avatarHue: Math.floor(Math.random() * 360), verified: true })
      return d
    })
    setOpen(false); setName(''); toast.success(`${name} onboarded as ${role}`)
  }
  const remove = (id: string) => { update(d => { d.users = d.users.filter(u => u.id !== id); return d }); toast.success('Access revoked') }
  return (
    <div>
      <PageHead title="People" sub="Staff, teachers and students — provision and revoke access">
        <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><UserPlus size={15} /> Onboard</button>
      </PageHead>
      <Card className="p-0">
        {db.users.map(u => (
          <div key={u.id} className="flex items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-4 last:border-0">
            <Avatar name={u.name} hue={u.avatarHue} size={40} />
            <div className="min-w-44 flex-1">
              <p className="text-[14.5px] font-semibold">{u.name}</p>
              <p className="text-[12.5px] text-black/45 dark:text-white/45">{u.email} · {u.title}</p>
            </div>
            <Pill tone="indigo">{u.role}</Pill>
            <button onClick={() => remove(u.id)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] px-4 py-1.5 text-[12px] font-semibold text-rose-500 hover:bg-rose-50">Revoke</button>
          </div>
        ))}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Onboard person">
        <div className="space-y-4">
          <Field label="Full name"><input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="e.g. Kavya Nair" /></Field>
          <Field label="Role">
            <select value={role} onChange={e => setRole(e.target.value)} className={inputCls}>
              {['teacher', 'staff', 'parent', 'student', 'admin'].map(r => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <button onClick={addUser} disabled={!name.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Create account</button>
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
  const add = () => {
    update(d => { d.events.push({ date, title, type, term }); d.events.sort((a, b) => a.date.localeCompare(b.date)); return d })
    setTitle(''); toast.success('Calendar updated — visible to all portals')
  }
  return (
    <div>
      <PageHead title="Calendar Management" sub="Add holidays, exams and events per term" />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <div className="space-y-4">
            <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Founders’ Day rehearsal" className={inputCls} /></Field>
            <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select value={type} onChange={e => setType(e.target.value as any)} className={inputCls}>
                  <option value="event">Event</option><option value="holiday">Holiday</option><option value="exam">Exam</option>
                </select>
              </Field>
              <Field label="Term">
                <select value={term} onChange={e => setTerm(e.target.value)} className={inputCls}>
                  {db.terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            </div>
            <button onClick={add} disabled={!title.trim()} className="btn-ink flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">
              <CalendarPlus size={16} /> Add to calendar
            </button>
          </div>
        </Card>
        <Card className="p-0">
          <p className="border-b border-black/[.06] dark:border-white/[.08] px-6 py-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Upcoming</p>
          <div className="max-h-[380px] overflow-y-auto thin-scroll">
            {db.events.map(e => (
              <div key={e.date + e.title} className="flex items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3 last:border-0">
                <span className="flex-1 text-[13.5px] font-medium">{e.title}</span>
                <span className="text-[12px] text-black/40 dark:text-white/40">{e.date}</span>
                <Pill tone={e.type === 'holiday' ? 'rose' : e.type === 'exam' ? 'amber' : 'indigo'}>{e.type}</Pill>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ── Marksheet validation (boards, 3-step) ─────────────── */

export function MarksheetMod() {
  const [step, setStep] = useState(0)
  const steps = [
    { t: 'Subject totals verified', d: 'Cross-check each subject total against the grade book.' },
    { t: 'Class teacher sign-off', d: 'Meera Krishnan confirms X-A marks are final.' },
    { t: 'Principal seal & publish', d: 'Board-format marksheet locked and published to parents.' },
  ]
  return (
    <div>
      <PageHead title="Marksheet Data Validation" sub="Board classes only · 3-step lock to prevent corrections later" />
      <Card className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-2">
          {steps.map((_s, i) => (
            <div key={i} className="flex flex-1 items-center gap-2">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-black text-white' : 'bg-black/[.07] dark:bg-white/[.09] text-black/40 dark:text-white/40'}`}>
                {i < step ? <Check size={15} /> : i + 1}
              </span>
              {i < steps.length - 1 && <span className={`h-0.5 flex-1 rounded ${i < step ? 'bg-emerald-400' : 'bg-black/10'}`} />}
            </div>
          ))}
        </div>
        {step < 3 ? (
          <div className="text-center">
            <p className="font-display text-2xl font-medium">{steps[step].t}</p>
            <p className="mx-auto mt-2 max-w-sm text-[14px] text-black/50 dark:text-white/50">{steps[step].d}</p>
            <div className="mt-6 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4 text-left text-[13px] text-black/55 dark:text-white/55">
              {step === 0 && 'Mathematics 148/155 · Physics 142/155 · Chemistry 139/155 · English 145/155 · CS 150/155 — all match the grade book.'}
              {step === 1 && 'Signing as class teacher confirms no re-totalling requests are pending for X-A.'}
              {step === 2 && 'Once sealed, the marksheet is published to the parent portal and cannot be edited without a board-level unlock.'}
            </div>
            <button onClick={() => { setStep(step + 1); toast.success(steps[step].t + ' ✓') }}
              className="btn-ink mt-6 px-8 py-3 text-[14px] font-semibold">
              {step === 0 ? 'Verify totals' : step === 1 ? 'Sign off as class teacher' : 'Seal & publish'}
            </button>
          </div>
        ) : (
          <div className="py-6 text-center">
            <BadgeCheck size={52} className="mx-auto text-emerald-500" />
            <p className="font-display mt-4 text-2xl font-medium">Marksheet sealed</p>
            <p className="mt-2 text-[14px] text-black/50 dark:text-white/50">X-A board marksheet is now live in the parent portal.</p>
            <button onClick={() => setStep(0)} className="mt-6 rounded-full bg-black/[.06] dark:bg-white/[.08] px-6 py-2.5 text-[13px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Run again (demo)</button>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ── Attendance management (staff overview) ────────────── */

export function AttendanceMgmtMod() {
  const [present, setPresent] = useState(1184)
  return (
    <div>
      <PageHead title="Attendance Management" sub="School-wide view · students and faculty" />
      <div className="grid gap-5 sm:grid-cols-3">
        {[
          { k: 'Students present today', v: present, of: 1240 },
          { k: 'Faculty present', v: 61, of: 64 },
          { k: 'Leave requests pending', v: 2, of: 0 },
        ].map(s => (
          <Card key={s.k}>
            <p className="text-[12.5px] uppercase tracking-wider text-black/40 dark:text-white/40">{s.k}</p>
            <p className="font-display mt-2 text-4xl font-medium">{s.v.toLocaleString()}{s.of ? <span className="text-xl text-black/35 dark:text-white/35">/{s.of.toLocaleString()}</span> : ''}</p>
            {s.k.includes('Students') && (
              <div className="mt-3 flex gap-2">
                <button onClick={() => setPresent(p => Math.min(1240, p + 1))} className="rounded-full bg-black/[.06] dark:bg-white/[.08] p-2 hover:bg-black/10 dark:hover:bg-white/15"><Plus size={14} /></button>
                <button onClick={() => setPresent(p => Math.max(0, p - 1))} className="rounded-full bg-black/[.06] dark:bg-white/[.08] p-2 hover:bg-black/10 dark:hover:bg-white/15"><Minus size={14} /></button>
              </div>
            )}
          </Card>
        ))}
      </div>
      <Card className="mt-5 p-0">
        <p className="border-b border-black/[.06] dark:border-white/[.08] px-6 py-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Class-wise today</p>
        {['X-A', 'X-B', 'IX-A', 'IX-B', 'VIII-A'].map((c, i) => (
          <div key={c} className="flex items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0">
            <span className="w-14 text-[14px] font-bold">{c}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${92 - i * 3}%` }} />
            </div>
            <span className="text-[13px] font-semibold text-black/60 dark:text-white/60">{92 - i * 3}%</span>
          </div>
        ))}
      </Card>
    </div>
  )
}

