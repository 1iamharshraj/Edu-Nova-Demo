import type { z } from 'zod'
import type { Hostel, HostelRoom, HostelBed, HostelAllocation } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isStaff, visibleStudentIds } from '../../lib/scope'
import { toDate, fmtDate } from '../../lib/validate'
import { EMPLOYEE_ROLES } from '../../userDefaults'
import type { createHostel, patchHostel, createRoom, patchRoom, roomQuery, createBed, patchBed, bedQuery, createAllocation, vacateBody, transferBody, allocationQuery } from './schema'

// See phase-14-hostel.md. `HostelBed` is one row per physical bed so occupancy is exact; `HostelRoom
// .capacity` is kept in sync with its bed count by this service (see resizeRoom/createRoomRow/
// createBedRow/removeBedRow) rather than trusted as an independent counter.

// ───────────────────────────── serializers ─────────────────────────────

export const serializeHostel = (h: Hostel) => ({
  id: h.id,
  name: h.name,
  type: h.type,
  wardenUserId: h.wardenUserId ?? undefined,
  address: h.address ?? undefined,
  createdAt: h.createdAt.toISOString(),
})

export const serializeRoom = (r: HostelRoom) => ({
  id: r.id,
  hostelId: r.hostelId,
  roomNumber: r.roomNumber,
  floor: r.floor ?? undefined,
  capacity: r.capacity,
  roomType: r.roomType ?? undefined,
  createdAt: r.createdAt.toISOString(),
})

export const serializeBed = (b: HostelBed) => ({
  id: b.id,
  roomId: b.roomId,
  bedLabel: b.bedLabel,
  createdAt: b.createdAt.toISOString(),
})

export const serializeAllocation = (a: HostelAllocation) => ({
  id: a.id,
  studentId: a.studentId,
  bedId: a.bedId,
  checkInDate: fmtDate(a.checkInDate),
  checkOutDate: a.checkOutDate ? fmtDate(a.checkOutDate) : undefined,
  status: a.status,
  allocatedById: a.allocatedById ?? undefined,
  notes: a.notes ?? undefined,
  createdAt: a.createdAt.toISOString(),
})

// ───────────────────────────── hostels ─────────────────────────────

// Read is open to any authenticated role (like Transport's routes/stops) — which hostels/rooms/beds
// exist, and their occupancy, is not sensitive the way e.g. a driver's phone number is; a student/parent
// benefits from being able to browse it too. Write is staff/admin/superadmin only (enforced in router.ts).
export async function listHostels(ctx: Ctx) {
  const hostels = await prisma.hostel.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }] })
  const beds = await prisma.hostelBed.groupBy({ by: ['roomId'], where: { room: { hostelId: { in: hostels.map(h => h.id) } } }, _count: { id: true } })
  const rooms = await prisma.hostelRoom.findMany({ where: { hostelId: { in: hostels.map(h => h.id) } }, select: { id: true, hostelId: true } })
  const roomHostel = new Map(rooms.map(r => [r.id, r.hostelId]))
  const bedCountByHostel = new Map<string, number>()
  for (const g of beds) {
    const hostelId = roomHostel.get(g.roomId)
    if (hostelId) bedCountByHostel.set(hostelId, (bedCountByHostel.get(hostelId) ?? 0) + g._count.id)
  }
  const occupied = await prisma.hostelAllocation.groupBy({
    by: ['bedId'],
    where: { schoolId: ctx.schoolId, status: 'Active', bed: { room: { hostelId: { in: hostels.map(h => h.id) } } } },
  })
  const occupiedBeds = await prisma.hostelBed.findMany({ where: { id: { in: occupied.map(o => o.bedId) } }, select: { id: true, roomId: true } })
  const occupiedByHostel = new Map<string, number>()
  for (const b of occupiedBeds) {
    const hostelId = roomHostel.get(b.roomId)
    if (hostelId) occupiedByHostel.set(hostelId, (occupiedByHostel.get(hostelId) ?? 0) + 1)
  }
  return hostels.map(h => ({
    ...serializeHostel(h),
    totalBeds: bedCountByHostel.get(h.id) ?? 0,
    occupiedBeds: occupiedByHostel.get(h.id) ?? 0,
  }))
}

async function getHostelRow(ctx: Ctx, id: string) {
  const row = await prisma.hostel.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Hostel')
  return row
}

// Detail view: hostel + its rooms, each with beds and each bed's current occupant (if any).
export async function getHostel(ctx: Ctx, id: string) {
  const hostel = await getHostelRow(ctx, id)
  const rooms = await prisma.hostelRoom.findMany({ where: { hostelId: id }, orderBy: [{ roomNumber: 'asc' }] })
  const beds = await prisma.hostelBed.findMany({ where: { roomId: { in: rooms.map(r => r.id) } }, orderBy: [{ bedLabel: 'asc' }] })
  const activeAllocs = await prisma.hostelAllocation.findMany({
    where: { schoolId: ctx.schoolId, status: 'Active', bedId: { in: beds.map(b => b.id) } },
    include: { student: { select: { id: true, name: true } } },
  })
  const occupantByBed = new Map(activeAllocs.map(a => [a.bedId, { allocationId: a.id, studentId: a.studentId, studentName: a.student.name, checkInDate: fmtDate(a.checkInDate) }]))
  const bedsByRoom = new Map<string, typeof beds>()
  for (const b of beds) bedsByRoom.set(b.roomId, [...(bedsByRoom.get(b.roomId) ?? []), b])
  return {
    ...serializeHostel(hostel),
    rooms: rooms.map(r => ({
      ...serializeRoom(r),
      beds: (bedsByRoom.get(r.id) ?? []).map(b => ({ ...serializeBed(b), occupant: occupantByBed.get(b.id) ?? null })),
    })),
  }
}

async function assertWarden(ctx: Ctx, wardenUserId?: string | null) {
  if (!wardenUserId) return
  const user = await prisma.user.findFirst({ where: { id: wardenUserId, schoolId: ctx.schoolId, role: { in: EMPLOYEE_ROLES } } })
  if (!user) throw new HttpError(400, 'wardenUserId must reference an existing staff/teacher/admin account in this school')
}

export async function createHostelRow(ctx: Ctx, input: z.infer<typeof createHostel>) {
  await assertWarden(ctx, input.wardenUserId)
  const row = await prisma.hostel.create({
    data: { schoolId: ctx.schoolId, name: input.name, type: input.type, wardenUserId: input.wardenUserId ?? null, address: input.address ?? null },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'hostel', row.id, undefined, serializeHostel(row))
  return row
}

export async function updateHostel(ctx: Ctx, id: string, input: z.infer<typeof patchHostel>) {
  const before = await getHostelRow(ctx, id)
  if ('wardenUserId' in input) await assertWarden(ctx, input.wardenUserId)
  const row = await prisma.hostel.update({ where: { id }, data: input })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'hostel', id, serializeHostel(before), serializeHostel(row))
  return row
}

// Deleting a hostel cascades its rooms, beds, and allocation history — see schema.prisma.
export async function removeHostel(ctx: Ctx, id: string) {
  const before = await getHostelRow(ctx, id)
  await prisma.hostel.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'hostel', id, serializeHostel(before))
}

// ───────────────────────────── rooms ─────────────────────────────

export async function listRooms(ctx: Ctx, q: z.infer<typeof roomQuery>) {
  const rooms = await prisma.hostelRoom.findMany({
    where: { schoolId: ctx.schoolId, hostelId: q.hostelId },
    orderBy: [{ hostelId: 'asc' }, { roomNumber: 'asc' }],
  })
  const beds = await prisma.hostelBed.findMany({ where: { roomId: { in: rooms.map(r => r.id) } }, select: { id: true, roomId: true } })
  const occupied = await prisma.hostelAllocation.findMany({ where: { schoolId: ctx.schoolId, status: 'Active', bedId: { in: beds.map(b => b.id) } }, select: { bedId: true } })
  const occupiedBedIds = new Set(occupied.map(o => o.bedId))
  const bedCountByRoom = new Map<string, number>()
  const occupiedCountByRoom = new Map<string, number>()
  for (const b of beds) {
    bedCountByRoom.set(b.roomId, (bedCountByRoom.get(b.roomId) ?? 0) + 1)
    if (occupiedBedIds.has(b.id)) occupiedCountByRoom.set(b.roomId, (occupiedCountByRoom.get(b.roomId) ?? 0) + 1)
  }
  return rooms.map(r => ({ ...serializeRoom(r), bedCount: bedCountByRoom.get(r.id) ?? 0, occupiedCount: occupiedCountByRoom.get(r.id) ?? 0 }))
}

async function getRoomRow(ctx: Ctx, id: string) {
  const row = await prisma.hostelRoom.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Room')
  return row
}

// Auto-labels beds "1".."N" unless `bedLabels` was given (validated to have exactly `capacity` entries).
export async function createRoomRow(ctx: Ctx, input: z.infer<typeof createRoom>) {
  const hostel = await prisma.hostel.findFirst({ where: { id: input.hostelId, schoolId: ctx.schoolId } })
  if (!hostel) throw notFound('Hostel')
  if (input.bedLabels && input.bedLabels.length !== input.capacity) {
    throw new HttpError(400, 'bedLabels must have exactly `capacity` entries when provided')
  }
  const labels = input.bedLabels ?? Array.from({ length: input.capacity }, (_, i) => String(i + 1))
  if (new Set(labels).size !== labels.length) throw new HttpError(400, 'bedLabels must be unique within the room')

  const row = await prisma.$transaction(async tx => {
    const room = await tx.hostelRoom.create({
      data: {
        schoolId: ctx.schoolId,
        hostelId: input.hostelId,
        roomNumber: input.roomNumber,
        floor: input.floor ?? null,
        capacity: input.capacity,
        roomType: input.roomType ?? null,
      },
    })
    await tx.hostelBed.createMany({ data: labels.map(bedLabel => ({ schoolId: ctx.schoolId, roomId: room.id, bedLabel })) })
    return room
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'hostelRoom', row.id, undefined, serializeRoom(row))
  return row
}

// Patching `capacity` auto-adds beds (next unused numeric labels) or auto-removes unoccupied beds
// (highest label first) to match — rejected with a 409 if shrinking would require removing a bed that
// currently has an Active allocation.
async function resizeRoom(ctx: Ctx, room: HostelRoom, newCapacity: number) {
  if (newCapacity === room.capacity) return
  const beds = await prisma.hostelBed.findMany({ where: { roomId: room.id }, orderBy: [{ createdAt: 'asc' }] })
  if (newCapacity > beds.length) {
    const existingLabels = new Set(beds.map(b => b.bedLabel))
    const toAdd: string[] = []
    let n = 1
    while (toAdd.length < newCapacity - beds.length) {
      const label = String(n++)
      if (!existingLabels.has(label) && !toAdd.includes(label)) toAdd.push(label)
    }
    await prisma.hostelBed.createMany({ data: toAdd.map(bedLabel => ({ schoolId: ctx.schoolId, roomId: room.id, bedLabel })) })
  } else if (newCapacity < beds.length) {
    const removeCount = beds.length - newCapacity
    const occupied = await prisma.hostelAllocation.findMany({ where: { status: 'Active', bedId: { in: beds.map(b => b.id) } }, select: { bedId: true } })
    const occupiedIds = new Set(occupied.map(o => o.bedId))
    const removable = beds.filter(b => !occupiedIds.has(b.id)).reverse() // newest-first, so labels added most recently go first
    if (removable.length < removeCount) {
      throw new HttpError(409, `Cannot shrink capacity to ${newCapacity}: only ${removable.length} unoccupied bed(s) available to remove out of ${removeCount} needed`)
    }
    const idsToRemove = removable.slice(0, removeCount).map(b => b.id)
    await prisma.hostelBed.deleteMany({ where: { id: { in: idsToRemove } } })
  }
}

export async function updateRoom(ctx: Ctx, id: string, input: z.infer<typeof patchRoom>) {
  const before = await getRoomRow(ctx, id)
  const { capacity, ...rest } = input
  if (capacity !== undefined) await resizeRoom(ctx, before, capacity)
  const row = await prisma.hostelRoom.update({ where: { id }, data: { ...rest, ...(capacity !== undefined ? { capacity } : {}) } })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'hostelRoom', id, serializeRoom(before), serializeRoom(row))
  return row
}

// Deleting a room cascades its beds and their allocation history — see schema.prisma.
export async function removeRoom(ctx: Ctx, id: string) {
  const before = await getRoomRow(ctx, id)
  await prisma.hostelRoom.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'hostelRoom', id, serializeRoom(before))
}

// ───────────────────────────── beds ─────────────────────────────

export async function listBeds(ctx: Ctx, q: z.infer<typeof bedQuery>) {
  const beds = await prisma.hostelBed.findMany({
    where: {
      schoolId: ctx.schoolId,
      roomId: q.roomId,
      ...(q.hostelId ? { room: { hostelId: q.hostelId } } : {}),
    },
    orderBy: [{ roomId: 'asc' }, { bedLabel: 'asc' }],
  })
  const active = await prisma.hostelAllocation.findMany({
    where: { schoolId: ctx.schoolId, status: 'Active', bedId: { in: beds.map(b => b.id) } },
    include: { student: { select: { id: true, name: true } } },
  })
  const occupantByBed = new Map(active.map(a => [a.bedId, { allocationId: a.id, studentId: a.studentId, studentName: a.student.name, checkInDate: fmtDate(a.checkInDate) }]))
  const filtered = q.status === 'occupied' ? beds.filter(b => occupantByBed.has(b.id)) : q.status === 'vacant' ? beds.filter(b => !occupantByBed.has(b.id)) : beds
  return filtered.map(b => ({ ...serializeBed(b), occupant: occupantByBed.get(b.id) ?? null }))
}

async function getBedRow(ctx: Ctx, id: string) {
  const row = await prisma.hostelBed.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Bed')
  return row
}

// Manually adding one bed on top of the auto-generated set; bumps the room's `capacity` to match.
export async function createBedRow(ctx: Ctx, input: z.infer<typeof createBed>) {
  const room = await prisma.hostelRoom.findFirst({ where: { id: input.roomId, schoolId: ctx.schoolId } })
  if (!room) throw notFound('Room')
  const row = await prisma.$transaction(async tx => {
    const bed = await tx.hostelBed.create({ data: { schoolId: ctx.schoolId, roomId: input.roomId, bedLabel: input.bedLabel } })
    await tx.hostelRoom.update({ where: { id: room.id }, data: { capacity: { increment: 1 } } })
    return bed
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'hostelBed', row.id, undefined, serializeBed(row))
  return row
}

export async function updateBed(ctx: Ctx, id: string, input: z.infer<typeof patchBed>) {
  const before = await getBedRow(ctx, id)
  const row = await prisma.hostelBed.update({ where: { id }, data: input })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'hostelBed', id, serializeBed(before), serializeBed(row))
  return row
}

// Deleting a bed is blocked while it has an Active allocation (vacate/transfer the occupant first);
// decrements the room's `capacity` to match.
export async function removeBed(ctx: Ctx, id: string) {
  const before = await getBedRow(ctx, id)
  const active = await prisma.hostelAllocation.findFirst({ where: { bedId: id, status: 'Active' } })
  if (active) throw new HttpError(409, 'This bed has an active occupant — vacate or transfer them before removing the bed')
  await prisma.$transaction(async tx => {
    await tx.hostelBed.delete({ where: { id } })
    await tx.hostelRoom.update({ where: { id: before.roomId }, data: { capacity: { decrement: 1 } } })
  })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'hostelBed', id, serializeBed(before))
}

// ───────────────────────────── allocations ─────────────────────────────

async function assertStudent(ctx: Ctx, studentId: string) {
  const student = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')
  return student
}

async function getBedWithRoom(ctx: Ctx, bedId: string) {
  const bed = await prisma.hostelBed.findFirst({ where: { id: bedId, schoolId: ctx.schoolId }, include: { room: true } })
  if (!bed) throw notFound('Bed')
  return bed
}

// Core invariant #1: a bed holds at most one Active allocation at a time.
async function assertBedFree(bedId: string) {
  const occupied = await prisma.hostelAllocation.findFirst({ where: { bedId, status: 'Active' } })
  if (occupied) throw new HttpError(409, 'This bed is already occupied — vacate or transfer the current occupant first')
}

// Core invariant #2: a student has at most one Active allocation at a time.
async function assertStudentUnallocated(studentId: string) {
  const active = await prisma.hostelAllocation.findFirst({ where: { studentId, status: 'Active' } })
  if (active) throw new HttpError(409, 'This student already has an active hostel allocation — vacate or transfer it first')
}

// POST /allocations — allocate a student to a bed. Both invariants above are checked here (clear 4xx,
// not a 500); the two partial unique indexes added by hand in the Phase 14 migration
// (`HostelAllocation_bedId_active_key` / `HostelAllocation_studentId_active_key`) back this up at the
// database level against a race between two concurrent requests — a violation there surfaces as Prisma's
// P2002, mapped to a 409 by the shared error handler (see lib/errors.ts).
export async function allocate(ctx: Ctx, input: z.infer<typeof createAllocation>) {
  await assertStudent(ctx, input.studentId)
  const bed = await getBedWithRoom(ctx, input.bedId)
  await assertBedFree(bed.id)
  await assertStudentUnallocated(input.studentId)
  const row = await prisma.hostelAllocation.create({
    data: {
      schoolId: ctx.schoolId,
      studentId: input.studentId,
      bedId: input.bedId,
      checkInDate: toDate(input.checkInDate ?? fmtDate(new Date())),
      status: 'Active',
      allocatedById: ctx.actorId,
      notes: input.notes ?? null,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'allocate', 'hostelAllocation', row.id, undefined, serializeAllocation(row))
  return row
}

async function getAllocationRow(ctx: Ctx, id: string) {
  const row = await prisma.hostelAllocation.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Allocation')
  return row
}

// POST /allocations/:id/vacate — frees the bed; only valid on a currently-Active allocation.
export async function vacate(ctx: Ctx, id: string, input: z.infer<typeof vacateBody>) {
  const before = await getAllocationRow(ctx, id)
  if (before.status !== 'Active') throw new HttpError(400, `Allocation is not Active (status: ${before.status})`)
  const row = await prisma.hostelAllocation.update({
    where: { id },
    data: {
      status: 'Vacated',
      checkOutDate: toDate(input.checkOutDate ?? fmtDate(new Date())),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'vacate', 'hostelAllocation', id, serializeAllocation(before), serializeAllocation(row))
  return row
}

// POST /allocations/:id/transfer — vacate-old (status: Transferred) + allocate-new (status: Active) in
// one transaction, per phase-14-hostel.md: the old row is never mutated in place (`bedId` stays fixed)
// so the occupancy history stays honest. Both invariants are re-checked against the destination bed.
export async function transfer(ctx: Ctx, id: string, input: z.infer<typeof transferBody>) {
  const before = await getAllocationRow(ctx, id)
  if (before.status !== 'Active') throw new HttpError(400, `Allocation is not Active (status: ${before.status})`)
  if (input.bedId === before.bedId) throw new HttpError(400, 'New bed must be different from the current bed')
  const bed = await getBedWithRoom(ctx, input.bedId)
  await assertBedFree(bed.id)

  const now = fmtDate(new Date())
  const [oldRow, newRow] = await prisma.$transaction([
    prisma.hostelAllocation.update({
      where: { id },
      data: { status: 'Transferred', checkOutDate: toDate(now) },
    }),
    prisma.hostelAllocation.create({
      data: {
        schoolId: ctx.schoolId,
        studentId: before.studentId,
        bedId: input.bedId,
        checkInDate: toDate(input.checkInDate ?? now),
        status: 'Active',
        allocatedById: ctx.actorId,
        notes: input.notes ?? null,
      },
    }),
  ])
  await audit(ctx.schoolId, ctx.actorId, 'transfer', 'hostelAllocation', id, serializeAllocation(before), { from: serializeAllocation(oldRow), to: serializeAllocation(newRow) })
  return newRow
}

export async function getAllocation(ctx: Ctx, id: string) {
  return getAllocationRow(ctx, id)
}

// GET /allocations — staff/admin/superadmin see everything (optionally filtered); a teacher gets 403
// unless a future need arises (mirrors Transport's listAssignments — see phase-12 precedent); a
// student/parent sees only their own/ward's allocations (defaulting to "all my/my wards'" when no
// `studentId` filter is given — this doubles as the "what's my/my ward's allocation" read from the spec,
// reusing lib/scope.ts#visibleStudentIds rather than a bespoke endpoint).
export async function listAllocations(ctx: Ctx, q: z.infer<typeof allocationQuery>) {
  if (isStaff(ctx)) {
    return prisma.hostelAllocation.findMany({
      where: {
        schoolId: ctx.schoolId,
        studentId: q.studentId,
        status: q.status,
        ...(q.bedId ? { bedId: q.bedId } : {}),
        ...(q.roomId ? { bed: { roomId: q.roomId } } : {}),
        ...(q.hostelId ? { bed: { room: { hostelId: q.hostelId } } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
    })
  }
  if (ctx.role === 'student' || ctx.role === 'parent') {
    const ids = (await visibleStudentIds(ctx))!
    if (q.studentId && !ids.includes(q.studentId)) throw new HttpError(403, ctx.role === 'parent' ? 'That student is not your ward' : 'You can only view your own allocation')
    const studentId = q.studentId ? [q.studentId] : ids
    return prisma.hostelAllocation.findMany({
      where: { schoolId: ctx.schoolId, studentId: { in: studentId }, status: q.status },
      orderBy: [{ createdAt: 'desc' }],
    })
  }
  throw new HttpError(403, 'Forbidden')
}
