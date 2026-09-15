import type { Prisma } from '@prisma/client'
import { toDate } from './lib/validate'

// Phase 13 sample data: a handful of alumni profiles (two linked to existing sample students, two
// standalone historical records), one alumni event with RSVPs, and a couple of donations. Runs inside
// the same transaction as loadSampleData, after users/enrollments already exist. See
// phase-13-alumni.md — sample-data section.
//
// The two "linked" profiles (Kabir Singh, Rohan Gupta) deliberately do NOT end those students' active
// Enrollment rows the way the real POST /alumni/convert-student endpoint would — several other sample
// phases (attendance, marks, board registration, fees) already depend on those two accounts having a
// normal active enrollment, and touching that here would ripple into unrelated demo data. This is a
// seed-data simplification only; the real conversion flow (modules/alumni/service.ts#convertStudent)
// does end the enrollment. Treat these two as "we also keep an alumni record for them" rather than "they
// have left" — the standalone records below are the more representative example of an actual alumnus.

type Tx = Prisma.TransactionClient

export interface Phase13Args {
  schoolId: string
  userId: (seedId: string) => string
}

export async function loadPhase13(tx: Tx, a: Phase13Args) {
  const { schoolId } = a
  const admin = a.userId('u-a')

  // ── two standalone historical alumni (never seed Users — purely AlumniProfile rows) ──
  const ananya = await tx.alumniProfile.create({
    data: {
      schoolId, name: 'Ananya Rao', email: 'ananya.rao.alum@example.com', phone: '+91 98450 22110',
      graduationYear: 2015, lastClassLabel: 'XII-A CBSE', currentOccupation: 'Software Engineer', currentOrganization: 'Zeta Systems',
      currentCity: 'Bengaluru', linkedInUrl: 'https://www.linkedin.com/in/ananya-rao-example', notes: 'School head girl, 2014-15. Keeps in touch for the annual coding workshop.',
      convertedById: admin, convertedAt: toDate('2015-04-20'), createdAt: toDate('2015-04-20'),
    },
  })
  const vikram = await tx.alumniProfile.create({
    data: {
      schoolId, name: 'Vikram Nair', email: 'vikram.nair.alum@example.com', phone: '+91 98450 33221',
      graduationYear: 2010, lastClassLabel: 'XII-B CBSE', currentOccupation: 'Pediatrician', currentOrganization: 'City General Hospital',
      currentCity: 'Kochi', notes: 'Occasional guest speaker for the Class XII careers session.',
      convertedById: admin, convertedAt: toDate('2010-04-15'), createdAt: toDate('2010-04-15'),
    },
  })

  // ── two profiles linked back to existing sample students (see file header note) ──
  const kabir = await tx.alumniProfile.create({
    data: {
      schoolId, studentUserId: a.userId('u-s3'), name: 'Kabir Singh', email: 'kabir.s@edkonic.in', phone: null,
      graduationYear: 2026, lastClassLabel: 'X-B CBSE', currentOccupation: 'Student (continuing to XI elsewhere)', currentCity: 'Chennai',
      convertedById: admin, convertedAt: toDate('2026-04-01'), createdAt: toDate('2026-04-01'),
    },
  })
  const rohan = await tx.alumniProfile.create({
    data: {
      schoolId, studentUserId: a.userId('u-s4'), name: 'Rohan Gupta', email: 'rohan.g@edkonic.in', phone: null,
      graduationYear: 2026, lastClassLabel: 'X-B CBSE', currentOccupation: 'Student (continuing to XI elsewhere)', currentCity: 'Chennai',
      convertedById: admin, convertedAt: toDate('2026-04-02'), createdAt: toDate('2026-04-02'),
    },
  })

  // ── one alumni event with a couple of RSVPs ──
  const event = await tx.alumniEvent.create({
    data: {
      schoolId, title: 'Alumni Meet 2026', description: 'Annual get-together — campus tour, dinner, and a panel with recent graduates.',
      date: toDate('2026-12-20'), location: 'School Auditorium', createdById: admin, createdAt: toDate('2026-09-01'),
    },
  })
  await tx.alumniEventRsvp.create({ data: { eventId: event.id, alumniId: ananya.id, status: 'Going', respondedAt: toDate('2026-09-03') } })
  await tx.alumniEventRsvp.create({ data: { eventId: event.id, alumniId: vikram.id, status: 'Interested', respondedAt: toDate('2026-09-04') } })
  await tx.alumniEventRsvp.create({ data: { eventId: event.id, alumniId: kabir.id, status: 'Declined', respondedAt: toDate('2026-09-05') } })

  // ── a couple of manually-recorded donations ──
  await tx.alumniDonation.create({
    data: { schoolId, alumniId: ananya.id, amount: 15000, purpose: 'Library fund', note: 'NEFT transfer, receipt filed with accounts.', recordedById: admin, donatedAt: toDate('2026-06-10'), createdAt: toDate('2026-06-10') },
  })
  await tx.alumniDonation.create({
    data: { schoolId, alumniId: vikram.id, amount: 5000, purpose: 'Sports day sponsorship', recordedById: admin, donatedAt: toDate('2026-07-22'), createdAt: toDate('2026-07-22') },
  })
  await tx.alumniDonation.create({
    data: { schoolId, alumniId: rohan.id, amount: 2000, purpose: 'General fund', note: 'Cash, collected at the Class X farewell.', recordedById: admin, donatedAt: toDate('2026-04-05'), createdAt: toDate('2026-04-05') },
  })
}
