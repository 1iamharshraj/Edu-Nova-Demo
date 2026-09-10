import type { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import type { createConstraint, patchConstraint } from './schema'

// ───────────────────────── Phase T4 §3 — Constraint Builder ─────────────────────────
// A real, queryable, school-configurable table (phase-t4-solver-core.md §3) — not hardcoded logic. The
// generation engine (./solver.ts) reads the active (`enabled=true`) rows of this table for a school and
// only applies the checks those rows name; it never hardcodes which constraints exist. `severity` is
// HARD-only this phase (soft constraints/scoring are T5's job).

// The fixed catalog of constraint types this phase's solver knows how to enforce. TEACHER_AVAILABILITY is
// registered here (its parameters/scope shape are stable) but is a documented no-op until a
// TeacherAvailability-shaped data source exists in this schema — see this phase's final report for the
// gap (T1's roadmap summary describes a TeacherAvailability table, but it was not actually part of the
// shipped T1 migration; nothing in this codebase's schema backs it yet).
export const DEFAULT_CONSTRAINTS: Array<{ type: string; scope: string; parameters: Record<string, unknown> }> = [
  { type: 'TEACHER_COLLISION', scope: 'SCHOOL', parameters: {} },
  { type: 'ROOM_COLLISION', scope: 'SCHOOL', parameters: {} },
  { type: 'COHORT_COLLISION', scope: 'SCHOOL', parameters: {} },
  { type: 'ROOM_CAPABILITY_MATCH', scope: 'SCHOOL', parameters: {} },
  { type: 'REQUIRED_WEEKLY_PERIODS', scope: 'SCHOOL', parameters: {} },
  { type: 'FIXED_SESSION', scope: 'SCHOOL', parameters: {} },
]

export const serializeConstraint = (c: {
  id: string; schoolId: string; type: string; scope: string; scopeId: string | null
  severity: string; enabled: boolean; parameters: unknown; source: string; createdAt: Date
}) => ({
  id: c.id,
  schoolId: c.schoolId,
  type: c.type,
  scope: c.scope,
  scopeId: c.scopeId ?? undefined,
  severity: c.severity,
  enabled: c.enabled,
  parameters: c.parameters,
  source: c.source,
  createdAt: c.createdAt.toISOString(),
})

export function list(ctx: Ctx, filter?: { type?: string; scope?: string; enabled?: boolean }) {
  return prisma.constraint.findMany({
    where: { schoolId: ctx.schoolId, type: filter?.type, scope: filter?.scope, enabled: filter?.enabled },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.constraint.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Constraint')
  return row
}

export async function create(ctx: Ctx, input: z.infer<typeof createConstraint>) {
  const row = await prisma.constraint.create({
    data: {
      schoolId: ctx.schoolId,
      type: input.type,
      scope: input.scope,
      scopeId: input.scopeId ?? null,
      severity: input.severity,
      enabled: input.enabled,
      parameters: input.parameters as Prisma.InputJsonValue,
      source: input.source,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'constraint', row.id, undefined, serializeConstraint(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchConstraint>) {
  const before = await get(ctx, id)
  // Disabling a SYSTEM default (e.g. TEACHER_COLLISION) is allowed — a school may choose to turn one off —
  // it's simply on the audit trail below like any other change, since it changes what "zero hard-
  // constraint violations" means for future generation runs.
  const row = await prisma.constraint.update({
    where: { id },
    data: { enabled: input.enabled, parameters: input.parameters as Prisma.InputJsonValue | undefined },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'constraint', id, serializeConstraint(before), serializeConstraint(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  if (before.source === 'SYSTEM') throw new HttpError(400, 'A system default constraint cannot be deleted — disable it instead (PATCH enabled: false)')
  await prisma.constraint.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'constraint', id, serializeConstraint(before))
}

// Idempotent — safe to call more than once (mirrors modules/capabilities/service.ts#seedDefaults and
// modules/admissionDocuments/service.ts#seedDefaultCategories).
export async function seedDefaults(ctx: Ctx) {
  const existing = new Set((await prisma.constraint.findMany({ where: { schoolId: ctx.schoolId, source: 'SYSTEM' } })).map(c => c.type))
  const missing = DEFAULT_CONSTRAINTS.filter(c => !existing.has(c.type))
  for (const c of missing) {
    await prisma.constraint.create({
      data: { schoolId: ctx.schoolId, type: c.type, scope: c.scope, severity: 'HARD', enabled: true, parameters: c.parameters as Prisma.InputJsonValue, source: 'SYSTEM' },
    })
  }
  if (missing.length) await audit(ctx.schoolId, ctx.actorId, 'seed-defaults', 'constraint', ctx.schoolId, undefined, { added: missing.map(c => c.type) })
  return missing.length
}

// Which of the fixed hard-constraint checks are currently active for this school (solver.ts calls this
// once per generation run). A type with no enabled row at all is treated as OFF, not "on by default" —
// per §3, the Constraint Builder reads active rows; it does not assume a check applies just because the
// solver knows how to perform it.
export async function activeTypes(ctx: Ctx): Promise<Set<string>> {
  const rows = await prisma.constraint.findMany({ where: { schoolId: ctx.schoolId, enabled: true, severity: 'HARD' } })
  return new Set(rows.map(r => r.type))
}
