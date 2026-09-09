import type { SchoolGroup, GroupAdmin } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import * as feesSvc from '../fees/service'
import * as attendanceSvc from '../attendance/service'
import * as analyticsSvc from '../analytics/service'
import * as syllabusSvc from '../syllabus/service'
import { list as listClassSubjects } from '../classSubjects/service'
import type { GroupCtx, GroupRole } from './access'
import { assertGroupAdminRole } from './access'
import type { grantAdminBody } from './schema'
import type { z } from 'zod'

// See phase-28-multi-school-group.md. Everything below is strictly read-only cross-campus aggregation
// (item 2) plus group/membership management (item 3). Every cross-school read is N *separate* calls into
// each member school's own existing single-school service function, each with a synthetic single-school
// Ctx scoped to that school's real schoolId — never one query spanning two schools' rows. Data isolation
// between schools is exactly as strict as it is everywhere else in the app; only the caller (this module)
// is allowed to see more than one school's aggregate numbers side by side.

export const serializeGroup = (g: SchoolGroup) => ({ id: g.id, name: g.name, createdAt: g.createdAt.toISOString() })

export const serializeGroupAdmin = (g: GroupAdmin) => ({
  id: g.id, groupId: g.groupId, userId: g.userId, role: g.role as GroupRole, createdAt: g.createdAt.toISOString(),
})

// A synthetic, throwaway single-school Ctx used only to call into another module's existing service
// functions with that school's own schoolId. `role: 'admin'` because every reused function's internal
// authorization (isStaff/isAdmin/canViewClass-for-non-restricted-roles) already treats 'admin' as
// unrestricted read access — this does not touch or bypass any of those checks, it satisfies them the
// same way a real per-school admin would.
function schoolCtx(schoolId: string, actorId: string): Ctx {
  return { schoolId, actorId, role: 'admin' }
}

// Resolves the group-level `?termId=` (which, being a Term row, only ever belongs to ONE school) against
// one particular member school: use it only if it's actually that school's own term, otherwise fall back
// to that school's own current term. This is what lets one `?termId=` on the overview route be harmless
// even though schools don't share Term rows.
async function resolveSchoolTermId(schoolId: string, termId?: string): Promise<string | undefined> {
  if (termId) {
    const t = await prisma.term.findFirst({ where: { id: termId, schoolId } })
    if (t) return t.id
  }
  const current = await prisma.term.findFirst({ where: { schoolId, isCurrent: true } })
  return current?.id
}

// ─────────────────────────── membership discovery (self-lookup, no group-specific access check) ───────────────────────────

export async function myMemberships(actorId: string, homeSchoolId: string) {
  const [grants, homeSchool] = await Promise.all([
    prisma.groupAdmin.findMany({ where: { userId: actorId }, include: { group: true } }),
    prisma.school.findUnique({ where: { id: homeSchoolId }, include: { group: true } }),
  ])
  return {
    memberships: grants.map(g => ({ groupId: g.groupId, groupName: g.group.name, role: g.role as GroupRole })),
    school: { id: homeSchoolId, groupId: homeSchool?.groupId ?? null, groupName: homeSchool?.group?.name ?? null },
  }
}

// ─────────────────────────── group + membership management ───────────────────────────

// Platform-level action — restricted to a superadmin of ANY school (there is no higher "platform admin"
// concept in this codebase yet; see phase-28 spec §3, a documented limitation for a future phase). The
// creator is auto-granted 'GroupAdmin' on the new group — otherwise POST /:id/admins (which requires an
// *existing* GroupAdmin) could never be called by anyone, ever.
export async function createGroup(actorId: string, actorSchoolId: string, name: string) {
  const group = await prisma.schoolGroup.create({ data: { name } })
  await prisma.groupAdmin.create({ data: { groupId: group.id, userId: actorId, role: 'GroupAdmin' } })
  await audit(actorSchoolId, actorId, 'create', 'schoolGroup', group.id, undefined, { name: group.name })
  await audit(actorSchoolId, actorId, 'grant', 'groupAdmin', group.id, undefined, { userId: actorId, role: 'GroupAdmin', bootstrap: true })
  return group
}

// `ctx` here is a REAL single-school Ctx (from the existing rbac.ctxOf(req)) — this endpoint is
// deliberately gated by the ordinary requireRole('superadmin') + "is this your own school" check, NOT by
// assertGroupAccess, precisely so a school can only ever add ITSELF to a group (its own superadmin's own
// consent) — never claim another school it doesn't administer.
export async function addSchool(ctx: Ctx, groupId: string) {
  const group = await prisma.schoolGroup.findUnique({ where: { id: groupId } })
  if (!group) throw notFound('School group')
  const school = await prisma.school.findUnique({ where: { id: ctx.schoolId } })
  if (!school) throw notFound('School')
  if (school.groupId === groupId) return school // idempotent no-op — already a member
  if (school.groupId) throw new HttpError(409, 'This school already belongs to a different group — remove it from that group first')
  const updated = await prisma.school.update({ where: { id: ctx.schoolId }, data: { groupId } })
  await audit(ctx.schoolId, ctx.actorId, 'add-to-group', 'school', ctx.schoolId, { groupId: school.groupId ?? null }, { groupId })
  return updated
}

export async function listSchools(groupId: string) {
  return prisma.school.findMany({ where: { groupId }, select: { id: true, name: true, createdAt: true }, orderBy: { name: 'asc' } })
}

// Group's existing admins only (assertGroupAdminRole — a GroupViewer cannot grant access, only look).
export async function grantAdmin(gctx: GroupCtx, auditSchoolId: string, input: z.infer<typeof grantAdminBody>) {
  assertGroupAdminRole(gctx)
  const user = await prisma.user.findUnique({ where: { id: input.userId } })
  if (!user) throw notFound('User')
  const before = await prisma.groupAdmin.findUnique({ where: { groupId_userId: { groupId: gctx.groupId, userId: input.userId } } })
  const row = await prisma.groupAdmin.upsert({
    where: { groupId_userId: { groupId: gctx.groupId, userId: input.userId } },
    create: { groupId: gctx.groupId, userId: input.userId, role: input.role },
    update: { role: input.role },
  })
  await audit(auditSchoolId, gctx.actorId, before ? 'update' : 'grant', 'groupAdmin', row.id, before ? serializeGroupAdmin(before) : undefined, serializeGroupAdmin(row))
  return row
}

export async function listAdmins(groupId: string) {
  const rows = await prisma.groupAdmin.findMany({ where: { groupId }, include: { user: { select: { id: true, name: true, email: true, schoolId: true } } } })
  return rows.map(r => ({ ...serializeGroupAdmin(r), user: r.user }))
}

// ─────────────────────────── cross-campus aggregation (strictly read-only) ───────────────────────────

// One classSubject at a time, exactly as the real /api/syllabus/pace/:classSubjectId endpoint would
// compute it — this loop is what "reuse Phase 18/19's aggregation" means when no ready-made *school-wide*
// pace summary function already exists (computePace is inherently per-classSubject); every call is scoped
// to classSubjects that already belong to `ctx.schoolId`.
async function syllabusPaceSummary(ctx: Ctx, termId?: string) {
  const classSubjects = await listClassSubjects(ctx)
  let onPace = 0, behind = 0, noData = 0
  for (const cs of classSubjects) {
    try {
      const result = await syllabusSvc.computePace(ctx, cs.id, { termId })
      if (result.expected === null) { noData++; continue }
      if (result.paceDeltaChapters >= 0) onPace++
      else behind++
    } catch {
      noData++
    }
  }
  const totalTracked = onPace + behind
  return { onPace, behind, noData, totalTracked, onPacePct: totalTracked ? Math.round((onPace / totalTracked) * 1000) / 10 : 0 }
}

async function schoolOverviewRow(actorId: string, school: { id: string; name: string }, groupTermId?: string) {
  const ctx = schoolCtx(school.id, actorId)
  const termId = await resolveSchoolTermId(school.id, groupTermId)

  const [fees, attendance, syllabusPace, teacherLoad] = await Promise.all([
    feesSvc.summary(ctx, { termId }).catch(() => null),
    termId ? attendanceSvc.schoolSummary(ctx, termId).catch(() => null) : Promise.resolve(null),
    syllabusPaceSummary(ctx, termId),
    analyticsSvc.teacherWorkload(ctx, { termId }).catch(() => null),
  ])

  return {
    schoolId: school.id,
    schoolName: school.name,
    termId: termId ?? null,
    fees: fees ? {
      collected: fees.collected, outstanding: fees.outstanding, invoiced: fees.invoiced,
      collectionPct: fees.invoiced > 0 ? Math.round((fees.collected / fees.invoiced) * 1000) / 10 : 0,
    } : null,
    attendance: attendance ? { present: attendance.present, total: attendance.total, pct: attendance.pct } : null,
    syllabusPace,
    teacherLoad: teacherLoad ? {
      teacherCount: teacherLoad.items.length,
      avgPeriodsPerWeek: teacherLoad.items.length ? Math.round((teacherLoad.items.reduce((a, t) => a + t.periodsPerWeek, 0) / teacherLoad.items.length) * 10) / 10 : 0,
      overThresholdCount: teacherLoad.items.filter(t => t.overThreshold).length,
      highLoadThreshold: teacherLoad.highLoadThreshold,
    } : null,
  }
}

export async function overview(groupId: string, actorId: string, termId?: string) {
  const schools = await listSchools(groupId)
  const items = await Promise.all(schools.map(s => schoolOverviewRow(actorId, s, termId)))
  return { groupId, items }
}

// Conservative by design (spec §2): only the same safe, already-existing per-school report functions used
// by the overview above, one at a time, never a raw student/PII list. `report` defaults to 'fees'.
export async function drilldown(gctx: GroupCtx, schoolId: string, query: { termId?: string; report?: 'fees' | 'attendance' | 'syllabus' | 'teacherLoad' }) {
  const school = await prisma.school.findFirst({ where: { id: schoolId, groupId: gctx.groupId } })
  if (!school) throw notFound('School (not a member of this group)')
  const ctx = schoolCtx(schoolId, gctx.actorId)
  const termId = await resolveSchoolTermId(schoolId, query.termId)
  const report = query.report ?? 'fees'

  let data: unknown
  if (report === 'fees') data = await feesSvc.summary(ctx, { termId })
  else if (report === 'attendance') data = termId ? await attendanceSvc.schoolSummary(ctx, termId) : { termId: null, present: 0, total: 0, pct: 0 }
  else if (report === 'syllabus') data = await syllabusPaceSummary(ctx, termId)
  else data = await analyticsSvc.teacherWorkload(ctx, { termId })

  return { report, schoolId, schoolName: school.name, termId: termId ?? null, data }
}
