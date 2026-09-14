// Seed fragment for the "Community & comms" batch: alumni (Phase 13), culture/house-points (Phase 27),
// canteen prepaid wallet (Phase 30), messages/notifications (Phase 7), performance reviews (Phase 11 → A3
// only — employment history/staff conduct/documents are a different batch), and AI tutor/teaching-tools
// history (Phase 9/20). Extends seedCore()'s School/User/Class/Enrollment/Guardian rows. Registers itself
// via `addSeedFragment` (see seed/index.ts) — src/lib/mock/index.ts imports this file once for that side
// effect, same pattern as seed/hr.ts.
//
// Also sets `reportsTo` on a few existing core-seeded User rows (u-t, u-t2, u-st → u-ad) purely so the
// performance-review "my direct reports" view has something to show — no other batch had touched that
// field yet.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'
import { addSeedFragment } from './index'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const dateDaysAgo = (n: number) => daysAgo(n).slice(0, 10)

function seedCommunity(db: Collections) {
  // ═══════════════════════════ reportsTo (needed by performance reviews) ═══════════════════════════
  if (db.User) {
    db.User = db.User.map(u => (['u-t', 'u-t2', 'u-st'].includes(u.id) ? { ...u, reportsTo: 'u-ad' } : u))
  }

  // ═══════════════════════════ Phase 13 — Alumni ═══════════════════════════

  db.AlumniProfile = [
    {
      id: 'al-1', schoolId: SCHOOL_ID, studentUserId: null, name: 'Rohit Malhotra', email: 'rohit.malhotra@gmail.com', phone: '9820011223',
      graduationYear: 2019, lastClassLabel: 'XII-A CBSE', currentOccupation: 'Software Engineer', currentOrganization: 'Infosys',
      currentCity: 'Bengaluru', linkedInUrl: 'https://linkedin.com/in/rohit-malhotra-example', notes: 'Very active in alumni events.',
      convertedAt: '2019-05-20T00:00:00.000Z', convertedById: 'u-ad', createdAt: '2019-05-20T00:00:00.000Z',
    },
    {
      id: 'al-2', schoolId: SCHOOL_ID, studentUserId: null, name: 'Sneha Kapoor', email: 'sneha.kapoor@gmail.com', phone: '9820011224',
      graduationYear: 2020, lastClassLabel: 'XII-B CBSE', currentOccupation: 'Doctor (MBBS)', currentOrganization: 'AIIMS Delhi',
      currentCity: 'New Delhi', linkedInUrl: 'https://linkedin.com/in/sneha-kapoor-example', notes: null,
      convertedAt: '2020-05-18T00:00:00.000Z', convertedById: 'u-ad', createdAt: '2020-05-18T00:00:00.000Z',
    },
    {
      id: 'al-3', schoolId: SCHOOL_ID, studentUserId: null, name: 'Aditya Bhatt', email: 'aditya.bhatt@gmail.com', phone: '9820011225',
      graduationYear: 2021, lastClassLabel: 'XII-A CBSE', currentOccupation: 'Chartered Accountant', currentOrganization: 'Deloitte India',
      currentCity: 'Mumbai', linkedInUrl: null, notes: 'Donated towards the sports scholarship fund.',
      convertedAt: '2021-05-22T00:00:00.000Z', convertedById: 'u-ad', createdAt: '2021-05-22T00:00:00.000Z',
    },
    {
      id: 'al-4', schoolId: SCHOOL_ID, studentUserId: null, name: 'Priyanka Nair', email: 'priyanka.nair@gmail.com', phone: '9820011226',
      graduationYear: 2022, lastClassLabel: 'XII-C State Board', currentOccupation: 'Student (B.Tech)', currentOrganization: 'IIT Bombay',
      currentCity: 'Mumbai', linkedInUrl: 'https://linkedin.com/in/priyanka-nair-example', notes: null,
      convertedAt: '2022-05-19T00:00:00.000Z', convertedById: 'u-ad', createdAt: '2022-05-19T00:00:00.000Z',
    },
    {
      id: 'al-5', schoolId: SCHOOL_ID, studentUserId: null, name: 'Karan Oberoi', email: 'karan.oberoi@gmail.com', phone: '9820011227',
      graduationYear: 2023, lastClassLabel: 'XII-B CBSE', currentOccupation: 'Entrepreneur', currentOrganization: 'Own Startup — Oberoi Foods',
      currentCity: 'Pune', linkedInUrl: null, notes: null,
      convertedAt: '2023-05-21T00:00:00.000Z', convertedById: 'u-ad', createdAt: '2023-05-21T00:00:00.000Z',
    },
  ].map(r => r as Row)

  db.AlumniEvent = [
    { id: 'alev-1', schoolId: SCHOOL_ID, title: 'Alumni Meet 2026', description: 'Annual get-together for all EduNova alumni batches.', date: '2026-01-18', location: 'School Main Hall', createdById: 'u-ad', createdAt: '2025-11-01T00:00:00.000Z' },
    { id: 'alev-2', schoolId: SCHOOL_ID, title: 'Career Mentorship Webinar', description: 'Alumni share career guidance with senior students.', date: '2026-02-10', location: 'Online (Zoom)', createdById: 'u-t2', createdAt: '2025-12-10T00:00:00.000Z' },
    { id: 'alev-3', schoolId: SCHOOL_ID, title: 'Founders Day Reunion — Class of 2020', description: 'A special reunion for the 2020 graduating batch.', date: '2025-12-20', location: 'School Grounds', createdById: 'u-ad', createdAt: '2025-10-15T00:00:00.000Z' },
  ].map(r => r as Row)

  db.AlumniEventRsvp = [
    { id: 'alrsvp-1', eventId: 'alev-1', alumniId: 'al-1', status: 'Going', respondedAt: '2025-12-01T10:00:00.000Z' },
    { id: 'alrsvp-2', eventId: 'alev-1', alumniId: 'al-2', status: 'Interested', respondedAt: '2025-12-02T09:00:00.000Z' },
    { id: 'alrsvp-3', eventId: 'alev-1', alumniId: 'al-3', status: 'Going', respondedAt: '2025-12-03T11:00:00.000Z' },
    { id: 'alrsvp-4', eventId: 'alev-3', alumniId: 'al-2', status: 'Going', respondedAt: '2025-11-02T09:00:00.000Z' },
    { id: 'alrsvp-5', eventId: 'alev-2', alumniId: 'al-4', status: 'Interested', respondedAt: '2025-12-20T09:00:00.000Z' },
  ].map(r => r as Row)

  db.AlumniDonation = [
    { id: 'aldon-1', schoolId: SCHOOL_ID, alumniId: 'al-1', amount: 25000, purpose: 'Library renovation fund', donatedAt: '2025-08-15', note: null, recordedById: 'u-ad', createdAt: '2025-08-15T00:00:00.000Z' },
    { id: 'aldon-2', schoolId: SCHOOL_ID, alumniId: 'al-3', amount: 15000, purpose: 'Sports scholarship', donatedAt: '2025-09-10', note: 'Annual pledge.', recordedById: 'u-ad', createdAt: '2025-09-10T00:00:00.000Z' },
    { id: 'aldon-3', schoolId: SCHOOL_ID, alumniId: 'al-2', amount: 5000, purpose: 'General fund', donatedAt: '2025-10-01', note: null, recordedById: 'u-ad', createdAt: '2025-10-01T00:00:00.000Z' },
  ].map(r => r as Row)

  // ═══════════════════════════ Phase 27 — Culture: houses + points ═══════════════════════════
  // "House" is just an Activity row with kind='house' (no dedicated House model in the real schema
  // either). The `activities` module itself is a different, not-yet-built batch — these four rows are
  // just enough Activity data for the house-points leaderboard/ledger to have something real to sum.

  db.Activity = [
    ...(db.Activity ?? []),
    { id: 'house-aravali', schoolId: SCHOOL_ID, kind: 'house', title: 'Aravali House', description: 'Red house — grit and endurance.', forRoles: [], createdById: 'u-ad', createdAt: '2025-04-01T00:00:00.000Z' },
    { id: 'house-nilgiri', schoolId: SCHOOL_ID, kind: 'house', title: 'Nilgiri House', description: 'Blue house — teamwork and calm.', forRoles: [], createdById: 'u-ad', createdAt: '2025-04-01T00:00:00.000Z' },
    { id: 'house-shivalik', schoolId: SCHOOL_ID, kind: 'house', title: 'Shivalik House', description: 'Green house — growth and discipline.', forRoles: [], createdById: 'u-ad', createdAt: '2025-04-01T00:00:00.000Z' },
    { id: 'house-vindhya', schoolId: SCHOOL_ID, kind: 'house', title: 'Vindhya House', description: 'Yellow house — energy and spirit.', forRoles: [], createdById: 'u-ad', createdAt: '2025-04-01T00:00:00.000Z' },
  ].map(r => r as Row)

  db.HousePoints = [
    { id: 'hp-1', schoolId: SCHOOL_ID, houseActivityId: 'house-aravali', points: 40, reason: 'Won the inter-house athletics relay', awardedById: 'u-t4', awardedAt: '2025-12-05T10:00:00.000Z', sourceType: 'Sports', sourceRefId: null },
    { id: 'hp-2', schoolId: SCHOOL_ID, houseActivityId: 'house-nilgiri', points: 25, reason: 'First place in inter-house quiz', awardedById: 'u-t2', awardedAt: '2025-12-08T10:00:00.000Z', sourceType: 'Academic', sourceRefId: null },
    { id: 'hp-3', schoolId: SCHOOL_ID, houseActivityId: 'house-shivalik', points: 15, reason: 'Best display at the annual exhibition', awardedById: 'u-t3', awardedAt: '2025-12-10T10:00:00.000Z', sourceType: 'Event', sourceRefId: null },
    { id: 'hp-4', schoolId: SCHOOL_ID, houseActivityId: 'house-vindhya', points: 20, reason: 'Cleanest classrooms this month', awardedById: 'u-ad', awardedAt: '2025-12-12T10:00:00.000Z', sourceType: 'Manual', sourceRefId: null },
    { id: 'hp-5', schoolId: SCHOOL_ID, houseActivityId: 'house-aravali', points: -10, reason: 'Late return from lunch break, twice', awardedById: 'u-ad', awardedAt: '2025-12-15T10:00:00.000Z', sourceType: 'Discipline', sourceRefId: null },
    { id: 'hp-6', schoolId: SCHOOL_ID, houseActivityId: 'house-nilgiri', points: 30, reason: 'Runners-up, inter-house basketball', awardedById: 'u-t4', awardedAt: '2025-12-18T10:00:00.000Z', sourceType: 'Sports', sourceRefId: null },
    { id: 'hp-7', schoolId: SCHOOL_ID, houseActivityId: 'house-shivalik', points: 35, reason: 'Won the inter-house debate competition', awardedById: 'u-t2', awardedAt: '2025-12-22T10:00:00.000Z', sourceType: 'Academic', sourceRefId: null },
    { id: 'hp-8', schoolId: SCHOOL_ID, houseActivityId: 'house-vindhya', points: 18, reason: 'Best participation, Republic Day rehearsal', awardedById: 'u-ad', awardedAt: '2026-01-10T10:00:00.000Z', sourceType: 'Event', sourceRefId: null },
    { id: 'hp-9', schoolId: SCHOOL_ID, houseActivityId: 'house-aravali', points: 22, reason: 'Won the inter-house singing competition', awardedById: 'u-t3', awardedAt: '2026-01-15T10:00:00.000Z', sourceType: 'Academic', sourceRefId: null },
  ].map(r => r as Row)

  // ═══════════════════════════ Phase 30 — Canteen prepaid wallet ═══════════════════════════
  // Amounts are RUPEES directly (this mock never converts to paise — see modules/canteen.ts's header
  // note). Seeded for u-s1 (Ravi Kumar) only; every other student's wallet is lazily created on first
  // top-up/purchase, same as the real backend.

  db.StudentWallet = [
    { id: 'wallet-s1', schoolId: SCHOOL_ID, studentId: 'u-s1', balance: 495, createdAt: dateDaysAgo(6) + 'T09:00:00.000Z', updatedAt: dateDaysAgo(2) + 'T13:00:00.000Z' },
  ].map(r => r as Row)

  db.WalletTransaction = [
    { id: 'wtx-1', schoolId: SCHOOL_ID, walletId: 'wallet-s1', type: 'TopUp', amount: 500, reason: 'Top-up via UPI', itemsSummary: null, recordedById: 'u-p', occurredAt: daysAgo(6) },
    { id: 'wtx-2', schoolId: SCHOOL_ID, walletId: 'wallet-s1', type: 'Purchase', amount: -95, reason: null, itemsSummary: '2x Samosa, 1x Juice', recordedById: 'u-st', occurredAt: daysAgo(5) },
    { id: 'wtx-3', schoolId: SCHOOL_ID, walletId: 'wallet-s1', type: 'Purchase', amount: -60, reason: null, itemsSummary: '1x Sandwich', recordedById: 'u-st', occurredAt: daysAgo(3) },
    { id: 'wtx-4', schoolId: SCHOOL_ID, walletId: 'wallet-s1', type: 'TopUp', amount: 150, reason: 'Top-up via Cash', itemsSummary: null, recordedById: 'u-st', occurredAt: daysAgo(2) },
  ].map(r => r as Row)

  // ═══════════════════════════ Phase 7 — Messages + notifications ═══════════════════════════

  db.Conversation = [
    { id: 'conv-1', schoolId: SCHOOL_ID, kind: 'DM', title: null, classId: null, createdById: 'u-t', createdAt: daysAgo(4) },
    { id: 'conv-2', schoolId: SCHOOL_ID, kind: 'Group', title: 'X-A class group', classId: 'class-10a', createdById: 'u-t', createdAt: daysAgo(10) },
  ].map(r => r as Row)

  db.Participant = [
    { id: 'part-1a', conversationId: 'conv-1', userId: 'u-t', lastReadAt: daysAgo(0), createdAt: daysAgo(4) },
    { id: 'part-1b', conversationId: 'conv-1', userId: 'u-p', lastReadAt: daysAgo(1), createdAt: daysAgo(4) },
    { id: 'part-2a', conversationId: 'conv-2', userId: 'u-t', lastReadAt: daysAgo(0), createdAt: daysAgo(10) },
    { id: 'part-2b', conversationId: 'conv-2', userId: 'u-s1', lastReadAt: daysAgo(1), createdAt: daysAgo(10) },
    { id: 'part-2c', conversationId: 'conv-2', userId: 'u-s2', lastReadAt: null, createdAt: daysAgo(10) },
    { id: 'part-2d', conversationId: 'conv-2', userId: 'u-p', lastReadAt: null, createdAt: daysAgo(10) },
  ].map(r => r as Row)

  db.Message = [
    { id: 'msg-1', conversationId: 'conv-1', senderId: 'u-t', body: 'Hi Mr. Kumar, wanted to update you on Ravi’s progress in Mathematics.', fileIds: [], sentAt: daysAgo(4) },
    { id: 'msg-2', conversationId: 'conv-1', senderId: 'u-p', body: 'Thank you for reaching out, Ms. Krishnan! How is he doing?', fileIds: [], sentAt: daysAgo(3) },
    { id: 'msg-3', conversationId: 'conv-1', senderId: 'u-t', body: 'He’s doing well overall — scored 88% in the last unit test. Just needs a bit more practice with quadratic equations.', fileIds: [], sentAt: daysAgo(1) },
    { id: 'msg-4', conversationId: 'conv-2', senderId: 'u-t', body: 'Reminder: unit test on Chapter 4 (Quadratic Equations) this Friday. Please revise the NCERT exercises.', fileIds: [], sentAt: daysAgo(2) },
  ].map(r => r as Row)

  db.Notification = [
    { id: 'notif-1', schoolId: SCHOOL_ID, userId: 'u-p', kind: 'message', title: 'New message from Meera Krishnan', body: 'He’s doing well overall — scored 88% in the last unit test.', link: 'msgs', readAt: null, createdAt: daysAgo(1) },
    { id: 'notif-2', schoolId: SCHOOL_ID, userId: 'u-ad', kind: 'alumni', title: 'New alumni donation recorded', body: '₹5,000 donation from Sneha Kapoor (Class of 2020).', link: 'alumni', readAt: daysAgo(0), createdAt: daysAgo(9) },
    { id: 'notif-3', schoolId: SCHOOL_ID, userId: 'u-s1', kind: 'wallet', title: 'Canteen wallet topped up', body: '₹150 added to your canteen wallet.', link: 'canteen', readAt: null, createdAt: daysAgo(2) },
    { id: 'notif-4', schoolId: SCHOOL_ID, userId: 'u-t2', kind: 'review', title: 'A performance review has been shared with you', body: '2025 Annual review from Priya Menon is ready for your comments.', link: 'reviews', readAt: null, createdAt: daysAgo(3) },
    { id: 'notif-5', schoolId: SCHOOL_ID, userId: 'u-s2', kind: 'message', title: 'New message in X-A class group', body: 'Reminder: unit test on Chapter 4 this Friday.', link: 'msgs', readAt: null, createdAt: daysAgo(2) },
  ].map(r => r as Row)

  // ═══════════════════════════ Phase 11 (A3 only) — Performance reviews ═══════════════════════════

  db.PerformanceReview = [
    {
      id: 'pr-1', schoolId: SCHOOL_ID, employeeId: 'u-t2', reviewerId: 'u-ad', cycle: '2025 Annual',
      periodStart: '2025-04-01', periodEnd: '2026-03-31', overallRating: 4,
      strengths: 'Excellent classroom engagement; students consistently rate English lessons highly. Strong command of the CBSE curriculum.',
      areasForImprovement: 'Could delegate more grading to peer-review exercises to reduce turnaround time on essays.',
      goals: 'Pilot a peer-review rubric for Class X essay submissions next term.',
      employeeComments: null, status: 'Shared', createdAt: daysAgo(20), sharedAt: daysAgo(3), acknowledgedAt: null,
    },
    {
      id: 'pr-2', schoolId: SCHOOL_ID, employeeId: 'u-t', reviewerId: 'u-ad', cycle: '2025 Annual',
      periodStart: '2025-04-01', periodEnd: '2026-03-31', overallRating: 5,
      strengths: 'Outstanding results in Class X Mathematics boards prep; mentors junior teachers informally.',
      areasForImprovement: 'Documentation of lesson plans could be more detailed for substitute coverage.',
      goals: 'Lead the Mathematics department’s NCERT-alignment review for the coming academic year.',
      employeeComments: 'Thank you for the encouraging feedback — I will work on lesson-plan documentation this term.',
      status: 'Acknowledged', createdAt: daysAgo(35), sharedAt: daysAgo(18), acknowledgedAt: daysAgo(12),
    },
    {
      id: 'pr-3', schoolId: SCHOOL_ID, employeeId: 'u-st', reviewerId: 'u-ad', cycle: '2025 Mid-year',
      periodStart: '2025-08-01', periodEnd: '2025-11-30', overallRating: 3,
      strengths: 'Reliable front-office coordination; handles parent queries courteously.',
      areasForImprovement: 'Response time on admission document follow-ups can be faster.',
      goals: 'Reduce average document-verification turnaround to under 2 working days.',
      employeeComments: null, status: 'Draft', createdAt: daysAgo(5), sharedAt: null, acknowledgedAt: null,
    },
  ].map(r => r as Row)

  // ═══════════════════════════ Phase 9/20 — AI tutor history + a saved worksheet ═══════════════════════════

  db.AiConversation = [
    { id: 'aic-1', schoolId: SCHOOL_ID, studentId: 'u-s1', subjectId: 'math', title: 'Quadratic equations', createdAt: daysAgo(3) },
    { id: 'aic-2', schoolId: SCHOOL_ID, studentId: 'u-s1', subjectId: null, title: null, createdAt: daysAgo(1) },
  ].map(r => r as Row)

  db.AiMessage = [
    { id: 'aim-1', conversationId: 'aic-1', role: 'user', content: 'How do I solve quadratic equations using the quadratic formula?', createdAt: daysAgo(3) },
    { id: 'aim-2', conversationId: 'aic-1', role: 'assistant', content: 'Great question! For an equation in the form ax² + bx + c = 0, the quadratic formula gives x = (-b ± √(b² - 4ac)) / 2a. Start by identifying a, b, and c, then substitute them in carefully — work out the discriminant (b² - 4ac) first to see how many real roots to expect. Want to try one together?', createdAt: daysAgo(3) },
    { id: 'aim-3', conversationId: 'aic-2', role: 'user', content: 'What happens in photosynthesis?', createdAt: daysAgo(1) },
    { id: 'aim-4', conversationId: 'aic-2', role: 'assistant', content: 'Photosynthesis is how green plants make their own food. Using sunlight, water (absorbed by roots) and carbon dioxide (absorbed through leaf pores called stomata), chlorophyll in the leaves converts these into glucose (food) and oxygen. The overall equation is: 6CO₂ + 6H₂O + light energy → C₆H₁₂O₆ + 6O₂. This is why plants are essential for the oxygen we breathe!', createdAt: daysAgo(1) },
  ].map(r => r as Row)

  db.GeneratedWorksheet = [
    {
      id: 'gws-1', schoolId: SCHOOL_ID, classSubjectId: 'cs-10a-math', chapterIds: ['ch-quadratic-equations'],
      title: 'Mathematics Worksheet — Quadratic Equations', pdfFileId: null, createdById: 'u-t', createdAt: daysAgo(7),
      content:
        'Quadratic Equations — Practice Worksheet\n' +
        'Instructions: Attempt all questions. Show your working for full marks.\n\n' +
        '1. Solve x² - 5x + 6 = 0 by factorisation.\n' +
        '2. Solve 2x² + 3x - 2 = 0 using the quadratic formula.\n' +
        '3. Find the discriminant of x² + 4x + 4 = 0 and state the nature of its roots.\n' +
        '4. A ball is thrown upward; its height h(t) = -5t² + 20t. Find when it hits the ground.\n' +
        '5. MCQ: The roots of x² - 9 = 0 are: (a) ±3 (b) ±9 (c) 3, -9 (d) none\n\n' +
        'Answer Key\n1. x = 2, 3\n2. x = 0.5, -2\n3. Discriminant = 0, equal real roots\n4. t = 0s and t = 4s\n5. (a)',
    },
  ].map(r => r as Row)
}

addSeedFragment(seedCommunity)
