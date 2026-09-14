import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, Briefcase, Check, ClipboardList, Download, FileBadge, FileText, Pencil, Plus, ScrollText, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, downloadPath, errorMessage } from '@/lib/api'
import type { ContractRec, Duty, LeaveRequest, LeaveRequestStatus, LeaveType, ResignationRec, SubstitutionRequest } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { isoDate, useFetch, type TeacherTimetable } from '@/lib/hooks/useTimetable'
import { useEmployees } from '@/lib/hooks/useFinance'
import {
  LEAVE_APPLIES_TO, LEAVE_STATUSES, MIN_NOTICE_DAYS, contractRecTone, countLeaveDays, leaveStatusLabel, leaveTone, leaveTypeName,
  noticeShortfallDays, useContracts, useDuties, useLeaveBalance, useLeaveRequests, useLeaveTypes, useResignations,
} from '@/lib/hooks/useHr'
import { invigilationTone, useInvigilationDuties } from '@/lib/hooks/useExams'
import { noticeHours, periodsInRange, useSubstitutionActions, useSubstitutionPolicy, useSubstitutionRequests } from '@/lib/hooks/useSubstitution'
import { SubstituteFinderModal, SubstitutionInboxCard, SubstitutionStatusList } from './substitutionFinder'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls, statusTone } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'

// Phase 6 HR screens: leave types (admin), my leave (teacher/staff), leave approvals (teacher over students,
// staff/admin over staff), my contract + resignation (employee), contracts & resignations (admin), duties.
// See .agents/edunova/phase-6-hr.md

/* ── shared bits (mirrors finance.tsx / office.tsx conventions) ── */

const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
const dangerBtn = 'flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-2 text-[13px] font-semibold text-rose-500 hover:bg-rose-100 disabled:opacity-40'
const primaryBtn = 'flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40'
const loadingRow = (text: string) => <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">{text}</div>
const sectionHead = 'border-b border-black/[.06] dark:border-white/[.08] px-6 py-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const rowCls = 'flex flex-wrap items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0'

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

/* ── Admin: Leave Types ─────────────────────────────────── */

export function LeaveTypesMod() {
  const types = useLeaveTypes()
  const [name, setName] = useState('')
  const [days, setDays] = useState('12')
  const [appliesTo, setAppliesTo] = useState<'staff' | 'student'>('staff')
  const [editing, setEditing] = useState<LeaveType | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const add = async () => {
    if (!name.trim()) return
    setBusy('add')
    try {
      await api.post('/leave/types', { name: name.trim(), daysPerYear: Math.max(0, Number(days) || 0), appliesTo })
      setName(''); setDays('12'); types.reload(); toast.success(`Leave type "${name.trim()}" added`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const save = async () => {
    if (!editing || !editing.name.trim()) return
    setBusy(editing.id)
    try {
      await api.patch(`/leave/types/${editing.id}`, { name: editing.name.trim(), daysPerYear: editing.daysPerYear, appliesTo: editing.appliesTo })
      setEditing(null); types.reload(); toast.success('Leave type updated')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const remove = async (t: LeaveType) => {
    if (!confirm(`Delete leave type "${t.name}"?`)) return
    setBusy(t.id)
    try { await api.del(`/leave/types/${t.id}`); types.reload(); toast.success('Leave type deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div>
      <PageHead title="Leave Types" sub="Casual, sick and student leave policies — days per year, per audience" />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">New leave type</p>
          <div className="space-y-4">
            <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Casual, Sick, Student leave" className={inputCls} onKeyDown={e => e.key === 'Enter' && add()} /></Field>
            <Field label="Days per year"><input type="number" min={0} value={days} onChange={e => setDays(e.target.value)} className={inputCls} /></Field>
            <Field label="Applies to">
              <select value={appliesTo} onChange={e => setAppliesTo(e.target.value as 'staff' | 'student')} className={inputCls}>
                <option value="staff">Staff & teachers</option>
                <option value="student">Students</option>
              </select>
            </Field>
            <p className="text-[12px] text-black/40 dark:text-white/40">0 days/year means unlimited (e.g. student leave).</p>
            <button onClick={add} disabled={!name.trim() || busy === 'add'} className="btn-ink flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40"><Plus size={15} /> Add leave type</button>
          </div>
        </Card>
        <Card className="p-0">
          <p className={sectionHead}>Leave types</p>
          {types.loading ? loadingRow('Loading leave types…')
            : types.error ? <div className="p-6"><Empty text={types.error} /></div>
            : (types.items ?? []).length === 0 ? <div className="p-6"><Empty text="No leave types yet — add Casual to get started." /></div>
            : (types.items ?? []).map(t => (
              <div key={t.id} className={rowCls}>
                {editing?.id === t.id ? (
                  <>
                    <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className={`${inputCls} min-w-32 flex-1 py-2`} autoFocus onKeyDown={e => e.key === 'Enter' && save()} />
                    <input type="number" min={0} value={editing.daysPerYear} onChange={e => setEditing({ ...editing, daysPerYear: Math.max(0, Number(e.target.value) || 0) })} className={`${inputCls} w-24 py-2`} aria-label="Days per year" />
                    <select value={editing.appliesTo} onChange={e => setEditing({ ...editing, appliesTo: e.target.value as 'staff' | 'student' })} className={`${inputCls} w-36 py-2`} aria-label="Applies to">
                      {LEAVE_APPLIES_TO.map(a => <option key={a} value={a}>{a === 'staff' ? 'Staff' : 'Students'}</option>)}
                    </select>
                    <button onClick={save} disabled={busy === t.id} className={primaryBtn}><Check size={13} /> Save</button>
                    <button onClick={() => setEditing(null)} className={ghostBtn}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-[14.5px] font-medium">{t.name}</span>
                    <Pill tone={t.appliesTo === 'staff' ? 'indigo' : 'sky'}>{t.appliesTo === 'staff' ? 'Staff' : 'Students'}</Pill>
                    <span className="text-[13px] text-black/50 dark:text-white/50">{t.daysPerYear > 0 ? `${t.daysPerYear} days/yr` : 'Unlimited'}</span>
                    <button onClick={() => setEditing(t)} className={ghostBtn}><Pencil size={12} /> Edit</button>
                    <button onClick={() => remove(t)} disabled={busy === t.id} className={dangerBtn}><Trash2 size={12} /></button>
                  </>
                )}
              </div>
            ))}
        </Card>
      </div>
    </div>
  )
}

/* ── Teacher/staff: My Leave ────────────────────────────── */

export function MyLeaveMod() {
  const { user } = useStore()
  const { currentTerm } = useAcademic()
  const types = useLeaveTypes(!!user)
  const year = new Date().getFullYear()
  const balance = useLeaveBalance(user?.id, year, !!user)
  const requests = useLeaveRequests({ forUserId: user?.id, scope: 'mine' }, !!user)
  const list = useMemo(() => [...(requests.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [requests.items])
  const staffTypes = useMemo(() => (types.items ?? []).filter(t => t.appliesTo === 'staff'), [types.items])

  // Phase T9 — the create-leave flow itself is UNCHANGED (critical regression requirement): a
  // SubstitutionRequest always needs a real leaveRequestId (see substitution.ts#createSubstitutionRequest),
  // so "find a substitute" only becomes available on a row AFTER the leave is submitted, not inside this
  // create form. Incoming accept/decline inbox (this user as a proposed substitute) sits above the list.
  const isTeacher = user?.role === 'teacher'
  const inbox = useSubstitutionRequests({ substituteTeacherId: user?.id, status: 'SENT' }, !!user)
  const inboxActions = useSubstitutionActions(() => inbox.reload())
  const [inboxBusyId, setInboxBusyId] = useState<string | null>(null)
  const acceptInbound = async (r: SubstitutionRequest) => { setInboxBusyId(r.id); await inboxActions.accept(r.id); setInboxBusyId(null) }
  const declineInbound = async (r: SubstitutionRequest) => { setInboxBusyId(r.id); await inboxActions.decline(r.id); setInboxBusyId(null) }

  const policy = useSubstitutionPolicy()
  const myTimetable = useFetch<TeacherTimetable>(isTeacher && user && currentTerm ? `/timetable/teacher/${encodeURIComponent(user.id)}?termId=${encodeURIComponent(currentTerm.id)}` : null)
  const coversTeachingPeriods = (r: LeaveRequest) => isTeacher && periodsInRange(myTimetable.data?.entries ?? [], r.fromDate, r.toDate).length > 0

  const [open, setOpen] = useState(false)
  const [leaveTypeId, setLeaveTypeId] = useState('')
  const [from, setFrom] = useState(() => isoDate(new Date()))
  const [to, setTo] = useState(() => isoDate(new Date()))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [finderFor, setFinderFor] = useState<LeaveRequest | null>(null)
  const days = countLeaveDays(from, to)

  const openModal = () => { setLeaveTypeId(staffTypes[0]?.id ?? ''); setFrom(isoDate(new Date())); setTo(isoDate(new Date())); setReason(''); setOpen(true) }
  const submit = async () => {
    if (!user) return
    setBusy('submit')
    try {
      await api.post('/leave/requests', { forUserId: user.id, leaveTypeId: leaveTypeId || undefined, fromDate: from, toDate: to, reason: reason.trim() })
      setOpen(false); requests.reload(); balance.reload()
      toast.success('Leave request submitted')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const cancel = async (r: LeaveRequest) => {
    setBusy(r.id)
    try { await api.post(`/leave/requests/${r.id}/cancel`); requests.reload(); balance.reload(); toast.success('Request cancelled') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div>
      <PageHead title="My Leave" sub="Apply for leave and track its status">
        <button onClick={openModal} disabled={staffTypes.length === 0} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40"><Plus size={15} /> New request</button>
      </PageHead>

      <SubstitutionInboxCard items={inbox.items ?? []} busyId={inboxBusyId} onAccept={acceptInbound} onDecline={declineInbound} />

      {types.items !== undefined && staffTypes.length === 0 && (
        <div className="mb-5"><Empty text="No leave types set up yet — ask an admin to add Casual / Sick leave under Leave Types." /></div>
      )}

      {staffTypes.length > 0 && (
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          {(balance.items ?? []).map(b => (
            <Card key={b.leaveTypeId}>
              <p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">{leaveTypeName(types.items, b.leaveTypeId, b.name)}</p>
              <p className="font-display mt-2 text-2xl font-medium">{b.remaining}<span className="text-[14px] font-normal text-black/40 dark:text-white/40"> / {b.allowed} left</span></p>
              <p className="mt-1 text-[12.5px] text-black/45 dark:text-white/45">{b.used} used this year</p>
            </Card>
          ))}
          {(balance.items ?? []).length === 0 && !balance.loading && <div className="sm:col-span-3"><Empty text="No balance data yet." /></div>}
        </div>
      )}

      <Card className="p-0">
        {requests.loading ? loadingRow('Loading requests…')
          : requests.error ? <div className="p-6"><Empty text={requests.error} /></div>
          : list.length === 0 ? <div className="p-6"><Empty text="No leave requests yet." /></div>
          : list.map(r => {
            const covers = coversTeachingPeriods(r)
            const canArrange = covers && (r.status === 'Pending' || r.status === 'PENDING_SUBSTITUTION') && policy.item?.mode !== 'ADMIN_ASSIGNED'
            return (
              <div key={r.id} className={rowCls}>
                <div className="min-w-40 flex-1">
                  <p className="text-[14.5px] font-semibold">{leaveTypeName(types.items, r.leaveTypeId, r.leaveTypeName)} · {r.days} day{r.days === 1 ? '' : 's'}</p>
                  <p className="text-[12.5px] text-black/45 dark:text-white/45">{fmtDate(r.fromDate)} → {fmtDate(r.toDate)} · {r.reason}</p>
                  {r.decisionNote && <p className="mt-1 text-[12px] text-black/50 dark:text-white/50">Note: {r.decisionNote}</p>}
                  {covers && <MyLeaveSubstitutionStatus leaveRequestId={r.id} />}
                </div>
                <Pill tone={leaveTone(r.status)}>{leaveStatusLabel(r.status)}</Pill>
                {canArrange && (
                  <button onClick={() => setFinderFor(r)} className="flex items-center gap-1 rounded-full border border-indigo-300 px-3.5 py-1.5 text-[12.5px] font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
                    <Users size={12} /> Find a substitute
                  </button>
                )}
                {r.status === 'Pending' && <button onClick={() => cancel(r)} disabled={busy === r.id} className={ghostBtn}>Cancel</button>}
              </div>
            )
          })}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Request leave">
        <div className="space-y-4">
          <Field label="Leave type">
            <select value={leaveTypeId} onChange={e => setLeaveTypeId(e.target.value)} className={inputCls}>
              {staffTypes.map(t => <option key={t.id} value={t.id}>{t.name}{t.daysPerYear > 0 ? ` (${t.daysPerYear}/yr)` : ''}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} /></Field>
            <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} /></Field>
          </div>
          <p className="text-[12.5px] text-black/45 dark:text-white/45">{days} day{days === 1 ? '' : 's'} (Sundays excluded)</p>
          <Field label="Reason"><textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className={inputCls} /></Field>
          {isTeacher && periodsInRange(myTimetable.data?.entries ?? [], from, to).length > 0 && (
            <p className="flex items-center gap-1.5 text-[12px] text-indigo-700 dark:text-indigo-300">
              <Users size={12} /> This covers teaching periods — once submitted, use "Find a substitute" on the request to arrange cover{noticeHours(from) < (policy.item?.minNoticeHoursForSubstitution ?? 12) ? ' (though less than the minimum notice means this goes to admin as an emergency assignment)' : ''}.
            </p>
          )}
          <button onClick={submit} disabled={busy === 'submit' || !reason.trim() || days === 0} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy === 'submit' ? 'Submitting…' : 'Submit request'}</button>
        </div>
      </Modal>

      {finderFor && (
        <SubstituteFinderModal
          open={!!finderFor}
          onClose={() => setFinderFor(null)}
          leaveRequestId={finderFor.id}
          originalTeacherName={user?.name}
          policyMode={policy.item?.mode ?? 'TEACHER_INITIATED'}
          onSent={() => requests.reload()}
        />
      )}
    </div>
  )
}

/** Fetches one leave request's attached substitution requests for the compact status line under each row —
 * a separate component (not inline in the list `.map`) since it needs its own hook call. */
function MyLeaveSubstitutionStatus({ leaveRequestId }: { leaveRequestId: string }) {
  const { items } = useSubstitutionRequests({ leaveRequestId }, true)
  if (!items || items.length === 0) return null
  return <SubstitutionStatusList requests={items} />
}

/* ── Approver: Leave Approvals (teacher over students, staff/admin over staff) ── */

export function LeaveApprovalsMod() {
  const { user, db } = useStore()
  const navigate = useNavigate()
  const types = useLeaveTypes(!!user)
  const policy = useSubstitutionPolicy()
  const [status, setStatus] = useState<LeaveRequestStatus | ''>('Pending')
  const requests = useLeaveRequests({ scope: 'approvals', status }, !!user)
  const list = useMemo(() => [...(requests.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [requests.items])
  const nameOf = (id: string, fallback?: string) => fallback ?? db.users.find(u => u.id === id)?.name ?? id
  // Mirrors server assertCanDecide(): student leave → any staff/admin/superadmin; non-student
  // (staff/teacher) leave → admin/superadmin only. Staff otherwise sees an Approve button that 403s.
  const canDecide = (r: LeaveRequest) => {
    const forUserRole = db.users.find(u => u.id === r.forUserId)?.role
    if (forUserRole === 'student') return true
    return user?.role === 'admin' || user?.role === 'superadmin'
  }
  // Phase T9 — no cheap per-row "does this actually cover a teaching period" signal exists without fetching
  // every requester's own timetable (serializeLeaveRequest carries no such field — see data.ts's T9 doc
  // comment), so this link shows whenever forUser is a teacher and lets the dedicated review page (which
  // does resolve the real periods) render "no teaching periods overlap this leave" if it turns out to be a
  // plain non-teaching absence for that teacher.
  const isTeacherLeave = (r: LeaveRequest) => db.users.find(u => u.id === r.forUserId)?.role === 'teacher'
  const emergencyRisk = (r: LeaveRequest) => !!policy.item && noticeHours(r.fromDate) < policy.item.minNoticeHoursForSubstitution
  const [decline, setDecline] = useState<LeaveRequest | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const approve = async (r: LeaveRequest) => {
    setBusy(r.id)
    try { await api.post(`/leave/requests/${r.id}/approve`); requests.reload(); toast.success('Leave approved') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const submitDecline = async () => {
    if (!decline) return
    setBusy(decline.id)
    try {
      await api.post(`/leave/requests/${decline.id}/decline`, { note: note.trim() || undefined })
      setDecline(null); setNote(''); requests.reload(); toast.success('Leave declined')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div>
      <PageHead title="Leave Approvals" sub="Requests you can decide — student leave for your classes, staff leave for the school">
        <select value={status} onChange={e => setStatus(e.target.value as LeaveRequestStatus | '')} className={`${inputCls} w-auto`}>
          <option value="">All statuses</option>
          {LEAVE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </PageHead>
      <Card className="p-0">
        {requests.loading ? loadingRow('Loading requests…')
          : requests.error ? <div className="p-6"><Empty text={requests.error} /></div>
          : list.length === 0 ? <div className="p-6"><Empty text="No requests here." /></div>
          : list.map(r => (
            <div key={r.id} className={rowCls}>
              <div className="min-w-48 flex-1">
                <p className="text-[14.5px] font-semibold">{nameOf(r.forUserId, r.forUserName)} · {leaveTypeName(types.items, r.leaveTypeId, r.leaveTypeName)}</p>
                <p className="text-[12.5px] text-black/45 dark:text-white/45">{fmtDate(r.fromDate)} → {fmtDate(r.toDate)} · {r.days} day{r.days === 1 ? '' : 's'} · {r.reason}</p>
                {r.requesterId !== r.forUserId && <p className="text-[12px] text-black/40 dark:text-white/40">Requested by {nameOf(r.requesterId, r.requesterName)}</p>}
              </div>
              {isTeacherLeave(r) && emergencyRisk(r) && (r.status === 'Pending' || r.status === 'PENDING_SUBSTITUTION') && <Pill tone="rose">emergency</Pill>}
              <Pill tone={leaveTone(r.status)}>{leaveStatusLabel(r.status)}</Pill>
              {isTeacherLeave(r) && canDecide(r) && (
                <button onClick={() => navigate(`/portal/timetable/substitutions/${r.id}`)}
                  className="flex items-center gap-1 rounded-full border border-indigo-300 px-3.5 py-1.5 text-[12.5px] font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
                  Manage substitution <ArrowRight size={12} />
                </button>
              )}
              {r.status === 'Pending' && canDecide(r) && (
                <div className="flex gap-2">
                  <button onClick={() => approve(r)} disabled={busy === r.id} className="rounded-full bg-emerald-600 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">Approve</button>
                  <button onClick={() => { setDecline(r); setNote('') }} disabled={busy === r.id} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Decline</button>
                </div>
              )}
            </div>
          ))}
      </Card>
      <Modal open={!!decline} onClose={() => setDecline(null)} title="Decline leave request">
        <div className="space-y-4">
          <Field label="Note (optional)"><textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Let them know why…" className={inputCls} /></Field>
          <button onClick={submitDecline} disabled={busy === decline?.id} className="w-full rounded-xl bg-rose-600 py-3 text-[14px] font-semibold text-white hover:bg-rose-700 disabled:opacity-40">Decline</button>
        </div>
      </Modal>
    </div>
  )
}

/* ── Employee: My Contract + resignation ───────────────── */

export function MyContractMod() {
  const { user } = useStore()
  const contracts = useContracts({ userId: user?.id }, !!user)
  const contract = useMemo(() => {
    const items = contracts.items ?? []
    return items.find(c => c.status === 'Active') ?? items.find(c => c.status === 'Draft') ?? items[0]
  }, [contracts.items])
  const resignations = useResignations(!!user)
  const myResignation = useMemo(() => (resignations.items ?? []).find(r => r.status === 'Pending'), [resignations.items])

  const [signing, setSigning] = useState(false)
  const sign = async () => {
    if (!contract) return
    setSigning(true)
    try { await api.post(`/hr/contracts/${contract.id}/sign`); contracts.reload(); toast.success('Contract signed') }
    catch (e) { toast.error(errorMessage(e)) } finally { setSigning(false) }
  }
  const download = () => {
    if (!contract) return
    downloadPath(`/hr/contracts/${contract.id}.pdf`, `Contract-${(user?.name ?? 'employee').replace(/\W+/g, '_')}.pdf`).catch(e => toast.error(errorMessage(e)))
  }

  const [resignOpen, setResignOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [lastDay, setLastDay] = useState(() => isoDate(new Date(Date.now() + MIN_NOTICE_DAYS * 86400000)))
  const [busy, setBusy] = useState(false)
  const shortfall = noticeShortfallDays(lastDay)
  const openResign = () => { setReason(''); setLastDay(isoDate(new Date(Date.now() + MIN_NOTICE_DAYS * 86400000))); setResignOpen(true) }
  const submitResign = async () => {
    setBusy(true)
    try {
      await api.post('/hr/resignations', { reason: reason.trim(), lastWorkingDate: lastDay })
      setResignOpen(false); resignations.reload(); toast.success('Resignation submitted')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const withdraw = async () => {
    if (!myResignation) return
    setBusy(true)
    try { await api.post(`/hr/resignations/${myResignation.id}/withdraw`); resignations.reload(); toast.success('Resignation withdrawn') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHead title="My Contract" sub="Employment terms, signature and exit" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><ScrollText size={15} /> Current contract</p>
          {contracts.loading ? loadingRow('Loading…')
            : !contract ? <Empty text="No contract on file. Contact the admin office." />
            : (
              <div>
                {[
                  ['Designation', contract.designation],
                  ['Department', contract.department || '—'],
                  ['Tenure', `${fmtDate(contract.startDate)} → ${contract.endDate ? fmtDate(contract.endDate) : 'open'}`],
                  ['Status', contract.status],
                  ['You signed', contract.employeeSignedAt ? fmtDate(contract.employeeSignedAt) : 'Not yet'],
                  ['Admin signed', contract.adminSignedAt ? fmtDate(contract.adminSignedAt) : 'Not yet'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-black/[.05] dark:border-white/[.07] py-3 text-[14px] last:border-0">
                    <span className="text-black/50 dark:text-white/50">{k}</span><span className="font-semibold">{v}</span>
                  </div>
                ))}
                <div className="mt-4 flex items-start gap-2 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
                  <FileText size={16} className="mt-0.5 shrink-0 text-black/40 dark:text-white/40" />
                  <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-black/60 dark:text-white/60">{contract.terms}</p>
                </div>
                <div className="mt-4 flex gap-2">
                  {!contract.employeeSignedAt && contract.status !== 'Ended' && (
                    <button onClick={sign} disabled={signing} className="btn-ink flex-1 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">{signing ? 'Signing…' : 'Sign contract'}</button>
                  )}
                  <button onClick={download} className={ghostBtn}><Download size={13} /> PDF</button>
                </div>
              </div>
            )}
        </Card>
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><FileBadge size={15} /> Resignation</p>
          {myResignation ? (
            <div>
              <Pill tone="amber">Pending review</Pill>
              <p className="mt-3 text-[13.5px] leading-relaxed text-black/60 dark:text-white/60">{myResignation.reason}</p>
              <p className="mt-2 text-[12.5px] text-black/45 dark:text-white/45">Submitted {fmtDate(myResignation.submittedAt)} · last working day {fmtDate(myResignation.lastWorkingDate)}</p>
              <button onClick={withdraw} disabled={busy} className="btn-ink mt-4 w-full py-2.5 text-[13.5px] font-semibold disabled:opacity-40">Withdraw</button>
            </div>
          ) : (
            <>
              <p className="text-[13.5px] leading-relaxed text-black/55 dark:text-white/55">Submit your resignation with a last working date — a {MIN_NOTICE_DAYS}-day notice is expected.</p>
              <button onClick={openResign} className="btn-ink mt-4 w-full py-3 text-[14px] font-semibold">Submit resignation</button>
            </>
          )}
        </Card>
      </div>
      <Modal open={resignOpen} onClose={() => setResignOpen(false)} title="Submit resignation">
        <div className="space-y-4">
          <Field label="Last working date"><input type="date" value={lastDay} onChange={e => setLastDay(e.target.value)} className={inputCls} /></Field>
          {shortfall > 0 && <p className="text-[12.5px] text-amber-600">This is {shortfall} day{shortfall === 1 ? '' : 's'} short of the {MIN_NOTICE_DAYS}-day notice period — the admin office may need to override it.</p>}
          <Field label="Reason"><textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className={inputCls} /></Field>
          <button onClick={submitResign} disabled={busy || !reason.trim() || !lastDay} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Submitting…' : 'Submit'}</button>
        </div>
      </Modal>
    </div>
  )
}

/* ── Admin: Contracts & Resignations ───────────────────── */

export function ContractsResignationsAdminMod() {
  const navigate = useNavigate()
  const employees = useEmployees()
  const [tab, setTab] = useState<'contracts' | 'resignations'>('contracts')
  const contracts = useContracts({}, tab === 'contracts')
  const resignations = useResignations(tab === 'resignations')
  const nameOf = (id: string, fallback?: string) => fallback ?? employees.find(e => e.id === id)?.name ?? 'Unknown'
  const [busy, setBusy] = useState<string | null>(null)

  const contractList = useMemo(
    () => [...(contracts.items ?? [])].sort((a, b) => nameOf(a.userId, a.userName).localeCompare(nameOf(b.userId, b.userName))),
    [contracts.items, employees], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const resignationList = useMemo(() => [...(resignations.items ?? [])].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), [resignations.items])

  const signAsAdmin = async (c: ContractRec) => {
    setBusy(c.id)
    try { await api.post(`/hr/contracts/${c.id}/sign`); contracts.reload(); toast.success('Contract signed') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const download = (c: ContractRec) => downloadPath(`/hr/contracts/${c.id}.pdf`, `Contract-${nameOf(c.userId, c.userName).replace(/\W+/g, '_')}.pdf`).catch(e => toast.error(errorMessage(e)))

  const [ending, setEnding] = useState<ContractRec | null>(null)
  const [endReason, setEndReason] = useState('')
  const endContract = async () => {
    if (!ending) return
    setBusy(ending.id)
    try {
      await api.post(`/hr/contracts/${ending.id}/end`, { reason: endReason.trim() })
      setEnding(null); setEndReason(''); contracts.reload(); toast.success('Contract ended')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const [reviewing, setReviewing] = useState<ResignationRec | null>(null)
  const [notes, setNotes] = useState('')
  const decideResignation = async (approve: boolean) => {
    if (!reviewing) return
    setBusy(reviewing.id)
    try {
      await api.post(`/hr/resignations/${reviewing.id}/${approve ? 'approve' : 'decline'}`, { notes: notes.trim() || undefined })
      setReviewing(null); setNotes(''); resignations.reload(); toast.success(approve ? 'Resignation approved — contract ends on the last working date' : 'Resignation declined')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div>
      <PageHead title="Contracts & Resignations" sub="Manage employment contracts and approve exit requests">
        <div className="flex items-center gap-2">
          <SegTabs value={tab} onChange={setTab} options={[{ id: 'contracts', label: 'Contracts' }, { id: 'resignations', label: 'Resignations' }]} />
          {tab === 'contracts' && <button onClick={() => navigate('/portal/hr/contracts/new')} disabled={employees.length === 0} className={primaryBtn}><Plus size={13} /> New contract</button>}
        </div>
      </PageHead>

      {tab === 'contracts' ? (
        <div className="grid gap-4 md:grid-cols-2">
          {contracts.loading ? <div className="md:col-span-2">{loadingRow('Loading contracts…')}</div>
            : contracts.error ? <div className="md:col-span-2"><Empty text={contracts.error} /></div>
            : contractList.length === 0 ? <div className="md:col-span-2"><Empty text="No contracts on file — create one for an employee." /></div>
            : contractList.map(c => (
              <Card key={c.id} className="card-lift">
                <div className="flex items-start gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${c.status === 'Active' ? 'bg-emerald-50 text-emerald-600' : c.status === 'Draft' ? 'bg-amber-50 text-amber-600' : 'bg-black/[.06] text-black/40 dark:bg-white/[.08] dark:text-white/40'}`}>
                    <Briefcase size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">{nameOf(c.userId, c.userName)}</p>
                    <p className="text-[12.5px] text-black/50 dark:text-white/50">{c.designation}{c.department ? ' · ' + c.department : ''}</p>
                    <p className="text-[12px] text-black/40 dark:text-white/40">{fmtDate(c.startDate)} → {c.endDate ? fmtDate(c.endDate) : 'open'}</p>
                  </div>
                  <Pill tone={contractRecTone(c.status)}>{c.status}</Pill>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-black/45 dark:text-white/45">
                  <span>Employee {c.employeeSignedAt ? `signed ${fmtDate(c.employeeSignedAt)}` : 'not signed'}</span>
                  <span>Admin {c.adminSignedAt ? `signed ${fmtDate(c.adminSignedAt)}` : 'not signed'}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {c.status === 'Draft' && <button onClick={() => navigate(`/portal/hr/contracts/${c.id}`)} disabled={busy === c.id} className={ghostBtn}><Pencil size={12} /> Edit</button>}
                  {!c.adminSignedAt && c.status !== 'Ended' && <button onClick={() => signAsAdmin(c)} disabled={busy === c.id} className={primaryBtn}><Check size={12} /> Sign</button>}
                  {c.status === 'Active' && <button onClick={() => { setEnding(c); setEndReason('') }} disabled={busy === c.id} className={dangerBtn}>End contract</button>}
                  <button onClick={() => download(c)} className={ghostBtn}><Download size={12} /> PDF</button>
                </div>
              </Card>
            ))}
        </div>
      ) : (
        <div className="grid gap-4">
          {resignations.loading ? loadingRow('Loading resignations…')
            : resignations.error ? <Empty text={resignations.error} />
            : resignationList.length === 0 ? <Empty text="No resignation requests." />
            : resignationList.map(r => (
              <Card key={r.id} className="card-lift">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <Pill tone={r.status === 'Approved' ? 'green' : r.status === 'Pending' ? 'amber' : r.status === 'Withdrawn' ? 'slate' : 'rose'}>{r.status}</Pill>
                    <p className="font-display mt-3 text-[17px] font-medium">{nameOf(r.userId, r.userName)}</p>
                    <p className="mt-2 text-[13px] leading-relaxed text-black/70 dark:text-white/70">{r.reason}</p>
                    <p className="mt-1 text-[12.5px] text-black/45 dark:text-white/45">Submitted {fmtDate(r.submittedAt)} · Last working day {fmtDate(r.lastWorkingDate)}</p>
                    {r.notes && <p className="mt-2 text-[12.5px] text-black/50 dark:text-white/50">Admin note: {r.notes}</p>}
                  </div>
                  {r.status === 'Pending' && (
                    <button onClick={() => { setReviewing(r); setNotes('') }} className="btn-ink px-4 py-2 text-[13px] font-semibold">Review</button>
                  )}
                </div>
              </Card>
            ))}
        </div>
      )}

      <Modal open={!!ending} onClose={() => setEnding(null)} title="End contract">
        {ending && (
          <div className="space-y-4">
            <p className="text-[13.5px] text-black/60 dark:text-white/60">Ending {nameOf(ending.userId, ending.userName)}'s contract. This is separate from a resignation — use it for terminations or non-renewals.</p>
            <Field label="Reason"><textarea value={endReason} onChange={e => setEndReason(e.target.value)} rows={3} className={inputCls} /></Field>
            <button onClick={endContract} disabled={busy === ending.id || !endReason.trim()} className="w-full rounded-xl bg-rose-600 py-3 text-[14px] font-semibold text-white hover:bg-rose-700 disabled:opacity-40">End contract</button>
          </div>
        )}
      </Modal>

      <Modal open={!!reviewing} onClose={() => { setReviewing(null); setNotes('') }} title="Review resignation">
        {reviewing && (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-black/70 dark:text-white/70">{reviewing.reason}</p>
            <p className="text-[12.5px] text-black/45 dark:text-white/45">Last working day {fmtDate(reviewing.lastWorkingDate)}</p>
            <Field label="Admin note"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Notes for the employee file…" className={inputCls} /></Field>
            <div className="flex gap-2">
              <button onClick={() => decideResignation(true)} disabled={busy === reviewing.id} className="btn-ink flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40"><Check size={16} /> Approve</button>
              <button onClick={() => decideResignation(false)} disabled={busy === reviewing.id} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-rose-50 dark:bg-rose-500/10 py-3 text-[14px] font-semibold text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-40">Decline</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ── Duties (event work assignment) ────────────────────── */

export function DutiesMod({ manage = false }: { manage?: boolean }) {
  const { user, db } = useStore()
  const employees = useMemo(() => db.users.filter(u => u.role === 'teacher' || u.role === 'staff' || u.role === 'admin').sort((a, b) => a.name.localeCompare(b.name)), [db.users])
  const duties = useDuties(manage ? undefined : user?.id, !!user)
  const list = useMemo(
    () => [...(duties.items ?? [])].sort((a, b) => (a.status === b.status ? a.eventDate.localeCompare(b.eventDate) : a.status === 'Assigned' ? -1 : 1)),
    [duties.items],
  )
  const nameOf = (id?: string | null, fallback?: string) => fallback ?? employees.find(e => e.id === id)?.name ?? 'Unassigned'
  const [busy, setBusy] = useState<string | null>(null)

  // Phase 25 item 2 — "My Invigilation Duties" folds into this screen rather than a separate nav item.
  // The server's serializeDuty carries only bare ids (no name decorations) — resolve the room from the
  // rooms the caller already has loaded; the assessment has no single-GET endpoint, so it's left unnamed.
  const { rooms } = useAcademic()
  const roomName = (id: string) => rooms.find(r => r.id === id)?.name ?? id
  const myInvigilations = useInvigilationDuties({ teacherId: user?.id }, !manage && !!user)
  const invigilationList = useMemo(() => [...(myInvigilations.items ?? [])].sort((a, b) => a.date.localeCompare(b.date)), [myInvigilations.items])
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const confirmInvigilation = async (id: string) => {
    setConfirmingId(id)
    try { await api.post(`/exams/invigilation/${id}/confirm`); myInvigilations.reload(); toast.success('Duty confirmed') }
    catch (e) { toast.error(errorMessage(e)) } finally { setConfirmingId(null) }
  }

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', eventTitle: '', eventDate: isoDate(new Date()), assigneeId: '' })
  const openCreate = () => { setForm({ title: '', eventTitle: '', eventDate: isoDate(new Date()), assigneeId: '' }); setOpen(true) }
  const create = async () => {
    setBusy('create')
    try {
      await api.post('/hr/duties', { title: form.title.trim(), eventTitle: form.eventTitle.trim(), eventDate: form.eventDate, assigneeId: form.assigneeId || undefined })
      setOpen(false); duties.reload(); toast.success('Duty assigned')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const [editing, setEditing] = useState<Duty | null>(null)
  const saveEdit = async () => {
    if (!editing) return
    setBusy(editing.id)
    try {
      await api.patch(`/hr/duties/${editing.id}`, { title: editing.title, eventTitle: editing.eventTitle, eventDate: editing.eventDate, assigneeId: editing.assigneeId || undefined })
      setEditing(null); duties.reload(); toast.success('Duty updated')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const remove = async (d: Duty) => {
    if (!confirm(`Delete duty "${d.title}"?`)) return
    setBusy(d.id)
    try { await api.del(`/hr/duties/${d.id}`); duties.reload(); toast.success('Duty deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const toggle = async (d: Duty) => {
    setBusy(d.id)
    try { await api.patch(`/hr/duties/${d.id}`, { status: d.status === 'Done' ? 'Assigned' : 'Done' }); duties.reload() }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div>
      <PageHead title={manage ? 'Duty Roster' : 'My Event Duties'} sub={manage ? 'Assign staff and teachers to event duties' : 'Everything you’re rostered for, in one place'}>
        {manage && <button onClick={openCreate} disabled={employees.length === 0} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40"><Plus size={15} /> Assign duty</button>}
      </PageHead>
      <div className="grid gap-4 md:grid-cols-2">
        {duties.loading ? <div className="md:col-span-2">{loadingRow('Loading duties…')}</div>
          : duties.error ? <div className="md:col-span-2"><Empty text={duties.error} /></div>
          : list.length === 0 ? <div className="md:col-span-2"><Empty text={manage ? 'No duties assigned yet.' : 'No event duties assigned to you yet.'} /></div>
          : list.map(d => (
            <Card key={d.id} className="flex items-center gap-4">
              {/* the assignee may only mark a duty Done, never revert it — only manage (staff/admin) can toggle back */}
              <button onClick={() => toggle(d)} disabled={busy === d.id || (!manage && d.status === 'Done')}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-default ${d.status === 'Done' ? 'bg-emerald-500 text-white' : 'bg-black/[.06] dark:bg-white/[.08] text-black/30 dark:text-white/30 hover:bg-black/10 dark:hover:bg-white/15'}`}>
                <Check size={18} />
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-[14.5px] font-semibold ${d.status === 'Done' ? 'text-black/40 dark:text-white/40 line-through' : ''}`}>{d.title}</p>
                <p className="text-[12.5px] text-black/45 dark:text-white/45">{d.eventTitle} · due {fmtDate(d.eventDate)}{manage ? ` · ${nameOf(d.assigneeId, d.assigneeName)}` : ''}</p>
              </div>
              <Pill tone={statusTone(d.status)}>{d.status}</Pill>
              {manage && (
                <div className="flex gap-1.5">
                  <button onClick={() => setEditing(d)} className="rounded-full p-2 text-black/40 hover:bg-black/[.06] hover:text-black dark:text-white/40 dark:hover:bg-white/[.08]" aria-label="Edit duty"><Pencil size={13} /></button>
                  <button onClick={() => remove(d)} disabled={busy === d.id} className="rounded-full p-2 text-black/40 hover:bg-rose-50 hover:text-rose-500 dark:text-white/40" aria-label="Delete duty"><Trash2 size={13} /></button>
                </div>
              )}
            </Card>
          ))}
      </div>

      {!manage && (
        <div className="mt-6">
          <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><ClipboardList size={15} /> My Invigilation Duties</p>
          <div className="grid gap-4 md:grid-cols-2">
            {myInvigilations.loading ? <div className="md:col-span-2">{loadingRow('Loading invigilation duties…')}</div>
              : myInvigilations.error ? <div className="md:col-span-2"><Empty text={myInvigilations.error} /></div>
              : invigilationList.length === 0 ? <div className="md:col-span-2"><Empty text="No exam invigilation duties assigned to you yet." /></div>
              : invigilationList.map(d => (
                <Card key={d.id} className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold">Exam invigilation</p>
                    <p className="text-[12.5px] text-black/45 dark:text-white/45">{fmtDate(d.date)} · {roomName(d.roomId)}</p>
                  </div>
                  <Pill tone={invigilationTone(d.status)}>{d.status}</Pill>
                  {d.status === 'Assigned' && (
                    <button onClick={() => confirmInvigilation(d.id)} disabled={confirmingId === d.id} className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
                      <Check size={13} /> {confirmingId === d.id ? 'Confirming…' : 'Confirm'}
                    </button>
                  )}
                </Card>
              ))}
          </div>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Assign duty">
        <div className="space-y-4">
          <Field label="Duty"><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Stage lights coordination" className={inputCls} /></Field>
          <Field label="Event"><input value={form.eventTitle} onChange={e => setForm({ ...form, eventTitle: e.target.value })} placeholder="e.g. Tech Fest '26" className={inputCls} /></Field>
          <Field label="Event date"><input type="date" value={form.eventDate} onChange={e => setForm({ ...form, eventDate: e.target.value })} className={inputCls} /></Field>
          <Field label="Assignee">
            <AsyncEntityPicker role={['teacher', 'staff', 'admin']} value={form.assigneeId}
              onChange={id => setForm({ ...form, assigneeId: id })} placeholder="Search staff/teachers… (optional)" />
          </Field>
          <button onClick={create} disabled={busy === 'create' || !form.title.trim() || !form.eventTitle.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Assign</button>
        </div>
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit duty">
        {editing && (
          <div className="space-y-4">
            <Field label="Duty"><input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} className={inputCls} /></Field>
            <Field label="Event"><input value={editing.eventTitle} onChange={e => setEditing({ ...editing, eventTitle: e.target.value })} className={inputCls} /></Field>
            <Field label="Event date"><input type="date" value={editing.eventDate} onChange={e => setEditing({ ...editing, eventDate: e.target.value })} className={inputCls} /></Field>
            <Field label="Assignee">
              <AsyncEntityPicker role={['teacher', 'staff', 'admin']} value={editing.assigneeId ?? ''}
                onChange={id => setEditing({ ...editing, assigneeId: id || null })}
                initialLabel={nameOf(editing.assigneeId, editing.assigneeName) !== 'Unassigned' ? nameOf(editing.assigneeId, editing.assigneeName) : undefined}
                placeholder="Search staff/teachers… (optional)" />
            </Field>
            <button onClick={saveEdit} disabled={busy === editing.id} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Save</button>
          </div>
        )}
      </Modal>
    </div>
  )
}
