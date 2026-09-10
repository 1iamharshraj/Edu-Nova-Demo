import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Sparkles, UserCheck } from 'lucide-react'
import type { SubstitutionPolicyMode, SubstitutionRequest, SubstituteFinderResult } from '@/lib/data'
import { DAY_LABELS } from '@/lib/hooks/useTimetable'
import { periodKey, useSubstitutionActions, useSubstituteFinder } from '@/lib/hooks/useSubstitution'
import { Card, Field, Modal, Pill, inputCls } from '../ui'

// Phase T9 §2/§4 — the Substitute Finder trigger + ranked-candidate review, and the substitute's own
// accept/decline inbox. Sibling to timetableWhatIf.tsx's WhatIfSetupModal/WhatIfReviewModal pair (T8): a
// modal is the right fit here too — this is a single bounded action (arrange coverage for one absence),
// not a multi-page workflow, the same UX-fit judgment that kept T8's trigger+review as modals rather than
// pages. See .agents/edunova/phase-t9-substitution.md.
//
// The real Finder (POST /timetable/substitution-finder, confirmed against
// server/src/modules/timetable/substitution.ts) ranks candidates PER PERIOD, not once for a whole batch —
// eligibility and score genuinely differ period to period (a teacher free Monday P3 may be busy Tuesday
// P3). This modal lets the caller select a subset of the leave's periods (partial substitution) and then
// combines each period's per-period result into one ranked list of teachers eligible across every selected
// period, since a single SubstitutionRequest covers multiple periods and the server re-checks hard
// eligibility for ALL of them at send time.

type PeriodResult = SubstituteFinderResult['periods'][number]

const periodLabel = (p: { date: string; dayOfWeek: number; periodIdx: number; subjectName?: string; classLabel?: string }) =>
  `${DAY_LABELS[p.dayOfWeek]} ${new Date(`${p.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · P${p.periodIdx}${p.subjectName ? ` · ${p.subjectName}` : ''}${p.classLabel ? ` (${p.classLabel})` : ''}`

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(score)))
  const tone = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-black/[.08] dark:bg-white/[.10]"><div className={`h-full ${tone}`} style={{ width: `${pct}%` }} /></div>
      <span className="text-[12px] font-semibold tabular-nums text-black/50 dark:text-white/50">{pct}</span>
    </div>
  )
}

/** One teacher's combined standing across every selected period — built client-side by intersecting each
 * period's `candidates`/`excluded` breakdown (see the file header comment for why a combined view). */
interface CombinedCandidate {
  teacherId: string; teacherName: string
  totalScore: number
  reasons: string[]
  /** True in any selected period where this teacher was only excluded for lacking a qualification/cross-
   * subject match (never a genuine hard failure) — the ONLY case the server's `override` flag can bypass. */
  needsOverride: boolean
  /** True if this teacher failed a genuine hard constraint (collision, hold, own leave, unavailable) in at
   * least one selected period — never selectable, matches the server's own override restriction. */
  hardBlocked: boolean
  hardBlockReasons: string[]
}

const QUALIFICATION_ONLY = /not qualified|cross-subject/i

function combineCandidates(periods: PeriodResult[]): CombinedCandidate[] {
  const byTeacher = new Map<string, CombinedCandidate>()
  const touch = (id: string, name: string) => {
    let c = byTeacher.get(id)
    if (!c) { c = { teacherId: id, teacherName: name, totalScore: 0, reasons: [], needsOverride: false, hardBlocked: false, hardBlockReasons: [] }; byTeacher.set(id, c) }
    return c
  }
  for (const p of periods) {
    for (const cand of p.candidates) {
      const c = touch(cand.teacherId, cand.teacherName)
      c.totalScore += cand.total
      for (const r of cand.reasons) if (!c.reasons.includes(r)) c.reasons.push(r)
    }
    for (const exc of p.excluded) {
      const c = touch(exc.teacherId, exc.teacherName)
      const onlyQualification = exc.reasons.every(r => QUALIFICATION_ONLY.test(r))
      if (onlyQualification) {
        c.needsOverride = true
        for (const r of exc.reasons) if (!c.reasons.includes(r)) c.reasons.push(r)
      } else {
        c.hardBlocked = true
        for (const r of exc.reasons) if (!c.hardBlockReasons.includes(r)) c.hardBlockReasons.push(r)
      }
    }
  }
  return [...byTeacher.values()].filter(c => !c.hardBlocked).sort((a, b) => b.totalScore - a.totalScore)
}

export interface SubstituteFinderModalProps {
  open: boolean
  onClose: () => void
  /** A leave request always exists before the Finder runs (the server derives its periods from it) — see
   * substitution.ts#resolveLeavePeriods. */
  leaveRequestId: string
  originalTeacherName?: string
  policyMode: SubstitutionPolicyMode
  /** True for the admin console — shows "Assign directly" (no accept round-trip is meaningful once an admin
   * picks) and allows selecting a qualification-only-excluded candidate with a mandatory override note. */
  adminMode?: boolean
  onSent: (request: SubstitutionRequest) => void
}

export function SubstituteFinderModal({ open, onClose, leaveRequestId, originalTeacherName, policyMode, adminMode, onSent }: SubstituteFinderModalProps) {
  const [result, setResult] = useState<SubstituteFinderResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pickedTeacherId, setPickedTeacherId] = useState('')
  const [overrideNote, setOverrideNote] = useState('')
  const finder = useSubstituteFinder()
  const actions = useSubstitutionActions()

  const run = async () => {
    const out = await finder.find({ leaveRequestId })
    if (out) { setResult(out); setSelected(new Set(out.periods.map(p => periodKey(p.period)))); setPickedTeacherId(''); setOverrideNote('') }
  }
  const reset = () => { setResult(null); setSelected(new Set()); setPickedTeacherId(''); setOverrideNote('') }
  const close = () => { reset(); onClose() }

  const allPeriods = useMemo(() => result?.periods ?? [], [result])
  const selectedPeriods = useMemo(() => allPeriods.filter(p => selected.has(periodKey(p.period))), [allPeriods, selected])
  const toggle = (p: PeriodResult) => setSelected(s => {
    const n = new Set(s); const k = periodKey(p.period)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })

  const combined = useMemo(() => combineCandidates(selectedPeriods), [selectedPeriods])
  const picked = combined.find(c => c.teacherId === pickedTeacherId)
  const canSend = !!picked && (!picked.needsOverride || overrideNote.trim().length > 0)

  const send = async () => {
    if (!picked) return
    const periods = selectedPeriods.map(p => ({ date: p.period.date, dayOfWeek: p.period.dayOfWeek, periodIdx: p.period.periodIdx, timetableEntryId: p.period.timetableEntryId }))
    const out = await actions.send({
      leaveRequestId, substituteTeacherId: picked.teacherId, periods,
      override: picked.needsOverride || undefined, overrideNote: picked.needsOverride ? overrideNote.trim() : undefined,
    }, adminMode ? 'Substitute assigned' : 'Request sent — waiting for them to accept')
    if (out) {
      onSent(out)
      const remaining = new Set(selected)
      for (const p of selectedPeriods) remaining.delete(periodKey(p.period))
      if (remaining.size === 0) close(); else { setSelected(remaining); setPickedTeacherId(''); setOverrideNote('') }
    }
  }

  return (
    <Modal open={open} onClose={close} title={`Find a substitute${originalTeacherName ? ` for ${originalTeacherName}` : ''}`} wide>
      <div className="space-y-4">
        {!result ? (
          <button onClick={run} disabled={finder.busy} className="btn-ink flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">
            <Sparkles size={14} /> {finder.busy ? 'Searching…' : 'Run the Substitute Finder'}
          </button>
        ) : (
          <>
            <Field label={`Periods needing coverage · ${selectedPeriods.length}/${allPeriods.length} selected`}>
              <div className="thin-scroll max-h-40 space-y-1 overflow-y-auto rounded-xl border border-black/[.08] dark:border-white/[.12] p-2">
                {allPeriods.map(p => (
                  <label key={periodKey(p.period)} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/[.03] dark:hover:bg-white/[.05]">
                    <input type="checkbox" checked={selected.has(periodKey(p.period))} onChange={() => toggle(p)} className="h-3.5 w-3.5 accent-indigo-600" />
                    <span className="flex-1 text-[12.5px]">{periodLabel(p.period)}</span>
                    <span className={`text-[11px] font-semibold ${p.candidates.length > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {p.candidates.length > 0 ? `${p.candidates.length} eligible` : 'none eligible'}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[11.5px] text-black/45 dark:text-white/45">Deselect a period to leave it for a separate substitute (or a later run) — any left unassigned when the leave is approved fall back to What-If re-optimization.</p>
            </Field>

            {selectedPeriods.length === 0 ? (
              <p className="text-[12.5px] text-black/45 dark:text-white/45">Select at least one period to see ranked candidates.</p>
            ) : combined.length === 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle size={14} /> No single substitute is eligible across every selected period</p>
                <p className="text-[12.5px] text-amber-900/85 dark:text-amber-200/85">Try selecting fewer periods (split coverage across more than one substitute), or leave these for What-If re-optimization once the leave is approved.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Ranked candidates · {combined.length}</p>
                {combined.map(c => (
                  <label key={c.teacherId}
                    className={`block cursor-pointer rounded-2xl border p-3.5 transition ${pickedTeacherId === c.teacherId ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500/50 dark:bg-indigo-500/10' : 'border-black/[.08] dark:border-white/[.12] hover:bg-black/[.03] dark:hover:bg-white/[.05]'}`}>
                    <div className="flex items-center gap-3">
                      <input type="radio" name="candidate" checked={pickedTeacherId === c.teacherId} onChange={() => setPickedTeacherId(c.teacherId)} className="h-3.5 w-3.5 accent-indigo-600" disabled={c.needsOverride && !adminMode} />
                      <span className="flex-1 text-[13.5px] font-semibold">{c.teacherName}</span>
                      {c.needsOverride && <Pill tone="amber">needs override</Pill>}
                      <ScoreBar score={c.totalScore / selectedPeriods.length} />
                    </div>
                    <ul className="mt-2 space-y-1">
                      {c.reasons.map((r, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[12px] text-black/55 dark:text-white/55">
                          <Check size={12} className="mt-0.5 shrink-0 text-emerald-500" /> <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                    {c.needsOverride && !adminMode && <p className="mt-1.5 text-[11.5px] text-amber-700 dark:text-amber-300">Only qualified for some of these periods via cross-subject substitution — an admin must override to assign them.</p>}
                  </label>
                ))}
                {picked?.needsOverride && adminMode && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <p className="mb-2 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">This candidate isn't fully qualified for every selected period — an audit note is required to assign them anyway.</p>
                    <textarea value={overrideNote} onChange={e => setOverrideNote(e.target.value)} rows={2} placeholder="Why this teacher despite the qualification gap…" className={inputCls} />
                  </div>
                )}
                <button onClick={send} disabled={!canSend || actions.busy === 'send'} className="btn-ink flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">
                  <UserCheck size={14} /> {actions.busy === 'send' ? 'Sending…' : adminMode ? 'Assign directly' : policyMode === 'HYBRID' ? 'Suggest this substitute' : 'Send request'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** The substitute's own accept/decline inbox — SENT requests where the caller is the proposed substitute.
 * Kept as a plain card list (not a modal, not a page): a short, occasional, two-action queue is exactly the
 * kind of surface that doesn't need either — the same judgment call as LeaveApprovalsMod's row list. */
export function SubstitutionInboxCard({ items, busyId, onAccept, onDecline }: {
  items: SubstitutionRequest[]
  busyId: string | null
  onAccept: (r: SubstitutionRequest) => void
  onDecline: (r: SubstitutionRequest) => void
}) {
  const pending = items.filter(r => r.status === 'SENT')
  if (pending.length === 0) return null
  return (
    <Card className="mb-5 border-indigo-200 bg-indigo-50/40 p-0 dark:border-indigo-500/30 dark:bg-indigo-500/[.06]">
      <p className="flex items-center gap-2 border-b border-indigo-200/70 px-5 py-3 text-[13px] font-semibold text-indigo-800 dark:border-indigo-500/20 dark:text-indigo-300">
        <UserCheck size={14} /> Substitution requests for you · {pending.length}
      </p>
      {pending.map(r => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-indigo-200/50 px-5 py-3.5 last:border-0 dark:border-indigo-500/15">
          <div className="min-w-48 flex-1">
            <p className="text-[13.5px] font-semibold">{r.originalTeacherName ?? r.originalTeacherId} needs cover</p>
            <p className="text-[12px] text-black/50 dark:text-white/50">{r.periods.map(periodLabel).join(' · ')}</p>
          </div>
          <button onClick={() => onAccept(r)} disabled={busyId === r.id} className="rounded-full bg-emerald-600 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">Accept</button>
          <button onClick={() => onDecline(r)} disabled={busyId === r.id} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-4 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Decline</button>
        </div>
      ))}
    </Card>
  )
}

const MODE_TONE: Record<SubstitutionRequest['mode'], 'indigo' | 'rose' | 'slate'> = { TEACHER_INITIATED: 'slate', HYBRID: 'slate', ADMIN_ASSIGNED: 'indigo', EMERGENCY: 'rose' }
const MODE_LABEL: Record<SubstitutionRequest['mode'], string> = { TEACHER_INITIATED: 'teacher-initiated', HYBRID: 'hybrid', ADMIN_ASSIGNED: 'admin-assigned', EMERGENCY: 'emergency' }

/** Small status strip for a leave request's own attached substitution requests — used by both MyLeaveMod
 * (teacher's own submitted leave) and the admin review page. */
export function SubstitutionStatusList({ requests }: { requests: SubstitutionRequest[] }) {
  if (requests.length === 0) return null
  const toneFor = (s: SubstitutionRequest['status']) => s === 'ACCEPTED' ? 'green' : s === 'SENT' ? 'amber' : s === 'DECLINED' ? 'rose' : 'slate'
  return (
    <div className="mt-2 space-y-1.5">
      {requests.map(r => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 text-[12px]">
          <Pill tone={toneFor(r.status)}>{r.status.toLowerCase()}</Pill>
          <span className="text-black/55 dark:text-white/55">{r.substituteTeacherName ?? r.substituteTeacherId} · {r.periods.length} period{r.periods.length === 1 ? '' : 's'}</span>
          <Pill tone={MODE_TONE[r.mode]}>{MODE_LABEL[r.mode]}</Pill>
          {r.isOverride && <Pill tone="amber">override</Pill>}
        </div>
      ))}
    </div>
  )
}
