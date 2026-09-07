import { useMemo, useState } from 'react'
import { Award, CloudUpload, Download, FileSignature, FileText, Plus } from 'lucide-react'
import { useAcademic, useStore } from '@/lib/store'
import { api, downloadFile, errorMessage, uploadFile } from '@/lib/api'
import type { HomeworkRec } from '@/lib/data'
import { fmtDate, homeworkStatus, hwTone, isOpen, useHomework } from '@/lib/hooks/useAcademics'
import { Card, Empty, Field, Modal, PageHead, Pill, TermTabs, VerifyButton, inputCls, statusTone } from '../ui'
import { WardPicker } from './academics'
import { MyPayslipsMod, StudentInvoiceList } from './finance'
import { firstName, useActiveTerm, useViewedStudents, useWard } from './viewer'
import { toast } from 'sonner'

/* ── Homework ──────────────────────────────────────────── */

export function HomeworkMod({ uploader = false }: { uploader?: boolean }) {
  const { db, user } = useStore()
  const { classOf, classSubjects, subjectById } = useAcademic()
  const { term, setTerm } = useActiveTerm()
  const { students, ward, wardId, setWardId } = useWard()
  const cls = ward ? classOf(ward.id) : undefined
  const { items, loading, error, reload } = useHomework(cls?.id, term)
  const [subject, setSubject] = useState('All')
  const all = useMemo(() => (items ?? []).map(h => {
    const cs = classSubjects.find(c => c.id === h.classSubjectId)
    return { h, subject: h.subjectName ?? subjectById.get(cs?.subjectId ?? '')?.name ?? 'Subject', status: homeworkStatus(h, wardId), sub: h.submissions?.find(s => s.studentId === wardId) }
  }).sort((x, y) => y.h.dueDate.localeCompare(x.h.dueDate)), [items, classSubjects, subjectById, wardId])
  const subjects = ['All', ...new Set(all.map(x => x.subject))]
  const list = all.filter(x => subject === 'All' || x.subject === subject)
  const canUpload = uploader && user?.role === 'student'

  const [busy, setBusy] = useState<string | null>(null)
  const submit = async (h: HomeworkRec, picked: FileList | null) => {
    const files = Array.from(picked ?? [])
    if (!files.length) return
    setBusy(h.id)
    try {
      const ids: string[] = []
      for (const f of files) ids.push((await uploadFile(f)).id)
      await api.post(`/homework/${h.id}/submit`, { files: ids })
      reload()
      toast.success(`Submitted ${files.length} file${files.length === 1 ? '' : 's'}`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const download = (id: string) => downloadFile(id).catch(e => toast.error(errorMessage(e)))

  return (
    <div>
      <PageHead title="Homework & Assignments" sub={canUpload ? 'Upload your work before the deadline' : ward && user?.role === 'parent' ? `Track ${firstName(ward.name)}’s submission status` : 'Track submission status'}>
        <div className="flex flex-wrap items-center gap-2">
          <WardPicker students={students} value={wardId} onChange={setWardId} />
          <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
        </div>
      </PageHead>
      {subjects.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {subjects.map(s => (
            <button key={s} onClick={() => setSubject(s)}
              className={`rounded-full px-4 py-2 text-[13px] font-semibold ${subject === s ? 'bg-black text-white' : 'bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60 ring-1 ring-black/10 dark:ring-white/15'}`}>{s}</button>
          ))}
        </div>
      )}
      {!ward ? <Empty text="No student is linked to your account yet." />
        : !cls ? <Empty text={`${firstName(ward.name)} isn't enrolled in a class yet.`} />
        : loading ? <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading homework…</div>
        : error ? <Empty text={error} />
        : (
          <div className="grid gap-4 md:grid-cols-2">
            {list.map(({ h, subject: subj, status, sub }) => (
              <Card key={h.id} className="card-lift">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Pill tone="indigo">{subj}</Pill>
                    <p className="font-display mt-2.5 text-[16.5px] font-medium leading-snug">{h.title}</p>
                  </div>
                  <Pill tone={hwTone(status)}>{status}{sub?.grade ? ` · ${sub.grade}` : ''}</Pill>
                </div>
                {h.description && <p className="mt-2 text-[13.5px] leading-relaxed text-black/55 dark:text-white/55">{h.description}</p>}
                {h.attachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {h.attachments.map((id, i) => (
                      <button key={id} onClick={() => download(id)} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15"><Download size={12} /> Attachment {i + 1}</button>
                    ))}
                  </div>
                )}
                {sub && (
                  <div className="mt-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3 text-[12.5px]">
                    <p className="flex flex-wrap items-center gap-2 text-black/60 dark:text-white/60">
                      <span>Submitted {fmtDate(sub.submittedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      {sub.files.map((id, i) => <button key={id} onClick={() => download(id)} className="flex items-center gap-1 font-semibold text-indigo-600 hover:underline"><FileText size={12} /> File {i + 1}</button>)}
                    </p>
                    {sub.feedback && <p className="mt-1.5 text-black/70 dark:text-white/70"><span className="font-semibold">Feedback:</span> {sub.feedback}</p>}
                  </div>
                )}
                <div className="mt-4 flex items-center justify-between border-t border-black/[.06] dark:border-white/[.08] pt-4">
                  <span className="text-[12.5px] font-medium text-black/45 dark:text-white/45">Due {fmtDate(h.dueDate)}</span>
                  {canUpload && (isOpen(status) || status === 'Returned') && (
                    <label className={`flex cursor-pointer items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-700 ${busy === h.id ? 'pointer-events-none opacity-60' : ''}`}>
                      <CloudUpload size={14} /> {busy === h.id ? 'Uploading…' : status === 'Returned' ? 'Resubmit' : 'Upload work'}
                      <input type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.txt" onChange={e => { submit(h, e.target.files); e.target.value = '' }} />
                    </label>
                  )}
                </div>
              </Card>
            ))}
            {list.length === 0 && <div className="md:col-span-2"><Empty text="No assignments here." /></div>}
          </div>
        )}
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
        {db.slips.length === 0 && <div className="md:col-span-2"><Empty text="No permission slips yet." /></div>}
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
  const wards = useViewedStudents()
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('2026-04-27')
  const [to, setTo] = useState('2026-04-28')
  const [reason, setReason] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [wardId, setWardId] = useState('')
  const ward = wards.find(w => w.id === wardId) ?? wards[0]
  const wardNames = wards.map(w => w.name)

  const create = () => {
    if (!ward) { toast.error('No student is linked to your account yet'); return }
    update(d => {
      d.leaves.unshift({ id: 'l' + Date.now(), student: ward.name, from, to, reason, status: 'Pending', by: user?.name ?? 'Parent' })
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

  const mine = approver ? db.leaves : db.leaves.filter(l => wardNames.includes(l.student))

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
        {mine.length === 0 && <div className="p-6"><Empty text={approver || wards.length ? 'No requests yet.' : 'No student is linked to your account yet.'} /></div>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Request holiday">
        <div className="space-y-4">
          {wards.length > 1 && (
            <Field label="Student">
              <select value={ward?.id ?? ''} onChange={e => setWardId(e.target.value)} className={inputCls}>
                {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} /></Field>
            <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="Reason">
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder={ward ? `Why does ${firstName(ward.name)} need leave?` : 'Reason for leave'} className={inputCls} />
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
        {db.health.length === 0 && <div className="md:col-span-2"><Empty text="No health records yet." /></div>}
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
  const wards = useViewedStudents()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const myNames = user?.role === 'student' ? [user.name] : wards.map(w => w.name)
  const mine = db.achievements.filter(a => (user?.role === 'teacher' ? a.kind === 'teacher' : myNames.includes(a.by)))

  const save = () => {
    const by = user?.role === 'parent' && wards[0] ? wards[0].name : (user?.name ?? 'Student')
    update(d => {
      d.achievements.unshift({ id: 'a' + Date.now(), title, detail, date: new Date().toISOString().slice(0, 10), by, kind: user?.role === 'teacher' ? 'teacher' : 'student' })
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
        {db.achievements.length === 0 && <div className="md:col-span-2"><Empty text="No achievements published yet." /></div>}
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

/** Fee mode: the viewer's own invoices/payments from the API. Salary mode: renders `MyPayslipsMod` (own payslips). */
export function PaymentsMod({ salary = false }: { salary?: boolean }) {
  const { db } = useStore()
  const { term, setTerm } = useActiveTerm()
  const { ward, students, wardId, setWardId } = useWard()

  if (salary) return <MyPayslipsMod />

  return (
    <div>
      <PageHead title="Payments & Receipts" sub={ward ? `Fees for ${ward.name} · download anytime` : 'Fees · download anytime'}>
        <div className="flex flex-wrap items-center gap-2">
          <WardPicker students={students} value={wardId} onChange={setWardId} />
          <TermTabs terms={db.terms} term={term} setTerm={setTerm} />
        </div>
      </PageHead>
      <StudentInvoiceList studentId={ward?.id} termId={term} />
    </div>
  )
}

/* ── Work upload (alias of Homework) ───────────────────── */

export function WorkUploadMod() {
  const { user } = useStore()
  return (
    <div>
      <div className="mb-5 rounded-2xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/60 dark:bg-indigo-500/10 px-4 py-3 text-[13.5px] text-indigo-800 dark:text-indigo-200">
        Work uploads now live with homework — every assignment below takes files directly, and teachers grade them in place.
      </div>
      <HomeworkMod uploader={user?.role === 'student'} />
    </div>
  )
}

export { PaymentGatewayMod } from './paymentGateway'
