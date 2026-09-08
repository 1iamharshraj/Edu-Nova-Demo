import { useMemo, useState } from 'react'
import { Archive, Check, ChevronRight, FileText, Gavel, Lock, MessageSquarePlus, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { canManageDisciplinary, isAdmin } from '@/lib/access'
import { api, downloadFile, errorMessage } from '@/lib/api'
import type { DisciplinaryActionRec, DisciplinaryCaseRec, DisciplinaryCaseStatus } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import {
  DISCIPLINARY_ACTIONS, disciplinaryTone, nextDisciplinaryStatus, useDisciplinaryCases, useDisciplinaryNotes,
} from '@/lib/hooks/useWelfare'
import { Card, Empty, Field, Modal, PageHead, Pill, UploadField, inputCls, type UploadedFile } from '../ui'

// Disciplinary committee: report (teacher, class-scoped / staff / admin), a status timeline of `DisciplinaryNote`s
// (advance status or add a free note — both write a note), real evidence file uploads, and admin soft delete with
// an Archived filter. See .agents/edunova/phase-8-welfare.md

/* ── module: disciplinary committee ─────────────────────── */

export function DisciplinaryCommitteeMod() {
  const { db, user } = useStore()
  const { classOf, classesTaughtBy, enrollments } = useAcademic()
  const canManage = user ? canManageDisciplinary(user) : false
  const canDelete = user ? isAdmin(user) : false

  const [showArchived, setShowArchived] = useState(false)
  const { items: cases, loading, error, reload } = useDisciplinaryCases({ includeArchived: showArchived && canDelete }, !!user)
  const sorted = useMemo(() => [...(cases ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [cases])
  // The server doesn't always decorate studentName/reportedByName — resolve from db.users when absent.
  const nameOf = (id: string) => db.users.find(u => u.id === id)?.name ?? id

  // students a teacher may report on: those in their classes. Staff/admin may report on anyone.
  const reportableStudents = useMemo(() => {
    if (!user) return []
    if (user.role === 'teacher') {
      const classIds = new Set(classesTaughtBy(user.id).map(c => c.id))
      const ids = new Set(enrollments.filter(e => classIds.has(e.classId) && e.status === 'active').map(e => e.studentId))
      return db.users.filter(u => u.role === 'student' && ids.has(u.id))
    }
    return db.users.filter(u => u.role === 'student')
  }, [user, db.users, classesTaughtBy, enrollments])

  const classOfStudent = (studentId: string) => enrollments.find(e => e.studentId === studentId && e.status === 'active')?.classId

  const [createOpen, setCreateOpen] = useState(false)
  const [formStudent, setFormStudent] = useState('')
  const [formTitle, setFormTitle] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formWitnesses, setFormWitnesses] = useState('')
  const [formHearingDate, setFormHearingDate] = useState('')
  const [formFiles, setFormFiles] = useState<UploadedFile[]>([])
  const [creating, setCreating] = useState(false)

  const resetForm = () => { setFormStudent(''); setFormTitle(''); setFormDescription(''); setFormWitnesses(''); setFormHearingDate(''); setFormFiles([]) }
  const createCase = async () => {
    if (!formStudent || !formTitle.trim() || !formDescription.trim()) return
    setCreating(true)
    try {
      await api.post('/discipline', {
        studentId: formStudent, classId: classOfStudent(formStudent), title: formTitle.trim(), description: formDescription.trim(),
        witnesses: formWitnesses.trim() || undefined, hearingDate: formHearingDate || undefined, fileIds: formFiles.map(f => f.id),
      })
      setCreateOpen(false); resetForm(); reload()
      toast.success('Disciplinary case reported')
    } catch (e) { toast.error(errorMessage(e)) } finally { setCreating(false) }
  }

  const deleteCase = async (c: DisciplinaryCaseRec) => {
    try { await api.del(`/discipline/${c.id}`); reload(); toast.success('Case archived') }
    catch (e) { toast.error(errorMessage(e)) }
  }

  const [detailOpen, setDetailOpen] = useState<DisciplinaryCaseRec | null>(null)
  // Server scopes the list already (reporters/staff/admin: theirs or all; parent/student: own) — no client re-filtering.
  const visibleCases = sorted

  return (
    <div>
      <PageHead title="Disciplinary Committee" sub="Report, hear and track disciplinary actions">
        <div className="flex flex-wrap items-center gap-2">
          {canDelete && (
            <button onClick={() => setShowArchived(v => !v)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold transition ${showArchived ? 'bg-black text-white' : 'bg-black/[.06] dark:bg-white/[.08] hover:bg-black/10 dark:hover:bg-white/15'}`}>
              <Archive size={13} /> {showArchived ? 'Showing archived' : 'Show archived'}
            </button>
          )}
          {canManage && (
            <button onClick={() => setCreateOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
              <Plus size={15} /> Report case
            </button>
          )}
        </div>
      </PageHead>

      <div className="space-y-4">
        {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading cases…</p>}
        {error && <Empty text={error} />}
        {!loading && !error && visibleCases.length === 0 && <Empty text={canManage ? 'No cases on record.' : 'No cases linked to your profile.'} />}
        {visibleCases.map(c => (
          <Card key={c.id} className={`card-lift ${c.deletedAt ? 'opacity-60' : ''}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={disciplinaryTone(c.status)}>{c.status}</Pill>
                  {c.actionTaken && <Pill tone="amber">{c.actionTaken}</Pill>}
                  {c.deletedAt && <Pill tone="slate"><Archive size={10} /> Archived</Pill>}
                  {!canManage && <Pill tone="slate"><Lock size={10} /> read-only</Pill>}
                </div>
                <p className="font-display mt-3 text-[17px] font-medium">{c.title}</p>
                <p className="mt-1 text-[13px] text-black/55 dark:text-white/55">{c.studentName ?? nameOf(c.studentId)} · reported by {c.reportedByName ?? nameOf(c.reportedById)} on {fmtDate(c.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                {c.hearingDate && (
                  <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-black/45 dark:text-white/45">
                    <Gavel size={12} /> Hearing: {fmtDate(c.hearingDate, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => setDetailOpen(c)}
                  className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                  {canManage ? 'Review case' : 'View case'}
                </button>
                {canDelete && !c.deletedAt && (
                  <button onClick={() => deleteCase(c)} title="Archive case"
                    className="rounded-full bg-rose-50 dark:bg-rose-500/10 p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
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
              {reportableStudents.map(s => <option key={s.id} value={s.id}>{s.name}{classOf(s.id) ? ` · ${classOf(s.id)!.label}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Title"><input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="e.g. Lab equipment misuse" className={inputCls} /></Field>
          <Field label="Description"><textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={3} placeholder="What happened, where, when…" className={inputCls} /></Field>
          <Field label="Witnesses"><input value={formWitnesses} onChange={e => setFormWitnesses(e.target.value)} placeholder="Names of witnesses (optional)" className={inputCls} /></Field>
          <Field label="Hearing date"><input type="date" value={formHearingDate} onChange={e => setFormHearingDate(e.target.value)} className={inputCls} /></Field>
          <UploadField files={formFiles} onChange={setFormFiles} multiple accept=".pdf,.png,.jpg,.jpeg" label="Attach evidence" hint="PDF, PNG or JPG" />
          <button onClick={createCase} disabled={!formStudent || !formTitle.trim() || !formDescription.trim() || creating}
            className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{creating ? 'Reporting…' : 'Report case'}</button>
        </div>
      </Modal>

      {/* Case detail / timeline */}
      <CaseDetailModal caseRec={detailOpen} canManage={canManage} nameOf={nameOf} onClose={() => setDetailOpen(null)} onChanged={reload} />
    </div>
  )
}

/* ── case detail: description, evidence, status timeline ─ */

function CaseDetailModal({ caseRec, canManage, nameOf, onClose, onChanged }: {
  caseRec: DisciplinaryCaseRec | null
  canManage: boolean
  nameOf: (id: string) => string
  onClose: () => void
  onChanged: () => void
}) {
  const { items: fetchedNotes, loading: notesLoading, reload: reloadNotes } = useDisciplinaryNotes(caseRec?.id, !!caseRec)
  // The server doesn't expose GET /discipline/:id/notes yet (see phase-8-welfare.md) — every note/status-change
  // POST still returns the created note, so we keep those locally (across every case opened this session) and
  // merge in only the ones for the case currently open.
  const [localNotes, setLocalNotes] = useState<import('@/lib/data').DisciplinaryNote[]>([])
  const sortedNotes = useMemo(() => {
    const byId = new Map((fetchedNotes ?? []).map(n => [n.id, n]))
    localNotes.filter(n => n.caseId === caseRec?.id).forEach(n => byId.set(n.id, n))
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [fetchedNotes, localNotes, caseRec?.id])

  const [action, setAction] = useState<DisciplinaryActionRec | ''>('')
  const [noteBody, setNoteBody] = useState('')
  const [busy, setBusy] = useState(false)

  if (!caseRec) return null
  const next = nextDisciplinaryStatus(caseRec.status)

  const advance = async (status: DisciplinaryCaseStatus) => {
    setBusy(true)
    try {
      await api.post(`/discipline/${caseRec.id}/status`, { status, note: noteBody.trim() || undefined, actionTaken: action || undefined })
      if (noteBody.trim()) {
        setLocalNotes(prev => [...prev, { id: 'local_' + Date.now(), caseId: caseRec.id, authorId: '', body: `→ ${status}: ${noteBody.trim()}`, createdAt: new Date().toISOString() }])
      }
      setNoteBody(''); setAction('')
      reloadNotes(); onChanged()
      toast.success(`Case moved to ${status}`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const addNote = async () => {
    if (!noteBody.trim() || !caseRec) return
    setBusy(true)
    try {
      const res = await api.post<{ item?: import('@/lib/data').DisciplinaryNote }>(`/discipline/${caseRec.id}/notes`, { body: noteBody.trim() })
      if (res?.item) setLocalNotes(prev => [...prev, res.item as import('@/lib/data').DisciplinaryNote])
      setNoteBody('')
      reloadNotes()
      toast.success('Note added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={!!caseRec} onClose={onClose} title={caseRec.title} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={disciplinaryTone(caseRec.status)}>{caseRec.status}</Pill>
          {caseRec.actionTaken && <Pill tone="amber">{caseRec.actionTaken}</Pill>}
        </div>

        <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4">
          <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Description</p>
          <p className="mt-1 text-[14px] leading-relaxed text-black/80 dark:text-white/80">{caseRec.description}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Student</p>
            <p className="text-[14px] font-medium">{caseRec.studentName ?? nameOf(caseRec.studentId)}</p>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Reported by</p>
            <p className="text-[14px] font-medium">{caseRec.reportedByName ?? nameOf(caseRec.reportedById)} · {fmtDate(caseRec.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          </div>
          {caseRec.witnesses && (
            <div className="sm:col-span-2">
              <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Witnesses</p>
              <p className="text-[14px]">{caseRec.witnesses}</p>
            </div>
          )}
          {caseRec.fileIds.length > 0 && (
            <div className="sm:col-span-2">
              <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Evidence</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {caseRec.fileIds.map((id, i) => (
                  <button key={id} onClick={() => downloadFile(id, `evidence-${i + 1}`).catch(e => toast.error(errorMessage(e)))}
                    className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                    <FileText size={13} /> File {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* status timeline */}
        <div>
          <p className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Timeline</p>
          {notesLoading && <p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p>}
          <div className="max-h-64 space-y-2.5 overflow-y-auto thin-scroll">
            {!notesLoading && sortedNotes.length === 0 && <p className="text-[13px] text-black/40 dark:text-white/40">No notes yet.</p>}
            {sortedNotes.map(n => (
              <div key={n.id} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] px-3.5 py-2.5">
                <p className="text-[13px] leading-relaxed text-black/80 dark:text-white/80">{n.body}</p>
                <p className="mt-1 text-[11.5px] text-black/40 dark:text-white/40">{n.authorName ?? (n.authorId ? nameOf(n.authorId) : 'You')} · {fmtDate(n.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            ))}
          </div>
        </div>

        {canManage && !caseRec.deletedAt && (
          <div className="space-y-3 rounded-2xl border border-black/[.08] dark:border-white/[.10] p-4">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Committee actions</p>
            <Field label="Note"><textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} rows={2} placeholder="Add a note (attached to the next action, or standalone)" className={inputCls} /></Field>
            {(caseRec.status === 'Decision' || caseRec.status === 'Action Taken') && (
              <Field label="Action taken">
                <select value={action} onChange={e => setAction(e.target.value as DisciplinaryActionRec | '')} className={inputCls}>
                  <option value="">Select action</option>
                  {DISCIPLINARY_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              {next && (
                <button onClick={() => advance(next)} disabled={busy} className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                  Advance to {next} <ChevronRight size={14} />
                </button>
              )}
              <button onClick={addNote} disabled={busy || !noteBody.trim()} className="flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-2 text-[13px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">
                <MessageSquarePlus size={14} /> Add note only
              </button>
              {caseRec.status !== 'Closed' && (
                <button onClick={() => advance('Closed')} disabled={busy} className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
                  <Check size={14} /> Close case
                </button>
              )}
            </div>
          </div>
        )}

        {!canManage && (
          <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4 text-[13px] text-black/50 dark:text-white/50">
            <ShieldAlert size={16} className="mb-2" /> You can view this case because it involves your profile. Only the disciplinary committee can update it.
          </div>
        )}
      </div>
    </Modal>
  )
}
