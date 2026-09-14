// Seed fragment for the safety & wellbeing module batch: campus safety (authorized pickup + OTP,
// visitor log), confidential counseling (records + anonymous reports), the disciplinary committee,
// staff conduct records, and the formal scholarship program. Extends seed/core.ts's School/User/Class/
// Enrollment rows — see seed/index.ts for the registration order. See .agents/edunova/static-demo-plan.md
// and phase-8-welfare.md / phase-11-employee-management.md / phase-21-financial-intelligence.md /
// phase-22-campus-safety.md for the real shapes this mirrors.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'
import { addSeedFragment } from './index'

const daysAgo = (n: number, hour = 9) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}
const daysFromNow = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
export function seedSafetyWellbeing(db: Collections) {
  // ── Designate one counselor (Phase 22 item 3 — isCounselor is a separate, admin-set capability, not a
  // role). Mutating the row seed/core.ts already created, same pattern other fragments use to extend it.
  const counselor = (db.User ?? []).find(u => u.id === 'u-t3')
  if (counselor) counselor.isCounselor = true

  /* ═══════════════════ Campus safety: authorized pickup + OTP ═══════════════════ */

  db.AuthorizedPickupPerson = [
    { id: 'ap-1', schoolId: SCHOOL_ID, studentId: 'u-s1', name: 'Meena Kumar', relation: 'Mother', phone: '9820011223', photoFileId: null, addedById: 'u-p', active: true, createdAt: daysAgo(180) },
    { id: 'ap-2', schoolId: SCHOOL_ID, studentId: 'u-s1', name: 'Suresh Iyer', relation: 'Family driver', phone: '9820033445', photoFileId: null, addedById: 'u-p', active: true, createdAt: daysAgo(120) },
    { id: 'ap-3', schoolId: SCHOOL_ID, studentId: 'u-s1', name: 'Ramesh Pillai', relation: 'Uncle', phone: '9820055667', photoFileId: null, addedById: 'u-st', active: false, createdAt: daysAgo(300) },
    { id: 'ap-4', schoolId: SCHOOL_ID, studentId: 'u-s2', name: 'Lakshmi Singh', relation: 'Mother', phone: '9821122334', photoFileId: null, addedById: 'u-st', active: true, createdAt: daysAgo(200) },
  ].map(r => r as Row)

  db.PickupEvent = [
    // Regular, on the authorized list — no OTP needed.
    {
      id: 'pe-1', schoolId: SCHOOL_ID, studentId: 'u-s1', pickedUpByName: 'Meena Kumar', pickedUpByRelation: 'Mother',
      pickupType: 'Regular', otpRequired: false, approvedByOtp: false, otpExpiresAt: null, otpVerifiedAt: null,
      otpCode: null, otpAttempts: 0, status: 'Completed', recordedById: 'u-st', recordedAt: daysAgo(0, 15),
    },
    // Early/unlisted, OTP requested and verified.
    {
      id: 'pe-2', schoolId: SCHOOL_ID, studentId: 'u-s1', pickedUpByName: 'Vikas Iyer', pickedUpByRelation: 'Family friend',
      pickupType: 'EarlyOrUnlisted', otpRequired: true, approvedByOtp: true, otpExpiresAt: null, otpVerifiedAt: daysAgo(1, 13),
      otpCode: null, otpAttempts: 1, status: 'Completed', recordedById: 'u-st', recordedAt: daysAgo(1, 12),
    },
    // Early/unlisted, OTP expired without verification — flagged for review.
    {
      id: 'pe-3', schoolId: SCHOOL_ID, studentId: 'u-s2', pickedUpByName: 'Rakesh Mehta', pickedUpByRelation: 'Neighbour',
      pickupType: 'EarlyOrUnlisted', otpRequired: true, approvedByOtp: false, otpExpiresAt: daysAgo(2, 11), otpVerifiedAt: null,
      otpCode: null, otpAttempts: 2, status: 'Flagged', recordedById: 'u-st', recordedAt: daysAgo(2, 10),
    },
  ].map(r => r as Row)

  /* ═══════════════════ Campus safety: visitor log ═══════════════════ */

  db.Visitor = [
    { id: 'v-1', schoolId: SCHOOL_ID, name: 'Ajay Bhatt', phone: '9833001122', purpose: 'Parent-teacher meeting', hostUserId: 'u-t', checkInAt: daysAgo(1, 10), checkOutAt: daysAgo(1, 11), badgeNo: 'V-098', recordedById: 'u-st' },
    { id: 'v-2', schoolId: SCHOOL_ID, name: 'Sunita Rao', phone: '9833002233', purpose: 'Stationery vendor — quarterly supply', hostUserId: 'u-ad', checkInAt: daysAgo(0, 9), checkOutAt: null, badgeNo: 'V-101', recordedById: 'u-st' },
    { id: 'v-3', schoolId: SCHOOL_ID, name: 'Ramesh Gupta', phone: '9833003344', purpose: 'Class XI admission enquiry', hostUserId: 'u-ad', checkInAt: daysAgo(0, 10), checkOutAt: null, badgeNo: 'V-102', recordedById: 'u-st' },
  ].map(r => r as Row)

  /* ═══════════════════ Confidential counseling ═══════════════════ */

  db.CounselingSettings = [
    { id: 'cs-demo', schoolId: SCHOOL_ID, oversightEnabled: false, createdAt: daysAgo(365) },
  ].map(r => r as Row)

  db.CounselingRecord = [
    {
      id: 'cr-1', schoolId: SCHOOL_ID, studentId: 'u-s3', counselorId: 'u-t3', sessionDate: daysAgo(5).slice(0, 10),
      notes: 'Discussed exam-related anxiety ahead of the term assessments. Introduced simple breathing and time-management techniques; student was receptive. Will check in after the first assessment to see how things are going.',
      category: 'Emotional', followUpNeeded: true, createdAt: daysAgo(5),
    },
    {
      id: 'cr-2', schoolId: SCHOOL_ID, studentId: 'u-s1', counselorId: 'u-t3', sessionDate: daysAgo(20).slice(0, 10),
      notes: 'Follow-up after a change at home (parents shared a family relocation is being considered). Student is coping well but appreciates having a regular check-in point. No immediate concerns.',
      category: 'Family', followUpNeeded: false, createdAt: daysAgo(20),
    },
  ].map(r => r as Row)

  db.AnonymousReport = [
    { id: 'ar-1', schoolId: SCHOOL_ID, category: 'Bullying', description: 'A group of seniors have been teasing a junior about their accent during lunch break near the canteen. It has happened more than once this week.', submittedAt: daysAgo(1, 13), status: 'New', reviewedById: null, resolutionNotes: null },
    { id: 'ar-2', schoolId: SCHOOL_ID, category: 'Wellbeing', description: 'A classmate has seemed withdrawn and has mentioned not sleeping well for the past couple of weeks. Not sure who to tell but thought a counselor should know.', submittedAt: daysAgo(4, 16), status: 'Reviewing', reviewedById: 'u-t3', resolutionNotes: null },
    { id: 'ar-3', schoolId: SCHOOL_ID, category: 'Safety', description: 'The railing near the second-floor science lab stairwell feels loose. Could someone check it before it becomes a hazard?', submittedAt: daysAgo(10, 9), status: 'Resolved', reviewedById: 'u-ad', resolutionNotes: 'Facilities inspected and re-fastened the railing the same week. Marked safe on the maintenance log.' },
  ].map(r => r as Row)

  /* ═══════════════════ Disciplinary committee ═══════════════════ */

  db.DisciplinaryCase = [
    {
      id: 'dc-1', schoolId: SCHOOL_ID, studentId: 'u-s1', classId: 'class-10a', title: 'Mobile phone use during a term exam',
      description: 'Student was found with a mobile phone switched on inside the exam hall during the Term 2 Mathematics paper, in violation of the examination code of conduct. The phone was confiscated by the invigilator and handed to the class teacher.',
      reportedById: 'u-t', witnesses: 'Ms. Meera Krishnan (invigilator), Arjun Nair (co-invigilator)', fileIds: [], status: 'Action Taken',
      hearingDate: daysAgo(12).slice(0, 10), decision: 'First offense; student admitted to the violation. Committee agreed a formal warning was proportionate given a clean prior record.',
      actionTaken: 'Warning', appeal: null, relatedPeople: null, deletedAt: null, createdAt: daysAgo(15), updatedAt: daysAgo(10),
    },
    {
      id: 'dc-2', schoolId: SCHOOL_ID, studentId: 'u-s3', classId: 'class-10b', title: 'Altercation on the playground',
      description: 'A shoving match broke out between two students during the lunch break sports period over a disputed line call in a football match. No injuries; PE staff separated them immediately.',
      reportedById: 'u-t4', witnesses: 'PE staff on duty', fileIds: [], status: 'Heard',
      hearingDate: daysFromNow(3), decision: null, actionTaken: null, appeal: null, relatedPeople: 'Other student involved: counseled separately by class teacher',
      deletedAt: null, createdAt: daysAgo(4), updatedAt: daysAgo(1),
    },
    {
      id: 'dc-3', schoolId: SCHOOL_ID, studentId: 'u-s4', classId: 'class-9a', title: 'Repeated disruption during class',
      description: 'Third instance this term of disruptive behaviour during English period, following two verbal warnings from the subject teacher noted in the class log.',
      reportedById: 'u-t2', witnesses: null, fileIds: [], status: 'Reported',
      hearingDate: null, decision: null, actionTaken: null, appeal: null, relatedPeople: null,
      deletedAt: null, createdAt: daysAgo(1), updatedAt: daysAgo(1),
    },
  ].map(r => r as Row)

  db.DisciplinaryNote = [
    { id: 'dn-1', schoolId: SCHOOL_ID, caseId: 'dc-1', authorId: 'u-t', body: 'Status → Scheduled: Hearing scheduled with the disciplinary committee for the following Monday.', createdAt: daysAgo(14) },
    { id: 'dn-2', schoolId: SCHOOL_ID, caseId: 'dc-1', authorId: 'u-t', body: 'Status → Heard: Student and class teacher attended; student accepted responsibility.', createdAt: daysAgo(12) },
    { id: 'dn-3', schoolId: SCHOOL_ID, caseId: 'dc-1', authorId: 'u-ad', body: 'Status → Decision: First offense — a warning was agreed as proportionate.', createdAt: daysAgo(11) },
    { id: 'dn-4', schoolId: SCHOOL_ID, caseId: 'dc-1', authorId: 'u-ad', body: 'Status → Action Taken: Warning issued: A formal warning was recorded on file and communicated to the parent.', createdAt: daysAgo(10) },
    { id: 'dn-5', schoolId: SCHOOL_ID, caseId: 'dc-2', authorId: 'u-t4', body: 'Status → Scheduled: Hearing set for later this week once both students have given written statements.', createdAt: daysAgo(3) },
    { id: 'dn-6', schoolId: SCHOOL_ID, caseId: 'dc-2', authorId: 'u-t4', body: 'Status → Heard: Both statements received; hearing to reconvene with parents present.', createdAt: daysAgo(1) },
  ].map(r => r as Row)

  /* ═══════════════════ Staff conduct (HR/admin-only) ═══════════════════ */

  db.StaffConductRecord = [
    {
      id: 'sc-1', schoolId: SCHOOL_ID, employeeId: 'u-t6', reportedById: 'u-ad', title: 'Late arrival pattern',
      description: 'Three late arrivals (after the 8:00am reporting time) logged in the biometric attendance system over the past two weeks, without prior intimation.',
      category: 'Attendance', status: 'UnderReview', actionTaken: null, fileIds: [], createdAt: daysAgo(6), resolvedAt: null, resolvedById: null,
    },
    {
      id: 'sc-2', schoolId: SCHOOL_ID, employeeId: 'u-st', reportedById: 'u-sa', title: 'ID card / visitor-escort policy reminder',
      description: 'Front office did not follow the updated visitor sign-in procedure on one occasion — a visitor was allowed past the gate without a badge being issued first.',
      category: 'Policy', status: 'Resolved', actionTaken: 'Verbal reminder given; front office re-briefed on the updated visitor procedure. No repeat since.',
      fileIds: [], createdAt: daysAgo(30), resolvedAt: daysAgo(28), resolvedById: 'u-ad',
    },
  ].map(r => r as Row)

  /* ═══════════════════ Scholarships ═══════════════════ */

  db.Scholarship = [
    { id: 'sch-1', schoolId: SCHOOL_ID, name: 'Merit Scholarship — Academic Toppers', type: 'MeritBased', discountType: 'Percentage', discountValue: 25, criteria: 'Top 5 rank holders of the previous academic year, subject to maintaining a minimum 85% aggregate.', active: true, createdAt: daysAgo(200) },
    { id: 'sch-2', schoolId: SCHOOL_ID, name: 'Need-Based Fee Assistance', type: 'NeedBased', discountType: 'FixedAmount', discountValue: 15000, criteria: 'Verified family income below ₹3,00,000 per annum; renewed each year on submission of income proof.', active: true, createdAt: daysAgo(200) },
    { id: 'sch-3', schoolId: SCHOOL_ID, name: 'Sibling Discount', type: 'SiblingDiscount', discountType: 'Percentage', discountValue: 10, criteria: 'Applies to the second and subsequent siblings concurrently enrolled in the same academic year.', active: true, createdAt: daysAgo(200) },
    { id: 'sch-4', schoolId: SCHOOL_ID, name: 'Staff Ward Concession', type: 'StaffWard', discountType: 'Percentage', discountValue: 50, criteria: 'Children of full-time teaching and non-teaching staff.', active: true, createdAt: daysAgo(200) },
  ].map(r => r as Row)

  db.ScholarshipAward = [
    {
      id: 'awd-1', schoolId: SCHOOL_ID, scholarshipId: 'sch-1', studentId: 'u-s2', academicYearId: 'ay-2025',
      status: 'Approved', reason: null, proposedById: 'u-t', approvedById: 'u-ad', approvedAt: daysAgo(60),
      appliedToInvoiceIds: ['seed-fee-invoice-t1-s2'], totalDiscountApplied: 4500, createdAt: daysAgo(65),
    },
    {
      id: 'awd-2', schoolId: SCHOOL_ID, scholarshipId: 'sch-2', studentId: 'u-s3', academicYearId: 'ay-2025',
      status: 'Pending', reason: null, proposedById: 'u-st', approvedById: null, approvedAt: null,
      appliedToInvoiceIds: [], totalDiscountApplied: 0, createdAt: daysAgo(3),
    },
    {
      id: 'awd-3', schoolId: SCHOOL_ID, scholarshipId: 'sch-3', studentId: 'u-s4', academicYearId: 'ay-2025',
      status: 'Rejected', reason: 'No sibling currently enrolled in the same academic year — criteria not met.', proposedById: 'u-t2', approvedById: 'u-ad', approvedAt: null,
      appliedToInvoiceIds: [], totalDiscountApplied: 0, createdAt: daysAgo(45),
    },
  ].map(r => r as Row)
}

addSeedFragment(seedSafetyWellbeing)
