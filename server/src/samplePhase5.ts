import type { Prisma } from '@prisma/client'
import { toDate } from './lib/validate'

// Phase 5 demo data (fees, payments, payroll). Runs inside the same transaction as loadSampleData, after
// the roster (Enrollment) and terms already exist. See phase-5-finance.md → Sample data.

type Tx = Prisma.TransactionClient

export interface Phase5Args {
  schoolId: string
  terms: { id: string }[]
  termDates: Record<string, [string, string]>
  classIds: Map<string, string> // label → Class.id
  userId: (seedId: string) => string
}

const FEE_HEADS = [
  { key: 'tuition', name: 'Tuition', amount: 42500 },
  { key: 'transport', name: 'Transport', amount: 9000 },
  { key: 'lab', name: 'Lab & Activity', amount: 6500 },
] as const

const FEE_CLASSES = ['X-A', 'X-B']

// Payment behaviour per seeded student: exceptLab leaves the Lab & Activity line unpaid (a small, real
// defaulter row); none leaves the whole invoice untouched (a full defaulter); full pays every invoice off.
const PAY_PLAN: Record<string, 'full' | 'exceptLab' | 'none'> = {
  'u-s': 'exceptLab', // Aarav Sharma (X-A)
  'u-s2': 'exceptLab', // Diya Patel (X-A)
  'u-s3': 'none', // Kabir Singh (X-B) — full defaulter
  'u-s4': 'full', // Rohan Gupta (X-B) — paid up
}
const PAY_METHOD: Record<string, string> = { 'u-s': 'UPI', 'u-s2': 'Cash', 'u-s4': 'NetBanking' }

// Salaries ported from makeContract() in src/lib/data.ts — the eleven contract-holders.
const SALARIES: [seedId: string, basic: number][] = [
  ['u-t', 78400], ['u-t2', 72000], ['u-t3', 71000], ['u-t4', 68000], ['u-t5', 70000], ['u-t6', 65000],
  ['u-st', 58000], ['u-st2', 62000], ['u-st3', 55000], ['u-a', 95000], ['u-sa', 150000],
]
const PAYROLL_MONTHS = ['2026-01', '2026-02', '2026-03']

const DAY = 24 * 60 * 60 * 1000

export async function loadPhase5(tx: Tx, a: Phase5Args) {
  const { schoolId } = a
  const year = new Date().getUTCFullYear()
  let invoiceSeq = 0
  const invoiceNo = () => `INV/${year}/${String(++invoiceSeq).padStart(4, '0')}`
  let receiptSeq = 0
  const receiptNo = () => `RCPT/${year}/${String(++receiptSeq).padStart(4, '0')}`

  // Fee heads.
  const headIds = new Map<string, string>()
  for (const h of FEE_HEADS) headIds.set(h.key, (await tx.feeHead.create({ data: { schoolId, name: h.name, isRecurring: true } })).id)

  const structureLines = FEE_HEADS.map(h => ({ feeHeadId: headIds.get(h.key)!, amount: h.amount }))
  const invoiceLines = FEE_HEADS.map(h => ({ feeHeadId: headIds.get(h.key)!, name: h.name, amount: h.amount }))
  const total = FEE_HEADS.reduce((s, h) => s + h.amount, 0)
  const labAmount = FEE_HEADS.find(h => h.key === 'lab')!.amount

  const planByStudent = new Map<string, 'full' | 'exceptLab' | 'none'>()
  const methodByStudent = new Map<string, string>()
  for (const [seed, plan] of Object.entries(PAY_PLAN)) planByStudent.set(a.userId(seed), plan)
  for (const [seed, method] of Object.entries(PAY_METHOD)) methodByStudent.set(a.userId(seed), method)
  const staffId = a.userId('u-st')

  // Fee structures for X-A / X-B × t1–t3, invoices generated for every active student, payments per plan.
  for (const label of FEE_CLASSES) {
    const classId = a.classIds.get(label)!
    for (const t of a.terms) {
      const [start] = a.termDates[t.id]
      const dueDate = toDate(start)
      await tx.feeStructure.create({ data: { schoolId, classId, termId: t.id, dueDate, lines: structureLines } })
      const roster = await tx.enrollment.findMany({ where: { classId, status: 'active' }, select: { studentId: true } })
      const structure = await tx.feeStructure.findUniqueOrThrow({ where: { classId_termId: { classId, termId: t.id } } })

      for (const { studentId } of roster) {
        const plan = planByStudent.get(studentId) ?? 'full'
        const invoice = await tx.feeInvoice.create({
          data: {
            schoolId, studentId, feeStructureId: structure.id, termId: t.id, lines: invoiceLines, total,
            concession: 0, dueDate, status: plan === 'full' ? 'Paid' : plan === 'exceptLab' ? 'PartiallyPaid' : 'Due',
            invoiceNo: invoiceNo(),
          },
        })
        if (plan === 'none') continue
        const amount = plan === 'full' ? total : total - labAmount
        await tx.payment.create({
          data: {
            schoolId, invoiceId: invoice.id, amount, method: methodByStudent.get(studentId) ?? 'Cash',
            recordedById: staffId, paidAt: new Date(dueDate.getTime() + 3 * DAY), receiptNo: receiptNo(),
          },
        })
      }
    }
  }

  // Salary structures + Jan–Mar 2026 payslips (all Paid) for the eleven contract-holders.
  let slipSeq = 0
  const slipNo = () => `PAY/${year}/${String(++slipSeq).padStart(4, '0')}`
  const adminId = a.userId('u-a')
  for (const [seed, basic] of SALARIES) {
    const userId = a.userId(seed)
    const allowances = [{ name: 'HRA', amount: Math.round(basic * 0.2) }]
    const deductions = [{ name: 'PF', amount: Math.round(basic * 0.12) }]
    await tx.salaryStructure.create({ data: { schoolId, userId, basic, allowances, deductions, effectiveFrom: toDate('2024-06-01') } })
    const gross = basic + allowances.reduce((s, x) => s + x.amount, 0)
    const net = gross - deductions.reduce((s, x) => s + x.amount, 0)
    for (const month of PAYROLL_MONTHS) {
      const [y, m] = month.split('-').map(Number)
      const paidAt = new Date(Date.UTC(y, m, 0)) // last day of that month
      await tx.payslip.create({
        data: { schoolId, userId, month, basic, allowances, deductions, gross, net, status: 'Paid', paidAt, paidById: adminId, slipNo: slipNo() },
      })
    }
  }
}
