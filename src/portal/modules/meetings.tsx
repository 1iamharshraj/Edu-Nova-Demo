import { useMemo, useState } from 'react'
import { Calendar, Check, Link as LinkIcon, Plus, Video, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { MeetingRequest, MeetingStatus, Role } from '@/lib/data'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, inputCls, statusTone } from '../ui'
import { toast } from 'sonner'

const canRequest: Role[] = ['parent', 'student', 'teacher']
const canApprove: Role[] = ['teacher', 'admin', 'superadmin']

function isApprover(role: Role | undefined, requesterRole: Role): boolean {
  if (!role) return false
  if (role === 'admin' || role === 'superadmin') return true
  if (role === 'teacher' && requesterRole === 'student') return true
  return false
}

function meetLink(id: string) {
  return `https://meet.edunova.in/${id}`
}

export function MeetingsMod() {
  const { db, update, user } = useStore()
  const [open, setOpen] = useState(false)
  const [purpose, setPurpose] = useState('')
  const [slot, setSlot] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [filter, setFilter] = useState<MeetingStatus | 'All'>('All')

  const teachers = useMemo(() => db.users.filter(u => u.role === 'teacher'), [db.users])
  const students = useMemo(() => db.users.filter(u => u.role === 'student'), [db.users])

  const role = user?.role
  const requester = canRequest.includes(role ?? 'parent')
  const approver = canApprove.includes(role ?? 'parent')

  const myRequests = useMemo(() => db.meetings.filter(m => m.requesterId === user?.id), [db.meetings, user?.id])
  const pendingApprovals = useMemo(() => {
    if (!approver) return []
    if (role === 'admin' || role === 'superadmin') return db.meetings.filter(m => m.status === 'Requested')
    // teacher: student requests only
    return db.meetings.filter(m => m.status === 'Requested' && m.requesterRole === 'student')
  }, [db.meetings, approver, role])

  const allRelevant = useMemo(() => {
    if (role === 'admin' || role === 'superadmin') return db.meetings
    if (role === 'teacher') return [...new Set([...myRequests, ...db.meetings.filter(m => m.teacherId === user?.id || m.approvedBy === user?.name)])]
    return myRequests
  }, [db.meetings, myRequests, role, user?.id, user?.name])

  const displayed = useMemo(() => {
    const base = role === 'admin' || role === 'superadmin' ? db.meetings : allRelevant
    return filter === 'All' ? base : base.filter(m => m.status === filter)
  }, [allRelevant, db.meetings, filter, role])

  const create = () => {
    if (!purpose.trim() || !slot.trim() || !teacherId || !studentId || !user) return
    const teacher = teachers.find(t => t.id === teacherId)
    const student = students.find(s => s.id === studentId)
    if (!teacher || !student) return

    const next: MeetingRequest = {
      id: 'm' + Date.now(),
      requesterId: user.id,
      requesterRole: user.role,
      requesterName: user.name,
      teacherId: teacher.id,
      studentId: student.id,
      studentName: student.name,
      purpose: purpose.trim(),
      slot: slot.trim(),
      meetLink: '',
      status: 'Requested',
      createdAt: new Date().toISOString().slice(0, 10),
    }

    update(d => { d.meetings.unshift(next); return d })
    setOpen(false)
    setPurpose(''); setSlot(''); setTeacherId(''); setStudentId('')
    toast.success('Meeting request sent for approval')
  }

  const approve = (id: string) => {
    update(d => {
      const m = d.meetings.find(x => x.id === id)
      if (!m) return d
      m.status = 'Scheduled'
      m.meetLink = meetLink(m.id)
      m.approvedBy = user?.name
      m.approvedAt = new Date().toISOString().slice(0, 10)
      return d
    })
    toast.success('Meeting approved — link generated')
  }

  const complete = (id: string) => {
    update(d => { const m = d.meetings.find(x => x.id === id); if (m) m.status = 'Completed'; return d })
    toast.success('Meeting marked completed')
  }

  const cancel = (id: string) => {
    update(d => { const m = d.meetings.find(x => x.id === id); if (m) m.status = 'Cancelled'; return d })
    toast.success('Meeting cancelled')
  }

  const openNew = () => {
    setTeacherId(teachers[0]?.id ?? '')
    setStudentId(students[0]?.id ?? '')
    setPurpose(''); setSlot('')
    setOpen(true)
  }

  const statusOrder: MeetingStatus[] = ['Requested', 'Scheduled', 'Completed', 'Cancelled']
  const filters = ['All', ...statusOrder]

  return (
    <div>
      <PageHead title="Meetings" sub="Request and manage video meetings with teachers">
        <div className="flex items-center gap-2">
          {requester && (
            <button onClick={openNew} className="btn-ink flex items-center gap-2 px-4 py-2 text-[13.5px] font-semibold">
              <Plus size={15} /> New request
            </button>
          )}
        </div>
      </PageHead>

      {/* quick filter chips */}
      <div className="mb-5 flex flex-wrap gap-2">
        {filters.map(f => (
          <button key={f} onClick={() => setFilter(f as MeetingStatus | 'All')}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${filter === f ? 'bg-black text-white' : 'bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60 ring-1 ring-black/10 dark:ring-white/15'}`}>
            {f}
          </button>
        ))}
      </div>

      {approver && pendingApprovals.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Pending approvals</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {pendingApprovals.map(m => (
              <MeetingCard key={m.id} m={m} user={user} onApprove={approve} onComplete={complete} onCancel={cancel} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
          {role === 'admin' || role === 'superadmin' ? 'All meetings' : role === 'teacher' ? 'Your meetings' : 'My meetings'}
        </h3>
        {displayed.length === 0 ? (
          <Empty text="No meetings found." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {displayed.map(m => (
              <MeetingCard key={m.id} m={m} user={user} onApprove={approve} onComplete={complete} onCancel={cancel} />
            ))}
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Request a meeting" wide>
        <div className="space-y-4">
          <Field label="Purpose">
            <input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g. Discuss Algebra progress" className={inputCls} />
          </Field>
          <Field label="Preferred slot">
            <input value={slot} onChange={e => setSlot(e.target.value)} placeholder="e.g. Fri 4:00 PM" className={inputCls} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Teacher">
              <select value={teacherId} onChange={e => setTeacherId(e.target.value)} className={inputCls}>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Student">
              <select value={studentId} onChange={e => setStudentId(e.target.value)} className={inputCls}>
                {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <button onClick={create} disabled={!purpose.trim() || !slot.trim() || !teacherId || !studentId}
            className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Submit request</button>
        </div>
      </Modal>
    </div>
  )
}

function MeetingCard({ m, user, onApprove, onComplete, onCancel }: {
  m: MeetingRequest
  user: ReturnType<typeof useStore>['user']
  onApprove: (id: string) => void
  onComplete: (id: string) => void
  onCancel: (id: string) => void
}) {
  const isRequester = user?.id === m.requesterId
  const canApprove = user && isApprover(user.role, m.requesterRole) && m.status === 'Requested'
  const canComplete = (m.status === 'Scheduled') && (isRequester || user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'superadmin')
  const canCancel = (m.status === 'Requested' || m.status === 'Scheduled') && (isRequester || user?.role === 'admin' || user?.role === 'superadmin' || (user?.role === 'teacher' && m.requesterRole === 'student'))

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={m.studentName} hue={200} size={40} />
          <div>
            <p className="text-[14.5px] font-semibold">{m.studentName}</p>
            <p className="text-[12px] text-black/45 dark:text-white/45">Requested by {m.requesterName}</p>
          </div>
        </div>
        <Pill tone={statusTone(m.status)}>{m.status}</Pill>
      </div>
      <div className="space-y-1">
        <p className="text-[15px] font-medium leading-snug">{m.purpose}</p>
        <p className="flex items-center gap-1.5 text-[12.5px] text-black/50 dark:text-white/50">
          <Calendar size={13} /> {m.slot}
        </p>
      </div>

      {m.status === 'Scheduled' && m.meetLink && (
        <div className="flex items-center gap-2 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 p-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600">
            <Video size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-indigo-700 dark:text-indigo-300">{m.meetLink}</p>
            <p className="text-[11px] text-black/40 dark:text-white/40">Approved by {m.approvedBy} · {m.approvedAt}</p>
          </div>
          <a href={m.meetLink} target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-indigo-600 p-2 text-white hover:bg-indigo-700">
            <LinkIcon size={14} />
          </a>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {canApprove && (
          <button onClick={() => onApprove(m.id)} className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700">
            <Check size={14} /> Approve
          </button>
        )}
        {canComplete && (
          <button onClick={() => onComplete(m.id)} className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700">
            <Check size={14} /> Complete
          </button>
        )}
        {canCancel && (
          <button onClick={() => onCancel(m.id)} className="flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-1.5 text-[12.5px] font-semibold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10">
            <X size={14} /> Cancel
          </button>
        )}
      </div>
    </Card>
  )
}
