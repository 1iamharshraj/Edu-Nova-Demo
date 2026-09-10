import { z } from 'zod'
import { idStr, dateStr } from '../../lib/validate'

// See phase-t2-strong-admissions.md Part B.

export const DOCUMENT_STATUSES = ['HELD', 'RETURNED', 'LOST', 'NOT_APPLICABLE'] as const

// ───────────────────────────── AdmissionCategory (school-editable quota/reservation catalog) ─────────────────────────────

export const createAdmissionCategory = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(40),
  requiresCertificate: z.boolean().optional(),
})
export const patchAdmissionCategory = createAdmissionCategory.partial().extend({ isActive: z.boolean().optional() })

// ───────────────────────────── RequiredDocumentType (school-editable, condition-flagged catalog) ─────────────────────────────

export const createRequiredDocumentType = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(40),
  // AdmissionCategory `code`s — evaluated as plain flags, not a relation (see schema.prisma comment).
  requiredIfCategoryIn: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  requiredIfAdmissionMode: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  requiredIfBoardChanged: z.boolean().optional(),
  alwaysRequired: z.boolean().optional(),
})
export const patchRequiredDocumentType = createRequiredDocumentType.partial().extend({ isActive: z.boolean().optional() })

// ───────────────────────────── SubmittedDocument (digital scan link + physical custody) ─────────────────────────────

export const createSubmittedDocument = z.object({
  applicationId: idStr.optional(),
  studentId: idStr.optional(),
  requiredDocumentTypeId: idStr.optional(),
  fileId: idStr.optional(),
  isOriginal: z.boolean().optional(),
  physicalLocationRoom: z.string().trim().max(80).optional(),
  physicalLocationShelf: z.string().trim().max(80).optional(),
  physicalLocationFolder: z.string().trim().max(80).optional(),
  receivedDate: dateStr.optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
}).refine(v => !!(v.applicationId || v.studentId), { message: 'applicationId or studentId is required' })

export const patchSubmittedDocument = z.object({
  requiredDocumentTypeId: idStr.nullable().optional(),
  fileId: idStr.nullable().optional(),
  isOriginal: z.boolean().optional(),
  physicalLocationRoom: z.string().trim().max(80).nullable().optional(),
  physicalLocationShelf: z.string().trim().max(80).nullable().optional(),
  physicalLocationFolder: z.string().trim().max(80).nullable().optional(),
  receivedDate: dateStr.nullable().optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
})

export const returnDocumentBody = z.object({
  returnedTo: z.string().trim().min(1).max(160),
  returnReason: z.string().trim().max(500).optional(),
})

export const lostDocumentBody = z.object({ reason: z.string().trim().max(500).optional() })

export const documentQuery = z.object({
  applicationId: idStr.optional(),
  studentId: idStr.optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
})

export const recordsReportQuery = z.object({
  room: z.string().trim().optional(),
  shelf: z.string().trim().optional(),
  studentId: idStr.optional(),
})

export const admissionSettingsBody = z.object({ admissionDocumentsBlockApproval: z.boolean() })
