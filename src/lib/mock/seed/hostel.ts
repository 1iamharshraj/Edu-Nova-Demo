// Seed fragment for Phase 14 (Hostel/Room/Bed/Allocation) + Phase 24 (Outpass/RollCall/MessMenu/
// MealFeedback). Extends seed/core.ts's School/User rows — see seed/index.ts for registration order.
// Two hostels (boys/girls), each with two rooms of 4 beds, a few active allocations against the demo
// students, one pending + one approved outpass, today's roll-call, a week of mess menus, and a feedback
// row — enough for every screen in src/portal/modules/hostel.tsx + hostelExtras.tsx to render real data.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'
import { addSeedFragment } from './index'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const dateDaysAgo = (n: number) => daysAgo(n).slice(0, 10)
const isoDate = (d: Date) => d.toISOString().slice(0, 10)
const today = new Date()
const todayStr = isoDate(today)

function bedIds(roomId: string, labels: string[]) {
  return labels.map(l => `hbed-${roomId}-${l}`)
}

export function seedHostel(db: Collections) {
  db.Hostel = [
    { id: 'hostel-boys', schoolId: SCHOOL_ID, name: 'Vivekananda Bhavan (Boys)', type: 'Boys', wardenUserId: 'u-t6', address: 'North Campus, EduNova Public School', createdAt: '2024-06-01T00:00:00.000Z' },
    { id: 'hostel-girls', schoolId: SCHOOL_ID, name: 'Sarojini Bhavan (Girls)', type: 'Girls', wardenUserId: 'u-t3', address: 'South Campus, EduNova Public School', createdAt: '2024-06-01T00:00:00.000Z' },
  ].map(r => r as Row)

  db.HostelRoom = [
    { id: 'hroom-b1', schoolId: SCHOOL_ID, hostelId: 'hostel-boys', roomNumber: 'B-101', floor: '1', capacity: 4, roomType: 'Quad', createdAt: '2024-06-01T00:00:00.000Z' },
    { id: 'hroom-b2', schoolId: SCHOOL_ID, hostelId: 'hostel-boys', roomNumber: 'B-102', floor: '1', capacity: 4, roomType: 'Quad', createdAt: '2024-06-01T00:00:00.000Z' },
    { id: 'hroom-g1', schoolId: SCHOOL_ID, hostelId: 'hostel-girls', roomNumber: 'G-101', floor: '1', capacity: 4, roomType: 'Quad', createdAt: '2024-06-01T00:00:00.000Z' },
    { id: 'hroom-g2', schoolId: SCHOOL_ID, hostelId: 'hostel-girls', roomNumber: 'G-102', floor: '1', capacity: 4, roomType: 'Quad', createdAt: '2024-06-01T00:00:00.000Z' },
  ].map(r => r as Row)

  const beds: Row[] = []
  for (const roomId of ['hroom-b1', 'hroom-b2', 'hroom-g1', 'hroom-g2']) {
    for (const label of ['1', '2', '3', '4']) {
      beds.push({ id: `hbed-${roomId}-${label}`, schoolId: SCHOOL_ID, roomId, bedLabel: label, createdAt: '2024-06-01T00:00:00.000Z' } as Row)
    }
  }
  db.HostelBed = beds

  // u-s3 (Karthik Reddy, class X-B) and u-s4 (Divya Sharma, class IX-A) are the demo boarders — real
  // schools mostly have day scholars, so only a couple of the seed students board.
  db.HostelAllocation = [
    { id: 'halloc-1', schoolId: SCHOOL_ID, studentId: 'u-s3', bedId: bedIds('hroom-b1', ['1'])[0], checkInDate: '2025-04-02', checkOutDate: undefined, status: 'Active', allocatedById: 'u-st', notes: null, createdAt: '2025-04-02T00:00:00.000Z' },
    { id: 'halloc-2', schoolId: SCHOOL_ID, studentId: 'u-s4', bedId: bedIds('hroom-g1', ['1'])[0], checkInDate: '2025-04-02', checkOutDate: undefined, status: 'Active', allocatedById: 'u-st', notes: null, createdAt: '2025-04-02T00:00:00.000Z' },
  ].map(r => r as Row)

  db.HostelOutpass = [
    { id: 'outpass-1', schoolId: SCHOOL_ID, studentId: 'u-s3', hostelId: 'hostel-boys', requestedById: 'u-s3', requestedDepartureAt: daysAgo(-2), expectedReturnAt: daysAgo(-2.5), reason: 'Family function at home', destination: 'Hyderabad', status: 'Pending', createdAt: daysAgo(1) },
    { id: 'outpass-2', schoolId: SCHOOL_ID, studentId: 'u-s4', hostelId: 'hostel-girls', requestedById: 'u-p', requestedDepartureAt: daysAgo(3), expectedReturnAt: daysAgo(2), reason: 'Dental appointment', destination: 'City Hospital', status: 'Approved', approvedByWardenId: 'u-t3', approvedAt: daysAgo(4), createdAt: daysAgo(5) },
  ].map(r => r as Row)

  db.HostelRollCall = [
    { id: 'rollcall-boys-today', schoolId: SCHOOL_ID, hostelId: 'hostel-boys', date: todayStr, recordedById: 'u-t6', createdAt: daysAgo(0) },
  ].map(r => r as Row)
  db.HostelRollCallEntry = [
    { id: 'rcentry-1', rollCallId: 'rollcall-boys-today', allocationId: 'halloc-1', present: true, notes: null },
  ].map(r => r as Row)

  const menuItems: Record<string, string[]> = {
    Breakfast: ['Idli', 'Sambar', 'Coconut chutney', 'Milk'],
    Lunch: ['Rice', 'Dal fry', 'Mixed vegetable curry', 'Curd', 'Papad'],
    Snacks: ['Vegetable cutlet', 'Tea/Milk'],
    Dinner: ['Chapati', 'Paneer butter masala', 'Jeera rice', 'Salad'],
  }
  const menus: Row[] = []
  const feedback: Row[] = []
  for (const hostelId of ['hostel-boys', 'hostel-girls']) {
    for (let d = 0; d < 7; d++) {
      const date = isoDate(new Date(today.getTime() - d * 86_400_000))
      for (const mealType of ['Breakfast', 'Lunch', 'Snacks', 'Dinner']) {
        const id = `menu-${hostelId}-${date}-${mealType}`
        menus.push({ id, schoolId: SCHOOL_ID, hostelId, date, mealType, items: menuItems[mealType], createdById: hostelId === 'hostel-boys' ? 'u-t6' : 'u-t3', createdAt: `${dateDaysAgo(d)}T06:00:00.000Z` } as Row)
      }
    }
  }
  feedback.push({ id: 'feedback-1', schoolId: SCHOOL_ID, menuId: `menu-hostel-boys-${dateDaysAgo(1)}-Lunch`, studentId: 'u-s3', rating: 4, comment: 'Tasty, but could use less oil.', createdAt: daysAgo(1) } as Row)
  db.MessMenu = menus
  db.MealFeedback = feedback
}

addSeedFragment(seedHostel)
