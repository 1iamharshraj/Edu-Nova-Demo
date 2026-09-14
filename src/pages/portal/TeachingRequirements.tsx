import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Info, Plus, Sparkles, Sprout, Trash2, Users, X } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/lib/theme'
import { useAcademic, useStore } from '@/lib/store'
import { useEntity } from '@/lib/hooks/useEntity'
import {
  useResolveAssignment, useSetAssignmentMode, useTeachingAssignmentPool, useTeachingAssignments, useTeachingRequirements,
} from '@/lib/hooks/useTimetable'
import type { AssignmentMode, RoomRequirementKind, SessionDuration, TeachingAssignment } from '@/lib/data'
import { Card, Empty, PageHead, Pill, inputCls } from '@/portal/ui'
import { AsyncEntityPicker } from '@/portal/components/AsyncEntityPicker'
import { dangerBtn, ghostBtn, muted, sectionLabel, swatch } from '@/portal/modules/academicShared'

// Phase T4 §1/§2 (.agents/edunova/phase-t4-solver-core.md) — a cohort's declared weekly teaching need per
// subject, plus the Mode-1-Fixed teacher assignment for it. Built as a real routed page (not a modal), the
// same call as ClassSubjects.tsx: one cohort's requirement list is itself a small stateful editor (add form
// + per-row duration/room-requirement/teacher editing), matching that page's shape closely on purpose — this
// is functionally the Cohort-scoped generalization of "Subjects & teachers" per roadmap D2/D9.

const DURATIONS: { value: SessionDuration; label: string }[] = [
  { value: 'SINGLE', label: 'Single period' },
  { value: 'DOUBLE', label: 'Double period' },
  { value: 'TRIPLE', label: 'Triple period' },
  { value: 'BLOCK', label: 'Block' },
]
const ROOM_REQS: { value: RoomRequirementKind; label: string }[] = [
  { value: 'ANY', label: 'Any room' },
  { value: 'LAB_TYPE', label: 'Any lab' },
  { value: 'SPECIFIC_ROOM', label: 'Specific room' },
]
// Phase T5 §1 (.agents/edunova/phase-t5-full-solver.md) — Modes 2-4 widen T4's Fixed-only assignment.
const MODES: { value: AssignmentMode; label: string; hint: string }[] = [
  { value: 'FIXED', label: 'Fixed', hint: 'Pick the exact teacher yourself' },
  { value: 'POOL', label: 'Pool', hint: 'Solver picks from a set you define, lowest workload first' },
  { value: 'RANDOM', label: 'Random', hint: 'Solver picks at random among qualified teachers' },
  { value: 'OPTIMIZED', label: 'Optimized', hint: 'Solver scores every qualified teacher and picks the best fit' },
]
const modeTone = { FIXED: 'slate', POOL: 'sky', RANDOM: 'amber', OPTIMIZED: 'indigo' } as const

export default function TeachingRequirements() {
  const { id: cohortId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { db } = useStore()
  const { subjectById, subjects: allSubjects, rooms, currentTerm } = useAcademic()
  const cohorts = useEntity('cohorts')
  const cohort = cohorts.items.find(c => c.id === cohortId) ?? null

  const reqs = useTeachingRequirements(cohortId)
  const asg = useTeachingAssignments()
  const modeSvc = useSetAssignmentMode(() => { reqs.reload() })

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  const sortedSubjects = useMemo(() => [...allSubjects].sort(byName), [allSubjects])
  const sortedRooms = useMemo(() => [...rooms].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [rooms])
  const userById = useMemo(() => new Map(db.users.map(u => [u.id, u])), [db.users])

  const rows = useMemo(() =>
    reqs.items
      .map(r => ({ req: r, subject: subjectById.get(r.subjectId), assignment: asg.byRequirement.get(r.id) }))
      .sort((a, b) => (a.subject?.name ?? '').localeCompare(b.subject?.name ?? '')),
  [reqs.items, subjectById, asg.byRequirement])
  const addableSubjects = useMemo(() => {
    const has = new Set(rows.map(r => r.req.subjectId))
    return sortedSubjects.filter(s => !has.has(s.id))
  }, [rows, sortedSubjects])
  const totalPeriods = rows.reduce((sum, r) => sum + r.req.requiredPeriodsPerWeek, 0)
  const busyRows = reqs.busy || asg.busy

  // add-requirement form
  const [addSubjectId, setAddSubjectId] = useState('')
  const [addPeriods, setAddPeriods] = useState('5')
  const [addDuration, setAddDuration] = useState<SessionDuration>('SINGLE')
  const [addRoomReq, setAddRoomReq] = useState<RoomRequirementKind>('ANY')
  const [addRoomId, setAddRoomId] = useState('')
  const addValid = !!addSubjectId && Number(addPeriods) > 0 && (addRoomReq !== 'SPECIFIC_ROOM' || !!addRoomId)
  const addRequirement = async () => {
    if (!addValid) return
    const out = await reqs.create({
      subjectId: addSubjectId, requiredPeriodsPerWeek: Number(addPeriods), sessionDuration: addDuration,
      roomRequirement: addRoomReq, specificRoomId: addRoomReq === 'SPECIFIC_ROOM' ? addRoomId : undefined,
      labDoubleAllowed: true,
    }, 'Teaching requirement added')
    if (out) { setAddSubjectId(''); setAddPeriods('5'); setAddDuration('SINGLE'); setAddRoomReq('ANY'); setAddRoomId('') }
  }

  const [periodsDraft, setPeriodsDraft] = useState<Record<string, string>>({})
  const commitPeriods = async (id: string, current: number) => {
    const draft = periodsDraft[id]
    if (draft === undefined) return
    setPeriodsDraft(d => { const { [id]: _, ...rest } = d; void _; return rest })
    const n = parseInt(draft, 10)
    if (!Number.isFinite(n) || n <= 0 || n === current) return
    await reqs.update(id, { requiredPeriodsPerWeek: n }, 'Periods updated')
  }

  const [seeding, setSeeding] = useState(false)
  const seedFromClassSubjects = async () => {
    if (!cohort) return
    setSeeding(true)
    try { await reqs.seedFromClassSubjects(cohort.academicYearId, 'Seeded from existing subjects') } finally { setSeeding(false) }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f6f4] dark:bg-[#090911]">
      <header className="glass-nav">
        <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-6">
          <Link to="/portal"><Logo /></Link>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-[14px] font-medium text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">
              <ArrowLeft size={16} /> Back
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
        {!cohort ? (
          <Empty text="Cohort not found." />
        ) : (
          <>
            <PageHead title={`Teaching Requirements · ${cohort.name}`} sub="What this cohort needs taught each week, and who's assigned to teach it — feeds the Timetable Builder's Auto-Generate." />
            <Card>
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={muted}>{cohort.classLabels.join(', ') || '—'}</span>
                    <span className={muted}>· {rows.length} requirement{rows.length === 1 ? '' : 's'} · {totalPeriods} periods/week</span>
                  </div>
                  {cohort.autoGenerated && (
                    <button onClick={seedFromClassSubjects} disabled={busyRows || seeding} className={ghostBtn} title="Creates a requirement for every subject this cohort's class already has, matching its existing periods/week and teacher">
                      <span className="flex items-center gap-1.5"><Sprout size={12} className={seeding ? 'animate-pulse' : ''} /> Seed from existing subjects</span>
                    </button>
                  )}
                </div>

                <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4">
                  <p className={`mb-3 ${sectionLabel}`}>Add requirement</p>
                  {sortedSubjects.length === 0 ? (
                    <p className="text-[13.5px] text-black/50 dark:text-white/50">The subject catalogue is empty — add subjects under Curriculum first.</p>
                  ) : addableSubjects.length === 0 ? (
                    <p className="text-[13.5px] text-black/50 dark:text-white/50">Every catalogue subject already has a requirement for this cohort.</p>
                  ) : (
                    <div className="flex flex-wrap items-end gap-3">
                      <select value={addSubjectId} onChange={e => setAddSubjectId(e.target.value)} className={inputCls + ' min-w-[180px] flex-1'}>
                        <option value="">Select a subject…</option>
                        {addableSubjects.map(s => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}
                      </select>
                      <input type="number" min={1} value={addPeriods} onChange={e => setAddPeriods(e.target.value)} className={inputCls + ' w-24'} aria-label="Periods per week" title="Periods per week" />
                      <select value={addDuration} onChange={e => setAddDuration(e.target.value as SessionDuration)} className={inputCls + ' w-auto min-w-[140px]'} aria-label="Session duration">
                        {DURATIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                      <select value={addRoomReq} onChange={e => setAddRoomReq(e.target.value as RoomRequirementKind)} className={inputCls + ' w-auto min-w-[140px]'} aria-label="Room requirement">
                        {ROOM_REQS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                      {addRoomReq === 'SPECIFIC_ROOM' && (
                        <select value={addRoomId} onChange={e => setAddRoomId(e.target.value)} className={inputCls + ' w-auto min-w-[140px]'} aria-label="Room">
                          <option value="">Select room…</option>
                          {sortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      )}
                      <button onClick={addRequirement} disabled={!addValid || busyRows} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
                        <Plus size={15} /> Add
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <p className={`mb-2 ${sectionLabel}`}>Requirements · {rows.length}</p>
                  {rows.length === 0 ? (
                    <Empty text="No teaching requirements yet. Add one above, or seed from the cohort's existing subjects." />
                  ) : (
                    <div className="divide-y divide-black/[.05] dark:divide-white/[.07] rounded-2xl border border-black/[.06] dark:border-white/[.08]">
                      <div className="hidden grid-cols-[minmax(0,1fr)_80px_130px_150px_120px_minmax(220px,1fr)_36px] items-center gap-3 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 sm:grid">
                        <span>Subject</span><span>Periods</span><span>Duration</span><span>Room</span><span>Mode</span><span>Assignment</span><span />
                      </div>
                      {rows.map(({ req, subject, assignment }) => (
                        <div key={req.id} className="grid grid-cols-[minmax(0,1fr)_36px] items-start gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_80px_130px_150px_120px_minmax(220px,1fr)_36px] sm:items-center">
                          <div className="flex min-w-0 items-center gap-3">
                            {swatch(subject?.color ?? '#94a3b8')}
                            <div className="min-w-0">
                              <p className="truncate text-[14px] font-semibold">{subject?.name ?? 'Unknown subject'}</p>
                              <p className={muted}>{subject?.code || '—'}</p>
                            </div>
                          </div>

                          <div className="order-last col-span-2 grid grid-cols-2 gap-3 sm:order-none sm:col-span-5 sm:contents">
                            <input type="number" min={1} value={periodsDraft[req.id] ?? String(req.requiredPeriodsPerWeek)}
                              onChange={e => setPeriodsDraft(d => ({ ...d, [req.id]: e.target.value }))}
                              onBlur={() => commitPeriods(req.id, req.requiredPeriodsPerWeek)}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                              disabled={busyRows} className={inputCls + ' py-2 text-[13.5px]'} aria-label="Periods per week" />

                            <select value={req.sessionDuration} onChange={e => reqs.update(req.id, { sessionDuration: e.target.value as SessionDuration }, 'Duration updated')}
                              disabled={busyRows} className={inputCls + ' py-2 text-[13px]'} aria-label="Session duration">
                              {DURATIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                            </select>

                            <div className="space-y-1.5">
                              <select value={req.roomRequirement}
                                onChange={e => reqs.update(req.id, { roomRequirement: e.target.value as RoomRequirementKind, specificRoomId: (e.target.value === 'SPECIFIC_ROOM' ? req.specificRoomId ?? null : null) as unknown as string }, 'Room requirement updated')}
                                disabled={busyRows} className={inputCls + ' py-2 text-[13px]'} aria-label="Room requirement">
                                {ROOM_REQS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                              </select>
                              {req.roomRequirement === 'SPECIFIC_ROOM' && (
                                <select value={req.specificRoomId ?? ''} onChange={e => reqs.update(req.id, { specificRoomId: (e.target.value || null) as unknown as string }, 'Room updated')}
                                  disabled={busyRows} className={inputCls + ' py-1.5 text-[12.5px]'} aria-label="Specific room">
                                  <option value="">Select room…</option>
                                  {sortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                              )}
                            </div>

                            <select value={req.assignmentMode ?? 'FIXED'}
                              onChange={e => modeSvc.setMode(req.id, e.target.value as AssignmentMode)}
                              disabled={busyRows || modeSvc.busy} className={inputCls + ' py-2 text-[13px]'} aria-label="Assignment mode" title="How this requirement's teacher gets chosen">
                              {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>

                            <AssignmentCell req={req} assignment={assignment} teacherName={assignment ? userById.get(assignment.teacherId)?.name : undefined}
                              busy={busyRows} termId={currentTerm?.id} onAssign={teacherId => asg.assign(req.id, teacherId)} onUnassign={id => asg.unassign(id)}
                              onResolved={() => asg.reload()} />
                          </div>

                          <button onClick={() => reqs.remove(req.id, 'Requirement removed')} disabled={busyRows} className={dangerBtn} aria-label="Remove requirement"><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  )
}

const iconTiny = 'shrink-0 rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-30'

/**
 * Phase T5 §1 — the per-requirement assignment surface, now mode-aware. FIXED keeps T4's direct
 * AsyncEntityPicker; POOL/RANDOM/OPTIMIZED resolve server-side (POST .../resolve) and — the phase's
 * explicit explainability ask — always show the resulting `selectionReason` in full, not tucked behind a
 * tooltip. POOL additionally needs its own eligible-teacher set managed right here, since that set is what
 * the resolver actually picks from.
 */
function AssignmentCell({ req, assignment, teacherName, busy, termId, onAssign, onUnassign, onResolved }: {
  req: { id: string; assignmentMode?: AssignmentMode }
  assignment?: TeachingAssignment
  teacherName?: string
  busy: boolean
  termId?: string
  onAssign: (teacherId: string) => void
  onUnassign: (assignmentId: string) => void
  onResolved: () => void
}) {
  const mode = req.assignmentMode ?? 'FIXED'
  const { busy: resolving, resolve } = useResolveAssignment(onResolved)
  const runResolve = () => termId && resolve(req.id, termId)

  if (mode === 'FIXED') {
    return assignment ? (
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1 rounded-xl bg-black/[.04] dark:bg-white/[.06] px-3 py-2 text-[13px] font-medium">
          <span className="truncate">{teacherName ?? 'Teacher'}</span>
        </div>
        <button onClick={() => onUnassign(assignment.id)} disabled={busy} className={iconTiny} aria-label="Remove assignment" title="Remove assignment"><X size={13} /></button>
      </div>
    ) : (
      <AsyncEntityPicker role="teacher" value="" onChange={id => id && onAssign(id)} placeholder="Assign teacher…" />
    )
  }

  return (
    <div className="space-y-2 py-1">
      {assignment ? (
        <div className="space-y-1.5 rounded-xl bg-black/[.04] dark:bg-white/[.06] p-2.5">
          <div className="flex items-center gap-1.5">
            <Pill tone={modeTone[mode]}>{mode === 'OPTIMIZED' && <Sparkles size={10} />}{mode[0] + mode.slice(1).toLowerCase()}</Pill>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{teacherName ?? 'Teacher'}</span>
            <button onClick={() => onUnassign(assignment.id)} disabled={busy} className={iconTiny} aria-label="Remove assignment" title="Remove assignment"><X size={13} /></button>
          </div>
          {assignment.selectionReason && (
            <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-black/55 dark:text-white/55">
              <Info size={12} className="mt-[1px] shrink-0" /> <span className="break-words">{assignment.selectionReason}</span>
            </p>
          )}
          <button onClick={runResolve} disabled={busy || resolving || !termId} className="text-[11.5px] font-semibold text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-400">
            {resolving ? 'Re-resolving…' : 'Re-resolve'}
          </button>
        </div>
      ) : (
        <button onClick={runResolve} disabled={busy || resolving || !termId}
          title={!termId ? 'No term available to resolve against' : undefined}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-indigo-300 dark:border-indigo-500/40 px-3 py-2 text-[12.5px] font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 dark:text-indigo-400 dark:hover:bg-indigo-500/10">
          <Sparkles size={13} /> {resolving ? 'Resolving…' : `Resolve (${mode.toLowerCase()})`}
        </button>
      )}
      {mode === 'POOL' && <PoolEditor teachingRequirementId={req.id} busy={busy} />}
    </div>
  )
}

/** Mode 2's eligible-teacher set — a plain add/remove list, since that's all `POOL` needs to be legible. */
function PoolEditor({ teachingRequirementId, busy }: { teachingRequirementId: string; busy: boolean }) {
  const pool = useTeachingAssignmentPool(teachingRequirementId)
  const { db } = useStore()
  const userById = useMemo(() => new Map(db.users.map(u => [u.id, u])), [db.users])
  return (
    <div className="space-y-1.5 rounded-xl border border-black/[.06] dark:border-white/[.08] p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
        <Users size={11} /> Pool · {pool.items.length}
      </p>
      {pool.items.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {pool.items.map(m => (
            <li key={m.id} className="flex items-center gap-1 rounded-full bg-black/[.05] dark:bg-white/[.07] py-1 pl-2.5 pr-1 text-[12px] font-medium">
              {userById.get(m.teacherId)?.name ?? 'Teacher'}
              <button onClick={() => pool.remove(m.id)} disabled={busy || pool.busy} className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/15" aria-label="Remove from pool"><X size={11} /></button>
            </li>
          ))}
        </ul>
      )}
      <AsyncEntityPicker role="teacher" value="" onChange={id => id && pool.add(id)} placeholder="Add to pool…" />
    </div>
  )
}
