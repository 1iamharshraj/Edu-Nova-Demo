import { useMemo, useState } from 'react'
import { Check, ChevronRight, FileText, Gavel, Lock, Plus, ShieldAlert, Upload } from 'lucide-react'
import { useStore } from '@/lib/store'
import { canManageDisciplinary } from '@/lib/access'
import { type DisciplinaryAction, type DisciplinaryCase, type DisciplinaryStatus } from '@/lib/data'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { toast } from 'sonner'

/* ── helpers ───────────────────────────────────────────── */

const STATUS_CHAIN: DisciplinaryStatus[] = ['Reported', 'Scheduled', 'Heard', 'Decision', 'Action Taken', 'Appealed', 'Closed']

const ACTIONS: DisciplinaryAction[] = ['Warning', 'Suspension', 'Expulsion', 'Community Service', 'Parent Meeting', 'Fine', 'No Action']

function nextStatus(current: DisciplinaryStatus): DisciplinaryStatus | null {
  const i = STATUS_CHAIN.indexOf(current)
  return i >= 0 && i < STATUS_CHAIN.length - 1 ? STATUS_CHAIN[i + 1] : null
}

function statusToneDisciplinary(s: DisciplinaryStatus): 'amber' | 'rose' | 'green' | 'slate' {
  if (s === 'Closed') return 'green'
  if (s === 'Reported') return 'rose'
  if (s === 'Action Taken' || s === 'Appealed') return 'amber'
  return 'slate'
}

/* ── module: disciplinary committee ─────────────────────── */

export function DisciplinaryCommitteeMod() {
  const { db, user, update } = useStore()
  const [createOpen, setCreateOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState<DisciplinaryCase | null>(null)
  const [editStatus, setEditStatus] = useState<DisciplinaryStatus | null>(null)
  const [editAction, setEditAction] = useState<DisciplinaryAction | ''>('')
  const [editHearingDate, setEditHearingDate] = useState('')
  const [editDecision, setEditDecision] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editAppeal, setEditAppeal] = useState('')

  const [formStudent, setFormStudent] = useState('')
  const [formTitle, setFormTitle] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formWitnesses, setFormWitnesses] = useState('')
  const [formEvidence, setFormEvidence] = useState('')
  const [formHearingDate, setFormHearingDate] = useState('')

  const canManage = user ? canManageDisciplinary(user) : false

  const students = useMemo(() => db.users.filter(u => u.role === 'student'), [db.users])

  const visibleCases = useMemo(() => {
    if (!user) return []
    if (canManage) return db.disciplinaryCases
    if (user.role === 'student') return db.disciplinaryCases.filter(c => c.studentId === user.id)
    if (user.role === 'parent') {
      const children = students.filter(s => s.parentEmail === user.email).map(s => s.id)
      return db.disciplinaryCases.filter(c => children.includes(c.studentId))
    }
    return []
  }, [db.disciplinaryCases, user, canManage, students])

  const resetForm = () => {
    setFormStudent('')
    setFormTitle('')
    setFormDescription('')
    setFormWitnesses('')
    setFormEvidence('')
    setFormHearingDate('')
  }

  const createCase = () => {
    const student = students.find(s => s.id === formStudent)
    if (!student || !formTitle.trim() || !formDescription.trim()) return
    const newCase: DisciplinaryCase = {
      id: 'dc_' + Date.now(),
      studentId: student.id,
      studentName: student.name,
      title: formTitle.trim(),
      description: formDescription.trim(),
      reportedBy: user!.name,
      reportedAt: new Date().toISOString().slice(0, 10),
      witnesses: formWitnesses.trim() || undefined,
      evidence: formEvidence.trim() || undefined,
      status: 'Reported',
      hearingDate: formHearingDate || undefined,
    }
    update(d => { d.disciplinaryCases.unshift(newCase); return d })
    setCreateOpen(false)
    resetForm()
    toast.success('Disciplinary case reported')
  }

  const openEdit = (c: DisciplinaryCase) => {
    setDetailOpen(c)
    setEditStatus(c.status)
    setEditAction(c.actionTaken ?? '')
    setEditHearingDate(c.hearingDate ?? '')
    setEditDecision(c.decision ?? '')
    setEditNotes(c.notes ?? '')
    setEditAppeal(c.appeal ?? '')
  }

  const saveCase = () => {
    if (!detailOpen || !canManage) return
    update(d => {
      const c = d.disciplinaryCases.find(x => x.id === detailOpen.id)
      if (!c) return d
      c.status = editStatus ?? c.status
      c.hearingDate = editHearingDate || undefined
      c.decision = editDecision.trim() || undefined
      c.actionTaken = editAction as DisciplinaryAction | undefined
      c.notes = editNotes.trim() || undefined
      c.appeal = editAppeal.trim() || undefined
      return d
    })
    setDetailOpen(null)
    toast.success('Disciplinary case updated')
  }

  const advance = () => {
    if (!detailOpen || !canManage) return
    const nxt = nextStatus(detailOpen.status)
    if (!nxt) return
    setEditStatus(nxt)
    if (nxt === 'Scheduled' && !editHearingDate) {
      setEditHearingDate(new Date().toISOString().slice(0, 10))
    }
    update(d => {
      const c = d.disciplinaryCases.find(x => x.id === detailOpen.id)
      if (!c) return d
      c.status = nxt
      if (nxt === 'Scheduled' && !c.hearingDate) c.hearingDate = new Date().toISOString().slice(0, 10)
      return d
    })
    toast.success(`Case moved to ${nxt}`)
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) => {
    const f = e.target.files?.[0]
    setter(f ? f.name : '')
  }

  return (
    <div>
      <PageHead title="Disciplinary Committee" sub="Report, hear and track disciplinary actions">
        {canManage && (
          <button onClick={() => setCreateOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
            <Plus size={15} /> Report case
          </button>
        )}
      </PageHead>

      <div className="space-y-4">
        {visibleCases.length === 0 && <Empty text={canManage ? 'No cases on record.' : 'No cases linked to your profile.'} />}
        {visibleCases.map(c => (
          <Card key={c.id} className="card-lift">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={statusToneDisciplinary(c.status)}>{c.status}</Pill>
                  {c.actionTaken && <Pill tone="amber">{c.actionTaken}</Pill>}
                  {!canManage && <Pill tone="slate"><Lock size={10} /> read-only</Pill>}
                </div>
                <p className="font-display mt-3 text-[17px] font-medium">{c.title}</p>
                <p className="mt-1 text-[13px] text-black/55 dark:text-white/55">{c.studentName} · reported by {c.reportedBy} on {new Date(c.reportedAt).toLocaleDateString('en-IN')}</p>
                {c.hearingDate && (
                  <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-black/45 dark:text-white/45">
                    <Gavel size={12} /> Hearing: {new Date(c.hearingDate).toLocaleDateString('en-IN')}
                  </p>
                )}
              </div>
              <button onClick={() => openEdit(c)}
                className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                {canManage ? 'Review case' : 'View case'}
              </button>
            </div>
          </Card>
        ))}
      </div>

      {/* Create case */}
      <Modal open={createOpen} onClose={() => { setCreateOpen(false); resetForm() }} title="Report disciplinary case">
        <div className="space-y-4">
          <Field label="Student">
            <select value={formStudent} onChange={e => setFormStudent(e.target.value)} className={inputCls}>
              <option value="">Select student</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name} · {s.class}</option>)}
            </select>
          </Field>
          <Field label="Title"><input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="e.g. Lab equipment misuse" className={inputCls} /></Field>
          <Field label="Description"><textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={3} placeholder="What happened, where, when…" className={inputCls} /></Field>
          <Field label="Witnesses"><input value={formWitnesses} onChange={e => setFormWitnesses(e.target.value)} placeholder="Names of witnesses (optional)" className={inputCls} /></Field>
          <Field label="Hearing date"><input type="date" value={formHearingDate} onChange={e => setFormHearingDate(e.target.value)} className={inputCls} /></Field>
          <label className="flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-black/15 dark:border-white/15 py-6 text-black/40 dark:text-white/40 hover:border-indigo-300 hover:text-indigo-500">
            <Upload size={24} />
            <span className="mt-2 text-[13px] font-medium">{formEvidence ? formEvidence : 'Attach evidence (demo upload)'}</span>
            <input type="file" className="hidden" onChange={e => onFileChange(e, setFormEvidence)} />
          </label>
          <button onClick={createCase} disabled={!formStudent || !formTitle.trim() || !formDescription.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Report case</button>
        </div>
      </Modal>

      {/* Case detail / edit */}
      <Modal open={!!detailOpen} onClose={() => setDetailOpen(null)} title={detailOpen ? detailOpen.title : 'Case detail'} wide>
        {detailOpen && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={statusToneDisciplinary(detailOpen.status)}>{detailOpen.status}</Pill>
              {detailOpen.actionTaken && <Pill tone="amber">{detailOpen.actionTaken}</Pill>}
            </div>

            <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4">
              <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Description</p>
              <p className="mt-1 text-[14px] leading-relaxed text-black/80 dark:text-white/80">{detailOpen.description}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Student</p>
                <p className="text-[14px] font-medium">{detailOpen.studentName}</p>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Reported by</p>
                <p className="text-[14px] font-medium">{detailOpen.reportedBy} · {detailOpen.reportedAt}</p>
              </div>
              {detailOpen.witnesses && (
                <div className="sm:col-span-2">
                  <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Witnesses</p>
                  <p className="text-[14px]">{detailOpen.witnesses}</p>
                </div>
              )}
              {detailOpen.evidence && (
                <div className="sm:col-span-2">
                  <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Evidence</p>
                  <p className="flex items-center gap-2 text-[14px]"><FileText size={14} /> {detailOpen.evidence}</p>
                </div>
              )}
            </div>

            {canManage && (
              <div className="space-y-4 rounded-2xl border border-black/[.08] dark:border-white/[.10] p-4">
                <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Committee actions</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Hearing date">
                    <input type="date" value={editHearingDate} onChange={e => setEditHearingDate(e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="Status">
                    <select value={editStatus ?? detailOpen.status} onChange={e => setEditStatus(e.target.value as DisciplinaryStatus)} className={inputCls}>
                      {STATUS_CHAIN.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="Decision">
                    <textarea value={editDecision} onChange={e => setEditDecision(e.target.value)} rows={2} placeholder="Committee decision" className={inputCls} />
                  </Field>
                  <Field label="Action taken">
                    <select value={editAction} onChange={e => setEditAction(e.target.value as DisciplinaryAction | '')} className={inputCls}>
                      <option value="">Select action</option>
                      {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Notes"><textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2} placeholder="Internal notes" className={inputCls} /></Field>
                <Field label="Appeal"><textarea value={editAppeal} onChange={e => setEditAppeal(e.target.value)} rows={2} placeholder="Appeal details (if any)" className={inputCls} /></Field>

                <div className="flex flex-wrap gap-2">
                  {nextStatus(detailOpen.status) && (
                    <button onClick={advance} className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700">
                      Advance to {nextStatus(detailOpen.status)} <ChevronRight size={14} />
                    </button>
                  )}
                  <button onClick={saveCase} className="flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-2 text-[13px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                    <Check size={14} /> Save
                  </button>
                </div>
              </div>
            )}

            {!canManage && (
              <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4 text-[13px] text-black/50 dark:text-white/50">
                <ShieldAlert size={16} className="mb-2" /> You can view this case because it involves your profile. Only the disciplinary committee can update it.
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
