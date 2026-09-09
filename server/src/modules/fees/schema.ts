import { z } from 'zod'
import { dateStr, idStr } from '../../lib/validate'
import { paginationQuery } from '../../lib/pagination'

export const PAYMENT_METHODS = ['UPI', 'Card', 'NetBanking', 'Cash', 'Cheque'] as const
export const GATEWAY_METHODS = ['UPI', 'Card', 'NetBanking'] as const
export const INVOICE_STATUSES = ['Due', 'PartiallyPaid', 'Paid', 'Waived'] as const
export const REMINDER_CHANNELS = ['InApp', 'Email', 'SMS'] as const

export const createFeeHead = z.object({
  name: z.string().trim().min(1).max(80),
  isRecurring: z.boolean().optional(),
})
export const patchFeeHead = createFeeHead.partial()

const structureLine = z.object({ feeHeadId: idStr, amount: z.number().nonnegative() })

export const createFeeStructure = z.object({
  classId: idStr,
  termId: idStr,
  dueDate: dateStr,
  lines: z.array(structureLine).min(1),
})
export const patchFeeStructure = createFeeStructure.omit({ classId: true, termId: true }).partial()

export const structuresQuery = z.object({ classId: idStr.optional(), termId: idStr.optional() })

export const generateInvoicesBody = z.object({ installmentPlanId: idStr.optional() })

// ── Phase 21 item 5: fee installment plans ──
// Exactly one of percentage/amount per installment; dueDateOffsetDays is added to the parent
// FeeStructure's dueDate to get that installment's own due date (0 = same day as the structure's due date).
const installmentSpec = z.object({
  label: z.string().trim().min(1).max(40),
  percentage: z.number().positive().max(100).optional(),
  amount: z.number().positive().optional(),
  dueDateOffsetDays: z.number().int().min(0).max(3650).default(0),
}).refine(s => (s.percentage !== undefined) !== (s.amount !== undefined), 'Exactly one of percentage or amount must be given per installment')

export const createInstallmentPlan = z.object({
  feeStructureId: idStr,
  name: z.string().trim().min(1).max(80),
  installments: z.array(installmentSpec).min(2).max(12),
}).refine(p => {
  const labels = p.installments.map(i => i.label)
  return new Set(labels).size === labels.length
}, 'Installment labels must be unique within a plan').refine(p => {
  const usingPercentage = p.installments.every(i => i.percentage !== undefined)
  const usingAmount = p.installments.every(i => i.amount !== undefined)
  if (!usingPercentage && !usingAmount) return false // no mixing percentage/amount across installments in one plan
  if (usingPercentage) {
    const sum = p.installments.reduce((a, i) => a + (i.percentage ?? 0), 0)
    return Math.abs(sum - 100) < 0.01
  }
  return true
}, 'All installments must use the same mode (all percentage, summing to 100, or all fixed amount)')

export const installmentPlanQuery = z.object({ feeStructureId: idStr.optional() })

const invoiceLine = z.object({ feeHeadId: idStr, name: z.string().trim().min(1).max(80), amount: z.number().nonnegative() })

export const createInvoice = z.object({
  studentId: idStr,
  termId: idStr,
  lines: z.array(invoiceLine).min(1),
  dueDate: dateStr,
})

export const patchInvoice = z.object({
  concession: z.number().nonnegative().optional(),
  dueDate: dateStr.optional(),
  status: z.literal('Waived').optional(),
})

export const invoicesQuery = paginationQuery.extend({
  studentId: idStr.optional(),
  termId: idStr.optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  classId: idStr.optional(),
})

export const createPayment = z.object({
  invoiceId: idStr,
  amount: z.number().positive(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
})

export const paymentsQuery = z.object({
  invoiceId: idStr.optional(),
  studentId: idStr.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
})

export const gatewayOrder = z.object({ invoiceId: idStr, amount: z.number().positive() })
export const gatewayConfirm = z.object({
  orderId: z.string().min(1),
  invoiceId: idStr,
  amount: z.number().positive(),
  method: z.enum(GATEWAY_METHODS),
  paymentId: z.string().optional(),
  signature: z.string().optional(),
})

export const defaultersQuery = z.object({ termId: idStr.optional(), classId: idStr.optional() })

export const createReminder = z.object({
  invoiceId: idStr,
  channel: z.enum(REMINDER_CHANNELS),
  note: z.string().trim().max(500).optional(),
})

export const summaryQuery = z.object({ termId: idStr.optional() })
