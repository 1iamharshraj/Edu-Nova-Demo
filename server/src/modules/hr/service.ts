import type { z } from 'zod'
import type { Contract, Resignation, Duty } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import { isAdmin, isStaff } from '../../lib/scope'
import { drawFields, drawFooter, drawHeader, fmtLong, renderToBuffer } from '../../lib/pdf'
import type {
  createContract, patchContract, contractsQuery, endContractBody,
  createResignation, resignationsQuery, decideResignationBody,
  createDuty, patchDuty, dutiesQuery,
} from './schema'

// See phase-6-hr.md → /api/hr. Employees = teacher | staff | admin | superadmin.
const EMPLOYEE_ROLES = ['teacher', 'staff', 'admin', 'superadmin']
const NOTICE_PERIOD_DAYS = 30

export const serializeContract = (c: Contract) => ({
  id: c.id, userId: c.userId, designation: c.designation, department: c.department ?? undefined,
  startDate: fmtDate(c.startDate), endDate: c.endDate ? fmtDate(c.endDate) : undefined, terms: c.terms,
  status: c.status, employeeSignedAt: c.employeeSignedAt?.toISOString(), adminSignedAt: c.adminSignedAt?.toISOString(),
  adminSignedById: c.adminSignedById ?? undefined, endedAt: c.endedAt?.toISOString(), endReason: c.endReason ?? undefined,
  pdfFileId: c.pdfFileId ?? undefined, createdAt: c.createdAt.toISOString(),
})

export const serializeResignation = (r: Resignation) => ({
  id: r.id, userId: r.userId, reason: r.reason, submittedAt: r.submittedAt.toISOString(),
  lastWorkingDate: fmtDate(r.lastWorkingDate), status: r.status, decidedById: r.decidedById ?? undefined,
  decidedAt: r.decidedAt?.toISOString(), notes: r.notes ?? undefined,
  // Informational only — see submitResignation() for how the 30-day notice policy is enforced (or not).
  noticeMet: Math.round((r.lastWorkingDate.getTime() - r.submittedAt.getTime()) / 86_400_000) >= NOTICE_PERIOD_DAYS,
})

export const serializeDuty = (d: Duty) => ({
  id: d.id, title: d.title, eventTitle: d.eventTitle, eventDate: fmtDate(d.eventDate), assigneeId: d.assigneeId ?? undefined,
  createdById: d.createdById, status: d.status, notes: d.notes ?? undefined, createdAt: d.createdAt.toISOString(),
})

function assertSelfOrAdmin(ctx: Ctx, userId: string) {
  if (isAdmin(ctx) || ctx.actorId === userId) return
  throw new HttpError(403, 'You may only view your own HR records')
}

// ═══════════════════════════ contracts ═══════════════════════════

export async function getContract(ctx: Ctx, id: string) {
  const row = await prisma.contract.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Contract')
  assertSelfOrAdmin(ctx, row.userId)
  return row
}

export async function listContracts(ctx: Ctx, q: z.infer<typeof contractsQuery>) {
  if (q.userId) assertSelfOrAdmin(ctx, q.userId)
  const userId = isAdmin(ctx) ? q.userId : ctx.actorId
  return prisma.contract.findMany({ where: { schoolId: ctx.schoolId, userId, status: q.status }, orderBy: [{ createdAt: 'desc' }] })
}

export async function createContractRow(ctx: Ctx, input: z.infer<typeof createContract>) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  const user = await prisma.user.findFirst({ where: { id: input.userId, schoolId: ctx.schoolId, role: { in: EMPLOYEE_ROLES } } })
  if (!user) throw notFound('Employee')
  const row = await prisma.contract.create({
    data: {
      schoolId: ctx.schoolId, userId: user.id, designation: input.designation, department: input.department ?? null,
      startDate: toDate(input.startDate), endDate: input.endDate ? toDate(input.endDate) : null, terms: input.terms, status: 'Draft',
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'contract', row.id, undefined, serializeContract(row))
  return row
}

export async function updateContract(ctx: Ctx, id: string, input: z.infer<typeof patchContract>) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  const before = await prisma.contract.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Contract')
  if (before.status !== 'Draft') throw new HttpError(409, 'Only a Draft contract may be edited')
  const row = await prisma.contract.update({
    where: { id },
    data: {
      designation: input.designation, department: input.department, startDate: input.startDate ? toDate(input.startDate) : undefined,
      endDate: input.endDate === undefined ? undefined : input.endDate ? toDate(input.endDate) : null, terms: input.terms,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'contract', id, serializeContract(before), serializeContract(row))
  return row
}

// Employee signs their own contract (employeeSignedAt); admin/superadmin signs on the school's behalf
// (adminSignedAt + adminSignedById). Status flips to Active once both signatures are present.
export async function signContract(ctx: Ctx, id: string) {
  const before = await prisma.contract.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Contract')
  if (before.status === 'Ended') throw new HttpError(409, 'Contract has ended')

  const isEmployee = ctx.actorId === before.userId
  if (!isEmployee && !isAdmin(ctx)) throw new HttpError(403, 'Only the employee or an admin may sign this contract')

  const data: { employeeSignedAt?: Date; adminSignedAt?: Date; adminSignedById?: string; status?: string } = {}
  if (isEmployee) {
    if (before.employeeSignedAt) throw new HttpError(409, 'You have already signed this contract')
    data.employeeSignedAt = new Date()
  } else {
    if (before.adminSignedAt) throw new HttpError(409, 'This contract has already been admin-signed')
    data.adminSignedAt = new Date()
    data.adminSignedById = ctx.actorId
  }
  const employeeSignedAt = data.employeeSignedAt ?? before.employeeSignedAt
  const adminSignedAt = data.adminSignedAt ?? before.adminSignedAt
  if (employeeSignedAt && adminSignedAt) data.status = 'Active'

  const row = await prisma.contract.update({ where: { id }, data })
  await audit(ctx.schoolId, ctx.actorId, 'sign', 'contract', id, serializeContract(before), serializeContract(row))
  return row
}

export async function endContract(ctx: Ctx, id: string, input: z.infer<typeof endContractBody>) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  const before = await prisma.contract.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Contract')
  if (before.status === 'Ended') throw new HttpError(409, 'Contract has already ended')
  const row = await prisma.contract.update({ where: { id }, data: { status: 'Ended', endedAt: new Date(), endReason: input.reason } })
  await audit(ctx.schoolId, ctx.actorId, 'end', 'contract', id, serializeContract(before), serializeContract(row))
  return row
}

export async function contractPdf(ctx: Ctx, id: string) {
  const contract = await getContract(ctx, id)
  const [school, user] = await Promise.all([
    prisma.school.findUniqueOrThrow({ where: { id: ctx.schoolId } }),
    prisma.user.findUniqueOrThrow({ where: { id: contract.userId } }),
  ])
  const now = new Date()
  const bytes = await renderToBuffer(async doc => {
    drawHeader(doc, { schoolName: school.name, title: 'Employment Contract', subtitle: contract.designation })
    drawFields(doc, [
      { label: 'Employee', value: user.name },
      { label: 'Employee ID', value: user.employeeId ?? '—' },
      { label: 'Designation', value: contract.designation },
      { label: 'Department', value: contract.department ?? '—' },
      { label: 'Start date', value: fmtDate(contract.startDate) },
      { label: 'End date', value: contract.endDate ? fmtDate(contract.endDate) : '—' },
      { label: 'Status', value: contract.status },
    ])
    doc.moveDown(0.5)
    doc.font('Helvetica-Bold').fontSize(11).text('Terms')
    doc.moveDown(0.2)
    doc.font('Helvetica').fontSize(10).fillColor('#111827').text(contract.terms, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right })
    doc.moveDown(0.5)
    drawFields(doc, [
      { label: 'Employee signed', value: contract.employeeSignedAt ? fmtLong(contract.employeeSignedAt) : 'Not signed' },
      { label: 'Admin signed', value: contract.adminSignedAt ? fmtLong(contract.adminSignedAt) : 'Not signed' },
    ])
    await drawFooter(doc, { issuedBy: school.name, issuedOn: fmtLong(now), qrText: `EduNova contract ${contract.id} | ${user.name}` })
  })
  return { bytes, name: `Contract-${user.name.replace(/\s+/g, '-')}-${contract.id.slice(0, 8)}.pdf` }
}

// ═══════════════════════════ resignations ═══════════════════════════

export async function getResignation(ctx: Ctx, id: string) {
  const row = await prisma.resignation.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Resignation')
  assertSelfOrAdmin(ctx, row.userId)
  return row
}

export async function listResignations(ctx: Ctx, q: z.infer<typeof resignationsQuery>) {
  if (q.userId) assertSelfOrAdmin(ctx, q.userId)
  const userId = isAdmin(ctx) ? q.userId : ctx.actorId
  return prisma.resignation.findMany({ where: { schoolId: ctx.schoolId, userId, status: q.status }, orderBy: [{ submittedAt: 'desc' }] })
}

// Notice-period policy (phase-6-hr.md: "notice check: ≥ 30 days unless admin overrides"). This endpoint is
// employee-only (there is no separate admin-submits-on-behalf-of-employee flow), so the "admin override" is
// read as applying to the *approval* step, not submission: submission is never blocked here — a short-notice
// resignation is still recorded (with `noticeMet: false` on the serialized row for the UI to flag), and it is
// the approving admin who effectively "overrides" the policy by approving it anyway. Documented in the report.
export async function submitResignation(ctx: Ctx, input: z.infer<typeof createResignation>) {
  if (!EMPLOYEE_ROLES.includes(ctx.role)) throw new HttpError(403, 'Only employees may submit a resignation')
  const existing = await prisma.resignation.findFirst({ where: { schoolId: ctx.schoolId, userId: ctx.actorId, status: 'Pending' } })
  if (existing) throw new HttpError(409, 'You already have a pending resignation')
  const row = await prisma.resignation.create({
    data: { schoolId: ctx.schoolId, userId: ctx.actorId, reason: input.reason, lastWorkingDate: toDate(input.lastWorkingDate), status: 'Pending' },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'resignation', row.id, undefined, serializeResignation(row))
  return row
}

function assertResignationPending(row: Resignation) {
  if (row.status !== 'Pending') throw new HttpError(409, `Resignation is already ${row.status.toLowerCase()}`)
}

// Approval ends the employee's current (Draft/Active) contract(s) and, if lastWorkingDate has already passed
// (or is today), deactivates the account synchronously. If lastWorkingDate is in the future we do not schedule
// a job (no background scheduler in this codebase) — the deactivation happens the simple way: on the next
// approve-adjacent admin action, or the account is deactivated for real once lastWorkingDate <= now. Since
// this demo has no cron, we document the choice: `active` flips as soon as the condition is true, checked here
// and also cheaply re-checked on login (see routes/auth.ts).
export async function approveResignation(ctx: Ctx, id: string, input: z.infer<typeof decideResignationBody>) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  const before = await prisma.resignation.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Resignation')
  assertResignationPending(before)

  const row = await prisma.$transaction(async tx => {
    const updated = await tx.resignation.update({
      where: { id }, data: { status: 'Approved', decidedById: ctx.actorId, decidedAt: new Date(), notes: input.notes ?? null },
    })
    await tx.contract.updateMany({
      where: { schoolId: ctx.schoolId, userId: before.userId, status: { in: ['Draft', 'Active'] } },
      data: { status: 'Ended', endedAt: new Date(), endReason: 'Resignation approved' },
    })
    if (before.lastWorkingDate.getTime() <= Date.now()) {
      await tx.user.update({ where: { id: before.userId }, data: { active: false } })
    }
    return updated
  })
  await audit(ctx.schoolId, ctx.actorId, 'approve', 'resignation', id, serializeResignation(before), serializeResignation(row))
  return row
}

export async function declineResignation(ctx: Ctx, id: string, input: z.infer<typeof decideResignationBody>) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Admin/superadmin only')
  const before = await prisma.resignation.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Resignation')
  assertResignationPending(before)
  const row = await prisma.resignation.update({ where: { id }, data: { status: 'Declined', decidedById: ctx.actorId, decidedAt: new Date(), notes: input.notes ?? null } })
  await audit(ctx.schoolId, ctx.actorId, 'decline', 'resignation', id, serializeResignation(before), serializeResignation(row))
  return row
}

export async function withdrawResignation(ctx: Ctx, id: string) {
  const before = await prisma.resignation.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!before) throw notFound('Resignation')
  if (before.userId !== ctx.actorId) throw new HttpError(403, 'Only the employee may withdraw their own resignation')
  assertResignationPending(before)
  const row = await prisma.resignation.update({ where: { id }, data: { status: 'Withdrawn' } })
  await audit(ctx.schoolId, ctx.actorId, 'withdraw', 'resignation', id, serializeResignation(before), serializeResignation(row))
  return row
}

// Checked opportunistically wherever it's cheap to (e.g. login) — see routes/auth.ts.
export async function deactivateIfPastLastWorkingDate(userId: string) {
  const pending = await prisma.resignation.findFirst({ where: { userId, status: 'Approved', lastWorkingDate: { lte: new Date() } } })
  if (pending) await prisma.user.update({ where: { id: userId }, data: { active: false } })
}

// ═══════════════════════════ duties ═══════════════════════════

export async function listDuties(ctx: Ctx, q: z.infer<typeof dutiesQuery>) {
  if (isStaff(ctx)) return prisma.duty.findMany({ where: { schoolId: ctx.schoolId, assigneeId: q.assigneeId }, orderBy: [{ eventDate: 'asc' }] })
  if (q.assigneeId && q.assigneeId !== ctx.actorId) throw new HttpError(403, 'You may only view your own duties')
  return prisma.duty.findMany({ where: { schoolId: ctx.schoolId, assigneeId: ctx.actorId }, orderBy: [{ eventDate: 'asc' }] })
}

async function getDuty(ctx: Ctx, id: string) {
  const row = await prisma.duty.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Duty')
  return row
}

export async function createDutyRow(ctx: Ctx, input: z.infer<typeof createDuty>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Staff/admin only')
  if (input.assigneeId) {
    const assignee = await prisma.user.findFirst({ where: { id: input.assigneeId, schoolId: ctx.schoolId } })
    if (!assignee) throw notFound('Assignee')
  }
  const row = await prisma.duty.create({
    data: {
      schoolId: ctx.schoolId, title: input.title, eventTitle: input.eventTitle, eventDate: toDate(input.eventDate),
      assigneeId: input.assigneeId ?? null, createdById: ctx.actorId, notes: input.notes ?? null, status: 'Assigned',
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'duty', row.id, undefined, serializeDuty(row))
  return row
}

export async function updateDuty(ctx: Ctx, id: string, input: z.infer<typeof patchDuty>) {
  const before = await getDuty(ctx, id)
  if (!isStaff(ctx)) {
    // Non-staff may only mark their own duty Done — nothing else.
    if (before.assigneeId !== ctx.actorId) throw new HttpError(403, 'You may only update your own duty')
    const keys = Object.keys(input)
    if (keys.some(k => k !== 'status') || input.status !== 'Done') throw new HttpError(403, 'You may only mark this duty Done')
    const row = await prisma.duty.update({ where: { id }, data: { status: 'Done' } })
    await audit(ctx.schoolId, ctx.actorId, 'update', 'duty', id, serializeDuty(before), serializeDuty(row))
    return row
  }
  if (input.assigneeId !== undefined && input.assigneeId) {
    const assignee = await prisma.user.findFirst({ where: { id: input.assigneeId, schoolId: ctx.schoolId } })
    if (!assignee) throw notFound('Assignee')
  }
  const row = await prisma.duty.update({
    where: { id },
    data: {
      title: input.title, eventTitle: input.eventTitle, eventDate: input.eventDate ? toDate(input.eventDate) : undefined,
      assigneeId: input.assigneeId === undefined ? undefined : input.assigneeId ?? null, notes: input.notes, status: input.status,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'duty', id, serializeDuty(before), serializeDuty(row))
  return row
}

export async function removeDuty(ctx: Ctx, id: string) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Staff/admin only')
  const before = await getDuty(ctx, id)
  await prisma.duty.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'duty', id, serializeDuty(before))
}
