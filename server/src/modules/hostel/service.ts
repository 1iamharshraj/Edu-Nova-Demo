import type { z } from 'zod'
import { Prisma } from '@prisma/client'
import type { Hostel, HostelRoom, HostelBed, HostelAllocation, HostelOutpass, HostelRollCall, MessMenu, MealFeedback } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notify, sendEmail, sendSms } from '../../lib/notify'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isStaff, visibleStudentIds, isGuardianOf } from '../../lib/scope'
import { toDate, fmtDate } from '../../lib/validate'
import { EMPLOYEE_ROLES } from '../../userDefaults'
import type {
  createHostel, patchHostel, createRoom, patchRoom, roomQuery, createBed, patchBed, bedQuery, createAllocation, vacateBody, transferBody, allocationQuery,
  createOutpass, decideOutpass, outpassQuery,
  createRollCall, patchRollCallEntries, rollCallQuery,
  createMenu, patchMenu, menuQuery, createFeedback, feedbackQuery,
} from './schema'

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

// ═══════════════════════════ Phase 24: hostel outpass / roll-call / mess menu ═══════════════════════════
// See phase-24-boarding-hostel-extensions.md. All three items extend this module rather than forking a
// new one, and reuse Phase 14's self-or-guardian scoping pattern plus lib/notify.ts's existing
// email/SMS/in-app provider abstraction (no new delivery infrastructure).

// A hostel's warden (Hostel.wardenUserId) may be a teacher account (see assertWarden above), which is
// outside STAFF_ROLES — so write actions on outpasses/roll-calls/mess-menu are NOT gated by the blanket
// requireRole('staff','admin','superadmin') the rest of this router uses; they're open to any
// authenticated role at the router level and this helper enforces "staff/admin/superadmin, or the
// specific hostel's warden" in the service instead.
async function assertWardenOrStaff(ctx: Ctx, hostelId: string) {
  if (isStaff(ctx)) return
  if (ctx.role === 'teacher') {
    const hostel = await prisma.hostel.findFirst({ where: { id: hostelId, schoolId: ctx.schoolId }, select: { wardenUserId: true } })
    if (hostel?.wardenUserId === ctx.actorId) return
  }
  throw new HttpError(403, "Only this hostel's warden or staff/admin may do this")
}

// Hostel ids a teacher wardens — used to scope a warden's "my hostel" reads.
async function wardenHostelIds(ctx: Ctx): Promise<string[]> {
  if (ctx.role !== 'teacher') return []
  const rows = await prisma.hostel.findMany({ where: { schoolId: ctx.schoolId, wardenUserId: ctx.actorId }, select: { id: true } })
  return rows.map(h => h.id)
}

// Notifies every guardian of a student over in-app + email + SMS — mirrors modules/safety/service.ts's
// requestPickupOtp guardian fan-out. Best-effort: notify()/sendEmail/sendSms never throw.
async function notifyGuardians(ctx: Ctx, studentId: string, kind: string, title: string, body: string) {
  const guardians = await prisma.guardian.findMany({ where: { studentId }, include: { parent: true } })
  await Promise.all(guardians.flatMap(g => [
    sendEmail({ to: g.parent.email, subject: title, body }),
    g.parent.phone ? sendSms({ to: g.parent.phone, body }) : Promise.resolve(),
    notify(ctx.schoolId, g.parentId, kind, title, body),
  ]))
}

// ───────────────────────────── outpasses ─────────────────────────────

// `Overdue` is never stored — a `Departed` outpass past its expectedReturnAt with no actualReturnAt reads
// as Overdue at query time (see phase-24-boarding-hostel-extensions.md → item 1: "computed-at-read is
// simpler and sufficient here, don't build a scheduler for this").
function computeOutpassStatus(o: Pick<HostelOutpass, 'status' | 'expectedReturnAt' | 'actualReturnAt'>): string {
  if (o.status === 'Departed' && !o.actualReturnAt && o.expectedReturnAt.getTime() < Date.now()) return 'Overdue'
  return o.status
}

export const serializeOutpass = (o: HostelOutpass) => ({
  id: o.id,
  studentId: o.studentId,
  hostelId: o.hostelId,
  requestedById: o.requestedById,
  requestedDepartureAt: o.requestedDepartureAt.toISOString(),
  expectedReturnAt: o.expectedReturnAt.toISOString(),
  reason: o.reason,
  destination: o.destination ?? undefined,
  status: computeOutpassStatus(o),
  approvedByWardenId: o.approvedByWardenId ?? undefined,
  approvedAt: o.approvedAt?.toISOString(),
  actualDepartureAt: o.actualDepartureAt?.toISOString(),
  actualReturnAt: o.actualReturnAt?.toISOString(),
  createdAt: o.createdAt.toISOString(),
})

async function getOutpassRow(ctx: Ctx, id: string) {
  const row = await prisma.hostelOutpass.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Outpass')
  return row
}

// `status` filter of "Overdue" can't be pushed to the DB (it's computed) — fetched as Departed/unreturned
// and filtered in memory instead.
async function queryOutpasses(where: Record<string, unknown>, status?: string) {
  if (status === 'Overdue') {
    const rows = await prisma.hostelOutpass.findMany({ where: { ...where, status: 'Departed', actualReturnAt: null }, orderBy: [{ createdAt: 'desc' }] })
    return rows.filter(r => computeOutpassStatus(r) === 'Overdue').map(serializeOutpass)
  }
  const rows = await prisma.hostelOutpass.findMany({ where: { ...where, status }, orderBy: [{ createdAt: 'desc' }] })
  return rows.map(serializeOutpass)
}

// POST /outpasses — student (self) or parent (ward), for the student's current active allocation.
export async function createOutpassSvc(ctx: Ctx, input: z.infer<typeof createOutpass>) {
  if (ctx.role === 'student') {
    if (input.studentId !== ctx.actorId) throw new HttpError(403, 'You can only request an outpass for yourself')
  } else if (ctx.role === 'parent') {
    if (!(await isGuardianOf(ctx, input.studentId))) throw new HttpError(403, 'That student is not your ward')
  } else {
    throw new HttpError(403, 'Only a student or parent may request an outpass')
  }
  const requestedDepartureAt = new Date(input.requestedDepartureAt)
  const expectedReturnAt = new Date(input.expectedReturnAt)
  if (expectedReturnAt <= requestedDepartureAt) throw new HttpError(400, 'expectedReturnAt must be after requestedDepartureAt')

  const allocation = await prisma.hostelAllocation.findFirst({
    where: { schoolId: ctx.schoolId, studentId: input.studentId, status: 'Active' },
    include: { bed: { include: { room: true } } },
  })
  if (!allocation) throw new HttpError(400, 'Student has no active hostel allocation')

  const row = await prisma.hostelOutpass.create({
    data: {
      schoolId: ctx.schoolId,
      studentId: input.studentId,
      hostelId: allocation.bed.room.hostelId,
      requestedById: ctx.actorId,
      requestedDepartureAt,
      expectedReturnAt,
      reason: input.reason,
      destination: input.destination ?? null,
      status: 'Pending',
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'hostelOutpass', row.id, undefined, serializeOutpass(row))
  const hostel = await prisma.hostel.findUnique({ where: { id: row.hostelId }, select: { wardenUserId: true } })
  if (hostel?.wardenUserId) await notify(ctx.schoolId, hostel.wardenUserId, 'hostel-outpass', 'New outpass request', input.reason, 'hostel')
  return row
}

// GET /outpasses — staff/admin/superadmin see everything (optionally filtered); a teacher must be the
// warden of at least one hostel and sees only requests for the hostel(s) they warden; student/parent see
// only their own/wards' requests.
export async function listOutpasses(ctx: Ctx, q: z.infer<typeof outpassQuery>) {
  if (isStaff(ctx)) {
    return queryOutpasses({ schoolId: ctx.schoolId, studentId: q.studentId, hostelId: q.hostelId }, q.status)
  }
  if (ctx.role === 'teacher') {
    const wardenIds = await wardenHostelIds(ctx)
    if (!wardenIds.length) throw new HttpError(403, 'You are not a warden of any hostel')
    const hostelIds = q.hostelId ? wardenIds.filter(id => id === q.hostelId) : wardenIds
    if (!hostelIds.length) throw new HttpError(403, 'That hostel is not yours to view')
    return queryOutpasses({ schoolId: ctx.schoolId, studentId: q.studentId, hostelId: { in: hostelIds } }, q.status)
  }
  if (ctx.role === 'student' || ctx.role === 'parent') {
    const ids = (await visibleStudentIds(ctx))!
    if (q.studentId && !ids.includes(q.studentId)) throw new HttpError(403, ctx.role === 'parent' ? 'That student is not your ward' : 'You can only view your own outpasses')
    const studentIds = q.studentId ? [q.studentId] : ids
    return queryOutpasses({ schoolId: ctx.schoolId, studentId: { in: studentIds }, hostelId: q.hostelId }, q.status)
  }
  throw new HttpError(403, 'Forbidden')
}

// POST /outpasses/:id/approve — notifies the student's guardians (spec: "on approval, notify the parent").
export async function approveOutpass(ctx: Ctx, id: string) {
  const before = await getOutpassRow(ctx, id)
  await assertWardenOrStaff(ctx, before.hostelId)
  if (before.status !== 'Pending') throw new HttpError(409, `Outpass is already ${before.status}`)
  const row = await prisma.hostelOutpass.update({ where: { id }, data: { status: 'Approved', approvedByWardenId: ctx.actorId, approvedAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'approve', 'hostelOutpass', id, serializeOutpass(before), serializeOutpass(row))
  const body = `Outpass approved: departure ${row.requestedDepartureAt.toISOString()}, expected return ${row.expectedReturnAt.toISOString()}. Reason: ${row.reason}`
  await notifyGuardians(ctx, row.studentId, 'hostel-outpass', 'Outpass approved', body)
  return row
}

export async function declineOutpass(ctx: Ctx, id: string, input: z.infer<typeof decideOutpass>) {
  const before = await getOutpassRow(ctx, id)
  await assertWardenOrStaff(ctx, before.hostelId)
  if (before.status !== 'Pending') throw new HttpError(409, `Outpass is already ${before.status}`)
  const row = await prisma.hostelOutpass.update({ where: { id }, data: { status: 'Declined', approvedByWardenId: ctx.actorId, approvedAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'decline', 'hostelOutpass', id, serializeOutpass(before), serializeOutpass(row))
  await notify(ctx.schoolId, row.requestedById, 'hostel-outpass', 'Outpass declined', input.note || `Your outpass request (${row.reason}) was declined.`)
  return row
}

// POST /outpasses/:id/depart — gate/warden logs actual departure; only valid from Approved.
export async function departOutpass(ctx: Ctx, id: string) {
  const before = await getOutpassRow(ctx, id)
  await assertWardenOrStaff(ctx, before.hostelId)
  if (before.status !== 'Approved') throw new HttpError(409, `Outpass must be Approved to log departure (is ${before.status})`)
  const row = await prisma.hostelOutpass.update({ where: { id }, data: { status: 'Departed', actualDepartureAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'depart', 'hostelOutpass', id, serializeOutpass(before), serializeOutpass(row))
  return row
}

// POST /outpasses/:id/return — only valid from Departed (which covers the computed-Overdue case too,
// since the stored status stays "Departed" the whole time).
export async function returnOutpass(ctx: Ctx, id: string) {
  const before = await getOutpassRow(ctx, id)
  await assertWardenOrStaff(ctx, before.hostelId)
  if (before.status !== 'Departed') throw new HttpError(409, `Outpass must be Departed to log return (is ${before.status})`)
  const row = await prisma.hostelOutpass.update({ where: { id }, data: { status: 'Returned', actualReturnAt: new Date() } })
  await audit(ctx.schoolId, ctx.actorId, 'return', 'hostelOutpass', id, serializeOutpass(before), serializeOutpass(row))
  return row
}

// ───────────────────────────── roll-call ─────────────────────────────

const rollCallInclude = {
  entries: { include: { allocation: { select: { studentId: true, student: { select: { id: true, name: true } } } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.HostelRollCallInclude
type RollCallFull = Prisma.HostelRollCallGetPayload<{ include: typeof rollCallInclude }>

export const serializeRollCallEntry = (e: RollCallFull['entries'][number]) => ({
  id: e.id,
  allocationId: e.allocationId,
  studentId: e.allocation.studentId,
  studentName: e.allocation.student.name,
  present: e.present,
  notes: e.notes ?? undefined,
})

export const serializeRollCall = (r: RollCallFull, onlyStudentIds?: string[] | null) => ({
  id: r.id,
  hostelId: r.hostelId,
  date: fmtDate(r.date),
  recordedById: r.recordedById ?? undefined,
  createdAt: r.createdAt.toISOString(),
  entries: r.entries.filter(e => !onlyStudentIds || onlyStudentIds.includes(e.allocation.studentId)).map(serializeRollCallEntry),
})

async function getRollCallRow(ctx: Ctx, id: string) {
  const row = await prisma.hostelRollCall.findFirst({ where: { id, schoolId: ctx.schoolId }, include: rollCallInclude })
  if (!row) throw notFound('Roll call')
  return row
}

// POST /roll-calls — creates a (hostelId, date) session pre-populated with every currently-Active
// allocation in that hostel, defaulting to present:true — mirrors modules/attendance/service.ts's
// upsertSession "create session, then patch records" pattern. A repeat POST for the same (hostel, date)
// just returns the existing session unchanged (200), rather than clobbering marks already taken.
export async function upsertRollCall(ctx: Ctx, input: z.infer<typeof createRollCall>) {
  await assertWardenOrStaff(ctx, input.hostelId)
  const hostel = await prisma.hostel.findFirst({ where: { id: input.hostelId, schoolId: ctx.schoolId } })
  if (!hostel) throw notFound('Hostel')
  const date = toDate(input.date)

  const existing = await prisma.hostelRollCall.findUnique({ where: { hostelId_date: { hostelId: input.hostelId, date } }, include: rollCallInclude })
  if (existing) return { row: existing, created: false }

  const activeAllocations = await prisma.hostelAllocation.findMany({
    where: { schoolId: ctx.schoolId, status: 'Active', bed: { room: { hostelId: input.hostelId } } },
    select: { id: true },
  })
  const row = await prisma.$transaction(async tx => {
    const session = await tx.hostelRollCall.create({ data: { schoolId: ctx.schoolId, hostelId: input.hostelId, date, recordedById: ctx.actorId } })
    if (activeAllocations.length) {
      await tx.hostelRollCallEntry.createMany({ data: activeAllocations.map(a => ({ rollCallId: session.id, allocationId: a.id, present: true })) })
    }
    return tx.hostelRollCall.findUniqueOrThrow({ where: { id: session.id }, include: rollCallInclude })
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'hostelRollCall', row.id, undefined, serializeRollCall(row))
  return { row, created: true }
}

// GET /roll-calls — staff/admin/superadmin see everything (optionally filtered); a teacher must warden
// the hostel; student/parent see (only their own/ward's entry within) roll-calls that include them.
export async function listRollCalls(ctx: Ctx, q: z.infer<typeof rollCallQuery>) {
  const date = { gte: q.from ? toDate(q.from) : undefined, lte: q.to ? toDate(q.to) : undefined }
  if (isStaff(ctx)) {
    const rows = await prisma.hostelRollCall.findMany({ where: { schoolId: ctx.schoolId, hostelId: q.hostelId, date }, include: rollCallInclude, orderBy: [{ date: 'desc' }] })
    return rows.map(r => serializeRollCall(r))
  }
  if (ctx.role === 'teacher') {
    const wardenIds = await wardenHostelIds(ctx)
    if (!wardenIds.length) throw new HttpError(403, 'You are not a warden of any hostel')
    const hostelIds = q.hostelId ? wardenIds.filter(id => id === q.hostelId) : wardenIds
    if (!hostelIds.length) throw new HttpError(403, 'That hostel is not yours to view')
    const rows = await prisma.hostelRollCall.findMany({ where: { schoolId: ctx.schoolId, hostelId: { in: hostelIds }, date }, include: rollCallInclude, orderBy: [{ date: 'desc' }] })
    return rows.map(r => serializeRollCall(r))
  }
  if (ctx.role === 'student' || ctx.role === 'parent') {
    const ids = (await visibleStudentIds(ctx))!
    const rows = await prisma.hostelRollCall.findMany({
      where: { schoolId: ctx.schoolId, hostelId: q.hostelId, date, entries: { some: { allocation: { studentId: { in: ids } } } } },
      include: rollCallInclude,
      orderBy: [{ date: 'desc' }],
    })
    return rows.map(r => serializeRollCall(r, ids))
  }
  throw new HttpError(403, 'Forbidden')
}

// PATCH /roll-calls/:id/entries — bulk-update presence. Any entry submitted with present:false triggers
// the missing-at-roll-call alert: notify the warden (in-app — they already know, they just took it) AND
// each missing student's registered guardians (email/SMS/in-app) — the actual safety value of the feature.
export async function patchRollCall(ctx: Ctx, id: string, input: z.infer<typeof patchRollCallEntries>) {
  const before = await getRollCallRow(ctx, id)
  await assertWardenOrStaff(ctx, before.hostelId)

  const validIds = new Set(before.entries.map(e => e.allocationId))
  const bad = input.entries.filter(e => !validIds.has(e.allocationId)).map(e => e.allocationId)
  if (bad.length) throw new HttpError(400, "allocationId must be one of this roll call's pre-populated entries", { allocationId: bad })

  await prisma.$transaction(input.entries.map(e => prisma.hostelRollCallEntry.update({
    where: { rollCallId_allocationId: { rollCallId: id, allocationId: e.allocationId } },
    data: { present: e.present, notes: e.notes === undefined ? undefined : e.notes },
  })))
  const row = await getRollCallRow(ctx, id)
  await audit(ctx.schoolId, ctx.actorId, 'patch-entries', 'hostelRollCall', id, serializeRollCall(before), serializeRollCall(row))

  const missingIds = new Set(input.entries.filter(e => e.present === false).map(e => e.allocationId))
  if (missingIds.size) {
    const missingEntries = row.entries.filter(e => missingIds.has(e.allocationId))
    const hostel = await prisma.hostel.findUnique({ where: { id: before.hostelId }, select: { wardenUserId: true, name: true } })
    const names = missingEntries.map(e => e.allocation.student.name).join(', ')
    if (hostel?.wardenUserId) {
      await notify(ctx.schoolId, hostel.wardenUserId, 'hostel-rollcall', 'Missing at roll-call', `${names} marked absent at the ${fmtDate(row.date)} roll-call (${hostel.name}).`, 'hostel')
    }
    await Promise.all(missingEntries.map(e =>
      notifyGuardians(ctx, e.allocation.studentId, 'hostel-rollcall', 'Missing at hostel roll-call', `${e.allocation.student.name} was marked absent at the ${fmtDate(row.date)} hostel roll-call.`),
    ))
  }
  return row
}

// ───────────────────────────── mess menu ─────────────────────────────

const ALLERGY_DISCLAIMER = 'Allergy flags are matched by simple keyword search against recorded allergy records and may not catch every allergen — verify independently.'

export const serializeMenu = (m: MessMenu, allergyFlags?: string[]) => ({
  id: m.id,
  hostelId: m.hostelId,
  date: fmtDate(m.date),
  mealType: m.mealType,
  items: m.items,
  createdById: m.createdById ?? undefined,
  createdAt: m.createdAt.toISOString(),
  allergyDisclaimer: ALLERGY_DISCLAIMER,
  ...(allergyFlags && allergyFlags.length ? { allergyFlags } : {}),
})

async function getMenuRow(ctx: Ctx, id: string) {
  const row = await prisma.messMenu.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Menu')
  return row
}

// Simple keyword cross-reference against the student's HealthRecord `Allergy` entries (Phase 8/22) — not
// a full ingredient-tagging system (deliberately, per spec: "don't force a heavyweight ... system into
// this phase"). Words under 4 chars are skipped to cut down on noise from common short words.
async function allergyKeywordsFor(ctx: Ctx, studentId: string): Promise<string[]> {
  const records = await prisma.healthRecord.findMany({ where: { schoolId: ctx.schoolId, studentId, kind: 'Allergy' }, select: { title: true, detail: true } })
  const words = new Set<string>()
  for (const r of records) {
    for (const w of `${r.title} ${r.detail}`.toLowerCase().split(/[^a-z]+/)) if (w.length >= 4) words.add(w)
  }
  return [...words]
}

function matchAllergyKeywords(items: string[], keywords: string[]): string[] {
  if (!keywords.length) return []
  const hay = items.join(' ').toLowerCase()
  return keywords.filter(k => hay.includes(k))
}

// GET /mess-menu — staff/admin/teacher may browse any hostel's menu (same "not sensitive" reasoning as
// hostels/rooms/beds being open reads — see listHostels above); a student/parent needs an active
// allocation in the queried hostel (or, with no hostelId filter, just gets back whatever their own
// allocation's hostel has). When exactly one student is in view (the student themself, or a parent with
// exactly one ward), menu items are also cross-referenced against that student's allergy keywords.
export async function listMenus(ctx: Ctx, q: z.infer<typeof menuQuery>) {
  const date = { gte: q.from ? toDate(q.from) : undefined, lte: q.to ? toDate(q.to) : undefined }
  let allergyStudentId: string | undefined
  if (isStaff(ctx) || ctx.role === 'teacher') {
    // open read, no allocation check needed.
  } else if (ctx.role === 'student' || ctx.role === 'parent') {
    const ids = (await visibleStudentIds(ctx))!
    if (q.hostelId) {
      const allocation = await prisma.hostelAllocation.findFirst({ where: { schoolId: ctx.schoolId, studentId: { in: ids }, status: 'Active', bed: { room: { hostelId: q.hostelId } } } })
      if (!allocation) throw new HttpError(403, 'You do not have a hostel allocation there')
    }
    if (ids.length === 1) allergyStudentId = ids[0]
  } else {
    throw new HttpError(403, 'Forbidden')
  }
  const rows = await prisma.messMenu.findMany({ where: { schoolId: ctx.schoolId, hostelId: q.hostelId, mealType: q.mealType, date }, orderBy: [{ date: 'asc' }, { mealType: 'asc' }] })
  const keywords = allergyStudentId ? await allergyKeywordsFor(ctx, allergyStudentId) : []
  return rows.map(m => serializeMenu(m, matchAllergyKeywords(m.items, keywords)))
}

// POST /mess-menu — warden/staff/admin; upserts on the (hostelId, date, mealType) unique key so the
// frontend's "single-meal create, looped for a week" usage naturally supports editing a meal already set.
export async function upsertMenu(ctx: Ctx, input: z.infer<typeof createMenu>) {
  await assertWardenOrStaff(ctx, input.hostelId)
  const hostel = await prisma.hostel.findFirst({ where: { id: input.hostelId, schoolId: ctx.schoolId } })
  if (!hostel) throw notFound('Hostel')
  const date = toDate(input.date)
  const key = { hostelId_date_mealType: { hostelId: input.hostelId, date, mealType: input.mealType } }
  const before = await prisma.messMenu.findUnique({ where: key })
  const row = await prisma.messMenu.upsert({
    where: key,
    create: { schoolId: ctx.schoolId, hostelId: input.hostelId, date, mealType: input.mealType, items: input.items, createdById: ctx.actorId },
    update: { items: input.items, createdById: ctx.actorId },
  })
  await audit(ctx.schoolId, ctx.actorId, before ? 'update' : 'create', 'messMenu', row.id, before ? serializeMenu(before) : undefined, serializeMenu(row))
  return { row, created: !before }
}

export async function patchMenuSvc(ctx: Ctx, id: string, input: z.infer<typeof patchMenu>) {
  const before = await getMenuRow(ctx, id)
  await assertWardenOrStaff(ctx, before.hostelId)
  const row = await prisma.messMenu.update({ where: { id }, data: input.items !== undefined ? { items: input.items } : {} })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'messMenu', id, serializeMenu(before), serializeMenu(row))
  return row
}

export async function removeMenu(ctx: Ctx, id: string) {
  const before = await getMenuRow(ctx, id)
  await assertWardenOrStaff(ctx, before.hostelId)
  await prisma.messMenu.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'messMenu', id, serializeMenu(before))
}

// ───────────────────────────── meal feedback ─────────────────────────────

export const serializeFeedback = (f: MealFeedback) => ({
  id: f.id,
  menuId: f.menuId,
  studentId: f.studentId,
  rating: f.rating,
  comment: f.comment ?? undefined,
  createdAt: f.createdAt.toISOString(),
})

// POST /meal-feedback — student (self) or parent (ward); upserts one rating per (menu, student).
export async function createFeedbackSvc(ctx: Ctx, input: z.infer<typeof createFeedback>) {
  if (ctx.role === 'student') {
    if (input.studentId !== ctx.actorId) throw new HttpError(403, 'You can only submit feedback for yourself')
  } else if (ctx.role === 'parent') {
    if (!(await isGuardianOf(ctx, input.studentId))) throw new HttpError(403, 'That student is not your ward')
  } else {
    throw new HttpError(403, 'Only a student or parent may submit meal feedback')
  }
  const menu = await prisma.messMenu.findFirst({ where: { id: input.menuId, schoolId: ctx.schoolId } })
  if (!menu) throw notFound('Menu')
  const key = { menuId_studentId: { menuId: input.menuId, studentId: input.studentId } }
  const before = await prisma.mealFeedback.findUnique({ where: key })
  const row = await prisma.mealFeedback.upsert({
    where: key,
    create: { schoolId: ctx.schoolId, menuId: input.menuId, studentId: input.studentId, rating: input.rating, comment: input.comment ?? null },
    update: { rating: input.rating, comment: input.comment === undefined ? undefined : input.comment },
  })
  await audit(ctx.schoolId, ctx.actorId, before ? 'update' : 'create', 'mealFeedback', row.id, before ? serializeFeedback(before) : undefined, serializeFeedback(row))
  return { row, created: !before }
}

// GET /meal-feedback — warden/staff/admin read/aggregate (any, or scoped to their hostel for a teacher
// warden); student/parent read their own/ward's feedback. `?menuId=` also returns an `avgRating`/`count`
// aggregate for staff/admin/warden callers (cheap to compute alongside the list, avoids a second round trip).
export async function listFeedback(ctx: Ctx, q: z.infer<typeof feedbackQuery>) {
  if (isStaff(ctx) || ctx.role === 'teacher') {
    if (ctx.role === 'teacher' && q.hostelId) await assertWardenOrStaff(ctx, q.hostelId)
    const rows = await prisma.mealFeedback.findMany({
      where: { schoolId: ctx.schoolId, menuId: q.menuId, studentId: q.studentId, ...(q.hostelId ? { menu: { hostelId: q.hostelId } } : {}) },
      orderBy: [{ createdAt: 'desc' }],
    })
    let summary: { count: number; avgRating: number | null } | undefined
    if (q.menuId) {
      const agg = await prisma.mealFeedback.aggregate({ where: { menuId: q.menuId }, _avg: { rating: true }, _count: { _all: true } })
      summary = { count: agg._count._all, avgRating: agg._avg.rating !== null ? Math.round(agg._avg.rating * 10) / 10 : null }
    }
    return { items: rows.map(serializeFeedback), summary }
  }
  if (ctx.role === 'student' || ctx.role === 'parent') {
    const ids = (await visibleStudentIds(ctx))!
    if (q.studentId && !ids.includes(q.studentId)) throw new HttpError(403, ctx.role === 'parent' ? 'That student is not your ward' : 'You can only view your own feedback')
    const studentIds = q.studentId ? [q.studentId] : ids
    const rows = await prisma.mealFeedback.findMany({ where: { schoolId: ctx.schoolId, studentId: { in: studentIds }, menuId: q.menuId }, orderBy: [{ createdAt: 'desc' }] })
    return { items: rows.map(serializeFeedback) }
  }
  throw new HttpError(403, 'Forbidden')
}
