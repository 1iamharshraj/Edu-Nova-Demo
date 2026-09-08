import { useMemo, useState } from 'react'
import {
  BedDouble, Building2, ChevronDown, ChevronRight, DoorOpen, MapPin, Pencil, Phone, Plus, ShieldCheck, Trash2, UserPlus, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import type { HostelAllocationRec, HostelBedRec, HostelRec, HostelRoomRec, HostelType } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { useEmployees } from '@/lib/hooks/useFinance'
import {
  ALLOCATION_STATUSES, HOSTEL_TYPES, allocationStatusTone, hostelTypeTone, occupancyLabel,
  useHostelAllocations, useHostelBeds, useHostelRooms, useHostels, useMyHostel,
} from '@/lib/hooks/useHostel'
import { Card, Empty, Field, Modal, PageHead, Pill, Progress, inputCls } from '../ui'
import { SearchableUserPicker } from './employee'
import { WardPicker } from './academics'
import { firstName, useWard } from './viewer'

// Phase 14 — Hostel Management: admin/staff setup (hostels → rooms → beds, a hierarchical view with exact
// per-bed occupancy) and the allocation flow (allocate/vacate/transfer a student's bed), plus a parent/student
// "My Hostel" view. Mirrors Phase 12 transport.tsx's shape closely — same idiom, same tab pattern.
//
// Verified against the live server/src/modules/hostel/{router,schema,service}.ts. Two things differ from
// Transport's precedent (see useHostel.ts's header comment for the full explanation): there is no
// `/hostel/my-allocation` convenience endpoint, and `GET /hostel/allocations` rows carry no name/label
// decorations — student/bed/room/hostel/warden names are resolved here by cross-referencing `db.users` (from
// the store) and the hostels/rooms/beds list hooks, the same way transport.tsx's AssignmentsSection resolves
// stop/route names for its assignments list.

const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
const iconBtn = 'rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-black/[.05]'
const dangerBtn = 'rounded-full bg-rose-50 dark:bg-rose-500/10 p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-40'
const cardHead = 'flex flex-wrap items-center justify-between gap-3 border-b border-black/[.06] dark:border-white/[.08] px-5 py-3.5'

function AddButton({ label, onClick, small }: { label: string; onClick: () => void; small?: boolean }) {
  return (
    <button onClick={onClick} className={small
      ? 'flex shrink-0 items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15'
      : 'btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold'}>
      <Plus size={small ? 13 : 15} /> {label}
    </button>
  )
}

function FormActions({ onCancel, onSave, label, disabled }: { onCancel: () => void; onSave: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onSave} disabled={disabled} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{label}</button>
      <button onClick={onCancel} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
    </div>
  )
}

function ConfirmModal({ open, title, body, action, busy, onClose, onConfirm }: {
  open: boolean; title: string; body: string; action: string; busy?: boolean; onClose: () => void; onConfirm: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-[14px] text-black/60 dark:text-white/60">{body}</p>
        <div className="flex gap-3">
          <button onClick={onConfirm} disabled={busy} className="btn-ink flex-1 py-3 text-[14px] font-semibold bg-rose-600 hover:bg-rose-700 disabled:opacity-40">{action}</button>
          <button onClick={onClose} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
        </div>
      </div>
    </Modal>
  )
}

const todayIso = () => new Date().toISOString().slice(0, 10)

/* ── admin/staff: Hostel / room / bed forms ────────────────── */

interface HostelForm { name: string; type: HostelType; wardenUserId: string; address: string }
const emptyHostelForm = (): HostelForm => ({ name: '', type: 'Mixed', wardenUserId: '', address: '' })

interface RoomForm { roomNumber: string; floor: string; capacity: string; roomType: string }
const emptyRoomForm = (): RoomForm => ({ roomNumber: '', floor: '', capacity: '', roomType: '' })

/* ── admin/staff: allocate / transfer modal ────────────────── */

interface AllocateTarget { bed: HostelBedRec; hostelName: string; roomNumber: string }

function AllocateModal({ open, onClose, target, availableBeds, onDone }: {
  open: boolean
  onClose: () => void
  /** Pre-selected bed (opened from a specific bed row) — when absent, the picker shows every available bed. */
  target?: AllocateTarget
  availableBeds: AllocateTarget[]
  onDone: () => void
}) {
  const { db } = useStore()
  const { classOf } = useAcademic()
  const allocations = useHostelAllocations({ status: 'Active' })
  const allocatedIds = useMemo(() => new Set((allocations.items ?? []).map(a => a.studentId)), [allocations.items])
  const students = useMemo(
    () => db.users.filter(u => u.role === 'student' && !allocatedIds.has(u.id))
      .map(s => ({ ...s, name: classOf(s.id) ? `${s.name} — ${classOf(s.id)!.label}` : s.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [db.users, allocatedIds, classOf],
  )
  const [studentId, setStudentId] = useState('')
  const [bedId, setBedId] = useState('')
  const [checkInDate, setCheckInDate] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => { setStudentId(''); setBedId(''); setCheckInDate(todayIso()); setNotes('') }
  const close = () => { reset(); onClose() }
  const effectiveBedId = target ? target.bed.id : bedId

  const save = async () => {
    if (!studentId || !effectiveBedId) return
    setBusy(true)
    try {
      await api.post('/hostel/allocations', { studentId, bedId: effectiveBedId, checkInDate, notes: notes.trim() || undefined })
      toast.success('Student allocated')
      reset(); onClose(); onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={close} title={target ? `Allocate ${target.roomNumber} · Bed ${target.bed.bedLabel}` : 'Allocate a student'} wide>
      <div className="space-y-4">
        <Field label="Student">
          <select value={studentId} onChange={e => setStudentId(e.target.value)} className={inputCls}>
            <option value="">Select student</option>
            {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {!target && (
          <Field label="Bed">
            <select value={bedId} onChange={e => setBedId(e.target.value)} className={inputCls}>
              <option value="">Select an available bed</option>
              {availableBeds.map(b => <option key={b.bed.id} value={b.bed.id}>{b.hostelName} · {b.roomNumber} · Bed {b.bed.bedLabel}</option>)}
            </select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Check-in date"><input type="date" value={checkInDate} onChange={e => setCheckInDate(e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optional" className={inputCls} /></Field>
        {students.length === 0 && <p className={muted}>Every student already has an active hostel allocation.</p>}
        <FormActions onCancel={close} onSave={save} label="Allocate" disabled={!studentId || !effectiveBedId || busy} />
      </div>
    </Modal>
  )
}

function TransferModal({ open, onClose, allocation, studentName, availableBeds, onDone }: {
  open: boolean; onClose: () => void; allocation: HostelAllocationRec | null; studentName?: string; availableBeds: AllocateTarget[]; onDone: () => void
}) {
  const [bedId, setBedId] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => { setBedId(''); onClose() }
  const save = async () => {
    if (!allocation || !bedId) return
    setBusy(true)
    try {
      await api.post(`/hostel/allocations/${allocation.id}/transfer`, { bedId })
      toast.success('Student transferred')
      setBedId(''); onClose(); onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={close} title={allocation ? `Transfer ${studentName ?? 'student'}` : 'Transfer'}>
      <div className="space-y-4">
        <Field label="New bed">
          <select value={bedId} onChange={e => setBedId(e.target.value)} className={inputCls} autoFocus>
            <option value="">Select an available bed</option>
            {availableBeds.map(b => <option key={b.bed.id} value={b.bed.id}>{b.hostelName} · {b.roomNumber} · Bed {b.bed.bedLabel}</option>)}
          </select>
        </Field>
        {availableBeds.length === 0 && <p className={muted}>No other bed is currently available.</p>}
        <FormActions onCancel={close} onSave={save} label="Transfer" disabled={!bedId || busy} />
      </div>
    </Modal>
  )
}

/* ── admin/staff: hierarchical Hostels view ────────────────── */

function HostelsSection() {
  const { db } = useStore()
  const hostels = useHostels()
  const rooms = useHostelRooms()
  const beds = useHostelBeds()
  const employees = useEmployees()
  const reloadAll = () => { hostels.reload(); rooms.reload(); beds.reload() }
  const wardenOf = (h: HostelRec) => (h.wardenUserId ? db.users.find(u => u.id === h.wardenUserId) : undefined)

  const roomsByHostel = useMemo(() => {
    const m = new Map<string, HostelRoomRec[]>()
    for (const r of rooms.items ?? []) m.set(r.hostelId, [...(m.get(r.hostelId) ?? []), r])
    for (const arr of m.values()) arr.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
    return m
  }, [rooms.items])
  const bedsByRoom = useMemo(() => {
    const m = new Map<string, HostelBedRec[]>()
    for (const b of beds.items ?? []) m.set(b.roomId, [...(m.get(b.roomId) ?? []), b])
    for (const arr of m.values()) arr.sort((a, b) => a.bedLabel.localeCompare(b.bedLabel, undefined, { numeric: true }))
    return m
  }, [beds.items])
  const sortedHostels = useMemo(() => [...(hostels.items ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [hostels.items])

  // Every available (unoccupied) bed across the school, decorated with hostel/room names, for the allocate
  // picker and the transfer modal's "new bed" select.
  const availableBeds: AllocateTarget[] = useMemo(() => {
    const roomById = new Map((rooms.items ?? []).map(r => [r.id, r]))
    const hostelById = new Map((hostels.items ?? []).map(h => [h.id, h]))
    return (beds.items ?? [])
      .filter(b => !b.occupant)
      .map(b => {
        const room = roomById.get(b.roomId)
        const hostel = room ? hostelById.get(room.hostelId) : undefined
        return { bed: b, hostelName: hostel?.name ?? '—', roomNumber: room?.roomNumber ?? '—' }
      })
  }, [beds.items, rooms.items, hostels.items])

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  // hostel form
  const [hostelOpen, setHostelOpen] = useState(false)
  const [editHostel, setEditHostel] = useState<HostelRec | null>(null)
  const [hostelForm, setHostelForm] = useState<HostelForm>(emptyHostelForm())
  const [hostelBusy, setHostelBusy] = useState(false)
  const openAddHostel = () => { setEditHostel(null); setHostelForm(emptyHostelForm()); setHostelOpen(true) }
  const openEditHostel = (h: HostelRec) => { setEditHostel(h); setHostelForm({ name: h.name, type: h.type, wardenUserId: h.wardenUserId ?? '', address: h.address ?? '' }); setHostelOpen(true) }
  const saveHostel = async () => {
    setHostelBusy(true)
    try {
      const body = { name: hostelForm.name.trim(), type: hostelForm.type, wardenUserId: hostelForm.wardenUserId || undefined, address: hostelForm.address.trim() || undefined }
      if (editHostel) await api.patch(`/hostel/hostels/${editHostel.id}`, body)
      else await api.post('/hostel/hostels', body)
      setHostelOpen(false); reloadAll(); toast.success(editHostel ? 'Hostel updated' : 'Hostel added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setHostelBusy(false) }
  }
  const [delHostel, setDelHostel] = useState<HostelRec | null>(null)
  const removeHostel = async () => {
    if (!delHostel) return
    setHostelBusy(true)
    try { await api.del(`/hostel/hostels/${delHostel.id}`); setDelHostel(null); reloadAll(); toast.success('Hostel deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setHostelBusy(false) }
  }

  // room form
  const [roomOpen, setRoomOpen] = useState(false)
  const [roomHostelId, setRoomHostelId] = useState('')
  const [editRoom, setEditRoom] = useState<HostelRoomRec | null>(null)
  const [roomForm, setRoomForm] = useState<RoomForm>(emptyRoomForm())
  const [roomBusy, setRoomBusy] = useState(false)
  const openAddRoom = (hostelId: string) => { setRoomHostelId(hostelId); setEditRoom(null); setRoomForm(emptyRoomForm()); setRoomOpen(true) }
  const openEditRoom = (r: HostelRoomRec) => {
    setRoomHostelId(r.hostelId); setEditRoom(r)
    setRoomForm({ roomNumber: r.roomNumber, floor: r.floor ?? '', capacity: String(r.capacity), roomType: r.roomType ?? '' })
    setRoomOpen(true)
  }
  const saveRoom = async () => {
    setRoomBusy(true)
    try {
      const body = {
        roomNumber: roomForm.roomNumber.trim(), floor: roomForm.floor.trim() || undefined,
        capacity: Number(roomForm.capacity), roomType: roomForm.roomType.trim() || undefined,
      }
      if (editRoom) await api.patch(`/hostel/rooms/${editRoom.id}`, body)
      else await api.post('/hostel/rooms', { ...body, hostelId: roomHostelId })
      setRoomOpen(false); rooms.reload(); beds.reload(); toast.success(editRoom ? 'Room updated' : 'Room added — beds generated automatically')
    } catch (e) { toast.error(errorMessage(e)) } finally { setRoomBusy(false) }
  }
  const [delRoom, setDelRoom] = useState<HostelRoomRec | null>(null)
  const removeRoom = async () => {
    if (!delRoom) return
    setRoomBusy(true)
    try { await api.del(`/hostel/rooms/${delRoom.id}`); setDelRoom(null); rooms.reload(); beds.reload(); toast.success('Room deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setRoomBusy(false) }
  }

  // bed add (manual, on top of the beds auto-generated at room creation) / delete
  const [bedRoom, setBedRoom] = useState<HostelRoomRec | null>(null)
  const [bedLabel, setBedLabel] = useState('')
  const [bedBusy, setBedBusy] = useState(false)
  const openAddBed = (r: HostelRoomRec) => { setBedRoom(r); setBedLabel(String((bedsByRoom.get(r.id)?.length ?? 0) + 1)) }
  const saveBed = async () => {
    if (!bedRoom) return
    setBedBusy(true)
    try { await api.post('/hostel/beds', { roomId: bedRoom.id, bedLabel: bedLabel.trim() }); setBedRoom(null); beds.reload(); toast.success('Bed added') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBedBusy(false) }
  }
  const [delBed, setDelBed] = useState<HostelBedRec | null>(null)
  const removeBed = async () => {
    if (!delBed) return
    setBedBusy(true)
    try { await api.del(`/hostel/beds/${delBed.id}`); setDelBed(null); beds.reload(); toast.success('Bed removed') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBedBusy(false) }
  }

  // allocation actions
  const [allocateTarget, setAllocateTarget] = useState<AllocateTarget | 'general' | null>(null)
  const [vacateBed, setVacateBed] = useState<HostelBedRec | null>(null)
  const [vacateBusy, setVacateBusy] = useState(false)
  const [transferBed, setTransferBed] = useState<HostelBedRec | null>(null)

  const vacate = async () => {
    if (!vacateBed?.occupant) return
    setVacateBusy(true)
    try { await api.post(`/hostel/allocations/${vacateBed.occupant.allocationId}/vacate`, {}); setVacateBed(null); beds.reload(); toast.success('Bed vacated') }
    catch (e) { toast.error(errorMessage(e)) } finally { setVacateBusy(false) }
  }
  const transferAllocation: HostelAllocationRec | null = transferBed?.occupant
    ? { id: transferBed.occupant.allocationId, studentId: transferBed.occupant.studentId, bedId: transferBed.id, checkInDate: transferBed.occupant.checkInDate, status: 'Active', createdAt: '' }
    : null

  const loading = hostels.loading || rooms.loading || beds.loading
  const err = hostels.error || rooms.error || beds.error

  return (
    <div>
      <div className="mb-4 flex justify-end gap-2">
        <AddButton label="Allocate a student" onClick={() => setAllocateTarget('general')} small />
        <AddButton label="Add hostel" onClick={openAddHostel} />
      </div>

      {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {err && <Empty text={err} />}
      {!loading && !err && sortedHostels.length === 0 && (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><Building2 size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No hostels yet</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">Add a hostel, then its rooms — beds are generated for you.</p>
          <div className="mt-5"><AddButton label="Add first hostel" onClick={openAddHostel} /></div>
        </Card>
      )}

      <div className="space-y-5">
        {sortedHostels.map(h => {
          const hRooms = roomsByHostel.get(h.id) ?? []
          const allBeds = hRooms.flatMap(r => bedsByRoom.get(r.id) ?? [])
          const occupied = allBeds.filter(b => b.occupant).length
          const warden = wardenOf(h)
          const isOpen = expanded.has(h.id)
          return (
            <Card key={h.id} className="p-0">
              <div className={cardHead}>
                <button onClick={() => toggle(h.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  {isOpen ? <ChevronDown size={16} className="shrink-0 text-black/40 dark:text-white/40" /> : <ChevronRight size={16} className="shrink-0 text-black/40 dark:text-white/40" />}
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/[.05] dark:bg-white/[.07]"><Building2 size={16} className="text-black/50 dark:text-white/50" /></span>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold">{h.name}</p>
                    <p className={`truncate ${muted}`}>{warden ? `Warden: ${warden.name}` : 'No warden assigned'}{h.address ? ` · ${h.address}` : ''}</p>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone={hostelTypeTone(h.type)}>{h.type}</Pill>
                  <Pill tone={allBeds.length > 0 && occupied === allBeds.length ? 'amber' : 'slate'}>
                    <Users size={11} /> {occupancyLabel(occupied, allBeds.length)} beds occupied
                  </Pill>
                  <AddButton label="Add room" onClick={() => openAddRoom(h.id)} small />
                  <button onClick={() => openEditHostel(h)} className={iconBtn} aria-label="Edit hostel"><Pencil size={14} /></button>
                  <button onClick={() => setDelHostel(h)} className={dangerBtn} aria-label="Delete hostel"><Trash2 size={14} /></button>
                </div>
              </div>
              {isOpen && (
                allBeds.length > 0 && (
                  <div className="px-5 pt-3">
                    <Progress pct={allBeds.length ? (occupied / allBeds.length) * 100 : 0} />
                  </div>
                )
              )}
              {isOpen && (
                hRooms.length === 0 ? (
                  <div className="p-5"><Empty text="No rooms in this hostel yet." /></div>
                ) : (
                  <div className="divide-y divide-black/[.05] dark:divide-white/[.07] p-5 pt-4">
                    {hRooms.map(r => {
                      const rBeds = bedsByRoom.get(r.id) ?? []
                      const rOccupied = rBeds.filter(b => b.occupant).length
                      return (
                        <div key={r.id} className="py-4 first:pt-0 last:pb-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <DoorOpen size={15} className="text-black/40 dark:text-white/40" />
                              <p className="text-[14px] font-semibold">Room {r.roomNumber}</p>
                              <span className={muted}>{[r.floor ? `Floor ${r.floor}` : null, r.roomType, `cap. ${r.capacity}`].filter(Boolean).join(' · ')}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Pill tone={rBeds.length > 0 && rOccupied === rBeds.length ? 'amber' : 'slate'}>{occupancyLabel(rOccupied, rBeds.length)}</Pill>
                              <AddButton label="Add bed" onClick={() => openAddBed(r)} small />
                              <button onClick={() => openEditRoom(r)} className={iconBtn} aria-label="Edit room"><Pencil size={13} /></button>
                              <button onClick={() => setDelRoom(r)} className={dangerBtn} aria-label="Delete room"><Trash2 size={13} /></button>
                            </div>
                          </div>
                          {rBeds.length === 0 ? (
                            <p className={`mt-2 ${muted}`}>No beds yet.</p>
                          ) : (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {rBeds.map(b => (
                                <div key={b.id} className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[12.5px] ${b.occupant ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10' : 'border-black/10 dark:border-white/15'}`}>
                                  <BedDouble size={13} className={b.occupant ? 'text-emerald-600' : 'text-black/40 dark:text-white/40'} />
                                  <span className="font-semibold">{b.bedLabel}</span>
                                  {b.occupant ? (
                                    <>
                                      <span className="text-emerald-700 dark:text-emerald-300">{b.occupant.studentName}</span>
                                      <button onClick={() => setTransferBed(b)} className="ml-1 rounded-full px-2 py-0.5 font-semibold text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10">Transfer</button>
                                      <button onClick={() => setVacateBed(b)} className="rounded-full px-2 py-0.5 font-semibold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10">Vacate</button>
                                    </>
                                  ) : (
                                    <>
                                      <span className={muted}>Available</span>
                                      <button onClick={() => setAllocateTarget({ bed: b, hostelName: h.name, roomNumber: r.roomNumber })} className="ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10"><UserPlus size={12} /> Allocate</button>
                                      <button onClick={() => setDelBed(b)} className="rounded-full p-0.5 text-black/30 hover:text-rose-500 dark:text-white/30" aria-label="Remove bed"><Trash2 size={12} /></button>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              )}
            </Card>
          )
        })}
      </div>

      {/* hostel form */}
      <Modal open={hostelOpen} onClose={() => setHostelOpen(false)} title={editHostel ? `Edit ${editHostel.name}` : 'New hostel'} wide>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><input value={hostelForm.name} onChange={e => setHostelForm({ ...hostelForm, name: e.target.value })} placeholder="e.g. Sunrise Hostel" className={inputCls} autoFocus /></Field>
            <Field label="Type">
              <select value={hostelForm.type} onChange={e => setHostelForm({ ...hostelForm, type: e.target.value as HostelType })} className={inputCls}>
                {HOSTEL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <SearchableUserPicker label="Warden (optional)" employees={employees} value={hostelForm.wardenUserId} onChange={id => setHostelForm({ ...hostelForm, wardenUserId: id })} />
          <Field label="Address"><textarea value={hostelForm.address} onChange={e => setHostelForm({ ...hostelForm, address: e.target.value })} rows={2} placeholder="Optional" className={inputCls} /></Field>
          <FormActions onCancel={() => setHostelOpen(false)} onSave={saveHostel} label={editHostel ? 'Save changes' : 'Add hostel'} disabled={!hostelForm.name.trim() || hostelBusy} />
        </div>
      </Modal>

      {/* room form */}
      <Modal open={roomOpen} onClose={() => setRoomOpen(false)} title={editRoom ? `Edit room ${editRoom.roomNumber}` : 'New room'}>
        <div className="space-y-4">
          <Field label="Room number"><input value={roomForm.roomNumber} onChange={e => setRoomForm({ ...roomForm, roomNumber: e.target.value })} placeholder="e.g. 204" className={inputCls} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Floor"><input value={roomForm.floor} onChange={e => setRoomForm({ ...roomForm, floor: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
            <Field label="Room type"><input value={roomForm.roomType} onChange={e => setRoomForm({ ...roomForm, roomType: e.target.value })} placeholder="e.g. Dorm, Double, Single" className={inputCls} /></Field>
          </div>
          <Field label="Capacity (beds)"><input type="number" min={1} value={roomForm.capacity} onChange={e => setRoomForm({ ...roomForm, capacity: e.target.value })} className={inputCls} /></Field>
          {!editRoom && <p className={muted}>Beds are generated automatically to match capacity — add or remove individual beds afterwards if needed.</p>}
          <FormActions onCancel={() => setRoomOpen(false)} onSave={saveRoom} label={editRoom ? 'Save changes' : 'Add room'} disabled={!roomForm.roomNumber.trim() || !roomForm.capacity.trim() || Number(roomForm.capacity) <= 0 || roomBusy} />
        </div>
      </Modal>

      {/* bed add */}
      <Modal open={!!bedRoom} onClose={() => setBedRoom(null)} title={bedRoom ? `Add a bed to room ${bedRoom.roomNumber}` : 'Add bed'}>
        <div className="space-y-4">
          <Field label="Bed label"><input value={bedLabel} onChange={e => setBedLabel(e.target.value)} placeholder="e.g. A, B, or 3" className={inputCls} autoFocus /></Field>
          <FormActions onCancel={() => setBedRoom(null)} onSave={saveBed} label="Add bed" disabled={!bedLabel.trim() || bedBusy} />
        </div>
      </Modal>

      <ConfirmModal open={!!delHostel} onClose={() => setDelHostel(null)} title={`Delete ${delHostel?.name ?? 'hostel'}?`}
        body="This removes every room and bed in this hostel. This cannot be undone." action="Delete hostel" busy={hostelBusy} onConfirm={removeHostel} />
      <ConfirmModal open={!!delRoom} onClose={() => setDelRoom(null)} title={`Delete room ${delRoom?.roomNumber ?? ''}?`}
        body="This removes every bed in this room. This cannot be undone." action="Delete room" busy={roomBusy} onConfirm={removeRoom} />
      <ConfirmModal open={!!delBed} onClose={() => setDelBed(null)} title={`Remove bed ${delBed?.bedLabel ?? ''}?`}
        body="This cannot be undone." action="Remove bed" busy={bedBusy} onConfirm={removeBed} />
      <ConfirmModal open={!!vacateBed} onClose={() => setVacateBed(null)} title={`Vacate bed ${vacateBed?.bedLabel ?? ''}?`}
        body={`${vacateBed?.occupant?.studentName ?? 'This student'} will be checked out and the bed freed up.`} action="Vacate" busy={vacateBusy} onConfirm={vacate} />

      <AllocateModal
        open={!!allocateTarget}
        onClose={() => setAllocateTarget(null)}
        target={allocateTarget && allocateTarget !== 'general' ? allocateTarget : undefined}
        availableBeds={availableBeds}
        onDone={reloadAll}
      />
      <TransferModal
        open={!!transferBed}
        onClose={() => setTransferBed(null)}
        allocation={transferAllocation}
        studentName={transferBed?.occupant?.studentName}
        availableBeds={availableBeds}
        onDone={reloadAll}
      />
    </div>
  )
}

/* ── admin/staff: Allocations history/list ─────────────────── */

function AllocationsSection() {
  const { db } = useStore()
  const [status, setStatus] = useState<HostelAllocationRec['status'] | ''>('')
  const allocations = useHostelAllocations(status ? { status } : {})
  // Allocation rows carry no name/label decorations — resolve student/bed/room/hostel by cross-referencing
  // the always-open reads, same as HostelsSection.
  const hostels = useHostels()
  const rooms = useHostelRooms()
  const beds = useHostelBeds()
  const bedById = useMemo(() => new Map((beds.items ?? []).map(b => [b.id, b])), [beds.items])
  const roomById = useMemo(() => new Map((rooms.items ?? []).map(r => [r.id, r])), [rooms.items])
  const hostelById = useMemo(() => new Map((hostels.items ?? []).map(h => [h.id, h])), [hostels.items])
  const describe = (a: HostelAllocationRec) => {
    const bed = bedById.get(a.bedId)
    const room = bed ? roomById.get(bed.roomId) : undefined
    const hostel = room ? hostelById.get(room.hostelId) : undefined
    return {
      studentName: db.users.find(u => u.id === a.studentId)?.name ?? a.studentId,
      allocatedByName: a.allocatedById ? db.users.find(u => u.id === a.allocatedById)?.name : undefined,
      location: [hostel?.name, room ? `Room ${room.roomNumber}` : null, bed ? `Bed ${bed.bedLabel}` : null].filter(Boolean).join(' · ') || '—',
    }
  }
  const sorted = useMemo(
    () => [...(allocations.items ?? [])].sort((a, b) => (b.checkInDate || '').localeCompare(a.checkInDate || '')),
    [allocations.items],
  )
  const statusFilters: (HostelAllocationRec['status'] | '')[] = ['', ...ALLOCATION_STATUSES]
  const loading = allocations.loading || hostels.loading || rooms.loading || beds.loading
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
          {statusFilters.map(s => (
            <button key={s || 'all'} onClick={() => setStatus(s)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${status === s ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>
      <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
        {loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>}
        {allocations.error && <div className="p-6 text-center text-[13px] text-rose-500">{allocations.error}</div>}
        {!loading && !allocations.error && sorted.length === 0 && <div className="p-6"><Empty text="No allocations to show." /></div>}
        {!loading && sorted.map(a => {
          const d = describe(a)
          return (
            <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="min-w-52 flex-1">
                <p className="text-[14.5px] font-semibold">{d.studentName}</p>
                <p className={muted}>{d.location}{d.allocatedByName ? ` · allocated by ${d.allocatedByName}` : ''}</p>
              </div>
              <div className={muted}>
                {fmtDate(a.checkInDate)}{a.checkOutDate ? ` – ${fmtDate(a.checkOutDate)}` : ' – present'}
              </div>
              <Pill tone={allocationStatusTone(a.status)}>{a.status}</Pill>
            </div>
          )
        })}
      </Card>
    </div>
  )
}

/* ── admin/staff: top-level Hostel module ──────────────────── */

type HostelTab = 'hostels' | 'allocations'
const HOSTEL_TABS: { id: HostelTab; label: string }[] = [{ id: 'hostels', label: 'Hostels & Rooms' }, { id: 'allocations', label: 'Allocations' }]

export function HostelMod() {
  const [tab, setTab] = useState<HostelTab>('hostels')
  return (
    <div>
      <PageHead title="Hostel Management" sub="Hostels, rooms and beds, with student allocations">
        <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
          {HOSTEL_TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${tab === t.id ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </PageHead>
      {tab === 'hostels' && <HostelsSection />}
      {tab === 'allocations' && <AllocationsSection />}
    </div>
  )
}

/* ── parent/student: My Hostel ──────────────────────────────── */

export function MyHostelMod() {
  const { db, user } = useStore()
  const isParent = user?.role === 'parent'
  const { students, ward, wardId, setWardId } = useWard()
  const enabled = isParent ? !!ward : !!user
  const { allocation, bed, room, hostel, loading, error } = useMyHostel(isParent ? wardId : undefined, enabled)
  const warden = hostel?.wardenUserId ? db.users.find(u => u.id === hostel.wardenUserId) : undefined

  return (
    <div>
      <PageHead title="My Hostel" sub={isParent ? (ward ? `${firstName(ward.name)}’s hostel allocation` : 'Track your ward’s hostel allocation') : 'Your hostel, room and bed'}>
        {isParent && <WardPicker students={students} value={wardId} onChange={setWardId} />}
      </PageHead>

      {isParent && students.length === 0 && <Empty text="No student is linked to your account yet." />}
      {enabled && loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {enabled && error && <Empty text={error} />}
      {enabled && !loading && !error && !allocation && (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/[.05] dark:bg-white/[.07] text-black/40 dark:text-white/40"><BedDouble size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">Not allocated</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">No hostel bed has been assigned yet — contact the school office.</p>
        </Card>
      )}
      {allocation && (
        <div className="space-y-5">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              {hostel && <Pill tone={hostelTypeTone(hostel.type)}>{hostel.type}</Pill>}
              <Pill tone={allocationStatusTone(allocation.status)}>{allocation.status}</Pill>
            </div>
            <p className="font-display mt-3 text-[20px] font-medium">{hostel?.name ?? 'Hostel'}</p>
            <div className="mt-3 grid gap-4 text-[13.5px] sm:grid-cols-2">
              <div><p className={muted}>Room</p><p className="font-medium">{room?.roomNumber ?? '—'}{room?.roomType ? ` · ${room.roomType}` : ''}</p></div>
              <div><p className={muted}>Bed</p><p className="font-medium">{bed?.bedLabel ?? '—'}</p></div>
              <div><p className={muted}>Checked in</p><p className="font-medium">{fmtDate(allocation.checkInDate)}</p></div>
              {hostel?.address && <div className="sm:col-span-2 flex items-start gap-1.5"><MapPin size={13} className="mt-0.5 shrink-0 text-black/40 dark:text-white/40" /><p className="font-medium">{hostel.address}</p></div>}
            </div>
          </Card>

          <Card>
            <p className={sectionLabel}>Warden</p>
            {!warden ? (
              <p className="mt-2 text-[13.5px] text-black/50 dark:text-white/50">No warden has been assigned to this hostel yet.</p>
            ) : (
              <div className="mt-3 flex items-center gap-4 text-[13.5px]">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><ShieldCheck size={22} /></span>
                <div>
                  <p className="font-semibold">{warden.name}</p>
                  {warden.phone && <p className="mt-0.5 flex items-center gap-1.5 text-black/60 dark:text-white/60"><Phone size={12} /> {warden.phone}</p>}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
