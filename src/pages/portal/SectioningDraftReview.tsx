import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { AlertTriangle, CheckCircle2, ShieldAlert, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { errorMessage } from '@/lib/api'
import { useTemplates, useVersion, useVersionActions } from '@/lib/hooks/useSectioning'
import type { SectioningAssignment } from '@/lib/data'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '@/portal/ui'
import { FormActions } from '@/portal/modules/academic'
import { muted, sectionLabel } from '@/portal/modules/academicShared'
import { PortalPageShell } from './PortalPageShell'

// Phase T3 §4 — the draft-review-before-approve screen. Per roadmap D9 this is explicitly the highest-stakes
// screen in the phase (it places real students into real sections), so it gets a dedicated routed page and
// deliberate design attention rather than living as a modal off the Templates list: every validation
// warning and the band-mix preview need to be genuinely legible, not just technically present, and nothing
// is written to Enrollment/Cohort until an admin explicitly approves (see service.ts#approveVersion — a
// blocking validation error 409s unless `force` is passed, and that force path is a conscious, visible
// choice in this UI, never a silent default).

const cardHead = 'flex items-center justify-between gap-3 border-b border-black/[.06] dark:border-white/[.08] px-6 py-3'
const rowCls = 'flex items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-5 py-3 last:border-0'

function BandMixBar({ mix }: { mix: Record<string, number> }) {
  const bandColors = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#0ea5e9', '#94a3b8']
  const entries = Object.entries(mix)
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
      {entries.map(([label, pct], i) => (
        <div key={label} style={{ width: `${pct}%`, background: bandColors[i % bandColors.length] }} title={`${label} · ${pct}%`} />
      ))}
    </div>
  )
}

export default function SectioningDraftReview() {
  const { id } = useParams<{ id: string }>()
  const { data: version, loading, error, reload } = useVersion(id)
  const { db } = useStore()
  const { cohorts } = useAcademic()
  const { items: templates } = useTemplates()
  const versionActions = useVersionActions()

  const template = templates?.find(t => t.id === version?.templateId)
  const cohortById = useMemo(() => new Map((cohorts as { id: string; name: string; classLabels?: string[] }[]).map(c => [c.id, c])), [cohorts])
  const userById = useMemo(() => new Map(db.users.map(u => [u.id, u])), [db.users])
  const cohortName = (id: string) => cohortById.get(id)?.name ?? id
  const studentName = (id: string) => userById.get(id)?.name ?? id

  const [forceApprove, setForceApprove] = useState(false)
  const [approveErr, setApproveErr] = useState<string | null>(null)
  const approve = async () => {
    if (!version) return
    setApproveErr(null)
    try {
      await versionActions.approve(version.id, forceApprove)
      toast.success('Sectioning approved — placements are now live.')
      reload()
    } catch (e) { setApproveErr(errorMessage(e)) }
  }

  const [moveTarget, setMoveTarget] = useState<{ studentId: string; currentCohortId: string } | null>(null)

  const bySection = useMemo(() => {
    type Assignment = SectioningAssignment
    if (!version) return new Map<string, Assignment[]>()
    const order = template?.sectionOrder ?? [...new Set(version.assignments.map(a => a.cohortId))]
    const m = new Map<string, Assignment[]>()
    for (const sec of order) m.set(sec, [])
    for (const a of version.assignments) m.set(a.cohortId, [...(m.get(a.cohortId) ?? []), a])
    return m
  }, [version, template])

  const errors = version?.summary.validation?.errors ?? []
  const warnings = [...(version?.summary.warnings ?? []), ...(version?.summary.validation?.warnings ?? []).filter(w => !version?.summary.warnings?.includes(w))]
  const isDraft = version?.status === 'DRAFT'
  const blocked = isDraft && errors.length > 0

  return (
    <PortalPageShell backLabel="Back to sectioning">
      {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading draft…</p>}
      {!loading && (error || !version) && <Empty text={error || 'Sectioning version not found.'} />}
      {!loading && version && (
        <>
          <PageHead title={template?.name ?? 'Sectioning run'} sub={`Generated ${new Date(version.createdAt).toLocaleString()}${version.scopeCohortId ? ` · scoped to ${cohortName(version.scopeCohortId)}` : ''}`}>
            <Pill tone={version.status === 'APPROVED' ? 'green' : version.status === 'SUPERSEDED' ? 'slate' : 'amber'}>{version.status}</Pill>
          </PageHead>

          {/* ── top-line summary ── */}
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            <Card className="p-4"><p className={muted}>Scored</p><p className="font-display text-2xl font-medium">{version.summary.scoredCount}</p></Card>
            <Card className="p-4"><p className={muted}>Unscored (manual)</p><p className="font-display text-2xl font-medium">{version.summary.unscoredStudentIds.length}</p></Card>
            <Card className="p-4"><p className={muted}>Overflow</p><p className="font-display text-2xl font-medium">{version.summary.overflowStudentIds.length}</p></Card>
            <Card className="p-4"><p className={muted}>Assigned</p><p className="font-display text-2xl font-medium">{version.assignments.length}</p></Card>
          </div>

          {/* ── validation — the part D9 says must be genuinely legible ── */}
          {errors.length > 0 && (
            <div className="mb-4 rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50/70 dark:bg-rose-500/10 p-4">
              <p className="flex items-center gap-2 text-[14px] font-semibold text-rose-700 dark:text-rose-300"><ShieldAlert size={16} /> {errors.length} blocking issue{errors.length === 1 ? '' : 's'} — approval requires an explicit override</p>
              <ul className="mt-2 space-y-1.5 text-[13px] text-rose-700/90 dark:text-rose-300/90">
                {errors.map((e, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rose-500" />{e}</li>)}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="mb-4 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/10 p-4">
              <p className="flex items-center gap-2 text-[14px] font-semibold text-amber-700 dark:text-amber-300"><AlertTriangle size={16} /> {warnings.length} warning{warnings.length === 1 ? '' : 's'} — informational, doesn't block approval</p>
              <ul className="mt-2 space-y-1.5 text-[13px] text-amber-700/90 dark:text-amber-300/90">
                {warnings.map((w, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />{w}</li>)}
              </ul>
            </div>
          )}
          {errors.length === 0 && warnings.length === 0 && (
            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10 p-4 text-[13.5px] font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={16} /> No validation issues — capacity, band mix and full assignment all check out.
            </div>
          )}

          {version.summary.unscoredStudentIds.length > 0 && (
            <Card className="mb-5">
              <p className={sectionLabel}>Unscored — route to manual placement</p>
              <p className={muted + ' mt-1'}>No exam history for this year yet; not auto-placed by the strategy.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {version.summary.unscoredStudentIds.map(sid => (
                  <button key={sid} onClick={() => setMoveTarget({ studentId: sid, currentCohortId: '' })} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-medium hover:bg-black/10 dark:hover:bg-white/15">
                    <Avatar name={studentName(sid)} size={18} /> {studentName(sid)}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* ── per-section band-mix preview + roster ── */}
          <div className="space-y-4">
            {[...bySection.entries()].map(([cohortId, assignments]) => {
              const mix = version.summary.sectionBandMix?.[cohortId] ?? {}
              return (
                <Card key={cohortId} className="p-0">
                  <div className={cardHead}>
                    <div>
                      <p className="flex items-center gap-2 text-[15px] font-semibold"><Users size={14} className="text-black/40 dark:text-white/40" /> {cohortName(cohortId)}</p>
                      <p className={muted}>{assignments.length} student{assignments.length === 1 ? '' : 's'}</p>
                    </div>
                    {Object.keys(mix).length > 0 && (
                      <div className="w-56 shrink-0">
                        <BandMixBar mix={mix} />
                        <div className="mt-1.5 flex flex-wrap justify-end gap-x-2.5 gap-y-0.5 text-[11px] text-black/50 dark:text-white/50">
                          {Object.entries(mix).map(([label, pct]) => <span key={label}>{label} {pct}%</span>)}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="thin-scroll max-h-72 overflow-y-auto">
                    {assignments.length === 0 ? <div className="p-5"><Empty text="No students assigned to this section." /></div>
                      : assignments.map(a => {
                        const moved = a.previousCohortId && a.previousCohortId !== a.cohortId
                        return (
                          <div key={a.studentId} className={rowCls}>
                            <Avatar name={studentName(a.studentId)} size={30} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13.5px] font-medium">{studentName(a.studentId)}</p>
                              <p className={muted}>{a.band ? `${a.band}${a.score !== undefined ? ` · ${a.score}%` : ''}` : a.score !== undefined ? `${a.score}%` : '—'}</p>
                            </div>
                            {moved && <Pill tone="sky">from {cohortName(a.previousCohortId!)}</Pill>}
                            <button onClick={() => setMoveTarget({ studentId: a.studentId, currentCohortId: a.cohortId })} className="rounded-full border border-black/10 dark:border-white/15 px-3 py-1.5 text-[12px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06]">Move…</button>
                          </div>
                        )
                      })}
                  </div>
                </Card>
              )
            })}
          </div>

          {/* ── approve ── */}
          {isDraft && (
            <Card className="mt-5">
              {approveErr && <p className="mb-3 text-[13px] text-rose-600 dark:text-rose-400">{approveErr}</p>}
              {blocked && (
                <label className="mb-3 flex items-start gap-2.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 p-3 text-[13px] text-rose-700 dark:text-rose-300">
                  <input type="checkbox" checked={forceApprove} onChange={e => setForceApprove(e.target.checked)} className="mt-0.5" />
                  <span>I've reviewed the {errors.length} blocking issue{errors.length === 1 ? '' : 's'} above and want to approve anyway. This is logged.</span>
                </label>
              )}
              <button onClick={approve} disabled={versionActions.busy === 'approve' || (blocked && !forceApprove)}
                className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
                {versionActions.busy === 'approve' ? 'Approving…' : blocked ? `Approve anyway (${errors.length} issue${errors.length === 1 ? '' : 's'} overridden)` : 'Approve — write these placements'}
              </button>
              <p className={muted + ' mt-2 text-center'}>Nothing is written to student records until you approve. Approving updates each student's class/cohort and cannot be silently undone — use an individual move afterwards if something needs correcting.</p>
            </Card>
          )}
          {version.status === 'APPROVED' && (
            <p className={muted + ' mt-4 text-center'}>Approved {version.approvedAt ? new Date(version.approvedAt).toLocaleString() : ''}{version.approvedById ? ` by ${studentName(version.approvedById)}` : ''} — placements are live. Use "Move…" above for an individual correction.</p>
          )}
        </>
      )}

      <MoveStudentModal target={moveTarget} onClose={() => setMoveTarget(null)} cohortName={cohortName}
        sectionOrder={template?.sectionOrder ?? []} onDone={() => { setMoveTarget(null); reload() }} studentName={studentName} />
    </PortalPageShell>
  )
}

function MoveStudentModal({ target, onClose, sectionOrder, cohortName, onDone, studentName }: {
  target: { studentId: string; currentCohortId: string } | null; onClose: () => void; sectionOrder: string[]
  cohortName: (id: string) => string; onDone: () => void; studentName: (id: string) => string
}) {
  const [toCohortId, setToCohortId] = useState('')
  const [reason, setReason] = useState('')
  const versionActions = useVersionActions()
  const submit = async () => {
    if (!target || !toCohortId || !reason.trim()) return
    try {
      await versionActions.move({ studentId: target.studentId, toCohortId, reason: reason.trim() })
      toast.success('Moved — logged with reason.')
      setToCohortId(''); setReason('')
      onDone()
    } catch (e) { toast.error(errorMessage(e)) }
  }
  return (
    <Modal open={!!target} onClose={onClose} title={target ? `Move ${studentName(target.studentId)}` : 'Move student'}>
      {target && (
        <div className="space-y-4">
          <p className={muted}>Currently: {target.currentCohortId ? cohortName(target.currentCohortId) : 'unassigned (unscored pool)'}. This is an immediate, audited edit — it doesn't wait for a version approval.</p>
          <Field label="Move to">
            <select value={toCohortId} onChange={e => setToCohortId(e.target.value)} className={inputCls} autoFocus>
              <option value="">Select section…</option>
              {sectionOrder.filter(c => c !== target.currentCohortId).map(c => <option key={c} value={c}>{cohortName(c)}</option>)}
            </select>
          </Field>
          <Field label="Reason (required)"><textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className={inputCls} placeholder="Why this student is moving…" /></Field>
          <FormActions onCancel={onClose} onSave={submit} label={versionActions.busy === 'move' ? 'Moving…' : 'Move student'} disabled={!toCohortId || !reason.trim() || versionActions.busy === 'move'} />
        </div>
      )}
    </Modal>
  )
}
