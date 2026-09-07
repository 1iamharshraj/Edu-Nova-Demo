import { z } from 'zod'

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
