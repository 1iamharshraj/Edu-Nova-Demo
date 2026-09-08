import type { Prisma } from '@prisma/client'

// Phase 8 demo data (health, permission slips, achievements, disciplinary cases, call log, activities).
// Runs inside the same transaction as loadSampleData, after users/classes/enrollments/guardians already
// exist. See phase-8-welfare.md → Sample data.
//
// Deviations from the legacy seed (documented):
//  - Slips carry no `classId` in the legacy shape — all three (p1–p3) are ported as school-wide
//    (classId: null). p3 ("Robotics Club — weekend bootcamp") was already `Approved`; seeded as a
//    SlipResponse for Aarav (u-s) by his parent Nisha (u-p). Because the legacy p3 has no verification
//    concept, and Phase 4 seeds Nisha as an *already-verified* parent (see samplePhase4.ts), the response
//    ports cleanly under the real `requiresVerifiedParent` rule with no extra deviation needed.
//  - `aiParentCalls` ac1 (Kabir Singh's fee call) ports to CallLog; ac2 (Scheduled, never happened) is
//    dropped — Phase 8 replaces the AI simulation with a log of calls that actually took place.
//  - `disciplinaryCases` dc1/dc2 port 1:1; `classId` is derived from each student's active enrollment.
//  - Activities are seeded from the legacy `RegistrationsMod` catalogue (ffcs → club, iha → house,
//    exc → exc, events → event, faculty → faculty), with a handful of registrations standing in for the
//    old per-user localStorage state.

type Tx = Prisma.TransactionClient

export interface Phase8Args {
  schoolId: string
  classIds: Map<string, string>
  userId: (seedId: string) => string
}

export async function loadPhase8(tx: Tx, a: Phase8Args) {
  const { schoolId } = a
  const uid = a.userId
  const cls = (label: string) => a.classIds.get(label)!

  // ── health records (for u-s / Aarav) ──
  await tx.healthRecord.create({
    data: {
      schoolId, studentId: uid('u-s'), kind: 'Vaccination', title: 'Vaccination record',
      detail: 'MMR + Td booster, verified by Dr. Kurian.', date: new Date('2025-07-11T00:00:00.000Z'),
      addedById: uid('u-p'), verifiedById: uid('u-a'), verifiedAt: new Date('2025-07-12T00:00:00.000Z'),
    },
  })
  await tx.healthRecord.create({
    data: {
      schoolId, studentId: uid('u-s'), kind: 'Allergy', title: 'Allergy declaration',
      detail: 'Mild peanut allergy — canteen informed.', date: new Date('2025-06-20T00:00:00.000Z'),
      addedById: uid('u-p'), verifiedById: uid('u-a'), verifiedAt: new Date('2025-06-21T00:00:00.000Z'),
    },
  })

  // ── permission slips (school-wide) — p3 already responded. classId: null (all classes) is staff/admin-
  // only under the create rule (see slips/service.ts), so all three are seeded as created by admin. ──
  await tx.permissionSlip.create({
    data: { id: 'p1', schoolId, title: 'Field trip — Science City', detail: 'One-day trip for Class X on 18 Apr. Bus departs 7:30 AM. ₹350 covers entry + lunch.', dueDate: new Date('2026-04-14T00:00:00.000Z'), classId: null, createdById: uid('u-a'), requiresVerifiedParent: true },
  })
  await tx.permissionSlip.create({
    data: { id: 'p2', schoolId, title: 'Inter-school football selections', detail: 'Evening practice till 6 PM on Tue/Thu for 4 weeks.', dueDate: new Date('2026-04-11T00:00:00.000Z'), classId: null, createdById: uid('u-a'), requiresVerifiedParent: true },
  })
  const p3 = await tx.permissionSlip.create({
    data: { id: 'p3', schoolId, title: 'Robotics Club — weekend bootcamp', detail: 'Two Saturdays, 9 AM – 1 PM, CS Lab.', dueDate: new Date('2026-03-30T00:00:00.000Z'), classId: null, createdById: uid('u-a'), requiresVerifiedParent: true },
  })
  await tx.slipResponse.create({ data: { slipId: p3.id, studentId: uid('u-s'), parentId: uid('u-p'), decision: 'Approved', respondedAt: new Date('2026-03-20T00:00:00.000Z') } })

  // ── achievements ──
  await tx.achievement.create({ data: { id: 'a1', schoolId, userId: uid('u-s'), title: 'Gold — State Math Olympiad', detail: 'Ranked 3rd across Kerala, senior category.', date: new Date('2026-01-19T00:00:00.000Z'), category: 'Academic', verifiedById: uid('u-t'), verifiedAt: new Date('2026-01-20T00:00:00.000Z') } })
  await tx.achievement.create({ data: { id: 'a2', schoolId, userId: uid('u-t'), title: 'Best Paper — NCERT Teaching Summit', detail: '“Gamified algebra for grade 10”.', date: new Date('2025-12-02T00:00:00.000Z'), category: 'Academic', verifiedById: uid('u-a'), verifiedAt: new Date('2025-12-03T00:00:00.000Z') } })
  await tx.achievement.create({ data: { id: 'a3', schoolId, userId: uid('u-s2'), title: 'Inter-school Debate Winner', detail: 'Represented EduNova at the state-level debate championship.', date: new Date('2025-11-15T00:00:00.000Z'), category: 'Arts' } })

  // ── disciplinary cases dc1 / dc2 (both X-B students) ──
  await tx.disciplinaryCase.create({
    data: {
      id: 'dc1', schoolId, studentId: uid('u-s4'), classId: cls('X-B'), title: 'Lab equipment misuse',
      description: 'Student used lab equipment without supervision and damaged a microscope slide.',
      reportedById: uid('u-t3'), witnesses: 'Ananya Iyer', status: 'Decision', hearingDate: new Date('2026-03-20T00:00:00.000Z'),
      decision: 'Student admitted mistake. Parent meeting required.', actionTaken: 'Parent Meeting', createdAt: new Date('2026-03-12T00:00:00.000Z'),
    },
  })
  await tx.disciplinaryNote.create({ data: { caseId: 'dc1', authorId: uid('u-t3'), body: 'Parent has been informed via message.', createdAt: new Date('2026-03-20T12:00:00.000Z') } })

  await tx.disciplinaryCase.create({
    data: {
      id: 'dc2', schoolId, studentId: uid('u-s3'), classId: cls('X-B'), title: 'Unauthorized mobile phone use',
      description: 'Mobile phone used during class hours despite school policy.', reportedById: uid('u-t4'),
      status: 'Closed', hearingDate: new Date('2026-02-18T00:00:00.000Z'), decision: 'Phone confiscated for one week; warning issued.',
      actionTaken: 'Warning', createdAt: new Date('2026-02-15T00:00:00.000Z'),
    },
  })
  await tx.disciplinaryNote.create({ data: { caseId: 'dc2', authorId: uid('u-t4'), body: 'Phone returned after one week.', createdAt: new Date('2026-02-22T00:00:00.000Z') } })

  // ── call log — ac1 (Kabir Singh's fee reminder call) ──
  await tx.callLog.create({
    data: {
      schoolId, studentId: uid('u-s3'), parentId: uid('u-p3'), byId: uid('u-st'), reason: 'fee',
      summary: 'Term 3 tuition and transport fee pending. Parent said they will pay by Monday.',
      outcome: 'confirmed', calledAt: new Date('2026-04-10T10:00:00.000Z'), durationMin: 2,
    },
  })

  // ── activities (from the legacy RegistrationsMod catalogue) ──
  const CATALOG: { kind: string; name: string; detail: string; forRoles: string[]; capacity?: number }[] = [
    { kind: 'club', name: 'Robotics Chapter', detail: 'Tue & Fri · CS Lab · 24 seats', forRoles: ['student'], capacity: 24 },
    { kind: 'club', name: 'Astronomy Club', detail: 'Wed · Observatory deck', forRoles: ['student'] },
    { kind: 'club', name: 'Debate Society', detail: 'Mon · Seminar Hall', forRoles: ['student'] },
    { kind: 'club', name: 'Photography Circle', detail: 'Thu · Media room', forRoles: ['student'] },
    { kind: 'house', name: 'Inter-house Basketball', detail: 'Trials 12 Apr · Main court', forRoles: ['student'] },
    { kind: 'house', name: 'Inter-house Quiz', detail: 'Prelims 15 Apr', forRoles: ['student'] },
    { kind: 'house', name: 'House Choir', detail: 'Auditions 9 Apr', forRoles: ['student'] },
    { kind: 'exc', name: 'Classical Dance', detail: 'Sat 9 AM · Arts block', forRoles: ['student'] },
    { kind: 'exc', name: 'Chess Coaching', detail: 'Sat 10 AM · Library annexe', forRoles: ['student'] },
    { kind: 'exc', name: 'Swimming', detail: 'Sun 7 AM · Aquatic centre', forRoles: ['student'] },
    { kind: 'event', name: 'Tech Fest ‘26', detail: '24 Apr · Senior block · team of 3', forRoles: ['student'] },
    { kind: 'event', name: 'Inter-school MUN', detail: '10 May · Kochi · delegate slots', forRoles: ['student'] },
    { kind: 'event', name: 'Art Exhibition “Chromatic”', detail: 'Open entries till 20 Apr', forRoles: ['student'] },
    { kind: 'faculty', name: 'Tech Fest ‘26 — Judges panel', detail: '24 Apr · Senior block', forRoles: ['teacher', 'staff'] },
    { kind: 'faculty', name: 'STEM Teaching Workshop', detail: '3 May · Kochi convention centre', forRoles: ['teacher', 'staff'] },
  ]
  const activityIds = new Map<string, string>()
  for (const c of CATALOG) {
    const row = await tx.activity.create({ data: { schoolId, kind: c.kind, title: c.name, description: c.detail, capacity: c.capacity, forRoles: c.forRoles, createdById: uid('u-a') } })
    activityIds.set(c.name, row.id)
  }
  const REGISTRATIONS: [string, string][] = [
    ['Robotics Chapter', 'u-s'], ['Robotics Chapter', 'u-s2'],
    ['Chess Coaching', 'u-s3'], ['Debate Society', 'u-s2'],
    ['Tech Fest ‘26 — Judges panel', 'u-t'], ['STEM Teaching Workshop', 'u-t3'],
  ]
  for (const [name, seedId] of REGISTRATIONS) {
    await tx.activityRegistration.create({ data: { activityId: activityIds.get(name)!, userId: uid(seedId), status: 'Registered' } })
  }
}
