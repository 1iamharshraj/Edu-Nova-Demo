import { useMemo, useState } from 'react'
import {
  AlertTriangle, Award, CheckCheck, ChevronDown, CloudUpload, Download, FileText, PillBottle, Plus, ShieldCheck, Syringe, Users,
} from 'lucide-react'
import { useAcademic, useStore } from '@/lib/store'
import { isStaffOrAdmin } from '@/lib/access'
import { api, downloadFile, errorMessage, uploadFile } from '@/lib/api'
import type { AchievementCategory, HealthKind, HomeworkRec, LeaveRequest, MedicationSchedule, PermissionSlipRec, SlipDecision, User } from '@/lib/data'
import { fmtDate, homeworkStatus, hwTone, isOpen, useHomework } from '@/lib/hooks/useAcademics'
import { isoDate } from '@/lib/hooks/useTimetable'
import { countLeaveDays, leaveTone, leaveTypeName, useLeaveBalance, useLeaveRequests, useLeaveTypes } from '@/lib/hooks/useHr'
import {
  ACHIEVEMENT_CATEGORIES, HEALTH_KINDS, hasAllergyRecord, slipDecisionTone, useAchievements, useHealthRecords,
  useMedicationLogs, useMedicationSchedules, useSlipResponses, useSlips,
} from '@/lib/hooks/useWelfare'
import { Card, Empty, Field, Modal, PageHead, Pill, TermTabs, UploadField, VerifyButton, inputCls, type UploadedFile } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'
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
// Staff/teacher create (class picker, "all classes" = no classId); parent responds per ward (gated on
// `verified` when the slip requires it); teacher/staff see a response tally. See phase-8-welfare.md

/** Parent verification gate for a slip response: a clear dead-end pointing at Profile, not a dead button. */
function ParentVerificationNeeded() {
  return (
    <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
      <span className="font-semibold">Parent verification required.</span> Open <span className="font-semibold">Profile → Parent verification</span> and upload an ID document — the office reviews it, then you can respond here.
    </div>
  )
}

function SlipCard({ slip, canManage, wards, isParent, classLabel, onChanged }: {
  slip: PermissionSlipRec
  canManage: boolean
  wards: User[]
  isParent: boolean
  classLabel?: string
  onChanged: () => void
}) {
  const { db, user } = useStore()
  const [tallyOpen, setTallyOpen] = useState(false)
  const tally = useSlipResponses(slip.id, tallyOpen)
  const [busyWard, setBusyWard] = useState<string | null>(null)
  const nameOf = (studentId: string) => db.users.find(u => u.id === studentId)?.name ?? studentId

  const responseFor = (studentId: string) => slip.myResponses?.find(r => r.studentId === studentId)

  const respond = async (studentId: string, decision: SlipDecision) => {
    setBusyWard(studentId)
    try {
      await api.post(`/slips/${slip.id}/respond`, { studentId, decision })
      toast.success(decision === 'Approved' ? 'Slip approved' : 'Slip declined')
      onChanged()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusyWard(null) }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <p className="font-display text-[16.5px] font-medium leading-snug">{slip.title}</p>
        <Pill tone={slip.classId ? 'sky' : 'slate'}>{slip.classId ? (classLabel ?? 'One class') : 'All classes'}</Pill>
      </div>
      <p className="mt-2 text-[13.5px] leading-relaxed text-black/55 dark:text-white/55">{slip.detail}</p>
      <p className="mt-3 text-[12.5px] font-medium text-black/45 dark:text-white/45">Respond by {fmtDate(slip.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })}</p>

      {isParent && wards.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-black/[.06] dark:border-white/[.08] pt-4">
          {wards.map(w => {
            const r = responseFor(w.id)
            return (
              <div key={w.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[13px] font-semibold">{w.name}</span>
                {r ? (
                  <Pill tone={slipDecisionTone(r.decision)}>{r.decision}</Pill>
                ) : slip.requiresVerifiedParent && !user?.verified ? (
                  <ParentVerificationNeeded />
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => respond(w.id, 'Approved')} disabled={busyWard === w.id} className="rounded-full bg-emerald-600 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">Approve</button>
                    <button onClick={() => respond(w.id, 'Declined')} disabled={busyWard === w.id} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Decline</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {canManage && (
        <div className="mt-4 border-t border-black/[.06] dark:border-white/[.08] pt-4">
          <button onClick={() => setTallyOpen(v => !v)} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white">
            <Users size={13} /> Response tally <ChevronDown size={13} className={`transition-transform ${tallyOpen ? 'rotate-180' : ''}`} />
          </button>
          {tallyOpen && (
            <div className="mt-2 space-y-1.5">
              {tally.loading && <p className="text-[12.5px] text-black/40 dark:text-white/40">Loading…</p>}
              {!tally.loading && (tally.items ?? []).length === 0 && <p className="text-[12.5px] text-black/40 dark:text-white/40">No responses yet.</p>}
              {(tally.items ?? []).map(r => (
                <div key={r.id} className="flex items-center justify-between rounded-xl bg-black/[.03] dark:bg-white/[.05] px-3 py-1.5 text-[12.5px]">
                  <span>{nameOf(r.studentId)}</span>
                  <Pill tone={slipDecisionTone(r.decision)}>{r.decision}</Pill>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export function SlipsMod() {
  const { user } = useStore()
  const { classesTaughtBy, classes, classById, currentYear } = useAcademic()
  const wards = useViewedStudents()
  const isParent = user?.role === 'parent'
  const canManage = user ? (user.role === 'teacher' || isStaffOrAdmin(user)) : false

  const { items: slips, loading, error, reload } = useSlips(!!user)
  const sorted = useMemo(() => [...(slips ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [slips])

  const myClasses = useMemo(() => {
    if (!user) return []
    if (isStaffOrAdmin(user)) return classes.filter(c => !currentYear || c.academicYearId === currentYear.id)
    if (user.role === 'teacher') return classesTaughtBy(user.id)
    return []
  }, [user, classes, currentYear, classesTaughtBy])

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [dueDate, setDueDate] = useState(() => isoDate(new Date()))
  const [classId, setClassId] = useState('')
  const [requiresVerified, setRequiresVerified] = useState(true)
  const [busy, setBusy] = useState(false)

  const resetForm = () => { setTitle(''); setDetail(''); setDueDate(isoDate(new Date())); setClassId(''); setRequiresVerified(true) }
  const create = async () => {
    setBusy(true)
    try {
      await api.post('/slips', { title: title.trim(), detail: detail.trim(), dueDate, classId: classId || undefined, requiresVerifiedParent: requiresVerified })
      setOpen(false); resetForm(); reload()
      toast.success('Permission slip published')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHead title="Permission Slips" sub={isParent ? 'Approve or decline on behalf of your ward — verified accounts respond fastest' : 'Field trips, clubs and other consent forms'}>
        {canManage && (
          <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> New slip</button>
        )}
      </PageHead>
      <div className="grid gap-4 md:grid-cols-2">
        {loading && <div className="md:col-span-2 py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading slips…</div>}
        {error && <div className="md:col-span-2"><Empty text={error} /></div>}
        {!loading && !error && sorted.length === 0 && <div className="md:col-span-2"><Empty text="No permission slips yet." /></div>}
        {sorted.map(s => (
          <SlipCard key={s.id} slip={s} canManage={canManage} wards={wards} isParent={isParent} classLabel={s.classId ? classById.get(s.classId)?.label : undefined} onChanged={reload} />
        ))}
      </div>
      <Modal open={open} onClose={() => { setOpen(false); resetForm() }} title="New permission slip">
        <div className="space-y-4">
          <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Field trip — Science City" className={inputCls} /></Field>
          <Field label="Details"><textarea value={detail} onChange={e => setDetail(e.target.value)} rows={3} placeholder="What parents need to know, cost, timing…" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Respond by"><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} /></Field>
            <Field label="Class">
              <select value={classId} onChange={e => setClassId(e.target.value)} className={inputCls}>
                <option value="">All classes</option>
                {myClasses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input type="checkbox" checked={requiresVerified} onChange={e => setRequiresVerified(e.target.checked)} className="h-4 w-4 rounded" />
            Require a verified parent to respond
          </label>
          <button onClick={create} disabled={!title.trim() || !detail.trim() || !dueDate || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Publishing…' : 'Publish slip'}</button>
        </div>
      </Modal>
    </div>
  )
}

/* ── Holiday / leave requests (parent for a ward, student for self) ── */

/**
 * Requester-side leave: parent picks a ward, student uses themself. Real leave types (`appliesTo: 'student'`),
 * a live balance card and history against `/leave/requests`. The approver view is `LeaveApprovalsMod` (hr.tsx).
 */
export function LeaveMod() {
  const { user } = useStore()
  const wards = useViewedStudents()
  const [wardId, setWardId] = useState('')
  const ward = wards.find(w => w.id === wardId) ?? wards[0]

  const types = useLeaveTypes(!!user)
  const studentTypes = useMemo(() => (types.items ?? []).filter(t => t.appliesTo === 'student'), [types.items])
  const year = new Date().getFullYear()
  const balance = useLeaveBalance(ward?.id, year, !!ward)
  const requests = useLeaveRequests({ forUserId: ward?.id, scope: 'mine' }, !!ward)
  const list = useMemo(() => [...(requests.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [requests.items])

  const [open, setOpen] = useState(false)
  const [leaveTypeId, setLeaveTypeId] = useState('')
  const [from, setFrom] = useState(() => isoDate(new Date()))
  const [to, setTo] = useState(() => isoDate(new Date()))
  const [reason, setReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const days = countLeaveDays(from, to)

  const openModal = () => { setLeaveTypeId(studentTypes[0]?.id ?? ''); setFrom(isoDate(new Date())); setTo(isoDate(new Date())); setReason(''); setOpen(true) }
  const create = async () => {
    if (!ward) { toast.error('No student is linked to your account yet'); return }
    setBusyId('create')
    try {
      await api.post('/leave/requests', { forUserId: ward.id, leaveTypeId: leaveTypeId || undefined, fromDate: from, toDate: to, reason: reason.trim() })
      setOpen(false); requests.reload(); balance.reload()
      toast.success('Leave request submitted')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusyId(null) }
  }
  const cancel = async (r: LeaveRequest) => {
    setBusyId(r.id)
    try { await api.post(`/leave/requests/${r.id}/cancel`); requests.reload(); balance.reload(); toast.success('Request cancelled') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusyId(null) }
  }

  return (
    <div>
      <PageHead title="Holiday Requests" sub={ward ? `Leave requests for ${firstName(ward.name)}` : 'Leave requests'}>
        {wards.length > 0 && (
          <button onClick={openModal} disabled={studentTypes.length === 0} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
            <Plus size={15} /> New request
          </button>
        )}
      </PageHead>

      {wards.length > 0 && types.items !== undefined && studentTypes.length === 0 && (
        <div className="mb-5"><Empty text="Leave isn't set up yet — ask the school office to add a student leave type." /></div>
      )}

      {ward && studentTypes.length > 0 && (balance.items ?? []).length > 0 && (
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          {(balance.items ?? []).map(b => (
            <Card key={b.leaveTypeId}>
              <p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">{leaveTypeName(types.items, b.leaveTypeId, b.name)}</p>
              <p className="font-display mt-2 text-2xl font-medium">{b.allowed > 0 ? `${b.remaining} / ${b.allowed}` : b.used}<span className="text-[14px] font-normal text-black/40 dark:text-white/40"> {b.allowed > 0 ? 'left' : 'taken'}</span></p>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-0">
        {!wards.length ? <div className="p-6"><Empty text="No student is linked to your account yet." /></div>
          : requests.loading ? <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading requests…</div>
          : requests.error ? <div className="p-6"><Empty text={requests.error} /></div>
          : list.length === 0 ? <div className="p-6"><Empty text="No requests yet." /></div>
          : list.map(l => (
            <div key={l.id} className="flex flex-wrap items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-4 last:border-0">
              <div className="min-w-40 flex-1">
                <p className="text-[14.5px] font-semibold">{l.reason} · {leaveTypeName(types.items, l.leaveTypeId, l.leaveTypeName)}</p>
                <p className="text-[12.5px] text-black/45 dark:text-white/45">
                  {fmtDate(l.fromDate)} → {fmtDate(l.toDate)} · {l.days} day{l.days === 1 ? '' : 's'}
                </p>
                {l.decisionNote && <p className="mt-1 text-[12px] text-black/50 dark:text-white/50">Note: {l.decisionNote}</p>}
              </div>
              <Pill tone={leaveTone(l.status)}>{l.status}</Pill>
              {l.status === 'Pending' && <button onClick={() => cancel(l)} disabled={busyId === l.id} className="rounded-full border border-black/10 dark:border-white/15 px-3.5 py-1.5 text-[12.5px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40">Cancel</button>}
            </div>
          ))}
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
          {studentTypes.length > 1 && (
            <Field label="Leave type">
              <select value={leaveTypeId} onChange={e => setLeaveTypeId(e.target.value)} className={inputCls}>
                {studentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} /></Field>
            <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} /></Field>
          </div>
          <p className="text-[12.5px] text-black/45 dark:text-white/45">{days} day{days === 1 ? '' : 's'} (Sundays excluded)</p>
          <Field label="Reason">
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder={ward ? `Why does ${firstName(ward.name)} need leave?` : 'Reason for leave'} className={inputCls} />
          </Field>
          {user && !user.verified
            ? <VerifyButton label="Verify & submit" onVerified={create} className="w-full justify-center" />
            : <button onClick={create} disabled={!reason.trim() || days === 0 || busyId === 'create'} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busyId === 'create' ? 'Submitting…' : 'Submit request'}</button>}
        </div>
      </Modal>
    </div>
  )
}

/* ── Health records ────────────────────────────────────── */
// Parent/student add for self/ward with a kind select; the list is scoped server-side (student, guardians,
// class teacher, staff/admin). Staff/admin get a Verify action. See phase-8-welfare.md

export function HealthMod() {
  const { db, user } = useStore()
  const { classOf, classesTaughtBy, enrollments } = useAcademic()
  const wards = useViewedStudents()
  const isSelfMode = user?.role === 'student' || user?.role === 'parent'
  const canAdd = isSelfMode
  const canVerify = user ? isStaffOrAdmin(user) : false

  // Teacher's picks are bounded to their own classes' students (a genuine scoped list, kept as a flat
  // select); staff/admin can pick any student in the school, so that side uses the async search picker.
  const isTeacher = user?.role === 'teacher'
  const teacherStudents = useMemo(() => {
    if (!user || user.role !== 'teacher') return []
    const classIds = new Set(classesTaughtBy(user.id).map(c => c.id))
    const ids = new Set(enrollments.filter(e => classIds.has(e.classId) && e.status === 'active').map(e => e.studentId))
    return db.users.filter(u => u.role === 'student' && ids.has(u.id))
  }, [user, db.users, classesTaughtBy, enrollments])

  const { ward, wardId, setWardId } = useWard()
  const [pickedStaff, setPickedStaff] = useState('')
  const teacherStudentId = teacherStudents.some(s => s.id === pickedStaff) ? pickedStaff : (teacherStudents[0]?.id ?? '')
  const [staffStudentId, setStaffStudentId] = useState('')
  const [staffStudentLabel, setStaffStudentLabel] = useState('')
  const studentId = isSelfMode ? wardId : isTeacher ? teacherStudentId : staffStudentId
  const viewedStudent = isSelfMode ? ward : isTeacher ? teacherStudents.find(s => s.id === studentId) : (staffStudentId ? { name: staffStudentLabel } : undefined)

  const { items, loading, error, reload } = useHealthRecords(studentId, !!studentId)
  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [items])

  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<HealthKind>('Checkup')
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [date, setDate] = useState(() => isoDate(new Date()))
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [busy, setBusy] = useState(false)

  const resetForm = () => { setKind('Checkup'); setTitle(''); setDetail(''); setDate(isoDate(new Date())); setFiles([]) }
  const save = async () => {
    if (!studentId) return
    setBusy(true)
    try {
      await api.post('/health', { studentId, kind, title: title.trim(), detail: detail.trim(), date, fileIds: files.map(f => f.id) })
      setOpen(false); resetForm(); reload()
      toast.success('Health record added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const verify = async (id: string) => {
    try { await api.post(`/health/${id}/verify`); reload(); toast.success('Health record verified') }
    catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <div>
      <PageHead title="Health Records" sub={viewedStudent ? `${isSelfMode ? '' : 'Viewing '}${firstName(viewedStudent.name)}’s health record` : 'Vaccinations, allergies and checkups'}>
        <div className="flex flex-wrap items-center gap-2">
          {isSelfMode && wards.length > 1 && <WardPicker students={wards} value={wardId} onChange={setWardId} />}
          {!isSelfMode && isTeacher && teacherStudents.length > 0 && (
            <select value={teacherStudentId} onChange={e => setPickedStaff(e.target.value)} className={`${inputCls} w-auto min-w-[180px] py-2 text-[13.5px]`}>
              {teacherStudents.map(s => <option key={s.id} value={s.id}>{s.name}{classOf(s.id) ? ` · ${classOf(s.id)!.label}` : ''}</option>)}
            </select>
          )}
          {!isSelfMode && !isTeacher && (
            <div className="w-64"><AsyncEntityPicker role="student" value={staffStudentId} onChange={(id, label) => { setStaffStudentId(id); setStaffStudentLabel(label) }} placeholder="Search student…" /></div>
          )}
          {canAdd && studentId && (
            <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> Add record</button>
          )}
        </div>
      </PageHead>
      {studentId && !loading && hasAllergyRecord(sorted) && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-500" />
          <div>
            <p className="text-[13.5px] font-semibold text-rose-700 dark:text-rose-400">Allergy on file</p>
            <p className="mt-0.5 text-[12.5px] text-rose-700/80 dark:text-rose-300/80">
              {sorted.filter(h => h.kind === 'Allergy').map(h => h.title).join(' · ')}
            </p>
          </div>
        </div>
      )}
      {!studentId ? (
        <Empty text={isSelfMode ? 'No student is linked to your account yet.' : 'No students to show — pick a class with students enrolled.'} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {loading && <div className="md:col-span-2 py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading records…</div>}
          {error && <div className="md:col-span-2"><Empty text={error} /></div>}
          {!loading && !error && sorted.length === 0 && <div className="md:col-span-2"><Empty text="No health records yet." /></div>}
          {sorted.map(h => (
            <Card key={h.id} className={h.kind === 'Allergy' ? 'border-rose-200 dark:border-rose-500/30' : undefined}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Pill tone={h.kind === 'Allergy' ? 'rose' : 'indigo'}>{h.kind}</Pill>
                  <p className="font-display mt-2 text-[16.5px] font-medium">{h.title}</p>
                </div>
                {h.verifiedAt ? <Pill tone="green"><ShieldCheck size={11} /> verified</Pill> : <Pill tone="amber">unverified</Pill>}
              </div>
              <p className="mt-2 text-[13.5px] text-black/55 dark:text-white/55">{h.detail}</p>
              {h.fileIds.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {h.fileIds.map((id, i) => (
                    <button key={id} onClick={() => downloadFile(id, `health-${i + 1}`).catch(e => toast.error(errorMessage(e)))} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15"><FileText size={12} /> File {i + 1}</button>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-black/[.06] dark:border-white/[.08] pt-3">
                <p className="text-[12.5px] text-black/40 dark:text-white/40">Added {fmtDate(h.date, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                {canVerify && !h.verifiedAt && (
                  <button onClick={() => verify(h.id)} className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700"><CheckCheck size={12} /> Verify</button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => { setOpen(false); resetForm() }} title={`Add health record${viewedStudent ? ` — ${viewedStudent.name}` : ''}`}>
        <div className="space-y-4">
          <Field label="Kind">
            <select value={kind} onChange={e => setKind(e.target.value as HealthKind)} className={inputCls}>
              {HEALTH_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. MMR + Td booster" className={inputCls} /></Field>
          <Field label="Details"><textarea value={detail} onChange={e => setDetail(e.target.value)} rows={3} placeholder="Diagnosis, allergies, doctor notes…" className={inputCls} /></Field>
          <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
          <UploadField files={files} onChange={setFiles} multiple accept=".pdf,.png,.jpg,.jpeg" label="Attach a report" hint="PDF, PNG or JPG" />
          <button onClick={save} disabled={!title.trim() || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save record'}</button>
        </div>
      </Modal>
    </div>
  )
}

/* ── Medication schedule + administration log (Phase 22 item 4) ── */
// Same visibility as Health Records (student/guardians/class-teacher/staff/admin); only staff/admin log doses.
// See phase-22-campus-safety.md

export function MedicationMod() {
  const { db, user } = useStore()
  const { classOf, classesTaughtBy, enrollments } = useAcademic()
  const wards = useViewedStudents()
  const isSelfMode = user?.role === 'student' || user?.role === 'parent'
  const canManage = user ? isStaffOrAdmin(user) : false

  // Same split as HealthMod: teacher stays bounded to their own classes (flat select); staff/admin get the
  // async search picker over the whole school roster.
  const isTeacher = user?.role === 'teacher'
  const teacherStudents = useMemo(() => {
    if (!user || user.role !== 'teacher') return []
    const classIds = new Set(classesTaughtBy(user.id).map(c => c.id))
    const ids = new Set(enrollments.filter(e => classIds.has(e.classId) && e.status === 'active').map(e => e.studentId))
    return db.users.filter(u => u.role === 'student' && ids.has(u.id))
  }, [user, db.users, classesTaughtBy, enrollments])

  const { ward, wardId, setWardId } = useWard()
  const [pickedStaff, setPickedStaff] = useState('')
  const teacherStudentId = teacherStudents.some(s => s.id === pickedStaff) ? pickedStaff : (teacherStudents[0]?.id ?? '')
  const [staffStudentId, setStaffStudentId] = useState('')
  const [staffStudentLabel, setStaffStudentLabel] = useState('')
  const studentId = isSelfMode ? wardId : isTeacher ? teacherStudentId : staffStudentId
  const viewedStudent = isSelfMode ? ward : isTeacher ? teacherStudents.find(s => s.id === studentId) : (staffStudentId ? { name: staffStudentLabel } : undefined)

  const { items: healthItems } = useHealthRecords(studentId, !!studentId)
  const hasAllergy = hasAllergyRecord(healthItems)

  const { items, loading, error, reload } = useMedicationSchedules(studentId, !!studentId)
  const schedules = useMemo(() => [...(items ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate)), [items])

  const [open, setOpen] = useState(false)
  const [medName, setMedName] = useState('')
  const [dosage, setDosage] = useState('')
  const [timesText, setTimesText] = useState('08:00')
  const [startDate, setStartDate] = useState(() => isoDate(new Date()))
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const parsedTimes = useMemo(
    () => Array.from(new Set(timesText.split(',').map(t => t.trim()).filter(t => /^\d{2}:\d{2}$/.test(t)))),
    [timesText],
  )
  const resetForm = () => { setMedName(''); setDosage(''); setTimesText('08:00'); setStartDate(isoDate(new Date())); setEndDate(''); setNotes('') }
  const save = async () => {
    if (!studentId || !medName.trim() || !dosage.trim() || parsedTimes.length === 0) return
    setBusy(true)
    try {
      await api.post('/health/medication-schedules', {
        studentId, medicationName: medName.trim(), dosage: dosage.trim(), times: parsedTimes,
        startDate, endDate: endDate || undefined, notes: notes.trim() || undefined,
      })
      setOpen(false); resetForm(); reload(); toast.success('Medication schedule added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHead title="Medication Log" sub={viewedStudent ? `${isSelfMode ? '' : 'Viewing '}${firstName(viewedStudent.name)}'s medication schedule` : 'Scheduled medication and dose administration'}>
        <div className="flex flex-wrap items-center gap-2">
          {isSelfMode && wards.length > 1 && <WardPicker students={wards} value={wardId} onChange={setWardId} />}
          {!isSelfMode && isTeacher && teacherStudents.length > 0 && (
            <select value={teacherStudentId} onChange={e => setPickedStaff(e.target.value)} className={`${inputCls} w-auto min-w-[180px] py-2 text-[13.5px]`}>
              {teacherStudents.map(s => <option key={s.id} value={s.id}>{s.name}{classOf(s.id) ? ` · ${classOf(s.id)!.label}` : ''}</option>)}
            </select>
          )}
          {!isSelfMode && !isTeacher && (
            <div className="w-64"><AsyncEntityPicker role="student" value={staffStudentId} onChange={(id, label) => { setStaffStudentId(id); setStaffStudentLabel(label) }} placeholder="Search student…" /></div>
          )}
          {canManage && studentId && (
            <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> Add schedule</button>
          )}
        </div>
      </PageHead>
      {studentId && hasAllergy && (
        <div className="mb-5 flex items-center gap-2.5 rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-4 py-3">
          <AlertTriangle size={16} className="shrink-0 text-rose-500" />
          <p className="text-[12.5px] font-semibold text-rose-700 dark:text-rose-400">This student has an allergy on file — check Health Records before administering any medication.</p>
        </div>
      )}
      {!studentId ? (
        <Empty text={isSelfMode ? 'No student is linked to your account yet.' : 'No students to show.'} />
      ) : (
        <div className="grid gap-4">
          {loading && <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading schedules…</div>}
          {error && <Empty text={error} />}
          {!loading && !error && schedules.length === 0 && <Empty text="No medication schedules on file." />}
          {schedules.map(s => <MedicationScheduleCard key={s.id} schedule={s} canLog={canManage} />)}
        </div>
      )}
      <Modal open={open} onClose={() => { setOpen(false); resetForm() }} title={`Add medication schedule${viewedStudent ? ` — ${viewedStudent.name}` : ''}`}>
        <div className="space-y-4">
          <Field label="Medication name"><input value={medName} onChange={e => setMedName(e.target.value)} placeholder="e.g. Cetirizine" className={inputCls} /></Field>
          <Field label="Dosage"><input value={dosage} onChange={e => setDosage(e.target.value)} placeholder="e.g. 5mg tablet" className={inputCls} /></Field>
          <Field label="Administration times">
            <input value={timesText} onChange={e => setTimesText(e.target.value)} placeholder="e.g. 08:00, 14:00, 20:00" className={inputCls} />
          </Field>
          <p className="-mt-2 text-[12px] text-black/40 dark:text-white/40">24-hour HH:MM, comma-separated{parsedTimes.length > 0 ? ` · parsed: ${parsedTimes.join(', ')}` : ''}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date"><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} /></Field>
            <Field label="End date (optional)"><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="Notes (optional)"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputCls} /></Field>
          <button onClick={save} disabled={!medName.trim() || !dosage.trim() || parsedTimes.length === 0 || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save schedule'}</button>
        </div>
      </Modal>
    </div>
  )
}

function MedicationScheduleCard({ schedule, canLog }: { schedule: MedicationSchedule; canLog: boolean }) {
  const { db } = useStore()
  const { items, reload } = useMedicationLogs(schedule.id)
  const logs = useMemo(() => [...(items ?? [])].sort((a, b) => b.administeredAt.localeCompare(a.administeredAt)), [items])
  const [logging, setLogging] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const nameOf = (id: string) => db.users.find(u => u.id === id)?.name ?? 'Staff'

  const logDose = async () => {
    setBusy(true)
    try {
      await api.post('/health/medication-logs', { scheduleId: schedule.id, notes: note.trim() || undefined })
      setLogging(false); setNote(''); reload(); toast.success('Dose logged')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><PillBottle size={15} className="text-indigo-500" /><p className="font-display text-[16.5px] font-medium">{schedule.medicationName}</p></div>
          <p className="mt-1 text-[13px] text-black/55 dark:text-white/55">{schedule.dosage} · {schedule.times.join(', ')}</p>
        </div>
        <Pill tone={!schedule.endDate || schedule.endDate >= isoDate(new Date()) ? 'green' : 'slate'}>{!schedule.endDate || schedule.endDate >= isoDate(new Date()) ? 'Active' : 'Ended'}</Pill>
      </div>
      {schedule.notes && <p className="mt-2 text-[12.5px] text-black/50 dark:text-white/50">{schedule.notes}</p>}
      <p className="mt-2 text-[12px] text-black/40 dark:text-white/40">{fmtDate(schedule.startDate)} → {schedule.endDate ? fmtDate(schedule.endDate) : 'ongoing'}</p>

      <div className="mt-4 border-t border-black/[.06] dark:border-white/[.08] pt-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><Syringe size={13} /> Administration log</p>
          {canLog && <button onClick={() => setLogging(true)} className="rounded-full bg-emerald-600 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700">Log dose</button>}
        </div>
        {logs.length === 0 ? (
          <p className="text-[12.5px] text-black/40 dark:text-white/40">No doses logged yet.</p>
        ) : (
          <div className="space-y-1.5">
            {logs.slice(0, 5).map(l => (
              <div key={l.id} className="flex items-center justify-between text-[12.5px]">
                <span className="text-black/60 dark:text-white/60">{new Date(l.administeredAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {nameOf(l.administeredById)}</span>
                {l.notes && <span className="text-black/40 dark:text-white/40">{l.notes}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <Modal open={logging} onClose={() => setLogging(false)} title={`Log dose — ${schedule.medicationName}`}>
        <div className="space-y-4">
          <p className="text-[13px] text-black/55 dark:text-white/55">Logs the dose as administered now, by you.</p>
          <Field label="Notes (optional)"><textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className={inputCls} /></Field>
          <button onClick={logDose} disabled={busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Logging…' : 'Confirm dose given'}</button>
        </div>
      </Modal>
    </Card>
  )
}

/* ── Achievements ──────────────────────────────────────── */
// Categories, student/teacher add own, staff/admin/teacher verify others'. See phase-8-welfare.md

export function AchievementsMod() {
  const { user } = useStore()
  const canAddOwn = user?.role === 'student' || user?.role === 'teacher'
  const canVerify = user ? (isStaffOrAdmin(user) || user.role === 'teacher') : false

  const { items, loading, error, reload } = useAchievements(undefined, !!user)
  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [items])

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [category, setCategory] = useState<AchievementCategory>('Academic')
  const [date, setDate] = useState(() => isoDate(new Date()))
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [busy, setBusy] = useState(false)

  const resetForm = () => { setTitle(''); setDetail(''); setCategory('Academic'); setDate(isoDate(new Date())); setFiles([]) }
  const save = async () => {
    setBusy(true)
    try {
      await api.post('/achievements', { title: title.trim(), detail: detail.trim(), date, category, fileIds: files.map(f => f.id) })
      setOpen(false); resetForm(); reload()
      toast.success('Achievement published to the school wall')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const verify = async (id: string) => {
    try { await api.post(`/achievements/${id}/verify`); reload(); toast.success('Achievement verified') }
    catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <div>
      <PageHead title="Achievements" sub="Wins, certificates and co-curricular highlights">
        {canAddOwn && (
          <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> Add achievement</button>
        )}
      </PageHead>
      <div className="grid gap-4 md:grid-cols-2">
        {loading && <div className="md:col-span-2 py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading achievements…</div>}
        {error && <div className="md:col-span-2"><Empty text={error} /></div>}
        {!loading && !error && sorted.length === 0 && <div className="md:col-span-2"><Empty text="No achievements published yet." /></div>}
        {sorted.map(a => (
          <Card key={a.id} className="card-lift">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/20 to-orange-400/20">
                  <Award size={20} className="text-amber-500" />
                </span>
                <div>
                  <p className="font-display text-[16px] font-medium leading-tight">{a.title}</p>
                  <p className="text-[12px] text-black/45 dark:text-white/45">{a.userName ?? ''}{a.userName ? ' · ' : ''}{fmtDate(a.date, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
              </div>
              <Pill tone="indigo">{a.category}</Pill>
            </div>
            <p className="mt-3 text-[13.5px] text-black/55 dark:text-white/55">{a.detail}</p>
            {a.fileIds.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {a.fileIds.map((id, i) => (
                  <button key={id} onClick={() => downloadFile(id, `achievement-${i + 1}`).catch(e => toast.error(errorMessage(e)))} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15"><FileText size={12} /> File {i + 1}</button>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-black/[.06] dark:border-white/[.08] pt-3">
              {a.verifiedAt ? <Pill tone="green"><ShieldCheck size={11} /> verified</Pill> : <Pill tone="amber">unverified</Pill>}
              {canVerify && !a.verifiedAt && (
                <button onClick={() => verify(a.id)} className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700"><CheckCheck size={12} /> Verify</button>
              )}
            </div>
          </Card>
        ))}
      </div>
      <Modal open={open} onClose={() => { setOpen(false); resetForm() }} title="Add achievement">
        <div className="space-y-4">
          <Field label="Category">
            <select value={category} onChange={e => setCategory(e.target.value as AchievementCategory)} className={inputCls}>
              {ACHIEVEMENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Silver — National Science Fair" className={inputCls} /></Field>
          <Field label="Details"><textarea value={detail} onChange={e => setDetail(e.target.value)} rows={3} placeholder="What happened, when, which category…" className={inputCls} /></Field>
          <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
          <UploadField files={files} onChange={setFiles} multiple accept=".pdf,.png,.jpg,.jpeg" label="Attach a certificate" />
          <button onClick={save} disabled={!title.trim() || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Publishing…' : 'Publish'}</button>
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
