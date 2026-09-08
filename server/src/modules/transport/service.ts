import type { z } from 'zod'
import type { Route, Stop, Vehicle, StudentStopAssignment, VehicleLocation } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isStaff, visibleStudentIds } from '../../lib/scope'
import { toDate, fmtDate } from '../../lib/validate'
import { EMPLOYEE_ROLES } from '../../userDefaults'
import type { createRoute, patchRoute, createStop, patchStop, stopQuery, createVehicle, patchVehicle, createAssignment, assignmentQuery, pingBody, myStopQuery } from './schema'

// See phase-12-transport.md. Driver/conductor live as plain contact fields on Vehicle (not User
// accounts) — see schema.prisma comments on the Vehicle/driverUserId field for the reasoning.

// ───────────────────────────── serializers ─────────────────────────────

export const serializeRoute = (r: Route) => ({
  id: r.id,
  name: r.name,
  description: r.description ?? undefined,
  createdAt: r.createdAt.toISOString(),
})

export const serializeStop = (s: Stop) => ({
  id: s.id,
  routeId: s.routeId,
  name: s.name,
  sequence: s.sequence,
  latitude: s.latitude ?? undefined,
  longitude: s.longitude ?? undefined,
  arrivalOffsetMin: s.arrivalOffsetMin ?? undefined,
})

export const serializeVehicle = (v: Vehicle) => ({
  id: v.id,
  registrationNo: v.registrationNo,
  capacity: v.capacity,
  routeId: v.routeId ?? undefined,
  driverName: v.driverName,
  driverPhone: v.driverPhone,
  conductorName: v.conductorName ?? undefined,
  conductorPhone: v.conductorPhone ?? undefined,
  driverUserId: v.driverUserId ?? undefined,
  createdAt: v.createdAt.toISOString(),
})

export const serializeAssignment = (a: StudentStopAssignment) => ({
  id: a.id,
  studentId: a.studentId,
  stopId: a.stopId,
  boardingType: a.boardingType,
  createdAt: a.createdAt.toISOString(),
})

export const serializeLocation = (l: VehicleLocation) => ({
  id: l.id,
  vehicleId: l.vehicleId,
  latitude: l.latitude,
  longitude: l.longitude,
  recordedAt: l.recordedAt.toISOString(),
  tripDate: fmtDate(l.tripDate),
})

// ───────────────────────────── routes ─────────────────────────────

export function listRoutes(ctx: Ctx) {
  return prisma.route.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }] })
}

export async function getRoute(ctx: Ctx, id: string) {
  const row = await prisma.route.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { stops: { orderBy: { sequence: 'asc' } } } })
  if (!row) throw notFound('Route')
  return row
}

async function getRouteRow(ctx: Ctx, id: string) {
  const row = await prisma.route.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Route')
  return row
}

export async function createRouteRow(ctx: Ctx, input: z.infer<typeof createRoute>) {
  const row = await prisma.route.create({ data: { schoolId: ctx.schoolId, name: input.name, description: input.description ?? null } })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'route', row.id, undefined, serializeRoute(row))
  return row
}

export async function updateRoute(ctx: Ctx, id: string, input: z.infer<typeof patchRoute>) {
  const before = await getRouteRow(ctx, id)
  const row = await prisma.route.update({ where: { id }, data: input })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'route', id, serializeRoute(before), serializeRoute(row))
  return row
}

// Deleting a route cascades its stops (and their student assignments) and detaches any vehicle
// (Vehicle.routeId → SetNull) — see schema.prisma.
export async function removeRoute(ctx: Ctx, id: string) {
  const before = await getRouteRow(ctx, id)
  await prisma.route.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'route', id, serializeRoute(before))
}

// ───────────────────────────── stops ─────────────────────────────

export function listStops(ctx: Ctx, q: z.infer<typeof stopQuery>) {
  return prisma.stop.findMany({
    where: { schoolId: ctx.schoolId, routeId: q.routeId },
    orderBy: [{ routeId: 'asc' }, { sequence: 'asc' }],
  })
}

async function getStopRow(ctx: Ctx, id: string) {
  const row = await prisma.stop.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Stop')
  return row
}

export async function createStopRow(ctx: Ctx, input: z.infer<typeof createStop>) {
  const route = await prisma.route.findFirst({ where: { id: input.routeId, schoolId: ctx.schoolId } })
  if (!route) throw notFound('Route')
  const row = await prisma.stop.create({
    data: {
      schoolId: ctx.schoolId,
      routeId: input.routeId,
      name: input.name,
      sequence: input.sequence,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      arrivalOffsetMin: input.arrivalOffsetMin ?? null,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'stop', row.id, undefined, serializeStop(row))
  return row
}

export async function updateStopRow(ctx: Ctx, id: string, input: z.infer<typeof patchStop>) {
  const before = await getStopRow(ctx, id)
  const row = await prisma.stop.update({ where: { id }, data: input })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'stop', id, serializeStop(before), serializeStop(row))
  return row
}

// Deleting a stop cascades its student assignments — see schema.prisma.
export async function removeStopRow(ctx: Ctx, id: string) {
  const before = await getStopRow(ctx, id)
  await prisma.stop.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'stop', id, serializeStop(before))
}

// ───────────────────────────── vehicles ─────────────────────────────
// Reads and writes are both staff/admin/superadmin only (unlike routes/stops) — see phase-12-transport.md.

export function listVehicles(ctx: Ctx) {
  return prisma.vehicle.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }] })
}

async function getVehicleRow(ctx: Ctx, id: string) {
  const row = await prisma.vehicle.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Vehicle')
  return row
}

export async function getVehicle(ctx: Ctx, id: string) {
  return getVehicleRow(ctx, id)
}

async function assertRouteAndDriver(ctx: Ctx, routeId?: string | null, driverUserId?: string | null) {
  if (routeId) {
    const route = await prisma.route.findFirst({ where: { id: routeId, schoolId: ctx.schoolId } })
    if (!route) throw notFound('Route')
  }
  if (driverUserId) {
    const user = await prisma.user.findFirst({ where: { id: driverUserId, schoolId: ctx.schoolId, role: { in: EMPLOYEE_ROLES } } })
    if (!user) throw new HttpError(400, 'driverUserId must reference an existing staff/teacher/admin account in this school')
  }
}

export async function createVehicleRow(ctx: Ctx, input: z.infer<typeof createVehicle>) {
  await assertRouteAndDriver(ctx, input.routeId, input.driverUserId)
  const row = await prisma.vehicle.create({
    data: {
      schoolId: ctx.schoolId,
      registrationNo: input.registrationNo,
      capacity: input.capacity,
      routeId: input.routeId ?? null,
      driverName: input.driverName,
      driverPhone: input.driverPhone,
      conductorName: input.conductorName ?? null,
      conductorPhone: input.conductorPhone ?? null,
      driverUserId: input.driverUserId ?? null,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'vehicle', row.id, undefined, serializeVehicle(row))
  return row
}

export async function updateVehicle(ctx: Ctx, id: string, input: z.infer<typeof patchVehicle>) {
  const before = await getVehicleRow(ctx, id)
  if ('routeId' in input || 'driverUserId' in input) await assertRouteAndDriver(ctx, input.routeId, input.driverUserId)
  const row = await prisma.vehicle.update({ where: { id }, data: input })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'vehicle', id, serializeVehicle(before), serializeVehicle(row))
  return row
}

// Deleting a vehicle cascades its location history — see schema.prisma.
export async function removeVehicle(ctx: Ctx, id: string) {
  const before = await getVehicleRow(ctx, id)
  await prisma.vehicle.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'vehicle', id, serializeVehicle(before))
}

// ───────────────────────────── student ↔ stop assignments ─────────────────────────────

export async function listAssignments(ctx: Ctx, q: z.infer<typeof assignmentQuery>) {
  if (isStaff(ctx)) {
    return prisma.studentStopAssignment.findMany({
      where: {
        schoolId: ctx.schoolId,
        studentId: q.studentId,
        stopId: q.stopId,
        ...(q.routeId ? { stop: { routeId: q.routeId } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }],
    })
  }
  if (ctx.role === 'student' || ctx.role === 'parent') {
    const ids = (await visibleStudentIds(ctx))!
    if (q.studentId && !ids.includes(q.studentId)) throw new HttpError(403, ctx.role === 'parent' ? 'That student is not your ward' : 'You can only view your own assignment')
    const studentId = q.studentId ? [q.studentId] : ids
    return prisma.studentStopAssignment.findMany({
      where: { schoolId: ctx.schoolId, studentId: { in: studentId } },
      orderBy: [{ createdAt: 'asc' }],
    })
  }
  throw new HttpError(403, 'Forbidden')
}

async function assertStudent(ctx: Ctx, studentId: string) {
  const student = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')
}

async function assertStop(ctx: Ctx, stopId: string) {
  const stop = await prisma.stop.findFirst({ where: { id: stopId, schoolId: ctx.schoolId } })
  if (!stop) throw notFound('Stop')
}

// "Assign" is an upsert on (studentId, boardingType): re-assigning a student who already has a stop for
// that boarding type simply moves them to the new stop, rather than erroring on the unique constraint.
export async function createAssignmentRow(ctx: Ctx, input: z.infer<typeof createAssignment>) {
  await assertStudent(ctx, input.studentId)
  await assertStop(ctx, input.stopId)
  const before = await prisma.studentStopAssignment.findUnique({ where: { studentId_boardingType: { studentId: input.studentId, boardingType: input.boardingType } } })
  const row = await prisma.studentStopAssignment.upsert({
    where: { studentId_boardingType: { studentId: input.studentId, boardingType: input.boardingType } },
    create: { schoolId: ctx.schoolId, studentId: input.studentId, stopId: input.stopId, boardingType: input.boardingType },
    update: { stopId: input.stopId },
  })
  await audit(ctx.schoolId, ctx.actorId, before ? 'reassign' : 'create', 'studentStopAssignment', row.id, before ? serializeAssignment(before) : undefined, serializeAssignment(row))
  return row
}

// "Unassign" — delete the row.
export async function removeAssignment(ctx: Ctx, id: string) {
  const before = await prisma.studentStopAssignment.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Assignment')
  await prisma.studentStopAssignment.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'studentStopAssignment', id, serializeAssignment(before))
}

// ───────────────────────────── location ping / read ─────────────────────────────

// POST /vehicles/:id/ping — router-gated to staff/admin/superadmin (see router.ts comment); this service
// does not re-check role, matching the rest of the module.
export async function pingLocation(ctx: Ctx, vehicleId: string, input: z.infer<typeof pingBody>) {
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, schoolId: ctx.schoolId } })
  if (!vehicle) throw notFound('Vehicle')
  const tripDate = toDate(input.tripDate ?? fmtDate(new Date()))
  const row = await prisma.vehicleLocation.create({
    data: { schoolId: ctx.schoolId, vehicleId, latitude: input.latitude, longitude: input.longitude, tripDate },
  })
  await audit(ctx.schoolId, ctx.actorId, 'ping', 'vehicleLocation', row.id, undefined, serializeLocation(row))
  return row
}

// A parent/student may read a vehicle's location only if one of their (own/ward) stop assignments sits
// on the route that vehicle currently serves; staff/admin/superadmin may read any vehicle.
async function assertCanViewVehicle(ctx: Ctx, vehicleId: string) {
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, schoolId: ctx.schoolId } })
  if (!vehicle) throw notFound('Vehicle')
  if (isStaff(ctx)) return vehicle
  if (ctx.role !== 'student' && ctx.role !== 'parent') throw new HttpError(403, 'Forbidden')
  if (!vehicle.routeId) throw new HttpError(403, 'This vehicle is not assigned to a route')
  const ids = (await visibleStudentIds(ctx))!
  const assigned = await prisma.studentStopAssignment.findFirst({ where: { studentId: { in: ids }, stop: { routeId: vehicle.routeId } } })
  if (!assigned) throw new HttpError(403, 'You are not assigned to a stop on this vehicle’s route')
  return vehicle
}

// GET /vehicles/:id/location — latest ping, or null (never a 404) if none recorded yet.
export async function latestLocation(ctx: Ctx, vehicleId: string) {
  await assertCanViewVehicle(ctx, vehicleId)
  return prisma.vehicleLocation.findFirst({ where: { vehicleId }, orderBy: { recordedAt: 'desc' } })
}

// ───────────────────────────── my-stop (parent/student convenience) ─────────────────────────────

async function resolveStudentIds(ctx: Ctx, q: z.infer<typeof myStopQuery>): Promise<string[]> {
  if (ctx.role === 'student') return [ctx.actorId]
  if (ctx.role === 'parent') {
    const wards = await prisma.guardian.findMany({ where: { parentId: ctx.actorId }, orderBy: { createdAt: 'asc' }, select: { studentId: true } })
    if (!wards.length) throw new HttpError(404, 'No wards linked to this account')
    const studentId = q.studentId ?? wards[0].studentId
    if (!wards.some(w => w.studentId === studentId)) throw new HttpError(403, 'That student is not your ward')
    return [studentId]
  }
  // staff/admin/superadmin (and teacher) may look up a specific student's transport info too.
  if (!q.studentId) throw new HttpError(400, 'studentId is required for this role')
  return [q.studentId]
}

// GET /my-stop?studentId — assembles stop + route + assigned vehicle's latest location in one call
// (one row per boarding type, so a student with distinct Pickup/Drop stops gets both).
export async function myStop(ctx: Ctx, q: z.infer<typeof myStopQuery>) {
  const [studentId] = await resolveStudentIds(ctx, q)
  await assertStudent(ctx, studentId)

  const assignments = await prisma.studentStopAssignment.findMany({
    where: { schoolId: ctx.schoolId, studentId },
    include: { stop: { include: { route: { include: { vehicles: { orderBy: { createdAt: 'asc' } } } } } } },
    orderBy: [{ createdAt: 'asc' }],
  })

  const items = await Promise.all(assignments.map(async a => {
    const vehicle = a.stop.route.vehicles[0] ?? null
    const location = vehicle ? await prisma.vehicleLocation.findFirst({ where: { vehicleId: vehicle.id }, orderBy: { recordedAt: 'desc' } }) : null
    return {
      id: a.id,
      boardingType: a.boardingType,
      stop: serializeStop(a.stop),
      route: serializeRoute(a.stop.route),
      vehicle: vehicle ? serializeVehicle(vehicle) : null,
      location: location ? serializeLocation(location) : null,
    }
  }))

  return { studentId, assignments: items }
}
