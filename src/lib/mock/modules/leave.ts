// Mirrors server/src/modules/leave/{router,schema,service}.ts's contract for the endpoints
// src/lib/hooks/useHr.ts (leave types/requests/balance) + src/portal/modules/hr.tsx +
// src/portal/modules/actions.tsx (LeaveMod, parent-filed leave for a ward) call. The real server's Phase
// T9 substitution workflow (`PENDING_SUBSTITUTION`, chained-absence detection, teaching-period holds) is
// intentionally NOT simulated here — it lives in the timetable module (a different, not-yet-built batch)
// and every non-teaching leave (the overwhelming majority of what this demo clicks through — student
// leave, staff leave) never touches it anyway. `approve()` below always resolves the request directly.

import { route, requireAuth, crud } from '../router'
import { badRequest, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const ADMIN_ROLES = ['admin', 'superadmin']
function isAdmin(role: string) { return ADMIN_ROLES.includes(role) }
function isStaff(role: string) { return ['staff', ...ADMIN_ROLES].includes(role) }

function serializeLeaveType(t: Row) {
  return { id: t.id, name: t.name, daysPerYear: t.daysPerYear, appliesTo: t.appliesTo, createdAt: t.createdAt }
}

function serializeLeaveRequest(r: Row) {
  const leaveType = r.leaveTypeId ? table('LeaveType').find(t => t.id === r.leaveTypeId) : undefined
  const forUser = table('User').find(u => u.id === r.forUserId)
  const requester = table('User').find(u => u.id === r.requesterId)
  return {
    id: r.id, requesterId: r.requesterId, forUserId: r.forUserId, leaveTypeId: r.leaveTypeId ?? undefined,
    fromDate: r.fromDate, toDate: r.toDate, days: r.days, reason: r.reason, status: r.status,
    decidedById: r.decidedById ?? undefined, decidedAt: r.decidedAt ?? undefined, decisionNote: r.decisionNote ?? undefined,
    createdAt: r.createdAt, forUserName: forUser?.name as string | undefined, requesterName: requester?.name as string | undefined,
    leaveTypeName: leaveType?.name as string | undefined,
  }
}

// Inclusive day count between two ISO dates, excluding Sundays — matches the real service.ts#countDays.
function countDays(from: string, to: string): number {
  let days = 0
  const d = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  while (d.getTime() <= end.getTime()) {
    if (d.getUTCDay() !== 0) days++
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}

function wardsOf(parentId: string): string[] {
  return table('Guardian').filter(g => g.parentId === parentId).map(g => String(g.studentId))
}

function teacherClassIds(teacherId: string): string[] {
  const owns = table('Class').filter(c => c.classTeacherId === teacherId).map(c => String(c.id))
  const teaches = table('ClassSubject').filter(cs => cs.teacherId === teacherId).map(cs => String(cs.classId))
  return [...new Set([...owns, ...teaches])]
}

function classTeacherOfStudent(studentId: string): string | null {
  const enr = table('Enrollment').filter(e => e.studentId === studentId && e.status === 'active')
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
  if (!enr) return null
  const cls = table('Class').find(c => c.id === enr.classId)
  return cls ? String(cls.classTeacherId ?? '') || null : null
}

// ═══════════════════════════ leave types ═══════════════════════════

crud('/leave/types', 'LeaveType', { serialize: serializeLeaveType, writeRoles: ADMIN_ROLES })

// ═══════════════════════════ requests ═══════════════════════════

route('GET', '/leave/requests', (ctx) => {
  const actor = requireAuth(ctx)
  let rows = table('LeaveRequest').filter(r => r.schoolId === actor.schoolId)

  if (actor.role === 'student') {
    const forUserId = ctx.query.forUserId || actor.userId
    if (forUserId !== actor.userId) throw badRequest('You may only view your own leave requests')
    rows = rows.filter(r => r.forUserId === actor.userId)
  } else if (actor.role === 'parent') {
    const wards = wardsOf(actor.userId)
    if (ctx.query.forUserId) {
      if (!wards.includes(ctx.query.forUserId)) throw badRequest('That student is not your ward')
      rows = rows.filter(r => r.forUserId === ctx.query.forUserId)
    } else {
      rows = rows.filter(r => wards.includes(String(r.forUserId)))
    }
  } else if (actor.role === 'teacher') {
    if (ctx.query.scope === 'approvals') {
      const classIds = teacherClassIds(actor.userId)
      const studentIds = new Set(table('Enrollment').filter(e => classIds.includes(String(e.classId)) && e.status === 'active').map(e => String(e.studentId)))
      rows = ctx.query.forUserId
        ? rows.filter(r => r.forUserId === ctx.query.forUserId && studentIds.has(String(r.forUserId)))
        : rows.filter(r => studentIds.has(String(r.forUserId)))
    } else if (ctx.query.forUserId) {
      if (ctx.query.forUserId !== actor.userId) throw badRequest('You may only view your own leave requests')
      rows = rows.filter(r => r.forUserId === actor.userId)
    } else {
      rows = rows.filter(r => r.requesterId === actor.userId || r.forUserId === actor.userId)
    }
  } else if (!isStaff(actor.role)) {
    throw badRequest('Forbidden')
  } else if (ctx.query.forUserId) {
    rows = rows.filter(r => r.forUserId === ctx.query.forUserId)
  }
  // staff/admin/superadmin with no forUserId filter: see all.

  if (ctx.query.status) rows = rows.filter(r => r.status === ctx.query.status)
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializeLeaveRequest) }
})

route('POST', '/leave/requests', (ctx) => {
  const actor = requireAuth(ctx)
  const body = ctx.body as { forUserId: string; leaveTypeId?: string; fromDate: string; toDate: string; reason: string }
  const forUser = table('User').find(u => u.id === body.forUserId && u.schoolId === actor.schoolId)
  if (!forUser) throw notFound('User')

  if (actor.role === 'parent') {
    if (!wardsOf(actor.userId).includes(forUser.id as string)) throw badRequest('That student is not your ward')
  } else if (forUser.id !== actor.userId) {
    throw badRequest('You may only request leave for yourself')
  }
  if (body.toDate < body.fromDate) throw badRequest('toDate must be on or after fromDate')

  let leaveType: Row | undefined
  if (body.leaveTypeId) {
    leaveType = table('LeaveType').find(t => t.id === body.leaveTypeId && t.schoolId === actor.schoolId)
    if (!leaveType) throw notFound('Leave type')
    const expected = forUser.role === 'student' ? 'student' : 'staff'
    if (leaveType.appliesTo !== expected) throw badRequest(`This leave type does not apply to a ${forUser.role === 'student' ? 'student' : 'staff member'}`)
  }

  const row: Row = {
    id: uid('leaveRequest'), schoolId: actor.schoolId, requesterId: actor.userId, forUserId: forUser.id,
    leaveTypeId: leaveType?.id ?? null, fromDate: body.fromDate, toDate: body.toDate, days: countDays(body.fromDate, body.toDate),
    reason: body.reason, status: 'Pending', createdAt: nowIso(),
  }
  const rows = table('LeaveRequest'); rows.push(row); saveTable('LeaveRequest', rows)
  return { item: serializeLeaveRequest(row) }
})

function assertPending(row: Row) {
  if (row.status !== 'Pending') throw badRequest(`Leave request is already ${String(row.status).toLowerCase()}`)
}

function assertCanDecide(actor: { userId: string; role: string }, row: Row) {
  const forUser = table('User').find(u => u.id === row.forUserId)
  if (forUser?.role === 'student') {
    if (isStaff(actor.role)) return
    if (actor.role === 'teacher' && classTeacherOfStudent(String(row.forUserId)) === actor.userId) return
    throw badRequest('You are not authorised to decide this leave request')
  }
  if (isAdmin(actor.role)) return
  throw badRequest('Only admin/superadmin may decide staff leave requests')
}

route('POST', '/leave/requests/:id/approve', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('LeaveRequest')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Leave request')
  assertPending(rows[idx])
  assertCanDecide(actor, rows[idx])
  const body = ctx.body as { note?: string }
  rows[idx] = { ...rows[idx], status: 'Approved', decidedById: actor.userId, decidedAt: nowIso(), decisionNote: body.note ?? null }
  saveTable('LeaveRequest', rows)
  return { item: serializeLeaveRequest(rows[idx]) }
})

route('POST', '/leave/requests/:id/decline', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('LeaveRequest')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Leave request')
  assertPending(rows[idx])
  assertCanDecide(actor, rows[idx])
  const body = ctx.body as { note?: string }
  rows[idx] = { ...rows[idx], status: 'Declined', decidedById: actor.userId, decidedAt: nowIso(), decisionNote: body.note ?? null }
  saveTable('LeaveRequest', rows)
  return { item: serializeLeaveRequest(rows[idx]) }
})

route('POST', '/leave/requests/:id/cancel', (ctx) => {
  const actor = requireAuth(ctx)
  const rows = table('LeaveRequest')
  const idx = rows.findIndex(r => r.id === ctx.params.id && r.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Leave request')
  assertPending(rows[idx])
  if (rows[idx].requesterId !== actor.userId) throw badRequest('Only the requester may cancel this leave request')
  rows[idx] = { ...rows[idx], status: 'Cancelled' }
  saveTable('LeaveRequest', rows)
  return { item: serializeLeaveRequest(rows[idx]) }
})

// ═══════════════════════════ balance ═══════════════════════════

route('GET', '/leave/balance', (ctx) => {
  const actor = requireAuth(ctx)
  const userId = ctx.query.userId || actor.userId
  if (userId !== actor.userId) {
    if (actor.role === 'parent') {
      if (!wardsOf(actor.userId).includes(userId)) throw badRequest('That student is not your ward')
    } else if (!isStaff(actor.role)) {
      throw badRequest('You may only view your own leave balance')
    }
  }
  const user = table('User').find(u => u.id === userId && u.schoolId === actor.schoolId)
  if (!user) throw notFound('User')
  const appliesTo = user.role === 'student' ? 'student' : 'staff'
  const year = ctx.query.year || String(new Date().getUTCFullYear())

  const types = table('LeaveType').filter(t => t.schoolId === actor.schoolId && t.appliesTo === appliesTo)
  const approved = table('LeaveRequest').filter(r => r.schoolId === actor.schoolId && r.forUserId === userId && r.status === 'Approved' && String(r.fromDate).startsWith(year))
  const usedByType = new Map<string, number>()
  for (const r of approved) {
    if (!r.leaveTypeId) continue
    usedByType.set(String(r.leaveTypeId), (usedByType.get(String(r.leaveTypeId)) ?? 0) + Number(r.days))
  }
  return {
    items: types.map(t => {
      const used = usedByType.get(String(t.id)) ?? 0
      const unlimited = Number(t.daysPerYear) === 0
      return { leaveTypeId: t.id, name: t.name, allowed: t.daysPerYear, used, remaining: unlimited ? null : Number(t.daysPerYear) - used }
    }),
  }
})
