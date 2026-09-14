import { useMemo } from 'react'
import { useStore } from '../store'
import { qs, useFetchMany, useList, useOne } from './useAcademics'
import type {
  FeeDefaulter, FeeHead, FeeInstallmentPlan, FeeInvoice, FeeStructure, FeeSummary, InvoiceStatus, Payment, PaymentMethod, Payslip,
  SalaryComponent, SalaryStructure, User,
} from '../data'

// Data hooks and pure helpers for fees, payments and payroll.
// Components live in src/portal/modules/{finance,paymentGateway,feeDefaulters,actions}.tsx.
// See .agents/edunova/phase-5-finance.md

/* ── constants ─────────────────────────────────────────── */

export const PAYMENT_METHODS: PaymentMethod[] = ['Cash', 'Cheque', 'UPI', 'Card', 'NetBanking']
/** Methods a parent/student may use through the gateway flow (`POST /fees/gateway/order`). */
export const GATEWAY_METHODS: PaymentMethod[] = ['UPI', 'Card', 'NetBanking']
export const INVOICE_STATUSES: InvoiceStatus[] = ['Due', 'PartiallyPaid', 'Paid', 'Waived']
export const METHOD_LABEL: Record<PaymentMethod, string> = { Cash: 'Cash', Cheque: 'Cheque', UPI: 'UPI', Card: 'Card', NetBanking: 'Net Banking' }
export const STATUS_TEXT: Record<InvoiceStatus, string> = { Due: 'Due', PartiallyPaid: 'Partially paid', Paid: 'Paid', Waived: 'Waived' }

export const invoiceTone = (s: InvoiceStatus): 'green' | 'amber' | 'rose' | 'slate' =>
  s === 'Paid' ? 'green' : s === 'PartiallyPaid' ? 'amber' : s === 'Due' ? 'rose' : 'slate'

/* ── invoice arithmetic ────────────────────────────────── */

/** Amount received so far — from the server's `paid` decoration, else its attached payments, else the status. */
export function paidOf(inv: FeeInvoice, payments?: Payment[]) {
  if (typeof inv.paid === 'number') return inv.paid
  const list = inv.payments ?? payments?.filter(p => p.invoiceId === inv.id)
  if (list) return list.reduce((a, p) => a + p.amount, 0)
  return inv.status === 'Paid' ? Math.max(0, inv.total - (inv.concession ?? 0)) : 0
}
export const payableOf = (inv: FeeInvoice) => Math.max(0, inv.total - (inv.concession ?? 0))
export function outstandingOf(inv: FeeInvoice, payments?: Payment[]) {
  if (inv.status === 'Waived' || inv.status === 'Paid') return 0
  return Math.max(0, payableOf(inv) - paidOf(inv, payments))
}
export const isOutstanding = (inv: FeeInvoice) => inv.status === 'Due' || inv.status === 'PartiallyPaid'
export const linesTotal = (lines: { amount: number }[]) => lines.reduce((a, l) => a + (Number(l.amount) || 0), 0)
/** One-line description of an invoice: "Tuition + Transport" (or the invoice number when it has no lines). */
export const invoiceLabel = (inv: FeeInvoice) => inv.lines?.length ? inv.lines.map(l => l.name).join(' + ') : inv.invoiceNo

/* ── fees ──────────────────────────────────────────────── */

export function useFeeHeads(enabled = true) {
  return useList<FeeHead>(enabled ? '/fees/heads' : null)
}

export function useFeeStructures(params: { classId?: string; termId?: string } = {}, enabled = true) {
  return useList<FeeStructure>(enabled ? `/fees/structures${qs(params)}` : null)
}

/** Invoices the caller may see (students/parents: own/wards only). Pass `enabled=false` to skip the request. */
export function useInvoices(params: { studentId?: string; termId?: string; status?: string; classId?: string } = {}, enabled = true) {
  return useList<FeeInvoice>(enabled ? `/fees/invoices${qs(params)}` : null)
}

export function usePayments(params: { invoiceId?: string; studentId?: string; from?: string; to?: string } = {}, enabled = true) {
  return useList<Payment>(enabled ? `/fees/payments${qs(params)}` : null)
}

export function useDefaulters(params: { termId?: string; classId?: string } = {}, enabled = true) {
  return useList<FeeDefaulter>(enabled ? `/fees/defaulters${qs(params)}` : null)
}

export function useFeeSummary(termId?: string, enabled = true) {
  return useOne<FeeSummary>(enabled ? `/fees/summary${qs({ termId })}` : null)
}

/* ── Phase 21 item 5: fee installment plans ───────────────
 * `GET /fees/installment-plans?feeStructureId=` — every plan defined for a fee structure (an admin screen
 * lists these before letting a parent/admin pick one at generate-invoices time); a plan's `installments`
 * array is `{ label, percentage?, amount?, dueDateOffsetDays }[]` (see FeeInstallmentPlan in data.ts). */
export function useInstallmentPlans(feeStructureId?: string, enabled = true) {
  return useList<FeeInstallmentPlan>(enabled ? `/fees/installment-plans${qs({ feeStructureId })}` : null)
}

/* ── payroll ───────────────────────────────────────────── */

export const sumComponents = (x: SalaryComponent[] | number | undefined) => (typeof x === 'number' ? x : (x ?? []).reduce((a, c) => a + (Number(c.amount) || 0), 0))
export const netOf = (s: { basic: number; allowances: SalaryComponent[] | number; deductions: SalaryComponent[] | number }) =>
  (Number(s.basic) || 0) + sumComponents(s.allowances) - sumComponents(s.deductions)

/** Parses a form-input string into a non-negative number (falls back to 0). Used by every rupee-amount
 * input across finance.tsx and the routed `/portal/finance/fee-structures/:classId/:termId` page. */
export const num = (v: string) => Math.max(0, Number(v) || 0)

/** `YYYY-MM` for a date (default: today). */
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
export const fmtMonth = (m?: string) => (m && /^\d{4}-\d{2}$/.test(m) ? new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : m ?? '—')

/** Everyone payroll covers: teachers, staff and admins, sorted by role then name. */
export function useEmployees(): User[] {
  const { db } = useStore()
  return useMemo(() => db.users.filter(u => u.role === 'teacher' || u.role === 'staff' || u.role === 'admin' || u.role === 'superadmin').sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)), [db.users])
}

/** One `GET /payroll/structures/:userId` per employee (the contract has no list endpoint); missing → undefined. */
export function useSalaryStructures(userIds: string[]) {
  const paths = useMemo(() => userIds.map(id => `/payroll/structures/${encodeURIComponent(id)}`), [userIds])
  const r = useFetchMany<SalaryStructure>(paths)
  const byUser = useMemo(() => {
    const m = new Map<string, SalaryStructure>()
    r.data?.forEach((s, i) => { if (s && typeof s === 'object' && 'basic' in s) m.set(userIds[i], s) })
    return m
  }, [r.data, userIds])
  return { byUser, loading: r.loading }
}

export function usePayslips(params: { userId?: string; month?: string } = {}, enabled = true) {
  return useList<Payslip>(enabled ? `/payroll/payslips${qs(params)}` : null)
}
