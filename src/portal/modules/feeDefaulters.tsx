import { useMemo, useState } from 'react'
import { Calendar, Clock, Filter, MessageSquare, Phone, Trash2, User as UserIcon } from 'lucide-react'
import { useAcademic, useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { canViewFeeDefaulters, isAdmin } from '@/lib/access'
import { fmtINR, type AIParentCall, type AIParentCallStatus, type FeeDefaulter, type FeeInvoice, type ReminderChannel, type Role, type User } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { isoDate } from '@/lib/hooks/useTimetable'
import { isOutstanding, outstandingOf, useDefaulters } from '@/lib/hooks/useFinance'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { useActiveTerm } from './viewer'
import { toast } from 'sonner'

// Defaulters are derived server-side (`GET /fees/defaulters`); reminders are real rows (`POST /fees/reminders`).
// The AI parent-call log stays a scheduling log until Phase 8/9 decides telephony — nothing here fakes a call.

/* ── helpers ───────────────────────────────────────────── */

const REASONS: { value: AIParentCall['reason']; label: string }[] = [
  { value: 'fee', label: 'Fee due' },
  { value: 'attendance', label: 'Attendance concern' },
  { value: 'disciplinary', label: 'Disciplinary issue' },
  { value: 'general', label: 'General follow-up' },
]

const LANGUAGES = ['English', 'Hindi', 'Malayalam']
const CHANNELS: { value: ReminderChannel; label: string }[] = [{ value: 'InApp', label: 'In-app notification' }, { value: 'Email', label: 'Email' }, { value: 'SMS', label: 'SMS' }]

const tsId = () => Date.now()

function reasonText(reason: AIParentCall['reason']) {
  switch (reason) {
    case 'fee': return 'Fee payment reminder and follow-up'
    case 'attendance': return 'Discuss recent absenteeism'
    case 'disciplinary': return 'Discuss disciplinary matter'
    default: return 'General wellness check'
  }
}

function aiCallStatusTone(s: AIParentCallStatus): 'green' | 'amber' | 'rose' | 'slate' {
  if (s === 'Completed') return 'green'
  if (s === 'Scheduled') return 'amber'
  if (s === 'In Progress') return 'amber'
  if (s === 'Failed') return 'rose'
  return 'slate'
}

/* ── module: fee defaulters + AI parent calls ───────────── */

export function FeeDefaultersAndCallsMod() {
  const { db, user, update } = useStore()
  const [tab, setTab] = useState<'defaulters' | 'calls'>('defaulters')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState<User | null>(null)

  const [reason, setReason] = useState<AIParentCall['reason']>('fee')
  const [language, setLanguage] = useState('English')
  const [scheduledAt, setScheduledAt] = useState('')
  const [transcriptOpen, setTranscriptOpen] = useState<AIParentCall | null>(null)

  const [statusFilter, setStatusFilter] = useState<AIParentCallStatus | 'all'>('all')
  const [studentFilter, setStudentFilter] = useState<string>('all')
  const [requesterFilter, setRequesterFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState('')

  const canView = user && canViewFeeDefaulters(user)

  const { guardians, wardsOf, classes, currentYear } = useAcademic()

  const students = useMemo(() => db.users.filter(u => u.role === 'student'), [db.users])
  const parents = useMemo(() => db.users.filter(u => u.role === 'parent'), [db.users])

  // guardian link first, then the legacy parentEmail / title heuristics
  const parentOf = useMemo(() => (s: User): User | undefined => {
    const g = guardians.find(x => x.studentId === s.id)
    return (g && parents.find(p => p.id === g.parentId))
      ?? parents.find(p => !!s.parentEmail && p.email === s.parentEmail)
      ?? parents.find(p => p.title.includes(s.name))
  }, [guardians, parents])

  // Derived defaulters from the server, filtered by term (context) and an optional class.
  const { term } = useActiveTerm()
  const [classId, setClassId] = useState('')
  const classList = useMemo(() => classes.filter(c => !currentYear || c.academicYearId === currentYear.id).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })), [classes, currentYear])
  const defaulters = useDefaulters({ termId: term || undefined, classId: classId || undefined }, !!canView && tab === 'defaulters')

  const groups = useMemo(() => {
    const map: Record<string, FeeDefaulter[]> = {}
    ;(defaulters.items ?? []).forEach(d => { (map[d.classLabel || 'Unassigned'] ??= []).push(d) })
    Object.values(map).forEach(list => list.sort((a, b) => b.outstanding - a.outstanding))
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  }, [defaulters.items])
  const totalOutstanding = (defaulters.items ?? []).reduce((a, d) => a + d.outstanding, 0)

  // Send reminder: pick the oldest overdue invoice (from the row when the server attaches them, else fetched).
  const [reminder, setReminder] = useState<FeeDefaulter | null>(null)
  const [channel, setChannel] = useState<ReminderChannel>('InApp')
  const [reminderNote, setReminderNote] = useState('')
  const [sending, setSending] = useState(false)
  const openReminder = (d: FeeDefaulter) => { setReminder(d); setChannel('InApp'); setReminderNote(''); }
  const sendReminder = async () => {
    if (!reminder) return
    setSending(true)
    try {
      let invoiceId = [...(reminder.invoices ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.id
      if (!invoiceId) {
        const res = await api.get<{ items?: FeeInvoice[] } | FeeInvoice[]>(`/fees/invoices?studentId=${encodeURIComponent(reminder.studentId)}`)
        const today = isoDate(new Date())
        const open = (Array.isArray(res) ? res : res.items ?? []).filter(i => isOutstanding(i) && outstandingOf(i) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        invoiceId = (open.find(i => i.dueDate < today) ?? open[0])?.id
      }
      if (!invoiceId) { toast.error('No outstanding invoice found for this student'); return }
      await api.post('/fees/reminders', { invoiceId, channel, note: reminderNote.trim() || undefined })
      toast.success(`Reminder sent to ${reminder.parent?.name ?? reminder.name} via ${CHANNELS.find(c => c.value === channel)?.label ?? channel}`)
      setReminder(null)
      defaulters.reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setSending(false) }
  }

  const filteredCalls = useMemo(() => {
    let calls = [...db.aiParentCalls]
    if (user?.role === 'student') calls = calls.filter(c => c.studentId === user.id)
    if (user?.role === 'parent') {
      const wards = wardsOf(user.id)
      calls = calls.filter(c => c.parentId === user.id || wards.includes(c.studentId) || c.studentName.includes(user.name.split(' ').slice(-1)[0] ?? ''))
    }
    if (statusFilter !== 'all') calls = calls.filter(c => c.status === statusFilter)
    if (studentFilter !== 'all') calls = calls.filter(c => c.studentId === studentFilter)
    if (requesterFilter !== 'all') calls = calls.filter(c => c.requesterId === requesterFilter)
    if (dateFilter) {
      const d = new Date(dateFilter).toISOString().slice(0, 10)
      calls = calls.filter(c => c.scheduledAt.startsWith(d) || c.createdAt === d)
    }
    return calls.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
  }, [db.aiParentCalls, user, wardsOf, statusFilter, studentFilter, requesterFilter, dateFilter])

  const uniqueRequesters = useMemo(() => {
    const map = new Map<string, string>()
    db.aiParentCalls.forEach(c => map.set(c.requesterId, c.requesterName))
    return [...map.entries()]
  }, [db.aiParentCalls])

  const deleteCall = (id: string) => {
    update(d => { d.aiParentCalls = d.aiParentCalls.filter(c => c.id !== id); return d })
    toast.success('Call log removed')
  }

  const scheduleCall = () => {
    if (!selectedStudent || !scheduledAt) return
    const parent = parentOf(selectedStudent)
    if (!parent) return toast.error('No parent contact found')
    const call: AIParentCall = {
      id: 'ac_' + tsId(),
      studentId: selectedStudent.id,
      studentName: selectedStudent.name,
      parentId: parent.id,
      parentName: parent.name,
      requesterId: user!.id,
      requesterRole: user!.role as Role,
      requesterName: user!.name,
      reason,
      reasonText: reasonText(reason),
      language,
      scheduledAt: new Date(scheduledAt).toISOString(),
      status: 'Scheduled',
      createdAt: new Date().toISOString().slice(0, 10),
    }
    update(d => { d.aiParentCalls.unshift(call); return d })
    setScheduleOpen(false)
    setScheduledAt('')
    toast.success('AI parent call scheduled')
  }

  const openSchedule = (d: FeeDefaulter) => {
    const student = students.find(s => s.id === d.studentId)
    if (!student) return toast.error('Student record not found')
    setSelectedStudent(student)
    setReason('fee')
    setLanguage('English')
    setScheduledAt('')
    setScheduleOpen(true)
  }

  if (!canView) {
    return (
      <div>
        <PageHead title="Fee Defaulters & AI Parent Calls" sub="Restricted view" />
        <Card><Empty text="You do not have permission to view this module." /></Card>
      </div>
    )
  }

  return (
    <div>
      <PageHead title="Fee Defaulters & AI Parent Calls" sub="Overdue invoices, reminders and the parent-call log">
        <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
          {(['defaulters', 'calls'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${tab === t ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
              {t === 'defaulters' ? 'Defaulters' : 'Call Logs'}
            </button>
          ))}
        </div>
      </PageHead>

      {tab === 'defaulters' ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Class">
              <select value={classId} onChange={e => setClassId(e.target.value)} className={`${inputCls} w-auto min-w-[150px]`}>
                <option value="">All classes</option>
                {classList.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <span className="flex-1" />
            {(defaulters.items?.length ?? 0) > 0 && <Pill tone="rose">{defaulters.items!.length} defaulter{defaulters.items!.length === 1 ? '' : 's'} · {fmtINR(totalOutstanding)} overdue</Pill>}
          </div>
          {defaulters.loading ? <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading defaulters…</div>
            : defaulters.error ? <Empty text={defaulters.error} />
            : groups.length === 0 && <Empty text="No overdue invoices — every fee is on time." />}
          {groups.map(([cls, items]) => (
            <Card key={cls} className="p-0">
              <div className="flex items-center justify-between border-b border-black/[.06] dark:border-white/[.08] px-6 py-4">
                <p className="text-[14px] font-bold">Class {cls}</p>
                <Pill tone="amber">{items.length} defaulter{items.length === 1 ? '' : 's'} · {fmtINR(items.reduce((a, d) => a + d.outstanding, 0))}</Pill>
              </div>
              <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
                {items.map(d => {
                  const parent = d.parent ?? (() => { const s = students.find(x => x.id === d.studentId); return s ? parentOf(s) : undefined })()
                  return (
                    <div key={d.studentId} className="flex flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[15px] font-semibold">{d.name}</p>
                          <Pill tone="rose">{fmtINR(d.outstanding)} outstanding</Pill>
                          <Pill tone={d.reminders > 0 ? 'indigo' : 'slate'}><MessageSquare size={11} /> {d.reminders} reminder{d.reminders === 1 ? '' : 's'}</Pill>
                        </div>
                        <p className="mt-1 text-[12.5px] text-black/50 dark:text-white/50">
                          Oldest due {fmtDate(d.oldestDue, { day: 'numeric', month: 'short', year: 'numeric' })}
                          {d.invoices?.length ? ` · ${d.invoices.length} overdue invoice${d.invoices.length === 1 ? '' : 's'}` : ''}
                        </p>
                        <p className="mt-0.5 text-[12.5px] text-black/50 dark:text-white/50">
                          Parent: {parent?.name ?? '–'} · {parent?.phone ?? 'No phone'}{parent?.email ? ` · ${parent.email}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => openReminder(d)}
                          className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-700">
                          <MessageSquare size={13} /> Send reminder
                        </button>
                        <button onClick={() => openSchedule(d)}
                          className="flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                          <Calendar size={13} /> Schedule call
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-black/[.06] dark:border-white/[.08] px-6 py-4">
            <Filter size={16} className="text-black/40 dark:text-white/40" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as AIParentCallStatus | 'all')} className={`${inputCls} w-32 py-1.5 text-[12.5px]`}>
              <option value="all">All statuses</option>
              <option value="Scheduled">Scheduled</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
              <option value="Failed">Failed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
            <select value={studentFilter} onChange={e => setStudentFilter(e.target.value)} className={`${inputCls} w-40 py-1.5 text-[12.5px]`}>
              <option value="all">All students</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={requesterFilter} onChange={e => setRequesterFilter(e.target.value)} className={`${inputCls} w-40 py-1.5 text-[12.5px]`}>
              <option value="all">All requesters</option>
              {uniqueRequesters.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className={`${inputCls} w-36 py-1.5 text-[12.5px]`} />
          </div>
          <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
            {filteredCalls.length === 0 && <div className="p-6"><Empty text="No calls match the filters." /></div>}
            {filteredCalls.map(c => (
              <div key={c.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[14.5px] font-semibold">{c.studentName}</p>
                    <Pill tone={aiCallStatusTone(c.status)}>{c.status}</Pill>
                    {c.outcome && <Pill tone="slate">{c.outcome}</Pill>}
                  </div>
                  <p className="mt-1 text-[12.5px] text-black/50 dark:text-white/50">
                    {reasonText(c.reason)} · {c.language} · requested by {c.requesterName}
                  </p>
                  <p className="text-[12px] text-black/40 dark:text-white/40">
                    Scheduled {new Date(c.scheduledAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {c.duration ? ` · ${Math.floor(c.duration / 60)}m ${c.duration % 60}s` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setTranscriptOpen(c)}
                    className="flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                    <UserIcon size={13} /> View transcript
                  </button>
                  {isAdmin(user) && (
                    <button onClick={() => deleteCall(c.id)}
                      className="flex items-center gap-1.5 rounded-full bg-rose-50 px-3.5 py-2 text-[12.5px] font-semibold text-rose-500 hover:bg-rose-100">
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} title={`Schedule AI call — ${selectedStudent?.name ?? ''}`}>
        <div className="space-y-4">
          <Field label="Reason">
            <select value={reason} onChange={e => setReason(e.target.value as AIParentCall['reason'])} className={inputCls}>
              {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Language">
            <select value={language} onChange={e => setLanguage(e.target.value)} className={inputCls}>
              {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Preferred time">
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className={inputCls} />
          </Field>
          <button onClick={scheduleCall} disabled={!scheduledAt} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Schedule call</button>
        </div>
      </Modal>

      <Modal open={!!reminder} onClose={() => { if (!sending) setReminder(null) }} title={`Send reminder — ${reminder?.name ?? ''}`}>
        {reminder && (
          <div className="space-y-4">
            <p className="text-[13.5px] text-black/60 dark:text-white/60">
              {fmtINR(reminder.outstanding)} overdue since {fmtDate(reminder.oldestDue, { day: 'numeric', month: 'short', year: 'numeric' })} · {reminder.reminders} reminder{reminder.reminders === 1 ? '' : 's'} sent so far
            </p>
            <Field label="Channel">
              <select value={channel} onChange={e => setChannel(e.target.value as ReminderChannel)} className={inputCls}>
                {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Note (optional)">
              <textarea value={reminderNote} onChange={e => setReminderNote(e.target.value)} rows={3} placeholder="Added to the reminder, e.g. a payment plan offer" className={inputCls} />
            </Field>
            <button onClick={sendReminder} disabled={sending} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{sending ? 'Sending…' : 'Send reminder'}</button>
          </div>
        )}
      </Modal>

      <Modal open={!!transcriptOpen} onClose={() => setTranscriptOpen(null)} title={transcriptOpen ? `Call transcript — ${transcriptOpen.studentName}` : 'Call transcript'}>
        {transcriptOpen && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-black/50 dark:text-white/50">
              <span className="flex items-center gap-1"><Clock size={12} /> {transcriptOpen.status}</span>
              <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(transcriptOpen.scheduledAt).toLocaleString('en-IN')}</span>
              {transcriptOpen.duration && <span className="flex items-center gap-1"><Phone size={12} /> {Math.floor(transcriptOpen.duration / 60)}m {transcriptOpen.duration % 60}s</span>}
              {transcriptOpen.outcome && <Pill tone="slate">{transcriptOpen.outcome}</Pill>}
            </div>
            <div className="max-h-[50vh] overflow-y-auto rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4 text-[13.5px] leading-relaxed whitespace-pre-line text-black/70 dark:text-white/70 thin-scroll">
              {transcriptOpen.transcript ?? 'Transcript not available.'}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
