import type { Prisma } from '@prisma/client'
import { toDate } from './lib/validate'

// Phase 14 demo data: one hostel with a few rooms of mixed capacity, beds fully generated, a handful of
// seed students allocated (one of them then transferred, to show the allocation history working), and a
// "Hostel" FeeHead to demonstrate the fee-head integration point through the existing, unmodified Fees
// module (see phase-14-hostel.md → Fee integration). Runs inside the same transaction as loadSampleData,
// after users/enrollments (and Phase 5's fee heads) already exist.

type Tx = Prisma.TransactionClient

export interface Phase14Args {
  schoolId: string
  userId: (seedId: string) => string
}

export async function loadPhase14(tx: Tx, a: Phase14Args) {
  const { schoolId } = a
  const uid = a.userId

  // ── "Hostel" fee head — only if Phase 5's fee-head seeding hasn't already created one (it hasn't
  // today, but this stays a defensive check-then-create rather than an unconditional create, matching
  // the spec's "seed one FeeHead named Hostel if one doesn't already exist"). ──
  const existingHead = await tx.feeHead.findFirst({ where: { schoolId, name: 'Hostel' } })
  if (!existingHead) {
    await tx.feeHead.create({ data: { schoolId, name: 'Hostel', isRecurring: true } })
  }

  // ── One hostel, three rooms of mixed capacity, beds auto-generated per room. ──
  const hostel = await tx.hostel.create({
    data: {
      schoolId,
      name: 'Sunrise Boys Hostel',
      type: 'Boys',
      wardenUserId: uid('u-st'), // Farhan Qureshi, Office Superintendent — doubles as warden in this demo.
      address: '12 Campus Road, behind the sports ground',
    },
  })

  const room101 = await tx.hostelRoom.create({ data: { schoolId, hostelId: hostel.id, roomNumber: '101', floor: '1', capacity: 4, roomType: 'Dorm' } })
  const room102 = await tx.hostelRoom.create({ data: { schoolId, hostelId: hostel.id, roomNumber: '102', floor: '1', capacity: 2, roomType: 'Double' } })
  const room201 = await tx.hostelRoom.create({ data: { schoolId, hostelId: hostel.id, roomNumber: '201', floor: '2', capacity: 1, roomType: 'Single' } })

  const bedsFor = async (roomId: string, labels: string[]) =>
    Promise.all(labels.map(bedLabel => tx.hostelBed.create({ data: { schoolId, roomId, bedLabel } })))

  const room101Beds = await bedsFor(room101.id, ['1', '2', '3', '4'])
  const room102Beds = await bedsFor(room102.id, ['A', 'B'])
  await bedsFor(room201.id, ['1']) // single room stays fully vacant in the seed — shows the "0/1" case.

  // ── Allocations: Aarav (u-s) and Kabir (u-s3) share the dorm; Rohan (u-s4) is transferred from the
  // dorm into the double room, so the seed also demonstrates a Transferred history row, not just Active
  // ones. Diya (u-s2) is left unallocated — a day scholar, and a clean "not allocated" case for the
  // student/parent "My Hostel" screen. ──
  const checkIn = toDate('2025-06-05')

  await tx.hostelAllocation.create({
    data: { schoolId, studentId: uid('u-s'), bedId: room101Beds[0].id, checkInDate: checkIn, status: 'Active', allocatedById: uid('u-st') },
  })
  await tx.hostelAllocation.create({
    data: { schoolId, studentId: uid('u-s3'), bedId: room101Beds[1].id, checkInDate: checkIn, status: 'Active', allocatedById: uid('u-st') },
  })

  // Rohan: allocated to the dorm first, then transferred to the double room a few weeks later — the old
  // row becomes `Transferred` (checkOutDate set), a fresh `Active` row lands on the new bed.
  const rohanOriginal = await tx.hostelAllocation.create({
    data: { schoolId, studentId: uid('u-s4'), bedId: room101Beds[2].id, checkInDate: checkIn, status: 'Transferred', checkOutDate: toDate('2025-06-20'), allocatedById: uid('u-st') },
  })
  await tx.hostelAllocation.create({
    data: { schoolId, studentId: uid('u-s4'), bedId: room102Beds[0].id, checkInDate: toDate('2025-06-20'), status: 'Active', allocatedById: uid('u-st'), notes: `Transferred from room ${room101.roomNumber} (was ${rohanOriginal.id.slice(0, 8)}…) — wanted fewer roommates.` },
  })
}
