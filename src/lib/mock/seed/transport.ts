// Seed fragment for Phase 12: transport routes/stops, vehicles, student↔stop assignments, and one
// vehicle-location ping (so the live-tracking cards on src/portal/modules/transport.tsx and the parent's
// "my stop" card have something to show without needing the future driver app to have pinged anything).
// Extends seed/core.ts's School/User rows — see seed/index.ts for registration order.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'
import { addSeedFragment } from './index'

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

export function seedTransport(db: Collections) {
  db.Route = [
    { id: 'route-1', schoolId: SCHOOL_ID, name: 'Route 1 — MG Road', description: 'MG Road ⟶ Anna Nagar ⟶ School', createdAt: '2024-06-01T00:00:00.000Z' },
    { id: 'route-2', schoolId: SCHOOL_ID, name: 'Route 2 — Velachery', description: 'Velachery ⟶ Guindy ⟶ School', createdAt: '2024-06-01T00:00:00.000Z' },
  ].map(r => r as Row)

  db.Stop = [
    { id: 'stop-1a', schoolId: SCHOOL_ID, routeId: 'route-1', name: 'MG Road Signal', sequence: 1, latitude: 13.0604, longitude: 80.2496, arrivalOffsetMin: 0, createdAt: '2024-06-01T00:00:00.000Z' },
    { id: 'stop-1b', schoolId: SCHOOL_ID, routeId: 'route-1', name: 'Anna Nagar Tower Park', sequence: 2, latitude: 13.0850, longitude: 80.2101, arrivalOffsetMin: 15, createdAt: '2024-06-01T00:00:00.000Z' },
    { id: 'stop-1c', schoolId: SCHOOL_ID, routeId: 'route-1', name: 'Koyambedu Market', sequence: 3, latitude: 13.0694, longitude: 80.1948, arrivalOffsetMin: 28, createdAt: '2024-06-01T00:00:00.000Z' },
    { id: 'stop-2a', schoolId: SCHOOL_ID, routeId: 'route-2', name: 'Velachery Main Road', sequence: 1, latitude: 12.9791, longitude: 80.2183, arrivalOffsetMin: 0, createdAt: '2024-06-01T00:00:00.000Z' },
    { id: 'stop-2b', schoolId: SCHOOL_ID, routeId: 'route-2', name: 'Guindy Railway Station', sequence: 2, latitude: 13.0067, longitude: 80.2206, arrivalOffsetMin: 18, createdAt: '2024-06-01T00:00:00.000Z' },
  ].map(r => r as Row)

  db.Vehicle = [
    { id: 'vehicle-1', schoolId: SCHOOL_ID, registrationNo: 'TN-07-AB-1234', capacity: 42, routeId: 'route-1', driverName: 'Murugan S.', driverPhone: '+91 98765 12001', conductorName: 'Ezhilarasan K.', conductorPhone: '+91 98765 12002', driverUserId: null, createdAt: '2024-06-01T00:00:00.000Z' },
    { id: 'vehicle-2', schoolId: SCHOOL_ID, registrationNo: 'TN-09-CD-5678', capacity: 36, routeId: 'route-2', driverName: 'Ramesh Babu', driverPhone: '+91 98765 12003', conductorName: 'Suresh Kumar', conductorPhone: '+91 98765 12004', driverUserId: null, createdAt: '2024-06-01T00:00:00.000Z' },
  ].map(r => r as Row)

  db.StudentStopAssignment = [
    { id: 'assign-1', schoolId: SCHOOL_ID, studentId: 'u-s1', stopId: 'stop-1b', boardingType: 'Both', createdAt: '2025-04-02T00:00:00.000Z' },
    { id: 'assign-2', schoolId: SCHOOL_ID, studentId: 'u-s2', stopId: 'stop-1a', boardingType: 'Both', createdAt: '2025-04-02T00:00:00.000Z' },
    { id: 'assign-3', schoolId: SCHOOL_ID, studentId: 'u-s3', stopId: 'stop-2a', boardingType: 'Pickup', createdAt: '2025-04-02T00:00:00.000Z' },
    { id: 'assign-4', schoolId: SCHOOL_ID, studentId: 'u-s4', stopId: 'stop-2b', boardingType: 'Both', createdAt: '2025-04-02T00:00:00.000Z' },
  ].map(r => r as Row)

  db.VehicleLocation = [
    { id: 'vloc-1', schoolId: SCHOOL_ID, vehicleId: 'vehicle-1', latitude: 13.0790, longitude: 80.2140, recordedAt: minutesAgo(6), tripDate: isoDate(new Date()) },
    { id: 'vloc-2', schoolId: SCHOOL_ID, vehicleId: 'vehicle-2', latitude: 12.9950, longitude: 80.2190, recordedAt: minutesAgo(12), tripDate: isoDate(new Date()) },
  ].map(r => r as Row)
}

addSeedFragment(seedTransport)
