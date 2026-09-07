import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { requireAuth, type AuthedRequest } from '../auth'
import { toClientUser } from '../serialize'
import { canManage } from '../access'
import { makeEmail, rolePassword, uid, idPrefixFor, type Role } from '../userDefaults'
import { HttpError, notFound, wrap } from '../lib/errors'
import { ctxOf, requireRole } from '../lib/rbac'
import { validate } from '../lib/validate'
import { audit } from '../lib/audit'
import { syncLegacyUserFields, usersTouchingClasses } from '../lib/legacySync'

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

const editable = ['name', 'title', 'avatarHue', 'verified', 'mustChangePassword', 'class', 'section', 'roll', 'subjects', 'department', 'designation', 'reportsTo', 'joinDate', 'phone', 'parentEmail', 'board', 'dob', 'salary', 'wards', 'contract', 'resignation', 'photoFileId', 'emergencyContact', 'address'] as const

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

usersRouter.get('/', wrap(async (req, res) => {
  const users = await prisma.user.findMany({ where: { schoolId: (req as AuthedRequest).auth!.schoolId } })
  res.json({ users: users.map(u => toClientUser(u)) })
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

  const email = (body.email ?? makeEmail(body.name, role)).toLowerCase()
  const password = body.password ?? rolePassword(role)
  const passwordHash = await bcrypt.hash(password, 10)
  const raw = req.body as Record<string, unknown>

  const created = await prisma.$transaction(async tx => {
    const user = await tx.user.create({
      data: {
        ...pickEditable(raw),
        id: uid(idPrefixFor(role)),
        schoolId: ctx.schoolId,
        role,
        name: body.name,
        email,
        passwordHash,
        title: (raw.title as string) ?? `${role} · onboarded`,
        avatarHue: (raw.avatarHue as number) ?? Math.floor(Math.random() * 360),
        verified: (raw.verified as boolean) ?? true,
        joinDate: (raw.joinDate as string) ?? new Date().toISOString().slice(0, 10),
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

  await syncLegacyUserFields([created.id, ...(body.studentIds ?? []), classTeacherOf?.classTeacherId ?? ''])
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
  if (body.name !== undefined) await syncLegacyUserFields([user.id])
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'user', user.id, toClientUser(before), toClientUser(fresh))
  res.json({ user: toClientUser(fresh) })
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
    return tx.user.update({ where: { id: target.id }, data: { role: body.role, subjects: target.role === 'teacher' ? Prisma.DbNull : undefined, class: target.role === 'teacher' ? null : undefined } })
  })
  await syncLegacyUserFields(affected)
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  await audit(ctx.schoolId, ctx.actorId, 'change-role', 'user', user.id, { role: target.role }, { role: fresh.role })
  res.json({ user: toClientUser(fresh) })
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

  await syncLegacyUserFields(affected)
  const user = await prisma.user.findUniqueOrThrow({ where: { id: updated.id } })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'user', user.id, toClientUser(target), toClientUser(user))
  res.json({ user: toClientUser(user) })
})

usersRouter.patch('/:id', updateUser)
usersRouter.put('/:id', updateUser)

usersRouter.delete('/:id', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const { requester, allUsers } = await requesterAndUsers(req as AuthedRequest)
  const target = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: ctx.schoolId } })
  if (!target) throw notFound('User')
  if (!canManage(requester as any, target as any, allUsers)) throw new HttpError(403, 'Not permitted to delete this user')

  // Guardians cascade away with the user, so collect the parents whose wards/title change first.
  const parents = await prisma.guardian.findMany({ where: { studentId: target.id }, select: { parentId: true } })
  // Enrollment/Guardian cascade; ClassSubject.teacherId and Class.classTeacherId are set null by the DB.
  await prisma.user.delete({ where: { id: target.id } })
  await syncLegacyUserFields(parents.map(p => p.parentId))
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'user', target.id, toClientUser(target))
  res.json({ ok: true })
}))
