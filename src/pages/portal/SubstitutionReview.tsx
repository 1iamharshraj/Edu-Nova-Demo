import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { AlertTriangle, CheckCircle2, Lock, ShieldAlert, Sparkles, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import type { SubstitutionApprovalResult } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { DAY_LABELS } from '@/lib/hooks/useTimetable'
import { useLeaveRequests, leaveStatusLabel, leaveTone, leaveTypeName, useLeaveTypes } from '@/lib/hooks/useHr'
import { noticeHours, useSubstitutionPolicy, useSubstitutionRequests } from '@/lib/hooks/useSubstitution'
import { SubstituteFinderModal, SubstitutionStatusList } from '@/portal/modules/substitutionFinder'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Phase T9 §4 — the admin-facing substitution review/approve screen. UX-fit call (per roadmap D9): this is a
// dedicated routed page, not a modal off Leave Approvals — the same reasoning already applied to Application
// Detail (T2), TC Issuance (T2) and Sectioning Draft Review (T3). This screen is genuinely multi-state
// (outstanding SENT/ACCEPTED substitution requests, emergency vs. arranged, force-override with a mandatory
// audit note, then approve → hold-lock → timetable-patch preview) and a wrong action here is consequential
// (it changes who's actually covering a class) — exactly the class of screen this codebase has repeatedly
// pulled out of a modal once it got this dense.
//
// Route (for App.tsx — not wired by this agent per the phase's ground rules): `/portal/timetable/substitutions/:leaveRequestId`
//
// Confirmed against the real server (server/src/modules/leave/{router,service}.ts +
// server/src/modules/timetable/substitution.ts): `POST /leave/requests/:id/approve` returns
// `{ item, substitution? }` where `substitution` is `onLeaveApproved`'s `SubstitutionApprovalResult` —
// present only when the leave belongs to a teacher and touches a teaching period. Approving is BLOCKED
// (409) server-side while `status === 'PENDING_SUBSTITUTION'` (an outstanding SENT invite) — this page
// disables the button and explains why rather than letting that 409 surface as a raw error.

export default function SubstitutionReview() {
  const { leaveRequestId } = useParams<{ leaveRequestId: string }>()
  const { db } = useStore()
  const types = useLeaveTypes()

  // No single-leave-request GET is routed on this codebase's leave router (only the list endpoint) — the
  // admin-approvals-scoped list already includes every request an admin can act on, so finding this one id
  // in it avoids a new endpoint.
  const approvals = useLeaveRequests({ scope: 'approvals' })
  const leave = useMemo(() => approvals.items?.find(r => r.id === leaveRequestId), [approvals.items, leaveRequestId])
  const nameOf = (id?: string, fallback?: string) => fallback ?? (id ? db.users.find(u => u.id === id)?.name : undefined) ?? id ?? '—'

  const policy = useSubstitutionPolicy()
  const subs = useSubstitutionRequests({ leaveRequestId }, !!leaveRequestId)
  const sortedSubs = useMemo(() => [...(subs.items ?? [])].sort((a, b) => b.sentAt.localeCompare(a.sentAt)), [subs.items])
  const outstanding = sortedSubs.filter(r => r.status === 'SENT')
  const anyAccepted = sortedSubs.some(r => r.status === 'ACCEPTED')

  const hoursNotice = leave ? noticeHours(leave.fromDate) : 0
  const isEmergencyRisk = !!policy.item && hoursNotice < policy.item.minNoticeHoursForSubstitution

  const [finderOpen, setFinderOpen] = useState(false)
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null)
  const [approveResult, setApproveResult] = useState<SubstitutionApprovalResult | null | 'none'>(null)
  const [declineOpen, setDeclineOpen] = useState(false)
  const [note, setNote] = useState('')

  const approve = async () => {
    if (!leave) return
    setBusy('approve')
    try {
      const out = await api.post<{ item: unknown; substitution?: SubstitutionApprovalResult }>(`/leave/requests/${leave.id}/approve`, {})
      setApproveResult(out.substitution ?? 'none')
      approvals.reload(); subs.reload()
      toast.success('Leave approved')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const decline = async () => {
    if (!leave) return
    setBusy('decline')
    try {
      await api.post(`/leave/requests/${leave.id}/decline`, { note: note.trim() || undefined })
      setDeclineOpen(false); setNote(''); approvals.reload()
      toast.success('Leave declined')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const canDecide = leave?.status === 'Pending'
  const blockedBySubstitution = leave?.status === 'PENDING_SUBSTITUTION'

  return (
    <PortalPageShell backLabel="Back to Leave Approvals">
      {approvals.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {!approvals.loading && !leave && <Empty text="Leave request not found, or you can't act on it." />}
      {leave && (
        <>
          <PageHead title={`Substitution — ${nameOf(leave.forUserId, leave.forUserName)}`}
            sub={`${fmtDate(leave.fromDate)} → ${fmtDate(leave.toDate)} · ${leaveTypeName(types.items, leave.leaveTypeId, leave.leaveTypeName)} · ${leave.reason}`}>
            <div className="flex items-center gap-2">
              {isEmergencyRisk && (leave.status === 'Pending' || leave.status === 'PENDING_SUBSTITUTION') && <Pill tone="rose"><AlertTriangle size={11} /> emergency</Pill>}
              <Pill tone={leaveTone(leave.status)}>{leaveStatusLabel(leave.status)}</Pill>
            </div>
          </PageHead>

          {isEmergencyRisk && (leave.status === 'Pending' || leave.status === 'PENDING_SUBSTITUTION') && (
            <Card className="mb-5 border-rose-200 bg-rose-50/60 p-4 dark:border-rose-500/30 dark:bg-rose-500/[.06]">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-rose-700 dark:text-rose-300"><AlertTriangle size={14} /> Emergency assignment</p>
              <p className="mt-1 text-[12.5px] text-rose-800/80 dark:text-rose-200/80">
                Submitted with only ~{Math.max(0, hoursNotice)}h notice — below the school's {policy.item?.minNoticeHoursForSubstitution ?? '—'}h minimum. Assigning a substitute below skips the teacher-to-teacher accept round-trip (there isn't time for it).
              </p>
            </Card>
          )}

          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <Card className="p-0">
              <p className="border-b border-black/[.06] dark:border-white/[.08] px-6 py-3 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
                Substitution requests · {sortedSubs.length}
              </p>
              <div className="p-6">
                {sortedSubs.length === 0 ? (
                  <Empty text="No substitution request has been sent for this leave yet — run the Finder to arrange coverage, or this may be a plain non-teaching leave with nothing to cover." />
                ) : (
                  <SubstitutionStatusList requests={sortedSubs} />
                )}
                {outstanding.length > 0 && (
                  <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-amber-700 dark:text-amber-300">
                    <AlertTriangle size={13} /> {outstanding.length} request{outstanding.length === 1 ? '' : 's'} still awaiting the substitute's own accept/decline — approval is blocked until {outstanding.length === 1 ? 'it resolves' : 'they resolve'}.
                  </p>
                )}
                <button onClick={() => setFinderOpen(true)} className="btn-ink mt-4 flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
                  <Sparkles size={14} /> {sortedSubs.length === 0 ? 'Find a substitute' : 'Assign more coverage'}
                </button>
              </div>
            </Card>

            <div className="space-y-5">
              <Card>
                <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Decision</p>
                {!canDecide && !blockedBySubstitution ? (
                  <p className="mt-3 text-[13.5px] text-black/60 dark:text-white/60">This request is already {leaveStatusLabel(leave.status).toLowerCase()}.</p>
                ) : blockedBySubstitution ? (
                  <p className="mt-3 text-[13.5px] text-black/60 dark:text-white/60">Waiting on {outstanding.length} outstanding substitute invite{outstanding.length === 1 ? '' : 's'} — approval unlocks once every SENT request is accepted or declined.</p>
                ) : (
                  <>
                    <p className="mt-2 text-[12.5px] text-black/50 dark:text-white/50">
                      Approving locks every accepted substitute's hold in as a real one-off Substitution record for its covered date(s), and reports anything still uncovered.
                    </p>
                    <button onClick={approve} disabled={busy !== null} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-[14px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
                      <Lock size={14} /> {busy === 'approve' ? 'Approving…' : anyAccepted ? 'Approve leave & lock coverage' : 'Approve leave'}
                    </button>
                    <button onClick={() => setDeclineOpen(true)} disabled={busy !== null} className="mt-2 w-full rounded-xl bg-black/[.06] dark:bg-white/[.08] py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Decline leave</button>
                  </>
                )}
              </Card>

              {approveResult && (
                <Card className="border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-500/30 dark:bg-indigo-500/[.06]">
                  <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300"><Zap size={14} /> Coverage result</p>
                  {approveResult === 'none' ? (
                    <p className="flex items-center gap-2 text-[12.5px] text-indigo-900/80 dark:text-indigo-200/80"><CheckCircle2 size={13} /> Approved — this leave didn't touch any teaching periods, nothing else to do here.</p>
                  ) : (
                    <>
                      <ul className="space-y-1 text-[12.5px] text-indigo-900/85 dark:text-indigo-200/85">
                        <li>• {approveResult.covered.length} period{approveResult.covered.length === 1 ? '' : 's'} covered — a real Substitution record was created for each</li>
                        {approveResult.uncovered.length > 0 && <li className="text-amber-700 dark:text-amber-300">• {approveResult.uncovered.length} period{approveResult.uncovered.length === 1 ? '' : 's'} still uncovered</li>}
                      </ul>
                      {approveResult.uncovered.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {approveResult.uncovered.map((u, i) => (
                            <p key={i} className="text-[11.5px] text-indigo-900/70 dark:text-indigo-200/70">
                              {DAY_LABELS[u.period.dayOfWeek]} {fmtDate(u.period.date)} P{u.period.periodIdx} — {u.reasons.join('; ')}
                            </p>
                          ))}
                          {approveResult.whatIfSuggestion && (
                            <p className="mt-2 text-[11.5px] text-indigo-900/70 dark:text-indigo-200/70">
                              Suggested next step: in Timetable Builder, run a What-If for {nameOf(leave.forUserId, leave.forUserName)} being unavailable at these {approveResult.uncovered.length} slot(s) against {approveResult.whatIfSuggestion.versionHint.toLowerCase()}.
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </Card>
              )}

              <Card>
                <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><ShieldAlert size={13} /> Policy</p>
                <p className="mt-2 text-[12.5px] text-black/55 dark:text-white/55">
                  Mode: <span className="font-semibold">{policy.item?.mode.replace(/_/g, ' ').toLowerCase() ?? '—'}</span> · Min notice: {policy.item?.minNoticeHoursForSubstitution ?? '—'}h · Cross-subject: {policy.item?.allowCrossSubject ? 'allowed' : 'not allowed'} · Weekly cap: {policy.item?.maxWeeklySubstitutePeriods ?? '—'}
                </p>
              </Card>
            </div>
          </div>

          <SubstituteFinderModal
            open={finderOpen}
            onClose={() => setFinderOpen(false)}
            leaveRequestId={leave.id}
            originalTeacherName={nameOf(leave.forUserId, leave.forUserName)}
            policyMode={policy.item?.mode ?? 'ADMIN_ASSIGNED'}
            adminMode
            onSent={() => { subs.reload(); setFinderOpen(false) }}
          />

          <Modal open={declineOpen} onClose={() => setDeclineOpen(false)} title="Decline leave request">
            <div className="space-y-4">
              <Field label="Note (optional)"><textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Let them know why…" className={inputCls} /></Field>
              <button onClick={decline} disabled={busy !== null} className="w-full rounded-xl bg-rose-600 py-3 text-[14px] font-semibold text-white hover:bg-rose-700 disabled:opacity-40">{busy === 'decline' ? 'Declining…' : 'Decline'}</button>
            </div>
          </Modal>
        </>
      )}
    </PortalPageShell>
  )
}
