import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeftRight, CheckCircle2, GitBranch, History, Lock, MoveRight, RefreshCw, Undo2, Unlock } from 'lucide-react'
import type { PeriodDef, Room, TimetableEditEvent, TimetableLock, TimetableLockType, TimetableVersion, TimetableVersionStatus, VersionEntry } from '@/lib/data'
import { DAY_LABELS, cellKey, findBlockingLock, type EntryLookup } from '@/lib/hooks/useTimetable'
import type { OverrideCallResult } from '@/lib/hooks/useTimetable'
import { Card, Field, Modal, Pill, inputCls } from '../ui'

// Phase T7 — the management-override system (roadmap D10, the centerpiece of this phase). This file is the
// UI half of upgrading the existing Timetable Builder grid (timetableBuilder.tsx) in place: outside an edit
// session the grid behaves exactly as it did before this phase; once an admin starts a session (explicitly,
// or because the grid turned out to be governed by a PUBLISHED version and the legacy content-edit path was
// refused), these components take over cell interaction for that session. See
// .agents/edunova/phase-t7-versioning-override.md §4 and server/src/modules/timetable/overrides.ts.

const VERSION_TONE: Record<TimetableVersionStatus, 'slate' | 'amber' | 'sky' | 'green' | 'rose'> = {
  DRAFT: 'slate', GENERATED: 'slate', MODIFIED: 'amber', APPROVED: 'sky', PUBLISHED: 'green', ARCHIVED: 'rose',
}
const VERSION_LABEL: Record<TimetableVersionStatus, string> = {
  DRAFT: 'Draft', GENERATED: 'Draft (generated)', MODIFIED: 'Modified', APPROVED: 'Approved', PUBLISHED: 'Published', ARCHIVED: 'Archived',
}

/** A locked-slot badge for the grid cell — the clear visual indicator §4 calls for. Kept intentionally tiny
 * (icon + nothing else) since the full reason lives in the cell-actions modal, not the grid itself. */
export function LockBadge({ reason }: { reason?: string }) {
  return (
    <span title={reason ? `Locked — ${reason}` : 'Locked'} className="inline-flex items-center gap-1 rounded-full bg-rose-100 dark:bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-300">
      <Lock size={10} /> Locked
    </span>
  )
}

const conflictText = (c: { rule: string; classLabel: string; dayOfWeek: number; periodIdx: number; teacherId?: string; roomId?: string; lockReason?: string }, lookup: EntryLookup, roomList: Room[], periods: PeriodDef[]) => {
  const period = periods.find(p => p.idx === c.periodIdx)?.label ?? `period ${c.periodIdx}`
  const where = `${DAY_LABELS[c.dayOfWeek]} ${period}`
  if (c.rule === 'teacher') return `${lookup.userName(c.teacherId) ?? 'That teacher'} is already booked in ${c.classLabel} on ${where}.`
  if (c.rule === 'room') return `${roomList.find(r => r.id === c.roomId)?.name ?? 'That room'} is already booked by ${c.classLabel} on ${where}.`
  if (c.rule === 'locked') return `${c.classLabel}'s ${where} is locked${c.lockReason ? ` — ${c.lockReason}` : ''}.`
  return `${c.classLabel}'s ${where} is already occupied.`
}

/** Inline preview banner — the actual "live, real-time conflict detection AS THE ADMIN EDITS" surface.
 * Shown the moment a proposed move/swap would clash, computed via the same dryRun call the real save uses,
 * well before the admin commits to the change. */
function ConflictPreview({ checking, result, lookup, roomList, periods }: {
  checking: boolean
  result: OverrideCallResult | null
  lookup: EntryLookup
  roomList: Room[]
  periods: PeriodDef[]
}) {
  if (checking) return <p className="text-[12px] text-black/40 dark:text-white/40">Checking for clashes…</p>
  if (!result) return null
  if (result.error) return <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-rose-600 dark:text-rose-400"><AlertTriangle size={13} /> {result.error}</p>
  if (result.conflicts.length === 0) return <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={13} /> No clash — safe to apply</p>
  return (
    <div className="rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50/70 dark:bg-rose-500/10 p-3">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-rose-700 dark:text-rose-300"><AlertTriangle size={13} /> This would create {result.conflicts.length} clash{result.conflicts.length === 1 ? '' : 'es'}</p>
      <ul className="mt-1.5 space-y-1 text-[12px] text-rose-700/90 dark:text-rose-300/90">
        {result.conflicts.map((c, i) => <li key={i}>• {conflictText(c, lookup, roomList, periods)}</li>)}
      </ul>
    </div>
  )
}

/** Debounces a live dryRun preview call as the admin picks a target — fires ~300ms after the last change,
 * and ignores any answer that isn't for the most recent request (so a fast second pick can't be raced by a
 * slow first answer). Resets `checking`/`result` for a new `key` during render itself (React's documented
 * "adjusting state when a prop changes" pattern) rather than in a `useEffect` body, so the actual state
 * writes inside the effect only ever happen inside the async setTimeout/promise callbacks. */
function useLivePreview(compute: (() => Promise<OverrideCallResult>) | null, key: string) {
  const [state, setState] = useState<{ key: string; checking: boolean; result: OverrideCallResult | null }>({ key, checking: !!compute, result: null })
  if (state.key !== key) setState({ key, checking: !!compute, result: null })

  const seq = useRef(0)
  useEffect(() => {
    if (!compute) return
    const my = ++seq.current
    const t = window.setTimeout(() => {
      compute().then(r => { if (seq.current === my) setState(s => (s.key === key ? { ...s, checking: false, result: r } : s)) })
    }, 300)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { checking: state.key === key && state.checking, result: state.key === key ? state.result : null }
}

/** The per-cell action surface for an active edit session — replaces the plain content-edit modal's role
 * for any FILLED cell while a session is active (the override system has no "author new content" primitive,
 * only move/swap/regenerate-slot/lock — see phase-t7 §4 and overrides.ts's own doc comment on why). */
export function CellActionsModal({
  open, onClose, entry, classLabel, subjectName, teacherName, roomName, period, periods, days, sessionEntries,
  roomList, lookup, locks, createLock, releaseLock, lockBusy, move, swap, regenerateSlot, actionsBusy, onSaved,
}: {
  open: boolean
  onClose: () => void
  entry: VersionEntry
  classLabel: string
  subjectName: string
  teacherName?: string
  roomName?: string
  period: PeriodDef
  periods: PeriodDef[]
  days: number[]
  sessionEntries: VersionEntry[]
  roomList: Room[]
  lookup: EntryLookup
  locks: TimetableLock[]
  createLock: (body: { lockType: TimetableLockType; targetType?: string; targetId?: string; dayOfWeek?: number; periodIdx?: number; reason?: string }) => Promise<TimetableLock | null>
  releaseLock: (lockId: string, reason?: string) => Promise<boolean>
  lockBusy: boolean
  move: (body: { classId: string; fromDayOfWeek: number; fromPeriodIdx: number; toDayOfWeek: number; toPeriodIdx: number; reason?: string; dryRun?: boolean }) => Promise<OverrideCallResult>
  swap: (body: { a: { classId: string; dayOfWeek: number; periodIdx: number }; b: { classId: string; dayOfWeek: number; periodIdx: number }; reason?: string; dryRun?: boolean }) => Promise<OverrideCallResult>
  regenerateSlot: (body: { classId: string; dayOfWeek: number; periodIdx: number; reason?: string; dryRun?: boolean }) => Promise<OverrideCallResult>
  actionsBusy: 'move' | 'swap' | 'regenerate' | null
  onSaved: () => void
}) {
  // The parent only ever renders this modal while a cell is selected (`{sessionCell && <CellActionsModal .../>}`),
  // so it mounts fresh every time it's opened for a (possibly different) cell — plain `useState` initializers
  // already give each open a clean `menu` view seeded from that cell's own day/period, with no reset effect needed.
  const [mode, setMode] = useState<'menu' | 'move' | 'swap' | 'lock'>('menu')
  const [reason, setReason] = useState('')

  const classPeriods = useMemo(() => periods.filter(p => p.kind === 'class'), [periods])
  const [toDay, setToDay] = useState(entry.dayOfWeek)
  const [toPeriod, setToPeriod] = useState(entry.periodIdx)

  const otherSlots = useMemo(() => sessionEntries.filter(e => !(e.dayOfWeek === entry.dayOfWeek && e.periodIdx === entry.periodIdx)), [sessionEntries, entry])
  const [swapKey, setSwapKey] = useState('')
  const swapTarget = useMemo(() => otherSlots.find(e => cellKey(e.dayOfWeek, e.periodIdx) === swapKey), [otherSlots, swapKey])

  const movePreview = useLivePreview(
    mode === 'move' && (toDay !== entry.dayOfWeek || toPeriod !== entry.periodIdx)
      ? () => move({ classId: entry.classId, fromDayOfWeek: entry.dayOfWeek, fromPeriodIdx: entry.periodIdx, toDayOfWeek: toDay, toPeriodIdx: toPeriod, dryRun: true })
      : null,
    `${toDay}-${toPeriod}`,
  )
  const swapPreview = useLivePreview(
    mode === 'swap' && swapTarget
      ? () => swap({ a: { classId: entry.classId, dayOfWeek: entry.dayOfWeek, periodIdx: entry.periodIdx }, b: { classId: swapTarget.classId, dayOfWeek: swapTarget.dayOfWeek, periodIdx: swapTarget.periodIdx }, dryRun: true })
      : null,
    swapKey,
  )

  const directLock = locks.find(l => l.lockType === 'ASSIGNMENT' && l.targetId === entry.classSubjectId && l.dayOfWeek === entry.dayOfWeek && l.periodIdx === entry.periodIdx)
  const blockingLock = directLock ?? findBlockingLock(locks, entry)

  const confirmMove = async () => {
    const res = await move({ classId: entry.classId, fromDayOfWeek: entry.dayOfWeek, fromPeriodIdx: entry.periodIdx, toDayOfWeek: toDay, toPeriodIdx: toPeriod, reason: reason || undefined })
    if (res.ok) onClose()
  }
  const confirmSwap = async () => {
    if (!swapTarget) return
    const res = await swap({ a: { classId: entry.classId, dayOfWeek: entry.dayOfWeek, periodIdx: entry.periodIdx }, b: { classId: swapTarget.classId, dayOfWeek: swapTarget.dayOfWeek, periodIdx: swapTarget.periodIdx }, reason: reason || undefined })
    if (res.ok) onClose()
  }
  const [regenResult, setRegenResult] = useState<OverrideCallResult | null>(null)
  const runRegenerate = async () => {
    setRegenResult(null)
    const preview = await regenerateSlot({ classId: entry.classId, dayOfWeek: entry.dayOfWeek, periodIdx: entry.periodIdx, dryRun: true })
    if (!preview.ok) { setRegenResult(preview); return }
    const res = await regenerateSlot({ classId: entry.classId, dayOfWeek: entry.dayOfWeek, periodIdx: entry.periodIdx, reason: reason || undefined })
    setRegenResult(res)
    if (res.ok) onSaved()
  }

  const toggleLock = async () => {
    if (directLock) { await releaseLock(directLock.id, reason || undefined) }
    else await createLock({ lockType: 'ASSIGNMENT', targetType: 'classSubjectId', targetId: entry.classSubjectId, dayOfWeek: entry.dayOfWeek, periodIdx: entry.periodIdx, reason: reason || undefined })
  }

  return (
    <Modal open={open} onClose={onClose} title={`${DAY_LABELS[entry.dayOfWeek]} · ${period.label} — ${classLabel}`}>
      <div className="space-y-4">
        <div className="rounded-xl bg-black/[.03] dark:bg-white/[.05] p-3">
          <p className="text-[13.5px] font-semibold">{subjectName}</p>
          <p className="text-[12px] text-black/50 dark:text-white/50">{teacherName ?? 'No teacher'}{roomName ? ` · ${roomName}` : ''}</p>
          {blockingLock && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-rose-600 dark:text-rose-400">
              <Lock size={12} /> {blockingLock.lockType === directLock?.lockType && directLock ? 'Locked' : `Blocked by a ${blockingLock.lockType.toLowerCase()} lock`}
              {blockingLock.reason ? ` — ${blockingLock.reason}` : ''}
            </p>
          )}
        </div>

        {mode === 'menu' && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode('move')} className="flex flex-col items-start gap-1 rounded-xl border border-black/10 dark:border-white/15 p-3 text-left hover:bg-black/[.03] dark:hover:bg-white/[.05]">
              <MoveRight size={16} className="text-indigo-500" /><span className="text-[13px] font-semibold">Move…</span><span className="text-[11px] text-black/45 dark:text-white/45">To another day/period</span>
            </button>
            <button onClick={() => setMode('swap')} disabled={otherSlots.length === 0} className="flex flex-col items-start gap-1 rounded-xl border border-black/10 dark:border-white/15 p-3 text-left hover:bg-black/[.03] dark:hover:bg-white/[.05] disabled:opacity-40">
              <ArrowLeftRight size={16} className="text-indigo-500" /><span className="text-[13px] font-semibold">Swap with…</span><span className="text-[11px] text-black/45 dark:text-white/45">Exchange with another period</span>
            </button>
            <button onClick={runRegenerate} disabled={actionsBusy === 'regenerate'} className="flex flex-col items-start gap-1 rounded-xl border border-black/10 dark:border-white/15 p-3 text-left hover:bg-black/[.03] dark:hover:bg-white/[.05] disabled:opacity-40">
              <RefreshCw size={16} className="text-indigo-500" /><span className="text-[13px] font-semibold">{actionsBusy === 'regenerate' ? 'Regenerating…' : 'Regenerate room'}</span><span className="text-[11px] text-black/45 dark:text-white/45">Re-pick the best available room</span>
            </button>
            <button onClick={() => setMode('lock')} disabled={lockBusy} className="flex flex-col items-start gap-1 rounded-xl border border-black/10 dark:border-white/15 p-3 text-left hover:bg-black/[.03] dark:hover:bg-white/[.05] disabled:opacity-40">
              {directLock ? <Unlock size={16} className="text-rose-500" /> : <Lock size={16} className="text-indigo-500" />}
              <span className="text-[13px] font-semibold">{directLock ? 'Unlock this slot' : 'Lock this slot'}</span>
              <span className="text-[11px] text-black/45 dark:text-white/45">{directLock ? 'Allow it to be changed again' : 'Protect it from further moves'}</span>
            </button>
          </div>
        )}

        {regenResult && (
          <ConflictPreview checking={false} result={regenResult} lookup={lookup} roomList={roomList} periods={periods} />
        )}

        {mode === 'move' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Day">
                <select value={toDay} onChange={e => setToDay(Number(e.target.value))} className={inputCls}>
                  {days.map(d => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
                </select>
              </Field>
              <Field label="Period">
                <select value={toPeriod} onChange={e => setToPeriod(Number(e.target.value))} className={inputCls}>
                  {classPeriods.map(p => <option key={p.idx} value={p.idx}>{p.label} ({p.start}–{p.end})</option>)}
                </select>
              </Field>
            </div>
            <ConflictPreview {...movePreview} lookup={lookup} roomList={roomList} periods={periods} />
            <Field label="Reason (optional)"><input value={reason} onChange={e => setReason(e.target.value)} className={inputCls} placeholder="e.g. avoid clash with assembly" /></Field>
            <div className="flex gap-3">
              <button onClick={confirmMove} disabled={actionsBusy === 'move' || (toDay === entry.dayOfWeek && toPeriod === entry.periodIdx) || !!movePreview.result?.conflicts.length || !!movePreview.result?.error}
                className="btn-ink flex-1 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">{actionsBusy === 'move' ? 'Moving…' : 'Confirm Move'}</button>
              <button onClick={() => setMode('menu')} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-4 py-2.5 text-[13.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Back</button>
            </div>
          </div>
        )}

        {mode === 'swap' && (
          <div className="space-y-3">
            <Field label="Swap with">
              <select value={swapKey} onChange={e => setSwapKey(e.target.value)} className={inputCls}>
                <option value="">— choose a period —</option>
                {otherSlots.map(e => (
                  <option key={cellKey(e.dayOfWeek, e.periodIdx)} value={cellKey(e.dayOfWeek, e.periodIdx)}>
                    {DAY_LABELS[e.dayOfWeek]} · {periods.find(p => p.idx === e.periodIdx)?.label ?? e.periodIdx}
                  </option>
                ))}
              </select>
            </Field>
            {swapKey && <ConflictPreview {...swapPreview} lookup={lookup} roomList={roomList} periods={periods} />}
            <Field label="Reason (optional)"><input value={reason} onChange={e => setReason(e.target.value)} className={inputCls} /></Field>
            <div className="flex gap-3">
              <button onClick={confirmSwap} disabled={actionsBusy === 'swap' || !swapTarget || !!swapPreview.result?.conflicts.length || !!swapPreview.result?.error}
                className="btn-ink flex-1 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">{actionsBusy === 'swap' ? 'Swapping…' : 'Confirm Swap'}</button>
              <button onClick={() => setMode('menu')} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-4 py-2.5 text-[13.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Back</button>
            </div>
          </div>
        )}

        {mode === 'lock' && (
          <div className="space-y-3">
            <Field label={directLock ? 'Reason for unlocking (optional)' : 'Reason for locking (optional)'}>
              <input value={reason} onChange={e => setReason(e.target.value)} className={inputCls} placeholder={directLock ? '' : 'e.g. finalized — do not move'} />
            </Field>
            <div className="flex gap-3">
              <button onClick={async () => { await toggleLock(); onClose() }} disabled={lockBusy}
                className={`flex-1 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold disabled:opacity-40 ${directLock ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 hover:bg-rose-100' : 'btn-ink'}`}>
                {lockBusy ? 'Saving…' : directLock ? 'Unlock' : 'Lock'}
              </button>
              <button onClick={() => setMode('menu')} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-4 py-2.5 text-[13.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Back</button>
            </div>
          </div>
        )}

        {mode === 'menu' && <button onClick={onClose} className="w-full rounded-xl bg-black/[.05] dark:bg-white/[.07] px-4 py-2.5 text-[13.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Close</button>}
      </div>
    </Modal>
  )
}

/** The session status bar — replaces the plain toolbar's save/discard/publish row while an edit session is
 * active. Always states the version's status in plain language (§4's requirement that a published timetable
 * being edited make "this creates a new draft version" obvious, not silent) plus Undo/History/Approve/
 * Publish/Discard, matching this app's existing ghost-button toolbar language. */
export function VersionStatusBar({
  version, onApprove, onPublish, onDiscard, versionBusy, onUndo, undoBusy, onShowHistory, onShowLocks, activeLockCount,
}: {
  version: TimetableVersion
  onApprove: () => void
  onPublish: () => void
  onDiscard: () => void
  versionBusy: 'fork' | 'approve' | 'publish' | 'discard' | null
  onUndo: () => void
  undoBusy: boolean
  onShowHistory: () => void
  onShowLocks: () => void
  activeLockCount: number
}) {
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-2 p-3.5">
      <GitBranch size={15} className="text-indigo-500" />
      <span className="text-[13px] font-semibold">Edit session</span>
      <Pill tone={VERSION_TONE[version.status]}>{VERSION_LABEL[version.status]}</Pill>
      {version.parentVersionId && <span className="text-[11.5px] text-black/45 dark:text-white/45">forked from a published version — nothing live changes until you publish</span>}
      <span className="flex-1" />
      <button onClick={onShowLocks} className="flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06]">
        <Lock size={12} /> Locks{activeLockCount > 0 ? ` (${activeLockCount})` : ''}
      </button>
      <button onClick={onShowHistory} className="flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06]">
        <History size={12} /> History
      </button>
      <button onClick={onUndo} disabled={undoBusy} className="flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40">
        <Undo2 size={12} /> {undoBusy ? 'Undoing…' : 'Undo last change'}
      </button>
      <button onClick={onDiscard} disabled={!!versionBusy} className="rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-40">
        {versionBusy === 'discard' ? 'Discarding…' : 'Discard draft'}
      </button>
      {version.status !== 'APPROVED' && (
        <button onClick={onApprove} disabled={!!versionBusy} className="rounded-full bg-black/[.06] dark:bg-white/[.08] px-3.5 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">
          {versionBusy === 'approve' ? 'Approving…' : 'Approve draft'}
        </button>
      )}
      {version.status === 'APPROVED' && (
        <button onClick={onPublish} disabled={!!versionBusy} className="btn-ink flex items-center gap-1.5 px-4 py-2 text-[12.5px] font-semibold disabled:opacity-40">
          <CheckCircle2 size={13} /> {versionBusy === 'publish' ? 'Publishing…' : 'Publish'}
        </button>
      )}
    </Card>
  )
}

/** Shown when the grid turned out to be governed by a PUBLISHED version and the legacy content-edit save
 * was refused (409) — makes the "you need to start an edit session, which creates a new draft version"
 * implication explicit rather than a bare error toast (§4's non-negotiable "not silent" requirement). */
export function PublishedImmutableBanner({ onStartSession, busy }: { onStartSession: () => void; busy: boolean }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-sky-200 dark:border-sky-500/30 bg-sky-50/70 dark:bg-sky-500/10 p-4">
      <Lock size={16} className="shrink-0 text-sky-600 dark:text-sky-400" />
      <p className="flex-1 text-[13px] text-sky-800 dark:text-sky-300">
        This timetable is <strong>published</strong> and can't be hand-edited directly. Starting an edit session creates a new <strong>draft version</strong> — nothing live changes until you review and publish it.
      </p>
      <button onClick={onStartSession} disabled={busy} className="btn-ink shrink-0 px-4 py-2 text-[12.5px] font-semibold disabled:opacity-40">{busy ? 'Starting…' : 'Start Edit Session'}</button>
    </div>
  )
}

export function LocksPanel({ open, onClose, locks, releaseLock, lockBusy, teacherOptions, roomOptions, createLock, days }: {
  open: boolean
  onClose: () => void
  locks: TimetableLock[]
  releaseLock: (lockId: string, reason?: string) => Promise<boolean>
  lockBusy: boolean
  teacherOptions: { id: string; name: string }[]
  roomOptions: Room[]
  createLock: (body: { lockType: TimetableLockType; targetType?: string; targetId?: string; dayOfWeek?: number; periodIdx?: number; reason?: string }) => Promise<TimetableLock | null>
  days: number[]
}) {
  const [newType, setNewType] = useState<TimetableLockType>('TEACHER')
  const [targetId, setTargetId] = useState('')
  const [dayOfWeek, setDayOfWeek] = useState(days[0] ?? 1)
  const [reason, setReason] = useState('')

  const add = async () => {
    const body: Parameters<typeof createLock>[0] = { lockType: newType, reason: reason || undefined }
    if (newType === 'TEACHER') { body.targetType = 'teacherId'; body.targetId = targetId }
    if (newType === 'ROOM') { body.targetType = 'roomId'; body.targetId = targetId }
    if (newType === 'DAY') { body.targetType = 'none'; body.dayOfWeek = dayOfWeek }
    if (!body.targetId && (newType === 'TEACHER' || newType === 'ROOM')) return
    const out = await createLock(body)
    if (out) { setTargetId(''); setReason('') }
  }

  return (
    <Modal open={open} onClose={onClose} title="Locks for this edit session" wide>
      <div className="space-y-4">
        <p className="text-[12.5px] text-black/50 dark:text-white/50">
          A lock blocks any move/swap that would touch its target — a whole day, a specific teacher or room anywhere in this version, or (from a cell's own menu) one exact slot.
        </p>

        {locks.length === 0 ? (
          <p className="rounded-xl bg-black/[.03] dark:bg-white/[.05] p-4 text-center text-[13px] text-black/45 dark:text-white/45">No active locks yet.</p>
        ) : (
          <div className="space-y-2">
            {locks.map(l => (
              <div key={l.id} className="flex items-center gap-2.5 rounded-xl border border-black/10 dark:border-white/15 p-3">
                <Lock size={14} className="shrink-0 text-rose-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">
                    {l.lockType}{l.dayOfWeek ? ` · ${DAY_LABELS[l.dayOfWeek]}` : ''}{l.periodIdx != null ? ` P${l.periodIdx}` : ''}
                    {l.lockType === 'TEACHER' && l.targetId && ` · ${teacherOptions.find(t => t.id === l.targetId)?.name ?? l.targetId}`}
                    {l.lockType === 'ROOM' && l.targetId && ` · ${roomOptions.find(r => r.id === l.targetId)?.name ?? l.targetId}`}
                  </p>
                  {l.reason && <p className="truncate text-[11.5px] text-black/45 dark:text-white/45">{l.reason}</p>}
                </div>
                <button onClick={() => releaseLock(l.id)} disabled={lockBusy} className="shrink-0 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Unlock</button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-black/[.06] dark:border-white/[.08] pt-4">
          <p className="mb-2.5 text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Add a lock</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={newType} onChange={e => setNewType(e.target.value as TimetableLockType)} className={inputCls}>
                <option value="TEACHER">Teacher</option>
                <option value="ROOM">Room</option>
                <option value="DAY">Whole day</option>
              </select>
            </Field>
            {newType === 'TEACHER' && (
              <Field label="Teacher">
                <select value={targetId} onChange={e => setTargetId(e.target.value)} className={inputCls}>
                  <option value="">— choose —</option>
                  {teacherOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            )}
            {newType === 'ROOM' && (
              <Field label="Room">
                <select value={targetId} onChange={e => setTargetId(e.target.value)} className={inputCls}>
                  <option value="">— choose —</option>
                  {roomOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
            )}
            {newType === 'DAY' && (
              <Field label="Day">
                <select value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))} className={inputCls}>
                  {days.map(d => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field label="Reason (optional)"><input value={reason} onChange={e => setReason(e.target.value)} className={`${inputCls} mt-2`} /></Field>
          <button onClick={add} disabled={lockBusy} className="btn-ink mt-3 w-full py-2.5 text-[13px] font-semibold disabled:opacity-40">{lockBusy ? 'Locking…' : 'Add Lock'}</button>
        </div>
      </div>
    </Modal>
  )
}

const ACTION_LABEL: Record<TimetableEditEvent['action'], string> = { MOVE: 'Moved', SWAP: 'Swapped', LOCK: 'Locked', UNLOCK: 'Unlocked', REGENERATE_SLOT: 'Regenerated room', UNDO: 'Undo' }

export function HistoryPanel({ open, onClose, events, onRevertTo, revertBusy }: {
  open: boolean
  onClose: () => void
  events: TimetableEditEvent[]
  onRevertTo: (seq: number) => void
  revertBusy: boolean
}) {
  return (
    <Modal open={open} onClose={onClose} title="Edit history for this version" wide>
      {events.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-black/45 dark:text-white/45">No hand-edits yet this session.</p>
      ) : (
        <div className="thin-scroll max-h-[60vh] space-y-2 overflow-y-auto">
          {[...events].reverse().map(e => (
            <div key={e.id} className={`rounded-xl border p-3 ${e.undone ? 'border-black/[.06] dark:border-white/[.08] opacity-50' : 'border-black/10 dark:border-white/15'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold tabular-nums text-black/40 dark:text-white/40">#{e.seq}</span>
                <Pill tone={e.action === 'UNDO' ? 'amber' : 'slate'}>{ACTION_LABEL[e.action]}</Pill>
                {e.undone && <Pill tone="rose">Undone</Pill>}
                <span className="text-[11px] text-black/40 dark:text-white/40">{new Date(e.createdAt).toLocaleString()}</span>
                <span className="flex-1" />
                {!e.undone && e.action !== 'UNDO' && (
                  <button onClick={() => onRevertTo(e.seq - 1)} disabled={revertBusy} className="rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1 text-[11.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Revert to before this</button>
                )}
              </div>
              {e.reason && <p className="mt-1 text-[12px] text-black/55 dark:text-white/55">{e.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
