import { useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Check, CloudUpload, FileText, IdCard, Pencil, Plus, Share2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, downloadFile, downloadPath, errorMessage, uploadFile } from '@/lib/api'
import { isAdmin } from '@/lib/access'
import { useEntity } from '@/lib/hooks/useEntity'
import type { EmploymentChangeType, PerformanceReviewRec, QualificationProficiency, StaffConductCategory, StaffConductRecord, StaffConductStatus, TeacherQualification, User } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { useEmployees } from '@/lib/hooks/useFinance'
import {
  RATING_LABEL, STAFF_CONDUCT_CATEGORIES, reviewTone, staffConductTone, useEmployeeDocuments, useEmploymentHistory, useReviews, useStaffConduct,
} from '@/lib/hooks/useEmployee'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, UploadField, inputCls, type UploadedFile } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'
import { RatingStars } from '../components/RatingStars'

// Phase 11 — Employee management: reporting line (My Team), performance reviews (My Reviews / Team Reviews),
// employment history timeline, staff conduct (admin/superadmin only) and employee documents/ID card.
// The employment-history section and documents section are also used from office.tsx's PeopleMod (employee
// detail view) and profile.tsx (self). See .agents/edunova/phase-11-employee-management.md

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
const primaryBtn = 'flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40'

/* ── shared: reports-to picker (used by office.tsx's PeopleMod form, A2) ─ */

/** A lightweight searchable dropdown (native `<datalist>`) over employee-role users, excluding `excludeId` (self). */
export function SearchableUserPicker({ label, employees, value, onChange, excludeId, placeholder = 'None' }: {
  label: string
  employees: User[]
  value: string
  onChange: (id: string) => void
  excludeId?: string
  placeholder?: string
}) {
  const listId = useId()
  const options = useMemo(() => employees.filter(e => e.id !== excludeId), [employees, excludeId])
  const selected = options.find(e => e.id === value)
  const [text, setText] = useState(selected?.name ?? '')
  // Resync the visible text when `value` changes from outside (opening a different person, switching role
  // in the create form) — a render-time adjustment instead of an effect, per React's "you might not need an
  // effect" guidance, so it can't cause an extra render pass.
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    setText(selected?.name ?? '')
  }
  return (
    <Field label={label}>
      <input
        list={listId}
        value={text}
        onChange={e => {
          const v = e.target.value
          setText(v)
          const match = options.find(o => o.name.toLowerCase() === v.trim().toLowerCase())
          onChange(match ? match.id : '')
        }}
        placeholder={placeholder}
        className={inputCls}
      />
      <datalist id={listId}>
        {options.map(o => <option key={o.id} value={o.name} />)}
      </datalist>
    </Field>
  )
}

/* ── employment history timeline (A4) ──────────────────── */

const CHANGE_LABEL: Record<EmploymentChangeType, string> = {
  Role: 'Role', Designation: 'Designation', Department: 'Department', Salary: 'Salary',
  ClassTeacherAssignment: 'Class teacher assignment', Other: 'Other',
}

/** Read-only, newest-first. Used on the People & Roles employee detail view and on one's own Profile. */
export function EmploymentHistoryTimeline({ userId }: { userId: string }) {
  const { db } = useStore()
  const { items, loading, error } = useEmploymentHistory(userId)
  const nameOf = (id: string) => db.users.find(u => u.id === id)?.name ?? id
  const sorted = useMemo(
    () => [...(items ?? [])].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.createdAt.localeCompare(a.createdAt)),
    [items],
  )
  if (loading) return <p className="text-[13px] text-black/40 dark:text-white/40">Loading history…</p>
  if (error) return <p className="text-[13px] text-rose-500">{error}</p>
  if (sorted.length === 0) return <Empty text="No employment history recorded yet." />
  return (
    <div className="max-h-96 space-y-2.5 overflow-y-auto thin-scroll">
      {sorted.map(h => (
        <div key={h.id} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="indigo">{CHANGE_LABEL[h.changeType]}</Pill>
            <span className="text-[12px] text-black/40 dark:text-white/40">{fmtDate(h.effectiveDate, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
          <p className="mt-1.5 text-[13.5px]">
            {h.fromValue ? <>{h.fromValue} <span className="text-black/30 dark:text-white/30">→</span> <b>{h.toValue}</b></> : <b>{h.toValue}</b>}
          </p>
          {h.note && <p className="mt-1 text-[12.5px] text-black/50 dark:text-white/50">{h.note}</p>}
          <p className="mt-1 text-[11.5px] text-black/40 dark:text-white/40">by {h.changedByName ?? nameOf(h.changedById)}</p>
        </div>
      ))}
    </div>
  )
}

/* ── employee documents (A6, HR/admin only) ────────────── */

export function EmployeeDocumentsSection({ userId }: { userId: string }) {
  const docs = useEmployeeDocuments(userId)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const rec = await uploadFile(file)
      await api.post(`/users/${userId}/documents`, { fileId: rec.id, label: label.trim() || rec.name })
      setLabel('')
      docs.reload()
      toast.success('Document added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const remove = async (docId: string) => {
    try { await api.del(`/users/${userId}/documents/${docId}`); docs.reload(); toast.success('Document removed') }
    catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (e.g. ID proof, Degree certificate)" className={`${inputCls} min-w-[180px] flex-1`} />
        <label className={`flex cursor-pointer items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-4 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          <CloudUpload size={14} /> {busy ? 'Uploading…' : 'Upload'}
          <input type="file" className="hidden" disabled={busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} />
        </label>
      </div>
      {docs.loading && <p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p>}
      {!docs.loading && (docs.items ?? []).length === 0 && <Empty text="No documents on file." />}
      <div className="space-y-1.5">
        {(docs.items ?? []).map(d => (
          <div key={d.id} className="flex items-center gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] px-4 py-2.5">
            <FileText size={15} className="shrink-0 text-black/40 dark:text-white/40" />
            <button onClick={() => downloadFile(d.fileId, d.label).catch(e => toast.error(errorMessage(e)))} className="min-w-0 flex-1 truncate text-left text-[13.5px] font-medium hover:underline">{d.label}</button>
            <span className="shrink-0 text-[11.5px] text-black/40 dark:text-white/40">{fmtDate(d.uploadedAt, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <button onClick={() => remove(d.id)} className="shrink-0 rounded-full p-1.5 text-black/35 hover:bg-rose-50 hover:text-rose-500 dark:text-white/35" title="Delete document"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Teacher qualifications (Phase T1 §3) — reachable from the teacher's People/profile screen ───────── */
// Declared subject + grade-range + proficiency, superseding nothing (ClassSubject.teacherId's informal
// signal keeps working) — this is what T4/T5's Constraint Builder will read. See
// .agents/edunova/phase-t1-timetable-foundations.md §3.

const PROFICIENCIES: { value: QualificationProficiency; label: string }[] = [
  { value: 'PRIMARY', label: 'Primary' },
  { value: 'SECONDARY', label: 'Secondary' },
]

interface QualificationForm { subjectId: string; gradeMin: string; gradeMax: string; proficiency: QualificationProficiency; isPrimarySubject: boolean }
const emptyQualificationForm = (): QualificationForm => ({ subjectId: '', gradeMin: '', gradeMax: '', proficiency: 'PRIMARY', isPrimarySubject: false })

export function TeacherQualificationsSection({ teacherId }: { teacherId: string }) {
  const { subjects, grades } = useAcademic()
  const qualifications = useEntity('teacherQualifications')
  const sortedGrades = useMemo(() => [...grades].sort((a, b) => a.order - b.order), [grades])
  const gradeByOrder = useMemo(() => new Map(sortedGrades.map(g => [g.order, g.label])), [sortedGrades])
  const subjectById = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects])
  const mine = useMemo(
    () => qualifications.items.filter(q => q.teacherId === teacherId)
      .sort((a, b) => (subjectById.get(a.subjectId)?.name ?? '').localeCompare(subjectById.get(b.subjectId)?.name ?? '')),
    [qualifications.items, teacherId, subjectById],
  )

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TeacherQualification | null>(null)
  const [form, setForm] = useState<QualificationForm>(emptyQualificationForm)
  const openAdd = () => {
    setEditing(null)
    setForm({ ...emptyQualificationForm(), subjectId: subjects[0]?.id ?? '', gradeMin: String(sortedGrades[0]?.order ?? 1), gradeMax: String(sortedGrades[sortedGrades.length - 1]?.order ?? 1) })
    setFormOpen(true)
  }
  const openEdit = (q: TeacherQualification) => {
    setEditing(q)
    setForm({ subjectId: q.subjectId, gradeMin: String(q.gradeRangeMin), gradeMax: String(q.gradeRangeMax), proficiency: q.proficiency, isPrimarySubject: q.isPrimarySubject })
    setFormOpen(true)
  }
  const save = async () => {
    const body = { subjectId: form.subjectId, gradeRangeMin: Number(form.gradeMin), gradeRangeMax: Number(form.gradeMax), proficiency: form.proficiency, isPrimarySubject: form.isPrimarySubject }
    const out = editing
      ? await qualifications.update(editing.id, body, 'Qualification updated')
      : await qualifications.create({ ...body, teacherId }, 'Qualification added')
    if (out) setFormOpen(false)
  }
  const [del, setDel] = useState<TeacherQualification | null>(null)
  const formValid = !!form.subjectId && form.gradeMin !== '' && form.gradeMax !== '' && Number(form.gradeMin) <= Number(form.gradeMax)

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px] text-black/50 dark:text-white/50">Subjects and grade ranges this teacher is qualified to be scheduled for.</p>
        <button onClick={openAdd} disabled={subjects.length === 0} className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">
          <Plus size={13} /> Add qualification
        </button>
      </div>
      {mine.length === 0 ? (
        <Empty text="No qualifications on file yet." />
      ) : (
        <div className="space-y-1.5">
          {mine.map(q => (
            <div key={q.id} className="flex items-center gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13.5px] font-semibold">{subjectById.get(q.subjectId)?.name ?? 'Unknown subject'}</p>
                  <Pill tone={q.proficiency === 'PRIMARY' ? 'indigo' : 'slate'}>{q.proficiency === 'PRIMARY' ? 'Primary' : 'Secondary'}</Pill>
                  {q.isPrimarySubject && <Pill tone="green">Primary subject</Pill>}
                </div>
                <p className="text-[12px] text-black/45 dark:text-white/45">Grades {gradeByOrder.get(q.gradeRangeMin) ?? q.gradeRangeMin} – {gradeByOrder.get(q.gradeRangeMax) ?? q.gradeRangeMax}</p>
              </div>
              <button onClick={() => openEdit(q)} className="shrink-0 rounded-full p-1.5 text-black/35 hover:bg-black/10 hover:text-black dark:text-white/35 dark:hover:bg-white/15 dark:hover:text-white" aria-label="Edit"><Pencil size={13} /></button>
              <button onClick={() => setDel(q)} className="shrink-0 rounded-full p-1.5 text-black/35 hover:bg-rose-50 hover:text-rose-500 dark:text-white/35" aria-label="Delete"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit qualification' : 'New qualification'}>
        <div className="space-y-4">
          <Field label="Subject">
            <select value={form.subjectId} onChange={e => setForm({ ...form, subjectId: e.target.value })} className={inputCls} disabled={!!editing}>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From grade">
              <select value={form.gradeMin} onChange={e => setForm({ ...form, gradeMin: e.target.value })} className={inputCls}>
                {sortedGrades.map(g => <option key={g.id} value={g.order}>{g.label}</option>)}
              </select>
            </Field>
            <Field label="To grade">
              <select value={form.gradeMax} onChange={e => setForm({ ...form, gradeMax: e.target.value })} className={inputCls}>
                {sortedGrades.map(g => <option key={g.id} value={g.order}>{g.label}</option>)}
              </select>
            </Field>
          </div>
          {Number(form.gradeMin) > Number(form.gradeMax) && <p className="text-[12.5px] text-rose-500">"From grade" must not be after "To grade".</p>}
          <Field label="Proficiency">
            <select value={form.proficiency} onChange={e => setForm({ ...form, proficiency: e.target.value as QualificationProficiency })} className={inputCls}>
              {PROFICIENCIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <label className="flex items-center gap-2.5 text-[13.5px] font-medium">
            <input type="checkbox" checked={form.isPrimarySubject} onChange={e => setForm({ ...form, isPrimarySubject: e.target.checked })} />
            This is one of the teacher's primary subjects
          </label>
          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={!formValid || qualifications.busy} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{editing ? 'Save changes' : 'Add qualification'}</button>
            <button onClick={() => setFormOpen(false)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!del} onClose={() => setDel(null)} title="Delete qualification?">
        <div className="space-y-4">
          <p className="text-[14px] text-black/60 dark:text-white/60">This removes the teacher's qualification for {del ? (subjectById.get(del.subjectId)?.name ?? 'this subject') : ''}.</p>
          <div className="flex gap-3">
            <button onClick={async () => { if (del && await qualifications.remove(del.id, 'Qualification removed')) setDel(null) }} disabled={qualifications.busy} className="btn-ink flex-1 py-3 text-[14px] font-semibold bg-rose-600 hover:bg-rose-700 disabled:opacity-40">Delete</button>
            <button onClick={() => setDel(null)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ── ID card download (A6) ─────────────────────────────── */

export function IdCardButton({ userId, label = 'Download ID card' }: { userId: string; label?: string }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try { await downloadPath(`/users/${userId}/id-card.pdf`, `ID-card-${userId}.pdf`) }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <button onClick={run} disabled={busy} className={ghostBtn}>
      <IdCard size={14} /> {busy ? 'Preparing…' : label}
    </button>
  )
}

/* ── My Team (A2) ───────────────────────────────────────── */
// The employee detail view (People & Roles detail, and My Team) used to be `EmployeeDetailModal` here — a
// modal with its own internal tab state (Overview/History/Documents). Converted to a real routed page,
// `/portal/employees/:id` (src/pages/portal/EmployeeDetail.tsx) — see .agents/edunova/ui-architecture-fix.md.

export function MyTeamMod() {
  const { user, db } = useStore()
  const navigate = useNavigate()
  const reports = useMemo(() => (user ? db.users.filter(u => u.reportsTo === user.id).sort(byName) : []), [db.users, user])
  const managerName = user?.reportsTo ? (db.users.find(u => u.id === user.reportsTo)?.name ?? user.reportsTo) : undefined

  return (
    <div>
      <PageHead title="My Team" sub={managerName ? `You report to ${managerName}` : 'Everyone who reports directly to you'} />
      {reports.length === 0 ? <Empty text="No one reports to you yet." /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {reports.map(r => (
            <Card key={r.id} className="flex items-center gap-3">
              <Avatar name={r.name} hue={r.avatarHue} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.name}</p>
                <p className="truncate text-[12.5px] text-black/50 dark:text-white/50">{r.designation || r.title}{r.department ? ` · ${r.department}` : ''}</p>
              </div>
              <button onClick={() => navigate(`/portal/employees/${r.id}`)} className="shrink-0 rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">View profile</button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Performance reviews (A3) ───────────────────────────── */

/** Self, any reviewable employee role. Past reviews read-only once Acknowledged; while Shared, the employee
 * can add/edit their own comments before acknowledging (which locks the review from further edits). */
export function MyReviewsMod() {
  const { user } = useStore()
  const navigate = useNavigate()
  const { items, loading, error } = useReviews(user?.id, !!user)
  const list = useMemo(() => [...(items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [items])

  return (
    <div>
      <PageHead title="My Reviews" sub="Your performance reviews — add your comments once a review is shared with you" />
      <div className="space-y-3">
        {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
        {error && <Empty text={error} />}
        {!loading && !error && list.length === 0 && <Empty text="No reviews yet." />}
        {list.map(r => (
          <Card key={r.id} className="card-lift flex flex-wrap items-center gap-4">
            <div className="min-w-48 flex-1">
              <p className="text-[14.5px] font-semibold">{r.cycle}</p>
              <p className="text-[12.5px] text-black/50 dark:text-white/50">{fmtDate(r.periodStart)} → {fmtDate(r.periodEnd)}</p>
            </div>
            <RatingStars value={r.overallRating} />
            <Pill tone={reviewTone(r.status)}>{r.status}</Pill>
            <button onClick={() => navigate(`/portal/reviews/${r.id}`)} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">View</button>
          </Card>
        ))}
      </div>
    </div>
  )
}

/** Exported: also used by `/portal/reviews/new` (src/pages/portal/ReviewNew.tsx). */
export function ReviewForm({ employees, wholeSchool, onDone }: { employees: User[]; wholeSchool?: boolean; onDone: () => void }) {
  const [f, setF] = useState({ employeeId: wholeSchool ? '' : (employees[0]?.id ?? ''), cycle: '', periodStart: '', periodEnd: '', overallRating: 3, strengths: '', areasForImprovement: '', goals: '' })
  const [busy, setBusy] = useState(false)
  const valid = !!f.employeeId && !!f.cycle.trim() && !!f.periodStart && !!f.periodEnd && !!f.strengths.trim() && !!f.areasForImprovement.trim() && !!f.goals.trim()
  const submit = async () => {
    if (!valid) return
    setBusy(true)
    try {
      await api.post('/reviews', {
        employeeId: f.employeeId, cycle: f.cycle.trim(), periodStart: f.periodStart, periodEnd: f.periodEnd,
        overallRating: f.overallRating, strengths: f.strengths.trim(), areasForImprovement: f.areasForImprovement.trim(), goals: f.goals.trim(),
      })
      toast.success('Review created as draft')
      onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee">
          {wholeSchool ? (
            <AsyncEntityPicker role={['teacher', 'staff', 'admin', 'superadmin']} value={f.employeeId}
              onChange={id => setF(x => ({ ...x, employeeId: id }))} placeholder="Search employees…" />
          ) : (
            <select value={f.employeeId} onChange={e => setF(x => ({ ...x, employeeId: e.target.value }))} className={inputCls}>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Cycle"><input value={f.cycle} onChange={e => setF(x => ({ ...x, cycle: e.target.value }))} placeholder="e.g. 2026 Annual" className={inputCls} /></Field>
        <Field label="Period start"><input type="date" value={f.periodStart} onChange={e => setF(x => ({ ...x, periodStart: e.target.value }))} className={inputCls} /></Field>
        <Field label="Period end"><input type="date" value={f.periodEnd} onChange={e => setF(x => ({ ...x, periodEnd: e.target.value }))} className={inputCls} /></Field>
        <Field label="Overall rating">
          <select value={f.overallRating} onChange={e => setF(x => ({ ...x, overallRating: Number(e.target.value) }))} className={inputCls}>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} — {RATING_LABEL[n]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Strengths"><textarea value={f.strengths} onChange={e => setF(x => ({ ...x, strengths: e.target.value }))} rows={2} className={inputCls} /></Field>
      <Field label="Areas for improvement"><textarea value={f.areasForImprovement} onChange={e => setF(x => ({ ...x, areasForImprovement: e.target.value }))} rows={2} className={inputCls} /></Field>
      <Field label="Goals"><textarea value={f.goals} onChange={e => setF(x => ({ ...x, goals: e.target.value }))} rows={2} className={inputCls} /></Field>
      <button onClick={submit} disabled={!valid || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Creating…' : 'Create draft'}</button>
    </div>
  )
}

/** Exported: also used by `/portal/reviews/:id` (src/pages/portal/ReviewDetail.tsx) for the manager/HR
 * (non-self) view — editable while the review is Draft, read-only once Shared/Acknowledged. */
export function ReviewDetail({ review, readOnly, onSaved }: { review: PerformanceReviewRec; readOnly: boolean; onSaved: () => void }) {
  const [f, setF] = useState({
    cycle: review.cycle, periodStart: review.periodStart, periodEnd: review.periodEnd, overallRating: review.overallRating,
    strengths: review.strengths, areasForImprovement: review.areasForImprovement, goals: review.goals,
  })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api.patch(`/reviews/${review.id}`, {
        cycle: f.cycle.trim(), periodStart: f.periodStart, periodEnd: f.periodEnd, overallRating: f.overallRating,
        strengths: f.strengths.trim(), areasForImprovement: f.areasForImprovement.trim(), goals: f.goals.trim(),
      })
      toast.success('Review updated')
      onSaved()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  if (readOnly) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={reviewTone(review.status)}>{review.status}</Pill>
          <RatingStars value={review.overallRating} />
        </div>
        {([['Strengths', review.strengths], ['Areas for improvement', review.areasForImprovement], ['Goals', review.goals]] as const).map(([label, val]) => (
          <div key={label}>
            <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">{label}</p>
            <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-black/80 dark:text-white/80">{val}</p>
          </div>
        ))}
        <div>
          <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Employee comments</p>
          <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-black/80 dark:text-white/80">
            {review.employeeComments || (review.status === 'Shared' ? 'No comments yet.' : 'Not shared yet.')}
          </p>
        </div>
        {review.acknowledgedAt && <p className="text-[12px] text-emerald-600">Acknowledged {fmtDate(review.acknowledgedAt)}</p>}
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cycle"><input value={f.cycle} onChange={e => setF(x => ({ ...x, cycle: e.target.value }))} className={inputCls} /></Field>
        <Field label="Overall rating">
          <select value={f.overallRating} onChange={e => setF(x => ({ ...x, overallRating: Number(e.target.value) }))} className={inputCls}>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} — {RATING_LABEL[n]}</option>)}
          </select>
        </Field>
        <Field label="Period start"><input type="date" value={f.periodStart} onChange={e => setF(x => ({ ...x, periodStart: e.target.value }))} className={inputCls} /></Field>
        <Field label="Period end"><input type="date" value={f.periodEnd} onChange={e => setF(x => ({ ...x, periodEnd: e.target.value }))} className={inputCls} /></Field>
      </div>
      <Field label="Strengths"><textarea value={f.strengths} onChange={e => setF(x => ({ ...x, strengths: e.target.value }))} rows={2} className={inputCls} /></Field>
      <Field label="Areas for improvement"><textarea value={f.areasForImprovement} onChange={e => setF(x => ({ ...x, areasForImprovement: e.target.value }))} rows={2} className={inputCls} /></Field>
      <Field label="Goals"><textarea value={f.goals} onChange={e => setF(x => ({ ...x, goals: e.target.value }))} rows={2} className={inputCls} /></Field>
      <button onClick={save} disabled={busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save changes'}</button>
    </div>
  )
}

/** Manager (direct reports) / HR-admin (anyone) — create, edit-while-Draft, Share, view acknowledgement status. */
export function TeamReviewsMod() {
  const { user } = useStore()
  const navigate = useNavigate()
  const employees = useEmployees()
  const hr = isAdmin(user)
  const manageable = useMemo(() => (hr ? employees.filter(e => e.id !== user?.id) : employees.filter(e => e.reportsTo === user?.id)), [employees, hr, user])
  const [employeeFilter, setEmployeeFilter] = useState('')
  const { items, loading, error, reload } = useReviews(employeeFilter || undefined, !!user)
  const list = useMemo(() => [...(items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [items])
  const nameOf = (id: string, fallback?: string) => fallback ?? employees.find(e => e.id === id)?.name ?? id

  const [busy, setBusy] = useState<string | null>(null)

  const share = async (r: PerformanceReviewRec) => {
    setBusy(r.id)
    try { await api.post(`/reviews/${r.id}/share`); reload(); toast.success('Review shared with the employee') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div>
      <PageHead title="Team Reviews" sub={hr ? 'Create and manage performance reviews for anyone' : 'Create and manage performance reviews for your direct reports'}>
        <button onClick={() => navigate('/portal/reviews/new')} disabled={manageable.length === 0} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40"><Plus size={15} /> New review</button>
      </PageHead>

      {manageable.length === 0 && (
        <div className="mb-5"><Empty text={hr ? 'No other employees yet.' : 'No one reports to you yet — reviews can only be created for direct reports.'} /></div>
      )}

      {manageable.length > 0 && (
        <div className="mb-4 max-w-xs">
          {hr ? (
            <AsyncEntityPicker role={['teacher', 'staff', 'admin', 'superadmin']} value={employeeFilter}
              onChange={id => setEmployeeFilter(id)} placeholder="All employees" />
          ) : (
            <select value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">All direct reports</option>
              {manageable.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
        </div>
      )}

      <div className="space-y-3">
        {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
        {error && <Empty text={error} />}
        {!loading && !error && list.length === 0 && <Empty text="No reviews yet." />}
        {list.map(r => (
          <Card key={r.id} className="card-lift flex flex-wrap items-center gap-4">
            <div className="min-w-48 flex-1">
              <p className="text-[14.5px] font-semibold">{r.employeeName ?? nameOf(r.employeeId)} · {r.cycle}</p>
              <p className="text-[12.5px] text-black/50 dark:text-white/50">{fmtDate(r.periodStart)} → {fmtDate(r.periodEnd)} · rating {r.overallRating}/5</p>
            </div>
            <Pill tone={reviewTone(r.status)}>{r.status}</Pill>
            {r.status === 'Draft' ? (
              <>
                <button onClick={() => navigate(`/portal/reviews/${r.id}`)} disabled={busy === r.id} className={ghostBtn}><Pencil size={12} /> Edit</button>
                <button onClick={() => share(r)} disabled={busy === r.id} className={primaryBtn}><Share2 size={12} /> Share</button>
              </>
            ) : (
              <button onClick={() => navigate(`/portal/reviews/${r.id}`)} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-3.5 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">View</button>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

/* ── Staff conduct (A5 — admin/superadmin only) ─────────── */

export function StaffConductMod() {
  const { user } = useStore()
  const employees = useEmployees()
  const [employeeFilter, setEmployeeFilter] = useState('')
  const { items, loading, error, reload } = useStaffConduct(employeeFilter || undefined, !!user)
  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [items])
  const nameOf = (id: string, fallback?: string) => fallback ?? employees.find(e => e.id === id)?.name ?? id

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ employeeId: '', title: '', description: '', category: 'Conduct' as StaffConductCategory })
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [busy, setBusy] = useState(false)

  const openCreate = () => { setForm({ employeeId: '', title: '', description: '', category: 'Conduct' }); setFiles([]); setCreateOpen(true) }
  const create = async () => {
    if (!form.employeeId || !form.title.trim() || !form.description.trim()) return
    setBusy(true)
    try {
      await api.post('/staff-conduct', { employeeId: form.employeeId, title: form.title.trim(), description: form.description.trim(), category: form.category, fileIds: files.map(f => f.id) })
      setCreateOpen(false); reload(); toast.success('Record filed')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const [detail, setDetail] = useState<StaffConductRecord | null>(null)
  const [actionTaken, setActionTaken] = useState('')
  const openDetail = (r: StaffConductRecord) => { setDetail(r); setActionTaken(r.actionTaken ?? '') }
  const setStatus = async (status: StaffConductStatus) => {
    if (!detail) return
    setBusy(true)
    try {
      await api.patch(`/staff-conduct/${detail.id}`, { status, actionTaken: actionTaken.trim() || undefined })
      setDetail(null); reload(); toast.success(status === 'Resolved' ? 'Marked resolved' : 'Status updated')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHead title="Staff Conduct" sub="Conduct, performance and policy records — visible to HR/admin only, never to the employee or their manager">
        <button onClick={openCreate} disabled={employees.length === 0} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40"><Plus size={15} /> New record</button>
      </PageHead>

      {employees.length > 0 && (
        <div className="mb-4 max-w-xs">
          <AsyncEntityPicker role={['teacher', 'staff', 'admin', 'superadmin']} value={employeeFilter}
            onChange={id => setEmployeeFilter(id)} placeholder="All employees" />
        </div>
      )}

      <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
        {loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>}
        {error && <div className="p-6 text-center text-[13px] text-rose-500">{error}</div>}
        {!loading && !error && sorted.length === 0 && <div className="p-6"><Empty text="No records on file." /></div>}
        {sorted.map(r => (
          <div key={r.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
            <Pill tone="slate">{r.category}</Pill>
            <div className="min-w-52 flex-1">
              <p className="text-[14.5px] font-semibold">{r.title}</p>
              <p className="text-[12.5px] text-black/45 dark:text-white/45">{r.employeeName ?? nameOf(r.employeeId)} · reported by {r.reportedByName ?? nameOf(r.reportedById)} · {fmtDate(r.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
            </div>
            <Pill tone={staffConductTone(r.status)}>{r.status}</Pill>
            <button onClick={() => openDetail(r)} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">View</button>
          </div>
        ))}
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New staff conduct record">
        <div className="space-y-4">
          <Field label="Employee">
            <AsyncEntityPicker role={['teacher', 'staff', 'admin', 'superadmin']} value={form.employeeId}
              onChange={id => setForm(f => ({ ...f, employeeId: id }))} placeholder="Search employees…" />
          </Field>
          <Field label="Category">
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as StaffConductCategory }))} className={inputCls}>
              {STAFF_CONDUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Title"><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls} /></Field>
          <Field label="Description"><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} className={inputCls} /></Field>
          <UploadField files={files} onChange={setFiles} multiple accept=".pdf,.png,.jpg,.jpeg" label="Attach evidence (optional)" />
          <button onClick={create} disabled={!form.employeeId || !form.title.trim() || !form.description.trim() || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Filing…' : 'File record'}</button>
        </div>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? ''} wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="slate">{detail.category}</Pill>
              <Pill tone={staffConductTone(detail.status)}>{detail.status}</Pill>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-black/60 dark:text-white/60">Description</p>
              <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-black/80 dark:text-white/80">{detail.description}</p>
            </div>
            <p className="text-[12.5px] text-black/45 dark:text-white/45">{detail.employeeName ?? nameOf(detail.employeeId)} · reported by {detail.reportedByName ?? nameOf(detail.reportedById)} on {fmtDate(detail.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
            {detail.fileIds.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {detail.fileIds.map((id, i) => (
                  <button key={id} onClick={() => downloadFile(id, `evidence-${i + 1}`).catch(e => toast.error(errorMessage(e)))} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15"><FileText size={13} /> File {i + 1}</button>
                ))}
              </div>
            )}
            {detail.status !== 'Resolved' && (
              <div className="space-y-3 rounded-2xl border border-black/[.08] dark:border-white/[.10] p-4">
                <Field label="Action taken"><textarea value={actionTaken} onChange={e => setActionTaken(e.target.value)} rows={2} className={inputCls} /></Field>
                <div className="flex flex-wrap gap-2">
                  {detail.status === 'Reported' && <button onClick={() => setStatus('UnderReview')} disabled={busy} className="rounded-full bg-sky-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-sky-700 disabled:opacity-40">Mark under review</button>}
                  <button onClick={() => setStatus('Resolved')} disabled={busy} className="btn-ink flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold disabled:opacity-40"><Check size={14} /> Resolve</button>
                </div>
              </div>
            )}
            {detail.status === 'Resolved' && detail.actionTaken && <p className="text-[13.5px]"><b>Action taken:</b> {detail.actionTaken}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}
