import type { z } from 'zod'
import type { Certificate } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { assertViewStudent, visibleStudentIds } from '../../lib/scope'
import { drawFields, drawFooter, drawHeader, fmtLong, renderToBuffer, storePdf } from '../../lib/pdf'
import { absPath } from '../files/service'
import type { CertificateKind, listQuery } from './schema'

export const serializeCertificate = (c: Certificate) => ({
  id: c.id,
  kind: c.kind,
  studentId: c.studentId,
  serialNo: c.serialNo,
  issuedById: c.issuedById ?? undefined,
  issuedAt: c.issuedAt.toISOString(),
  pdfFileId: c.pdfFileId ?? undefined,
  applicationId: c.applicationId ?? undefined,
})

const TITLES: Record<CertificateKind, string> = { TC: 'Transfer Certificate', Bonafide: 'Bonafide Certificate', Character: 'Character Certificate' }

// "EDN/TC/2026/0001": fixed prefix / kind / issue year / 4-digit sequence per school + kind + year.
const SERIAL_PREFIX = 'EDN'

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.certificate.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Certificate')
  await assertViewStudent(ctx, row.studentId)
  return row
}

export async function list(ctx: Ctx, q: z.infer<typeof listQuery>) {
  const only = await visibleStudentIds(ctx)
  if (q.studentId) await assertViewStudent(ctx, q.studentId)
  return prisma.certificate.findMany({
    where: { schoolId: ctx.schoolId, kind: q.kind, studentId: q.studentId ?? (only ? { in: only } : undefined) },
    orderBy: [{ issuedAt: 'desc' }],
  })
}

async function studentProfile(ctx: Ctx, studentId: string) {
  const student = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' } })
  if (!student) throw notFound('Student')
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId },
    include: { class: { include: { grade: true, board: true } }, academicYear: true },
    orderBy: [{ academicYear: { startDate: 'desc' } }, { createdAt: 'desc' }],
  })
  const guardian = await prisma.guardian.findFirst({ where: { studentId }, include: { parent: true }, orderBy: { createdAt: 'asc' } })
  return { student, enrollment, guardian }
}

// Creates the Certificate row (serial allocated inside a transaction), renders the PDF and stores it as a File.
export async function issue(ctx: Ctx, kind: CertificateKind, studentId: string, applicationId?: string) {
  const { student, enrollment, guardian } = await studentProfile(ctx, studentId)
  const [school, issuer] = await Promise.all([
    prisma.school.findUniqueOrThrow({ where: { id: ctx.schoolId } }),
    prisma.user.findUniqueOrThrow({ where: { id: ctx.actorId } }),
  ])
  const now = new Date()
  const year = now.getUTCFullYear()
  const base = `${SERIAL_PREFIX}/${kind}/${year}/`

  const row = await prisma.$transaction(async tx => {
    const count = await tx.certificate.count({ where: { schoolId: ctx.schoolId, serialNo: { startsWith: base } } })
    return tx.certificate.create({
      data: { schoolId: ctx.schoolId, kind, studentId, serialNo: `${base}${String(count + 1).padStart(4, '0')}`, issuedById: ctx.actorId, issuedAt: now, applicationId: applicationId ?? null },
    })
  })

  const classLabel = enrollment ? `${enrollment.class.grade.label}-${enrollment.class.section}` : '—'
  const bytes = await renderToBuffer(async doc => {
    drawHeader(doc, { schoolName: school.name, title: TITLES[kind], serial: row.serialNo })
    doc.moveDown(0.5)
    const body = kind === 'TC'
      ? `This is to certify that ${student.name} was a bona fide student of this school and is hereby granted a Transfer Certificate on request. The particulars below are true according to the school records.`
      : kind === 'Bonafide'
        ? `This is to certify that ${student.name} is a bona fide student of this school. The particulars below are true according to the school records.`
        : `This is to certify that ${student.name} has been a student of this school and, to the best of our knowledge, bears a good moral character. The particulars below are true according to the school records.`
    doc.font('Helvetica').fontSize(11).fillColor('#111827').text(body, { align: 'justify', lineGap: 3 })
    doc.moveDown(1.2)
    drawFields(doc, [
      { label: 'Student name', value: student.name },
      { label: 'Class', value: classLabel },
      { label: 'Board', value: enrollment?.class.board.name ?? '—' },
      { label: 'Roll number', value: enrollment?.rollNo ?? '—' },
      { label: 'Academic year', value: enrollment?.academicYear.label ?? '—' },
      { label: 'Date of birth', value: student.dob ?? '—' },
      { label: 'Parent / guardian', value: guardian?.parent.name ?? '—' },
      { label: 'Student id', value: student.id },
      { label: 'Date of issue', value: fmtLong(now) },
      { label: 'Issued by', value: `${issuer.name} (${issuer.title})` },
    ])
    await drawFooter(doc, { issuedBy: issuer.name, issuedOn: fmtLong(now), qrText: `EduNova certificate ${row.serialNo} | ${student.name} | ${kind}` })
  })
  const file = await storePdf(ctx.schoolId, ctx.actorId, `${kind}-${row.serialNo.replace(/\//g, '-')}.pdf`, bytes)
  const done = await prisma.certificate.update({ where: { id: row.id }, data: { pdfFileId: file.id } })
  await audit(ctx.schoolId, ctx.actorId, 'issue', 'certificate', done.id, undefined, serializeCertificate(done))
  return done
}

export async function pdfPath(ctx: Ctx, id: string) {
  const row = await get(ctx, id)
  if (!row.pdfFileId) throw new HttpError(404, 'Certificate PDF has not been generated')
  const file = await prisma.file.findFirst({ where: { id: row.pdfFileId, schoolId: ctx.schoolId } })
  if (!file) throw new HttpError(404, 'Certificate PDF is missing')
  return { row, file, path: absPath(file) }
}
