import { useMemo, useState } from 'react'
import { Calendar, Clock, Filter, MessageSquare, Phone, Trash2, User as UserIcon } from 'lucide-react'
import { useStore } from '@/lib/store'
import { canViewFeeDefaulters, isAdmin } from '@/lib/access'
import { fmtINR, type AIParentCall, type AIParentCallStatus, type Role, type User } from '@/lib/data'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { toast } from 'sonner'

/* ── helpers ───────────────────────────────────────────── */

const REASONS: { value: AIParentCall['reason']; label: string }[] = [
  { value: 'fee', label: 'Fee due' },
  { value: 'attendance', label: 'Attendance concern' },
  { value: 'disciplinary', label: 'Disciplinary issue' },
  { value: 'general', label: 'General follow-up' },
]

const LANGUAGES = ['English', 'Hindi', 'Malayalam']

const OUTCOMES: AIParentCall['outcome'][] = ['confirmed', 'callback', 'unreachable', 'refused']

const tsId = () => Date.now()
const randDuration = () => Math.floor(60 + Math.random() * 120)
const randOutcome = () => OUTCOMES[Math.floor(Math.random() * OUTCOMES.length)]

function reasonText(reason: AIParentCall['reason']) {
  switch (reason) {
    case 'fee': return 'Fee payment reminder and follow-up'
    case 'attendance': return 'Discuss recent absenteeism'
    case 'disciplinary': return 'Discuss disciplinary matter'
    default: return 'General wellness check'
  }
}

function makeTranscript(student: string, parent: string, reason: AIParentCall['reason'], language: string) {
  const greeting = language === 'Hindi' ? 'नमस्ते' : language === 'Malayalam' ? 'നമസ്കാരം' : 'Hello'
  const school = 'EduNova School'
  const lines: string[] = []
  lines.push(`AI: ${greeting}, this is ${school} calling for ${parent} regarding ${student}.`)
  if (reason === 'fee') {
    lines.push(`AI: We wanted to remind you that a fee component is currently outstanding for ${student}.`)
    lines.push(`Parent: I see. Can I pay online next week?`)
    lines.push(`AI: Yes, the portal is open. Would you like an SMS reminder?`)
  } else if (reason === 'attendance') {
    lines.push(`AI: ${student} has been absent for three consecutive school days. Is everything okay?`)
    lines.push(`Parent: ${student} had a fever; I will send the medical certificate tomorrow.`)
    lines.push(`AI: Thank you, please upload it through the parent portal.`)
  } else if (reason === 'disciplinary') {
    lines.push(`AI: We would like to discuss a recent incident involving ${student} with the class teacher.`)
    lines.push(`Parent: Can we schedule a meeting this Friday?`)
    lines.push(`AI: Friday 4:00 PM works. A calendar invite will be sent.`)
  } else {
    lines.push(`AI: This is a quick check-in to see if ${student} needs any academic support this term.`)
    lines.push(`Parent: ${student} is doing fine, thank you for asking.`)
  }
  lines.push(`AI: Thank you for your time. Goodbye.`)
  return lines.join('\n')
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

  const students = useMemo(() => db.users.filter(u => u.role === 'student'), [db.users])
  const parents = useMemo(() => db.users.filter(u => u.role === 'parent'), [db.users])

  const defaulters = useMemo(() => {
    return students
      .map(s => {
        const dues = db.receipts.filter(r => r.kind === 'fee' && r.status === 'Due' && r.studentId === s.id)
        const paid = db.receipts.filter(r => r.kind === 'fee' && r.status === 'Paid' && r.studentId === s.id)
        const lastPaid = paid.length > 0 ? paid.sort((a, b) => b.date.localeCompare(a.date))[0].date : null
        const parent = parents.find(p => p.email === s.parentEmail) ?? parents.find(p => p.title.includes(s.name))
        return { student: s, dues, totalDue: dues.reduce((a, r) => a + r.amount, 0), lastPaid, parent }
      })
      .filter(d => d.dues.length > 0)
      .sort((a, b) => b.totalDue - a.totalDue)
  }, [students, parents, db.receipts])

  const groups = useMemo(() => {
    const map: Record<string, typeof defaulters> = {}
    defaulters.forEach(d => { (map[d.student.class ?? 'Unassigned'] ??= []).push(d) })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
  }, [defaulters])

  const filteredCalls = useMemo(() => {
    let calls = [...db.aiParentCalls]
    if (user?.role === 'student') calls = calls.filter(c => c.studentId === user.id)
    if (user?.role === 'parent') calls = calls.filter(c => c.parentId === user.id || c.studentName.includes(user.name.split(' ').slice(-1)[0] ?? ''))
    if (statusFilter !== 'all') calls = calls.filter(c => c.status === statusFilter)
    if (studentFilter !== 'all') calls = calls.filter(c => c.studentId === studentFilter)
    if (requesterFilter !== 'all') calls = calls.filter(c => c.requesterId === requesterFilter)
    if (dateFilter) {
      const d = new Date(dateFilter).toISOString().slice(0, 10)
      calls = calls.filter(c => c.scheduledAt.startsWith(d) || c.createdAt === d)
    }
    return calls.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
  }, [db.aiParentCalls, user, statusFilter, studentFilter, requesterFilter, dateFilter])

  const uniqueRequesters = useMemo(() => {
    const map = new Map<string, string>()
    db.aiParentCalls.forEach(c => map.set(c.requesterId, c.requesterName))
    return [...map.entries()]
  }, [db.aiParentCalls])

  const simulateCall = (student: User, parent: User | undefined, r: AIParentCall['reason']) => {
    if (!parent) return toast.error('No parent contact found')
    const call: AIParentCall = {
      id: 'ac_' + tsId(),
      studentId: student.id,
      studentName: student.name,
      parentId: parent.id,
      parentName: parent.name,
      requesterId: user!.id,
      requesterRole: user!.role as Role,
      requesterName: user!.name,
      reason: r,
      reasonText: reasonText(r),
      language: 'English',
      scheduledAt: new Date().toISOString(),
      status: 'Completed',
      duration: randDuration(),
      transcript: makeTranscript(student.name, parent.name, r, 'English'),
      outcome: randOutcome(),
      createdAt: new Date().toISOString().slice(0, 10),
    }
    update(d => { d.aiParentCalls.unshift(call); return d })
    toast.success(`AI call completed — spoke to ${parent.name}`)
  }

  const deleteCall = (id: string) => {
    update(d => { d.aiParentCalls = d.aiParentCalls.filter(c => c.id !== id); return d })
    toast.success('Call log removed')
  }

  const scheduleCall = () => {
    if (!selectedStudent || !scheduledAt) return
    const parent = parents.find(p => p.email === selectedStudent.parentEmail) ?? parents.find(p => p.title.includes(selectedStudent.name))
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

  const openSchedule = (student: User) => {
    setSelectedStudent(student)
    setReason('fee')
    setLanguage('English')
    setScheduledAt('')
    setScheduleOpen(true)
  }

  const sendReminder = (student: User, parent: User | undefined) => {
    toast.success(`Reminder sent to ${parent?.name ?? student.name}`)
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
      <PageHead title="Fee Defaulters & AI Parent Calls" sub="Track dues, simulate calls and review AI parent-call logs">
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
          {groups.length === 0 && <Empty text="No fee defaulters this term." />}
          {groups.map(([cls, items]) => (
            <Card key={cls} className="p-0">
              <div className="flex items-center justify-between border-b border-black/[.06] dark:border-white/[.08] px-6 py-4">
                <p className="text-[14px] font-bold">Class {cls}</p>
                <Pill tone="amber">{items.length} defaulter{items.length === 1 ? '' : 's'} · {fmtINR(items.reduce((a, d) => a + d.totalDue, 0))}</Pill>
              </div>
              <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
                {items.map(({ student, dues, totalDue, lastPaid, parent }) => (
                  <div key={student.id} className="flex flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold">{student.name}</p>
                      <p className="mt-1 text-[12.5px] text-black/50 dark:text-white/50">
                        Roll {student.roll ?? '–'} · {dues.length} due component{dues.length === 1 ? '' : 's'} · total {fmtINR(totalDue)}
                      </p>
                      <p className="mt-1 text-[12.5px] text-black/50 dark:text-white/50">
                        Parent: {parent?.name ?? '–'} · {parent?.phone ?? 'No phone'}
                      </p>
                      <p className="mt-0.5 text-[12px] text-black/40 dark:text-white/40">
                        Last paid: {lastPaid ? new Date(lastPaid).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => simulateCall(student, parent, 'fee')}
                        className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-700">
                        <Phone size={13} /> Call now
                      </button>
                      <button onClick={() => openSchedule(student)}
                        className="flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                        <Calendar size={13} /> Schedule AI
                      </button>
                      <button onClick={() => sendReminder(student, parent)}
                        className="flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                        <MessageSquare size={13} /> Reminder
                      </button>
                    </div>
                  </div>
                ))}
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
