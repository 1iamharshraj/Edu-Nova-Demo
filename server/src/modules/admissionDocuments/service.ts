import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { assertFileIds } from '../files/service'
import { fmtDate, toDate } from '../../lib/validate'
import type {
  createAdmissionCategory, patchAdmissionCategory, createRequiredDocumentType, patchRequiredDocumentType,
  createSubmittedDocument, patchSubmittedDocument, documentQuery, recordsReportQuery,
} from './schema'

// ═══════════════════════════ AdmissionCategory ═══════════════════════════

export const serializeCategory = (c: { id: string; name: string; code: string; requiresCertificate: boolean; isActive: boolean }) => ({
  id: c.id, name: c.name, code: c.code, requiresCertificate: c.requiresCertificate, isActive: c.isActive,
})

export function listCategories(ctx: Ctx, activeOnly = false) {
  return prisma.admissionCategory.findMany({ where: { schoolId: ctx.schoolId, isActive: activeOnly ? true : undefined }, orderBy: [{ name: 'asc' }] })
}

export async function createCategory(ctx: Ctx, input: z.infer<typeof createAdmissionCategory>) {
  const row = await prisma.admissionCategory.create({
    data: { schoolId: ctx.schoolId, name: input.name, code: input.code.toUpperCase(), requiresCertificate: input.requiresCertificate ?? false },
  }).catch(e => { throw e?.code === 'P2002' ? new HttpError(409, 'An admission category with that code already exists') : e })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'admissionCategory', row.id, undefined, serializeCategory(row))
  return row
}

export async function updateCategory(ctx: Ctx, id: string, input: z.infer<typeof patchAdmissionCategory>) {
  const before = await prisma.admissionCategory.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Admission category')
  const row = await prisma.admissionCategory.update({
    where: { id },
    data: { name: input.name, code: input.code ? input.code.toUpperCase() : undefined, requiresCertificate: input.requiresCertificate, isActive: input.isActive },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'admissionCategory', id, serializeCategory(before), serializeCategory(row))
  return row
}

// Seeded default set — India-specific reservation/quota categories. Skips codes that already exist, so
// it's safe to call more than once (mirrors modules/capabilities/service.ts#seedDefaults).
export const DEFAULT_ADMISSION_CATEGORIES: Array<{ name: string; code: string; requiresCertificate: boolean }> = [
  { name: 'General', code: 'GENERAL', requiresCertificate: false },
  { name: 'Scheduled Caste (SC)', code: 'SC', requiresCertificate: true },
  { name: 'Scheduled Tribe (ST)', code: 'ST', requiresCertificate: true },
  { name: 'Other Backward Class (OBC)', code: 'OBC', requiresCertificate: true },
  { name: 'Economically Weaker Section (EWS)', code: 'EWS', requiresCertificate: true },
  { name: 'RTE 25% Quota', code: 'RTE', requiresCertificate: true },
  { name: 'Management Quota', code: 'MANAGEMENT', requiresCertificate: false },
  { name: 'Staff-Ward', code: 'STAFF_WARD', requiresCertificate: false },
  { name: 'Sports/Talent Quota', code: 'SPORTS_TALENT', requiresCertificate: true },
  { name: 'Minority', code: 'MINORITY', requiresCertificate: true },
  { name: 'Defense / Ex-servicemen', code: 'DEFENSE', requiresCertificate: true },
]

export async function seedDefaultCategories(ctx: Ctx) {
  const existing = new Set((await listCategories(ctx)).map(c => c.code))
  const missing = DEFAULT_ADMISSION_CATEGORIES.filter(c => !existing.has(c.code))
  for (const c of missing) await createCategory(ctx, c)
  return missing.length
}

// ═══════════════════════════ RequiredDocumentType ═══════════════════════════

export const serializeDocType = (d: {
  id: string; name: string; code: string; requiredIfCategoryIn: string[]; requiredIfAdmissionMode: string[];
  requiredIfBoardChanged: boolean; alwaysRequired: boolean; isActive: boolean
}) => ({
  id: d.id, name: d.name, code: d.code, requiredIfCategoryIn: d.requiredIfCategoryIn, requiredIfAdmissionMode: d.requiredIfAdmissionMode,
  requiredIfBoardChanged: d.requiredIfBoardChanged, alwaysRequired: d.alwaysRequired, isActive: d.isActive,
})

export function listDocTypes(ctx: Ctx, activeOnly = false) {
  return prisma.requiredDocumentType.findMany({ where: { schoolId: ctx.schoolId, isActive: activeOnly ? true : undefined }, orderBy: [{ name: 'asc' }] })
}

export async function createDocType(ctx: Ctx, input: z.infer<typeof createRequiredDocumentType>) {
  const row = await prisma.requiredDocumentType.create({
    data: {
      schoolId: ctx.schoolId, name: input.name, code: input.code.toUpperCase(),
      requiredIfCategoryIn: (input.requiredIfCategoryIn ?? []).map(c => c.toUpperCase()),
      requiredIfAdmissionMode: input.requiredIfAdmissionMode ?? [],
      requiredIfBoardChanged: input.requiredIfBoardChanged ?? false, alwaysRequired: input.alwaysRequired ?? false,
    },
  }).catch(e => { throw e?.code === 'P2002' ? new HttpError(409, 'A required document type with that code already exists') : e })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'requiredDocumentType', row.id, undefined, serializeDocType(row))
  return row
}

export async function updateDocType(ctx: Ctx, id: string, input: z.infer<typeof patchRequiredDocumentType>) {
  const before = await prisma.requiredDocumentType.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Required document type')
  const row = await prisma.requiredDocumentType.update({
    where: { id },
    data: {
      name: input.name, code: input.code ? input.code.toUpperCase() : undefined,
      requiredIfCategoryIn: input.requiredIfCategoryIn ? input.requiredIfCategoryIn.map(c => c.toUpperCase()) : undefined,
      requiredIfAdmissionMode: input.requiredIfAdmissionMode, requiredIfBoardChanged: input.requiredIfBoardChanged,
      alwaysRequired: input.alwaysRequired, isActive: input.isActive,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'requiredDocumentType', id, serializeDocType(before), serializeDocType(row))
  return row
}

// Seeded default catalog covering the standard Indian school admission document set (see
// phase-t2-strong-admissions.md Part B). Conditions are a best-effort structured default — every type
// remains school-editable afterward. Skips codes that already exist.
export const DEFAULT_DOCUMENT_TYPES: Array<{
  name: string; code: string; requiredIfCategoryIn?: string[]; requiredIfAdmissionMode?: string[]; requiredIfBoardChanged?: boolean; alwaysRequired?: boolean
}> = [
  { name: 'Birth Certificate', code: 'BIRTH_CERTIFICATE', alwaysRequired: true },
  { name: 'Transfer Certificate (previous school)', code: 'TRANSFER_CERTIFICATE' },
  { name: 'Previous school report cards / mark sheets', code: 'PREVIOUS_MARKSHEET' },
  { name: 'Migration Certificate', code: 'MIGRATION_CERTIFICATE', requiredIfBoardChanged: true },
  { name: 'Character Certificate', code: 'CHARACTER_CERTIFICATE' },
  { name: 'Aadhaar Card Copy', code: 'AADHAAR_COPY', alwaysRequired: true },
  { name: 'Passport Photographs', code: 'PASSPORT_PHOTOS', alwaysRequired: true },
  { name: 'Address Proof', code: 'ADDRESS_PROOF', alwaysRequired: true },
  { name: 'Caste Certificate', code: 'CASTE_CERTIFICATE', requiredIfCategoryIn: ['SC', 'ST', 'OBC', 'EWS'] },
  { name: 'Income Certificate', code: 'INCOME_CERTIFICATE', requiredIfCategoryIn: ['EWS', 'RTE'] },
  { name: 'Domicile / Residence Certificate', code: 'DOMICILE_CERTIFICATE', requiredIfCategoryIn: ['RTE'] },
  { name: 'Disability Certificate', code: 'DISABILITY_CERTIFICATE' },
  { name: 'Minority Certificate', code: 'MINORITY_CERTIFICATE', requiredIfCategoryIn: ['MINORITY'] },
  { name: 'RTE Allotment Letter', code: 'RTE_ALLOTMENT_LETTER', requiredIfAdmissionMode: ['RTE'] },
  { name: 'Medical / Immunization / Fitness Certificate', code: 'MEDICAL_CERTIFICATE' },
  { name: 'Bank Passbook Copy', code: 'BANK_PASSBOOK', requiredIfAdmissionMode: ['RTE'] },
  { name: 'Sports / Extracurricular Achievement Certificate', code: 'SPORTS_CERTIFICATE', requiredIfCategoryIn: ['SPORTS_TALENT'] },
  { name: "Parent ID / Employment Proof", code: 'PARENT_EMPLOYMENT_PROOF', requiredIfCategoryIn: ['STAFF_WARD'] },
  { name: 'Fee Clearance / No-Dues Certificate (previous school)', code: 'FEE_CLEARANCE', requiredIfBoardChanged: true },
  { name: 'Declaration / Undertaking', code: 'DECLARATION_UNDERTAKING', alwaysRequired: true },
]

export async function seedDefaultDocTypes(ctx: Ctx) {
  const existing = new Set((await listDocTypes(ctx)).map(d => d.code))
  const missing = DEFAULT_DOCUMENT_TYPES.filter(d => !existing.has(d.code))
  for (const d of missing) await createDocType(ctx, d)
  return missing.length
}

// ═══════════════════════════ AdmissionSettings ═══════════════════════════

export async function getSettings(ctx: Ctx) {
  const row = await prisma.admissionSettings.findUnique({ where: { schoolId: ctx.schoolId } })
  return { admissionDocumentsBlockApproval: row?.admissionDocumentsBlockApproval ?? false }
}

export async function setSettings(ctx: Ctx, admissionDocumentsBlockApproval: boolean) {
  const before = await getSettings(ctx)
  const row = await prisma.admissionSettings.upsert({
    where: { schoolId: ctx.schoolId },
    create: { schoolId: ctx.schoolId, admissionDocumentsBlockApproval },
    update: { admissionDocumentsBlockApproval },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'admissionSettings', row.id, before, { admissionDocumentsBlockApproval: row.admissionDocumentsBlockApproval })
  return { admissionDocumentsBlockApproval: row.admissionDocumentsBlockApproval }
}

// ═══════════════════════════ SubmittedDocument ═══════════════════════════

export const serializeSubmittedDocument = (d: {
  id: string; applicationId: string | null; studentId: string | null; requiredDocumentTypeId: string | null; fileId: string | null;
  isOriginal: boolean; physicalLocationRoom: string | null; physicalLocationShelf: string | null; physicalLocationFolder: string | null;
  receivedDate: Date | null; status: string; returnedDate: Date | null; returnedTo: string | null; returnReason: string | null;
  submittedById: string | null; createdAt: Date
}) => ({
  id: d.id, applicationId: d.applicationId ?? undefined, studentId: d.studentId ?? undefined, requiredDocumentTypeId: d.requiredDocumentTypeId ?? undefined,
  fileId: d.fileId ?? undefined, isOriginal: d.isOriginal, physicalLocationRoom: d.physicalLocationRoom ?? undefined,
  physicalLocationShelf: d.physicalLocationShelf ?? undefined, physicalLocationFolder: d.physicalLocationFolder ?? undefined,
  receivedDate: d.receivedDate ? fmtDate(d.receivedDate) : undefined, status: d.status, returnedDate: d.returnedDate ? fmtDate(d.returnedDate) : undefined,
  returnedTo: d.returnedTo ?? undefined, returnReason: d.returnReason ?? undefined, submittedById: d.submittedById ?? undefined, createdAt: d.createdAt.toISOString(),
})

async function assertApplication(ctx: Ctx, applicationId: string) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, schoolId: ctx.schoolId } })
  if (!app) throw notFound('Application')
  return app
}

async function assertStudent(ctx: Ctx, studentId: string) {
  const s = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!s) throw notFound('Student')
  return s
}

export async function listSubmittedDocuments(ctx: Ctx, q: z.infer<typeof documentQuery>) {
  return prisma.submittedDocument.findMany({
    where: { schoolId: ctx.schoolId, applicationId: q.applicationId, studentId: q.studentId, status: q.status },
    orderBy: [{ createdAt: 'desc' }],
  })
}

export async function submitDocument(ctx: Ctx, input: z.infer<typeof createSubmittedDocument>) {
  if (input.applicationId) await assertApplication(ctx, input.applicationId)
  if (input.studentId) await assertStudent(ctx, input.studentId)
  if (input.requiredDocumentTypeId) {
    const dt = await prisma.requiredDocumentType.findFirst({ where: { id: input.requiredDocumentTypeId, schoolId: ctx.schoolId } })
    if (!dt) throw notFound('Required document type')
  }
  if (input.fileId) await assertFileIds(ctx, [input.fileId])
  const row = await prisma.submittedDocument.create({
    data: {
      schoolId: ctx.schoolId, applicationId: input.applicationId ?? null, studentId: input.studentId ?? null,
      requiredDocumentTypeId: input.requiredDocumentTypeId ?? null, fileId: input.fileId ?? null, isOriginal: input.isOriginal ?? false,
      physicalLocationRoom: input.physicalLocationRoom ?? null, physicalLocationShelf: input.physicalLocationShelf ?? null,
      physicalLocationFolder: input.physicalLocationFolder ?? null, receivedDate: input.receivedDate ? toDate(input.receivedDate) : null,
      status: input.status ?? 'HELD', submittedById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'submit', 'submittedDocument', row.id, undefined, serializeSubmittedDocument(row))
  return row
}

async function getOwnedDocument(ctx: Ctx, id: string) {
  const row = await prisma.submittedDocument.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Submitted document')
  return row
}

export async function updateSubmittedDocument(ctx: Ctx, id: string, input: z.infer<typeof patchSubmittedDocument>) {
  const before = await getOwnedDocument(ctx, id)
  if (input.requiredDocumentTypeId) {
    const dt = await prisma.requiredDocumentType.findFirst({ where: { id: input.requiredDocumentTypeId, schoolId: ctx.schoolId } })
    if (!dt) throw notFound('Required document type')
  }
  if (input.fileId) await assertFileIds(ctx, [input.fileId])
  const row = await prisma.submittedDocument.update({
    where: { id },
    data: {
      requiredDocumentTypeId: input.requiredDocumentTypeId === undefined ? undefined : input.requiredDocumentTypeId,
      fileId: input.fileId === undefined ? undefined : input.fileId, isOriginal: input.isOriginal,
      physicalLocationRoom: input.physicalLocationRoom, physicalLocationShelf: input.physicalLocationShelf, physicalLocationFolder: input.physicalLocationFolder,
      receivedDate: input.receivedDate === undefined ? undefined : input.receivedDate ? toDate(input.receivedDate) : null,
      status: input.status,
    },
  })
  const statusChanged = input.status && input.status !== before.status
  await audit(ctx.schoolId, ctx.actorId, statusChanged ? 'status-change' : 'update', 'submittedDocument', id, serializeSubmittedDocument(before), serializeSubmittedDocument(row))
  return row
}

export async function returnDocument(ctx: Ctx, id: string, returnedTo: string, returnReason?: string) {
  const before = await getOwnedDocument(ctx, id)
  if (before.status === 'RETURNED') throw new HttpError(409, 'Document is already marked returned')
  const row = await prisma.submittedDocument.update({
    where: { id }, data: { status: 'RETURNED', returnedDate: new Date(), returnedTo, returnReason: returnReason ?? null },
  })
  await audit(ctx.schoolId, ctx.actorId, 'status-change', 'submittedDocument', id, serializeSubmittedDocument(before), serializeSubmittedDocument(row))
  return row
}

export async function markLost(ctx: Ctx, id: string, reason?: string) {
  const before = await getOwnedDocument(ctx, id)
  const row = await prisma.submittedDocument.update({ where: { id }, data: { status: 'LOST', returnReason: reason ?? before.returnReason } })
  await audit(ctx.schoolId, ctx.actorId, 'status-change', 'submittedDocument', id, serializeSubmittedDocument(before), serializeSubmittedDocument(row))
  return row
}

export async function removeSubmittedDocument(ctx: Ctx, id: string) {
  const before = await getOwnedDocument(ctx, id)
  await prisma.submittedDocument.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'submittedDocument', id, serializeSubmittedDocument(before))
}

// ═══════════════════════════ Completeness checklist ═══════════════════════════

function evaluateRequired(
  dt: { alwaysRequired: boolean; requiredIfCategoryIn: string[]; requiredIfAdmissionMode: string[]; requiredIfBoardChanged: boolean },
  ctx: { categoryCode?: string | null; admissionMode?: string | null; boardChanged: boolean },
) {
  if (dt.alwaysRequired) return true
  if (ctx.categoryCode && dt.requiredIfCategoryIn.includes(ctx.categoryCode)) return true
  if (ctx.admissionMode && dt.requiredIfAdmissionMode.includes(ctx.admissionMode)) return true
  if (dt.requiredIfBoardChanged && ctx.boardChanged) return true
  return false
}

export async function checklist(ctx: Ctx, applicationId: string) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, schoolId: ctx.schoolId }, include: { admissionCategory: true } })
  if (!app) throw notFound('Application')
  const [docTypes, submitted, settings] = await Promise.all([
    listDocTypes(ctx, true),
    prisma.submittedDocument.findMany({ where: { schoolId: ctx.schoolId, OR: [{ applicationId }, ...(app.studentId ? [{ studentId: app.studentId }] : [])] } }),
    getSettings(ctx),
  ])
  const boardChanged = !!(app.previousBoardId && app.targetBoardId && app.previousBoardId !== app.targetBoardId)
  const evalCtx = { categoryCode: app.admissionCategory?.code ?? null, admissionMode: app.admissionMode ?? null, boardChanged }

  const submittedByType = new Map<string, typeof submitted[number]>()
  for (const s of submitted) if (s.requiredDocumentTypeId) submittedByType.set(s.requiredDocumentTypeId, s)

  const items = docTypes.map(dt => {
    const required = evaluateRequired(dt, evalCtx)
    const sub = submittedByType.get(dt.id)
    return {
      requiredDocumentTypeId: dt.id, name: dt.name, code: dt.code, required, submitted: !!sub,
      submittedDocumentId: sub?.id, status: sub?.status,
    }
  })
  const missingRequired = items.filter(i => i.required && !i.submitted).map(i => i.name)
  const extraDocuments = submitted.filter(s => !s.requiredDocumentTypeId).map(serializeSubmittedDocument)

  return {
    applicationId, admissionDocumentsBlockApproval: settings.admissionDocumentsBlockApproval,
    items, missingRequired, complete: missingRequired.length === 0, extraDocuments,
  }
}

// ═══════════════════════════ Records report (physical custody) ═══════════════════════════

export async function recordsReport(ctx: Ctx, q: z.infer<typeof recordsReportQuery>) {
  const rows = await prisma.submittedDocument.findMany({
    where: {
      schoolId: ctx.schoolId, isOriginal: true, status: 'HELD',
      physicalLocationRoom: q.room ? { contains: q.room, mode: 'insensitive' } : undefined,
      physicalLocationShelf: q.shelf ? { contains: q.shelf, mode: 'insensitive' } : undefined,
      ...(q.studentId ? { OR: [{ studentId: q.studentId }, { application: { studentId: q.studentId } }] } : {}),
    },
    include: {
      requiredDocumentType: { select: { id: true, name: true, code: true } },
      student: { select: { id: true, name: true } },
      application: { select: { id: true, applicantName: true, studentId: true } },
    },
    orderBy: [{ physicalLocationRoom: 'asc' }, { physicalLocationShelf: 'asc' }, { physicalLocationFolder: 'asc' }],
  })
  return rows.map(r => ({
    ...serializeSubmittedDocument(r),
    documentTypeName: r.requiredDocumentType?.name, documentTypeCode: r.requiredDocumentType?.code,
    studentName: r.student?.name ?? undefined, applicantName: r.application?.applicantName ?? undefined,
    resolvedStudentId: r.studentId ?? r.application?.studentId ?? undefined,
  }))
}

// ═══════════════════════════ TC-issuance document-return workflow ═══════════════════════════
// Shared with modules/applications/service.ts#approve — held originals for a student (matched either
// directly by studentId or via the Application they were submitted against) must each be explicitly
// resolved (RETURNED, with returnedTo — or an acknowledged exception) before/while a TC is issued. See
// phase-t2-strong-admissions.md Part B, "TC-issuance document-return workflow".

export async function heldOriginals(ctx: Ctx, studentId: string) {
  return prisma.submittedDocument.findMany({
    where: { schoolId: ctx.schoolId, isOriginal: true, status: 'HELD', OR: [{ studentId }, { application: { studentId } }] },
    include: { requiredDocumentType: { select: { id: true, name: true, code: true } } },
    orderBy: [{ createdAt: 'asc' }],
  })
}

export interface DocumentReturnResolution { submittedDocumentId: string; action: 'RETURNED' | 'EXCEPTION'; returnedTo?: string; exceptionReason?: string }

// Applies the staff's resolution for every held original ahead of a TC issuance. Throws 409 (with the
// still-outstanding list in `extra.outstanding`) if any held original is left unresolved — "never silently
// proceed past held originals without an explicit decision either way" per the spec.
export async function resolveHeldOriginalsForTc(ctx: Ctx, studentId: string, resolutions: DocumentReturnResolution[] = []) {
  const held = await heldOriginals(ctx, studentId)
  if (held.length === 0) return { resolved: 0, held: [] as typeof held }

  const byId = new Map(resolutions.map(r => [r.submittedDocumentId, r]))
  const outstanding = held.filter(h => !byId.has(h.id))
  if (outstanding.length > 0) {
    throw new HttpError(409, 'Held original documents must be returned or an exception acknowledged before TC issuance', undefined, {
      outstanding: outstanding.map(h => ({
        id: h.id, name: h.requiredDocumentType?.name ?? 'Document', physicalLocationRoom: h.physicalLocationRoom,
        physicalLocationShelf: h.physicalLocationShelf, physicalLocationFolder: h.physicalLocationFolder,
      })),
    })
  }

  for (const doc of held) {
    const r = byId.get(doc.id)!
    if (r.action === 'RETURNED') {
      if (!r.returnedTo?.trim()) throw new HttpError(400, `returnedTo is required to mark document ${doc.id} returned`)
      const before = serializeSubmittedDocument(doc)
      const row = await prisma.submittedDocument.update({ where: { id: doc.id }, data: { status: 'RETURNED', returnedDate: new Date(), returnedTo: r.returnedTo, returnReason: r.exceptionReason ?? null } })
      await audit(ctx.schoolId, ctx.actorId, 'status-change', 'submittedDocument', doc.id, before, serializeSubmittedDocument(row))
    } else {
      if (!r.exceptionReason?.trim()) throw new HttpError(400, `exceptionReason is required to acknowledge an exception for document ${doc.id}`)
      const before = serializeSubmittedDocument(doc)
      const row = await prisma.submittedDocument.update({ where: { id: doc.id }, data: { returnReason: `[TC exception] ${r.exceptionReason}` } })
      await audit(ctx.schoolId, ctx.actorId, 'status-change', 'submittedDocument', doc.id, before, serializeSubmittedDocument(row))
    }
  }
  return { resolved: held.length, held }
}
