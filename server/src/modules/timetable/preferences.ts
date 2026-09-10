import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { seedAssignmentPreferenceDefaults } from './assignmentModes'
import { seedRefinementPreferenceDefaults } from './refinement'
import type { patchPreference } from './schema'

// ───────────────────────── Phase T5 §2/§3 — Preference (base weight rows) ─────────────────────────
// Real, school-configurable data (per the original spec's principle — not hardcoded), seeded with T0's
// spike's own example weights as sensible defaults. See assignmentModes.ts / refinement.ts for how these
// rows are consumed by Mode 4 selection and the SA refinement engine respectively.

export const serializePreference = (p: { id: string; type: string; scope: string; weight: number; priority: number; enabled: boolean; parameters: unknown }) => ({
  id: p.id, type: p.type, scope: p.scope, weight: p.weight, priority: p.priority, enabled: p.enabled, parameters: p.parameters,
})

export function list(ctx: Ctx, filter?: { scope?: string }) {
  return prisma.preference.findMany({ where: { schoolId: ctx.schoolId, scope: filter?.scope }, orderBy: [{ scope: 'asc' }, { type: 'asc' }] })
}

// Idempotent, mirrors constraints.ts#seedDefaults — seeds BOTH scopes in one call since a school configuring
// one almost always wants the other too, and re-running is always safe.
export async function seedDefaults(ctx: Ctx) {
  const [assignmentAdded, refinementAdded] = await Promise.all([
    seedAssignmentPreferenceDefaults(ctx),
    seedRefinementPreferenceDefaults(ctx),
  ])
  const added = assignmentAdded + refinementAdded
  if (added) await audit(ctx.schoolId, ctx.actorId, 'seed-defaults', 'preference', ctx.schoolId, undefined, { assignmentAdded, refinementAdded })
  return { added, assignmentAdded, refinementAdded }
}

export async function update(ctx: Ctx, type: string, input: z.infer<typeof patchPreference>) {
  const before = await prisma.preference.findUnique({ where: { schoolId_type: { schoolId: ctx.schoolId, type } } })
  if (!before) throw notFound('Preference — run POST /preferences/seed-defaults first')
  const row = await prisma.preference.update({
    where: { id: before.id },
    data: { weight: input.weight, enabled: input.enabled, parameters: input.parameters as object | undefined },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'preference', row.id, serializePreference(before), serializePreference(row))
  return row
}
