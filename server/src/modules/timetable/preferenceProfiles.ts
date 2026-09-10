import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import type { patchPreferenceProfile } from './schema'

// ───────────────────────── Phase T5 §3 — PreferenceProfile ─────────────────────────
// See phase-t5-full-solver.md §3. All 7 named profiles from the original spec, seeded as real usable
// REFINEMENT-scope weight-override sets (not placeholders) — a school activates one, the refinement engine
// (refinement.ts#effectiveRefinementWeights) merges its overrides on top of the school's base Preference
// rows, and the school can still hand-adjust individual weights afterward via PATCH /preferences/:type.

export const PROFILE_DEFS: Record<string, { description: string; weightOverrides: Record<string, number> }> = {
  DEFAULT: {
    description: 'T0\'s own benchmarked defaults — no overrides beyond the base Preference weights.',
    weightOverrides: {},
  },
  BALANCED: {
    description: 'Evens out every signal — no single concern dominates.',
    weightOverrides: {
      LAB_SPLIT: 1, TEACHER_DAILY_OVERLOAD: 1, TEACHER_WEEKLY_OVERLOAD: 1,
      WORKLOAD_VARIANCE: 1, TEACHER_GAPS: 0.5,
      UNPREFERRED_SLOT: 1, FORCED_SAME_DAY_REPEAT: 1, ADJACENT_SAME_SUBJECT: 1,
    },
  },
  TEACHER_FRIENDLY: {
    description: 'Prioritizes teacher wellbeing — gaps and unpreferred-slot avoidance weighted heavily.',
    weightOverrides: {
      TEACHER_GAPS: 2, UNPREFERRED_SLOT: 3, TEACHER_DAILY_OVERLOAD: 2, TEACHER_WEEKLY_OVERLOAD: 2,
      WORKLOAD_VARIANCE: 1.5, LAB_SPLIT: 0.7, FORCED_SAME_DAY_REPEAT: 0.7, ADJACENT_SAME_SUBJECT: 0.5,
    },
  },
  STUDENT_FRIENDLY: {
    description: 'Prioritizes a clean student-facing week — no back-to-back repeats, minimal subject bunching.',
    weightOverrides: {
      FORCED_SAME_DAY_REPEAT: 3, ADJACENT_SAME_SUBJECT: 2.5, LAB_SPLIT: 1.5,
      TEACHER_GAPS: 0.3, UNPREFERRED_SLOT: 0.5, TEACHER_DAILY_OVERLOAD: 1, TEACHER_WEEKLY_OVERLOAD: 1, WORKLOAD_VARIANCE: 1,
    },
  },
  EXAM_PREP: {
    description: 'Favors even subject spread and low bunching over teacher convenience — exam-term scheduling.',
    weightOverrides: {
      FORCED_SAME_DAY_REPEAT: 2.5, ADJACENT_SAME_SUBJECT: 2, WORKLOAD_VARIANCE: 2,
      LAB_SPLIT: 0.5, TEACHER_GAPS: 0.2, UNPREFERRED_SLOT: 0.5, TEACHER_DAILY_OVERLOAD: 1, TEACHER_WEEKLY_OVERLOAD: 1,
    },
  },
  PRIMARY_SCHOOL: {
    description: 'Younger grades: minimal same-day repeats and gaps matter more than lab-block purity (few labs at this level).',
    weightOverrides: {
      FORCED_SAME_DAY_REPEAT: 2, ADJACENT_SAME_SUBJECT: 1.5, TEACHER_GAPS: 1.5,
      LAB_SPLIT: 0.3, UNPREFERRED_SLOT: 1, TEACHER_DAILY_OVERLOAD: 1.5, TEACHER_WEEKLY_OVERLOAD: 1, WORKLOAD_VARIANCE: 1,
    },
  },
  LAB_HEAVY: {
    description: 'Science/vocational-heavy schools — lab-split avoidance dominates every other signal.',
    weightOverrides: {
      LAB_SPLIT: 4, FORCED_SAME_DAY_REPEAT: 0.7, TEACHER_DAILY_OVERLOAD: 1, TEACHER_WEEKLY_OVERLOAD: 1,
      WORKLOAD_VARIANCE: 0.8, TEACHER_GAPS: 0.5, UNPREFERRED_SLOT: 0.7, ADJACENT_SAME_SUBJECT: 0.5,
    },
  },
}
export const PROFILE_NAMES = Object.keys(PROFILE_DEFS)

export const serializeProfile = (p: { id: string; name: string; description: string | null; weightOverrides: unknown; active: boolean }) => ({
  id: p.id, name: p.name, description: p.description ?? undefined, weightOverrides: p.weightOverrides, active: p.active,
})

export function list(ctx: Ctx) {
  return prisma.preferenceProfile.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { name: 'asc' } })
}

// Idempotent — safe to call more than once (mirrors constraints.ts#seedDefaults).
export async function seedDefaults(ctx: Ctx) {
  const existing = new Set((await prisma.preferenceProfile.findMany({ where: { schoolId: ctx.schoolId } })).map(p => p.name))
  let added = 0
  for (const [name, def] of Object.entries(PROFILE_DEFS)) {
    if (existing.has(name)) continue
    await prisma.preferenceProfile.create({
      data: { schoolId: ctx.schoolId, name, description: def.description, weightOverrides: def.weightOverrides, active: name === 'DEFAULT' },
    })
    added++
  }
  return added
}

export async function activate(ctx: Ctx, name: string) {
  const row = await prisma.preferenceProfile.findUnique({ where: { schoolId_name: { schoolId: ctx.schoolId, name } } })
  if (!row) throw notFound('Preference profile — run POST /preference-profiles/seed-defaults first')
  await prisma.$transaction([
    prisma.preferenceProfile.updateMany({ where: { schoolId: ctx.schoolId, active: true }, data: { active: false } }),
    prisma.preferenceProfile.update({ where: { id: row.id }, data: { active: true } }),
  ])
  const after = await prisma.preferenceProfile.findUnique({ where: { id: row.id } })
  await audit(ctx.schoolId, ctx.actorId, 'activate', 'preferenceProfile', row.id, { active: row.active }, { active: true })
  return after!
}

export async function update(ctx: Ctx, name: string, input: z.infer<typeof patchPreferenceProfile>) {
  const before = await prisma.preferenceProfile.findUnique({ where: { schoolId_name: { schoolId: ctx.schoolId, name } } })
  if (!before) throw notFound('Preference profile')
  if (!input.weightOverrides) throw new HttpError(400, 'weightOverrides is required')
  const row = await prisma.preferenceProfile.update({ where: { id: before.id }, data: { weightOverrides: { ...(before.weightOverrides as object), ...input.weightOverrides } } })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'preferenceProfile', row.id, { weightOverrides: before.weightOverrides }, { weightOverrides: row.weightOverrides })
  return row
}
