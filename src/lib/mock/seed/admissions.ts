// Seed fragment for the admissions & documents batch (applications, admission-documents,
// board-registrations, certificates, verification). Mirrors the real server's default catalogs
// (server/src/modules/admissionDocuments/service.ts's DEFAULT_ADMISSION_CATEGORIES/DEFAULT_DOCUMENT_TYPES)
// so the category-conditional document logic in modules/admissionDocuments.ts has real India-specific
// data to evaluate against, plus a handful of Application/SubmittedDocument/BoardRegistration/Certificate
// rows in different states — see .agents/edunova/static-demo-plan.md and the real
// server/src/modules/{applications,admissionDocuments,boardRegistrations,certificates,verification}
// modules (read via `git show feature/backend-api:server/src/modules/...`) for the shape this matches.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'
import { addSeedFragment } from './index'

export function seedAdmissions(db: Collections) {
  // ── AdmissionCategory — India-specific reservation/quota catalog (school-editable) ──
  db.AdmissionCategory = [
    { id: 'cat-general', schoolId: SCHOOL_ID, name: 'General', code: 'GENERAL', requiresCertificate: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'cat-sc', schoolId: SCHOOL_ID, name: 'Scheduled Caste (SC)', code: 'SC', requiresCertificate: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'cat-st', schoolId: SCHOOL_ID, name: 'Scheduled Tribe (ST)', code: 'ST', requiresCertificate: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'cat-obc', schoolId: SCHOOL_ID, name: 'Other Backward Class (OBC)', code: 'OBC', requiresCertificate: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'cat-ews', schoolId: SCHOOL_ID, name: 'Economically Weaker Section (EWS)', code: 'EWS', requiresCertificate: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'cat-rte', schoolId: SCHOOL_ID, name: 'RTE 25% Quota', code: 'RTE', requiresCertificate: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'cat-management', schoolId: SCHOOL_ID, name: 'Management Quota', code: 'MANAGEMENT', requiresCertificate: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'cat-staff-ward', schoolId: SCHOOL_ID, name: 'Staff-Ward', code: 'STAFF_WARD', requiresCertificate: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'cat-sports-talent', schoolId: SCHOOL_ID, name: 'Sports/Talent Quota', code: 'SPORTS_TALENT', requiresCertificate: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'cat-minority', schoolId: SCHOOL_ID, name: 'Minority', code: 'MINORITY', requiresCertificate: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'cat-defense', schoolId: SCHOOL_ID, name: 'Defense / Ex-servicemen', code: 'DEFENSE', requiresCertificate: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
  ] as Row[]

  // ── RequiredDocumentType — standard Indian school admission document set, with the same
  // structured requiredIfCategoryIn/requiredIfAdmissionMode/requiredIfBoardChanged/alwaysRequired
  // condition flags the real server's default catalog uses. ──
  db.RequiredDocumentType = [
    { id: 'dt-birth-certificate', schoolId: SCHOOL_ID, name: 'Birth Certificate', code: 'BIRTH_CERTIFICATE', requiredIfCategoryIn: [], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-transfer-certificate', schoolId: SCHOOL_ID, name: 'Transfer Certificate (previous school)', code: 'TRANSFER_CERTIFICATE', requiredIfCategoryIn: [], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-previous-marksheet', schoolId: SCHOOL_ID, name: 'Previous school report cards / mark sheets', code: 'PREVIOUS_MARKSHEET', requiredIfCategoryIn: [], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-migration-certificate', schoolId: SCHOOL_ID, name: 'Migration Certificate', code: 'MIGRATION_CERTIFICATE', requiredIfCategoryIn: [], requiredIfAdmissionMode: [], requiredIfBoardChanged: true, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-character-certificate', schoolId: SCHOOL_ID, name: 'Character Certificate', code: 'CHARACTER_CERTIFICATE', requiredIfCategoryIn: [], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-aadhaar-copy', schoolId: SCHOOL_ID, name: 'Aadhaar Card Copy', code: 'AADHAAR_COPY', requiredIfCategoryIn: [], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-passport-photos', schoolId: SCHOOL_ID, name: 'Passport Photographs', code: 'PASSPORT_PHOTOS', requiredIfCategoryIn: [], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-address-proof', schoolId: SCHOOL_ID, name: 'Address Proof', code: 'ADDRESS_PROOF', requiredIfCategoryIn: [], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-caste-certificate', schoolId: SCHOOL_ID, name: 'Caste Certificate', code: 'CASTE_CERTIFICATE', requiredIfCategoryIn: ['SC', 'ST', 'OBC', 'EWS'], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-income-certificate', schoolId: SCHOOL_ID, name: 'Income Certificate', code: 'INCOME_CERTIFICATE', requiredIfCategoryIn: ['EWS', 'RTE'], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-domicile-certificate', schoolId: SCHOOL_ID, name: 'Domicile / Residence Certificate', code: 'DOMICILE_CERTIFICATE', requiredIfCategoryIn: ['RTE'], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-disability-certificate', schoolId: SCHOOL_ID, name: 'Disability Certificate', code: 'DISABILITY_CERTIFICATE', requiredIfCategoryIn: [], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-minority-certificate', schoolId: SCHOOL_ID, name: 'Minority Certificate', code: 'MINORITY_CERTIFICATE', requiredIfCategoryIn: ['MINORITY'], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-rte-allotment-letter', schoolId: SCHOOL_ID, name: 'RTE Allotment Letter', code: 'RTE_ALLOTMENT_LETTER', requiredIfCategoryIn: [], requiredIfAdmissionMode: ['RTE'], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-medical-certificate', schoolId: SCHOOL_ID, name: 'Medical / Immunization / Fitness Certificate', code: 'MEDICAL_CERTIFICATE', requiredIfCategoryIn: [], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-bank-passbook', schoolId: SCHOOL_ID, name: 'Bank Passbook Copy', code: 'BANK_PASSBOOK', requiredIfCategoryIn: [], requiredIfAdmissionMode: ['RTE'], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-sports-certificate', schoolId: SCHOOL_ID, name: 'Sports / Extracurricular Achievement Certificate', code: 'SPORTS_CERTIFICATE', requiredIfCategoryIn: ['SPORTS_TALENT'], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-parent-employment-proof', schoolId: SCHOOL_ID, name: 'Parent ID / Employment Proof', code: 'PARENT_EMPLOYMENT_PROOF', requiredIfCategoryIn: ['STAFF_WARD'], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-fee-clearance', schoolId: SCHOOL_ID, name: 'Fee Clearance / No-Dues Certificate (previous school)', code: 'FEE_CLEARANCE', requiredIfCategoryIn: [], requiredIfAdmissionMode: [], requiredIfBoardChanged: true, alwaysRequired: false, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
    { id: 'dt-declaration-undertaking', schoolId: SCHOOL_ID, name: 'Declaration / Undertaking', code: 'DECLARATION_UNDERTAKING', requiredIfCategoryIn: [], requiredIfAdmissionMode: [], requiredIfBoardChanged: false, alwaysRequired: true, isActive: true, createdAt: '2024-04-01T00:00:00.000Z' },
  ] as Row[]

  // ── AdmissionSettings — 1:1 school row; blocking left off by default (matches the real default). ──
  db.AdmissionSettings = [
    { id: 'admissionsettings-1', schoolId: SCHOOL_ID, admissionDocumentsBlockApproval: false, updatedAt: '2024-04-01T00:00:00.000Z' },
  ] as Row[]

  // ── Two extra users (a not-yet-verified parent + their child) purely to demonstrate the Parent
  // Verification queue — core.ts's own parent/student pair is already `verified: true`. Appended to
  // core's arrays, never replacing them. ──
  const users = (db.User ?? []) as Row[]
  users.push(
    {
      id: 'u-p2', schoolId: SCHOOL_ID, role: 'parent', name: 'Kavya Reddy', email: 'kavya.reddy@edkonic.in', password: 'parent123',
      title: 'Parent', avatarHue: 205, verified: false, active: true, mustChangePassword: false, wards: 'u-s5', phone: '+91 98450 67890',
      createdAt: '2025-04-01T00:00:00.000Z',
    },
    {
      id: 'u-s5', schoolId: SCHOOL_ID, role: 'student', name: 'Aditya Reddy', email: 'aditya.reddy@edkonic.in', password: 'student123',
      title: 'Student', avatarHue: 45, verified: true, active: true, mustChangePassword: false, class: 'IX', section: 'B', roll: '22',
      dob: '2011-07-09', board: 'CBSE', createdAt: '2025-04-01T00:00:00.000Z',
    },
  )
  db.User = users

  db.Enrollment = [
    ...(db.Enrollment as Row[] ?? []),
    { id: 'enr-s5', schoolId: SCHOOL_ID, studentId: 'u-s5', classId: 'class-9b', academicYearId: 'ay-2025', status: 'active', rollNo: '22' },
  ]
  db.Guardian = [
    ...(db.Guardian as Row[] ?? []),
    { id: 'g-2', schoolId: SCHOOL_ID, studentId: 'u-s5', parentId: 'u-p2', relation: 'Mother', isPrimary: true },
  ]

  // ── Applications — every kind, every status, plus the two document-completeness demo cases the
  // task asked for: app-1 has nothing submitted (missing required documents), app-2 has every
  // required document for its category/mode/board-change on file (fully complete). ──
  db.Application = [
    {
      id: 'app-1', schoolId: SCHOOL_ID, kind: 'Admission', applicantName: 'Ishaan Bhatt', dob: '2016-09-02', gender: 'Male',
      guardian: { name: 'Rajesh Bhatt', phone: '+91 98765 11111', email: 'rajesh.bhatt@example.com', relation: 'Father' },
      targetClassId: 'class-9a', targetBoardId: 'board-cbse', studentId: null, documents: [], status: 'Pending', notes: null,
      submittedById: 'u-st', decidedById: null, decidedAt: null, createdAt: '2026-06-10T09:30:00.000Z',
      previousSchoolName: null, previousBoardId: null, lastGradeCompleted: null, priorSubjectScores: [],
      declaredTrackPreference: null, siblingStudentId: null, admissionCategoryId: 'cat-general', admissionMode: 'Regular',
      healthFlags: null, transportRequired: false, transportPreferredArea: null, transportHandledAt: null,
    },
    {
      id: 'app-2', schoolId: SCHOOL_ID, kind: 'Admission', applicantName: 'Meher Kaur', dob: '2015-01-20', gender: 'Female',
      guardian: { name: 'Simran Kaur', phone: '+91 98765 22222', email: 'simran.kaur@example.com', relation: 'Mother' },
      targetClassId: 'class-9a', targetBoardId: 'board-cbse', studentId: null, documents: [], status: 'Verified',
      notes: 'Verified by the front office — documents cross-checked against originals.',
      submittedById: 'u-st', decidedById: null, decidedAt: null, createdAt: '2026-06-05T10:15:00.000Z',
      previousSchoolName: 'Little Flower Convent', previousBoardId: 'board-state', lastGradeCompleted: 'Grade 8',
      priorSubjectScores: [
        { id: 'pss-1', subjectName: 'Mathematics', score: 88, maxScore: 100 },
        { id: 'pss-2', subjectName: 'English', score: 91, maxScore: 100 },
        { id: 'pss-3', subjectName: 'Science', score: 84, maxScore: 100 },
      ],
      declaredTrackPreference: null, siblingStudentId: null, admissionCategoryId: 'cat-sc', admissionMode: 'Regular',
      healthFlags: { allergies: 'Peanuts', bloodGroup: 'B+' }, transportRequired: true, transportPreferredArea: 'Koramangala 4th Block',
      transportHandledAt: null,
    },
    {
      id: 'app-3', schoolId: SCHOOL_ID, kind: 'Admission', applicantName: 'Divya Sharma', dob: '2011-03-18', gender: 'Female',
      guardian: { name: 'Manoj Sharma', phone: '+91 98765 44444', relation: 'Father' },
      targetClassId: 'class-9a', targetBoardId: 'board-cbse', studentId: 'u-s4', documents: [], status: 'Approved', notes: null,
      submittedById: 'u-st', decidedById: 'u-ad', decidedAt: '2025-04-15T08:00:00.000Z', createdAt: '2025-04-10T09:00:00.000Z',
      previousSchoolName: null, previousBoardId: null, lastGradeCompleted: null, priorSubjectScores: [],
      declaredTrackPreference: null, siblingStudentId: null, admissionCategoryId: 'cat-general', admissionMode: 'Regular',
      healthFlags: null, transportRequired: false, transportPreferredArea: null, transportHandledAt: null,
    },
    {
      id: 'app-4', schoolId: SCHOOL_ID, kind: 'TC', applicantName: 'Ravi Kumar', dob: '2010-05-14', gender: null, guardian: null,
      targetClassId: null, targetBoardId: null, studentId: 'u-s1', documents: [], status: 'Pending',
      notes: 'Family relocating to Bengaluru at the end of this term.', submittedById: 'u-p', decidedById: null, decidedAt: null,
      createdAt: '2026-08-20T11:00:00.000Z', previousSchoolName: null, previousBoardId: null, lastGradeCompleted: null,
      priorSubjectScores: [], declaredTrackPreference: null, siblingStudentId: null, admissionCategoryId: null, admissionMode: null,
      healthFlags: null, transportRequired: false, transportPreferredArea: null, transportHandledAt: null,
    },
    {
      id: 'app-5', schoolId: SCHOOL_ID, kind: 'Bonafide', applicantName: 'Ananya Singh', dob: '2010-08-22', gender: null, guardian: null,
      targetClassId: null, targetBoardId: null, studentId: 'u-s2', documents: [], status: 'Approved', notes: 'For a passport application.',
      submittedById: 'u-s2', decidedById: 'u-ad', decidedAt: '2026-07-02T13:20:00.000Z', createdAt: '2026-07-01T10:00:00.000Z',
      previousSchoolName: null, previousBoardId: null, lastGradeCompleted: null, priorSubjectScores: [], declaredTrackPreference: null,
      siblingStudentId: null, admissionCategoryId: null, admissionMode: null, healthFlags: null, transportRequired: false,
      transportPreferredArea: null, transportHandledAt: null,
    },
    {
      id: 'app-6', schoolId: SCHOOL_ID, kind: 'Admission', applicantName: 'Rohan Malhotra', dob: '2016-03-11', gender: 'Male',
      guardian: { name: 'Anil Malhotra', phone: '+91 98765 33333', relation: 'Father' },
      targetClassId: 'class-9b', targetBoardId: 'board-cbse', studentId: null, documents: [], status: 'Declined',
      notes: 'Seats full in the Management quota for the current academic year.', submittedById: 'u-st', decidedById: 'u-ad',
      decidedAt: '2026-05-20T09:00:00.000Z', createdAt: '2026-05-12T09:00:00.000Z', previousSchoolName: null, previousBoardId: null,
      lastGradeCompleted: null, priorSubjectScores: [], declaredTrackPreference: null, siblingStudentId: null,
      admissionCategoryId: 'cat-management', admissionMode: 'Management', healthFlags: null, transportRequired: false,
      transportPreferredArea: null, transportHandledAt: null,
    },
    {
      id: 'app-7', schoolId: SCHOOL_ID, kind: 'Character', applicantName: 'Karthik Reddy', dob: '2010-02-10', gender: null, guardian: null,
      targetClassId: null, targetBoardId: null, studentId: 'u-s3', documents: [], status: 'Pending', notes: 'For a scholarship application.',
      submittedById: 'u-s3', decidedById: null, decidedAt: null, createdAt: '2026-08-28T09:45:00.000Z', previousSchoolName: null,
      previousBoardId: null, lastGradeCompleted: null, priorSubjectScores: [], declaredTrackPreference: null, siblingStudentId: null,
      admissionCategoryId: null, admissionMode: null, healthFlags: null, transportRequired: false, transportPreferredArea: null,
      transportHandledAt: null,
    },
  ] as Row[]

  // ── SubmittedDocument — app-2's full required set (digital + two physical originals in custody,
  // demonstrating the room/shelf/folder fields), plus two physical originals already on file for u-s1
  // (submitted at their original admission, now enrolled) so the TC-issuance return workflow for app-4
  // has real held originals to resolve. ──
  db.SubmittedDocument = [
    // app-2 — every required document type for SC / board-changed is on file (checklist.complete === true).
    { id: 'sd-1', schoolId: SCHOOL_ID, applicationId: 'app-2', studentId: null, requiredDocumentTypeId: 'dt-birth-certificate', fileId: null, isOriginal: true, physicalLocationRoom: 'Records Room A', physicalLocationShelf: 'Shelf 2', physicalLocationFolder: 'B-014', receivedDate: '2026-06-02', status: 'HELD', returnedDate: null, returnedTo: null, returnReason: null, submittedById: 'u-st', createdAt: '2026-06-02T09:00:00.000Z' },
    { id: 'sd-2', schoolId: SCHOOL_ID, applicationId: 'app-2', studentId: null, requiredDocumentTypeId: 'dt-aadhaar-copy', fileId: null, isOriginal: false, physicalLocationRoom: null, physicalLocationShelf: null, physicalLocationFolder: null, receivedDate: '2026-06-02', status: 'HELD', returnedDate: null, returnedTo: null, returnReason: null, submittedById: 'u-st', createdAt: '2026-06-02T09:05:00.000Z' },
    { id: 'sd-3', schoolId: SCHOOL_ID, applicationId: 'app-2', studentId: null, requiredDocumentTypeId: 'dt-passport-photos', fileId: null, isOriginal: false, physicalLocationRoom: null, physicalLocationShelf: null, physicalLocationFolder: null, receivedDate: '2026-06-02', status: 'HELD', returnedDate: null, returnedTo: null, returnReason: null, submittedById: 'u-st', createdAt: '2026-06-02T09:06:00.000Z' },
    { id: 'sd-4', schoolId: SCHOOL_ID, applicationId: 'app-2', studentId: null, requiredDocumentTypeId: 'dt-address-proof', fileId: null, isOriginal: false, physicalLocationRoom: null, physicalLocationShelf: null, physicalLocationFolder: null, receivedDate: '2026-06-02', status: 'HELD', returnedDate: null, returnedTo: null, returnReason: null, submittedById: 'u-st', createdAt: '2026-06-02T09:07:00.000Z' },
    { id: 'sd-5', schoolId: SCHOOL_ID, applicationId: 'app-2', studentId: null, requiredDocumentTypeId: 'dt-declaration-undertaking', fileId: null, isOriginal: false, physicalLocationRoom: null, physicalLocationShelf: null, physicalLocationFolder: null, receivedDate: '2026-06-02', status: 'HELD', returnedDate: null, returnedTo: null, returnReason: null, submittedById: 'u-st', createdAt: '2026-06-02T09:08:00.000Z' },
    { id: 'sd-6', schoolId: SCHOOL_ID, applicationId: 'app-2', studentId: null, requiredDocumentTypeId: 'dt-caste-certificate', fileId: null, isOriginal: true, physicalLocationRoom: 'Records Room A', physicalLocationShelf: 'Shelf 2', physicalLocationFolder: 'B-014', receivedDate: '2026-06-03', status: 'HELD', returnedDate: null, returnedTo: null, returnReason: null, submittedById: 'u-st', createdAt: '2026-06-03T09:00:00.000Z' },
    { id: 'sd-7', schoolId: SCHOOL_ID, applicationId: 'app-2', studentId: null, requiredDocumentTypeId: 'dt-migration-certificate', fileId: null, isOriginal: true, physicalLocationRoom: 'Records Room A', physicalLocationShelf: 'Shelf 2', physicalLocationFolder: 'B-014', receivedDate: '2026-06-03', status: 'HELD', returnedDate: null, returnedTo: null, returnReason: null, submittedById: 'u-st', createdAt: '2026-06-03T09:10:00.000Z' },
    { id: 'sd-8', schoolId: SCHOOL_ID, applicationId: 'app-2', studentId: null, requiredDocumentTypeId: 'dt-fee-clearance', fileId: null, isOriginal: false, physicalLocationRoom: null, physicalLocationShelf: null, physicalLocationFolder: null, receivedDate: '2026-06-03', status: 'HELD', returnedDate: null, returnedTo: null, returnReason: null, submittedById: 'u-st', createdAt: '2026-06-03T09:11:00.000Z' },
    // An extra document on file that isn't tagged to any catalog type — exercises the checklist's
    // "Other documents on file" bucket.
    { id: 'sd-9', schoolId: SCHOOL_ID, applicationId: 'app-2', studentId: null, requiredDocumentTypeId: null, fileId: null, isOriginal: false, physicalLocationRoom: null, physicalLocationShelf: null, physicalLocationFolder: null, receivedDate: '2026-06-03', status: 'HELD', returnedDate: null, returnedTo: null, returnReason: null, submittedById: 'u-st', createdAt: '2026-06-03T09:12:00.000Z' },
    // Held originals on file for u-s1 (Ravi Kumar) from their original admission — these are exactly
    // what app-4's TC-issuance return workflow must resolve before the certificate can be issued.
    { id: 'sd-10', schoolId: SCHOOL_ID, applicationId: null, studentId: 'u-s1', requiredDocumentTypeId: 'dt-birth-certificate', fileId: null, isOriginal: true, physicalLocationRoom: 'Records Room A', physicalLocationShelf: 'Shelf 1', physicalLocationFolder: 'A-012', receivedDate: '2019-04-10', status: 'HELD', returnedDate: null, returnedTo: null, returnReason: null, submittedById: 'u-st', createdAt: '2019-04-10T09:00:00.000Z' },
    { id: 'sd-11', schoolId: SCHOOL_ID, applicationId: null, studentId: 'u-s1', requiredDocumentTypeId: 'dt-transfer-certificate', fileId: null, isOriginal: true, physicalLocationRoom: 'Records Room A', physicalLocationShelf: 'Shelf 1', physicalLocationFolder: 'A-012', receivedDate: '2019-04-10', status: 'HELD', returnedDate: null, returnedTo: null, returnReason: null, submittedById: 'u-st', createdAt: '2019-04-10T09:05:00.000Z' },
    // A previously-resolved return, for contrast — shows the records report/checklist correctly excludes it.
    { id: 'sd-12', schoolId: SCHOOL_ID, applicationId: null, studentId: 'u-s3', requiredDocumentTypeId: 'dt-birth-certificate', fileId: null, isOriginal: true, physicalLocationRoom: 'Records Room A', physicalLocationShelf: 'Shelf 4', physicalLocationFolder: 'C-021', receivedDate: '2018-06-01', status: 'RETURNED', returnedDate: '2026-01-15', returnedTo: 'Father — Suresh Reddy', returnReason: null, submittedById: 'u-st', createdAt: '2018-06-01T09:00:00.000Z' },
  ] as Row[]

  // ── BoardRegistration — one per demo student, spanning Draft/Pending/Validated/SentToBoard. ──
  db.BoardRegistration = [
    { id: 'br-1', schoolId: SCHOOL_ID, studentId: 'u-s1', boardId: 'board-cbse', academicYearId: 'ay-2025', registrationNo: null, rollNo: '12', nameOnCertificate: 'Ravi Kumar', dob: '2010-05-14', affiliationNo: null, status: 'Pending', validatedById: null, validatedAt: null, sentAt: null, mismatchNote: null, createdAt: '2026-06-15T09:00:00.000Z', updatedAt: '2026-06-15T09:00:00.000Z' },
    { id: 'br-2', schoolId: SCHOOL_ID, studentId: 'u-s2', boardId: 'board-cbse', academicYearId: 'ay-2025', registrationNo: 'CBSE2026-0044', rollNo: '13', nameOnCertificate: 'Ananya Singh', dob: '2010-08-22', affiliationNo: '1234567', status: 'Validated', validatedById: 'u-ad', validatedAt: '2026-07-01T09:00:00.000Z', sentAt: null, mismatchNote: null, createdAt: '2026-06-15T09:05:00.000Z', updatedAt: '2026-07-01T09:00:00.000Z' },
    { id: 'br-3', schoolId: SCHOOL_ID, studentId: 'u-s3', boardId: 'board-state', academicYearId: 'ay-2025', registrationNo: 'MB2026-8891', rollNo: '05', nameOnCertificate: 'Karthik Reddy', dob: '2010-02-10', affiliationNo: '7654321', status: 'SentToBoard', validatedById: 'u-ad', validatedAt: '2026-06-20T09:00:00.000Z', sentAt: '2026-06-25T09:00:00.000Z', mismatchNote: null, createdAt: '2026-06-10T09:00:00.000Z', updatedAt: '2026-06-25T09:00:00.000Z' },
  ] as Row[]

  // ── Certificate — the Bonafide issued against app-5. ──
  db.Certificate = [
    { id: 'cert-1', schoolId: SCHOOL_ID, kind: 'Bonafide', studentId: 'u-s2', serialNo: 'EDN/Bonafide/2026/0001', issuedById: 'u-ad', issuedAt: '2026-07-02T13:20:00.000Z', pdfFileId: null, applicationId: 'app-5' },
  ] as Row[]

  // ── ParentVerification — the not-yet-verified parent (u-p2) has a document pending review. ──
  db.ParentVerification = [
    { id: 'pv-1', schoolId: SCHOOL_ID, parentId: 'u-p2', method: 'Document', status: 'Pending', documentFileId: null, verifiedById: null, verifiedAt: null, note: null, createdAt: '2026-08-25T10:00:00.000Z', updatedAt: '2026-08-25T10:00:00.000Z' },
  ] as Row[]
}

addSeedFragment(seedAdmissions)
