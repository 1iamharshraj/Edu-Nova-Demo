import { useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { Card, Empty, PageHead, Pill, inputCls } from '@/portal/ui'
import { LEAD_STATUSES, addLeadNote, enrollLead, errorMessage, leadStatusTone, updateLeadStatus, useLead } from '@/lib/hooks/useLeads'
import { useAcademic, useStore } from '@/lib/store'
import { PortalPageShell } from './PortalPageShell'

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: lead, loading, error, reload } = useLead(id)
  const { classes } = useAcademic()
  const { refreshDB, refreshAcademic } = useStore()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [batchId, setBatchId] = useState('')
  const [credentials, setCredentials] = useState<{ email: string; password: string; batch: string } | null>(null)

  const changeStatus = async (next: string) => {
    if (!lead) return
    try {
      await updateLeadStatus(lead.id, next as never)
      toast.success(`Status updated to ${next}`)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const submitNote = async () => {
    if (!lead || !note.trim()) return
    setBusy(true)
    try {
      await addLeadNote(lead.id, note.trim())
      setNote('')
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const doEnroll = async () => {
    if (!lead || !batchId) return
    setBusy(true)
    try {
      const res = await enrollLead(lead.id, batchId)
      setCredentials({ email: res.email, password: res.password, batch: res.batch })
      toast.success(`${lead.name} enrolled into ${res.batch}`)
      reload()
      await Promise.all([refreshDB(), refreshAcademic()])
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PortalPageShell backLabel="Back to leads">
      {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading lead…</p>}
      {!loading && (error || !lead) && <Empty text={error || 'Lead not found.'} />}
      {!loading && lead && (
        <>
          <PageHead title={lead.name} sub={`${lead.source}${lead.campaign ? ` · ${lead.campaign}` : ''} · enquired ${fmtDateTime(lead.createdAt)}`}>
            <Pill tone={leadStatusTone(lead.status)}>{lead.status}</Pill>
          </PageHead>

          <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
            <div className="space-y-5">
              <Card className="p-5">
                <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-black/40 dark:text-white/40">Contact</h3>
                <div className="space-y-2 text-[13.5px]">
                  <p><span className="text-black/45 dark:text-white/45">Phone</span> <span className="float-right font-medium">{lead.phone}</span></p>
                  {lead.email && <p><span className="text-black/45 dark:text-white/45">Email</span> <span className="float-right font-medium">{lead.email}</span></p>}
                  <p><span className="text-black/45 dark:text-white/45">Interested in</span> <span className="float-right font-medium text-right">{lead.interestedCourse || '—'}</span></p>
                  {lead.assignedToName && <p><span className="text-black/45 dark:text-white/45">Assigned to</span> <span className="float-right font-medium">{lead.assignedToName}</span></p>}
                  {lead.importBatch && <p><span className="text-black/45 dark:text-white/45">Import batch</span> <span className="float-right font-medium">{lead.importBatch}</span></p>}
                </div>
              </Card>

              <Card className="p-5">
                <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-black/40 dark:text-white/40">Pipeline status</h3>
                <select className={inputCls} value={lead.status} onChange={e => changeStatus(e.target.value)}>
                  {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Card>

              {lead.convertedStudentId ? (
                <Card className="p-5">
                  <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-black/40 dark:text-white/40">Enrollment</h3>
                  <p className="text-[13.5px] font-medium text-emerald-600 dark:text-emerald-400">Enrolled in {lead.enrolledBatch ?? 'a batch'}.</p>
                  {credentials && (
                    <div className="mt-3 rounded-xl bg-black/[.03] dark:bg-white/[.05] p-3 text-[12.5px]">
                      <p className="font-semibold">Student login (share with the student)</p>
                      <p className="mt-1 font-mono">{credentials.email}</p>
                      <p className="font-mono">{credentials.password}</p>
                    </div>
                  )}
                </Card>
              ) : lead.status === 'Enrolled' ? (
                <Card className="p-5">
                  <p className="text-[13.5px] font-medium text-emerald-600 dark:text-emerald-400">Marked as enrolled.</p>
                </Card>
              ) : lead.status === 'Lost' ? null : (
                <Card className="p-5">
                  <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-black/40 dark:text-white/40">Enroll into a batch</h3>
                  <p className="mb-3 text-[12.5px] text-black/50 dark:text-white/50">Creates the student's login and adds them to the batch roster, timetable and attendance.</p>
                  <select className={`${inputCls} mb-3`} value={batchId} onChange={e => setBatchId(e.target.value)} aria-label="Batch">
                    <option value="">Choose a batch…</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <button onClick={doEnroll} disabled={busy || !batchId} className="btn-ink w-full py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
                    {busy ? 'Enrolling…' : 'Enroll student'}
                  </button>
                </Card>
              )}
            </div>

            <Card className="p-5">
              <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-black/40 dark:text-white/40">Activity</h3>
              <div className="mb-4 flex gap-2">
                <input className={inputCls} placeholder="Log a call, note, or update…" value={note} onChange={e => setNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitNote() }} />
                <button onClick={submitNote} disabled={busy || !note.trim()} className="btn-ink px-4 py-2 text-[13.5px] font-semibold disabled:opacity-40">Add</button>
              </div>
              {lead.notes.length === 0 ? (
                <p className="text-[13px] text-black/40 dark:text-white/40">No activity logged yet.</p>
              ) : (
                <div className="space-y-3">
                  {[...lead.notes].reverse().map((n, i) => (
                    <div key={i} className="border-l-2 border-black/10 dark:border-white/15 pl-3">
                      <p className="text-[13.5px]">{n.text}</p>
                      <p className="mt-0.5 text-[11.5px] text-black/40 dark:text-white/40">{n.by} · {fmtDateTime(n.at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </PortalPageShell>
  )
}
