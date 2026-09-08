import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'

const lineItem = z.object({ name: z.string().trim().min(1).max(60), amount: z.number() })

export const upsertSalaryStructure = z.object({
  basic: z.number().nonnegative(),
  allowances: z.array(lineItem).default([]),
  deductions: z.array(lineItem).default([]),
  effectiveFrom: dateStr,
})

export const runBody = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM') })

export const payslipsQuery = z.object({ userId: idStr.optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() })
