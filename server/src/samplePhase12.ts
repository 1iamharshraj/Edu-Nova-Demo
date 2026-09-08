import type { Prisma } from '@prisma/client'
import { toDate, fmtDate } from './lib/validate'

// Phase 12 demo data (routes/stops, vehicles, student stop assignments, a couple of recent location
// pings). Runs inside the same transaction as loadSampleData, after users/enrollments already exist. See
// phase-12-transport.md → sample-data notes.

type Tx = Prisma.TransactionClient

export interface Phase12Args {
  schoolId: string
  userId: (seedId: string) => string
}

export async function loadPhase12(tx: Tx, a: Phase12Args) {
  const { schoolId } = a
  const uid = a.userId

  // ── Route 1: "North Loop" — Aarav (u-s), Diya (u-s2) ride this one. ──
  const north = await tx.route.create({ data: { schoolId, name: 'North Loop', description: 'Covers the northern residential blocks, arrives via the ring road.' } })
  const northStops = await Promise.all([
    tx.stop.create({ data: { schoolId, routeId: north.id, name: 'Lakeview Gardens', sequence: 1, latitude: 12.9784, longitude: 77.6408, arrivalOffsetMin: 0 } }),
    tx.stop.create({ data: { schoolId, routeId: north.id, name: 'Cedar Heights', sequence: 2, latitude: 12.9821, longitude: 77.6355, arrivalOffsetMin: 8 } }),
    tx.stop.create({ data: { schoolId, routeId: north.id, name: 'Maple Cross', sequence: 3, latitude: 12.9863, longitude: 77.6291, arrivalOffsetMin: 17 } }),
    tx.stop.create({ data: { schoolId, routeId: north.id, name: 'School Gate', sequence: 4, latitude: 12.9902, longitude: 77.6221, arrivalOffsetMin: 28 } }),
  ])

  // ── Route 2: "South Circuit" — Kabir (u-s3), Rohan (u-s4) ride this one. ──
  const south = await tx.route.create({ data: { schoolId, name: 'South Circuit', description: 'Covers the southern apartment complexes and the market road.' } })
  const southStops = await Promise.all([
    tx.stop.create({ data: { schoolId, routeId: south.id, name: 'Palm Residency', sequence: 1, latitude: 12.9498, longitude: 77.6112, arrivalOffsetMin: 0 } }),
    tx.stop.create({ data: { schoolId, routeId: south.id, name: 'Silver Oak Apartments', sequence: 2, latitude: 12.9556, longitude: 77.6154, arrivalOffsetMin: 9 } }),
    tx.stop.create({ data: { schoolId, routeId: south.id, name: 'Market Junction', sequence: 3, latitude: 12.9634, longitude: 77.6188, arrivalOffsetMin: 19 } }),
    tx.stop.create({ data: { schoolId, routeId: south.id, name: 'School Gate (South)', sequence: 4, latitude: 12.9902, longitude: 77.6221, arrivalOffsetMin: 32 } }),
  ])

  // ── Vehicles: one per route. ──
  const bus1 = await tx.vehicle.create({
    data: {
      schoolId, registrationNo: 'KA-01-AB-1234', capacity: 40, routeId: north.id,
      driverName: 'Suresh Babu', driverPhone: '+91 98450 11223',
      conductorName: 'Manjunath K', conductorPhone: '+91 98450 11224',
    },
  })
  const bus2 = await tx.vehicle.create({
    data: {
      schoolId, registrationNo: 'KA-01-CD-5678', capacity: 32, routeId: south.id,
      driverName: 'Ravi Shankar', driverPhone: '+91 98450 22334',
      // Conductor intentionally omitted here — demonstrates the optional fields.
    },
  })

  // ── Student stop assignments — one seed student per stop, "Both" (pickup and drop). ──
  await tx.studentStopAssignment.create({ data: { schoolId, studentId: uid('u-s'), stopId: northStops[0].id, boardingType: 'Both' } })
  await tx.studentStopAssignment.create({ data: { schoolId, studentId: uid('u-s2'), stopId: northStops[1].id, boardingType: 'Both' } })
  await tx.studentStopAssignment.create({ data: { schoolId, studentId: uid('u-s3'), stopId: southStops[0].id, boardingType: 'Both' } })
  await tx.studentStopAssignment.create({ data: { schoolId, studentId: uid('u-s4'), stopId: southStops[1].id, boardingType: 'Both' } })

  // ── A couple of recent location pings so the parent-facing "My Bus" view has something live to show.
  // Timestamps are relative to "now" (load time), not a fixed date, since only pings recorded within the
  // last ~30 minutes should read as "currently tracked" — see phase-12-transport.md's frontend note. ──
  const now = new Date()
  // UTC "today", matching the codebase's dateStr/toDate/fmtDate convention (see lib/validate.ts) — a
  // plain `new Date(y, m, d)` would use the server's local timezone and could land on the wrong UTC date.
  const today = toDate(fmtDate(now))
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000)
  await tx.vehicleLocation.create({ data: { schoolId, vehicleId: bus1.id, latitude: 12.9821, longitude: 77.6355, recordedAt: minutesAgo(12), tripDate: today } })
  await tx.vehicleLocation.create({ data: { schoolId, vehicleId: bus1.id, latitude: 12.9784, longitude: 77.6408, recordedAt: minutesAgo(25), tripDate: today } })
  await tx.vehicleLocation.create({ data: { schoolId, vehicleId: bus2.id, latitude: 12.9556, longitude: 77.6154, recordedAt: minutesAgo(6), tripDate: today } })
}
