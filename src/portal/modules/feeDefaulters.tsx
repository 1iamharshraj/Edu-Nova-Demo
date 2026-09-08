import { useMemo, useState } from 'react'
import { Clock, Filter, MessageSquare, Phone, PhoneCall } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { canViewFeeDefaulters } from '@/lib/access'
import { compareClasses, fmtINR, type CallOutcome, type CallReason, type FeeDefaulter, type FeeInvoice, type ReminderChannel } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { isoDate } from '@/lib/hooks/useTimetable'
import { isOutstanding, outstandingOf, useDefaulters } from '@/lib/hooks/useFinance'
import { CALL_OUTCOMES, CALL_REASONS, callOutcomeTone, useCallLog } from '@/lib/hooks/useWelfare'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { useActiveTerm } from './viewer'

// Defaulters are derived server-side (`GET /fees/defaulters`); reminders are real rows (`POST /fees/reminders`).
// The call log (Phase 8) replaces the old AI parent-call simulation entirely: staff/teacher/admin record a real
// call they made, and everyone who could see it before can look up the history per student. See phase-8-welfare.md

const CHANNELS: { value: ReminderChannel; label: string }[] = [{ value: 'InApp', label: 'In-app notification' }, { value: 'Email', label: 'Email' }, { value: 'SMS', label: 'SMS' }]

/* ── module: fee defaulters + call log ──────────────────── */

export function FeeDefaultersAndCallsMod() {
  const { user } = useStore()
  const [tab, setTab] = useState<'defaulters' | 'calls'>('defaulters')
  const [callLogFor, setCallLogFor] = useState<{ id: string; name: string } | null>(null)

  const canView = user && canViewFeeDefaulters(user)

  const { classes, currentYear, gradeById } = useAcademic()

  const { term } = useActiveTerm()
  const [classId, setClassId] = useState('')
  const classList = useMemo(() => classes.filter(c => !currentYear || c.academicYearId === currentYear.id).sort(compareClasses(gradeById)), [classes, currentYear, gradeById])
  const defaulters = useDefaulters({ termId: term || undefined, classId: classId || undefined }, !!canView && tab === 'defaulters')

  // Group order follows the same class label → grade-order lookup as the picker above, so a full I–XII
  // school's defaulter groups read in real academic order instead of alphabetically on the Roman numeral.
  const labelOrder = useMemo(() => new Map(classes.map(c => [c.label, gradeById.get(c.gradeId)?.order ?? 0])), [classes, gradeById])
  const groups = useMemo(() => {
    const map: Record<string, FeeDefaulter[]> = {}
    ;(defaulters.items ?? []).forEach(d => { (map[d.classLabel || 'Unassigned'] ??= []).push(d) })
    Object.values(map).forEach(list => list.sort((a, b) => b.outstanding - a.outstanding))
    return Object.entries(map).sort((a, b) => (labelOrder.get(a[0]) ?? 0) - (labelOrder.get(b[0]) ?? 0) || a[0].localeCompare(b[0], undefined, { numeric: true }))
  }, [defaulters.items, labelOrder])
  const totalOutstanding = (defaulters.items ?? []).reduce((a, d) => a + d.outstanding, 0)

  // Send reminder: pick the oldest overdue invoice (from the row when the server attaches them, else fetched).
  const [reminder, setReminder] = useState<FeeDefaulter | null>(null)
  const [channel, setChannel] = useState<ReminderChannel>('InApp')
  const [reminderNote, setReminderNote] = useState('')
  const [sending, setSending] = useState(false)
  const openReminder = (d: FeeDefaulter) => { setReminder(d); setChannel('InApp'); setReminderNote('') }
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

  if (!canView) {
    return (
      <div>
        <PageHead title="Fee Defaulters & Call Log" sub="Restricted view" />
        <Card><Empty text="You do not have permission to view this module." /></Card>
      </div>
    )
  }

  return (
    <div>
      <PageHead title="Fee Defaulters & Call Log" sub="Overdue invoices, reminders and the parent call log">
        <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
          {(['defaulters', 'calls'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${tab === t ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
              {t === 'defaulters' ? 'Defaulters' : 'Call Log'}
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
                {items.map(d => (
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
                        Parent: {d.parent?.name ?? '–'} · {d.parent?.phone ?? 'No phone'}{d.parent?.email ? ` · ${d.parent.email}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => openReminder(d)}
                        className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-700">
                        <MessageSquare size={13} /> Send reminder
                      </button>
                      <button onClick={() => setCallLogFor({ id: d.studentId, name: d.name })}
                        className="flex items-center gap-1.5 rounded-full bg-black/[.06] dark:bg-white/[.08] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                        <PhoneCall size={13} /> Call log
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <CallLogBrowser />
      )}

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

      <CallLogModal student={callLogFor} onClose={() => setCallLogFor(null)} />
    </div>
  )
}

/* ── call log: record a real call, browse by student ────── */

function CallLogModal({ student, onClose }: { student: { id: string; name: string } | null; onClose: () => void }) {
  const [reason, setReason] = useState<CallReason>('fee')
  const [summary, setSummary] = useState('')
  const [outcome, setOutcome] = useState<CallOutcome>('confirmed')
  const [durationMin, setDurationMin] = useState('')
  const [calledAt, setCalledAt] = useState(() => isoDate(new Date()))
  const [busy, setBusy] = useState(false)
  const { items: history, loading, reload } = useCallLog(student?.id, !!student)
  const sortedHistory = useMemo(() => [...(history ?? [])].sort((a, b) => b.calledAt.localeCompare(a.calledAt)), [history])

  const reset = () => { setReason('fee'); setSummary(''); setOutcome('confirmed'); setDurationMin(''); setCalledAt(isoDate(new Date())) }

  const save = async () => {
    if (!student || !summary.trim()) return
    setBusy(true)
    try {
      await api.post('/calls', {
        studentId: student.id, reason, summary: summary.trim(), outcome,
        calledAt: new Date(calledAt).toISOString(), durationMin: durationMin ? Number(durationMin) : undefined,
      })
      reset()
      reload()
      toast.success('Call logged')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={!!student} onClose={() => { onClose(); reset() }} title={`Call log — ${student?.name ?? ''}`} wide>
      {student && (
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-4">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Record a call</p>
            <Field label="Reason">
              <select value={reason} onChange={e => setReason(e.target.value as CallReason)} className={inputCls}>
                {CALL_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Summary"><textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3} placeholder="What was discussed…" className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Outcome">
                <select value={outcome} onChange={e => setOutcome(e.target.value as CallOutcome)} className={inputCls}>
                  {CALL_OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Duration (min)"><input type="number" min={0} value={durationMin} onChange={e => setDurationMin(e.target.value)} placeholder="optional" className={inputCls} /></Field>
            </div>
            <Field label="Date"><input type="date" value={calledAt} onChange={e => setCalledAt(e.target.value)} className={inputCls} /></Field>
            <button onClick={save} disabled={!summary.trim() || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Log call'}</button>
          </div>
          <div>
            <p className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Call history</p>
            <div className="max-h-[26rem] space-y-2.5 overflow-y-auto thin-scroll">
              {loading && <p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p>}
              {!loading && sortedHistory.length === 0 && <Empty text="No calls logged for this student yet." />}
              {sortedHistory.map(c => (
                <div key={c.id} className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13.5px] font-semibold capitalize">{c.reason}</p>
                    <Pill tone={callOutcomeTone(c.outcome)}>{CALL_OUTCOMES.find(o => o.value === c.outcome)?.label ?? c.outcome}</Pill>
                  </div>
                  <p className="mt-1 text-[12.5px] text-black/60 dark:text-white/60">{c.summary}</p>
                  <p className="mt-1.5 flex items-center gap-2 text-[11.5px] text-black/40 dark:text-white/40">
                    <Clock size={11} /> {fmtDate(c.calledAt, { day: 'numeric', month: 'short', year: 'numeric' })} · by {c.byName ?? c.byId}
                    {c.durationMin ? ` · ${c.durationMin}m` : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Standalone "Call Log" tab: pick a student, see (and add to) their call history. */
function CallLogBrowser() {
  const { db } = useStore()
  const { classOf } = useAcademic()
  const [studentId, setStudentId] = useState('')
  const [statusFilter, setStatusFilter] = useState<CallOutcome | 'all'>('all')
  const students = useMemo(() => [...db.users.filter(u => u.role === 'student')].sort((a, b) => a.name.localeCompare(b.name)), [db.users])
  const student = students.find(s => s.id === studentId)
  const { items, loading, error } = useCallLog(studentId, !!studentId)
  const filtered = useMemo(() => {
    const list = [...(items ?? [])].sort((a, b) => b.calledAt.localeCompare(a.calledAt))
    return statusFilter === 'all' ? list : list.filter(c => c.outcome === statusFilter)
  }, [items, statusFilter])

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-black/[.06] dark:border-white/[.08] px-6 py-4">
        <Filter size={16} className="text-black/40 dark:text-white/40" />
        <select value={studentId} onChange={e => setStudentId(e.target.value)} className={`${inputCls} w-52 py-1.5 text-[12.5px]`}>
          <option value="">Choose a student…</option>
          {students.map(s => <option key={s.id} value={s.id}>{s.name}{classOf(s.id) ? ` · ${classOf(s.id)!.label}` : ''}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as CallOutcome | 'all')} className={`${inputCls} w-44 py-1.5 text-[12.5px]`}>
          <option value="all">All outcomes</option>
          {CALL_OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
        {!studentId && <div className="p-6"><Empty text="Pick a student to see their call history." /></div>}
        {studentId && loading && <div className="p-6 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</div>}
        {studentId && error && <div className="p-6"><Empty text={error} /></div>}
        {studentId && !loading && !error && filtered.length === 0 && <div className="p-6"><Empty text="No calls match the filters." /></div>}
        {filtered.map(c => (
          <div key={c.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-[14.5px] font-semibold">{student?.name}</p>
                <Pill tone={callOutcomeTone(c.outcome)}>{CALL_OUTCOMES.find(o => o.value === c.outcome)?.label ?? c.outcome}</Pill>
              </div>
              <p className="mt-1 text-[12.5px] text-black/50 dark:text-white/50 capitalize">{c.reason} · {c.summary}</p>
              <p className="text-[12px] text-black/40 dark:text-white/40 flex items-center gap-1.5">
                <Phone size={11} /> {fmtDate(c.calledAt, { day: 'numeric', month: 'short', year: 'numeric' })} · logged by {c.byName ?? c.byId}
                {c.durationMin ? ` · ${c.durationMin}m` : ''}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
