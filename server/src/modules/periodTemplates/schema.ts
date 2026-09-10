import { z } from 'zod'
import { idStr } from '../../lib/validate'

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM')

export const periodDef = z.object({
  idx: z.number().int().min(0),
  label: z.string().min(1),
  start: hhmm,
  end: hhmm,
  kind: z.enum(['class', 'break']),
})

const periods = z.array(periodDef).min(1).refine(ps => new Set(ps.map(p => p.idx)).size === ps.length, 'Period idx values must be unique')

export const createPeriodTemplate = z.object({
  name: z.string().min(1),
  periods,
  isDefault: z.boolean().optional(),
})

export const patchPeriodTemplate = createPeriodTemplate.partial()

// Phase T1 §5 (roadmap D7) — day-of-week override rows. See schema.prisma's PeriodTemplate comment for the
// base-template / override-row model this maps onto. `baseTemplateId` must reference an existing BASE
// template (dayOfWeek null) in the same school; overrides are never marked default.
export const createPeriodTemplateOverride = z.object({
  baseTemplateId: idStr,
  dayOfWeek: z.number().int().min(1).max(6),
  name: z.string().min(1),
  periods,
})

export const patchPeriodTemplateOverride = z.object({ name: z.string().min(1).optional(), periods: periods.optional() })

