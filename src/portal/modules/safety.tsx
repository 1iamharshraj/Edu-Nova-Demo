import { useMemo, useState } from 'react'
import { CheckCheck, Clock3, DoorOpen, KeyRound, LogOut, Phone, Plus, ShieldCheck, Trash2, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { isStaffOrAdmin } from '@/lib/access'
import type { AuthorizedPickupPerson, PickupEvent, PickupType, Visitor } from '@/lib/data'
import { isoDate } from '@/lib/hooks/useTimetable'
import { PICKUP_TYPES, pickupTypeLabel, useAuthorizedPickups, usePickupEvents, useVisitors } from '@/lib/hooks/useSafety'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, UploadField, inputCls, type UploadedFile } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'
import { firstName, useViewedStudents, useWard } from './viewer'
import { WardPicker } from './academics'

// Phase 22 items 1-2: authorized pickup + parent OTP approval, visitor management.
// See .agents/edunova/phase-22-campus-safety.md

const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
const dangerBtn = 'flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-2 text-[13px] font-semibold text-rose-500 hover:bg-rose-100 disabled:opacity-40'
const primaryBtn = 'flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40'
const sectionHead = 'border-b border-black/[.06] dark:border-white/[.08] px-6 py-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const rowCls = 'flex flex-wrap items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0'
const loadingRow = (text: string) => <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">{text}</div>

function SegTabs<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (t: T) => void }) {
  return (
    <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${value === o.id ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ── Parent/staff: Authorized Pickup list ──────────────────── */

export function AuthorizedPickupMod() {
  const { user } = useStore()
  const isSelfMode = user?.role === 'parent'
  const isStaffMode = user ? isStaffOrAdmin(user) : false
  const wards = useViewedStudents()
  const { ward, wardId, setWardId } = useWard()

  const [staffStudentId, setStaffStudentId] = useState('')
  const [staffStudentLabel, setStaffStudentLabel] = useState('')
  const studentId = isSelfMode ? wardId : staffStudentId
  const viewedStudent = isSelfMode ? ward : (staffStudentId ? { name: staffStudentLabel } : undefined)

  const { items, loading, error, reload } = useAuthorizedPickups(studentId, !!studentId)
  const list = useMemo(() => [...(items ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), [items])

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [relation, setRelation] = useState('')
  const [phone, setPhone] = useState('')
  const [photo, setPhoto] = useState<UploadedFile[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const resetForm = () => { setName(''); setRelation(''); setPhone(''); setPhoto([]) }
  const add = async () => {
    if (!studentId || !name.trim() || !relation.trim() || !phone.trim()) return
    setBusy('add')
    try {
      await api.post('/safety/authorized-pickups', { studentId, name: name.trim(), relation: relation.trim(), phone: phone.trim(), photoFileId: photo[0]?.id })
      setOpen(false); resetForm(); reload(); toast.success('Authorized pickup person added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const remove = async (p: AuthorizedPickupPerson) => {
    if (!confirm(`Remove ${p.name} from the authorized pickup list?`)) return
    setBusy(p.id)
    try { await api.del(`/safety/authorized-pickups/${p.id}`); reload(); toast.success('Removed') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const toggleActive = async (p: AuthorizedPickupPerson) => {
    setBusy(p.id)
    try { await api.patch(`/safety/authorized-pickups/${p.id}`, { active: !p.active }); reload() }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div>
      <PageHead title="Authorized Pickup" sub={viewedStudent ? `People allowed to collect ${firstName(viewedStudent.name)} from school` : 'Manage who may collect a student'}>
        <div className="flex flex-wrap items-center gap-2">
          {isSelfMode && wards.length > 1 && <WardPicker students={wards} value={wardId} onChange={setWardId} />}
          {!isSelfMode && isStaffMode && (
            <div className="w-60"><AsyncEntityPicker role="student" value={staffStudentId} onChange={(id, label) => { setStaffStudentId(id); setStaffStudentLabel(label) }} placeholder="Search student…" /></div>
          )}
          {studentId && <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> Add person</button>}
        </div>
      </PageHead>
      {!studentId ? (
        <Empty text={isSelfMode ? 'No student is linked to your account yet.' : 'No students to show.'} />
      ) : (
        <Card className="p-0">
          {loading ? loadingRow('Loading authorized pickup list…')
            : error ? <div className="p-6"><Empty text={error} /></div>
            : list.length === 0 ? <div className="p-6"><Empty text="No one is on the authorized pickup list yet. Anyone collecting this student will need OTP verification." /></div>
            : list.map(p => (
              <div key={p.id} className={rowCls}>
                <Avatar name={p.name} size={40} />
                <div className="min-w-40 flex-1">
                  <p className="text-[14.5px] font-semibold">{p.name}</p>
                  <p className="text-[12.5px] text-black/45 dark:text-white/45">{p.relation} · {p.phone}</p>
                </div>
                <Pill tone={p.active ? 'green' : 'slate'}>{p.active ? 'Active' : 'Inactive'}</Pill>
                <button onClick={() => toggleActive(p)} disabled={busy === p.id} className={ghostBtn}>{p.active ? 'Deactivate' : 'Reactivate'}</button>
                <button onClick={() => remove(p)} disabled={busy === p.id} className={dangerBtn}><Trash2 size={12} /></button>
              </div>
            ))}
        </Card>
      )}
      <Modal open={open} onClose={() => { setOpen(false); resetForm() }} title={`Add authorized pickup${viewedStudent ? ` — ${viewedStudent.name}` : ''}`}>
        <div className="space-y-4">
          <Field label="Full name"><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ravi Kumar" className={inputCls} /></Field>
          <Field label="Relation"><input value={relation} onChange={e => setRelation(e.target.value)} placeholder="e.g. Uncle, Family driver" className={inputCls} /></Field>
          <Field label="Phone"><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="10-digit mobile" className={inputCls} /></Field>
          <UploadField files={photo} onChange={setPhoto} accept=".png,.jpg,.jpeg" label="Photo (optional)" hint="Helps gate staff recognize them" />
          <button onClick={add} disabled={busy === 'add' || !name.trim() || !relation.trim() || !phone.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy === 'add' ? 'Adding…' : 'Add to list'}</button>
        </div>
      </Modal>
    </div>
  )
}

/* ── Staff: Log a pickup (with OTP flow) + daily pickup log ─── */

const pickupTone = (p: PickupEvent): 'green' | 'amber' | 'rose' =>
  p.status === 'Flagged' ? 'rose' : p.status === 'Completed' ? 'green' : 'amber'
const pickupStatusLabel = (p: PickupEvent) =>
  p.status === 'Flagged' ? 'Flagged — never OTP-verified' : p.status === 'Completed' ? (p.otpRequired ? 'OTP verified' : 'Authorized') : 'OTP pending — not verified'

export function PickupDeskMod() {
  const { db } = useStore()
  const [tab, setTab] = useState<'log' | 'history'>('log')

  const [sid, setSid] = useState('')
  const { items: authorized } = useAuthorizedPickups(sid, !!sid)
  const activeAuthorized = (authorized ?? []).filter(p => p.active)

  const [pickedByName, setPickedByName] = useState('')
  const [pickedByRelation, setPickedByRelation] = useState('')
  const [pickupType, setPickupType] = useState<PickupType>('Regular')
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState<PickupEvent | null>(null)
  const [code, setCode] = useState('')

  const today = usePickupEvents({ date: isoDate(new Date()) }, tab === 'log' || tab === 'history')
  const nameOf = (id: string) => db.users.find(u => u.id === id)?.name ?? 'Unknown'

  const resetForm = () => { setPickedByName(''); setPickedByRelation(''); setPickupType('Regular'); setCurrent(null); setCode('') }

  const submit = async () => {
    if (!sid || !pickedByName.trim() || !pickedByRelation.trim()) return
    setBusy(true)
    try {
      const res = await api.post<{ item: PickupEvent }>('/safety/pickup-events', {
        studentId: sid, pickedUpByName: pickedByName.trim(), pickedUpByRelation: pickedByRelation.trim(), pickupType,
      })
      setCurrent(res.item)
      today.reload()
      if (!res.item.otpRequired) toast.success('Pickup logged — no OTP required')
      else toast('OTP required for this pickup — send the code to the parent', { icon: '🔐' })
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const requestOtp = async () => {
    if (!current) return
    setBusy(true)
    try { await api.post(`/safety/pickup-events/${current.id}/request-otp`); toast.success('OTP sent to the parent') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const verifyOtp = async () => {
    if (!current || !code.trim()) return
    setBusy(true)
    try {
      const res = await api.post<{ item: PickupEvent }>(`/safety/pickup-events/${current.id}/verify-otp`, { code: code.trim() })
      setCurrent(res.item); today.reload(); toast.success('OTP verified — pickup approved')
    } catch (e) {
      // Expired/too-many-attempts responses (410/429) carry the now-Flagged event in the error body —
      // reflect that in the UI instead of leaving a stale "pending" state on screen.
      const body = (e as { body?: { item?: PickupEvent } })?.body
      if (body?.item) { setCurrent(body.item); today.reload() }
      toast.error(errorMessage(e))
    } finally { setBusy(false) }
  }

  const todayList = useMemo(() => [...(today.items ?? [])].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)), [today.items])

  return (
    <div>
      <PageHead title="Pickup Desk" sub="Log a student pickup, with OTP verification when required">
        <SegTabs value={tab} onChange={setTab} options={[{ id: 'log', label: 'Log a pickup' }, { id: 'history', label: 'Daily log' }]} />
      </PageHead>

      {tab === 'log' ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <Card>
            <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Student</p>
            <AsyncEntityPicker role="student" value={sid} onChange={id => { setSid(id); resetForm() }} placeholder="Search student…" />
            {activeAuthorized.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">On the authorized list</p>
                <div className="flex flex-wrap gap-2">
                  {activeAuthorized.map(p => (
                    <button key={p.id} onClick={() => { setPickedByName(p.name); setPickedByRelation(p.relation); setPickupType('Regular') }}
                      className="rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                      {p.name} <span className="text-black/40 dark:text-white/40">· {p.relation}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-5 space-y-4">
              <Field label="Picked up by (name)"><input value={pickedByName} onChange={e => setPickedByName(e.target.value)} className={inputCls} /></Field>
              <Field label="Relation"><input value={pickedByRelation} onChange={e => setPickedByRelation(e.target.value)} className={inputCls} /></Field>
              <Field label="Pickup type">
                <select value={pickupType} onChange={e => setPickupType(e.target.value as PickupType)} className={inputCls}>
                  {PICKUP_TYPES.map(t => <option key={t} value={t}>{pickupTypeLabel(t)}</option>)}
                </select>
              </Field>
              <button onClick={submit} disabled={busy || !sid || !pickedByName.trim() || !pickedByRelation.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Logging…' : 'Log pickup'}</button>
            </div>
          </Card>
          <Card>
            <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Verification</p>
            {!current ? (
              <Empty text="Log a pickup to see whether OTP verification is required." />
            ) : (
              <div>
                <div className="flex items-center justify-between rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4">
                  <div>
                    <p className="text-[14.5px] font-semibold">{current.pickedUpByName} · {current.pickedUpByRelation}</p>
                    <p className="text-[12.5px] text-black/50 dark:text-white/50">{pickupTypeLabel(current.pickupType)}</p>
                  </div>
                  <Pill tone={pickupTone(current)}>{pickupStatusLabel(current)}</Pill>
                </div>
                {current.otpRequired && !current.approvedByOtp && (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-start gap-2 rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-3 text-[12.5px] text-amber-800 dark:text-amber-300">
                      <KeyRound size={15} className="mt-0.5 shrink-0" /> This person isn't on the authorized list, or it's an early pickup — send an OTP to the parent before releasing the student.
                    </div>
                    <button onClick={requestOtp} disabled={busy} className={`${ghostBtn} w-full justify-center`}>Send OTP</button>
                    <div className="flex gap-2">
                      <input value={code} onChange={e => setCode(e.target.value)} placeholder="Enter code" className={`${inputCls} flex-1`} />
                      <button onClick={verifyOtp} disabled={busy || !code.trim()} className={primaryBtn}><CheckCheck size={14} /> Verify</button>
                    </div>
                  </div>
                )}
                {(!current.otpRequired || current.approvedByOtp) && (
                  <div className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 p-3 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck size={15} /> Cleared for release.
                  </div>
                )}
                <button onClick={resetForm} className={`${ghostBtn} mt-4 w-full justify-center`}>Log another pickup</button>
              </div>
            )}
          </Card>
        </div>
      ) : (
        <Card className="p-0">
          {today.loading ? loadingRow('Loading today’s pickups…')
            : today.error ? <div className="p-6"><Empty text={today.error} /></div>
            : todayList.length === 0 ? <div className="p-6"><Empty text="No pickups logged today." /></div>
            : todayList.map(p => (
              <div key={p.id} className={rowCls}>
                <div className="min-w-40 flex-1">
                  <p className="text-[14.5px] font-semibold">{nameOf(p.studentId)}</p>
                  <p className="text-[12.5px] text-black/45 dark:text-white/45">{p.pickedUpByName} · {p.pickedUpByRelation} · {pickupTypeLabel(p.pickupType)}</p>
                </div>
                <span className="flex items-center gap-1 text-[12px] text-black/40 dark:text-white/40"><Clock3 size={12} /> {new Date(p.recordedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                <Pill tone={pickupTone(p)}>{pickupStatusLabel(p)}</Pill>
              </div>
            ))}
        </Card>
      )}
    </div>
  )
}

/* ── Staff: Visitor front desk ──────────────────────────────── */

export function VisitorDeskMod() {
  const { db } = useStore()
  const [tab, setTab] = useState<'checkin' | 'oncampus'>('checkin')
  const today = useVisitors({ date: isoDate(new Date()) }, tab === 'checkin')
  const onCampus = useVisitors({ onCampus: true }, tab === 'oncampus')

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [purpose, setPurpose] = useState('')
  const [hostUserId, setHostUserId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const resetForm = () => { setName(''); setPhone(''); setPurpose(''); setHostUserId('') }
  const checkIn = async () => {
    if (!name.trim() || !phone.trim() || !purpose.trim()) return
    setBusy('checkin')
    try {
      await api.post('/safety/visitors', { name: name.trim(), phone: phone.trim(), purpose: purpose.trim(), hostUserId: hostUserId || undefined })
      resetForm(); today.reload(); onCampus.reload(); toast.success('Visitor checked in')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const checkOut = async (v: Visitor) => {
    setBusy(v.id)
    try { await api.post(`/safety/visitors/${v.id}/checkout`); today.reload(); onCampus.reload(); toast.success('Visitor checked out') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const hostName = (id?: string | null) => id ? (db.users.find(u => u.id === id)?.name ?? '—') : '—'

  const todayList = useMemo(() => [...(today.items ?? [])].sort((a, b) => b.checkInAt.localeCompare(a.checkInAt)), [today.items])
  const onCampusList = useMemo(() => [...(onCampus.items ?? [])].sort((a, b) => b.checkInAt.localeCompare(a.checkInAt)), [onCampus.items])

  return (
    <div>
      <PageHead title="Visitor Desk" sub="Front-desk check-in / check-out">
        <SegTabs value={tab} onChange={setTab} options={[{ id: 'checkin', label: 'Check-in / out' }, { id: 'oncampus', label: 'Currently on campus' }]} />
      </PageHead>

      {tab === 'checkin' ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
          <Card>
            <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><DoorOpen size={15} /> Check in a visitor</p>
            <div className="space-y-4">
              <Field label="Full name"><input value={name} onChange={e => setName(e.target.value)} className={inputCls} /></Field>
              <Field label="Phone"><input value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} /></Field>
              <Field label="Purpose of visit"><input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g. Meeting with class teacher" className={inputCls} /></Field>
              <Field label="Visiting (optional)">
                <AsyncEntityPicker role={['teacher', 'staff', 'admin']} value={hostUserId} onChange={id => setHostUserId(id)} placeholder="Search staff…" />
              </Field>
              <button onClick={checkIn} disabled={busy === 'checkin' || !name.trim() || !phone.trim() || !purpose.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy === 'checkin' ? 'Checking in…' : 'Check in'}</button>
            </div>
          </Card>
          <Card className="p-0">
            <p className={sectionHead}>Today's visitors</p>
            {today.loading ? loadingRow('Loading…')
              : today.error ? <div className="p-6"><Empty text={today.error} /></div>
              : todayList.length === 0 ? <div className="p-6"><Empty text="No visitors checked in today." /></div>
              : todayList.map(v => (
                <div key={v.id} className={rowCls}>
                  <div className="min-w-40 flex-1">
                    <p className="text-[14.5px] font-semibold">{v.name}</p>
                    <p className="text-[12.5px] text-black/45 dark:text-white/45">{v.purpose}{v.hostUserId ? ` · visiting ${hostName(v.hostUserId)}` : ''}</p>
                  </div>
                  <span className="flex items-center gap-1 text-[12px] text-black/40 dark:text-white/40"><Clock3 size={12} /> in {new Date(v.checkInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                  {v.checkOutAt ? (
                    <Pill tone="slate">Checked out {new Date(v.checkOutAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</Pill>
                  ) : (
                    <button onClick={() => checkOut(v)} disabled={busy === v.id} className="flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-rose-500 hover:bg-rose-100 disabled:opacity-40"><LogOut size={12} /> Check out</button>
                  )}
                </div>
              ))}
          </Card>
        </div>
      ) : (
        <Card className="p-0">
          <p className={sectionHead}>On campus right now ({onCampusList.length})</p>
          {onCampus.loading ? loadingRow('Loading…')
            : onCampus.error ? <div className="p-6"><Empty text={onCampus.error} /></div>
            : onCampusList.length === 0 ? <div className="p-6"><Empty text="No visitors currently on campus." /></div>
            : onCampusList.map(v => (
              <div key={v.id} className={rowCls}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><UserCheck size={16} /></span>
                <div className="min-w-40 flex-1">
                  <p className="text-[14.5px] font-semibold">{v.name}</p>
                  <p className="text-[12.5px] text-black/45 dark:text-white/45">{v.purpose}{v.hostUserId ? ` · visiting ${hostName(v.hostUserId)}` : ''} · <Phone size={10} className="inline" /> {v.phone}</p>
                </div>
                <span className="flex items-center gap-1 text-[12px] text-black/40 dark:text-white/40"><Clock3 size={12} /> since {new Date(v.checkInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                <button onClick={() => checkOut(v)} disabled={busy === v.id} className="flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-rose-500 hover:bg-rose-100 disabled:opacity-40"><LogOut size={12} /> Check out</button>
              </div>
            ))}
        </Card>
      )}
    </div>
  )
}
