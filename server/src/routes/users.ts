import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { requireAuth, type AuthedRequest } from '../auth'
import { toClientUser } from '../serialize'
import { canManage } from '../access'
import { makeEmail, genPassword, uid, idPrefixFor, EMPLOYEE_ROLES, type Role } from '../userDefaults'
import { HttpError, notFound, wrap } from '../lib/errors'
import { ctxOf, requireRole } from '../lib/rbac'
import { isAdmin } from '../lib/scope'
import { validate } from '../lib/validate'
import { audit } from '../lib/audit'
import { syncUserTitle, usersTouchingClasses } from '../lib/titleSync'
import { logChange } from '../modules/employmentHistory/service'
import * as docsSvc from '../modules/employeeDocuments/service'
import { serializeDocument } from '../modules/employeeDocuments/service'
import { addDocument } from '../modules/employeeDocuments/schema'
import { paginationQuery, paginate } from '../lib/pagination'
import { classLabel } from '../modules/timetable/shared'

export const usersRouter = Router()
usersRouter.use(requireAuth)

const ROLES = ['parent', 'student', 'teacher', 'staff', 'admin', 'superadmin'] as const

// Relational extras (see contract §/api/users). Plain profile fields are copied from `editable` below.
const extras = z.object({
  classId: z.string().min(1).nullable().optional(),
  rollNo: z.string().nullable().optional(),
  studentIds: z.array(z.string().min(1)).optional(),
  classTeacherOf: z.string().min(1).nullable().optional(),
  email: z.string().email().optional(),
  password: z.string().min(1).optional(),
})
const createBody = extras.extend({ role: z.enum(ROLES), name: z.string().min(1) })

const editable = ['name', 'title', 'avatarHue', 'verified', 'mustChangePassword', 'department', 'designation', 'reportsTo', 'joinDate', 'phone', 'dob', 'photoFileId', 'emergencyContact', 'address'] as const

// Self-service profile edits (PATCH /me). Students cannot change their name.
const selfBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  emergencyContact: z.string().trim().max(200).nullable().optional(),
  photoFileId: z.string().min(1).nullable().optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  avatarHue: z.number().int().min(0).max(360).optional(),
})

const roleBody = z.object({ role: z.enum(['admin', 'staff', 'teacher']) })

function pickEditable(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {}
  for (const key of editable) if (key in body) data[key] = body[key]
  return data
}

async function requesterAndUsers(req: AuthedRequest) {
  const { schoolId, actorId } = ctxOf(req)
  const requester = await prisma.user.findUnique({ where: { id: actorId } })
  if (!requester) throw new HttpError(401, 'Unauthorized')
  const allUsers = await prisma.user.findMany({ where: { schoolId }, select: { id: true, role: true } })
  return { requester, allUsers: allUsers as { id: string; role: Role }[] }
}

async function getClass(schoolId: string, classId: string) {
  const c = await prisma.class.findFirst({ where: { id: classId, schoolId } })
  if (!c) throw notFound('Class')
  return c
}

async function assertRole(schoolId: string, ids: string[], role: Role) {
  const rows = await prisma.user.findMany({ where: { id: { in: ids }, schoolId, role }, select: { id: true } })
  if (rows.length !== new Set(ids).size) throw new HttpError(400, `All ids must reference users with role ${role}`, { ids })
}

// ═══════════════════════════ Phase 11 · A1 employee IDs, A2 reportsTo ═══════════════════════════
// See phase-11-employee-management.md. A1: "EMP-<joinYear>-<4-digit sequence>", generated at creation
// time for employee roles only — same count-inside-transaction convention as certificates/payslips/fee
// invoices (see modules/certificates/service.ts#issue, modules/payroll/service.ts#run).

async function nextEmployeeId(tx: Prisma.TransactionClient, schoolId: string, joinDate: string) {
  const year = joinDate.slice(0, 4)
  const base = `EMP-${year}-`
  const count = await tx.user.count({ where: { schoolId, employeeId: { startsWith: base } } })
  return `${base}${String(count + 1).padStart(4, '0')}`
}

// A2: reportsTo must reference another employee-role user of the same school, and must not (transitively)
// create a cycle. `selfId` is omitted on create (a brand-new id cannot appear in any existing chain).
async function assertValidManager(schoolId: string, role: string, reportsTo: string, selfId?: string) {
  if (!EMPLOYEE_ROLES.includes(role as Role)) throw new HttpError(400, 'reportsTo is only valid for employee accounts (teacher/staff/admin/superadmin)')
  if (selfId && reportsTo === selfId) throw new HttpError(400, 'A user cannot report to themselves')
  const manager = await prisma.user.findFirst({ where: { id: reportsTo, schoolId, role: { in: EMPLOYEE_ROLES } } })
  if (!manager) throw new HttpError(400, 'reportsTo must reference an employee of this school', { reportsTo })
  if (selfId) {
    let current: string | null = reportsTo
    const seen = new Set<string>()
    for (let i = 0; i < 200 && current; i++) {
      if (current === selfId) throw new HttpError(400, 'That would create a reporting cycle')
      if (seen.has(current)) break // an already-broken cycle elsewhere in the data — nothing more to check
      seen.add(current)
      const row: { reportsTo: string | null } | null = await prisma.user.findUnique({ where: { id: current }, select: { reportsTo: true } })
      current = row?.reportsTo ?? null
    }
  }
}

usersRouter.get('/', wrap(async (req, res) => {
  const users = await prisma.user.findMany({ where: { schoolId: (req as AuthedRequest).auth!.schoolId } })
  res.json({ users: users.map(u => toClientUser(u)) })
}))

// ═══════════════════════════ UI-architecture-fix Phase A: searched/paginated picker endpoint ═══════
// GET /search — the reusable replacement for screens that used to `db.users.filter(role===...)` against
// the entire school roster (see .agents/edunova/ui-architecture-fix.md). Purely additive: GET / above is
// untouched, every existing `db.users` reader keeps working exactly as before. `requireAuth` only (many
// roles across many forms need to search for *someone*), scoped to the caller's own school like every
// other endpoint. Cursor pagination reuses lib/pagination.ts#paginate exactly like modules/messages and
// modules/alumni do — see those for the same q/OR/contains/insensitive convention this mirrors.
const searchQuery = paginationQuery.extend({
  q: z.string().trim().min(1).max(200).optional(),
  role: z.enum(ROLES).optional(),
  classId: z.string().min(1).optional(),
})

// Single pre-formatted disambiguating line per row, so the frontend never needs to know the shape of a
// role's context data — just render the string. Students: current class/section + roll number (via
// Enrollment, "current" = most recent academic year then most recent enrollment row, same tie-break
// modules/certificates/service.ts#studentProfile uses). Employee roles: employeeId + designation/department
// (already denormalized onto User, see serialize.ts#toClientUser). Everyone else: just their role.
function contextFor(
  u: { role: string; employeeId: string | null; department: string | null; designation: string | null },
  enrollment?: { rollNo: string | null; class: { grade: { label: string }; section: string } },
): string {
  if (u.role === 'student') {
    if (!enrollment) return 'Unassigned'
    const label = classLabel(enrollment.class)
    return enrollment.rollNo ? `${label} · Roll ${enrollment.rollNo}` : label
  }
  if (EMPLOYEE_ROLES.includes(u.role as Role)) {
    const parts = [u.employeeId, u.designation ?? u.department].filter((v): v is string => !!v)
    return parts.length ? parts.join(' · ') : '—'
  }
  return u.role
}

usersRouter.get('/search', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const q = validate(searchQuery, req.query)

  const where: Prisma.UserWhereInput = {
    schoolId: ctx.schoolId,
    ...(q.role ? { role: q.role } : {}),
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
    ...(q.classId ? { enrollments: { some: { classId: q.classId, status: 'active' } } } : {}),
  }

  const { items, nextCursor } = await paginate(
    args => prisma.user.findMany({ where, orderBy: [{ name: 'asc' }], ...args }),
    { limit: q.limit, cursor: q.cursor, defaultLimit: 20, maxLimit: 50 },
  )

  const studentIds = items.filter(u => u.role === 'student').map(u => u.id)
  const enrollments = studentIds.length ? await prisma.enrollment.findMany({
    where: { studentId: { in: studentIds } },
    include: { class: { include: { grade: true } } },
    orderBy: [{ academicYear: { startDate: 'desc' } }, { createdAt: 'desc' }],
  }) : []
  const enrollmentByStudent = new Map<string, (typeof enrollments)[number]>()
  for (const e of enrollments) if (!enrollmentByStudent.has(e.studentId)) enrollmentByStudent.set(e.studentId, e)

  res.json({
    items: items.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      context: contextFor(u, enrollmentByStudent.get(u.id)),
    })),
    nextCursor,
  })
}))

usersRouter.post('/', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const body = validate(createBody, req.body)
  const { role } = body

  const { requester, allUsers } = await requesterAndUsers(req as AuthedRequest)
  const target = { id: 'new', role }
  if (!canManage(requester as any, target, [...allUsers, target])) throw new HttpError(403, `Not permitted to create a ${role}`)

  if (body.classId && role !== 'student') throw new HttpError(400, 'classId is only valid for students')
  if (body.studentIds && role !== 'parent') throw new HttpError(400, 'studentIds is only valid for parents')
  if (body.classTeacherOf && role !== 'teacher') throw new HttpError(400, 'classTeacherOf is only valid for teachers')

  const cls = body.classId ? await getClass(ctx.schoolId, body.classId) : null
  const classTeacherOf = body.classTeacherOf ? await getClass(ctx.schoolId, body.classTeacherOf) : null
  if (body.studentIds?.length) await assertRole(ctx.schoolId, body.studentIds, 'student')

  const raw = req.body as Record<string, unknown>
  // A2: reportsTo, if given, must be another employee of this school — a brand-new user's id cannot yet
  // appear in any existing chain, so no cycle check is needed here (only on update).
  if (raw.reportsTo) await assertValidManager(ctx.schoolId, role, raw.reportsTo as string)

  const email = (body.email ?? makeEmail(body.name, role)).toLowerCase()
  // Random one-time password, same pattern as admissions (applications/service.ts) and
  // auth.ts's admin/set-password — never a static per-role password. The account must change it on
  // first login regardless of whether the password was generated here or supplied by the caller.
  const password = body.password ?? genPassword()
  const passwordHash = await bcrypt.hash(password, 10)
  const joinDate = (raw.joinDate as string) ?? new Date().toISOString().slice(0, 10)

  const created = await prisma.$transaction(async tx => {
    // A1: employee ID, assigned only for teacher/staff/admin/superadmin — see nextEmployeeId() above.
    const employeeId = EMPLOYEE_ROLES.includes(role) ? await nextEmployeeId(tx, ctx.schoolId, joinDate) : null
    const user = await tx.user.create({
      data: {
        ...pickEditable(raw),
        id: uid(idPrefixFor(role)),
        schoolId: ctx.schoolId,
        role,
        name: body.name,
        email,
        passwordHash,
        mustChangePassword: true,
        title: (raw.title as string) ?? `${role} · onboarded`,
        avatarHue: (raw.avatarHue as number) ?? Math.floor(Math.random() * 360),
        verified: (raw.verified as boolean) ?? true,
        joinDate,
        employeeId,
      } as any,
    })
    if (cls) {
      await tx.enrollment.create({ data: { schoolId: ctx.schoolId, studentId: user.id, classId: cls.id, academicYearId: cls.academicYearId, rollNo: body.rollNo ?? null } })
    }
    if (body.studentIds?.length) {
      await tx.guardian.createMany({ data: body.studentIds.map(studentId => ({ schoolId: ctx.schoolId, parentId: user.id, studentId, relation: 'parent' })) })
    }
    if (classTeacherOf) {
      await tx.class.update({ where: { id: classTeacherOf.id }, data: { classTeacherId: user.id } })
    }
    return user
  })

  await syncUserTitle([created.id, ...(body.studentIds ?? []), classTeacherOf?.classTeacherId ?? ''])
  const user = await prisma.user.findUniqueOrThrow({ where: { id: created.id } })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'user', user.id, undefined, toClientUser(user))
  res.status(201).json({ user: toClientUser(user, password), password })
}))

// PATCH /me — self-service profile fields only (declared before /:id so "me" is not treated as an id).
usersRouter.patch('/me', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const body = validate(selfBody, req.body)
  const before = await prisma.user.findUniqueOrThrow({ where: { id: ctx.actorId } })
  if (body.name !== undefined && before.role === 'student') throw new HttpError(403, 'Students cannot change their name')
  if (body.photoFileId) {
    const f = await prisma.file.findFirst({ where: { id: body.photoFileId, schoolId: ctx.schoolId } })
    if (!f) throw notFound('Photo file')
    if (!f.mime.startsWith('image/')) throw new HttpError(400, 'photoFileId must reference an image')
  }
  const user = await prisma.user.update({ where: { id: ctx.actorId }, data: body })
  if (body.name !== undefined) await syncUserTitle([user.id])
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'user', user.id, toClientUser(before), toClientUser(fresh))
  res.json({ user: toClientUser(fresh) })
}))

// ═══════════════════════════ Phase 11 · A2 team / org chart ═══════════════════════════

// GET /org-chart — HR/admin only. The whole school's employee-role users as a tree (roots = no manager,
// or a manager outside the employee-role set / a broken reference). Declared before "/:id/reports" only
// for readability — the two paths never collide (different shapes, and there is no bare GET "/:id").
usersRouter.get('/org-chart', requireRole('admin', 'superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const employees = await prisma.user.findMany({
    where: { schoolId: ctx.schoolId, role: { in: EMPLOYEE_ROLES } },
    select: { id: true, name: true, role: true, title: true, designation: true, department: true, employeeId: true, photoFileId: true, reportsTo: true },
    orderBy: [{ name: 'asc' }],
  })
  type Employee = (typeof employees)[number]
  type Node = Employee & { reports: Node[] }
  const byId = new Map<string, Node>(employees.map(e => [e.id, { ...e, reports: [] }]))
  const roots: Node[] = []
  for (const node of byId.values()) {
    const manager = node.reportsTo ? byId.get(node.reportsTo) : undefined
    if (manager) manager.reports.push(node)
    else roots.push(node)
  }
  res.json({ roots })
}))

// GET /:id/reports — "My Team": the direct reports of a user. Self, or HR/admin for anyone.
usersRouter.get('/:id/reports', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  if (ctx.actorId !== req.params.id && !isAdmin(ctx)) throw new HttpError(403, 'You may only view your own team')
  const target = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: ctx.schoolId } })
  if (!target) throw notFound('User')
  const items = await prisma.user.findMany({
    where: { schoolId: ctx.schoolId, reportsTo: target.id },
    select: { id: true, name: true, role: true, title: true, designation: true, department: true, employeeId: true, photoFileId: true },
    orderBy: [{ name: 'asc' }],
  })
  res.json({ items })
}))

// PATCH /:id/role — superadmin only, within admin / staff / teacher.
usersRouter.patch('/:id/role', requireRole('superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const body = validate(roleBody, req.body)
  const target = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: ctx.schoolId } })
  if (!target) throw notFound('User')
  if (target.id === ctx.actorId) throw new HttpError(403, 'You cannot change your own role')
  if (!['admin', 'staff', 'teacher'].includes(target.role)) throw new HttpError(400, 'Only admin, staff and teacher accounts can change role', { role: target.role })
  if (target.role === body.role) return res.json({ user: toClientUser(target) })
  const affected: string[] = [target.id]
  const user = await prisma.$transaction(async tx => {
    if (target.role === 'teacher') {
      // Leaving teaching: drop class-teacher and subject assignments so the timetable stays consistent.
      const classes = await tx.class.findMany({ where: { classTeacherId: target.id }, select: { id: true } })
      affected.push(...(await usersTouchingClasses(classes.map(c => c.id))))
      await tx.class.updateMany({ where: { classTeacherId: target.id }, data: { classTeacherId: null } })
      await tx.classSubject.updateMany({ where: { teacherId: target.id }, data: { teacherId: null } })
      await tx.timetableEntry.updateMany({ where: { teacherId: target.id }, data: { teacherId: null } })
    }
    return tx.user.update({ where: { id: target.id }, data: { role: body.role } })
  })
  await syncUserTitle(affected)
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  await audit(ctx.schoolId, ctx.actorId, 'change-role', 'user', user.id, { role: target.role }, { role: fresh.role })
  await logChange(ctx.schoolId, user.id, 'Role', target.role, fresh.role, ctx.actorId) // A4 (best-effort, never blocks the response)
  res.json({ user: toClientUser(fresh) })
}))

const counselorBody = z.object({ isCounselor: z.boolean() })

// PATCH /:id/counselor — admin/superadmin only. Deliberately its own endpoint, not folded into the
// generic editable[] list on PATCH /:id: that generic path is reachable by `staff` managing a `teacher`
// (see access.ts#canManage), which would let plain staff grant/revoke counselor access — this capability
// gates the entire modules/counseling/ module (see phase-22-campus-safety.md → item 3), so it needs the
// same admin-only gate as /:id/role, not the broader canManage() rule.
usersRouter.patch('/:id/counselor', requireRole('admin', 'superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const body = validate(counselorBody, req.body)
  const target = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: ctx.schoolId } })
  if (!target) throw notFound('User')
  if (target.isCounselor === body.isCounselor) return res.json({ user: toClientUser(target) })
  const user = await prisma.user.update({ where: { id: target.id }, data: { isCounselor: body.isCounselor } })
  await audit(ctx.schoolId, ctx.actorId, 'set-counselor', 'user', user.id, { isCounselor: target.isCounselor }, { isCounselor: user.isCounselor })
  res.json({ user: toClientUser(user) })
}))

// Generic update — allowed if the requester is updating themselves, or canManage(requester, target).
const updateUser = wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const target = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: ctx.schoolId } })
  if (!target) throw notFound('User')

  const raw = req.body as Record<string, unknown>
  const isSelf = ctx.actorId === target.id
  if (isSelf) {
    // Verification is staff-driven (Phase 4 /api/verification); nobody self-verifies or self-promotes.
    if ('verified' in raw) throw new HttpError(403, 'Verification is decided by the school office')
    if ('role' in raw) throw new HttpError(403, 'You cannot change your own role')
  } else {
    const { requester, allUsers } = await requesterAndUsers(req as AuthedRequest)
    if (!canManage(requester as any, target as any, allUsers)) throw new HttpError(403, 'Not permitted to manage this user')
  }

  const body = validate(extras, req.body)
  const data = pickEditable(raw)
  if (body.password) {
    data.passwordHash = await bcrypt.hash(body.password, 10)
    if (!('mustChangePassword' in raw)) data.mustChangePassword = false
  }
  if (body.email) data.email = body.email.toLowerCase()

  if (body.classId && target.role !== 'student') throw new HttpError(400, 'classId is only valid for students')
  if (body.studentIds && target.role !== 'parent') throw new HttpError(400, 'studentIds is only valid for parents')
  if ('classTeacherOf' in body && target.role !== 'teacher') throw new HttpError(400, 'classTeacherOf is only valid for teachers')
  // A2: reportsTo, if being changed to a real value, must be another employee of this school with no
  // resulting cycle. Clearing it (null) needs no validation.
  if ('reportsTo' in raw && raw.reportsTo) await assertValidManager(ctx.schoolId, target.role, raw.reportsTo as string, target.id)

  const cls = body.classId ? await getClass(ctx.schoolId, body.classId) : null
  const classTeacherOf = body.classTeacherOf ? await getClass(ctx.schoolId, body.classTeacherOf) : null
  if (body.studentIds?.length) await assertRole(ctx.schoolId, body.studentIds, 'student')

  const affected: string[] = [target.id]
  const updated = await prisma.$transaction(async tx => {
    const user = await tx.user.update({ where: { id: target.id }, data: data as any })

    if (cls) {
      // Move the enrollment for that class's year, or create one.
      const existing = await tx.enrollment.findUnique({ where: { studentId_academicYearId: { studentId: user.id, academicYearId: cls.academicYearId } } })
      if (existing) {
        await tx.enrollment.update({ where: { id: existing.id }, data: { classId: cls.id, status: 'active', rollNo: body.rollNo === undefined ? undefined : body.rollNo } })
      } else {
        await tx.enrollment.create({ data: { schoolId: ctx.schoolId, studentId: user.id, classId: cls.id, academicYearId: cls.academicYearId, rollNo: body.rollNo ?? null } })
      }
    } else if (body.rollNo !== undefined && target.role === 'student') {
      const year = await tx.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true } })
      const existing = await tx.enrollment.findFirst({ where: { studentId: user.id, ...(year ? { academicYearId: year.id } : {}) }, orderBy: { createdAt: 'desc' } })
      if (existing) await tx.enrollment.update({ where: { id: existing.id }, data: { rollNo: body.rollNo } })
    }

    if (body.studentIds) {
      const current = await tx.guardian.findMany({ where: { parentId: user.id } })
      affected.push(...current.map(g => g.studentId), ...body.studentIds)
      await tx.guardian.deleteMany({ where: { parentId: user.id, studentId: { notIn: body.studentIds } } })
      const have = new Set(current.map(g => g.studentId))
      const add = body.studentIds.filter(id => !have.has(id))
      if (add.length) await tx.guardian.createMany({ data: add.map(studentId => ({ schoolId: ctx.schoolId, parentId: user.id, studentId, relation: 'parent' })) })
    }

    if ('classTeacherOf' in body) {
      await tx.class.updateMany({ where: { classTeacherId: user.id, ...(classTeacherOf ? { id: { not: classTeacherOf.id } } : {}) }, data: { classTeacherId: null } })
      if (classTeacherOf) {
        affected.push(classTeacherOf.classTeacherId ?? '')
        await tx.class.update({ where: { id: classTeacherOf.id }, data: { classTeacherId: user.id } })
      }
    }
    return user
  })

  await syncUserTitle(affected)
  const user = await prisma.user.findUniqueOrThrow({ where: { id: updated.id } })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'user', user.id, toClientUser(target), toClientUser(user))
  // A4 — best-effort employment-history log, never blocks the response (see logChange()).
  if (target.designation !== user.designation) await logChange(ctx.schoolId, user.id, 'Designation', target.designation, user.designation ?? '—', ctx.actorId)
  if (target.department !== user.department) await logChange(ctx.schoolId, user.id, 'Department', target.department, user.department ?? '—', ctx.actorId)
  res.json({ user: toClientUser(user) })
})

usersRouter.patch('/:id', updateUser)
usersRouter.put('/:id', updateUser)

const activeBody = z.object({ active: z.boolean() })

// PATCH /:id/active — Bug A fix: the People-management screen's "Revoke access" action soft-deactivates
// an account instead of hard-deleting it, reusing the exact `active: false` convention the resignation
// -approval flow already established (see modules/hr/service.ts#approveResignation /
// deactivateIfPastLastWorkingDate) — login is refused for inactive accounts (routes/auth.ts). Same
// canManage() gate as the old DELETE handler used, so this is a straight swap of the destructive action
// for a reversible one; `active: true` reactivates (mirrored, since deactivating is no longer one-way).
usersRouter.patch('/:id/active', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const body = validate(activeBody, req.body)
  const { requester, allUsers } = await requesterAndUsers(req as AuthedRequest)
  const target = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: ctx.schoolId } })
  if (!target) throw notFound('User')
  if (!canManage(requester as any, target as any, allUsers)) throw new HttpError(403, 'Not permitted to manage this user')
  if (target.active === body.active) return res.json({ user: toClientUser(target) })
  const user = await prisma.user.update({ where: { id: target.id }, data: { active: body.active } })
  await audit(ctx.schoolId, ctx.actorId, body.active ? 'reactivate' : 'deactivate', 'user', user.id, { active: target.active }, { active: user.active })
  res.json({ user: toClientUser(user) })
}))

// DELETE /:id — genuine hard delete. Restricted to superadmin only (Bug A fix): the People screen no
// longer calls this (it uses PATCH /:id/active above), so the only remaining callers are deliberate
// cleanup of a mistakenly-created test account with no real history to protect. canManage() alone let a
// plain teacher hard-delete any student/parent in the school; now that the everyday "remove someone"
// action is the reversible deactivate above, that breadth is no longer an acceptable default for the
// one-way, cascading operation left on this route, so it is narrowed to superadmin rather than scoped
// down within canManage() (which other, non-destructive call sites still rely on unchanged).
usersRouter.delete('/:id', requireRole('superadmin'), wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const { requester, allUsers } = await requesterAndUsers(req as AuthedRequest)
  const target = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: ctx.schoolId } })
  if (!target) throw notFound('User')
  if (!canManage(requester as any, target as any, allUsers)) throw new HttpError(403, 'Not permitted to delete this user')

  // Guardians cascade away with the user, so collect the parents whose wards/title change first.
  const parents = await prisma.guardian.findMany({ where: { studentId: target.id }, select: { parentId: true } })
  // Enrollment/Guardian cascade; ClassSubject.teacherId and Class.classTeacherId are set null by the DB.
  await prisma.user.delete({ where: { id: target.id } })
  await syncUserTitle(parents.map(p => p.parentId))
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'user', target.id, toClientUser(target))
  res.json({ ok: true })
}))

// ═══════════════════════════ Phase 11 · A6 employee documents + ID card ═══════════════════════════
// See phase-11-employee-management.md. No new file-storage code: upload via POST /api/files first, then
// attach the returned fileId here with a label. HR/admin only end to end (see modules/employeeDocuments
// /service.ts for why the employee's own Profile does not get document management in this phase).

usersRouter.get('/:id/documents', wrap(async (req, res) => {
  const items = (await docsSvc.listDocuments(ctxOf(req as AuthedRequest), req.params.id)).map(serializeDocument)
  res.json({ items })
}))
usersRouter.post('/:id/documents', wrap(async (req, res) => {
  const item = serializeDocument(await docsSvc.addDocumentRow(ctxOf(req as AuthedRequest), req.params.id, validate(addDocument, req.body)))
  res.status(201).json({ item })
}))
usersRouter.delete('/:id/documents/:docId', wrap(async (req, res) => {
  await docsSvc.removeDocument(ctxOf(req as AuthedRequest), req.params.id, req.params.docId)
  res.json({ ok: true })
}))

// GET /:id/id-card.pdf — self or HR/admin. The ":id" segment is followed by a literal "/id-card.pdf", so
// (unlike modules/hr/router.ts's "/contracts/:id.pdf") there is no ordering hazard with a generic "/:id".
usersRouter.get('/:id/id-card.pdf', wrap(async (req, res) => {
  const { bytes, name } = await docsSvc.idCardPdf(ctxOf(req as AuthedRequest), req.params.id)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.end(bytes)
}))
