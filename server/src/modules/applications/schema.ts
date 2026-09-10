import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

export const APPLICATION_KINDS = ['Admission', 'TC', 'Bonafide', 'Character'] as const
export const APPLICATION_STATUSES = ['Pending', 'Verified', 'Approved', 'Declined'] as const
export type ApplicationKind = (typeof APPLICATION_KINDS)[number]

export const guardianInfo = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().optional(),
  relation: z.string().trim().max(40).optional(),
})

// ── Phase T2 Part A — admission data expansion. See phase-t2-strong-admissions.md. ──

export const priorSubjectScore = z.object({
  subjectName: z.string().trim().min(1).max(120),
  score: z.number().min(0),
  maxScore: z.number().positive(),
})

// Free-text axis distinct from AdmissionCategory (a category like SC/OBC/RTE is the reservation basis;
// admissionMode is *how* the seat was allotted — Regular vs the government RTE lottery vs a Management/
// Staff-Ward internal allotment) — RequiredDocumentType.requiredIfAdmissionMode keys off this.
export const ADMISSION_MODES = ['Regular', 'RTE', 'Management', 'Staff-Ward'] as const

export const healthFlags = z.object({
  allergies: z.string().trim().max(2000).optional(),
  conditions: z.string().trim().max(2000).optional(),
  bloodGroup: z.string().trim().max(10).optional(),
})

// Admission: applicantName + guardian required, targetClassId required at approval time.
// TC / Bonafide / Character: studentId required (applicantName defaults to the student's name).
export const createApplication = z.object({
  kind: z.enum(APPLICATION_KINDS),
  applicantName: z.string().trim().min(1).max(120).optional(),
  dob: dateStr.nullable().optional(),
  gender: z.string().trim().max(20).nullable().optional(),
  guardian: guardianInfo.nullable().optional(),
  targetClassId: idStr.nullable().optional(),
  targetBoardId: idStr.nullable().optional(),
  studentId: idStr.optional(),
  documents: z.array(idStr).max(20).optional(),
  notes: z.string().max(2000).nullable().optional(),

  // Part A additions — all optional/nullable, strict superset of the existing shape.
  previousSchoolName: z.string().trim().max(200).nullable().optional(),
  previousBoardId: idStr.nullable().optional(),
  lastGradeCompleted: z.string().trim().max(40).nullable().optional(),
  priorSubjectScores: z.array(priorSubjectScore).max(20).optional(),
  declaredTrackPreference: z.string().trim().max(120).nullable().optional(),
  siblingStudentId: idStr.nullable().optional(),
  admissionCategoryId: idStr.nullable().optional(),
  admissionMode: z.enum(ADMISSION_MODES).nullable().optional(),
  healthFlags: healthFlags.nullable().optional(),
  transportRequired: z.boolean().optional(),
  transportPreferredArea: z.string().trim().max(200).nullable().optional(),
})

export const patchApplication = createApplication.omit({ kind: true, studentId: true }).partial()

export const listQuery = z.object({
  kind: z.enum(APPLICATION_KINDS).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
})

export const declineBody = z.object({ notes: z.string().max(2000).optional() })

// Phase 13 integration: a TC approval may optionally also convert the student to an alumnus in the same
// action (see phase-13-alumni.md — "offer conversion at TC-issuance time"). Ignored for non-TC kinds.
// Phase T2 Part B — TC-issuance document-return workflow: when approving a TC application, staff must
// resolve every held original on file for that student (see modules/admissionDocuments/service.ts#
// resolveHeldOriginalsForTc). Ignored for non-TC kinds.
export const documentReturnResolution = z.object({
  submittedDocumentId: idStr,
  action: z.enum(['RETURNED', 'EXCEPTION']),
  returnedTo: z.string().trim().max(160).optional(),
  exceptionReason: z.string().trim().max(500).optional(),
})

export const approveBody = z.object({
  convertToAlumni: z.boolean().optional(),
  alumniGraduationYear: z.number().int().min(1950).max(2100).optional(),
  documentReturns: z.array(documentReturnResolution).max(50).optional(),
})

// Sibling-suggestion lookup — siblings are derivable via a shared Guardian contact (phone/email), so this
// is a query, not a stored field (see modules/applications/service.ts#siblingSuggestions).
export const siblingSuggestQuery = z.object({
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(160).optional(),
})

export const transportHandledBody = z.object({ note: z.string().trim().max(500).optional() })
