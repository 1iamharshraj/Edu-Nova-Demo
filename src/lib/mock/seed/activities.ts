// Seed fragment for Phase 8's Activities surface (clubs/EXC/events/faculty programmes — see
// phase-8-welfare.md and src/lib/hooks/useWelfare.ts). One activity per non-house `kind`, with real
// seats/waitlist math baked into the registrations below (Robotics Club is deliberately over-subscribed at
// capacity 2 so the "Full — waitlist" UI state and ActivityRegistrationsList both have something to show).
// `kind: 'house'` rows are deliberately NOT seeded here — the community/comms batch's seed/community.ts
// already seeded the four real houses (Aravali/Nilgiri/Shivalik/Vindhya) as Activity rows so the
// house-points leaderboard and the "Award points" house picker (`useActivities('house')` → this file's
// module's `GET /activities?kind=house`) have real data; adding another here would add a bogus 5th house
// with no point history to that picker/leaderboard. See .agents/edunova/static-demo-plan.md.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'
import { addSeedFragment } from './index'

export function seedActivities(db: Collections) {
  // Append, never overwrite — seed/community.ts's house Activity rows must survive regardless of
  // fragment run order (a prior bug here fully replaced db.Activity, silently wiping the houses
  // whenever this fragment ran after community's, breaking the House Leaderboard/points picker).
  db.Activity = [
    ...(db.Activity ?? []),
    {
      id: 'act-robotics', schoolId: SCHOOL_ID, kind: 'club', title: 'Robotics Club',
      description: 'Build and program line-following bots for the inter-school robotics meet. Meets Wednesdays, 4-5:30pm in the Computer Lab.',
      capacity: 2, opensAt: '2026-07-01T00:00:00.000Z', closesAt: '2026-12-15T00:00:00.000Z',
      forRoles: ['student'], createdById: 'u-st', trackCohortId: null, createdAt: '2026-07-01T09:00:00.000Z',
    } as Row,
    {
      id: 'act-football', schoolId: SCHOOL_ID, kind: 'exc', title: 'Weekend Football Coaching',
      description: 'Extra-curricular football coaching with the school\'s sports staff every Saturday morning.',
      capacity: 30, opensAt: '2026-08-01T00:00:00.000Z', closesAt: '2027-02-28T00:00:00.000Z',
      forRoles: ['student'], createdById: 'u-st', trackCohortId: null, createdAt: '2026-08-01T09:00:00.000Z',
    } as Row,
    {
      id: 'act-annual-day', schoolId: SCHOOL_ID, kind: 'event', title: 'Annual Day Cultural Fest',
      description: 'Sign up to perform, volunteer or help organize this year\'s Annual Day celebrations.',
      capacity: 150, opensAt: '2026-09-01T00:00:00.000Z', closesAt: '2026-11-20T00:00:00.000Z',
      forRoles: ['student', 'teacher', 'staff'], createdById: 'u-ad', trackCohortId: null, createdAt: '2026-09-01T09:00:00.000Z',
    } as Row,
    {
      id: 'act-staff-yoga', schoolId: SCHOOL_ID, kind: 'faculty', title: 'Staff Wellness Yoga',
      description: 'A weekly guided yoga session for teaching and non-teaching staff before the school day starts.',
      capacity: 25, opensAt: undefined, closesAt: undefined,
      forRoles: ['teacher', 'staff'], createdById: 'u-ad', trackCohortId: null, createdAt: '2026-06-01T09:00:00.000Z',
    } as Row,
  ]

  db.ActivityRegistration = [
    ...(db.ActivityRegistration ?? []),
    // Robotics Club — capacity 2, two Registered, one Waitlisted (demonstrates the waitlist UI + promotion-on-cancel flow).
    { id: 'actreg-1', schoolId: SCHOOL_ID, activityId: 'act-robotics', userId: 'u-s1', registeredAt: '2026-08-05T10:00:00.000Z', status: 'Registered' } as Row,
    { id: 'actreg-2', schoolId: SCHOOL_ID, activityId: 'act-robotics', userId: 'u-s3', registeredAt: '2026-08-06T11:00:00.000Z', status: 'Registered' } as Row,
    { id: 'actreg-3', schoolId: SCHOOL_ID, activityId: 'act-robotics', userId: 'u-s2', registeredAt: '2026-08-07T12:00:00.000Z', status: 'Waitlisted' } as Row,
    // Weekend football — a couple of takers.
    { id: 'actreg-6', schoolId: SCHOOL_ID, activityId: 'act-football', userId: 'u-s4', registeredAt: '2026-08-10T08:00:00.000Z', status: 'Registered' } as Row,
    // A cancelled registration, to exercise the "off waitlist" / re-register path.
    { id: 'actreg-7', schoolId: SCHOOL_ID, activityId: 'act-annual-day', userId: 'u-s2', registeredAt: '2026-09-02T09:00:00.000Z', status: 'Cancelled' } as Row,
  ]
}

addSeedFragment(seedActivities)
