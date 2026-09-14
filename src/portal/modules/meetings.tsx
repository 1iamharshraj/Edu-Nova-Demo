import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Calendar, Check, Clock3, Link as LinkIcon, Plus, Video, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import type { MeetingRec } from '@/lib/data'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'
import { useViewedStudents } from './viewer'
import { MEETING_STATUSES, fmtDayTime, meetingTone, nowLocal, useMeetings } from '@/lib/hooks/useComms'

// Phase 7 meetings: request → approve/decline → join link; cancel/complete.
// See .agents/edunova/phase-7-communication.md

export function MeetingsMod() {
  const { db, user } = useStore()
  const { items: meetings, loading, error, reload } = useMeetings()
  const [open, setOpen] = useState(false)
  const [purpose, setPurpose] = useState('')
  const [scheduledAt, setScheduledAt] = useState(nowLocal())
  const [withUserId, setWithUserId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [filter, setFilter] = useState<MeetingRec['status'] | 'All'>('All')
  const [busy, setBusy] = useState<string | null>(null)

  const role = user?.role
  const isRequester = role === 'parent' || role === 'student' || role === 'teacher'
  const isDecider = role === 'teacher' || role === 'admin' || role === 'superadmin'

  // eligible "with" people, per the model (`withUserId` a teacher or admin): a teacher requester meets an
  // admin (another teacher can't decide a teacher's request); parents/students meet a teacher or admin.
  // AsyncEntityPicker replaces the old whole-school flat select (Phase B, see ui-architecture-fix.md) — the
  // role pool below still gates who's searchable, and `hasWithOptions` is a cheap existence check (not a
  // full-roster render) reused only to disable the "New request" trigger when nobody's eligible at all.
  const withRoles = useMemo(() => (role === 'teacher' ? (['admin', 'superadmin'] as const) : (['teacher', 'admin', 'superadmin'] as const)), [role])
  const hasWithOptions = useMemo(() => db.users.some(u => (withRoles as readonly string[]).includes(u.role)), [db.users, withRoles])
  const wards = useViewedStudents()
  const needsStudent = role === 'parent' || role === 'student'

  // The server only returns ids — resolve display names from the store's user list.
  const nameOf = (id?: string | null) => (id ? db.users.find(u => u.id === id)?.name ?? id : undefined)

  const list = meetings ?? []
  const displayed = filter === 'All' ? list : list.filter(m => m.status === filter)
  const pendingApprovals = isDecider ? list.filter(m => m.status === 'Requested' && m.withUserId === user?.id) : []

  const openNew = () => {
    setPurpose(''); setScheduledAt(nowLocal())
    setWithUserId('')
    setStudentId(wards[0]?.id ?? '')
    setOpen(true)
  }

  const create = async () => {
    if (!purpose.trim() || !scheduledAt || !withUserId) return
    setBusy('create')
    try {
      await api.post('/meetings', {
        purpose: purpose.trim(),
        scheduledAt: new Date(scheduledAt).toISOString(),
        withUserId,
        studentId: needsStudent ? (studentId || undefined) : undefined,
      })
      setOpen(false)
      reload()
      toast.success('Meeting request sent')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const act = async (id: string, verb: 'approve' | 'decline' | 'cancel' | 'complete', note?: string) => {
    setBusy(id)
    try {
      await api.post(`/meetings/${id}/${verb}`, note ? { note } : undefined)
      reload()
      toast.success(verb === 'approve' ? 'Meeting approved — link generated' : verb === 'decline' ? 'Meeting declined' : verb === 'cancel' ? 'Meeting cancelled' : 'Meeting marked completed')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const filters: (MeetingRec['status'] | 'All')[] = ['All', ...MEETING_STATUSES]

  return (
    <div>
      <PageHead title="Meetings" sub="Request and manage video meetings">
        {isRequester && (
          <button onClick={openNew} disabled={!hasWithOptions} className="btn-ink flex items-center gap-2 px-4 py-2 text-[13.5px] font-semibold disabled:opacity-40">
            <Plus size={15} /> New request
          </button>
        )}
      </PageHead>

      <div className="mb-5 flex flex-wrap gap-2">
        {filters.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${filter === f ? 'bg-black text-white' : 'bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60 ring-1 ring-black/10 dark:ring-white/15'}`}>
            {f}
          </button>
        ))}
      </div>

      {loading && <p className="py-8 text-center text-[14px] text-black/40 dark:text-white/40">Loading meetings…</p>}
      {error && <Empty text={error} />}

      {!loading && !error && (
        <>
          {isDecider && pendingApprovals.length > 0 && (
            <div className="mb-8">
              <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Pending your decision</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {pendingApprovals.map(m => (
                  <MeetingCard key={m.id} m={m} userId={user?.id} busy={busy} onAct={act} nameOf={nameOf} />
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
              {role === 'admin' || role === 'superadmin' ? 'All meetings' : 'My meetings'}
            </h3>
            {displayed.length === 0 ? (
              <Empty text="No meetings found." />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {displayed.map(m => (
                  <MeetingCard key={m.id} m={m} userId={user?.id} busy={busy} onAct={act} nameOf={nameOf} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Request a meeting" wide>
        <div className="space-y-4">
          <Field label="Purpose">
            <input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g. Discuss Algebra progress" className={inputCls} />
          </Field>
          <Field label="Preferred slot">
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className={inputCls} />
          </Field>
          <div className={`grid gap-4 ${needsStudent ? 'sm:grid-cols-2' : ''}`}>
            <Field label={role === 'teacher' ? 'Meet with (admin)' : 'Meet with (teacher or admin)'}>
              <AsyncEntityPicker role={[...withRoles]} value={withUserId} onChange={id => setWithUserId(id)} placeholder="Search…" />
            </Field>
            {needsStudent && (
              <Field label="About">
                <select value={studentId} onChange={e => setStudentId(e.target.value)} className={inputCls}>
                  {wards.length === 0 && <option value="">No student</option>}
                  {wards.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <button onClick={create} disabled={busy === 'create' || !purpose.trim() || !scheduledAt || !withUserId}
            className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy === 'create' ? 'Sending…' : 'Submit request'}</button>
        </div>
      </Modal>
    </div>
  )
}

function MeetingCard({ m, userId, busy, onAct, nameOf }: {
  m: MeetingRec
  userId?: string
  busy: string | null
  onAct: (id: string, verb: 'approve' | 'decline' | 'cancel' | 'complete', note?: string) => void
  nameOf: (id?: string | null) => string | undefined
}) {
  const [declining, setDeclining] = useState(false)
  const [note, setNote] = useState('')
  const isRequester = userId === m.requesterId
  const isDecider = userId === m.withUserId
  const canDecide = isDecider && m.status === 'Requested'
  const canComplete = m.status === 'Scheduled' && (isRequester || isDecider)
  const canCancel = (m.status === 'Requested' || m.status === 'Scheduled') && (isRequester || isDecider)
  const withUserName = nameOf(m.withUserId) ?? 'Meeting'
  const requesterName = nameOf(m.requesterId) ?? '—'
  const studentName = nameOf(m.studentId)

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={withUserName} hue={200} size={40} />
          <div>
            <p className="text-[14.5px] font-semibold">{withUserName}</p>
            <p className="text-[12px] text-black/45 dark:text-white/45">
              Requested by {requesterName}{studentName ? ` · about ${studentName}` : ''}
            </p>
          </div>
        </div>
        <Pill tone={meetingTone(m.status)}>{m.status}</Pill>
      </div>
      <div className="space-y-1">
        <p className="text-[15px] font-medium leading-snug">{m.purpose}</p>
        <p className="flex items-center gap-1.5 text-[12.5px] text-black/50 dark:text-white/50">
          <Calendar size={13} /> {fmtDayTime(m.scheduledAt)} <Clock3 size={13} className="ml-1" /> {m.durationMin ?? 30} min
        </p>
        {m.note && <p className="text-[12px] text-black/45 dark:text-white/45">Note: {m.note}</p>}
      </div>

      {m.status === 'Scheduled' && m.link && (
        <div className="flex items-center gap-2 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 p-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600">
            <Video size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-indigo-700 dark:text-indigo-300">{m.link}</p>
            <p className="text-[11px] text-black/40 dark:text-white/40">Approved {fmtDayTime(m.decidedAt)}</p>
          </div>
          <a href={m.link} target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-indigo-600 p-2 text-white hover:bg-indigo-700">
            <LinkIcon size={14} />
          </a>
        </div>
      )}

      {declining ? (
        <div className="space-y-2 rounded-xl bg-black/[.03] p-3 dark:bg-white/[.05]">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason (optional)" className={`${inputCls} py-2`} autoFocus />
          <div className="flex gap-2">
            <button onClick={() => { onAct(m.id, 'decline', note.trim() || undefined); setDeclining(false); setNote('') }} disabled={busy === m.id}
              className="flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-rose-700">
              <X size={14} /> Confirm decline
            </button>
            <button onClick={() => setDeclining(false)} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-1.5 text-[12.5px] font-semibold">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          {canDecide && (
            <>
              <button onClick={() => onAct(m.id, 'approve')} disabled={busy === m.id} className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                <Check size={14} /> Approve
              </button>
              <button onClick={() => setDeclining(true)} disabled={busy === m.id} className="flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-1.5 text-[12.5px] font-semibold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-50">
                <X size={14} /> Decline
              </button>
            </>
          )}
          {canComplete && (
            <button onClick={() => onAct(m.id, 'complete')} disabled={busy === m.id} className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              <Check size={14} /> Complete
            </button>
          )}
          {canCancel && (
            <button onClick={() => onAct(m.id, 'cancel')} disabled={busy === m.id} className="flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-1.5 text-[12.5px] font-semibold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-50">
              <X size={14} /> Cancel
            </button>
          )}
        </div>
      )}
    </Card>
  )
}
