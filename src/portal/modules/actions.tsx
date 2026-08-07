import { useState } from 'react'
import { Award, CheckCircle2, CloudUpload, Download, FileSignature, Plus, Receipt, Wallet } from 'lucide-react'
import { useStore } from '@/lib/store'
import { fmtINR } from '@/lib/data'
import { Card, Empty, Field, Modal, PageHead, Pill, TermTabs, VerifyButton, inputCls, statusTone } from '../ui'
import { useTerm } from '../Portal'
import { toast } from 'sonner'

/* ── Homework ──────────────────────────────────────────── */

export function HomeworkMod({ uploader = false }: { uploader?: boolean }) {
  const { db, update } = useStore()
  const { term, setTerm } = useTerm()
  const [subject, setSubject] = useState('All')
  const items = db.homework.filter(h => h.term === term && (subject === 'All' || h.subject === subject))
  const subjects = ['All', ...new Set(db.homework.filter(h => h.term === term).map(h => h.subject))]

  const upload = (id: string) => {
    update(d => { const h = d.homework.find(x => x.id === id)!; h.status = 'Submitted'; return d })
    toast.success('Assignment uploaded successfully')
  }

  return (
    <div>
      <PageHead title="Homework & Assignments" sub={uploader ? 'Upload your work before the deadline' : 'Track Aarav’s submission status'}>
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>
      <div className="mb-5 flex flex-wrap gap-2">
        {subjects.map(s => (
          <button key={s} onClick={() => setSubject(s)}
            className={`rounded-full px-4 py-2 text-[13px] font-semibold ${subject === s ? 'bg-black text-white' : 'bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60 ring-1 ring-black/10 dark:ring-white/15'}`}>{s}</button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map(h => (
          <Card key={h.id} className="card-lift">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Pill tone="indigo">{h.subject}</Pill>
                <p className="font-display mt-2.5 text-[16.5px] font-medium leading-snug">{h.title}</p>
              </div>
              <Pill tone={statusTone(h.status)}>{h.status}{h.grade ? ` · ${h.grade}` : ''}</Pill>
            </div>
            <p className="mt-2 text-[13.5px] leading-relaxed text-black/55 dark:text-white/55">{h.description}</p>
            <div className="mt-4 flex items-center justify-between border-t border-black/[.06] dark:border-white/[.08] pt-4">
              <span className="text-[12.5px] font-medium text-black/45 dark:text-white/45">Due {new Date(h.due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              {uploader && (h.status === 'Pending' || h.status === 'Late') && (
                <button onClick={() => upload(h.id)} className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-700">
                  <CloudUpload size={14} /> Upload work
                </button>
              )}
            </div>
          </Card>
        ))}
        {items.length === 0 && <div className="md:col-span-2"><Empty text="No assignments here." /></div>}
      </div>
    </div>
  )
}

/* ── Permission slips ──────────────────────────────────── */

export function SlipsMod() {
  const { db, update, user } = useStore()
  const decide = (id: string, ok: boolean) => {
    update(d => { const s = d.slips.find(x => x.id === id)!; s.status = ok ? 'Approved' : 'Declined'; return d })
    toast.success(ok ? 'Slip approved with verified signature' : 'Slip declined')
  }
  return (
    <div>
      <PageHead title="Permission Slips" sub="Each approval is stamped with your verified identity" />
      <div className="grid gap-4 md:grid-cols-2">
        {db.slips.map(s => (
          <Card key={s.id}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-display text-[16.5px] font-medium leading-snug">{s.title}</p>
              <Pill tone={statusTone(s.status)}>{s.status}</Pill>
            </div>
            <p className="mt-2 text-[13.5px] leading-relaxed text-black/55 dark:text-white/55">{s.detail}</p>
            <p className="mt-3 text-[12.5px] font-medium text-black/45 dark:text-white/45">Respond by {new Date(s.due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
            {s.status === 'Pending' && (
              <div className="mt-4 flex items-center gap-2.5 border-t border-black/[.06] dark:border-white/[.08] pt-4">
                {user?.verified ? (
                  <>
                    <button onClick={() => decide(s.id, true)} className="rounded-full bg-emerald-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700">Approve</button>
                    <button onClick={() => decide(s.id, false)} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-5 py-2 text-[13px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Decline</button>
                  </>
                ) : (
                  <VerifyButton label="Verify to respond" onVerified={() => toast.success('You can now respond to slips')} />
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

/* ── Holiday / leave requests ──────────────────────────── */

export function LeaveMod({ approver = false }: { approver?: boolean }) {
  const { db, update, user } = useStore()
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('2026-04-27')
  const [to, setTo] = useState('2026-04-28')
  const [reason, setReason] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)

  const create = () => {
    update(d => {
      d.leaves.unshift({ id: 'l' + Date.now(), student: 'Aarav Sharma', from, to, reason, status: 'Pending', by: user?.name ?? 'Parent' })
      return d
    })
    setOpen(false); setReason('')
    toast.success('Leave request sent — call verification will follow')
  }
  const decide = (id: string, ok: boolean) => {
    update(d => { const l = d.leaves.find(x => x.id === id)!; l.status = ok ? 'Approved' : 'Declined'; return d })
    toast.success(ok ? 'Leave approved' : 'Leave declined')
    setPendingId(null)
  }

  const mine = approver ? db.leaves : db.leaves.filter(l => l.student === 'Aarav Sharma')

  return (
    <div>
      <PageHead title={approver ? 'Leave Approvals' : 'Holiday Requests'}
        sub={approver ? 'Requests awaiting your decision' : 'Requests go through call verification + parent auth'}>
        {!approver && (
          <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
            <Plus size={15} /> New request
          </button>
        )}
      </PageHead>
      <Card className="p-0">
        {mine.map(l => (
          <div key={l.id} className="flex flex-wrap items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-4 last:border-0">
            <div className="min-w-40 flex-1">
              <p className="text-[14.5px] font-semibold">{approver ? l.student : l.reason}</p>
              <p className="text-[12.5px] text-black/45 dark:text-white/45">
                {approver ? `${l.reason} · ` : ''}{new Date(l.from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} → {new Date(l.to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · by {l.by}
              </p>
            </div>
            <Pill tone={statusTone(l.status)}>{l.status}</Pill>
            {approver && l.status === 'Pending' && (
              <div className="flex gap-2">
                <button onClick={() => decide(l.id, true)} className="rounded-full bg-emerald-600 px-4 py-1.5 text-[12.5px] font-semibold text-white">Approve</button>
                <button onClick={() => decide(l.id, false)} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-1.5 text-[12.5px] font-semibold">Decline</button>
              </div>
            )}
            {!approver && l.status === 'Pending' && pendingId !== l.id && user && !user.verified && (
              <VerifyButton label="Verify identity" onVerified={() => setPendingId(l.id)} />
            )}
          </div>
        ))}
        {mine.length === 0 && <div className="p-6"><Empty text="No requests yet." /></div>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Request holiday">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} /></Field>
            <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="Reason">
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Why does Aarav need leave?" className={inputCls} />
          </Field>
          {user && !user.verified
            ? <VerifyButton label="Verify & submit" onVerified={create} className="w-full justify-center" />
            : <button onClick={create} disabled={!reason.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Submit request</button>}
        </div>
      </Modal>
    </div>
  )
}

/* ── Health records ────────────────────────────────────── */

export function HealthMod() {
  const { db, update, user } = useStore()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [detail, setDetail] = useState('')

  const save = () => {
    update(d => {
      d.health.unshift({ id: 'hc' + Date.now(), label, detail, date: new Date().toISOString().slice(0, 10), signed: true })
      return d
    })
    setOpen(false); setLabel(''); setDetail('')
    toast.success('Health record added with e-signature')
  }

  return (
    <div>
      <PageHead title="Health Records" sub="Every entry is e-signed after parent verification">
        <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
          <Plus size={15} /> Upload record
        </button>
      </PageHead>
      <div className="grid gap-4 md:grid-cols-2">
        {db.health.map(h => (
          <Card key={h.id}>
            <div className="flex items-start justify-between">
              <p className="font-display text-[16.5px] font-medium">{h.label}</p>
              {h.signed && <Pill tone="green"><FileSignature size={11} /> e-signed</Pill>}
            </div>
            <p className="mt-2 text-[13.5px] text-black/55 dark:text-white/55">{h.detail}</p>
            <p className="mt-3 text-[12.5px] text-black/40 dark:text-white/40">Added {new Date(h.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          </Card>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Upload health record">
        <div className="space-y-4">
          <Field label="Title"><input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Blood report 2026" className={inputCls} /></Field>
          <Field label="Details"><textarea value={detail} onChange={e => setDetail(e.target.value)} rows={3} placeholder="Diagnosis, allergies, doctor notes…" className={inputCls} /></Field>
          <label className="flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-black/15 dark:border-white/15 py-8 text-black/40 dark:text-white/40 hover:border-indigo-300 hover:text-indigo-500">
            <CloudUpload size={26} />
            <span className="mt-2 text-[13px] font-medium">Drop the document here (demo)</span>
            <input type="file" className="hidden" />
          </label>
          <p className="text-[12.5px] leading-relaxed text-black/50 dark:text-white/50">
            By submitting you declare this information is accurate and consent to share it with the school infirmary.
          </p>
          {user && !user.verified
            ? <VerifyButton label="Verify & e-sign" onVerified={save} className="w-full justify-center" />
            : <button onClick={save} disabled={!label.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Sign & submit</button>}
        </div>
      </Modal>
    </div>
  )
}

/* ── Achievements ──────────────────────────────────────── */

export function AchievementsMod() {
  const { db, update, user } = useStore()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const mine = db.achievements.filter(a => (user?.role === 'teacher' ? a.kind === 'teacher' : a.by === 'Aarav Sharma'))

  const save = () => {
    update(d => {
      d.achievements.unshift({ id: 'a' + Date.now(), title, detail, date: new Date().toISOString().slice(0, 10), by: user?.name ?? 'Aarav Sharma', kind: user?.role === 'teacher' ? 'teacher' : 'student' })
      return d
    })
    setOpen(false); setTitle(''); setDetail('')
    toast.success('Achievement published to the school wall')
  }

  return (
    <div>
      <PageHead title="Achievements" sub="Upload certificates and wins to the school wall">
        <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
          <Plus size={15} /> Add achievement
        </button>
      </PageHead>
      <div className="grid gap-4 md:grid-cols-2">
        {[...mine, ...db.achievements.filter(a => !mine.includes(a))].map(a => (
          <Card key={a.id} className="card-lift">
            <div className="flex items-center gap-3.5">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/20 to-orange-400/20">
                <Award size={20} className="text-amber-500" />
              </span>
              <div>
                <p className="font-display text-[16px] font-medium leading-tight">{a.title}</p>
                <p className="text-[12px] text-black/45 dark:text-white/45">{a.by} · {new Date(a.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>
            </div>
            <p className="mt-3 text-[13.5px] text-black/55 dark:text-white/55">{a.detail}</p>
          </Card>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Add achievement">
        <div className="space-y-4">
          <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Silver — National Science Fair" className={inputCls} /></Field>
          <Field label="Details"><textarea value={detail} onChange={e => setDetail(e.target.value)} rows={3} placeholder="What happened, when, which category…" className={inputCls} /></Field>
          <button onClick={save} disabled={!title.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Publish</button>
        </div>
      </Modal>
    </div>
  )
}

/* ── Payments & receipts ───────────────────────────────── */

export function PaymentsMod({ salary = false }: { salary?: boolean }) {
  const { db, update } = useStore()
  const { term, setTerm } = useTerm()
  const rows = db.receipts.filter(r => r.kind === (salary ? 'salary' : 'fee') && r.term === term)
  const total = rows.reduce((a, r) => a + r.amount, 0)

  const download = (label: string) => {
    const blob = new Blob([`EduNova School · Official Receipt\n\n${label}\nGenerated ${new Date().toLocaleString()}\n\nThis is a demo receipt.`], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = label.replace(/\W+/g, '_') + '.txt'; a.click()
    toast.success('Receipt downloaded')
  }
  const pay = (id: string) => {
    update(d => { const r = d.receipts.find(x => x.id === id)!; r.status = 'Paid'; r.date = new Date().toISOString().slice(0, 10); return d })
    toast.success('Payment successful — receipt issued')
  }

  return (
    <div>
      <PageHead title={salary ? 'Salary Receipts' : 'Payments & Receipts'} sub={salary ? 'Monthly payslips with leave-based deductions' : 'Fees for Aarav Sharma · download anytime'}>
        <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
      </PageHead>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50"><Wallet size={20} className="text-indigo-600" /></span>
          <div><p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">Total this term</p><p className="font-display text-2xl font-medium">{fmtINR(total)}</p></div>
        </Card>
        <Card className="flex items-center gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50"><CheckCircle2 size={20} className="text-emerald-600" /></span>
          <div><p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">Paid</p><p className="font-display text-2xl font-medium">{fmtINR(rows.filter(r => r.status === 'Paid').reduce((a, r) => a + r.amount, 0))}</p></div>
        </Card>
        <Card className="flex items-center gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50"><Receipt size={20} className="text-amber-600" /></span>
          <div><p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">Due</p><p className="font-display text-2xl font-medium">{fmtINR(rows.filter(r => r.status === 'Due').reduce((a, r) => a + r.amount, 0))}</p></div>
        </Card>
      </div>
      <Card className="p-0">
        {rows.map(r => (
          <div key={r.id} className="flex flex-wrap items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-4 last:border-0">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${r.status === 'Paid' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
              <Receipt size={18} />
            </span>
            <div className="min-w-48 flex-1">
              <p className="text-[14.5px] font-semibold">{r.label}</p>
              <p className="text-[12.5px] text-black/45 dark:text-white/45">{new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
            </div>
            <p className="text-[15px] font-bold">{fmtINR(r.amount)}</p>
            <Pill tone={statusTone(r.status)}>{r.status}</Pill>
            <div className="flex gap-2">
              {r.status === 'Due' && <button onClick={() => pay(r.id)} className="rounded-full bg-indigo-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-700">Pay now</button>}
              {r.status === 'Paid' && (
                <button onClick={() => download(r.label)} className="flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                  <Download size={13} /> Receipt
                </button>
              )}
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="p-6"><Empty text="Nothing here for this term." /></div>}
      </Card>
    </div>
  )
}
