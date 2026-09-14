import { useMemo, useState } from 'react'
import { Award, Check, CheckCircle2, GraduationCap, Pencil, Plus, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { isAdmin } from '@/lib/access'
import type { Scholarship, ScholarshipAward, ScholarshipDiscountType, ScholarshipType } from '@/lib/data'
import {
  AWARD_STATUSES, DISCOUNT_TYPES, SCHOLARSHIP_TYPES, awardStatusTone, discountLabel, scholarshipTypeLabel,
  useScholarshipAwards, useScholarships,
} from '@/lib/hooks/useScholarships'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'

// Phase 21 item 4 — formal scholarship program. Staff/admin/superadmin propose an award (Pending); only
// admin/superadmin may approve/reject. Approving actually discounts the student's fee invoices for the
// academic year server-side (server/src/modules/scholarships/service.ts#approveAward) — this screen just
// surfaces `totalDiscountApplied`/`appliedToInvoiceIds` once that happens. The scholarship *catalog*
// (create/edit/deactivate) is admin/superadmin only; staff may only browse it to pick one when proposing.
// See .agents/edunova/phase-21-financial-intelligence.md item 4.

const rowCls = 'flex flex-wrap items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0'
const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
const primaryBtn = 'flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40'
const dangerBtn = 'flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-2 text-[13px] font-semibold text-rose-500 hover:bg-rose-100 disabled:opacity-40'

function SegTabs<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (t: T) => void }) {
  return (
    <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${value === o.id ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Name / class helpers over the users + academic slices — same shape as finance.tsx's local (unexported) useStudentLookup. */
function useStudentLookup() {
  const { db } = useStore()
  const { classOf } = useAcademic()
  return useMemo(() => {
    const byId = new Map(db.users.map(u => [u.id, u]))
    return {
      students: db.users.filter(u => u.role === 'student').sort((a, b) => a.name.localeCompare(b.name)),
      nameOf: (id: string) => byId.get(id)?.name ?? 'Student',
      classLabel: (id: string) => classOf(id)?.label ?? '—',
    }
  }, [db.users, classOf])
}

/* ── Scholarships (catalog) ────────────────────────────── */

interface SchForm { name: string; type: ScholarshipType; discountType: ScholarshipDiscountType; discountValue: string; criteria: string; active: boolean }
const emptySchForm = (): SchForm => ({ name: '', type: 'MeritBased', discountType: 'Percentage', discountValue: '', criteria: '', active: true })

function ScholarshipFormModal({ open, editing, onClose, onSaved }: { open: boolean; editing: Scholarship | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<SchForm>(emptySchForm())
  const [busy, setBusy] = useState(false)
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setForm(editing
      ? { name: editing.name, type: editing.type, discountType: editing.discountType, discountValue: String(editing.discountValue), criteria: editing.criteria ?? '', active: editing.active }
      : emptySchForm())
  } else if (!open && wasOpen) setWasOpen(false)

  const valid = form.name.trim() && Number(form.discountValue) > 0 && (form.discountType !== 'Percentage' || Number(form.discountValue) <= 100)

  const save = async () => {
    setBusy(true)
    try {
      if (editing) {
        await api.patch(`/scholarships/${editing.id}`, { name: form.name.trim(), criteria: form.criteria.trim() || null, active: form.active })
      } else {
        await api.post('/scholarships', {
          name: form.name.trim(), type: form.type, discountType: form.discountType,
          discountValue: Number(form.discountValue), criteria: form.criteria.trim() || undefined, active: form.active,
        })
      }
      onSaved(); toast.success(editing ? 'Scholarship updated' : 'Scholarship added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${editing.name}` : 'New scholarship'}>
      <div className="space-y-4">
        <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Merit Scholarship — Toppers" className={inputCls} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          {editing ? (
            <>
              <div><span className="text-[13px] font-semibold text-black/60 dark:text-white/60">Type</span><p className="mt-1.5 rounded-xl bg-black/[.04] dark:bg-white/[.06] px-4 py-2.5 text-[14.5px]">{scholarshipTypeLabel(editing.type)}</p></div>
              <div><span className="text-[13px] font-semibold text-black/60 dark:text-white/60">Discount</span><p className="mt-1.5 rounded-xl bg-black/[.04] dark:bg-white/[.06] px-4 py-2.5 text-[14.5px]">{discountLabel(editing)}</p></div>
            </>
          ) : (
            <>
              <Field label="Type">
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as ScholarshipType })} className={inputCls}>
                  {SCHOLARSHIP_TYPES.map(t => <option key={t} value={t}>{scholarshipTypeLabel(t)}</option>)}
                </select>
              </Field>
              <Field label="Discount type">
                <select value={form.discountType} onChange={e => setForm({ ...form, discountType: e.target.value as ScholarshipDiscountType })} className={inputCls}>
                  {DISCOUNT_TYPES.map(t => <option key={t} value={t}>{t === 'Percentage' ? 'Percentage' : 'Fixed amount'}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>
        {!editing && (
          <Field label={form.discountType === 'Percentage' ? 'Discount (%)' : 'Discount (₹)'}>
            <input type="number" min={0} max={form.discountType === 'Percentage' ? 100 : undefined} value={form.discountValue}
              onChange={e => setForm({ ...form, discountValue: e.target.value })} className={inputCls} />
          </Field>
        )}
        <Field label="Criteria (optional)"><textarea value={form.criteria} onChange={e => setForm({ ...form, criteria: e.target.value })} rows={2} placeholder="Free text — eligibility notes for staff proposing an award" className={`${inputCls} resize-none`} /></Field>
        {editing && (
          <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Active (proposable)</label>
        )}
        <div className="flex gap-3 pt-2">
          <button onClick={save} disabled={!valid || busy} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{editing ? 'Save changes' : 'Add scholarship'}</button>
          <button onClick={onClose} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
        </div>
      </div>
    </Modal>
  )
}

function ScholarshipsTab({ canEdit }: { canEdit: boolean }) {
  const scholarships = useScholarships()
  const [editing, setEditing] = useState<Scholarship | null | 'new'>(null)

  return (
    <div>
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <button onClick={() => setEditing('new')} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> New scholarship</button>
        </div>
      )}
      {scholarships.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading scholarships…</p>}
      {scholarships.error && <Empty text={scholarships.error} />}
      {!scholarships.loading && !scholarships.error && (scholarships.items ?? []).length === 0 && (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><Award size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No scholarships yet</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">{canEdit ? 'Define a scholarship — merit, need-based, sibling discount and more.' : 'Ask an admin to define a scholarship.'}</p>
        </Card>
      )}
      <Card className="p-0">
        {(scholarships.items ?? []).map(s => (
          <div key={s.id} className={rowCls}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><Award size={17} /></span>
            <div className="min-w-48 flex-1">
              <p className="text-[14.5px] font-semibold">{s.name}</p>
              <p className={muted}>{scholarshipTypeLabel(s.type)} · {discountLabel(s)}{s.criteria ? ` · ${s.criteria}` : ''}</p>
            </div>
            {!s.active && <Pill tone="slate">Inactive</Pill>}
            {canEdit && <button onClick={() => setEditing(s)} className={ghostBtn}><Pencil size={12} /> Edit</button>}
          </div>
        ))}
      </Card>
      {canEdit && (
        <ScholarshipFormModal open={editing !== null} editing={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); scholarships.reload() }} />
      )}
    </div>
  )
}

/* ── Awards (propose → approve) ───────────────────────── */

function ProposeAwardModal({ open, scholarships, onClose, onCreated }: { open: boolean; scholarships: Scholarship[]; onClose: () => void; onCreated: () => void }) {
  const { years, currentYear } = useAcademic()
  const [scholarshipId, setScholarshipId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [academicYearId, setAcademicYearId] = useState('')
  const [busy, setBusy] = useState(false)
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setScholarshipId(scholarships[0]?.id ?? ''); setStudentId(''); setAcademicYearId(currentYear?.id ?? years[0]?.id ?? '')
  } else if (!open && wasOpen) setWasOpen(false)

  const propose = async () => {
    if (!scholarshipId || !studentId || !academicYearId) return
    setBusy(true)
    try {
      await api.post('/scholarships/awards', { scholarshipId, studentId, academicYearId })
      toast.success('Award proposed — pending approval'); onCreated(); onClose()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Propose scholarship award">
      <div className="space-y-4">
        <Field label="Scholarship">
          <select value={scholarshipId} onChange={e => setScholarshipId(e.target.value)} className={inputCls}>
            {scholarships.length === 0 && <option value="">No active scholarships</option>}
            {scholarships.map(s => <option key={s.id} value={s.id}>{s.name} · {discountLabel(s)}</option>)}
          </select>
        </Field>
        <Field label="Student">
          <AsyncEntityPicker role="student" value={studentId} onChange={id => setStudentId(id)} placeholder="Search student…" />
        </Field>
        <Field label="Academic year">
          <select value={academicYearId} onChange={e => setAcademicYearId(e.target.value)} className={inputCls}>
            {years.map(y => <option key={y.id} value={y.id}>{y.label}</option>)}
          </select>
        </Field>
        <button onClick={propose} disabled={busy || !scholarshipId || !studentId || !academicYearId} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
          {busy ? 'Proposing…' : 'Propose award'}
        </button>
        <p className="text-center text-[12px] text-black/40 dark:text-white/40">An admin/superadmin must approve before the discount applies to any invoice.</p>
      </div>
    </Modal>
  )
}

function AwardsTab({ canApprove }: { canApprove: boolean }) {
  const { years } = useAcademic()
  const { nameOf, classLabel } = useStudentLookup()
  const scholarships = useScholarships({ active: true })
  const scholarshipById = useMemo(() => new Map((scholarships.items ?? []).map(s => [s.id, s])), [scholarships.items])
  const yearById = useMemo(() => new Map(years.map(y => [y.id, y])), [years])
  const [status, setStatus] = useState<'' | typeof AWARD_STATUSES[number]>('')
  const awards = useScholarshipAwards({ status: status || undefined })
  const sorted = useMemo(() => [...(awards.items ?? [])].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')), [awards.items])
  const [proposeOpen, setProposeOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<ScholarshipAward | null>(null)
  const [reason, setReason] = useState('')

  const approve = async (a: ScholarshipAward) => {
    setBusy(a.id)
    try {
      await api.post(`/scholarships/awards/${a.id}/approve`, {})
      awards.reload(); toast.success(`Approved — discount applied to ${nameOf(a.studentId)}'s invoices`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const reject = async () => {
    if (!rejecting) return
    setBusy(rejecting.id)
    try {
      await api.post(`/scholarships/awards/${rejecting.id}/reject`, { reason: reason.trim() || undefined })
      setRejecting(null); setReason(''); awards.reload(); toast.success('Award rejected')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Field label="Status">
          <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className={`${inputCls} w-auto min-w-[160px]`}>
            <option value="">All statuses</option>
            {AWARD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <span className="flex-1" />
        <button onClick={() => setProposeOpen(true)} disabled={(scholarships.items ?? []).length === 0} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40"><Plus size={15} /> Propose award</button>
      </div>

      {awards.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading awards…</p>}
      {awards.error && <Empty text={awards.error} />}
      {!awards.loading && !awards.error && sorted.length === 0 && (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><GraduationCap size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No awards yet</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">Propose an award against an active scholarship for a student.</p>
        </Card>
      )}

      <Card className="p-0">
        {sorted.map(a => {
          const sch = scholarshipById.get(a.scholarshipId)
          return (
            <div key={a.id} className={rowCls}>
              <Avatar name={nameOf(a.studentId)} size={38} />
              <div className="min-w-48 flex-1">
                <p className="text-[14.5px] font-semibold">{nameOf(a.studentId)} <span className="font-normal text-black/40 dark:text-white/40">· {classLabel(a.studentId)}</span></p>
                <p className={muted}>{sch ? `${sch.name} · ${discountLabel(sch)}` : a.scholarshipId} · {yearById.get(a.academicYearId)?.label ?? a.academicYearId}</p>
                {a.status === 'Approved' && a.totalDiscountApplied > 0 && <p className="mt-0.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">₹{a.totalDiscountApplied.toLocaleString('en-IN')} applied across {a.appliedToInvoiceIds.length} invoice{a.appliedToInvoiceIds.length === 1 ? '' : 's'}</p>}
                {a.status === 'Rejected' && a.reason && <p className="mt-0.5 text-[12px] text-rose-500">{a.reason}</p>}
              </div>
              <Pill tone={awardStatusTone(a.status)}>{a.status}</Pill>
              {canApprove && a.status === 'Pending' && (
                <div className="flex gap-2">
                  <button onClick={() => approve(a)} disabled={busy === a.id} className={primaryBtn}><Check size={13} /> Approve</button>
                  <button onClick={() => { setRejecting(a); setReason('') }} disabled={busy === a.id} className={dangerBtn}><X size={13} /> Reject</button>
                </div>
              )}
              {a.status === 'Approved' && <CheckCircle2 size={16} className="text-emerald-500" />}
              {a.status === 'Rejected' && <XCircle size={16} className="text-rose-400" />}
            </div>
          )
        })}
      </Card>

      <ProposeAwardModal open={proposeOpen} scholarships={scholarships.items ?? []} onClose={() => setProposeOpen(false)} onCreated={() => awards.reload()} />

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={rejecting ? `Reject ${nameOf(rejecting.studentId)}'s award?` : 'Reject award'}>
        {rejecting && (
          <div className="space-y-4">
            <Field label="Reason (optional)"><textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className={`${inputCls} resize-none`} placeholder="Shown to whoever proposed this award" /></Field>
            <button onClick={reject} disabled={busy === rejecting.id} className="btn-ink w-full bg-rose-600 py-3 text-[14px] font-semibold hover:bg-rose-700 disabled:opacity-40">Reject award</button>
          </div>
        )}
      </Modal>
      {!canApprove && <p className="mt-3 text-center text-[12.5px] text-black/40 dark:text-white/40">Only an admin or superadmin can approve/reject a proposed award.</p>}
    </div>
  )
}

/* ── module ────────────────────────────────────────────── */

export function ScholarshipsMod() {
  const { user } = useStore()
  const canApprove = isAdmin(user)
  const [tab, setTab] = useState<'awards' | 'catalog'>('awards')
  return (
    <div>
      <PageHead title="Scholarships" sub={tab === 'awards' ? 'Propose and track scholarship awards for students' : 'The scholarship programs staff can propose an award against'}>
        <SegTabs value={tab} onChange={setTab} options={[{ id: 'awards', label: 'Awards' }, { id: 'catalog', label: 'Scholarships' }]} />
      </PageHead>
      {tab === 'awards' && <AwardsTab canApprove={canApprove} />}
      {tab === 'catalog' && <ScholarshipsTab canEdit={canApprove} />}
    </div>
  )
}
