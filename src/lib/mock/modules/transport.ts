// Mirrors server/src/modules/transport/{router,schema,service}.ts (see git show feature/backend-api:
// server/src/modules/transport/*.ts). Routes → stops, vehicles, student↔stop assignments, and a
// vehicle-location read (the ping-write endpoint is deliberately not wrapped by any frontend hook — see
// useTransport.ts — so it's omitted here too). Frontend contract confirmed against
// src/lib/hooks/useTransport.ts's comments.

import { route, requireAuth, requireRole, status } from '../router'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { notFound, badRequest, forbidden } from '../http'

function isStaff(role: string) {
  return role === 'staff' || role === 'admin' || role === 'superadmin'
}
function visibleStudentIds(actor: { userId: string; role: string }): string[] {
  if (actor.role === 'student') return [actor.userId]
  if (actor.role === 'parent') return table('Guardian').filter(g => g.parentId === actor.userId).map(g => String(g.studentId))
  return []
}

function serializeRoute(r: Row) {
  return { id: r.id, name: r.name, description: r.description ?? undefined, createdAt: r.createdAt, stopCount: table('Stop').filter(s => s.routeId === r.id).length }
}
function serializeStop(s: Row) {
  const route_ = table('Route').find(r => r.id === s.routeId)
  return { id: s.id, routeId: s.routeId, name: s.name, sequence: s.sequence, latitude: s.latitude ?? undefined, longitude: s.longitude ?? undefined, arrivalOffsetMin: s.arrivalOffsetMin ?? undefined, routeName: route_?.name }
}
function serializeVehicle(v: Row) {
  const route_ = v.routeId ? table('Route').find(r => r.id === v.routeId) : undefined
  return { id: v.id, registrationNo: v.registrationNo, capacity: v.capacity, routeId: v.routeId ?? undefined, driverName: v.driverName, driverPhone: v.driverPhone, conductorName: v.conductorName ?? undefined, conductorPhone: v.conductorPhone ?? undefined, driverUserId: v.driverUserId ?? undefined, createdAt: v.createdAt, routeName: route_?.name }
}
function serializeAssignment(a: Row) {
  const student = table('User').find(u => u.id === a.studentId)
  const stop = table('Stop').find(s => s.id === a.stopId)
  const route_ = stop ? table('Route').find(r => r.id === stop.routeId) : undefined
  return { id: a.id, studentId: a.studentId, stopId: a.stopId, boardingType: a.boardingType, createdAt: a.createdAt, studentName: student?.name, stopName: stop?.name, routeId: stop?.routeId, routeName: route_?.name }
}
function serializeLocation(l: Row) {
  return { id: l.id, vehicleId: l.vehicleId, latitude: l.latitude, longitude: l.longitude, recordedAt: l.recordedAt, tripDate: l.tripDate }
}

// ───────────────────────────── routes ─────────────────────────────

route('GET', '/transport/routes', (ctx) => {
  const actor = requireAuth(ctx)
  return { items: table('Route').filter(r => r.schoolId === actor.schoolId).map(serializeRoute) }
})
route('GET', '/transport/routes/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const r = table('Route').find(x => x.id === ctx.params.id && x.schoolId === actor.schoolId)
  if (!r) throw notFound('Route')
  const stops = table('Stop').filter(s => s.routeId === r.id).sort((a, b) => (a.sequence as number) - (b.sequence as number))
  return { item: { ...serializeRoute(r), stops: stops.map(serializeStop) } }
})
route('POST', '/transport/routes', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { name: string; description?: string }
  const row: Row = { id: uid('route'), schoolId: actor.schoolId, name: b.name, description: b.description ?? null, createdAt: nowIso() }
  const rows = table('Route'); rows.push(row); saveTable('Route', rows)
  return status(201, { item: serializeRoute(row) })
})
route('PATCH', '/transport/routes/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('Route')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Route')
  rows[idx] = { ...rows[idx], ...ctx.body }
  saveTable('Route', rows)
  return { item: serializeRoute(rows[idx]) }
})
route('DELETE', '/transport/routes/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('Route')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Route')
  const stopIds = new Set(table('Stop').filter(s => s.routeId === ctx.params.id).map(s => s.id))
  saveTable('StudentStopAssignment', table('StudentStopAssignment').filter(a => !stopIds.has(a.stopId as string)))
  saveTable('Stop', table('Stop').filter(s => s.routeId !== ctx.params.id))
  const vehicles = table('Vehicle')
  saveTable('Vehicle', vehicles.map(v => (v.routeId === ctx.params.id ? { ...v, routeId: null } : v)))
  rows.splice(idx, 1); saveTable('Route', rows)
  return { ok: true }
})

// ───────────────────────────── stops ─────────────────────────────

route('GET', '/transport/stops', (ctx) => {
  const actor = requireAuth(ctx)
  let rows = table('Stop').filter(s => s.schoolId === actor.schoolId)
  if (ctx.query.routeId) rows = rows.filter(s => s.routeId === ctx.query.routeId)
  rows = [...rows].sort((a, b) => String(a.routeId).localeCompare(String(b.routeId)) || (a.sequence as number) - (b.sequence as number))
  return { items: rows.map(serializeStop) }
})
route('POST', '/transport/stops', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { routeId: string; name: string; sequence: number; latitude?: number; longitude?: number; arrivalOffsetMin?: number }
  if (!table('Route').some(r => r.id === b.routeId && r.schoolId === actor.schoolId)) throw notFound('Route')
  const row: Row = { id: uid('stop'), schoolId: actor.schoolId, routeId: b.routeId, name: b.name, sequence: b.sequence, latitude: b.latitude ?? null, longitude: b.longitude ?? null, arrivalOffsetMin: b.arrivalOffsetMin ?? null, createdAt: nowIso() }
  const rows = table('Stop'); rows.push(row); saveTable('Stop', rows)
  return status(201, { item: serializeStop(row) })
})
route('PATCH', '/transport/stops/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('Stop')
  const idx = rows.findIndex(s => s.id === ctx.params.id && s.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Stop')
  rows[idx] = { ...rows[idx], ...ctx.body }
  saveTable('Stop', rows)
  return { item: serializeStop(rows[idx]) }
})
route('DELETE', '/transport/stops/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('Stop')
  const idx = rows.findIndex(s => s.id === ctx.params.id && s.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Stop')
  saveTable('StudentStopAssignment', table('StudentStopAssignment').filter(a => a.stopId !== ctx.params.id))
  rows.splice(idx, 1); saveTable('Stop', rows)
  return { ok: true }
})

// ───────────────────────────── vehicles ─────────────────────────────

route('GET', '/transport/vehicles', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  return { items: table('Vehicle').filter(v => v.schoolId === actor.schoolId).map(serializeVehicle) }
})
route('GET', '/transport/vehicles/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const v = table('Vehicle').find(x => x.id === ctx.params.id && x.schoolId === actor.schoolId)
  if (!v) throw notFound('Vehicle')
  return { item: serializeVehicle(v) }
})
route('POST', '/transport/vehicles', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { registrationNo: string; capacity: number; routeId?: string; driverName: string; driverPhone: string; conductorName?: string; conductorPhone?: string; driverUserId?: string }
  const row: Row = { id: uid('vehicle'), schoolId: actor.schoolId, registrationNo: b.registrationNo, capacity: b.capacity, routeId: b.routeId ?? null, driverName: b.driverName, driverPhone: b.driverPhone, conductorName: b.conductorName ?? null, conductorPhone: b.conductorPhone ?? null, driverUserId: b.driverUserId ?? null, createdAt: nowIso() }
  const rows = table('Vehicle'); rows.push(row); saveTable('Vehicle', rows)
  return status(201, { item: serializeVehicle(row) })
})
route('PATCH', '/transport/vehicles/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('Vehicle')
  const idx = rows.findIndex(v => v.id === ctx.params.id && v.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Vehicle')
  rows[idx] = { ...rows[idx], ...ctx.body }
  saveTable('Vehicle', rows)
  return { item: serializeVehicle(rows[idx]) }
})
route('DELETE', '/transport/vehicles/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('Vehicle')
  const idx = rows.findIndex(v => v.id === ctx.params.id && v.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Vehicle')
  saveTable('VehicleLocation', table('VehicleLocation').filter(l => l.vehicleId !== ctx.params.id))
  rows.splice(idx, 1); saveTable('Vehicle', rows)
  return { ok: true }
})

// GET /transport/vehicles/:id/location — latest ping, or `{ item: null }` (never 404) if none recorded.
route('GET', '/transport/vehicles/:id/location', (ctx) => {
  const actor = requireAuth(ctx)
  const vehicle = table('Vehicle').find(v => v.id === ctx.params.id && v.schoolId === actor.schoolId)
  if (!vehicle) throw notFound('Vehicle')
  if (!isStaff(actor.role)) {
    if (actor.role !== 'student' && actor.role !== 'parent') throw forbidden()
    if (!vehicle.routeId) throw forbidden('This vehicle is not assigned to a route')
    const ids = visibleStudentIds(actor)
    const assigned = table('StudentStopAssignment').some(a => ids.includes(String(a.studentId)) && table('Stop').find(s => s.id === a.stopId)?.routeId === vehicle.routeId)
    if (!assigned) throw forbidden('You are not assigned to a stop on this vehicle’s route')
  }
  const locs = table('VehicleLocation').filter(l => l.vehicleId === ctx.params.id).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))
  return { item: locs[0] ? serializeLocation(locs[0]) : null }
})

// ───────────────────────────── assignments ─────────────────────────────

route('GET', '/transport/assignments', (ctx) => {
  const actor = requireAuth(ctx)
  const { studentId, stopId, routeId } = ctx.query
  let rows = table('StudentStopAssignment').filter(a => a.schoolId === actor.schoolId)
  if (isStaff(actor.role)) {
    if (studentId) rows = rows.filter(a => a.studentId === studentId)
    if (stopId) rows = rows.filter(a => a.stopId === stopId)
    if (routeId) { const stopIds = new Set(table('Stop').filter(s => s.routeId === routeId).map(s => s.id)); rows = rows.filter(a => stopIds.has(a.stopId as string)) }
  } else if (actor.role === 'student' || actor.role === 'parent') {
    const ids = visibleStudentIds(actor)
    if (studentId && !ids.includes(studentId)) throw forbidden(actor.role === 'parent' ? 'That student is not your ward' : 'You can only view your own assignment')
    const scope = studentId ? [studentId] : ids
    rows = rows.filter(a => scope.includes(String(a.studentId)))
  } else {
    throw forbidden()
  }
  return { items: rows.map(serializeAssignment) }
})

route('POST', '/transport/assignments', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { studentId: string; stopId: string; boardingType?: string }
  const boardingType = b.boardingType ?? 'Both'
  if (!table('User').some(u => u.id === b.studentId && u.schoolId === actor.schoolId && u.role === 'student')) throw notFound('Student')
  if (!table('Stop').some(s => s.id === b.stopId && s.schoolId === actor.schoolId)) throw notFound('Stop')
  const rows = table('StudentStopAssignment')
  const idx = rows.findIndex(a => a.studentId === b.studentId && a.boardingType === boardingType)
  if (idx !== -1) {
    rows[idx] = { ...rows[idx], stopId: b.stopId }
    saveTable('StudentStopAssignment', rows)
    return { item: serializeAssignment(rows[idx]) }
  }
  const row: Row = { id: uid('assign'), schoolId: actor.schoolId, studentId: b.studentId, stopId: b.stopId, boardingType, createdAt: nowIso() }
  rows.push(row); saveTable('StudentStopAssignment', rows)
  return status(201, { item: serializeAssignment(row) })
})

route('DELETE', '/transport/assignments/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('StudentStopAssignment')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Assignment')
  rows.splice(idx, 1); saveTable('StudentStopAssignment', rows)
  return { ok: true }
})

// ───────────────────────────── my-stop ─────────────────────────────

route('GET', '/transport/my-stop', (ctx) => {
  const actor = requireAuth(ctx)
  const { studentId: qStudentId } = ctx.query
  let studentId: string
  if (actor.role === 'student') studentId = actor.userId
  else if (actor.role === 'parent') {
    const wards = table('Guardian').filter(g => g.parentId === actor.userId)
    if (!wards.length) throw badRequest('No wards linked to this account')
    studentId = qStudentId ?? String(wards[0].studentId)
    if (!wards.some(w => w.studentId === studentId)) throw forbidden('That student is not your ward')
  } else {
    if (!qStudentId) throw badRequest('studentId is required for this role')
    studentId = qStudentId
  }
  const assignments = table('StudentStopAssignment').filter(a => a.schoolId === actor.schoolId && a.studentId === studentId)
  const items = assignments.map(a => {
    const stop = table('Stop').find(s => s.id === a.stopId)
    const route_ = stop ? table('Route').find(r => r.id === stop.routeId) : undefined
    const vehicle = route_ ? table('Vehicle').find(v => v.routeId === route_.id) : undefined
    const locs = vehicle ? table('VehicleLocation').filter(l => l.vehicleId === vehicle.id).sort((x, y) => String(y.recordedAt).localeCompare(String(x.recordedAt))) : []
    return { id: a.id, boardingType: a.boardingType, stop: stop ? serializeStop(stop) : undefined, route: route_ ? serializeRoute(route_) : undefined, vehicle: vehicle ? serializeVehicle(vehicle) : null, location: locs[0] ? serializeLocation(locs[0]) : null }
  })
  return { studentId, assignments: items }
})
