import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, GitBranch, Lock, Users, Zap } from 'lucide-react'
import type { PeriodDef, Room, TimetableLockType, TimetableVersion, WhatIfChangeEvent, WhatIfChangeEventType, WhatIfResult } from '@/lib/data'
import { useAcademic } from '@/lib/store'
import { DAY_LABELS, cellKey, useTeachingRequirements, type EntryLookup } from '@/lib/hooks/useTimetable'
import { Card, Field, Modal, Pill, inputCls } from '../ui'
import { DiagnosticsPanel } from './timetable'

// Phase T8 — Partial re-optimization / what-if (roadmap T8, spec: phase-t8-what-if.md). This is the
// trigger + review half sitting alongside T7's override system (timetableOverrides.tsx): describe a change
// event (a teacher going unavailable, a room going down, ...), run it against an existing TimetableVersion,
// and get back a brand-new GENERATED child version already computed with the MINIMAL patch — reviewed and
// published through the exact same fork→approve→publish machinery T7 built (useOverrideSession), never a
// parallel approval flow. See server/src/modules/timetable/whatif.ts for the source of truth on every shape
// used here.

const EVENT_TYPES: { type: WhatIfChangeEventType; label: string; hint: string }[] = [
  { type: 'TEACHER_UNAVAILABLE', label: 'Teacher unavailable', hint: 'A teacher can\'t take specific periods (illness, leave, training)' },
  { type: 'ROOM_UNAVAILABLE', label: 'Room unavailable', hint: 'A room is out of use for specific periods (maintenance, damage)' },
  { type: 'PERIOD_REMOVED', label: 'Period removed', hint: 'One period slot is being dropped from the school day' },
  { type: 'EVENT_BLOCKING_SLOTS', label: 'School event blocking slots', hint: 'An assembly, exam, or function blocks specific slots' },
  { type: 'REQUIREMENT_ADDED', label: 'Teaching requirement added', hint: 'A cohort needs more periods of a subject than currently placed' },
  { type: 'REQUIREMENT_CHANGED', label: 'Teaching requirement reduced', hint: 'A cohort needs fewer periods of a subject than currently placed' },
]

/** Compact day×period toggle grid for building a change event's affected slots. */
function SlotPicker({ days, periods, value, onToggle }: { days: number[]; periods: PeriodDef[]; value: Set<string>; onToggle: (d: number, p: number) => void }) {
  return (
    <div className="thin-scroll max-h-56 overflow-y-auto rounded-2xl border border-black/[.08] dark:border-white/[.12] p-2">
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr>
            <th className="p-1 text-left font-medium text-black/40 dark:text-white/40">Period</th>
            {days.map(d => <th key={d} className="p-1 font-medium text-black/40 dark:text-white/40">{DAY_LABELS[d]}</th>)}
          </tr>
        </thead>
        <tbody>
          {periods.map(p => (
            <tr key={p.idx}>
              <td className="whitespace-nowrap p-1 font-medium">{p.label}</td>
              {days.map(d => {
                const on = value.has(cellKey(d, p.idx))
                return (
                  <td key={d} className="p-1 text-center">
                    <button type="button" onClick={() => onToggle(d, p.idx)} aria-pressed={on} aria-label={`${DAY_LABELS[d]} ${p.label}`}
                      className={`h-5 w-5 rounded transition ${on ? 'bg-indigo-500' : 'bg-black/[.06] hover:bg-black/[.12] dark:bg-white/[.08] dark:hover:bg-white/[.16]'}`} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The what-if trigger — event-type picker + type-specific fields, building exactly the `WhatIfChangeEvent`
 * shape `POST /timetable/what-if` expects (see schema.ts's discriminated union). Form state lives entirely
 * here; the parent only supplies the picker data and gets a fully-built event back on Run.
 */
export function WhatIfSetupModal({
  open, onClose, onRun, busy, periods, days, roomList, teacherOptions, cohortOptions, targetVersion, classId,
}: {
  open: boolean
  onClose: () => void
  onRun: (event: WhatIfChangeEvent) => void
  busy: boolean
  /** Class-kind periods only — the slot picker's rows. */
  periods: PeriodDef[]
  /** Every possible weekday, not just days currently in use — a change can target a day nothing sits on yet. */
  days: number[]
  roomList: Room[]
  teacherOptions: { id: string; name: string }[]
  cohortOptions: { id: string; name: string }[]
  targetVersion?: TimetableVersion
  classId: string
}) {
  const [eventType, setEventType] = useState<WhatIfChangeEventType>('TEACHER_UNAVAILABLE')
  const [teacherId, setTeacherId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [slots, setSlots] = useState<Set<string>>(new Set())
  const [singleDay, setSingleDay] = useState(days[0] ?? 1)
  const [singlePeriod, setSinglePeriod] = useState(periods[0]?.idx ?? 0)
  const [blockScope, setBlockScope] = useState<'all' | 'this' | 'cohorts'>('all')
  const [scopeCohortIds, setScopeCohortIds] = useState<string[]>([])
  const [reqCohortId, setReqCohortId] = useState('')
  const [reqId, setReqId] = useState('')
  const [reqDelta, setReqDelta] = useState<'more' | 'fewer'>('more')
  const requirements = useTeachingRequirements(reqCohortId || undefined)
  const { subjectById } = useAcademic()

  const toggleSlot = (d: number, p: number) => setSlots(s => {
    const key = cellKey(d, p)
    const next = new Set(s)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const toggleScopeCohort = (id: string) => setScopeCohortIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  const slotRefs = useMemo(() => [...slots].map(k => { const [d, p] = k.split(':').map(Number); return { dayOfWeek: d, periodIdx: p } }), [slots])

  const reset = () => { setTeacherId(''); setRoomId(''); setSlots(new Set()); setBlockScope('all'); setScopeCohortIds([]); setReqCohortId(''); setReqId(''); setReqDelta('more') }
  const close = () => { reset(); onClose() }

  const canRun = (() => {
    switch (eventType) {
      case 'TEACHER_UNAVAILABLE': return !!teacherId && slotRefs.length > 0
      case 'ROOM_UNAVAILABLE': return !!roomId && slotRefs.length > 0
      case 'PERIOD_REMOVED': return true
      case 'EVENT_BLOCKING_SLOTS': return slotRefs.length > 0 && (blockScope !== 'cohorts' || scopeCohortIds.length > 0)
      case 'REQUIREMENT_ADDED': return !!reqId
      case 'REQUIREMENT_CHANGED': return !!reqId
    }
  })()

  const run = () => {
    if (!canRun) return
    let event: WhatIfChangeEvent
    switch (eventType) {
      case 'TEACHER_UNAVAILABLE': event = { type: 'TEACHER_UNAVAILABLE', teacherId, slots: slotRefs }; break
      case 'ROOM_UNAVAILABLE': event = { type: 'ROOM_UNAVAILABLE', roomId, slots: slotRefs }; break
      case 'PERIOD_REMOVED': event = { type: 'PERIOD_REMOVED', dayOfWeek: singleDay, periodIdx: singlePeriod }; break
      case 'EVENT_BLOCKING_SLOTS': event = { type: 'EVENT_BLOCKING_SLOTS', slots: slotRefs, classIds: blockScope === 'this' ? [classId] : undefined, cohortIds: blockScope === 'cohorts' ? scopeCohortIds : undefined }; break
      case 'REQUIREMENT_ADDED': case 'REQUIREMENT_CHANGED': default:
        // "Added" and "Changed" reduce to the same server-side delta computation (§ whatif.ts) — the admin's
        // own framing (more vs. fewer periods) only decides which label reads naturally; REQUIREMENT_CHANGED
        // covers both a raise and a cut, so REQUIREMENT_ADDED is only used as a distinct label when a
        // brand-new requirement was just created (delta is always positive there by construction).
        event = { type: reqDelta === 'more' ? 'REQUIREMENT_ADDED' : 'REQUIREMENT_CHANGED', teachingRequirementId: reqId }
    }
    onRun(event)
  }

  return (
    <Modal open={open} onClose={close} title="Run a What-If" wide>
      <div className="space-y-4">
        {!targetVersion ? (
          <p className="rounded-xl bg-amber-50 dark:bg-amber-500/10 p-3 text-[12.5px] text-amber-700 dark:text-amber-300">
            No timetable version exists yet for this class/term to patch — publish one (or start an edit session) first.
          </p>
        ) : (
          <p className="text-[12.5px] text-black/50 dark:text-white/50">
            Describe what changed. This computes the smallest possible patch to <strong>{targetVersion.status === 'PUBLISHED' ? 'the published timetable' : 'the current draft'}</strong> — every session not actually touched, and everything under an active lock, is left exactly as it is.
          </p>
        )}

        <Field label="What changed">
          <div className="grid grid-cols-2 gap-2">
            {EVENT_TYPES.map(et => (
              <button key={et.type} type="button" onClick={() => setEventType(et.type)}
                className={`flex flex-col items-start gap-0.5 rounded-xl border p-2.5 text-left transition ${eventType === et.type ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500/50 dark:bg-indigo-500/10' : 'border-black/10 hover:bg-black/[.03] dark:border-white/15 dark:hover:bg-white/[.05]'}`}>
                <span className="text-[12.5px] font-semibold">{et.label}</span>
                <span className="text-[11px] text-black/45 dark:text-white/45">{et.hint}</span>
              </button>
            ))}
          </div>
        </Field>

        {eventType === 'TEACHER_UNAVAILABLE' && (
          <>
            <Field label="Teacher">
              <select value={teacherId} onChange={e => setTeacherId(e.target.value)} className={inputCls}>
                <option value="">— choose —</option>
                {teacherOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label={`Unavailable periods · ${slotRefs.length} selected`}><SlotPicker days={days} periods={periods} value={slots} onToggle={toggleSlot} /></Field>
          </>
        )}

        {eventType === 'ROOM_UNAVAILABLE' && (
          <>
            <Field label="Room">
              <select value={roomId} onChange={e => setRoomId(e.target.value)} className={inputCls}>
                <option value="">— choose —</option>
                {roomList.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label={`Unavailable periods · ${slotRefs.length} selected`}><SlotPicker days={days} periods={periods} value={slots} onToggle={toggleSlot} /></Field>
          </>
        )}

        {eventType === 'PERIOD_REMOVED' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Day">
              <select value={singleDay} onChange={e => setSingleDay(Number(e.target.value))} className={inputCls}>
                {days.map(d => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
              </select>
            </Field>
            <Field label="Period">
              <select value={singlePeriod} onChange={e => setSinglePeriod(Number(e.target.value))} className={inputCls}>
                {periods.map(p => <option key={p.idx} value={p.idx}>{p.label} ({p.start}–{p.end})</option>)}
              </select>
            </Field>
          </div>
        )}

        {eventType === 'EVENT_BLOCKING_SLOTS' && (
          <>
            <Field label="Scope">
              <div className="flex gap-2">
                {(['all', 'this', 'cohorts'] as const).map(s => (
                  <button key={s} type="button" onClick={() => setBlockScope(s)}
                    className={`flex-1 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${blockScope === s ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-black/10 dark:border-white/15 hover:bg-black/[.03] dark:hover:bg-white/[.05]'}`}>
                    {s === 'all' ? 'Whole version' : s === 'this' ? 'This class only' : 'Specific cohorts'}
                  </button>
                ))}
              </div>
            </Field>
            {blockScope === 'cohorts' && (
              <Field label={`Cohorts · ${scopeCohortIds.length} selected`}>
                <div className="thin-scroll max-h-32 space-y-1 overflow-y-auto rounded-xl border border-black/[.08] dark:border-white/[.12] p-2">
                  {cohortOptions.map(c => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/[.03] dark:hover:bg-white/[.05]">
                      <input type="checkbox" checked={scopeCohortIds.includes(c.id)} onChange={() => toggleScopeCohort(c.id)} className="h-3.5 w-3.5 accent-indigo-600" />
                      <span className="text-[12.5px]">{c.name}</span>
                    </label>
                  ))}
                </div>
              </Field>
            )}
            <Field label={`Blocked periods · ${slotRefs.length} selected`}><SlotPicker days={days} periods={periods} value={slots} onToggle={toggleSlot} /></Field>
          </>
        )}

        {(eventType === 'REQUIREMENT_ADDED' || eventType === 'REQUIREMENT_CHANGED') && (
          <>
            <Field label="Change">
              <div className="flex gap-2">
                <button type="button" onClick={() => setReqDelta('more')} className={`flex-1 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${reqDelta === 'more' ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-black/10 dark:border-white/15 hover:bg-black/[.03] dark:hover:bg-white/[.05]'}`}>Needs more periods</button>
                <button type="button" onClick={() => setReqDelta('fewer')} className={`flex-1 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${reqDelta === 'fewer' ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-black/10 dark:border-white/15 hover:bg-black/[.03] dark:hover:bg-white/[.05]'}`}>Needs fewer periods</button>
              </div>
            </Field>
            <Field label="Cohort">
              <select value={reqCohortId} onChange={e => { setReqCohortId(e.target.value); setReqId('') }} className={inputCls}>
                <option value="">— choose —</option>
                {cohortOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            {reqCohortId && (
              <Field label="Teaching requirement">
                <select value={reqId} onChange={e => setReqId(e.target.value)} className={inputCls}>
                  <option value="">— choose —</option>
                  {requirements.items.map(r => <option key={r.id} value={r.id}>{subjectById.get(r.subjectId)?.name ?? r.subjectId} · {r.requiredPeriodsPerWeek} periods/week ({r.assignmentMode.toLowerCase()})</option>)}
                </select>
                {requirements.items.length === 0 && !requirements.loading && <p className="mt-1.5 text-[11.5px] text-black/45 dark:text-white/45">No teaching requirements for this cohort yet — set one up under Classes &amp; Sections → Cohorts first (its `requiredPeriodsPerWeek` should already reflect the change you want to model).</p>}
              </Field>
            )}
          </>
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={run} disabled={busy || !canRun || !targetVersion} className="btn-ink flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">
            <Zap size={14} /> {busy ? 'Computing minimal patch…' : 'Run What-If'}
          </button>
          <button onClick={close} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
        </div>
      </div>
    </Modal>
  )
}

/** Stat tile used by both the immediate post-run review and the persistent session banner — the single
 * most important UX surface in this phase (roadmap phase-t8 §3 / D9): make "how contained was this" visible
 * at a glance, not something the admin has to go dig for in a diff view. */
function StatTile({ value, label, tone }: { value: number; label: string; tone: 'rose' | 'emerald' | 'indigo' }) {
  const toneCls = tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'
  return (
    <div className="flex-1 rounded-2xl border border-black/[.08] dark:border-white/[.12] p-4 text-center">
      <p className={`text-[26px] font-bold tabular-nums leading-none ${toneCls}`}>{value}</p>
      <p className="mt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-black/45 dark:text-white/45">{label}</p>
    </div>
  )
}

const LOCK_LABEL: Record<TimetableLockType, string> = { SESSION: 'session', TEACHER: 'teacher', ROOM: 'room', COHORT: 'cohort', DAY: 'day', PERIOD: 'period', ASSIGNMENT: 'slot' }

/**
 * The one place "affected vs. untouched" is actually counted, from the new version's own persisted
 * `diffFromParent` — every entry that's genuinely different from the parent (including any incidental move
 * the SA polish step made as a side effect of fitting the directly-affected sessions back in, not just the
 * event's own seed sessions) counts as affected. Deliberately NOT the server's ephemeral `summary` fields:
 * those are only present on the just-run response, so a banner shown after a reload has nothing else to
 * recompute from — using this same diff-based definition in both places keeps the number honest and
 * consistent whether it's read seconds after the run or days later.
 */
function diffCounts(version: TimetableVersion): { affected: number; unaffected: number } {
  const diff = version.diffFromParent
  if (!diff) return { affected: 0, unaffected: version.entryCount }
  const affected = diff.added.length + diff.removed.length + diff.changed.length
  return { affected, unaffected: version.entryCount - diff.added.length - diff.changed.length }
}

/**
 * The review step: shows exactly how contained the just-computed patch was (the centerpiece stat strip),
 * any sessions the event wanted to move but a lock protected (genuinely untouched — surfaced, not hidden),
 * and anything left unplaced. Never a parallel approve/publish flow — the CTA hands off to the exact same
 * grid + VersionStatusBar T7 already built, now auto-showing this run's new GENERATED version.
 */
export function WhatIfReviewModal({ open, onClose, result, lookup, roomList, periods, onOpenInGrid }: {
  open: boolean
  onClose: () => void
  result: WhatIfResult | null
  lookup: EntryLookup
  roomList: Room[]
  periods: PeriodDef[]
  onOpenInGrid: () => void
}) {
  if (!result) return null
  const { summary, lockConflicts, unplaced, diagnostics, changeEvent } = result
  // Prefer the version's own persisted diff over the response's ephemeral summary counts — same source the
  // banner below uses on a later reload, so the number displayed here never contradicts itself over time.
  const { affected: affectedSessionCount, unaffected: unaffectedSessionCount } = diffCounts(result.item)
  const total = affectedSessionCount + unaffectedSessionCount
  const untouchedPct = total > 0 ? Math.round((unaffectedSessionCount / total) * 100) : 100
  return (
    <Modal open={open} onClose={onClose} title="What-If result — review before publishing" wide>
      <div className="space-y-5">
        <Card className="border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-500/30 dark:bg-indigo-500/[.06]">
          <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
            <Zap size={14} /> Minimal-patch summary — {untouchedPct}% of the timetable is untouched
          </p>
          <div className="flex gap-3">
            <StatTile value={affectedSessionCount} label="Sessions affected" tone="rose" />
            <StatTile value={unaffectedSessionCount} label="Sessions untouched" tone="emerald" />
            <StatTile value={summary.affectedCohorts.length} label="Cohorts impacted" tone="indigo" />
          </div>
          {summary.affectedCohorts.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Users size={12} className="text-indigo-500" />
              {summary.affectedCohorts.map(c => <Pill key={c.id} tone="indigo">{c.name}</Pill>)}
            </div>
          )}
        </Card>

        {lockConflicts.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-amber-800 dark:text-amber-300">
              <Lock size={14} /> {lockConflicts.length} session{lockConflicts.length === 1 ? '' : 's'} left exactly where {lockConflicts.length === 1 ? 'it is' : 'they are'} — protected by a lock
            </p>
            <ul className="space-y-1 text-[12.5px] text-amber-900/90 dark:text-amber-200/90">
              {lockConflicts.map((c, i) => {
                const period = periods.find(p => p.idx === c.entry.periodIdx)?.label ?? `period ${c.entry.periodIdx}`
                const room = c.entry.roomId ? roomList.find(r => r.id === c.entry.roomId)?.name : undefined
                return (
                  <li key={i}>
                    • {DAY_LABELS[c.entry.dayOfWeek]} {period}{c.entry.teacherId ? ` — ${lookup.userName(c.entry.teacherId) ?? 'teacher'}` : ''}{room ? ` · ${room}` : ''}
                    {' '}— a {LOCK_LABEL[c.lockType]} lock{c.reason ? ` (${c.reason})` : ''} still blocks moving this even though the change affects it; resolve by hand or release the lock and re-run.
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {diagnostics.length > 0 ? (
          <DiagnosticsPanel diagnostics={diagnostics} />
        ) : unplaced.length > 0 ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-500/30 dark:bg-rose-500/[.06]">
            <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-rose-700 dark:text-rose-300"><AlertTriangle size={14} /> Couldn't place {unplaced.length} session{unplaced.length === 1 ? '' : 's'}</p>
            <ul className="space-y-1 text-[12.5px] text-rose-900/90 dark:text-rose-200/90">
              {unplaced.map((u, i) => <li key={i}>• <span className="font-semibold">{u.classLabel}</span>{u.subjectName ? ` · ${u.subjectName}` : ''} — {u.reason}</li>)}
            </ul>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-[13px] font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={15} /> Every affected session was successfully re-placed with zero hard-constraint violations.</p>
        )}

        <p className="text-[11.5px] text-black/40 dark:text-white/40">Event: {describeEventClient(changeEvent)}. A new draft version has already been created (parented to the version you patched) — nothing is live yet.</p>

        <div className="flex gap-3 pt-1">
          <button onClick={onOpenInGrid} className="btn-ink flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-semibold">
            <GitBranch size={14} /> Open in Timetable Builder to review &amp; publish
          </button>
          <button onClick={onClose} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Close</button>
        </div>
      </div>
    </Modal>
  )
}

function describeEventClient(e: WhatIfChangeEvent): string {
  switch (e.type) {
    case 'TEACHER_UNAVAILABLE': return `teacher unavailable for ${e.slots.length} period(s)`
    case 'ROOM_UNAVAILABLE': return `room unavailable for ${e.slots.length} period(s)`
    case 'PERIOD_REMOVED': return `period removed (${DAY_LABELS[e.dayOfWeek]}, period ${e.periodIdx})`
    case 'EVENT_BLOCKING_SLOTS': return `school event blocking ${e.slots.length} slot(s)`
    case 'REQUIREMENT_ADDED': return 'teaching requirement increased'
    case 'REQUIREMENT_CHANGED': return 'teaching requirement changed'
  }
}

/**
 * Persistent reassurance banner: shown whenever the currently active edit-session version is itself the
 * product of a what-if run (`parentVersionId` set + a `What-if:` changeReason), computed straight from that
 * version's own stored `diffFromParent` — so the "X affected / Y untouched" summary survives a page reload
 * or coming back later, not just the one-time post-run modal. Not shown for an ordinary hand-forked draft.
 */
export function WhatIfVersionBanner({ version, cohortsByClassId }: { version: TimetableVersion; cohortsByClassId: Map<string, { id: string; name: string }[]> }) {
  if (!version.parentVersionId || !version.changeReason?.startsWith('What-if:') || !version.diffFromParent) return null
  const diff = version.diffFromParent
  const { affected, unaffected } = diffCounts(version)
  const touchedClassIds = new Set([...diff.added.map(e => e.classId), ...diff.removed.map(e => e.classId), ...diff.changed.map(c => c.after.classId)])
  const cohortMap = new Map<string, { id: string; name: string }>()
  for (const cid of touchedClassIds) for (const c of cohortsByClassId.get(cid) ?? []) cohortMap.set(c.id, c)
  const cohorts = [...cohortMap.values()]
  const total = affected + unaffected
  const pct = total > 0 ? Math.round((unaffected / total) * 100) : 100
  return (
    <Card className="mb-4 border-indigo-200 bg-indigo-50/40 p-3.5 dark:border-indigo-500/30 dark:bg-indigo-500/[.05]">
      <div className="flex flex-wrap items-center gap-2">
        <Zap size={14} className="shrink-0 text-indigo-500" />
        <p className="text-[12.5px] font-semibold text-indigo-800 dark:text-indigo-300">
          What-if patch — {pct}% untouched: <span className="tabular-nums">{affected}</span> session{affected === 1 ? '' : 's'} affected, <span className="tabular-nums">{unaffected}</span> untouched
          {cohorts.length > 0 && <>, impacting {cohorts.map(c => c.name).join(', ')}</>}
        </p>
      </div>
      <p className="mt-1 pl-[22px] text-[11px] text-indigo-700/70 dark:text-indigo-300/60">{version.changeReason}</p>
    </Card>
  )
}
