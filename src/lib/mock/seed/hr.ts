// HR/payroll/leave/accounting seed fragment. Extends the employees seedCore() already created
// (u-sa, u-ad, u-t..u-t6, u-st) with contracts, a resignation, duties, leave types/requests, salary
// structures, payslips, and a starter chart of accounts + journal entries — the same shape
// server/src/modules/{hr,payroll,leave,accounting}/service.ts produce, adapted to static rows.
// Registers itself via `addSeedFragment` (see seed/index.ts) — src/lib/mock/index.ts imports this
// file once for that side effect.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'
import { addSeedFragment } from './index'

type LineItem = { name: string; amount: number }

function seedHr(db: Collections) {
  // ═══════════════════════════ contracts ═══════════════════════════
  const contractTerms =
    'Standard EduNova Public School teaching/administrative staff contract. Working hours 8:00 AM – 4:00 PM, ' +
    'Monday–Saturday (alternate Saturdays off). 30 days paid leave per academic year per the school leave policy. ' +
    'One month written notice (or pay in lieu) required for resignation. Subject to annual performance review.'

  db.Contract = [
    { id: 'contract-sa', schoolId: SCHOOL_ID, userId: 'u-sa', designation: 'Principal', department: 'Administration', startDate: '2018-04-01', endDate: undefined, terms: contractTerms, status: 'Active', employeeSignedAt: '2018-03-20T09:00:00.000Z', adminSignedAt: '2018-03-21T11:00:00.000Z', adminSignedById: 'u-sa', endedAt: undefined, endReason: undefined, pdfFileId: undefined, createdAt: '2018-03-15T00:00:00.000Z' },
    { id: 'contract-ad', schoolId: SCHOOL_ID, userId: 'u-ad', designation: 'Vice Principal', department: 'Administration', startDate: '2019-06-01', endDate: undefined, terms: contractTerms, status: 'Active', employeeSignedAt: '2019-05-18T09:00:00.000Z', adminSignedAt: '2019-05-19T10:30:00.000Z', adminSignedById: 'u-sa', endedAt: undefined, endReason: undefined, pdfFileId: undefined, createdAt: '2019-05-10T00:00:00.000Z' },
    { id: 'contract-t', schoolId: SCHOOL_ID, userId: 'u-t', designation: 'PGT Mathematics', department: 'Mathematics', startDate: '2021-06-01', endDate: undefined, terms: contractTerms, status: 'Active', employeeSignedAt: '2021-05-20T09:00:00.000Z', adminSignedAt: '2021-05-21T09:30:00.000Z', adminSignedById: 'u-ad', endedAt: undefined, endReason: undefined, pdfFileId: undefined, createdAt: '2021-05-12T00:00:00.000Z' },
    { id: 'contract-t2', schoolId: SCHOOL_ID, userId: 'u-t2', designation: 'PGT English', department: 'English', startDate: '2020-06-01', endDate: undefined, terms: contractTerms, status: 'Active', employeeSignedAt: '2020-05-20T09:00:00.000Z', adminSignedAt: '2020-05-22T09:30:00.000Z', adminSignedById: 'u-ad', endedAt: undefined, endReason: undefined, pdfFileId: undefined, createdAt: '2020-05-10T00:00:00.000Z' },
    { id: 'contract-t3', schoolId: SCHOOL_ID, userId: 'u-t3', designation: 'PGT Science', department: 'Science', startDate: '2021-06-01', endDate: undefined, terms: contractTerms, status: 'Active', employeeSignedAt: '2021-05-22T09:00:00.000Z', adminSignedAt: '2021-05-23T09:30:00.000Z', adminSignedById: 'u-ad', endedAt: undefined, endReason: undefined, pdfFileId: undefined, createdAt: '2021-05-14T00:00:00.000Z' },
    { id: 'contract-t4', schoolId: SCHOOL_ID, userId: 'u-t4', designation: 'PGT Physics', department: 'Science', startDate: '2020-06-01', endDate: undefined, terms: contractTerms, status: 'Active', employeeSignedAt: '2020-05-25T09:00:00.000Z', adminSignedAt: '2020-05-26T09:30:00.000Z', adminSignedById: 'u-ad', endedAt: undefined, endReason: undefined, pdfFileId: undefined, createdAt: '2020-05-15T00:00:00.000Z' },
    { id: 'contract-t5', schoolId: SCHOOL_ID, userId: 'u-t5', designation: 'PGT Chemistry', department: 'Science', startDate: '2022-06-01', endDate: undefined, terms: contractTerms, status: 'Active', employeeSignedAt: '2022-05-20T09:00:00.000Z', adminSignedAt: '2022-05-21T09:30:00.000Z', adminSignedById: 'u-ad', endedAt: undefined, endReason: undefined, pdfFileId: undefined, createdAt: '2022-05-12T00:00:00.000Z' },
    // Vikram Rao (u-t6) — Draft renewal contract awaiting signatures, so the sign flow has something to demo.
    { id: 'contract-t6', schoolId: SCHOOL_ID, userId: 'u-t6', designation: 'PGT Computer Science', department: 'Computer Science', startDate: '2026-06-01', endDate: undefined, terms: contractTerms, status: 'Draft', employeeSignedAt: undefined, adminSignedAt: undefined, adminSignedById: undefined, endedAt: undefined, endReason: undefined, pdfFileId: undefined, createdAt: '2026-08-20T00:00:00.000Z' },
    { id: 'contract-st', schoolId: SCHOOL_ID, userId: 'u-st', designation: 'Office Executive', department: 'Administration', startDate: '2023-01-01', endDate: undefined, terms: contractTerms, status: 'Active', employeeSignedAt: '2022-12-20T09:00:00.000Z', adminSignedAt: '2022-12-21T09:30:00.000Z', adminSignedById: 'u-ad', endedAt: undefined, endReason: undefined, pdfFileId: undefined, createdAt: '2022-12-15T00:00:00.000Z' },
  ].map(r => r as unknown as Row)

  // ═══════════════════════════ resignations ═══════════════════════════
  db.Resignation = [
    { id: 'resignation-1', schoolId: SCHOOL_ID, userId: 'u-t6', reason: 'Relocating to another city for family reasons.', submittedAt: '2026-08-25T10:00:00.000Z', lastWorkingDate: '2026-11-30', status: 'Pending', decidedById: undefined, decidedAt: undefined, notes: undefined },
  ].map(r => r as unknown as Row)

  // ═══════════════════════════ duties ═══════════════════════════
  db.Duty = [
    { id: 'duty-1', schoolId: SCHOOL_ID, title: 'Exam invigilation', eventTitle: 'Term 3 Mid-Term Examinations', eventDate: '2026-09-22', assigneeId: 'u-t', createdById: 'u-ad', status: 'Assigned', notes: 'Report to Room A-201 by 9:00 AM.', createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'duty-2', schoolId: SCHOOL_ID, title: 'Exam invigilation', eventTitle: 'Term 3 Mid-Term Examinations', eventDate: '2026-09-22', assigneeId: 'u-t4', createdById: 'u-ad', status: 'Assigned', notes: 'Report to Room A-202 by 9:00 AM.', createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'duty-3', schoolId: SCHOOL_ID, title: 'Annual Day coordination', eventTitle: 'Annual Day Celebrations', eventDate: '2026-10-15', assigneeId: 'u-t2', createdById: 'u-sa', status: 'Assigned', notes: 'Coordinate stage program and student rehearsals.', createdAt: '2026-08-15T00:00:00.000Z' },
    { id: 'duty-4', schoolId: SCHOOL_ID, title: 'Sports Day supervision', eventTitle: 'Annual Sports Meet', eventDate: '2026-08-10', assigneeId: 'u-t5', createdById: 'u-ad', status: 'Done', notes: 'Track events supervision.', createdAt: '2026-07-20T00:00:00.000Z' },
    { id: 'duty-5', schoolId: SCHOOL_ID, title: 'PTM front desk', eventTitle: 'Parent-Teacher Meeting — Term 3', eventDate: '2026-09-05', assigneeId: 'u-st', createdById: 'u-ad', status: 'Done', notes: undefined, createdAt: '2026-08-28T00:00:00.000Z' },
  ].map(r => r as unknown as Row)

  // ═══════════════════════════ leave types ═══════════════════════════
  db.LeaveType = [
    { id: 'leave-type-cl', schoolId: SCHOOL_ID, name: 'Casual Leave', daysPerYear: 12, appliesTo: 'staff', createdAt: '2025-04-01T00:00:00.000Z' },
    { id: 'leave-type-sl', schoolId: SCHOOL_ID, name: 'Sick Leave', daysPerYear: 10, appliesTo: 'staff', createdAt: '2025-04-01T00:00:00.000Z' },
    { id: 'leave-type-el', schoolId: SCHOOL_ID, name: 'Earned Leave', daysPerYear: 15, appliesTo: 'staff', createdAt: '2025-04-01T00:00:00.000Z' },
    { id: 'leave-type-student-sick', schoolId: SCHOOL_ID, name: 'Sick Leave', daysPerYear: 10, appliesTo: 'student', createdAt: '2025-04-01T00:00:00.000Z' },
    { id: 'leave-type-student-emergency', schoolId: SCHOOL_ID, name: 'Emergency/Family Leave', daysPerYear: 5, appliesTo: 'student', createdAt: '2025-04-01T00:00:00.000Z' },
  ].map(r => r as unknown as Row)

  // ═══════════════════════════ leave requests ═══════════════════════════
  db.LeaveRequest = [
    // Staff — pending, awaiting admin decision.
    { id: 'leave-req-1', schoolId: SCHOOL_ID, requesterId: 'u-t3', forUserId: 'u-t3', leaveTypeId: 'leave-type-sl', fromDate: '2026-09-18', toDate: '2026-09-19', days: 2, reason: 'Fever and viral infection.', status: 'Pending', decidedById: undefined, decidedAt: undefined, decisionNote: undefined, createdAt: '2026-09-14T08:00:00.000Z' },
    // Staff — approved earlier this term.
    { id: 'leave-req-2', schoolId: SCHOOL_ID, requesterId: 'u-t2', forUserId: 'u-t2', leaveTypeId: 'leave-type-cl', fromDate: '2026-08-03', toDate: '2026-08-04', days: 2, reason: 'Family function.', status: 'Approved', decidedById: 'u-ad', decidedAt: '2026-07-30T12:00:00.000Z', decisionNote: 'Approved.', createdAt: '2026-07-28T09:00:00.000Z' },
    // Staff — declined.
    { id: 'leave-req-3', schoolId: SCHOOL_ID, requesterId: 'u-st', forUserId: 'u-st', leaveTypeId: 'leave-type-el', fromDate: '2026-09-22', toDate: '2026-09-26', days: 4, reason: 'Personal travel during exam week.', status: 'Declined', decidedById: 'u-ad', decidedAt: '2026-09-10T10:00:00.000Z', decisionNote: 'Cannot spare front-office coverage during exam week — please reapply for a later date.', createdAt: '2026-09-08T09:00:00.000Z' },
    // Student — parent-filed, pending (class teacher decides).
    { id: 'leave-req-4', schoolId: SCHOOL_ID, requesterId: 'u-p', forUserId: 'u-s1', leaveTypeId: 'leave-type-student-sick', fromDate: '2026-09-16', toDate: '2026-09-17', days: 2, reason: 'Down with fever, doctor advised rest.', status: 'Pending', decidedById: undefined, decidedAt: undefined, decisionNote: undefined, createdAt: '2026-09-14T07:30:00.000Z' },
    // Student — self-filed, approved.
    { id: 'leave-req-5', schoolId: SCHOOL_ID, requesterId: 'u-s3', forUserId: 'u-s3', leaveTypeId: 'leave-type-student-emergency', fromDate: '2026-08-18', toDate: '2026-08-18', days: 1, reason: 'Family wedding.', status: 'Approved', decidedById: 'u-t3', decidedAt: '2026-08-15T11:00:00.000Z', decisionNote: undefined, createdAt: '2026-08-14T10:00:00.000Z' },
    // Student — cancelled by the requester.
    { id: 'leave-req-6', schoolId: SCHOOL_ID, requesterId: 'u-s4', forUserId: 'u-s4', leaveTypeId: 'leave-type-student-sick', fromDate: '2026-09-01', toDate: '2026-09-02', days: 2, reason: 'Stomach infection.', status: 'Cancelled', decidedById: undefined, decidedAt: undefined, decisionNote: undefined, createdAt: '2026-08-30T09:00:00.000Z' },
  ].map(r => r as unknown as Row)

  // ═══════════════════════════ salary structures ═══════════════════════════
  const allow = (hra: number, da: number, transport: number): LineItem[] => [
    { name: 'House Rent Allowance', amount: hra },
    { name: 'Dearness Allowance', amount: da },
    { name: 'Transport Allowance', amount: transport },
  ]
  const ded = (pf: number, profTax = 200): LineItem[] => [
    { name: 'Provident Fund', amount: pf },
    { name: 'Professional Tax', amount: profTax },
  ]

  const structureDefs: Array<{ userId: string; basic: number; hra: number; da: number; transport: number; pf: number }> = [
    { userId: 'u-sa', basic: 95000, hra: 28500, da: 9500, transport: 3000, pf: 11400 },
    { userId: 'u-ad', basic: 78000, hra: 23400, da: 7800, transport: 3000, pf: 9360 },
    { userId: 'u-t', basic: 52000, hra: 15600, da: 5200, transport: 2000, pf: 6240 },
    { userId: 'u-t2', basic: 50000, hra: 15000, da: 5000, transport: 2000, pf: 6000 },
    { userId: 'u-t3', basic: 51000, hra: 15300, da: 5100, transport: 2000, pf: 6120 },
    { userId: 'u-t4', basic: 49000, hra: 14700, da: 4900, transport: 2000, pf: 5880 },
    { userId: 'u-t5', basic: 46000, hra: 13800, da: 4600, transport: 1800, pf: 5520 },
    { userId: 'u-t6', basic: 47000, hra: 14100, da: 4700, transport: 1800, pf: 5640 },
    { userId: 'u-st', basic: 26000, hra: 7800, da: 2600, transport: 1500, pf: 3120 },
  ]

  db.SalaryStructure = structureDefs.map(s => ({
    id: `salstruct-${s.userId}`, schoolId: SCHOOL_ID, userId: s.userId, basic: s.basic,
    allowances: allow(s.hra, s.da, s.transport), deductions: ded(s.pf),
    effectiveFrom: '2026-04-01', createdAt: '2026-04-01T00:00:00.000Z',
  } as Row))

  // ═══════════════════════════ payslips ═══════════════════════════
  // Two already-paid months (two months back, one month back) plus the current month still awaiting a
  // payroll run/payment — gives the Payroll screen both a history and something actionable to demo.
  // Computed relative to the real "now" (rather than a hardcoded month) so the Payroll screen — whose
  // default month filter is today's month — always has a "Generated" payslip to show without a manual run.
  const shiftMonth = (delta: number) => {
    const d = new Date()
    d.setDate(1) // avoid month-length overflow when shifting
    d.setMonth(d.getMonth() + delta)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  const payslipMonths: Array<{ month: string; status: 'Paid' | 'Generated'; paidAt?: string }> = [
    { month: shiftMonth(-2), status: 'Paid', paidAt: `${shiftMonth(-2)}-05T10:00:00.000Z` },
    { month: shiftMonth(-1), status: 'Paid', paidAt: `${shiftMonth(-1)}-05T10:00:00.000Z` },
    { month: shiftMonth(0), status: 'Generated' },
  ]
  let slipSeq = 0
  db.Payslip = payslipMonths.flatMap(({ month, status, paidAt }) =>
    structureDefs.map(s => {
      slipSeq += 1
      const allowances = allow(s.hra, s.da, s.transport)
      const deductions = ded(s.pf)
      const gross = s.basic + allowances.reduce((a, i) => a + i.amount, 0)
      const net = gross - deductions.reduce((a, i) => a + i.amount, 0)
      return {
        id: `payslip-${s.userId}-${month}`, schoolId: SCHOOL_ID, userId: s.userId, month, basic: s.basic,
        allowances, deductions, gross, net, status,
        paidAt: status === 'Paid' ? paidAt : undefined, paidById: status === 'Paid' ? 'u-ad' : undefined,
        slipNo: `PAY/${month.slice(0, 4)}/${String(slipSeq).padStart(4, '0')}`, createdAt: `${month}-05T00:00:00.000Z`,
      } as Row
    }),
  )

  // ═══════════════════════════ chart of accounts ═══════════════════════════
  // Mirrors server/src/modules/accounting/service.ts's DEFAULT_CHART (phase-17-accounting.md), minus the
  // Phase 30 canteen-specific pair (2010/4020) — canteen isn't part of this batch; a later canteen batch
  // can add those two accounts to this same chart without conflict.
  const chart: Array<{ code: string; name: string; type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense'; parentCode?: string; isSystem: boolean }> = [
    { code: '1000', name: 'Current Assets', type: 'Asset', isSystem: false },
    { code: '1001', name: 'Cash', type: 'Asset', parentCode: '1000', isSystem: false },
    { code: '1002', name: 'Bank', type: 'Asset', parentCode: '1000', isSystem: true },
    { code: '2000', name: 'Accounts Payable', type: 'Liability', isSystem: false },
    { code: '3000', name: 'Opening Balance', type: 'Equity', isSystem: false },
    { code: '4000', name: 'Fee Income', type: 'Income', isSystem: true },
    { code: '4010', name: 'Donation Income', type: 'Income', isSystem: false },
    { code: '5000', name: 'Salary Expense', type: 'Expense', isSystem: true },
    { code: '5010', name: 'Utilities Expense', type: 'Expense', isSystem: false },
    { code: '5020', name: 'Maintenance Expense', type: 'Expense', isSystem: false },
    { code: '5090', name: 'Other Expense', type: 'Expense', isSystem: false },
  ]
  const idByCode = new Map<string, string>()
  db.Account = chart.map(a => {
    const id = `account-${a.code}`
    idByCode.set(a.code, id)
    return {
      id, schoolId: SCHOOL_ID, code: a.code, name: a.name, type: a.type,
      parentId: a.parentCode ? idByCode.get(a.parentCode) : null, isSystem: a.isSystem, active: true,
      createdAt: '2025-04-01T00:00:00.000Z', updatedAt: '2025-04-01T00:00:00.000Z',
    } as Row
  })
  const acct = (code: string) => idByCode.get(code)!

  // ═══════════════════════════ journal entries ═══════════════════════════
  type JE = { id: string; date: string; memo: string; reference?: string; sourceType: string; sourceId?: string; createdById: string; lines: { accountId: string; debit: number; credit: number }[] }
  const paidPayslips = (db.Payslip as Row[]).filter(p => p.status === 'Paid')
  const entries: JE[] = [
    // Opening balance — gives the Bank account a real balance so reports/cash-flow have something to show.
    {
      id: 'journal-opening', date: '2025-04-01', memo: 'Opening balance — new financial year', reference: 'OPEN-2025-26',
      sourceType: 'Manual', createdById: 'u-ad',
      lines: [{ accountId: acct('1002'), debit: 1_500_000, credit: 0 }, { accountId: acct('3000'), debit: 0, credit: 1_500_000 }],
    },
    // One manual expense entry for realism (utilities).
    {
      id: 'journal-utility-1', date: '2026-08-28', memo: 'Electricity bill — August 2026', reference: 'INV-UTIL-0826',
      sourceType: 'Manual', createdById: 'u-ad',
      lines: [{ accountId: acct('5010'), debit: 42_500, credit: 0 }, { accountId: acct('1002'), debit: 0, credit: 42_500 }],
    },
    // Auto-posted payroll entries — one per already-Paid payslip, mirroring
    // accounting/service.ts#postPayrollAutoEntry (Debit Salary Expense, Credit Bank, net pay).
    ...paidPayslips.map((slip, i) => ({
      id: `journal-payroll-${i + 1}`, date: String(slip.paidAt).slice(0, 10), memo: 'Payroll paid', reference: String(slip.id),
      sourceType: 'Payroll', sourceId: String(slip.id), createdById: String(slip.paidById ?? 'u-ad'),
      lines: [{ accountId: acct('5000'), debit: Number(slip.net), credit: 0 }, { accountId: acct('1002'), debit: 0, credit: Number(slip.net) }],
    })),
  ]

  db.JournalEntry = entries.map(e => ({
    id: e.id, schoolId: SCHOOL_ID, date: e.date, memo: e.memo, reference: e.reference ?? null,
    sourceType: e.sourceType, sourceId: e.sourceId ?? null, createdById: e.createdById,
    createdAt: `${e.date}T12:00:00.000Z`, postedAt: `${e.date}T12:00:00.000Z`,
  } as Row))

  db.JournalLine = entries.flatMap(e => e.lines.map((l, i) => ({
    id: `${e.id}-line-${i + 1}`, entryId: e.id, accountId: l.accountId, debit: l.debit, credit: l.credit,
  } as Row)))
}

addSeedFragment(seedHr)
