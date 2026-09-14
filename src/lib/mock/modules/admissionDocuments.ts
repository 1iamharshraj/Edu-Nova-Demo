// Mirrors server/src/modules/admissionDocuments's contract: the school-editable AdmissionCategory
// (quota/reservation) and RequiredDocumentType (conditional-requirement) catalogs, AdmissionSettings,
// SubmittedDocument CRUD + return/lost actions, the per-application completeness checklist, the
// TC-issuance held-originals preview + resolution (the latter also called directly by
// modules/applications.ts#approve, same as the real service.ts is imported by applications/service.ts),
// and the physical-custody records report. See .agents/edunova/static-demo-plan.md.

import { route, requireRole, status, type Actor } from '../router'
import { badRequest, conflict, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']

/* ═══════════════════════════ AdmissionCategory ═══════════════════════════ */

function serializeCategory(c: Row) {
  return { id: c.id, name: c.name, code: c.code, requiresCertificate: !!c.requiresCertificate, isActive: c.isActive !== false }
}

const DEFAULT_ADMISSION_CATEGORIES: Array<{ name: string; code: string; requiresCertificate: boolean }> = [
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

route('GET', '/admission-documents/categories', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const items = table('AdmissionCategory').filter(c => c.schoolId === actor.schoolId).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { items: items.map(serializeCategory) }
})

route('POST', '/admission-documents/categories', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const body = ctx.body as { name?: string; code?: string; requiresCertificate?: boolean }
  if (!body.name?.trim()) throw badRequest('name is required')
  const code = (body.code?.trim() || body.name.trim()).toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const rows = table('AdmissionCategory')
  if (rows.some(c => c.schoolId === actor.schoolId && c.code === code)) throw conflict('An admission category with that code already exists')
  const row: Row = { id: uid('admissioncategory'), schoolId: actor.schoolId, name: body.name.trim(), code, requiresCertificate: !!body.requiresCertificate, isActive: true, createdAt: nowIso() }
  rows.push(row)
  saveTable('AdmissionCategory', rows)
  return status(201, { item: serializeCategory(row) })
})

route('PATCH', '/admission-documents/categories/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('AdmissionCategory')
  const idx = rows.findIndex(c => c.id === ctx.params.id && c.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Admission category')
  const body = ctx.body as { name?: string; code?: string; requiresCertificate?: boolean; isActive?: boolean }
  rows[idx] = {
    ...rows[idx],
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.code !== undefined ? { code: body.code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_') } : {}),
    ...(body.requiresCertificate !== undefined ? { requiresCertificate: body.requiresCertificate } : {}),
    ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
  }
  saveTable('AdmissionCategory', rows)
  return { item: serializeCategory(rows[idx]) }
})

route('POST', '/admission-documents/categories/seed-defaults', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('AdmissionCategory')
  const existing = new Set(rows.filter(c => c.schoolId === actor.schoolId).map(c => c.code))
  const missing = DEFAULT_ADMISSION_CATEGORIES.filter(c => !existing.has(c.code))
  for (const c of missing) rows.push({ id: uid('admissioncategory'), schoolId: actor.schoolId, name: c.name, code: c.code, requiresCertificate: c.requiresCertificate, isActive: true, createdAt: nowIso() })
  saveTable('AdmissionCategory', rows)
  return { added: missing.length }
})

/* ═══════════════════════════ RequiredDocumentType ═══════════════════════════ */

function serializeDocType(d: Row) {
  return {
    id: d.id, name: d.name, code: d.code,
    requiredIfCategoryIn: (d.requiredIfCategoryIn as string[] | undefined) ?? [],
    requiredIfAdmissionMode: (d.requiredIfAdmissionMode as string[] | undefined) ?? [],
    requiredIfBoardChanged: !!d.requiredIfBoardChanged, alwaysRequired: !!d.alwaysRequired, isActive: d.isActive !== false,
  }
}

const DEFAULT_DOCUMENT_TYPES: Array<{ name: string; code: string; requiredIfCategoryIn?: string[]; requiredIfAdmissionMode?: string[]; requiredIfBoardChanged?: boolean; alwaysRequired?: boolean }> = [
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
  { name: 'Parent ID / Employment Proof', code: 'PARENT_EMPLOYMENT_PROOF', requiredIfCategoryIn: ['STAFF_WARD'] },
  { name: 'Fee Clearance / No-Dues Certificate (previous school)', code: 'FEE_CLEARANCE', requiredIfBoardChanged: true },
  { name: 'Declaration / Undertaking', code: 'DECLARATION_UNDERTAKING', alwaysRequired: true },
]

route('GET', '/admission-documents/types', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const items = table('RequiredDocumentType').filter(d => d.schoolId === actor.schoolId).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { items: items.map(serializeDocType) }
})

route('POST', '/admission-documents/types', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const body = ctx.body as { name?: string; code?: string; requiredIfCategoryIn?: string[]; requiredIfAdmissionMode?: string[]; requiredIfBoardChanged?: boolean; alwaysRequired?: boolean }
  if (!body.name?.trim()) throw badRequest('name is required')
  const code = (body.code?.trim() || body.name.trim()).toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const rows = table('RequiredDocumentType')
  if (rows.some(d => d.schoolId === actor.schoolId && d.code === code)) throw conflict('A required document type with that code already exists')
  const row: Row = {
    id: uid('requireddocumenttype'), schoolId: actor.schoolId, name: body.name.trim(), code,
    requiredIfCategoryIn: (body.requiredIfCategoryIn ?? []).map(c => c.toUpperCase()),
    requiredIfAdmissionMode: body.requiredIfAdmissionMode ?? [],
    requiredIfBoardChanged: !!body.requiredIfBoardChanged, alwaysRequired: !!body.alwaysRequired, isActive: true, createdAt: nowIso(),
  }
  rows.push(row)
  saveTable('RequiredDocumentType', rows)
  return status(201, { item: serializeDocType(row) })
})

route('PATCH', '/admission-documents/types/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('RequiredDocumentType')
  const idx = rows.findIndex(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Required document type')
  const body = ctx.body as { name?: string; code?: string; requiredIfCategoryIn?: string[]; requiredIfAdmissionMode?: string[]; requiredIfBoardChanged?: boolean; alwaysRequired?: boolean; isActive?: boolean }
  rows[idx] = {
    ...rows[idx],
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.code !== undefined ? { code: body.code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_') } : {}),
    ...(body.requiredIfCategoryIn !== undefined ? { requiredIfCategoryIn: body.requiredIfCategoryIn.map(c => c.toUpperCase()) } : {}),
    ...(body.requiredIfAdmissionMode !== undefined ? { requiredIfAdmissionMode: body.requiredIfAdmissionMode } : {}),
    ...(body.requiredIfBoardChanged !== undefined ? { requiredIfBoardChanged: body.requiredIfBoardChanged } : {}),
    ...(body.alwaysRequired !== undefined ? { alwaysRequired: body.alwaysRequired } : {}),
    ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
  }
  saveTable('RequiredDocumentType', rows)
  return { item: serializeDocType(rows[idx]) }
})

route('POST', '/admission-documents/types/seed-defaults', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('RequiredDocumentType')
  const existing = new Set(rows.filter(d => d.schoolId === actor.schoolId).map(d => d.code))
  const missing = DEFAULT_DOCUMENT_TYPES.filter(d => !existing.has(d.code))
  for (const d of missing) {
    rows.push({
      id: uid('requireddocumenttype'), schoolId: actor.schoolId, name: d.name, code: d.code,
      requiredIfCategoryIn: d.requiredIfCategoryIn ?? [], requiredIfAdmissionMode: d.requiredIfAdmissionMode ?? [],
      requiredIfBoardChanged: !!d.requiredIfBoardChanged, alwaysRequired: !!d.alwaysRequired, isActive: true, createdAt: nowIso(),
    })
  }
  saveTable('RequiredDocumentType', rows)
  return { added: missing.length }
})

/* ═══════════════════════════ AdmissionSettings ═══════════════════════════ */

export function getSettings(schoolId: string) {
  const row = table('AdmissionSettings').find(s => s.schoolId === schoolId)
  return { admissionDocumentsBlockApproval: !!row?.admissionDocumentsBlockApproval }
}

route('GET', '/admission-documents/settings', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  return getSettings(actor.schoolId)
})

route('PATCH', '/admission-documents/settings', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { admissionDocumentsBlockApproval } = ctx.body as { admissionDocumentsBlockApproval?: boolean }
  if (typeof admissionDocumentsBlockApproval !== 'boolean') throw badRequest('admissionDocumentsBlockApproval must be a boolean')
  const rows = table('AdmissionSettings')
  const idx = rows.findIndex(s => s.schoolId === actor.schoolId)
  if (idx === -1) rows.push({ id: uid('admissionsettings'), schoolId: actor.schoolId, admissionDocumentsBlockApproval, updatedAt: nowIso() })
  else rows[idx] = { ...rows[idx], admissionDocumentsBlockApproval, updatedAt: nowIso() }
  saveTable('AdmissionSettings', rows)
  return getSettings(actor.schoolId)
})

/* ═══════════════════════════ SubmittedDocument ═══════════════════════════ */

export function serializeSubmittedDocument(d: Row) {
  return {
    id: d.id, applicationId: d.applicationId ?? undefined, studentId: d.studentId ?? undefined,
    requiredDocumentTypeId: d.requiredDocumentTypeId ?? undefined, fileId: d.fileId ?? undefined, isOriginal: !!d.isOriginal,
    physicalLocationRoom: d.physicalLocationRoom ?? undefined, physicalLocationShelf: d.physicalLocationShelf ?? undefined,
    physicalLocationFolder: d.physicalLocationFolder ?? undefined, receivedDate: d.receivedDate ?? undefined,
    status: (d.status as string | undefined) ?? 'HELD', returnedDate: d.returnedDate ?? undefined, returnedTo: d.returnedTo ?? undefined,
    returnReason: d.returnReason ?? undefined, submittedById: d.submittedById ?? undefined, createdAt: d.createdAt,
  }
}

route('GET', '/admission-documents', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { applicationId, studentId, status: st } = ctx.query
  let rows = table('SubmittedDocument').filter(d => d.schoolId === actor.schoolId)
  if (applicationId) rows = rows.filter(d => d.applicationId === applicationId)
  if (studentId) rows = rows.filter(d => d.studentId === studentId)
  if (st) rows = rows.filter(d => d.status === st)
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializeSubmittedDocument) }
})

route('POST', '/admission-documents', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const body = ctx.body as {
    applicationId?: string; studentId?: string; requiredDocumentTypeId?: string; fileId?: string; isOriginal?: boolean
    physicalLocationRoom?: string; physicalLocationShelf?: string; physicalLocationFolder?: string; receivedDate?: string; status?: string
  }
  if (!body.applicationId && !body.studentId) throw badRequest('applicationId or studentId is required')
  if (body.applicationId && !table('Application').some(a => a.id === body.applicationId && a.schoolId === actor.schoolId)) throw notFound('Application')
  if (body.studentId && !table('User').some(u => u.id === body.studentId && u.role === 'student' && u.schoolId === actor.schoolId)) throw notFound('Student')
  if (body.requiredDocumentTypeId && !table('RequiredDocumentType').some(d => d.id === body.requiredDocumentTypeId && d.schoolId === actor.schoolId)) throw notFound('Required document type')
  const row: Row = {
    id: uid('submitteddocument'), schoolId: actor.schoolId, applicationId: body.applicationId ?? null, studentId: body.studentId ?? null,
    requiredDocumentTypeId: body.requiredDocumentTypeId ?? null, fileId: body.fileId ?? null, isOriginal: !!body.isOriginal,
    physicalLocationRoom: body.physicalLocationRoom ?? null, physicalLocationShelf: body.physicalLocationShelf ?? null,
    physicalLocationFolder: body.physicalLocationFolder ?? null, receivedDate: body.receivedDate ?? null, status: body.status ?? 'HELD',
    returnedDate: null, returnedTo: null, returnReason: null, submittedById: actor.userId, createdAt: nowIso(),
  }
  const rows = table('SubmittedDocument')
  rows.push(row)
  saveTable('SubmittedDocument', rows)
  return status(201, { item: serializeSubmittedDocument(row) })
})

route('PATCH', '/admission-documents/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('SubmittedDocument')
  const idx = rows.findIndex(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Submitted document')
  const body = ctx.body as Record<string, unknown>
  rows[idx] = { ...rows[idx], ...body }
  saveTable('SubmittedDocument', rows)
  return { item: serializeSubmittedDocument(rows[idx]) }
})

route('POST', '/admission-documents/:id/return', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('SubmittedDocument')
  const idx = rows.findIndex(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Submitted document')
  if (rows[idx].status === 'RETURNED') throw conflict('Document is already marked returned')
  const { returnedTo, returnReason } = ctx.body as { returnedTo?: string; returnReason?: string }
  if (!returnedTo?.trim()) throw badRequest('returnedTo is required')
  rows[idx] = { ...rows[idx], status: 'RETURNED', returnedDate: nowIso().slice(0, 10), returnedTo, returnReason: returnReason ?? null }
  saveTable('SubmittedDocument', rows)
  return { item: serializeSubmittedDocument(rows[idx]) }
})

route('POST', '/admission-documents/:id/lost', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('SubmittedDocument')
  const idx = rows.findIndex(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Submitted document')
  const { reason } = ctx.body as { reason?: string }
  rows[idx] = { ...rows[idx], status: 'LOST', returnReason: reason ?? rows[idx].returnReason ?? null }
  saveTable('SubmittedDocument', rows)
  return { item: serializeSubmittedDocument(rows[idx]) }
})

route('DELETE', '/admission-documents/:id', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const rows = table('SubmittedDocument')
  const idx = rows.findIndex(d => d.id === ctx.params.id && d.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Submitted document')
  rows.splice(idx, 1)
  saveTable('SubmittedDocument', rows)
  return { ok: true }
})

/* ═══════════════════════════ Completeness checklist ═══════════════════════════ */

function evaluateRequired(
  dt: Row,
  evalCtx: { categoryCode?: string | null; admissionMode?: string | null; boardChanged: boolean },
): boolean {
  if (dt.alwaysRequired) return true
  const categoryIn = (dt.requiredIfCategoryIn as string[] | undefined) ?? []
  const modeIn = (dt.requiredIfAdmissionMode as string[] | undefined) ?? []
  if (evalCtx.categoryCode && categoryIn.includes(evalCtx.categoryCode)) return true
  if (evalCtx.admissionMode && modeIn.includes(evalCtx.admissionMode)) return true
  if (dt.requiredIfBoardChanged && evalCtx.boardChanged) return true
  return false
}

/** Shared with modules/applications.ts#approve, same as the real service.ts is imported directly by
 * applications/service.ts rather than going through an HTTP round trip. */
export function checklist(schoolId: string, applicationId: string) {
  const app = table('Application').find(a => a.id === applicationId && a.schoolId === schoolId)
  if (!app) throw notFound('Application')
  const docTypes = table('RequiredDocumentType').filter(d => d.schoolId === schoolId && d.isActive !== false)
  const submitted = table('SubmittedDocument').filter(d => d.schoolId === schoolId && (d.applicationId === applicationId || (app.studentId && d.studentId === app.studentId)))
  const settings = getSettings(schoolId)
  const category = app.admissionCategoryId ? table('AdmissionCategory').find(c => c.id === app.admissionCategoryId) : undefined
  const boardChanged = !!(app.previousBoardId && app.targetBoardId && app.previousBoardId !== app.targetBoardId)
  const evalCtx = { categoryCode: (category?.code as string | undefined) ?? null, admissionMode: (app.admissionMode as string | undefined) ?? null, boardChanged }

  const submittedByType = new Map<string, Row>()
  for (const s of submitted) if (s.requiredDocumentTypeId) submittedByType.set(s.requiredDocumentTypeId as string, s)

  const items = docTypes.map(dt => {
    const required = evaluateRequired(dt, evalCtx)
    const sub = submittedByType.get(dt.id)
    return { requiredDocumentTypeId: dt.id, name: dt.name, code: dt.code, required, submitted: !!sub, submittedDocumentId: sub?.id, status: sub?.status }
  })
  const missingRequired = items.filter(i => i.required && !i.submitted).map(i => i.name)
  const extraDocuments = submitted.filter(s => !s.requiredDocumentTypeId).map(serializeSubmittedDocument)

  return { applicationId, admissionDocumentsBlockApproval: settings.admissionDocumentsBlockApproval, items, missingRequired, complete: missingRequired.length === 0, extraDocuments }
}

route('GET', '/admission-documents/checklist/:applicationId', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  return checklist(actor.schoolId, ctx.params.applicationId)
})

/* ═══════════════════════════ TC-issuance document-return workflow ═══════════════════════════
 * Shared with modules/applications.ts#approve — held originals for a student (matched either directly
 * by studentId or via the Application they were submitted against) must each be explicitly resolved
 * (RETURNED, with returnedTo — or an acknowledged exception) before/while a TC is issued. */

export function heldOriginals(schoolId: string, studentId: string): Row[] {
  const apps = new Set(table('Application').filter(a => a.schoolId === schoolId && a.studentId === studentId).map(a => a.id))
  return table('SubmittedDocument')
    .filter(d => d.schoolId === schoolId && d.isOriginal && d.status === 'HELD' && (d.studentId === studentId || (d.applicationId && apps.has(d.applicationId as string))))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

route('GET', '/admission-documents/tc-return-checklist/:studentId', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const held = heldOriginals(actor.schoolId, ctx.params.studentId)
  return {
    studentId: ctx.params.studentId,
    heldOriginals: held.map(h => {
      const dt = h.requiredDocumentTypeId ? table('RequiredDocumentType').find(t => t.id === h.requiredDocumentTypeId) : undefined
      return {
        id: h.id, name: dt?.name ?? 'Document', physicalLocationRoom: h.physicalLocationRoom ?? undefined,
        physicalLocationShelf: h.physicalLocationShelf ?? undefined, physicalLocationFolder: h.physicalLocationFolder ?? undefined,
        receivedDate: h.receivedDate ?? undefined,
      }
    }),
    blocksIssuance: held.length > 0,
  }
})

export interface DocumentReturnResolution { submittedDocumentId: string; action: 'RETURNED' | 'EXCEPTION'; returnedTo?: string; exceptionReason?: string }

/** Applies staff's resolution for every held original ahead of a TC issuance. Throws 409 (with the
 * still-outstanding list as `extra.outstanding`) if any held original is left unresolved — never
 * silently proceeds past a held original without an explicit decision either way. */
export function resolveHeldOriginalsForTc(actor: Actor, studentId: string, resolutions: DocumentReturnResolution[] = []) {
  const held = heldOriginals(actor.schoolId, studentId)
  if (held.length === 0) return { resolved: 0, held: [] as Row[] }

  const byId = new Map(resolutions.map(r => [r.submittedDocumentId, r]))
  const outstanding = held.filter(h => !byId.has(h.id))
  if (outstanding.length > 0) {
    throw conflict('Held original documents must be returned or an exception acknowledged before TC issuance', {
      outstanding: outstanding.map(h => {
        const dt = h.requiredDocumentTypeId ? table('RequiredDocumentType').find(t => t.id === h.requiredDocumentTypeId) : undefined
        return {
          id: h.id, name: dt?.name ?? 'Document', physicalLocationRoom: h.physicalLocationRoom ?? undefined,
          physicalLocationShelf: h.physicalLocationShelf ?? undefined, physicalLocationFolder: h.physicalLocationFolder ?? undefined,
        }
      }),
    })
  }

  const rows = table('SubmittedDocument')
  for (const doc of held) {
    const r = byId.get(doc.id)!
    const idx = rows.findIndex(d => d.id === doc.id)
    if (r.action === 'RETURNED') {
      if (!r.returnedTo?.trim()) throw badRequest(`returnedTo is required to mark document ${doc.id} returned`)
      rows[idx] = { ...rows[idx], status: 'RETURNED', returnedDate: nowIso().slice(0, 10), returnedTo: r.returnedTo, returnReason: r.exceptionReason ?? null }
    } else {
      if (!r.exceptionReason?.trim()) throw badRequest(`exceptionReason is required to acknowledge an exception for document ${doc.id}`)
      rows[idx] = { ...rows[idx], returnReason: `[TC exception] ${r.exceptionReason}` }
    }
  }
  saveTable('SubmittedDocument', rows)
  return { resolved: held.length, held }
}

/* ═══════════════════════════ Records report (physical custody) ═══════════════════════════ */

route('GET', '/admission-documents/records-report', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { room, shelf, studentId } = ctx.query
  let rows = table('SubmittedDocument').filter(d => d.schoolId === actor.schoolId && d.isOriginal && d.status === 'HELD')
  if (room) rows = rows.filter(d => String(d.physicalLocationRoom ?? '').toLowerCase().includes(room.toLowerCase()))
  if (shelf) rows = rows.filter(d => String(d.physicalLocationShelf ?? '').toLowerCase().includes(shelf.toLowerCase()))
  if (studentId) {
    const apps = new Set(table('Application').filter(a => a.schoolId === actor.schoolId && a.studentId === studentId).map(a => a.id))
    rows = rows.filter(d => d.studentId === studentId || (d.applicationId && apps.has(d.applicationId as string)))
  }
  rows = [...rows].sort((a, b) =>
    String(a.physicalLocationRoom ?? '').localeCompare(String(b.physicalLocationRoom ?? ''))
    || String(a.physicalLocationShelf ?? '').localeCompare(String(b.physicalLocationShelf ?? ''))
    || String(a.physicalLocationFolder ?? '').localeCompare(String(b.physicalLocationFolder ?? '')))
  const items = rows.map(d => {
    const dt = d.requiredDocumentTypeId ? table('RequiredDocumentType').find(t => t.id === d.requiredDocumentTypeId) : undefined
    const student = d.studentId ? table('User').find(u => u.id === d.studentId) : undefined
    const app = d.applicationId ? table('Application').find(a => a.id === d.applicationId) : undefined
    return {
      ...serializeSubmittedDocument(d), documentTypeName: dt?.name, documentTypeCode: dt?.code,
      studentName: student?.name, applicantName: app?.applicantName, resolvedStudentId: d.studentId ?? app?.studentId ?? undefined,
    }
  })
  return { items }
})
