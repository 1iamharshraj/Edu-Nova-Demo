// Mirrors server/src/modules/certificates's contract: students/parents see their own certificates,
// staff/admin issue directly (without an application) or via modules/applications.ts#approve for
// TC/Bonafide/Character applications. `issueCertificate` is exported for that cross-module call, same
// as the real modules/certificates/service.ts#issue is imported directly by applications/service.ts.

import { route, requireAuth, requireRole, status, type Actor } from '../router'
import { badRequest, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const STAFF_ROLES = ['staff', 'admin', 'superadmin']
const CERTIFICATE_KINDS = ['TC', 'Bonafide', 'Character']

function isStaff(role: string) {
  return STAFF_ROLES.includes(role)
}

function visibleStudentIds(actor: Actor): string[] | null {
  if (isStaff(actor.role)) return null
  if (actor.role === 'student') return [actor.userId]
  if (actor.role === 'parent') return table('Guardian').filter(g => g.parentId === actor.userId && g.schoolId === actor.schoolId).map(g => g.studentId as string)
  return []
}

function serializeCertificate(c: Row) {
  return { id: c.id, kind: c.kind, studentId: c.studentId, serialNo: c.serialNo, issuedById: c.issuedById ?? undefined, issuedAt: c.issuedAt, pdfFileId: c.pdfFileId ?? undefined, applicationId: c.applicationId ?? undefined }
}

/** Serial numbers look like "EDN/TC/2026/0001": fixed prefix / kind / issue year / 4-digit sequence
 * per school + kind + year, same scheme as the real backend. */
export function issueCertificate(actor: Actor, kind: 'TC' | 'Bonafide' | 'Character', studentId: string, applicationId?: string): Row {
  const student = table('User').find(u => u.id === studentId && u.role === 'student' && u.schoolId === actor.schoolId)
  if (!student) throw notFound('Student')
  const now = nowIso()
  const year = new Date(now).getUTCFullYear()
  const base = `EDN/${kind}/${year}/`
  const rows = table('Certificate')
  const count = rows.filter(c => c.schoolId === actor.schoolId && String(c.serialNo).startsWith(base)).length
  const row: Row = {
    id: uid('certificate'), schoolId: actor.schoolId, kind, studentId, serialNo: `${base}${String(count + 1).padStart(4, '0')}`,
    issuedById: actor.userId, issuedAt: now, applicationId: applicationId ?? null, pdfFileId: null,
  }
  rows.push(row)
  saveTable('Certificate', rows)
  return row
}

route('GET', '/certificates', (ctx) => {
  const actor = requireAuth(ctx)
  const { studentId, kind } = ctx.query
  let rows = table('Certificate').filter(c => c.schoolId === actor.schoolId)
  if (kind) rows = rows.filter(c => c.kind === kind)
  if (studentId) rows = rows.filter(c => c.studentId === studentId)
  else {
    const only = visibleStudentIds(actor)
    if (only) rows = rows.filter(c => only.includes(c.studentId as string))
  }
  rows = [...rows].sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)))
  return { items: rows.map(serializeCertificate) }
})

route('POST', '/certificates', (ctx) => {
  const actor = requireRole(ctx, ...STAFF_ROLES)
  const { kind, studentId } = ctx.body as { kind?: string; studentId?: string }
  if (!kind || !CERTIFICATE_KINDS.includes(kind)) throw badRequest('kind must be one of TC, Bonafide, Character')
  if (!studentId) throw badRequest('studentId is required')
  const row = issueCertificate(actor, kind as 'TC' | 'Bonafide' | 'Character', studentId)
  return status(201, { item: serializeCertificate(row) })
})

route('GET', '/certificates/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const row = table('Certificate').find(c => c.id === ctx.params.id && c.schoolId === actor.schoolId)
  if (!row) throw notFound('Certificate')
  return { item: serializeCertificate(row) }
})

// No stored PDF bytes in the static demo (see modules/files.ts) — `fetchAuthed()` in api.ts synthesizes
// a placeholder blob for any JSON response without a `dataUrl`, so this only needs to validate the
// certificate exists before the client's `downloadPath()` produces a download.
route('GET', '/certificates/:id/pdf', (ctx) => {
  const actor = requireAuth(ctx)
  const row = table('Certificate').find(c => c.id === ctx.params.id && c.schoolId === actor.schoolId)
  if (!row) throw notFound('Certificate')
  return {}
})
