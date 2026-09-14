import { useMemo, useState } from 'react'
import {
  AlertTriangle, Calendar, Check, ChevronLeft, ChevronRight, ClipboardList, DoorOpen, History,
  LogIn, LogOut, Star, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import type { HostelOutpassRec, MealType, MessMenuRec } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { hasAllergyRecord, useHealthRecords } from '@/lib/hooks/useWelfare'
import {
  MEAL_TYPES, isoDate, mealTypeOrder, outpassStatusTone, useHostelAllocations, useHostels, useMealFeedback,
  useMessMenu, useMyHostel, useMyWardenHostels, useOutpasses, useRollCalls, weekDates,
} from '@/lib/hooks/useHostel'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { WardPicker } from './academics'
import { firstName, useWard } from './viewer'

// Phase 24 — Boarding & Hostel Extensions: outpass/leave workflow, night roll-call, and mess menu + meal
// feedback. Layered onto Phase 14's Hostel/HostelRoom/HostelBed/HostelAllocation (see hostel.tsx and
// useHostel.ts). Follows the same idiom as hostel.tsx and the Take Attendance "create session, then patch
// records" pattern (classroom.tsx's TakeAttendanceMod) for the roll-call screen.

const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
const cardHead = 'flex flex-wrap items-center justify-between gap-3 border-b border-black/[.06] dark:border-white/[.08] px-5 py-3.5'
const tabBar = 'inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1'
const tabBtn = (active: boolean) => `rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${active ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`

function FormActions({ onCancel, onSave, label, disabled }: { onCancel: () => void; onSave: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onSave} disabled={disabled} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{label}</button>
      <button onClick={onCancel} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
    </div>
  )
}

/** Which hostel(s) the logged-in staff/admin/superadmin should see — a warden of one or more hostels is
 * scoped to those (per the spec's "my hostel" note); anyone else with hostel write access sees every hostel
 * via a picker. */
function useHostelScope() {
  const { user } = useStore()
  const wardenOf = useMyWardenHostels(user?.id)
  const allHostels = useHostels(!!user)
  const isWarden = wardenOf.length > 0
  const options = isWarden ? wardenOf : (allHostels.items ?? [])
  const [picked, setPicked] = useState('')
  const hostelId = options.some(h => h.id === picked) ? picked : (options[0]?.id ?? '')
  return { options, hostelId, setHostelId: setPicked, isWarden, loading: allHostels.loading }
}

function HostelPicker({ options, value, onChange }: { options: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  if (options.length <= 1) return null
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={`${inputCls} w-auto py-2 text-[13.5px]`} aria-label="Hostel">
      {options.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
    </select>
  )
}

const dtLocal = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ═══════════════════════════ 1. Outpass / leave ═══════════════════════════ */

interface OutpassForm { requestedDepartureAt: string; expectedReturnAt: string; reason: string; destination: string }
const emptyOutpassForm = (): OutpassForm => {
  const now = new Date()
  const later = new Date(now.getTime() + 4 * 3600_000)
  return { requestedDepartureAt: dtLocal(now), expectedReturnAt: dtLocal(later), reason: '', destination: '' }
}

/* ── student/parent: request + own outpasses ────────────────── */

export function MyOutpassMod() {
  const { user } = useStore()
  const isParent = user?.role === 'parent'
  const { students, ward, wardId, setWardId } = useWard()
  const studentId = isParent ? wardId : user?.id
  const enabled = isParent ? !!ward : !!user
  const outpasses = useOutpasses({ studentId }, enabled)
  const sorted = useMemo(() => [...(outpasses.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [outpasses.items])

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<OutpassForm>(emptyOutpassForm())
  const [busy, setBusy] = useState(false)
  const openForm = () => { setForm(emptyOutpassForm()); setOpen(true) }
  const submit = async () => {
    if (!studentId) return
    setBusy(true)
    try {
      await api.post('/hostel/outpasses', {
        studentId,
        requestedDepartureAt: new Date(form.requestedDepartureAt).toISOString(),
        expectedReturnAt: new Date(form.expectedReturnAt).toISOString(),
        reason: form.reason.trim(),
        destination: form.destination.trim() || undefined,
      })
      toast.success('Outpass requested')
      setOpen(false); outpasses.reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const valid = form.requestedDepartureAt && form.expectedReturnAt && form.reason.trim().length > 0

  return (
    <div>
      <PageHead title="Hostel Outpass" sub={isParent ? (ward ? `${firstName(ward.name)}'s leave requests` : 'Request and track your ward’s hostel leave') : 'Request and track your hostel leave'}>
        <div className="flex flex-wrap items-center gap-2">
          {isParent && <WardPicker students={students} value={wardId} onChange={setWardId} />}
          <button onClick={openForm} disabled={!studentId} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40"><DoorOpen size={15} /> Request outpass</button>
        </div>
      </PageHead>

      {isParent && students.length === 0 && <Empty text="No student is linked to your account yet." />}
      {enabled && outpasses.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {enabled && outpasses.error && <Empty text={outpasses.error} />}
      {enabled && !outpasses.loading && !outpasses.error && sorted.length === 0 && <Empty text="No outpass requests yet." />}

      <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
        {sorted.map(o => (
          <div key={o.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <div className="min-w-52 flex-1">
              <p className="text-[14.5px] font-semibold">{o.destination || 'Outpass'}</p>
              <p className={muted}>{o.reason}</p>
              <p className={muted}>{fmtDate(o.requestedDepartureAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} → {fmtDate(o.expectedReturnAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            <Pill tone={outpassStatusTone(o.status)}>{o.status}</Pill>
          </div>
        ))}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Request a hostel outpass" wide>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Depart at"><input type="datetime-local" value={form.requestedDepartureAt} onChange={e => setForm({ ...form, requestedDepartureAt: e.target.value })} className={inputCls} /></Field>
            <Field label="Expected return"><input type="datetime-local" value={form.expectedReturnAt} onChange={e => setForm({ ...form, expectedReturnAt: e.target.value })} className={inputCls} /></Field>
          </div>
          <Field label="Destination"><input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} placeholder="Optional — e.g. Home, relative's place" className={inputCls} /></Field>
          <Field label="Reason"><textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows={3} placeholder="Why do you need this leave?" className={inputCls} autoFocus /></Field>
          <FormActions onCancel={() => setOpen(false)} onSave={submit} label="Submit request" disabled={!valid || busy} />
        </div>
      </Modal>
    </div>
  )
}

/* ── warden/staff/admin: approval queue + gate log ───────────── */

export function HostelOutpassMod() {
  const { db, user } = useStore()
  const scope = useHostelScope()
  const [tab, setTab] = useState<'queue' | 'gate' | 'history'>('queue')
  const outpasses = useOutpasses({ hostelId: scope.hostelId || undefined }, !!user)
  const sorted = useMemo(() => [...(outpasses.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [outpasses.items])
  const pending = sorted.filter(o => o.status === 'Pending')
  const gate = sorted.filter(o => o.status === 'Approved' || o.status === 'Departed')
  const history = sorted.filter(o => o.status === 'Returned' || o.status === 'Declined' || o.status === 'Overdue')
  const rows = tab === 'queue' ? pending : tab === 'gate' ? gate : history
  const studentName = (id: string) => db.users.find(u => u.id === id)?.name ?? id

  const [busy, setBusy] = useState<string | null>(null)
  const act = async (o: HostelOutpassRec, verb: 'approve' | 'decline' | 'depart' | 'return') => {
    setBusy(o.id)
    try {
      await api.post(`/hostel/outpasses/${o.id}/${verb}`, {})
      toast.success(verb === 'approve' ? 'Outpass approved' : verb === 'decline' ? 'Outpass declined' : verb === 'depart' ? 'Departure logged' : 'Return logged')
      outpasses.reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div>
      <PageHead title="Hostel Outpass" sub={scope.isWarden ? 'Requests for the hostel you warden' : 'Outpass requests across every hostel'}>
        <div className="flex flex-wrap items-center gap-2">
          <HostelPicker options={scope.options} value={scope.hostelId} onChange={scope.setHostelId} />
          <div className={tabBar}>
            <button onClick={() => setTab('queue')} className={tabBtn(tab === 'queue')}>Approvals{pending.length > 0 ? ` (${pending.length})` : ''}</button>
            <button onClick={() => setTab('gate')} className={tabBtn(tab === 'gate')}>Gate log</button>
            <button onClick={() => setTab('history')} className={tabBtn(tab === 'history')}>History</button>
          </div>
        </div>
      </PageHead>

      {scope.options.length === 0 && !scope.loading && <Empty text="No hostel is set up yet, or none is assigned to you as warden." />}
      {outpasses.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {outpasses.error && <Empty text={outpasses.error} />}
      {!outpasses.loading && !outpasses.error && rows.length === 0 && <Empty text={tab === 'queue' ? 'No pending requests.' : tab === 'gate' ? 'Nothing approved or currently out.' : 'No history yet.'} />}

      <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
        {rows.map(o => (
          <div key={o.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <div className="min-w-52 flex-1">
              <p className="text-[14.5px] font-semibold">{studentName(o.studentId)}</p>
              <p className={muted}>{o.destination ? `${o.destination} — ` : ''}{o.reason}</p>
              <p className={muted}>{fmtDate(o.requestedDepartureAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} → {fmtDate(o.expectedReturnAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            <Pill tone={outpassStatusTone(o.status)}>{o.status}</Pill>
            {tab === 'queue' && (
              <div className="flex gap-2">
                <button onClick={() => act(o, 'approve')} disabled={busy === o.id} className="flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-3.5 py-2 text-[13px] font-semibold text-emerald-600 hover:bg-emerald-100 disabled:opacity-40"><Check size={14} /> Approve</button>
                <button onClick={() => act(o, 'decline')} disabled={busy === o.id} className="flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-2 text-[13px] font-semibold text-rose-500 hover:bg-rose-100 disabled:opacity-40"><X size={14} /> Decline</button>
              </div>
            )}
            {tab === 'gate' && (
              <div className="flex gap-2">
                {o.status === 'Approved' && <button onClick={() => act(o, 'depart')} disabled={busy === o.id} className={ghostBtn}><LogOut size={14} /> Log departure</button>}
                {o.status === 'Departed' && <button onClick={() => act(o, 'return')} disabled={busy === o.id} className={ghostBtn}><LogIn size={14} /> Log return</button>}
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  )
}

/* ═══════════════════════════ 2. Night roll-call ═══════════════════════════ */

export function HostelRollCallMod() {
  const { db } = useStore()
  const scope = useHostelScope()
  const [view, setView] = useState<'take' | 'history'>('take')
  const [date, setDate] = useState(() => isoDate(new Date()))
  const rollCalls = useRollCalls({ hostelId: scope.hostelId || undefined }, !!scope.hostelId)
  const existing = rollCalls.items?.find(r => r.date === date)
  const allocations = useHostelAllocations({ hostelId: scope.hostelId || undefined, status: 'Active' }, !!scope.hostelId)
  // Entries come pre-decorated with studentName (joined server-side off the allocation) — fall back to
  // cross-referencing the allocations/users lists only if that decoration is ever missing.
  const studentOf = (en: { allocationId: string; studentName?: string }) => {
    if (en.studentName) return en.studentName
    const alloc = (allocations.items ?? []).find(a => a.id === en.allocationId)
    return alloc ? (db.users.find(u => u.id === alloc.studentId)?.name ?? alloc.studentId) : en.allocationId
  }

  // Local edits overlay the saved session, mirroring TakeAttendanceMod's pattern.
  const scopeKey = `${scope.hostelId}|${date}`
  const [edits, setEdits] = useState<{ scope: string; cells: Record<string, boolean> }>({ scope: scopeKey, cells: {} })
  const cells = edits.scope === scopeKey ? edits.cells : {}
  const serverPresent = useMemo(() => new Map((existing?.entries ?? []).map(e => [e.allocationId, e.present])), [existing])
  const presentOf = (allocationId: string) => cells[allocationId] ?? serverPresent.get(allocationId) ?? true
  const toggle = (allocationId: string) => setEdits({ scope: scopeKey, cells: { ...cells, [allocationId]: !presentOf(allocationId) } })
  const dirty = Object.keys(cells).length > 0

  const [busy, setBusy] = useState(false)
  const startRollCall = async () => {
    if (!scope.hostelId) return
    setBusy(true)
    try {
      await api.post('/hostel/roll-calls', { hostelId: scope.hostelId, date })
      setEdits({ scope: scopeKey, cells: {} })
      rollCalls.reload()
      toast.success('Roll-call started — every currently allocated student defaults to present')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const submit = async () => {
    if (!existing) return
    setBusy(true)
    try {
      const entries = existing.entries.map(en => ({ allocationId: en.allocationId, present: presentOf(en.allocationId) }))
      await api.patch(`/hostel/roll-calls/${existing.id}/entries`, { entries })
      setEdits({ scope: scopeKey, cells: {} })
      rollCalls.reload()
      const absent = entries.filter(e => !e.present).length
      toast.success(absent > 0 ? `Roll-call submitted — ${absent} marked absent, parents notified` : 'Roll-call submitted — all present')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const absentCount = existing ? existing.entries.filter(e => !presentOf(e.allocationId)).length : 0

  return (
    <div>
      <PageHead title="Night Roll-call" sub={scope.isWarden ? 'Mark who is present tonight' : 'Nightly hostel attendance'}>
        <div className="flex flex-wrap items-center gap-2">
          <HostelPicker options={scope.options} value={scope.hostelId} onChange={scope.setHostelId} />
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${inputCls} w-auto py-2 text-[13.5px]`} aria-label="Date" />
          <div className={tabBar}>
            <button onClick={() => setView('take')} className={tabBtn(view === 'take')}>Take roll-call</button>
            <button onClick={() => setView('history')} className={tabBtn(view === 'history')}>History</button>
          </div>
        </div>
      </PageHead>

      {scope.options.length === 0 && !scope.loading && <Empty text="No hostel is set up yet, or none is assigned to you as warden." />}

      {view === 'take' && scope.hostelId && (
        !existing ? (
          allocations.loading ? <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p> : (
            <Card className="flex flex-col items-center py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><ClipboardList size={26} /></div>
              <p className="mt-4 font-display text-xl font-medium">No roll-call for {fmtDate(date)} yet</p>
              <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">
                Starts a session for all {allocations.items?.length ?? 0} currently allocated students, defaulting everyone to present.
              </p>
              <div className="mt-5"><button onClick={startRollCall} disabled={busy} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40"><ClipboardList size={15} /> Start roll-call</button></div>
            </Card>
          )
        ) : (
          <Card className="p-0">
            <div className={cardHead}>
              <p className="text-[14px] font-semibold">{existing.entries.length - absentCount} of {existing.entries.length} present</p>
              {absentCount > 0 && <Pill tone="rose">{absentCount} absent</Pill>}
              {dirty && <Pill tone="amber">Unsaved</Pill>}
            </div>
            {existing.entries.map(en => {
              const present = presentOf(en.allocationId)
              return (
                <div key={en.id} className="flex items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3 last:border-0">
                  <span className="flex-1 text-[14.5px] font-medium">{studentOf(en)}</span>
                  <button onClick={() => toggle(en.allocationId)}
                    className={`rounded-full px-4 py-1.5 text-[12.5px] font-bold transition-colors ${present ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'}`}>
                    {present ? 'Present' : 'Absent'}
                  </button>
                </div>
              )
            })}
            <div className="p-5">
              <button onClick={submit} disabled={busy} className="btn-ink flex w-full items-center justify-center gap-2 py-3.5 text-[14.5px] font-semibold disabled:opacity-40"><Check size={16} /> Submit roll-call</button>
            </div>
          </Card>
        )
      )}

      {view === 'history' && (
        <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
          {rollCalls.loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>}
          {!rollCalls.loading && (rollCalls.items ?? []).length === 0 && <div className="p-6"><Empty text="No roll-call history yet." /></div>}
          {[...(rollCalls.items ?? [])].sort((a, b) => b.date.localeCompare(a.date)).map(r => {
            const absent = r.entries.filter(e => !e.present)
            return (
              <div key={r.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <History size={15} className="text-black/40 dark:text-white/40" />
                  <p className="flex-1 text-[14.5px] font-semibold">{fmtDate(r.date)}</p>
                  <Pill tone={absent.length > 0 ? 'rose' : 'green'}>{r.entries.length - absent.length}/{r.entries.length} present</Pill>
                </div>
                {absent.length > 0 && <p className={`mt-1.5 ${muted}`}>Absent: {absent.map(e => studentOf(e)).join(', ')}</p>}
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}

/* ═══════════════════════════ 3. Mess menu + meal feedback ═══════════════════════════ */

const mealTone: Record<MealType, 'amber' | 'green' | 'sky' | 'indigo'> = { Breakfast: 'amber', Lunch: 'green', Snacks: 'sky', Dinner: 'indigo' }

function weekLabel(dates: string[]) {
  if (dates.length === 0) return ''
  return `${fmtDate(dates[0], { day: 'numeric', month: 'short' })} – ${fmtDate(dates[dates.length - 1], { day: 'numeric', month: 'short' })}`
}

/* ── warden/staff/admin: batch weekly menu editor + feedback summary ───────── */

export function MessMenuMod() {
  const scope = useHostelScope()
  const [tab, setTab] = useState<'menu' | 'feedback'>('menu')
  const [weekBase, setWeekBase] = useState(() => new Date())
  const dates = useMemo(() => weekDates(weekBase), [weekBase])
  const menu = useMessMenu({ hostelId: scope.hostelId || undefined, from: dates[0], to: dates[6] }, !!scope.hostelId)
  const feedback = useMealFeedback({ hostelId: scope.hostelId || undefined }, tab === 'feedback' && !!scope.hostelId)

  // Items are stored server-side as a string array — the textarea edits them one per line and we split/join
  // on the way in and out.
  const cellFor = (date: string, mealType: MealType) => (menu.items ?? []).find(m => m.date === date && m.mealType === mealType)
  const textOf = (m?: MessMenuRec) => (m?.items ?? []).join('\n')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const keyOf = (date: string, mealType: MealType) => `${date}|${mealType}`
  const valueOf = (date: string, mealType: MealType) => {
    const k = keyOf(date, mealType)
    if (k in draft) return draft[k]
    return textOf(cellFor(date, mealType))
  }
  const setValue = (date: string, mealType: MealType, v: string) => setDraft({ ...draft, [keyOf(date, mealType)]: v })
  const dirtyKeys = useMemo(() => Object.keys(draft).filter(k => {
    const [date, mealType] = k.split('|') as [string, MealType]
    return draft[k] !== textOf((menu.items ?? []).find(m => m.date === date && m.mealType === mealType))
  }), [draft, menu.items])

  const [busy, setBusy] = useState(false)
  const saveWeek = async () => {
    setBusy(true)
    try {
      await Promise.all(dirtyKeys.map(async k => {
        const [date, mealType] = k.split('|') as [string, MealType]
        const items = draft[k].split('\n').map(s => s.trim()).filter(Boolean)
        const existing = cellFor(date, mealType)
        if (existing) await api.patch(`/hostel/mess-menu/${existing.id}`, { items })
        else if (items.length > 0) await api.post('/hostel/mess-menu', { hostelId: scope.hostelId, date, mealType, items })
      }))
      setDraft({})
      menu.reload()
      toast.success('Menu saved')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  // Average rating per menu row, for the feedback tab.
  const avgByMenu = useMemo(() => {
    const m = new Map<string, { sum: number; count: number }>()
    for (const f of feedback.items ?? []) {
      const cur = m.get(f.menuId) ?? { sum: 0, count: 0 }
      cur.sum += f.rating; cur.count += 1
      m.set(f.menuId, cur)
    }
    return m
  }, [feedback.items])

  return (
    <div>
      <PageHead title="Mess Menu" sub={scope.isWarden ? 'Weekly menu for the hostel you warden' : 'Weekly menu across every hostel'}>
        <div className="flex flex-wrap items-center gap-2">
          <HostelPicker options={scope.options} value={scope.hostelId} onChange={scope.setHostelId} />
          <div className={tabBar}>
            <button onClick={() => setTab('menu')} className={tabBtn(tab === 'menu')}>Menu</button>
            <button onClick={() => setTab('feedback')} className={tabBtn(tab === 'feedback')}>Feedback summary</button>
          </div>
        </div>
      </PageHead>

      {scope.options.length === 0 && !scope.loading && <Empty text="No hostel is set up yet, or none is assigned to you as warden." />}

      {scope.hostelId && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekBase(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })} className={ghostBtn}><ChevronLeft size={14} /></button>
            <p className="flex items-center gap-2 text-[14px] font-semibold"><Calendar size={15} className="text-black/40 dark:text-white/40" /> {weekLabel(dates)}</p>
            <button onClick={() => setWeekBase(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })} className={ghostBtn}><ChevronRight size={14} /></button>
          </div>
          {tab === 'menu' && <button onClick={saveWeek} disabled={dirtyKeys.length === 0 || busy} className="btn-ink px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">Save week{dirtyKeys.length > 0 ? ` (${dirtyKeys.length})` : ''}</button>}
        </div>
      )}

      {scope.hostelId && tab === 'menu' && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-black/[.06] dark:border-white/[.08]">
                <th className="w-28 px-4 py-3 text-left font-semibold text-black/40 dark:text-white/40">Meal</th>
                {dates.map(d => <th key={d} className="px-3 py-3 text-left font-semibold">{fmtDate(d, { weekday: 'short', day: 'numeric' })}</th>)}
              </tr>
            </thead>
            <tbody>
              {MEAL_TYPES.map(mealType => (
                <tr key={mealType} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                  <td className="px-4 py-2.5 align-top"><Pill tone={mealTone[mealType]}>{mealType}</Pill></td>
                  {dates.map(d => (
                    <td key={d} className="px-2 py-2 align-top">
                      <textarea value={valueOf(d, mealType)} onChange={e => setValue(d, mealType, e.target.value)} rows={2}
                        placeholder="—" className="w-40 resize-none rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-[#14141f] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-indigo-400" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {scope.hostelId && tab === 'feedback' && (
        <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
          {menu.loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>}
          {!menu.loading && (menu.items ?? []).filter(m => avgByMenu.has(m.id)).length === 0 && <div className="p-6"><Empty text="No feedback for this week yet." /></div>}
          {[...(menu.items ?? [])]
            .filter(m => avgByMenu.has(m.id))
            .sort((a, b) => a.date.localeCompare(b.date) || mealTypeOrder[a.mealType] - mealTypeOrder[b.mealType])
            .map(m => {
              const agg = avgByMenu.get(m.id)!
              const avg = agg.sum / agg.count
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-52 flex-1">
                    <p className="text-[14.5px] font-semibold">{fmtDate(m.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {m.mealType}</p>
                    <p className={muted}>{m.items.join(', ')}</p>
                  </div>
                  <div className="flex items-center gap-1 text-amber-500"><Star size={15} fill="currentColor" /><span className="text-[14px] font-bold">{avg.toFixed(1)}</span></div>
                  <span className={muted}>{agg.count} rating{agg.count === 1 ? '' : 's'}</span>
                </div>
              )
            })}
        </Card>
      )}
    </div>
  )
}

/* ── student/parent: this week's menu + quick rating ─────────── */

function StarRating({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} disabled={disabled} onClick={() => onChange(n)} className="p-0.5 disabled:cursor-default" aria-label={`Rate ${n}`}>
          <Star size={16} className={n <= value ? 'text-amber-500' : 'text-black/15 dark:text-white/15'} fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  )
}

function RateMealRow({ menuId, studentId, existingRating }: { menuId: string; studentId: string; existingRating?: { rating: number; comment?: string } }) {
  const [rating, setRating] = useState(existingRating?.rating ?? 0)
  const [comment, setComment] = useState(existingRating?.comment ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(!!existingRating)
  const submit = async (n: number) => {
    setRating(n); setBusy(true)
    try {
      await api.post('/hostel/meal-feedback', { menuId, studentId, rating: n, comment: comment.trim() || undefined })
      setSaved(true)
      toast.success('Thanks for the feedback!')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <StarRating value={rating} onChange={submit} disabled={busy} />
      {saved && <span className={muted}>Rated</span>}
      {rating > 0 && (
        <input value={comment} onChange={e => setComment(e.target.value)} onBlur={() => rating > 0 && submit(rating)}
          placeholder="Add a comment (optional)" className="min-w-40 flex-1 rounded-full border border-black/10 dark:border-white/15 bg-transparent px-3 py-1 text-[12px] outline-none focus:border-indigo-400" />
      )}
    </div>
  )
}

export function MyMessMod() {
  const { user } = useStore()
  const isParent = user?.role === 'parent'
  const { students, ward, wardId, setWardId } = useWard()
  const studentId = isParent ? wardId : user?.id
  const enabled = isParent ? !!ward : !!user
  const { hostel } = useMyHostel(isParent ? wardId : undefined, enabled)
  const [weekBase, setWeekBase] = useState(() => new Date())
  const dates = useMemo(() => weekDates(weekBase), [weekBase])
  // The server cross-references items against the caller's (or their one ward's) recorded HealthRecord
  // allergy entries and returns `allergyFlags`/`allergyDisclaimer` on each row — no client-side matching.
  const menu = useMessMenu({ hostelId: hostel?.id, from: dates[0], to: dates[6] }, !!hostel)
  const myFeedback = useMealFeedback({ studentId }, enabled && !!studentId)
  const ratingOf = (menuId: string) => (myFeedback.items ?? []).find(f => f.menuId === menuId)
  const health = useHealthRecords(studentId, enabled && !!studentId)
  const today = isoDate(new Date())

  const rows = useMemo(
    () => [...(menu.items ?? [])].sort((a, b) => a.date.localeCompare(b.date) || mealTypeOrder[a.mealType] - mealTypeOrder[b.mealType]),
    [menu.items],
  )
  const byDate = useMemo(() => {
    const m = new Map<string, MessMenuRec[]>()
    for (const r of rows) m.set(r.date, [...(m.get(r.date) ?? []), r])
    return m
  }, [rows])

  return (
    <div>
      <PageHead title="Mess Menu" sub={isParent ? (ward ? `${firstName(ward.name)}'s weekly hostel menu` : 'This week’s hostel menu') : 'This week’s hostel menu — rate a meal after you’ve had it'}>
        <div className="flex flex-wrap items-center gap-2">
          {isParent && <WardPicker students={students} value={wardId} onChange={setWardId} />}
          <button onClick={() => setWeekBase(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })} className={ghostBtn}><ChevronLeft size={14} /></button>
          <p className="flex items-center gap-2 text-[13.5px] font-semibold"><Calendar size={14} /> {weekLabel(dates)}</p>
          <button onClick={() => setWeekBase(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })} className={ghostBtn}><ChevronRight size={14} /></button>
        </div>
      </PageHead>

      {isParent && students.length === 0 && <Empty text="No student is linked to your account yet." />}
      {enabled && !hostel && !menu.loading && <Empty text="No hostel allocation on record — menu is only visible once allocated." />}
      {enabled && hostel && menu.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {enabled && hostel && !menu.loading && rows.length === 0 && <Empty text="No menu published for this week yet." />}

      {hasAllergyRecord(health.items) && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10 px-4 py-3 text-[12.5px] text-amber-800 dark:text-amber-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p>{rows.find(m => m.allergyDisclaimer)?.allergyDisclaimer ?? 'Meals mentioning a term from your recorded allergies are flagged below — this is a simple keyword match and may not account for all allergens. Verify independently before eating.'}</p>
        </div>
      )}

      {hostel && dates.map(d => {
        const dayRows = byDate.get(d) ?? []
        if (dayRows.length === 0) return null
        return (
          <Card key={d} className="mb-4">
            <p className="font-display text-[16px] font-medium">{fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' })}</p>
            <div className="mt-3 space-y-3">
              {dayRows.map(m => {
                const hits = m.allergyFlags ?? []
                const rated = ratingOf(m.id)
                const canRate = studentId && m.date <= today
                return (
                  <div key={m.id} className="rounded-xl border border-black/[.06] dark:border-white/[.08] p-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={mealTone[m.mealType]}>{m.mealType}</Pill>
                      {hits.length > 0 && <Pill tone="amber"><AlertTriangle size={11} /> May contain {hits[0]}</Pill>}
                    </div>
                    <p className="mt-2 text-[13.5px]">{m.items.join(', ')}</p>
                    {canRate && studentId && <RateMealRow menuId={m.id} studentId={studentId} existingRating={rated} />}
                  </div>
                )
              })}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
