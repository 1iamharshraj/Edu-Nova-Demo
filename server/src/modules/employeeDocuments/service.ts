import fs from 'node:fs'
import type { z } from 'zod'
import type { EmployeeDocument } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isAdmin } from '../../lib/scope'
import { EMPLOYEE_ROLES, type Role } from '../../userDefaults'
import { drawFields, drawFooter, drawHeader, fmtLong, renderToBuffer } from '../../lib/pdf'
import { absPath } from '../files/service'
import type { addDocument } from './schema'

// See phase-11-employee-management.md → A6. Every endpoint here (list/add/remove documents) is HR/admin
// only — deliberately not exposed on the employee's own Profile per the spec's frontend note ("self, ID
// card only — not document management"); documented in the Phase 11 server report. The ID card PDF is
// the one piece self can fetch.

export const serializeDocument = (d: EmployeeDocument) => ({
  id: d.id,
  userId: d.userId,
  fileId: d.fileId,
  label: d.label,
  uploadedById: d.uploadedById,
  uploadedAt: d.uploadedAt.toISOString(),
})

async function getEmployee(ctx: Ctx, userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, schoolId: ctx.schoolId } })
  if (!user) throw notFound('User')
  return user
}

export async function listDocuments(ctx: Ctx, userId: string) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  await getEmployee(ctx, userId)
  return prisma.employeeDocument.findMany({ where: { schoolId: ctx.schoolId, userId }, orderBy: [{ uploadedAt: 'desc' }] })
}

export async function addDocumentRow(ctx: Ctx, userId: string, input: z.infer<typeof addDocument>) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  await getEmployee(ctx, userId)
  const file = await prisma.file.findFirst({ where: { id: input.fileId, schoolId: ctx.schoolId } })
  if (!file) throw notFound('File')
  const row = await prisma.employeeDocument.create({
    data: { schoolId: ctx.schoolId, userId, fileId: input.fileId, label: input.label, uploadedById: ctx.actorId },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'employeeDocument', row.id, undefined, serializeDocument(row))
  return row
}

export async function removeDocument(ctx: Ctx, userId: string, docId: string) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  const row = await prisma.employeeDocument.findFirst({ where: { id: docId, userId, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Employee document')
  await prisma.employeeDocument.delete({ where: { id: docId } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'employeeDocument', docId, serializeDocument(row))
}

function assertSelfOrAdmin(ctx: Ctx, userId: string) {
  if (isAdmin(ctx) || ctx.actorId === userId) return
  throw new HttpError(403, 'You may only view your own ID card')
}

// GET /users/:id/id-card.pdf — self or HR/admin.
export async function idCardPdf(ctx: Ctx, userId: string) {
  assertSelfOrAdmin(ctx, userId)
  const user = await getEmployee(ctx, userId)
  if (!EMPLOYEE_ROLES.includes(user.role as Role)) throw new HttpError(400, 'ID cards are only issued to employee accounts (teacher/staff/admin/superadmin)')
  if (!user.employeeId) throw new HttpError(409, 'This account has no employee ID assigned yet')
  const school = await prisma.school.findUniqueOrThrow({ where: { id: ctx.schoolId } })

  let photoPath: string | null = null
  if (user.photoFileId) {
    const photo = await prisma.file.findFirst({ where: { id: user.photoFileId, schoolId: ctx.schoolId } })
    if (photo) {
      const p = absPath(photo)
      if (fs.existsSync(p)) photoPath = p
    }
  }

  const now = new Date()
  const bytes = await renderToBuffer(async doc => {
    drawHeader(doc, { schoolName: school.name, title: 'Employee ID Card', subtitle: user.designation ?? user.title, serial: user.employeeId! })
    if (photoPath) {
      const y = doc.y
      try {
        doc.image(photoPath, doc.page.margins.left, y, { width: 110, height: 110, fit: [110, 110] })
      } catch {
        // Not a renderable image (e.g. corrupt file) — skip the photo, the rest of the card is still useful.
      }
      doc.y = y + 122
    }
    drawFields(doc, [
      { label: 'Name', value: user.name },
      { label: 'Employee ID', value: user.employeeId! },
      { label: 'Role', value: user.role },
      { label: 'Designation', value: user.designation ?? '—' },
      { label: 'Department', value: user.department ?? '—' },
      { label: 'Issued on', value: fmtLong(now) },
    ])
    await drawFooter(doc, { issuedBy: school.name, issuedOn: fmtLong(now), qrText: `EduNova employee ${user.employeeId} | ${user.name}` })
  })
  return { bytes, name: `ID-Card-${user.employeeId}.pdf` }
}
