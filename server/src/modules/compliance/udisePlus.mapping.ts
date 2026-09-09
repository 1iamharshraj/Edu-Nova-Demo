// UDISE+ (Unified District Information System for Education Plus) field mapping.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// HONESTY CONSTRAINT — READ BEFORE CHANGING THIS FILE OR TRUSTING ITS OUTPUT:
//
// Nobody on this project has verified the exact current UDISE+ form field list, field codes, or
// exact labels against the live government portal (https://udiseplus.gov.in). The portal's form
// structure changes periodically (school years, module revisions). What follows is based on the
// well-documented PUBLIC SHAPE of UDISE+ data collection — grade-wise enrollment counts,
// teacher/staff headcounts and qualification bands, and a basic facility checklist — which is
// stable in general shape even though exact field codes drift year to year.
//
// EVERY SECTION BELOW MUST BE VERIFIED AGAINST THE CURRENT UDISE+ PORTAL BEFORE ANY REAL
// GOVERNMENT SUBMISSION. This module produces an ASSISTIVE EXPORT to speed up manual form-filling
// with real school data — it is NOT a government submission integration, and there is no public
// UDISE+ submission API this codebase talks to (even with credentials, none is offered by NIC/
// MoE). Treat every field code/label string in this file as "best guess, pending verification",
// never as a confirmed fact.
// ══════════════════════════════════════════════════════════════════════════════════════════════

// Bump this whenever the mapping shape changes (fields added/removed/re-derived), so exports always
// carry a visible provenance tag and older exports remain distinguishable from newer ones.
export const UDISE_MAPPING_VERSION = '2024-25-draft'

// A single mapped field: `sourceNote` documents exactly which Prisma fields/tables feed it (so
// gaps are visible in code, not hidden behind a number), `verified: false` is a hard flag — this
// codebase never marks a field verified without an actual portal cross-check by a human.
export interface UdiseField {
  /** Best-guess UDISE+ field code/label — VERIFY against the live portal. */
  udiseLabel: string
  /** Where this number/value actually comes from in this codebase. */
  sourceNote: string
  /** Always false here — no field in this file has been checked against the live portal. */
  verified: false
}

export interface UdiseGapField {
  udiseLabel: string
  /** Why this field cannot be populated from current data. */
  gapNote: string
  verified: false
}

// ─────────────────────────────── Section 1 — School Profile ───────────────────────────────
// VERIFY against current UDISE+ portal before real submission — field codes/exact labels may have
// changed. UDISE+ School Profile module typically asks for a UDISE school code, school category
// (co-ed/boys/girls), management type (govt/private-aided/private-unaided/etc.), affiliation
// board, and location details — most of which this codebase does not model at all (no UDISE code
// field, no management-type field, no address/location fields on School). We only populate what
// genuinely exists.
export const SCHOOL_PROFILE_MAP = {
  schoolName: {
    udiseLabel: 'School Name (Sec 1, Item 1.x)',
    sourceNote: 'School.name',
    verified: false,
  } satisfies UdiseField,
  affiliationBoards: {
    udiseLabel: 'Board(s) of Affiliation (Sec 1)',
    sourceNote: 'Board.name for all Board rows in this school (a school here may run multiple boards/classes)',
    verified: false,
  } satisfies UdiseField,
  udiseSchoolCode: {
    udiseLabel: 'UDISE School Code (Sec 1, Item 1.1)',
    gapNote: 'No udiseCode/government-registration field exists on the School model — this codebase has no place to store a government-issued school code. Admin must fill this in manually on the portal.',
    verified: false,
  } satisfies UdiseGapField,
  managementType: {
    udiseLabel: 'School Management Type (Sec 1, Item 1.5)',
    gapNote: 'Not modeled (govt/aided/unaided/etc. is not tracked anywhere in this schema).',
    verified: false,
  } satisfies UdiseGapField,
  location: {
    udiseLabel: 'Location / Address (Sec 1)',
    gapNote: 'School has no address/pincode/state/district fields in this schema.',
    verified: false,
  } satisfies UdiseGapField,
} as const

// ────────────────────── Section 2 — Enrollment by grade / gender / category ──────────────────────
// VERIFY against current UDISE+ portal before real submission — field codes/exact labels may have
// changed. UDISE+ typically wants enrollment broken down by grade × gender × social category
// (General/SC/ST/OBC/etc.) and sometimes by religion/disability status.
//
// What this codebase actually has: `Enrollment` rows link a student (`User`, role=student) to a
// `Class` (which has a `Grade`) for an `AcademicYear`. That is enough for GRADE-WISE headcounts.
//
// Gender and social category were checked directly against prisma/schema.prisma:
//   - `User` (the student model) has NO gender field. `Application.gender` exists only on the
//     admissions-intake model and is not carried onto the created student record, so it cannot be
//     used as an authoritative source for an enrolled student's gender.
//   - No model in this schema (`User`, `Guardian`, `Enrollment`) has a category/caste field.
// These are therefore GENUINE GAPS, not values we approximate — see `ENROLLMENT_GAPS` below. We
// export grade-wise totals only and flag gender/category as "not available in this system; fill in
// manually from admission records."
export const ENROLLMENT_MAP = {
  byGrade: {
    udiseLabel: 'Enrollment by Class/Grade (Sec 2, Table 2.1)',
    sourceNote: 'count of Enrollment rows (status=active) per Class.gradeId, for the selected AcademicYear',
    verified: false,
  } satisfies UdiseField,
  totalEnrollment: {
    udiseLabel: 'Total Enrollment (Sec 2)',
    sourceNote: 'count of Enrollment rows (status=active) for the selected AcademicYear',
    verified: false,
  } satisfies UdiseField,
} as const

export const ENROLLMENT_GAPS = {
  gender: {
    udiseLabel: 'Enrollment by Gender (Sec 2, Table 2.1)',
    gapNote: 'No gender field exists on the student User record in this schema (Application.gender exists only on the pre-admission intake form and is not copied onto the created student). Admin must source this from admission paperwork and fill in manually.',
    verified: false,
  } satisfies UdiseGapField,
  category: {
    udiseLabel: 'Enrollment by Social Category — General/SC/ST/OBC/Other (Sec 2, Table 2.1)',
    gapNote: 'No category/caste field exists anywhere in this schema (User, Guardian, Enrollment all checked). Admin must source this from admission paperwork and fill in manually.',
    verified: false,
  } satisfies UdiseGapField,
} as const

// ───────────────────────────── Section 3 — Teacher / Staff details ─────────────────────────────
// VERIFY against current UDISE+ portal before real submission — field codes/exact labels may have
// changed. UDISE+ typically wants teacher headcount by designation, and separately, qualification
// bands (below-graduate/graduate/post-graduate) and in-service training status/days.
//
// What this codebase actually has: `User` rows with role='teacher' (headcount), `User.designation`
// (free-text, set by admin — not a controlled UDISE qualification band), and `EmploymentHistoryEntry`
// (append-only log of Role/Designation/Department/Salary/ClassTeacherAssignment changes — see
// modules/employmentHistory/schema.ts CHANGE_TYPES). There is NO qualification field (degree level)
// and NO training-days/training-status field anywhere in this schema.
export const TEACHER_MAP = {
  teacherHeadcount: {
    udiseLabel: 'Total Teachers (Sec 3, Table 3.1)',
    sourceNote: "count of User rows with role='teacher' and active=true for this school",
    verified: false,
  } satisfies UdiseField,
  byDesignation: {
    udiseLabel: 'Teachers by Designation (Sec 3, Table 3.1)',
    sourceNote: 'grouped count of active User rows (role=teacher) by User.designation (free-text field set by admin — not a controlled UDISE designation code list)',
    verified: false,
  } satisfies UdiseField,
} as const

export const TEACHER_GAPS = {
  qualification: {
    udiseLabel: 'Teachers by Highest Qualification (Sec 3, Table 3.2)',
    gapNote: 'No qualification/degree-level field exists on User or EmploymentHistoryEntry. EmploymentHistoryEntry only logs Role/Designation/Department/Salary/ClassTeacherAssignment changes (see modules/employmentHistory/schema.ts CHANGE_TYPES) — academic qualifications were never captured. Admin must source this from HR files and fill in manually.',
    verified: false,
  } satisfies UdiseGapField,
  training: {
    udiseLabel: 'In-Service Training Received (Sec 3, Table 3.3)',
    gapNote: 'No training-days/training-status tracking exists anywhere in this schema. Admin must source this manually.',
    verified: false,
  } satisfies UdiseGapField,
} as const

// ─────────────────────────────────── Section 4 — Facilities ───────────────────────────────────
// VERIFY against current UDISE+ portal before real submission — field codes/exact labels may have
// changed. UDISE+ facilities checklist typically covers classroom count, library, playground,
// drinking water, toilets (boys/girls separately), electricity, ramp/accessibility, computer lab.
//
// What this codebase actually has: the `Room` model, with a free-text `kind` field (e.g.
// "classroom", set by whoever created the room — not a controlled UDISE facility taxonomy) and an
// optional `capacity`. There is no toilets/electricity/water/ramp/accessibility tracking anywhere.
export const FACILITIES_MAP = {
  totalRooms: {
    udiseLabel: 'Total Rooms (Sec 4)',
    sourceNote: 'count of Room rows for this school',
    verified: false,
  } satisfies UdiseField,
  byKind: {
    udiseLabel: 'Rooms by Type — e.g. classroom/lab/library (Sec 4, Table 4.1)',
    sourceNote: "grouped count of Room rows by Room.kind (free-text field, e.g. 'classroom' — not a controlled UDISE facility-type code list)",
    verified: false,
  } satisfies UdiseField,
} as const

export const FACILITIES_GAPS = {
  toilets: {
    udiseLabel: 'Toilets — Boys/Girls, Functional (Sec 4, Table 4.2)',
    gapNote: 'Not tracked anywhere in this schema.',
    verified: false,
  } satisfies UdiseGapField,
  drinkingWater: {
    udiseLabel: 'Drinking Water Availability (Sec 4)',
    gapNote: 'Not tracked anywhere in this schema.',
    verified: false,
  } satisfies UdiseGapField,
  electricity: {
    udiseLabel: 'Electricity Availability (Sec 4)',
    gapNote: 'Not tracked anywhere in this schema.',
    verified: false,
  } satisfies UdiseGapField,
  accessibility: {
    udiseLabel: 'Ramp / Accessibility for Disabled (Sec 4)',
    gapNote: 'Not tracked anywhere in this schema.',
    verified: false,
  } satisfies UdiseGapField,
} as const

// One object tying every section together for the export service / UI to walk generically.
export const UDISE_FIELD_MAP = {
  version: UDISE_MAPPING_VERSION,
  schoolProfile: SCHOOL_PROFILE_MAP,
  enrollment: ENROLLMENT_MAP,
  enrollmentGaps: ENROLLMENT_GAPS,
  teacher: TEACHER_MAP,
  teacherGaps: TEACHER_GAPS,
  facilities: FACILITIES_MAP,
  facilitiesGaps: FACILITIES_GAPS,
} as const
