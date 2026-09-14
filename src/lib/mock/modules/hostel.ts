// Mirrors server/src/modules/hostel/{router,schema,service}.ts (see git show feature/backend-api:
// server/src/modules/hostel/*.ts). Hostels → rooms → beds (one row per physical bed) → allocations, plus
// Phase 24's outpass/roll-call/mess-menu/meal-feedback extensions. Frontend contract confirmed against
// src/lib/hooks/useHostel.ts's comments.
//
// Simplifications vs the real server (acceptable for a static demo with no real security boundary —
// see store.ts's docstring): the "warden of this specific hostel" gate on outpass/roll-call/mess-menu
// writes is collapsed to "staff/admin/superadmin, or any teacher" rather than checking which hostel a
// teacher wardens; guardian email/SMS notifications are a no-op (there's no delivery channel in a
// browser-only mock).

import { route, requireAuth, requireRole, status } from '../router'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { notFound, badRequest, conflict, forbidden } from '../http'

function isStaff(role: string) {
  return role === 'staff' || role === 'admin' || role === 'superadmin'
}
function isWardenOrStaff(role: string) {
  return isStaff(role) || role === 'teacher'
}
function visibleStudentIds(actor: { userId: string; role: string }): string[] {
  if (actor.role === 'student') return [actor.userId]
  if (actor.role === 'parent') return table('Guardian').filter(g => g.parentId === actor.userId).map(g => String(g.studentId))
  return []
}

// ───────────────────────────── serializers ─────────────────────────────

function serializeHostel(h: Row) {
  const rooms = table('HostelRoom').filter(r => r.hostelId === h.id).map(r => r.id)
  const beds = table('HostelBed').filter(b => rooms.includes(b.roomId as string))
  const bedIds = new Set(beds.map(b => b.id))
  const occupied = table('HostelAllocation').filter(a => a.status === 'Active' && bedIds.has(a.bedId as string)).length
  return { id: h.id, name: h.name, type: h.type, wardenUserId: h.wardenUserId ?? undefined, address: h.address ?? undefined, createdAt: h.createdAt, totalBeds: beds.length, occupiedBeds: occupied }
}

function serializeRoom(r: Row) {
  const beds = table('HostelBed').filter(b => b.roomId === r.id)
  const bedIds = new Set(beds.map(b => b.id))
  const occupied = table('HostelAllocation').filter(a => a.status === 'Active' && bedIds.has(a.bedId as string)).length
  return { id: r.id, hostelId: r.hostelId, roomNumber: r.roomNumber, floor: r.floor ?? undefined, capacity: r.capacity, roomType: r.roomType ?? undefined, createdAt: r.createdAt, bedCount: beds.length, occupiedCount: occupied }
}

function occupantFor(bedId: string) {
  const alloc = table('HostelAllocation').find(a => a.bedId === bedId && a.status === 'Active')
  if (!alloc) return null
  const student = table('User').find(u => u.id === alloc.studentId)
  return { allocationId: alloc.id, studentId: alloc.studentId, studentName: student?.name ?? '—', checkInDate: alloc.checkInDate }
}

function serializeBed(b: Row) {
  return { id: b.id, roomId: b.roomId, bedLabel: b.bedLabel, createdAt: b.createdAt, occupant: occupantFor(b.id) }
}

function serializeAllocation(a: Row) {
  return { id: a.id, studentId: a.studentId, bedId: a.bedId, checkInDate: a.checkInDate, checkOutDate: a.checkOutDate ?? undefined, status: a.status, allocatedById: a.allocatedById ?? undefined, notes: a.notes ?? undefined, createdAt: a.createdAt }
}

function computeOutpassStatus(o: Row): string {
  if (o.status === 'Departed' && !o.actualReturnAt && new Date(o.expectedReturnAt as string).getTime() < Date.now()) return 'Overdue'
  return String(o.status)
}
function serializeOutpass(o: Row) {
  return {
    id: o.id, studentId: o.studentId, hostelId: o.hostelId, requestedById: o.requestedById,
    requestedDepartureAt: o.requestedDepartureAt, expectedReturnAt: o.expectedReturnAt, reason: o.reason,
    destination: o.destination ?? undefined, status: computeOutpassStatus(o),
    approvedByWardenId: o.approvedByWardenId ?? undefined, approvedAt: o.approvedAt ?? undefined,
    actualDepartureAt: o.actualDepartureAt ?? undefined, actualReturnAt: o.actualReturnAt ?? undefined, createdAt: o.createdAt,
  }
}

function serializeRollCallEntry(e: Row) {
  const alloc = table('HostelAllocation').find(a => a.id === e.allocationId)
  const student = alloc ? table('User').find(u => u.id === alloc.studentId) : undefined
  return { id: e.id, allocationId: e.allocationId, studentId: alloc?.studentId, studentName: student?.name, present: e.present, notes: e.notes ?? undefined }
}
function serializeRollCall(r: Row, onlyStudentIds?: string[]) {
  let entries = table('HostelRollCallEntry').filter(e => e.rollCallId === r.id)
  if (onlyStudentIds) {
    entries = entries.filter(e => {
      const alloc = table('HostelAllocation').find(a => a.id === e.allocationId)
      return alloc && onlyStudentIds.includes(String(alloc.studentId))
    })
  }
  return { id: r.id, hostelId: r.hostelId, date: r.date, recordedById: r.recordedById ?? undefined, createdAt: r.createdAt, entries: entries.map(serializeRollCallEntry) }
}

const ALLERGY_DISCLAIMER = 'Allergy flags are matched by simple keyword search against recorded allergy records and may not catch every allergen — verify independently.'
function serializeMenu(m: Row, allergyFlags?: string[]) {
  return { id: m.id, hostelId: m.hostelId, date: m.date, mealType: m.mealType, items: m.items, createdAt: m.createdAt, allergyDisclaimer: ALLERGY_DISCLAIMER, ...(allergyFlags && allergyFlags.length ? { allergyFlags } : {}) }
}
function serializeFeedback(f: Row) {
  return { id: f.id, menuId: f.menuId, studentId: f.studentId, rating: f.rating, comment: f.comment ?? undefined, createdAt: f.createdAt }
}

// ───────────────────────────── hostels ─────────────────────────────

route('GET', '/hostel/hostels', (ctx) => {
  const actor = requireAuth(ctx)
  return { items: table('Hostel').filter(h => h.schoolId === actor.schoolId).map(serializeHostel) }
})

route('GET', '/hostel/hostels/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const h = table('Hostel').find(x => x.id === ctx.params.id && x.schoolId === actor.schoolId)
  if (!h) throw notFound('Hostel')
  const rooms = table('HostelRoom').filter(r => r.hostelId === h.id)
  return { item: { ...serializeHostel(h), rooms: rooms.map(r => ({ ...serializeRoom(r), beds: table('HostelBed').filter(b => b.roomId === r.id).map(serializeBed) })) } }
})

route('POST', '/hostel/hostels', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { name: string; type: string; wardenUserId?: string; address?: string }
  const row: Row = { id: uid('hostel'), schoolId: actor.schoolId, name: b.name, type: b.type, wardenUserId: b.wardenUserId ?? null, address: b.address ?? null, createdAt: nowIso() }
  const rows = table('Hostel'); rows.push(row); saveTable('Hostel', rows)
  return status(201, { item: serializeHostel(row) })
})

route('PATCH', '/hostel/hostels/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('Hostel')
  const idx = rows.findIndex(h => h.id === ctx.params.id && h.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Hostel')
  rows[idx] = { ...rows[idx], ...ctx.body }
  saveTable('Hostel', rows)
  return { item: serializeHostel(rows[idx]) }
})

route('DELETE', '/hostel/hostels/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('Hostel')
  const idx = rows.findIndex(h => h.id === ctx.params.id && h.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Hostel')
  const roomIds = new Set(table('HostelRoom').filter(r => r.hostelId === ctx.params.id).map(r => r.id))
  const bedIds = new Set(table('HostelBed').filter(b => roomIds.has(b.roomId as string)).map(b => b.id))
  saveTable('HostelAllocation', table('HostelAllocation').filter(a => !bedIds.has(a.bedId as string)))
  saveTable('HostelBed', table('HostelBed').filter(b => !roomIds.has(b.roomId as string)))
  saveTable('HostelRoom', table('HostelRoom').filter(r => r.hostelId !== ctx.params.id))
  rows.splice(idx, 1); saveTable('Hostel', rows)
  return { ok: true }
})

// ───────────────────────────── rooms ─────────────────────────────

route('GET', '/hostel/rooms', (ctx) => {
  const actor = requireAuth(ctx)
  const { hostelId } = ctx.query
  let rows = table('HostelRoom').filter(r => r.schoolId === actor.schoolId)
  if (hostelId) rows = rows.filter(r => r.hostelId === hostelId)
  return { items: rows.map(serializeRoom) }
})

route('POST', '/hostel/rooms', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { hostelId: string; roomNumber: string; floor?: string; capacity: number; roomType?: string; bedLabels?: string[] }
  if (!table('Hostel').some(h => h.id === b.hostelId && h.schoolId === actor.schoolId)) throw notFound('Hostel')
  const labels = b.bedLabels ?? Array.from({ length: b.capacity }, (_, i) => String(i + 1))
  const room: Row = { id: uid('hroom'), schoolId: actor.schoolId, hostelId: b.hostelId, roomNumber: b.roomNumber, floor: b.floor ?? null, capacity: b.capacity, roomType: b.roomType ?? null, createdAt: nowIso() }
  const rooms = table('HostelRoom'); rooms.push(room); saveTable('HostelRoom', rooms)
  const beds = table('HostelBed')
  for (const label of labels) beds.push({ id: uid('hbed'), schoolId: actor.schoolId, roomId: room.id, bedLabel: label, createdAt: nowIso() })
  saveTable('HostelBed', beds)
  return status(201, { item: serializeRoom(room) })
})

route('PATCH', '/hostel/rooms/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('HostelRoom')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Room')
  const before = rows[idx]
  const { capacity, ...rest } = ctx.body as { capacity?: number; roomNumber?: string; floor?: string; roomType?: string }
  if (capacity !== undefined && capacity !== before.capacity) {
    const beds = table('HostelBed').filter(bd => bd.roomId === before.id)
    if (capacity > beds.length) {
      const existing = new Set(beds.map(bd => bd.bedLabel))
      const allBeds = table('HostelBed')
      let n = 1
      for (let added = 0; added < capacity - beds.length;) {
        const label = String(n++)
        if (!existing.has(label)) { allBeds.push({ id: uid('hbed'), schoolId: actor.schoolId, roomId: before.id, bedLabel: label, createdAt: nowIso() }); existing.add(label); added++ }
      }
      saveTable('HostelBed', allBeds)
    } else {
      const occupiedIds = new Set(table('HostelAllocation').filter(a => a.status === 'Active').map(a => a.bedId))
      const removable = beds.filter(bd => !occupiedIds.has(bd.id)).reverse()
      const removeCount = beds.length - capacity
      if (removable.length < removeCount) throw conflict(`Cannot shrink capacity to ${capacity}: only ${removable.length} unoccupied bed(s) available to remove out of ${removeCount} needed`)
      const removeIds = new Set(removable.slice(0, removeCount).map(bd => bd.id))
      saveTable('HostelBed', table('HostelBed').filter(bd => !removeIds.has(bd.id)))
    }
  }
  rows[idx] = { ...before, ...rest, ...(capacity !== undefined ? { capacity } : {}) }
  saveTable('HostelRoom', rows)
  return { item: serializeRoom(rows[idx]) }
})

route('DELETE', '/hostel/rooms/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('HostelRoom')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Room')
  const bedIds = new Set(table('HostelBed').filter(b => b.roomId === ctx.params.id).map(b => b.id))
  saveTable('HostelAllocation', table('HostelAllocation').filter(a => !bedIds.has(a.bedId as string)))
  saveTable('HostelBed', table('HostelBed').filter(b => b.roomId !== ctx.params.id))
  rows.splice(idx, 1); saveTable('HostelRoom', rows)
  return { ok: true }
})

// ───────────────────────────── beds ─────────────────────────────

route('GET', '/hostel/beds', (ctx) => {
  const actor = requireAuth(ctx)
  const { roomId, hostelId, status: st } = ctx.query
  let rows = table('HostelBed').filter(b => b.schoolId === actor.schoolId)
  if (roomId) rows = rows.filter(b => b.roomId === roomId)
  if (hostelId) {
    const roomIds = new Set(table('HostelRoom').filter(r => r.hostelId === hostelId).map(r => r.id))
    rows = rows.filter(b => roomIds.has(b.roomId as string))
  }
  let items = rows.map(serializeBed)
  if (st === 'occupied') items = items.filter(i => i.occupant)
  else if (st === 'vacant') items = items.filter(i => !i.occupant)
  return { items }
})

route('POST', '/hostel/beds', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { roomId: string; bedLabel: string }
  const rooms = table('HostelRoom')
  const rIdx = rooms.findIndex(r => r.id === b.roomId && r.schoolId === actor.schoolId)
  if (rIdx === -1) throw notFound('Room')
  const bed: Row = { id: uid('hbed'), schoolId: actor.schoolId, roomId: b.roomId, bedLabel: b.bedLabel, createdAt: nowIso() }
  const beds = table('HostelBed'); beds.push(bed); saveTable('HostelBed', beds)
  rooms[rIdx] = { ...rooms[rIdx], capacity: (rooms[rIdx].capacity as number) + 1 }
  saveTable('HostelRoom', rooms)
  return status(201, { item: serializeBed(bed) })
})

route('PATCH', '/hostel/beds/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('HostelBed')
  const idx = rows.findIndex(b => b.id === ctx.params.id && b.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Bed')
  rows[idx] = { ...rows[idx], ...ctx.body }
  saveTable('HostelBed', rows)
  return { item: serializeBed(rows[idx]) }
})

route('DELETE', '/hostel/beds/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('HostelBed')
  const idx = rows.findIndex(b => b.id === ctx.params.id && b.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Bed')
  if (table('HostelAllocation').some(a => a.bedId === ctx.params.id && a.status === 'Active')) throw conflict('This bed has an active occupant — vacate or transfer them before removing the bed')
  const before = rows[idx]
  rows.splice(idx, 1); saveTable('HostelBed', rows)
  const rooms = table('HostelRoom')
  const rIdx = rooms.findIndex(r => r.id === before.roomId)
  if (rIdx !== -1) { rooms[rIdx] = { ...rooms[rIdx], capacity: Math.max(0, (rooms[rIdx].capacity as number) - 1) }; saveTable('HostelRoom', rooms) }
  return { ok: true }
})

// ───────────────────────────── allocations ─────────────────────────────

route('GET', '/hostel/allocations', (ctx) => {
  const actor = requireAuth(ctx)
  const { studentId, hostelId, roomId, bedId, status: st } = ctx.query
  let rows = table('HostelAllocation').filter(a => a.schoolId === actor.schoolId)
  if (isStaff(actor.role)) {
    if (studentId) rows = rows.filter(a => a.studentId === studentId)
  } else if (actor.role === 'student' || actor.role === 'parent') {
    const ids = visibleStudentIds(actor)
    if (studentId && !ids.includes(studentId)) throw forbidden(actor.role === 'parent' ? 'That student is not your ward' : 'You can only view your own allocation')
    const scope = studentId ? [studentId] : ids
    rows = rows.filter(a => scope.includes(String(a.studentId)))
  } else {
    throw forbidden()
  }
  if (st) rows = rows.filter(a => a.status === st)
  if (bedId) rows = rows.filter(a => a.bedId === bedId)
  if (roomId) { const beds = new Set(table('HostelBed').filter(b => b.roomId === roomId).map(b => b.id)); rows = rows.filter(a => beds.has(a.bedId as string)) }
  if (hostelId) {
    const roomIds = new Set(table('HostelRoom').filter(r => r.hostelId === hostelId).map(r => r.id))
    const bedIds = new Set(table('HostelBed').filter(b => roomIds.has(b.roomId as string)).map(b => b.id))
    rows = rows.filter(a => bedIds.has(a.bedId as string))
  }
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializeAllocation) }
})

route('GET', '/hostel/allocations/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const row = table('HostelAllocation').find(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (!row) throw notFound('Allocation')
  if (!isStaff(actor.role)) {
    const ids = visibleStudentIds(actor)
    if (!ids.includes(String(row.studentId))) throw forbidden()
  }
  return { item: serializeAllocation(row) }
})

route('POST', '/hostel/allocations', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { studentId: string; bedId: string; checkInDate?: string; notes?: string }
  if (!table('User').some(u => u.id === b.studentId && u.schoolId === actor.schoolId && u.role === 'student')) throw notFound('Student')
  if (!table('HostelBed').some(bd => bd.id === b.bedId && bd.schoolId === actor.schoolId)) throw notFound('Bed')
  if (table('HostelAllocation').some(a => a.bedId === b.bedId && a.status === 'Active')) throw conflict('This bed is already occupied — vacate or transfer the current occupant first')
  if (table('HostelAllocation').some(a => a.studentId === b.studentId && a.status === 'Active')) throw conflict('This student already has an active hostel allocation — vacate or transfer it first')
  const row: Row = { id: uid('halloc'), schoolId: actor.schoolId, studentId: b.studentId, bedId: b.bedId, checkInDate: b.checkInDate ?? nowIso().slice(0, 10), status: 'Active', allocatedById: actor.userId, notes: b.notes ?? null, createdAt: nowIso() }
  const rows = table('HostelAllocation'); rows.push(row); saveTable('HostelAllocation', rows)
  return status(201, { item: serializeAllocation(row) })
})

route('POST', '/hostel/allocations/:id/vacate', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('HostelAllocation')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Allocation')
  const before = rows[idx]
  if (before.status !== 'Active') throw badRequest(`Allocation is not Active (status: ${before.status})`)
  const b = ctx.body as { checkOutDate?: string; notes?: string }
  rows[idx] = { ...before, status: 'Vacated', checkOutDate: b.checkOutDate ?? nowIso().slice(0, 10), ...(b.notes !== undefined ? { notes: b.notes } : {}) }
  saveTable('HostelAllocation', rows)
  return { item: serializeAllocation(rows[idx]) }
})

route('POST', '/hostel/allocations/:id/transfer', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('HostelAllocation')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Allocation')
  const before = rows[idx]
  if (before.status !== 'Active') throw badRequest(`Allocation is not Active (status: ${before.status})`)
  const b = ctx.body as { bedId: string; checkInDate?: string; notes?: string }
  if (b.bedId === before.bedId) throw badRequest('New bed must be different from the current bed')
  if (!table('HostelBed').some(bd => bd.id === b.bedId && bd.schoolId === actor.schoolId)) throw notFound('Bed')
  if (rows.some(a => a.bedId === b.bedId && a.status === 'Active')) throw conflict('This bed is already occupied — vacate or transfer the current occupant first')
  const now = nowIso().slice(0, 10)
  rows[idx] = { ...before, status: 'Transferred', checkOutDate: now }
  const newRow: Row = { id: uid('halloc'), schoolId: actor.schoolId, studentId: before.studentId, bedId: b.bedId, checkInDate: b.checkInDate ?? now, status: 'Active', allocatedById: actor.userId, notes: b.notes ?? null, createdAt: nowIso() }
  rows.push(newRow)
  saveTable('HostelAllocation', rows)
  return status(201, { item: serializeAllocation(newRow) })
})

// ═══════════════════════════ Phase 24: outpasses / roll-call / mess menu ═══════════════════════════

route('GET', '/hostel/outpasses', (ctx) => {
  const actor = requireAuth(ctx)
  const { studentId, hostelId, status: st } = ctx.query
  let rows = table('HostelOutpass').filter(o => o.schoolId === actor.schoolId)
  if (isStaff(actor.role) || actor.role === 'teacher') {
    if (studentId) rows = rows.filter(o => o.studentId === studentId)
    if (hostelId) rows = rows.filter(o => o.hostelId === hostelId)
  } else if (actor.role === 'student' || actor.role === 'parent') {
    const ids = visibleStudentIds(actor)
    if (studentId && !ids.includes(studentId)) throw forbidden(actor.role === 'parent' ? 'That student is not your ward' : 'You can only view your own outpasses')
    const scope = studentId ? [studentId] : ids
    rows = rows.filter(o => scope.includes(String(o.studentId)))
    if (hostelId) rows = rows.filter(o => o.hostelId === hostelId)
  } else {
    throw forbidden()
  }
  if (st) rows = rows.filter(o => computeOutpassStatus(o) === st)
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializeOutpass) }
})

route('POST', '/hostel/outpasses', (ctx) => {
  const actor = requireAuth(ctx)
  const b = ctx.body as { studentId: string; requestedDepartureAt: string; expectedReturnAt: string; reason: string; destination?: string }
  if (actor.role === 'student') { if (b.studentId !== actor.userId) throw forbidden('You can only request an outpass for yourself') }
  else if (actor.role === 'parent') { if (!visibleStudentIds(actor).includes(b.studentId)) throw forbidden('That student is not your ward') }
  else throw forbidden('Only a student or parent may request an outpass')
  if (new Date(b.expectedReturnAt).getTime() <= new Date(b.requestedDepartureAt).getTime()) throw badRequest('expectedReturnAt must be after requestedDepartureAt')
  const allocation = table('HostelAllocation').find(a => a.schoolId === actor.schoolId && a.studentId === b.studentId && a.status === 'Active')
  if (!allocation) throw badRequest('Student has no active hostel allocation')
  const bed = table('HostelBed').find(bd => bd.id === allocation.bedId)
  const room = bed ? table('HostelRoom').find(r => r.id === bed.roomId) : undefined
  if (!room) throw notFound('Hostel')
  const row: Row = { id: uid('outpass'), schoolId: actor.schoolId, studentId: b.studentId, hostelId: room.hostelId, requestedById: actor.userId, requestedDepartureAt: b.requestedDepartureAt, expectedReturnAt: b.expectedReturnAt, reason: b.reason, destination: b.destination ?? null, status: 'Pending', createdAt: nowIso() }
  const rows = table('HostelOutpass'); rows.push(row); saveTable('HostelOutpass', rows)
  return status(201, { item: serializeOutpass(row) })
})

function transitionOutpass(id: string, actor: { userId: string; role: string }, from: string, to: string, extra: Record<string, unknown> = {}) {
  if (!isWardenOrStaff(actor.role)) throw forbidden("Only this hostel's warden or staff/admin may do this")
  const rows = table('HostelOutpass')
  const idx = rows.findIndex(o => o.id === id)
  if (idx === -1) throw notFound('Outpass')
  const before = rows[idx]
  if (before.status !== from) throw conflict(`Outpass must be ${from} for this action (is ${before.status})`)
  rows[idx] = { ...before, status: to, ...extra }
  saveTable('HostelOutpass', rows)
  return rows[idx]
}

route('POST', '/hostel/outpasses/:id/approve', (ctx) => {
  const actor = requireAuth(ctx)
  const row = transitionOutpass(ctx.params.id, actor, 'Pending', 'Approved', { approvedByWardenId: actor.userId, approvedAt: nowIso() })
  return { item: serializeOutpass(row) }
})
route('POST', '/hostel/outpasses/:id/decline', (ctx) => {
  const actor = requireAuth(ctx)
  const row = transitionOutpass(ctx.params.id, actor, 'Pending', 'Declined', { approvedByWardenId: actor.userId, approvedAt: nowIso() })
  return { item: serializeOutpass(row) }
})
route('POST', '/hostel/outpasses/:id/depart', (ctx) => {
  const actor = requireAuth(ctx)
  const row = transitionOutpass(ctx.params.id, actor, 'Approved', 'Departed', { actualDepartureAt: nowIso() })
  return { item: serializeOutpass(row) }
})
route('POST', '/hostel/outpasses/:id/return', (ctx) => {
  const actor = requireAuth(ctx)
  const row = transitionOutpass(ctx.params.id, actor, 'Departed', 'Returned', { actualReturnAt: nowIso() })
  return { item: serializeOutpass(row) }
})

// ───────────────────────────── roll-call ─────────────────────────────

route('GET', '/hostel/roll-calls', (ctx) => {
  const actor = requireAuth(ctx)
  const { hostelId, from, to } = ctx.query
  let rows = table('HostelRollCall').filter(r => r.schoolId === actor.schoolId)
  if (hostelId) rows = rows.filter(r => r.hostelId === hostelId)
  if (from) rows = rows.filter(r => String(r.date) >= from)
  if (to) rows = rows.filter(r => String(r.date) <= to)
  rows = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  if (isStaff(actor.role) || actor.role === 'teacher') return { items: rows.map(r => serializeRollCall(r)) }
  if (actor.role === 'student' || actor.role === 'parent') {
    const ids = visibleStudentIds(actor)
    const visible = rows.filter(r => table('HostelRollCallEntry').filter(e => e.rollCallId === r.id).some(e => { const a = table('HostelAllocation').find(x => x.id === e.allocationId); return a && ids.includes(String(a.studentId)) }))
    return { items: visible.map(r => serializeRollCall(r, ids)) }
  }
  throw forbidden()
})

route('POST', '/hostel/roll-calls', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isWardenOrStaff(actor.role)) throw forbidden("Only this hostel's warden or staff/admin may do this")
  const b = ctx.body as { hostelId: string; date: string }
  if (!table('Hostel').some(h => h.id === b.hostelId && h.schoolId === actor.schoolId)) throw notFound('Hostel')
  const existing = table('HostelRollCall').find(r => r.hostelId === b.hostelId && r.date === b.date)
  if (existing) return { item: serializeRollCall(existing) }
  const session: Row = { id: uid('rollcall'), schoolId: actor.schoolId, hostelId: b.hostelId, date: b.date, recordedById: actor.userId, createdAt: nowIso() }
  const rows = table('HostelRollCall'); rows.push(session); saveTable('HostelRollCall', rows)
  const activeAllocations = table('HostelAllocation').filter(a => a.status === 'Active' && (() => { const bd = table('HostelBed').find(x => x.id === a.bedId); const rm = bd ? table('HostelRoom').find(x => x.id === bd.roomId) : undefined; return rm?.hostelId === b.hostelId })())
  const entries = table('HostelRollCallEntry')
  for (const a of activeAllocations) entries.push({ id: uid('rcentry'), rollCallId: session.id, allocationId: a.id, present: true, notes: null })
  saveTable('HostelRollCallEntry', entries)
  return status(201, { item: serializeRollCall(session) })
})

route('PATCH', '/hostel/roll-calls/:id/entries', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isWardenOrStaff(actor.role)) throw forbidden("Only this hostel's warden or staff/admin may do this")
  const rows = table('HostelRollCall')
  const session = rows.find(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (!session) throw notFound('Roll call')
  const b = ctx.body as { entries: Array<{ allocationId: string; present: boolean; notes?: string }> }
  const entries = table('HostelRollCallEntry')
  const validIds = new Set(entries.filter(e => e.rollCallId === session.id).map(e => e.allocationId))
  const bad = b.entries.filter(e => !validIds.has(e.allocationId))
  if (bad.length) throw badRequest("allocationId must be one of this roll call's pre-populated entries")
  for (const e of b.entries) {
    const idx = entries.findIndex(x => x.rollCallId === session.id && x.allocationId === e.allocationId)
    if (idx !== -1) entries[idx] = { ...entries[idx], present: e.present, notes: e.notes === undefined ? entries[idx].notes : e.notes }
  }
  saveTable('HostelRollCallEntry', entries)
  return { item: serializeRollCall(session) }
})

// ───────────────────────────── mess menu ─────────────────────────────

route('GET', '/hostel/mess-menu', (ctx) => {
  const actor = requireAuth(ctx)
  const { hostelId, from, to, date, mealType } = ctx.query
  let rows = table('MessMenu').filter(m => m.schoolId === actor.schoolId)
  if (hostelId) rows = rows.filter(m => m.hostelId === hostelId)
  if (mealType) rows = rows.filter(m => m.mealType === mealType)
  if (date) rows = rows.filter(m => m.date === date)
  if (from) rows = rows.filter(m => String(m.date) >= from)
  if (to) rows = rows.filter(m => String(m.date) <= to)
  rows = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.mealType).localeCompare(String(b.mealType)))
  return { items: rows.map(m => serializeMenu(m)) }
})

route('POST', '/hostel/mess-menu', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isWardenOrStaff(actor.role)) throw forbidden("Only this hostel's warden or staff/admin may do this")
  const b = ctx.body as { hostelId: string; date: string; mealType: string; items: string[] }
  if (!table('Hostel').some(h => h.id === b.hostelId && h.schoolId === actor.schoolId)) throw notFound('Hostel')
  const rows = table('MessMenu')
  const idx = rows.findIndex(m => m.hostelId === b.hostelId && m.date === b.date && m.mealType === b.mealType)
  if (idx !== -1) {
    rows[idx] = { ...rows[idx], items: b.items }
    saveTable('MessMenu', rows)
    return { item: serializeMenu(rows[idx]) }
  }
  const row: Row = { id: uid('menu'), schoolId: actor.schoolId, hostelId: b.hostelId, date: b.date, mealType: b.mealType, items: b.items, createdById: actor.userId, createdAt: nowIso() }
  rows.push(row); saveTable('MessMenu', rows)
  return status(201, { item: serializeMenu(row) })
})

route('PATCH', '/hostel/mess-menu/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('MessMenu')
  const idx = rows.findIndex(m => m.id === ctx.params.id && m.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Menu')
  if (!isWardenOrStaff(actor.role)) throw forbidden("Only this hostel's warden or staff/admin may do this")
  const b = ctx.body as { items?: string[] }
  rows[idx] = { ...rows[idx], ...(b.items !== undefined ? { items: b.items } : {}) }
  saveTable('MessMenu', rows)
  return { item: serializeMenu(rows[idx]) }
})

route('DELETE', '/hostel/mess-menu/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('MessMenu')
  const idx = rows.findIndex(m => m.id === ctx.params.id && m.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Menu')
  if (!isWardenOrStaff(actor.role)) throw forbidden("Only this hostel's warden or staff/admin may do this")
  rows.splice(idx, 1); saveTable('MessMenu', rows)
  return { ok: true }
})

// ───────────────────────────── meal feedback ─────────────────────────────

route('GET', '/hostel/meal-feedback', (ctx) => {
  const actor = requireAuth(ctx)
  const { menuId, studentId, hostelId } = ctx.query
  let rows = table('MealFeedback').filter(f => f.schoolId === actor.schoolId)
  if (isStaff(actor.role) || actor.role === 'teacher') {
    if (menuId) rows = rows.filter(f => f.menuId === menuId)
    if (studentId) rows = rows.filter(f => f.studentId === studentId)
    if (hostelId) { const menuIds = new Set(table('MessMenu').filter(m => m.hostelId === hostelId).map(m => m.id)); rows = rows.filter(f => menuIds.has(f.menuId as string)) }
    let summary: { count: number; avgRating: number | null } | undefined
    if (menuId) {
      const all = table('MealFeedback').filter(f => f.menuId === menuId)
      summary = { count: all.length, avgRating: all.length ? Math.round((all.reduce((s, f) => s + (f.rating as number), 0) / all.length) * 10) / 10 : null }
    }
    return { items: rows.map(serializeFeedback), summary }
  }
  if (actor.role === 'student' || actor.role === 'parent') {
    const ids = visibleStudentIds(actor)
    if (studentId && !ids.includes(studentId)) throw forbidden(actor.role === 'parent' ? 'That student is not your ward' : 'You can only view your own feedback')
    const scope = studentId ? [studentId] : ids
    rows = rows.filter(f => scope.includes(String(f.studentId)))
    if (menuId) rows = rows.filter(f => f.menuId === menuId)
    return { items: rows.map(serializeFeedback) }
  }
  throw forbidden()
})

route('POST', '/hostel/meal-feedback', (ctx) => {
  const actor = requireAuth(ctx)
  const b = ctx.body as { menuId: string; studentId: string; rating: number; comment?: string }
  if (actor.role === 'student') { if (b.studentId !== actor.userId) throw forbidden('You can only submit feedback for yourself') }
  else if (actor.role === 'parent') { if (!visibleStudentIds(actor).includes(b.studentId)) throw forbidden('That student is not your ward') }
  else throw forbidden('Only a student or parent may submit meal feedback')
  if (!table('MessMenu').some(m => m.id === b.menuId && m.schoolId === actor.schoolId)) throw notFound('Menu')
  const rows = table('MealFeedback')
  const idx = rows.findIndex(f => f.menuId === b.menuId && f.studentId === b.studentId)
  if (idx !== -1) {
    rows[idx] = { ...rows[idx], rating: b.rating, comment: b.comment === undefined ? rows[idx].comment : b.comment }
    saveTable('MealFeedback', rows)
    return { item: serializeFeedback(rows[idx]) }
  }
  const row: Row = { id: uid('feedback'), schoolId: actor.schoolId, menuId: b.menuId, studentId: b.studentId, rating: b.rating, comment: b.comment ?? null, createdAt: nowIso() }
  rows.push(row); saveTable('MealFeedback', rows)
  return status(201, { item: serializeFeedback(row) })
})
