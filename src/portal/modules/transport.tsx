import { useMemo, useState } from 'react'
import {
  Bus, ChevronDown, ChevronUp, MapPin, Pencil, Phone, Plus, Radio, Route as RouteIcon, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import type { BoardingType, MyStopAssignmentRec, RouteRec, StopRec, StudentStopAssignmentRec, VehicleRec } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { useEmployees } from '@/lib/hooks/useFinance'
import {
  BOARDING_TYPES, boardingTone, haversineKm, isLocationStale, minutesAgo, useAssignments, useMyStop, useRoutes, useStops, useVehicles,
} from '@/lib/hooks/useTransport'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'
import { SearchableUserPicker } from './employee'
import { WardPicker } from './academics'
import { firstName, useWard } from './viewer'

// Phase 12 — Transport / Bus management: admin/staff setup (routes with ordered stops, vehicles, student-stop
// assignments) and a parent/student "My Bus" view reading the future native driver app's location pings.
// The web app never writes a location — only POST /transport/vehicles/:id/ping (curl-testable) does that, from
// a driver-facing screen this phase deliberately does not build. See .agents/edunova/phase-12-transport.md

const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
const iconBtn = 'rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-black/[.05]'
const dangerBtn = 'rounded-full bg-rose-50 dark:bg-rose-500/10 p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-40'
const rowCls = 'flex flex-wrap items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-5 py-3.5 last:border-0'
const cardHead = 'flex items-center justify-between gap-3 border-b border-black/[.06] dark:border-white/[.08] px-5 py-3'

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

/* ── admin/staff: Routes & Stops ───────────────────────── */

interface RouteForm { name: string; description: string }
const emptyRouteForm = (): RouteForm => ({ name: '', description: '' })
interface StopForm { name: string; latitude: string; longitude: string; arrivalOffsetMin: string }
const emptyStopForm = (): StopForm => ({ name: '', latitude: '', longitude: '', arrivalOffsetMin: '' })

function RoutesStopsSection() {
  const routes = useRoutes()
  const stops = useStops()
  const reloadAll = () => { routes.reload(); stops.reload() }

  const sortedRoutes = useMemo(() => [...(routes.items ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [routes.items])
  const stopsByRoute = useMemo(() => {
    const m = new Map<string, StopRec[]>()
    for (const s of stops.items ?? []) m.set(s.routeId, [...(m.get(s.routeId) ?? []), s])
    for (const arr of m.values()) arr.sort((a, b) => a.sequence - b.sequence)
    return m
  }, [stops.items])

  // route form
  const [routeOpen, setRouteOpen] = useState(false)
  const [editRoute, setEditRoute] = useState<RouteRec | null>(null)
  const [routeForm, setRouteForm] = useState<RouteForm>(emptyRouteForm())
  const [routeBusy, setRouteBusy] = useState(false)
  const openAddRoute = () => { setEditRoute(null); setRouteForm(emptyRouteForm()); setRouteOpen(true) }
  const openEditRoute = (r: RouteRec) => { setEditRoute(r); setRouteForm({ name: r.name, description: r.description ?? '' }); setRouteOpen(true) }
  const saveRoute = async () => {
    setRouteBusy(true)
    try {
      const body = { name: routeForm.name.trim(), description: routeForm.description.trim() || undefined }
      if (editRoute) await api.patch(`/transport/routes/${editRoute.id}`, body)
      else await api.post('/transport/routes', body)
      setRouteOpen(false); reloadAll(); toast.success(editRoute ? 'Route updated' : 'Route added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setRouteBusy(false) }
  }
  const [delRoute, setDelRoute] = useState<RouteRec | null>(null)
  const removeRoute = async () => {
    if (!delRoute) return
    setRouteBusy(true)
    try { await api.del(`/transport/routes/${delRoute.id}`); setDelRoute(null); reloadAll(); toast.success('Route deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setRouteBusy(false) }
  }

  // stop form
  const [stopOpen, setStopOpen] = useState(false)
  const [stopRouteId, setStopRouteId] = useState('')
  const [editStop, setEditStop] = useState<StopRec | null>(null)
  const [stopForm, setStopForm] = useState<StopForm>(emptyStopForm())
  const [stopBusy, setStopBusy] = useState(false)
  const openAddStop = (routeId: string) => { setStopRouteId(routeId); setEditStop(null); setStopForm(emptyStopForm()); setStopOpen(true) }
  const openEditStop = (s: StopRec) => {
    setStopRouteId(s.routeId); setEditStop(s)
    setStopForm({ name: s.name, latitude: s.latitude != null ? String(s.latitude) : '', longitude: s.longitude != null ? String(s.longitude) : '', arrivalOffsetMin: s.arrivalOffsetMin != null ? String(s.arrivalOffsetMin) : '' })
    setStopOpen(true)
  }
  const saveStop = async () => {
    setStopBusy(true)
    try {
      const body = {
        name: stopForm.name.trim(),
        latitude: stopForm.latitude.trim() ? Number(stopForm.latitude) : undefined,
        longitude: stopForm.longitude.trim() ? Number(stopForm.longitude) : undefined,
        arrivalOffsetMin: stopForm.arrivalOffsetMin.trim() ? Number(stopForm.arrivalOffsetMin) : undefined,
        sequence: editStop ? editStop.sequence : (stopsByRoute.get(stopRouteId)?.length ?? 0) + 1,
      }
      // routeId is fixed at creation — the server rejects it on PATCH (moving routes is delete+recreate).
      if (editStop) await api.patch(`/transport/stops/${editStop.id}`, body)
      else await api.post('/transport/stops', { ...body, routeId: stopRouteId })
      setStopOpen(false); stops.reload(); toast.success(editStop ? 'Stop updated' : 'Stop added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setStopBusy(false) }
  }
  const [delStop, setDelStop] = useState<StopRec | null>(null)
  const removeStop = async () => {
    if (!delStop) return
    setStopBusy(true)
    try { await api.del(`/transport/stops/${delStop.id}`); setDelStop(null); stops.reload(); toast.success('Stop removed') }
    catch (e) { toast.error(errorMessage(e)) } finally { setStopBusy(false) }
  }
  const [moving, setMoving] = useState(false)
  const moveStop = async (routeId: string, index: number, dir: -1 | 1) => {
    const list = stopsByRoute.get(routeId) ?? []
    const a = list[index], b = list[index + dir]
    if (!a || !b) return
    setMoving(true)
    try {
      // `Stop` has a `@@unique([routeId, sequence])` constraint, so swapping two adjacent sequence numbers
      // can't be done as two parallel/independent PATCHes (whichever lands second collides with the value
      // the first one just vacated isn't cleared yet) — park `a` on an out-of-range value first, move `b`
      // into `a`'s old slot, then move `a` into `b`'s old slot. Three sequential requests, never colliding.
      await api.patch(`/transport/stops/${a.id}`, { sequence: 1_000_000 + a.sequence })
      await api.patch(`/transport/stops/${b.id}`, { sequence: a.sequence })
      await api.patch(`/transport/stops/${a.id}`, { sequence: b.sequence })
      stops.reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setMoving(false) }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end"><AddButton label="Add route" onClick={openAddRoute} /></div>

      {routes.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading routes…</p>}
      {routes.error && <Empty text={routes.error} />}
      {!routes.loading && !routes.error && sortedRoutes.length === 0 && (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><RouteIcon size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No routes yet</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">Create a route, then add its stops in order.</p>
          <div className="mt-5"><AddButton label="Add first route" onClick={openAddRoute} /></div>
        </Card>
      )}

      <div className="space-y-5">
        {sortedRoutes.map(r => {
          const rStops = stopsByRoute.get(r.id) ?? []
          return (
            <Card key={r.id} className="p-0">
              <div className={cardHead}>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold">{r.name}</p>
                  {r.description && <p className={`mt-0.5 truncate ${muted}`}>{r.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <AddButton label="Add stop" onClick={() => openAddStop(r.id)} small />
                  <button onClick={() => openEditRoute(r)} className={iconBtn} aria-label="Edit route"><Pencil size={14} /></button>
                  <button onClick={() => setDelRoute(r)} className={dangerBtn} aria-label="Delete route"><Trash2 size={14} /></button>
                </div>
              </div>
              {rStops.length === 0 ? (
                <div className="p-5"><Empty text="No stops on this route yet." /></div>
              ) : rStops.map((s, i) => (
                <div key={s.id} className={rowCls}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[.05] dark:bg-white/[.07] text-[12px] font-semibold text-black/50 dark:text-white/50">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{s.name}</p>
                    <p className={muted}>
                      {s.latitude != null && s.longitude != null ? `${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)}` : 'No coordinates'}
                      {s.arrivalOffsetMin != null ? ` · +${s.arrivalOffsetMin} min` : ''}
                    </p>
                  </div>
                  <button onClick={() => moveStop(r.id, i, -1)} disabled={i === 0 || moving} className={iconBtn} aria-label="Move up"><ChevronUp size={14} /></button>
                  <button onClick={() => moveStop(r.id, i, 1)} disabled={i === rStops.length - 1 || moving} className={iconBtn} aria-label="Move down"><ChevronDown size={14} /></button>
                  <button onClick={() => openEditStop(s)} className={iconBtn} aria-label="Edit stop"><Pencil size={14} /></button>
                  <button onClick={() => setDelStop(s)} className={dangerBtn} aria-label="Delete stop"><Trash2 size={14} /></button>
                </div>
              ))}
            </Card>
          )
        })}
      </div>

      <Modal open={routeOpen} onClose={() => setRouteOpen(false)} title={editRoute ? `Edit ${editRoute.name}` : 'New route'}>
        <div className="space-y-4">
          <Field label="Name"><input value={routeForm.name} onChange={e => setRouteForm({ ...routeForm, name: e.target.value })} placeholder="e.g. North Loop" className={inputCls} autoFocus /></Field>
          <Field label="Description"><textarea value={routeForm.description} onChange={e => setRouteForm({ ...routeForm, description: e.target.value })} rows={2} placeholder="Optional notes about this route" className={inputCls} /></Field>
          <FormActions onCancel={() => setRouteOpen(false)} onSave={saveRoute} label={editRoute ? 'Save changes' : 'Add route'} disabled={!routeForm.name.trim() || routeBusy} />
        </div>
      </Modal>

      <Modal open={stopOpen} onClose={() => setStopOpen(false)} title={editStop ? `Edit ${editStop.name}` : 'New stop'}>
        <div className="space-y-4">
          <Field label="Name"><input value={stopForm.name} onChange={e => setStopForm({ ...stopForm, name: e.target.value })} placeholder="e.g. Elm Street Junction" className={inputCls} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude"><input value={stopForm.latitude} onChange={e => setStopForm({ ...stopForm, latitude: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
            <Field label="Longitude"><input value={stopForm.longitude} onChange={e => setStopForm({ ...stopForm, longitude: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
          </div>
          <Field label="Arrival offset (minutes from route start)"><input type="number" min={0} value={stopForm.arrivalOffsetMin} onChange={e => setStopForm({ ...stopForm, arrivalOffsetMin: e.target.value })} placeholder="Optional — for a rough ETA" className={inputCls} /></Field>
          {!editStop && <p className={muted}>New stops go to the bottom of the route — use the arrows to reorder.</p>}
          <FormActions onCancel={() => setStopOpen(false)} onSave={saveStop} label={editStop ? 'Save changes' : 'Add stop'} disabled={!stopForm.name.trim() || stopBusy} />
        </div>
      </Modal>

      <ConfirmModal open={!!delRoute} onClose={() => setDelRoute(null)} title={`Delete ${delRoute?.name ?? 'route'}?`}
        body="This removes every stop on this route and unassigns any vehicle or student attached to it. This cannot be undone."
        action="Delete route" busy={routeBusy} onConfirm={removeRoute} />
      <ConfirmModal open={!!delStop} onClose={() => setDelStop(null)} title={`Delete ${delStop?.name ?? 'stop'}?`}
        body="Students currently assigned to this stop will need to be reassigned. This cannot be undone."
        action="Delete stop" busy={stopBusy} onConfirm={removeStop} />
    </div>
  )
}

/* ── admin/staff: Vehicles ─────────────────────────────── */

interface VehicleForm {
  registrationNo: string; capacity: string; routeId: string
  driverName: string; driverPhone: string; conductorName: string; conductorPhone: string; driverUserId: string
}
const emptyVehicleForm = (): VehicleForm => ({ registrationNo: '', capacity: '', routeId: '', driverName: '', driverPhone: '', conductorName: '', conductorPhone: '', driverUserId: '' })

function VehiclesSection() {
  const vehicles = useVehicles()
  const routes = useRoutes()
  const employees = useEmployees()
  const routeName = (id?: string | null) => (routes.items ?? []).find(r => r.id === id)?.name
  const sorted = useMemo(() => [...(vehicles.items ?? [])].sort((a, b) => a.registrationNo.localeCompare(b.registrationNo)), [vehicles.items])

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<VehicleRec | null>(null)
  const [form, setForm] = useState<VehicleForm>(emptyVehicleForm())
  const [busy, setBusy] = useState(false)
  const openAdd = () => { setEditing(null); setForm(emptyVehicleForm()); setOpen(true) }
  const openEdit = (v: VehicleRec) => {
    setEditing(v)
    setForm({
      registrationNo: v.registrationNo, capacity: String(v.capacity), routeId: v.routeId ?? '',
      driverName: v.driverName, driverPhone: v.driverPhone, conductorName: v.conductorName ?? '', conductorPhone: v.conductorPhone ?? '',
      driverUserId: v.driverUserId ?? '',
    })
    setOpen(true)
  }
  const save = async () => {
    setBusy(true)
    try {
      const body = {
        registrationNo: form.registrationNo.trim(), capacity: Number(form.capacity), routeId: form.routeId || undefined,
        driverName: form.driverName.trim(), driverPhone: form.driverPhone.trim(),
        conductorName: form.conductorName.trim() || undefined, conductorPhone: form.conductorPhone.trim() || undefined,
        driverUserId: form.driverUserId || undefined,
      }
      if (editing) await api.patch(`/transport/vehicles/${editing.id}`, body)
      else await api.post('/transport/vehicles', body)
      setOpen(false); vehicles.reload(); toast.success(editing ? 'Vehicle updated' : 'Vehicle added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const [del, setDel] = useState<VehicleRec | null>(null)
  const remove = async () => {
    if (!del) return
    setBusy(true)
    try { await api.del(`/transport/vehicles/${del.id}`); setDel(null); vehicles.reload(); toast.success('Vehicle removed') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const valid = form.registrationNo.trim() && form.capacity.trim() && Number(form.capacity) > 0 && form.driverName.trim() && form.driverPhone.trim()

  return (
    <div>
      <div className="mb-4 flex justify-end"><AddButton label="Add vehicle" onClick={openAdd} /></div>

      {vehicles.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading vehicles…</p>}
      {vehicles.error && <Empty text={vehicles.error} />}
      {!vehicles.loading && !vehicles.error && sorted.length === 0 && (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><Bus size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No vehicles yet</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">Add a bus and, optionally, assign it to a route.</p>
          <div className="mt-5"><AddButton label="Add first vehicle" onClick={openAdd} /></div>
        </Card>
      )}

      {sorted.length > 0 && (
        <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
          {sorted.map(v => (
            <div key={v.id} className={rowCls}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/[.05] dark:bg-white/[.07]"><Bus size={16} className="text-black/50 dark:text-white/50" /></span>
              <div className="min-w-52 flex-1">
                <p className="text-[14.5px] font-semibold">{v.registrationNo} <span className={muted}>· cap. {v.capacity}</span></p>
                <p className={muted}>{v.driverName} · {v.driverPhone}{v.conductorName ? ` · conductor ${v.conductorName}` : ''}</p>
              </div>
              {v.routeId ? <Pill tone="indigo"><RouteIcon size={10} /> {routeName(v.routeId) ?? v.routeId}</Pill> : <Pill tone="slate">Unassigned</Pill>}
              <button onClick={() => openEdit(v)} className={iconBtn} aria-label="Edit"><Pencil size={14} /></button>
              <button onClick={() => setDel(v)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
            </div>
          ))}
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Edit ${editing.registrationNo}` : 'New vehicle'} wide>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Registration number"><input value={form.registrationNo} onChange={e => setForm({ ...form, registrationNo: e.target.value })} placeholder="e.g. KA-01-AB-1234" className={inputCls} autoFocus /></Field>
            <Field label="Capacity"><input type="number" min={1} value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} className={inputCls} /></Field>
          </div>
          <Field label="Route">
            <select value={form.routeId} onChange={e => setForm({ ...form, routeId: e.target.value })} className={inputCls}>
              <option value="">Unassigned</option>
              {(routes.items ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Driver name"><input value={form.driverName} onChange={e => setForm({ ...form, driverName: e.target.value })} className={inputCls} /></Field>
            <Field label="Driver phone"><input value={form.driverPhone} onChange={e => setForm({ ...form, driverPhone: e.target.value })} className={inputCls} /></Field>
            <Field label="Conductor name"><input value={form.conductorName} onChange={e => setForm({ ...form, conductorName: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
            <Field label="Conductor phone"><input value={form.conductorPhone} onChange={e => setForm({ ...form, conductorPhone: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
          </div>
          <SearchableUserPicker label="Link to a staff account (optional — for the future driver app)" employees={employees} value={form.driverUserId} onChange={id => setForm({ ...form, driverUserId: id })} />
          <FormActions onCancel={() => setOpen(false)} onSave={save} label={editing ? 'Save changes' : 'Add vehicle'} disabled={!valid || busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!del} onClose={() => setDel(null)} title={`Remove ${del?.registrationNo ?? 'vehicle'}?`}
        body="This cannot be undone." action="Remove vehicle" busy={busy} onConfirm={remove} />
    </div>
  )
}

/* ── admin/staff: student ↔ stop assignments ───────────── */

function AssignmentsSection() {
  const { db } = useStore()
  const routes = useRoutes()
  const stops = useStops()
  const assignments = useAssignments({})
  const nameOf = (id: string) => db.users.find(u => u.id === id)?.name ?? id
  const stopOf = (id: string) => (stops.items ?? []).find(s => s.id === id)
  const routeNameOfStop = (stopId: string) => { const s = stopOf(stopId); return s ? (routes.items ?? []).find(r => r.id === s.routeId)?.name : undefined }

  const [studentId, setStudentId] = useState('')
  const [routeId, setRouteId] = useState('')
  const [stopId, setStopId] = useState('')
  const [boardingType, setBoardingType] = useState<BoardingType>('Both')
  const [busy, setBusy] = useState(false)
  const stopsForRoute = useMemo(() => (stops.items ?? []).filter(s => s.routeId === routeId).sort((a, b) => a.sequence - b.sequence), [stops.items, routeId])

  const assign = async () => {
    if (!studentId || !stopId) return
    setBusy(true)
    try {
      await api.post('/transport/assignments', { studentId, stopId, boardingType })
      setStudentId(''); setRouteId(''); setStopId(''); setBoardingType('Both')
      assignments.reload()
      toast.success('Student assigned to stop')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const unassign = async (a: StudentStopAssignmentRec) => {
    try { await api.del(`/transport/assignments/${a.id}`); assignments.reload(); toast.success('Assignment removed') }
    catch (e) { toast.error(errorMessage(e)) }
  }

  const sortedAssignments = useMemo(
    () => [...(assignments.items ?? [])].sort((a, b) => (a.studentName ?? nameOf(a.studentId)).localeCompare(b.studentName ?? nameOf(b.studentId))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignments.items, db.users],
  )

  return (
    <div className="space-y-6">
      <Card>
        <p className={sectionLabel}>Assign a student to a stop</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Student">
            <AsyncEntityPicker role="student" value={studentId} onChange={id => setStudentId(id)} placeholder="Search student…" />
          </Field>
          <Field label="Route">
            <select value={routeId} onChange={e => { setRouteId(e.target.value); setStopId('') }} className={inputCls}>
              <option value="">Select route</option>
              {(routes.items ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Stop">
            <select value={stopId} onChange={e => setStopId(e.target.value)} disabled={!routeId} className={inputCls}>
              <option value="">{routeId ? 'Select stop' : 'Pick a route first'}</option>
              {stopsForRoute.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Boarding">
            <select value={boardingType} onChange={e => setBoardingType(e.target.value as BoardingType)} className={inputCls}>
              {BOARDING_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
        </div>
        <button onClick={assign} disabled={!studentId || !stopId || busy} className="btn-ink mt-4 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">{busy ? 'Assigning…' : 'Assign'}</button>
      </Card>

      <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
        {assignments.loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>}
        {assignments.error && <div className="p-6 text-center text-[13px] text-rose-500">{assignments.error}</div>}
        {!assignments.loading && !assignments.error && sortedAssignments.length === 0 && <div className="p-6"><Empty text="No students assigned to a stop yet." /></div>}
        {sortedAssignments.map(a => (
          <div key={a.id} className={rowCls}>
            <div className="min-w-52 flex-1">
              <p className="text-[14.5px] font-semibold">{a.studentName ?? nameOf(a.studentId)}</p>
              <p className={muted}>{a.stopName ?? stopOf(a.stopId)?.name ?? a.stopId} · {a.routeName ?? routeNameOfStop(a.stopId) ?? '—'}</p>
            </div>
            <Pill tone={boardingTone(a.boardingType)}>{a.boardingType}</Pill>
            <button onClick={() => unassign(a)} className={dangerBtn} aria-label="Unassign"><Trash2 size={14} /></button>
          </div>
        ))}
      </Card>
    </div>
  )
}

/* ── admin/staff: top-level Transport module ───────────── */

type TransportTab = 'routes' | 'vehicles' | 'assign'
const TRANSPORT_TABS: { id: TransportTab; label: string }[] = [
  { id: 'routes', label: 'Routes & Stops' }, { id: 'vehicles', label: 'Vehicles' }, { id: 'assign', label: 'Assignments' },
]

export function TransportMod() {
  const [tab, setTab] = useState<TransportTab>('routes')
  return (
    <div>
      <PageHead title="Transport" sub="Routes with ordered stops, vehicles, and which stop each student uses">
        <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
          {TRANSPORT_TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${tab === t.id ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </PageHead>
      {tab === 'routes' && <RoutesStopsSection />}
      {tab === 'vehicles' && <VehiclesSection />}
      {tab === 'assign' && <AssignmentsSection />}
    </div>
  )
}

/* ── parent/student: My Bus ─────────────────────────────── */

function MyBusCard({ data }: { data: MyStopAssignmentRec }) {
  const { boardingType, stop, route, vehicle, location } = data
  const stale = isLocationStale(location?.recordedAt)
  const distKm = location && stop.latitude != null && stop.longitude != null
    ? haversineKm(location.latitude, location.longitude, stop.latitude, stop.longitude) : undefined

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="indigo"><RouteIcon size={11} /> {route.name}</Pill>
          <Pill tone={boardingTone(boardingType)}>{boardingType}</Pill>
        </div>
        <p className="font-display mt-3 text-[20px] font-medium">{stop.name}</p>
        {(stop.arrivalOffsetMin != null || route.description) && (
          <div className="mt-3 grid gap-4 text-[13.5px] sm:grid-cols-2">
            {stop.arrivalOffsetMin != null && <div><p className={muted}>Estimated time from route start</p><p className="font-medium">{stop.arrivalOffsetMin} min</p></div>}
            {route.description && <div className="sm:col-span-2"><p className={muted}>Route notes</p><p className="font-medium">{route.description}</p></div>}
          </div>
        )}
      </Card>

      <Card>
        <p className={sectionLabel}>Vehicle</p>
        {!vehicle ? (
          <p className="mt-2 text-[13.5px] text-black/50 dark:text-white/50">No vehicle is currently assigned to this route.</p>
        ) : (
          <div className="mt-3 grid gap-4 text-[13.5px] sm:grid-cols-2">
            <div><p className={muted}>Registration</p><p className="font-semibold">{vehicle.registrationNo}</p></div>
            <div><p className={muted}>Driver</p><p className="flex items-center gap-1.5 font-medium"><Phone size={12} /> {vehicle.driverName} · {vehicle.driverPhone}</p></div>
            {vehicle.conductorName && (
              <div className="sm:col-span-2"><p className={muted}>Conductor</p><p className="font-medium">{vehicle.conductorName}{vehicle.conductorPhone ? ` · ${vehicle.conductorPhone}` : ''}</p></div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <p className={sectionLabel}>Live location</p>
          {location && <Pill tone={stale ? 'slate' : 'green'}>{stale ? 'Not currently tracked' : <span className="flex items-center gap-1"><Radio size={11} /> Live</span>}</Pill>}
        </div>
        {!location ? (
          <p className="mt-3 text-[13.5px] text-black/50 dark:text-white/50">No location has been recorded for this bus yet.</p>
        ) : (
          <div className="mt-3 flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><MapPin size={22} /></span>
            <div>
              <p className="text-[14.5px] font-semibold">{stale ? 'Last seen' : 'Currently'} near {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}</p>
              <p className={`mt-0.5 ${muted}`}>{minutesAgo(location.recordedAt) === 0 ? 'Just now' : `${minutesAgo(location.recordedAt)} min ago`} · {fmtDate(location.recordedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
              {distKm !== undefined && <p className="mt-1 text-[12.5px] text-black/45 dark:text-white/45">~{distKm.toFixed(1)} km from your stop (straight-line)</p>}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

export function MyBusMod() {
  const { user } = useStore()
  const isParent = user?.role === 'parent'
  const { students, ward, wardId, setWardId } = useWard()
  const enabled = isParent ? !!ward : !!user
  const { data: myStop, loading, error } = useMyStop(isParent ? wardId : undefined, enabled)

  return (
    <div>
      <PageHead title="My Bus" sub={isParent ? (ward ? `${firstName(ward.name)}’s route, stop and bus` : 'Track your ward’s school bus') : 'Your route, stop and bus'}>
        {isParent && <WardPicker students={students} value={wardId} onChange={setWardId} />}
      </PageHead>

      {isParent && students.length === 0 && <Empty text="No student is linked to your account yet." />}
      {enabled && loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {enabled && error && <Empty text={error} />}
      {enabled && !loading && !error && (!myStop || myStop.assignments.length === 0) && (
        <Empty text="No bus stop has been assigned yet — contact the school office." />
      )}
      {myStop && myStop.assignments.length > 0 && (
        <div className="space-y-6">
          {myStop.assignments.map(a => <MyBusCard key={a.id} data={a} />)}
        </div>
      )}
    </div>
  )
}
