// Mirrors server/src/modules/accounting/{router,schema,service}.ts's contract for the endpoints the
// frontend's src/lib/hooks/useAccounting.ts + src/portal/modules/accounting.tsx +
// src/pages/portal/JournalEntryNew.tsx actually call. Every route here is admin/superadmin only, same
// as the real server (sensitive financial data). The chart of accounts + a few journal entries are
// pre-seeded (src/lib/mock/seed/hr.ts) rather than lazily created on first use — this is a single
// always-on demo school, so there's no "first touch" moment to hook a lazy seed into.
//
// program-profitability and concession-impact (Phase 21) genuinely need Fees/Scholarship data (FeeInvoice,
// ScholarshipAward) that belongs to a different batch (`fees`) not built yet. Both are implemented for
// real against whatever data does exist in this batch (GL, SalaryStructure/Payslip, Class/Board/Grade,
// ClassSubject) and simply read an empty FeeInvoice/ScholarshipAward table (table() lazily returns `[]`)
// — so they return a correctly-shaped, zero-income report rather than crashing, and the methodology
// string says so. See the report's own comment below.

import { route, requireRole } from '../router'
import { badRequest, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'

const WRITE_ROLES = ['admin', 'superadmin']

const round2 = (n: number) => Math.round(n * 100) / 100
const cents = (n: number) => Math.round(n * 100)

export const BANK_CODE = '1002'
export const FEE_INCOME_CODE = '4000'
export const SALARY_EXPENSE_CODE = '5000'

function systemAccount(schoolId: string, code: string): Row {
  const row = table('Account').find(a => a.schoolId === schoolId && a.code === code)
  if (!row) throw new Error(`System account with code ${code} is missing for school ${schoolId}`)
  return row
}

function accountsFor(schoolId: string) {
  return table('Account').filter(a => a.schoolId === schoolId)
}

function linesForEntry(entryId: string) {
  return table('JournalLine').filter(l => l.entryId === entryId)
}

function serializeAccount(a: Row) {
  return { id: a.id, code: a.code, name: a.name, type: a.type, parentId: a.parentId ?? undefined, isSystem: a.isSystem, active: a.active, createdAt: a.createdAt, updatedAt: a.updatedAt }
}

function serializeLine(l: Row) {
  return { id: l.id, accountId: l.accountId, debit: l.debit, credit: l.credit }
}

function serializeEntry(e: Row) {
  const lines = linesForEntry(String(e.id))
  return {
    id: e.id, date: e.date, memo: e.memo, reference: e.reference ?? undefined,
    sourceType: e.sourceType, sourceId: e.sourceId ?? undefined, createdById: e.createdById,
    createdAt: e.createdAt, postedAt: e.postedAt, lines: lines.map(serializeLine),
    totalDebit: round2(lines.reduce((s, l) => s + Number(l.debit), 0)),
    totalCredit: round2(lines.reduce((s, l) => s + Number(l.credit), 0)),
  }
}

// The single write path every posted entry (manual or auto) goes through — re-validates the balance
// (integer paise, never float) so an unbalanced entry can never be written, mirroring the real
// service.ts#writeBalancedEntry invariant.
export function writeBalancedEntry(schoolId: string, input: {
  date: string; memo: string; reference?: string | null; sourceType: string; sourceId?: string | null; createdById: string
  lines: { accountId: string; debit: number; credit: number }[]
}): Row {
  if (input.lines.length < 2) throw badRequest('A journal entry needs at least two lines')
  for (const l of input.lines) {
    if (l.debit < 0 || l.credit < 0) throw badRequest('debit/credit cannot be negative')
    if ((l.debit > 0) === (l.credit > 0)) throw badRequest('Each line must have exactly one of debit/credit non-zero')
  }
  const totalDebitCents = input.lines.reduce((s, l) => s + cents(l.debit), 0)
  const totalCreditCents = input.lines.reduce((s, l) => s + cents(l.credit), 0)
  if (totalDebitCents !== totalCreditCents) throw badRequest(`Journal entry is not balanced: debits ${(totalDebitCents / 100).toFixed(2)} ≠ credits ${(totalCreditCents / 100).toFixed(2)}`)
  if (totalDebitCents === 0) throw badRequest('A journal entry cannot have zero value')

  const accountIds = [...new Set(input.lines.map(l => l.accountId))]
  const accounts = accountsFor(schoolId).filter(a => accountIds.includes(String(a.id)))
  if (accounts.length !== accountIds.length) throw badRequest('One or more accountId are invalid for this school')
  const inactive = accounts.find(a => !a.active)
  if (inactive) throw badRequest(`Account "${inactive.name}" is inactive and cannot be posted to`)

  const entry: Row = {
    id: uid('journalEntry'), schoolId, date: input.date, memo: input.memo, reference: input.reference ?? null,
    sourceType: input.sourceType, sourceId: input.sourceId ?? null, createdById: input.createdById,
    createdAt: nowIso(), postedAt: nowIso(),
  }
  const entries = table('JournalEntry'); entries.push(entry); saveTable('JournalEntry', entries)
  const lineRows = table('JournalLine')
  input.lines.forEach((l, i) => lineRows.push({ id: `${entry.id}-line-${i + 1}`, entryId: entry.id, accountId: l.accountId, debit: l.debit, credit: l.credit }))
  saveTable('JournalLine', lineRows)
  return entry
}

// Called from payroll.ts#markPaid AFTER the payslip is already marked Paid — fail-open, mirrors the real
// service.ts#postPayrollAutoEntry contract (a ledger-posting failure must never block the payroll payment).
export function postPayrollAutoEntry(schoolId: string, actorId: string, payslip: { id: string; net: number; paidAt?: string }) {
  try {
    const salary = systemAccount(schoolId, SALARY_EXPENSE_CODE)
    const bank = systemAccount(schoolId, BANK_CODE)
    writeBalancedEntry(schoolId, {
      date: (payslip.paidAt ?? nowIso()).slice(0, 10), memo: 'Payroll paid', reference: payslip.id,
      sourceType: 'Payroll', sourceId: payslip.id, createdById: actorId,
      lines: [{ accountId: String(salary.id), debit: payslip.net, credit: 0 }, { accountId: String(bank.id), debit: 0, credit: payslip.net }],
    })
  } catch (err) {
    console.error('[mock backend] payroll ledger auto-post failed (non-fatal)', err)
  }
}

// ───────────────────────── accounts ─────────────────────────

route('GET', '/accounting/accounts', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  let rows = accountsFor(actor.schoolId)
  if (ctx.query.type) rows = rows.filter(a => a.type === ctx.query.type)
  if (ctx.query.active !== undefined) rows = rows.filter(a => Boolean(a.active) === (ctx.query.active === 'true'))
  rows = [...rows].sort((a, b) => String(a.code).localeCompare(String(b.code)))
  return { items: rows.map(serializeAccount) }
})

route('POST', '/accounting/accounts', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const body = ctx.body as { code: string; name: string; type: string; parentId?: string | null; active?: boolean }
  const existing = accountsFor(actor.schoolId).find(a => a.code === body.code)
  if (existing) throw badRequest(`An account with code "${body.code}" already exists`)
  if (body.parentId && !accountsFor(actor.schoolId).find(a => a.id === body.parentId)) throw notFound('Account')
  const row: Row = {
    id: uid('account'), schoolId: actor.schoolId, code: body.code, name: body.name, type: body.type,
    parentId: body.parentId ?? null, isSystem: false, active: body.active ?? true, createdAt: nowIso(), updatedAt: nowIso(),
  }
  const rows = table('Account'); rows.push(row); saveTable('Account', rows)
  return { item: serializeAccount(row) }
})

route('PATCH', '/accounting/accounts/:id', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const rows = table('Account')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Account')
  const body = ctx.body as { name?: string; parentId?: string | null; active?: boolean }
  if (body.parentId !== undefined && body.parentId !== null) {
    if (body.parentId === ctx.params.id) throw badRequest('An account cannot be its own parent')
    if (!accountsFor(actor.schoolId).find(a => a.id === body.parentId)) throw notFound('Account')
  }
  rows[idx] = { ...rows[idx], name: body.name ?? rows[idx].name, parentId: body.parentId === undefined ? rows[idx].parentId : body.parentId, active: body.active ?? rows[idx].active, updatedAt: nowIso() }
  saveTable('Account', rows)
  return { item: serializeAccount(rows[idx]) }
})

route('DELETE', '/accounting/accounts/:id', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const rows = table('Account')
  const idx = rows.findIndex(a => a.id === ctx.params.id && a.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Account')
  const row = rows[idx]
  if (row.isSystem) throw badRequest(`"${row.name}" is a system account relied on by the Fees/Payroll auto-posting integration and cannot be deleted`)
  if (table('JournalLine').some(l => l.accountId === row.id)) throw badRequest('Cannot delete an account that has journal-entry history — its record must be kept for the audit trail')
  if (rows.some(a => a.parentId === row.id)) throw badRequest('Cannot delete an account that has child accounts')
  rows.splice(idx, 1)
  saveTable('Account', rows)
  return { ok: true }
})

// ───────────────────────── journal entries ─────────────────────────

route('GET', '/accounting/journal-entries', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  let rows = table('JournalEntry').filter(e => e.schoolId === actor.schoolId)
  if (ctx.query.from) rows = rows.filter(e => String(e.date) >= ctx.query.from)
  if (ctx.query.to) rows = rows.filter(e => String(e.date) <= ctx.query.to)
  if (ctx.query.sourceType) rows = rows.filter(e => e.sourceType === ctx.query.sourceType)
  if (ctx.query.accountId) rows = rows.filter(e => linesForEntry(String(e.id)).some(l => l.accountId === ctx.query.accountId))
  rows = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)))
  return { items: rows.map(serializeEntry), nextCursor: undefined }
})

route('POST', '/accounting/journal-entries', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const body = ctx.body as { date: string; memo: string; reference?: string | null; lines: { accountId: string; debit?: number; credit?: number }[] }
  if (!Array.isArray(body.lines) || body.lines.length < 2) throw badRequest('A journal entry needs at least two lines')
  const entry = writeBalancedEntry(actor.schoolId, {
    date: body.date, memo: body.memo, reference: body.reference ?? null, sourceType: 'Manual', createdById: actor.userId,
    lines: body.lines.map(l => ({ accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0 })),
  })
  return { item: serializeEntry(entry) }
})

route('GET', '/accounting/journal-entries/:id', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const row = table('JournalEntry').find(e => e.id === ctx.params.id && e.schoolId === actor.schoolId)
  if (!row) throw notFound('Journal entry')
  return { item: serializeEntry(row) }
})

// ───────────────────────── reports ─────────────────────────

// Sums every JournalLine for the school up to (and, for a window, from) a date — same convention as the
// real service.ts#aggregateLines.
function aggregateLines(schoolId: string, window: { gte?: string; lte?: string }) {
  const entries = table('JournalEntry').filter(e => e.schoolId === schoolId
    && (!window.gte || String(e.date) >= window.gte) && (!window.lte || String(e.date) <= window.lte))
  const entryIds = new Set(entries.map(e => String(e.id)))
  const sums = new Map<string, { debit: number; credit: number }>()
  for (const l of table('JournalLine')) {
    if (!entryIds.has(String(l.entryId))) continue
    const s = sums.get(String(l.accountId)) ?? { debit: 0, credit: 0 }
    s.debit += Number(l.debit); s.credit += Number(l.credit)
    sums.set(String(l.accountId), s)
  }
  return sums
}

route('GET', '/accounting/reports/trial-balance', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const asOf = ctx.query.asOf
  if (!asOf) throw badRequest('asOf is required')
  const sums = aggregateLines(actor.schoolId, { lte: asOf })
  const accounts = [...accountsFor(actor.schoolId)].sort((a, b) => String(a.code).localeCompare(String(b.code)))
  const rows: { accountId: string; code: string; name: string; type: string; debit: number; credit: number }[] = []
  let totalDebit = 0, totalCredit = 0
  for (const a of accounts) {
    const s = sums.get(String(a.id)); if (!s) continue
    const net = round2(s.debit - s.credit); if (net === 0) continue
    const debit = net > 0 ? net : 0, credit = net < 0 ? -net : 0
    totalDebit = round2(totalDebit + debit); totalCredit = round2(totalCredit + credit)
    rows.push({ accountId: String(a.id), code: String(a.code), name: String(a.name), type: String(a.type), debit, credit })
  }
  return { asOf, accounts: rows, totalDebit, totalCredit }
})

route('GET', '/accounting/reports/profit-and-loss', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const { from, to } = ctx.query
  if (!from || !to) throw badRequest('from and to are required')
  if (from > to) throw badRequest('`from` must not be after `to`')
  const sums = aggregateLines(actor.schoolId, { gte: from, lte: to })
  const accounts = accountsFor(actor.schoolId).filter(a => a.type === 'Income' || a.type === 'Expense')
  const income: { accountId: string; code: string; name: string; amount: number }[] = []
  const expense: { accountId: string; code: string; name: string; amount: number }[] = []
  let totalIncome = 0, totalExpense = 0
  for (const a of accounts) {
    const s = sums.get(String(a.id)); if (!s) continue
    if (a.type === 'Income') {
      const amount = round2(s.credit - s.debit); if (amount === 0) continue
      totalIncome = round2(totalIncome + amount); income.push({ accountId: String(a.id), code: String(a.code), name: String(a.name), amount })
    } else {
      const amount = round2(s.debit - s.credit); if (amount === 0) continue
      totalExpense = round2(totalExpense + amount); expense.push({ accountId: String(a.id), code: String(a.code), name: String(a.name), amount })
    }
  }
  return { from, to, income, expense, totalIncome, totalExpense, netIncome: round2(totalIncome - totalExpense) }
})

route('GET', '/accounting/reports/balance-sheet', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const asOf = ctx.query.asOf
  if (!asOf) throw badRequest('asOf is required')
  const sums = aggregateLines(actor.schoolId, { lte: asOf })
  const accounts = accountsFor(actor.schoolId)
  const assets: { accountId: string; code: string; name: string; amount: number }[] = []
  const liabilities: { accountId: string; code: string; name: string; amount: number }[] = []
  const equity: { accountId: string | null; code: string | null; name: string; amount: number }[] = []
  let totalAssets = 0, totalLiabilities = 0, equityAccountsTotal = 0, totalIncome = 0, totalExpense = 0
  for (const a of accounts) {
    const s = sums.get(String(a.id)); if (!s) continue
    if (a.type === 'Asset') {
      const amount = round2(s.debit - s.credit); if (amount === 0) continue
      totalAssets = round2(totalAssets + amount); assets.push({ accountId: String(a.id), code: String(a.code), name: String(a.name), amount })
    } else if (a.type === 'Liability') {
      const amount = round2(s.credit - s.debit); if (amount === 0) continue
      totalLiabilities = round2(totalLiabilities + amount); liabilities.push({ accountId: String(a.id), code: String(a.code), name: String(a.name), amount })
    } else if (a.type === 'Equity') {
      const amount = round2(s.credit - s.debit); if (amount === 0) continue
      equityAccountsTotal = round2(equityAccountsTotal + amount); equity.push({ accountId: String(a.id), code: String(a.code), name: String(a.name), amount })
    } else if (a.type === 'Income') {
      totalIncome = round2(totalIncome + round2(s.credit - s.debit))
    } else if (a.type === 'Expense') {
      totalExpense = round2(totalExpense + round2(s.debit - s.credit))
    }
  }
  const netIncome = round2(totalIncome - totalExpense)
  if (netIncome !== 0) equity.push({ accountId: null, code: null, name: 'Retained Earnings (Net Income)', amount: netIncome })
  const totalEquity = round2(equityAccountsTotal + netIncome)
  return { asOf, assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, totalLiabilitiesAndEquity: round2(totalLiabilities + totalEquity) }
})

// Phase 21 — financial intelligence. See the module-header comment for why program-profitability and
// concession-impact are zero-income placeholders in this batch (Fees module not built yet).

route('GET', '/accounting/reports/cash-flow-forecast', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const months = Math.max(1, Math.min(12, Number(ctx.query.months) || 3))
  const bank = systemAccount(actor.schoolId, BANK_CODE)
  const bankSums = aggregateLines(actor.schoolId, {})
  const bankRow = bankSums.get(String(bank.id))
  const startingBalance = round2((bankRow?.debit ?? 0) - (bankRow?.credit ?? 0))

  const structures = table('SalaryStructure').filter(s => s.schoolId === actor.schoolId)
  const monthlyPayrollObligation = round2(structures.reduce((a, s) => {
    const allowances = (s.allowances as { amount: number }[] | undefined) ?? []
    return a + Number(s.basic) + allowances.reduce((x, i) => x + i.amount, 0)
  }, 0))

  // No FeeInvoice data in this batch — inflow is always 0 (documented in `methodology`).
  const now = new Date()
  const monthsOut: { month: string; projectedInflow: number; projectedOutflow: number; projectedBalance: number }[] = []
  let runningBalance = startingBalance
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))
    const projectedInflow = 0
    const projectedOutflow = monthlyPayrollObligation
    runningBalance = round2(runningBalance + projectedInflow - projectedOutflow)
    monthsOut.push({ month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, projectedInflow, projectedOutflow, projectedBalance: runningBalance })
  }
  return {
    startingBalance, monthlyPayrollObligation, months: monthsOut,
    methodology: 'Starting balance is the Bank account\'s current GL balance. Projected outflow assumes the current total monthly payroll obligation (active staff/teacher/admin SalaryStructure basic+allowances) stays constant across the window. Projected inflow is 0 in this demo build — the Fees module (unpaid invoice due-dates) is not part of this batch.',
  }
})

route('GET', '/accounting/reports/program-profitability', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const termId = ctx.query.termId
  if (!termId) throw badRequest('termId is required')
  const term = table('Term').find(t => t.id === termId && t.schoolId === actor.schoolId)
  if (!term) throw notFound('Term')
  const methodology = 'Income is real fee collections for students enrolled in each board+grade\'s classes; this demo build has no Fees module data yet, so income is always 0 here. Expense is each teacher\'s actual paid salary for the term, allocated proportionally to teaching periods (a teacher who splits their week across programs has their salary split the same way). General/shared school overhead is NOT allocated to any program. This is a defensible estimate for comparing programs against each other, not precise cost accounting.'

  const classes = table('Class').filter(c => c.schoolId === actor.schoolId && c.academicYearId === term.academicYearId)
  if (!classes.length) return { termId, programs: [], methodology }
  type Program = { boardId: string; boardName: string; gradeId: string; gradeLabel: string; classIds: string[] }
  const programs = new Map<string, Program>()
  for (const c of classes) {
    const board = table('Board').find(b => b.id === c.boardId)
    const grade = table('Grade').find(g => g.id === c.gradeId)
    const key = `${c.boardId}::${c.gradeId}`
    const p = programs.get(key) ?? { boardId: String(c.boardId), boardName: String(board?.name ?? '—'), gradeId: String(c.gradeId), gradeLabel: String(grade?.label ?? '—'), classIds: [] }
    p.classIds.push(String(c.id))
    programs.set(key, p)
  }
  const classIds = classes.map(c => String(c.id))
  const classSubjects = table('ClassSubject').filter(cs => classIds.includes(String(cs.classId)))
  const payslips = table('Payslip').filter(p => p.schoolId === actor.schoolId && p.status === 'Paid'
    && p.paidAt && String(p.paidAt).slice(0, 10) >= String(term.startDate) && String(p.paidAt).slice(0, 10) <= String(term.endDate))
  const expenseByClass = new Map<string, number>()
  for (const slip of payslips) {
    const taught = classSubjects.filter(cs => cs.teacherId === slip.userId)
    const totalPeriods = taught.reduce((a, cs) => a + Number(cs.periodsPerWeek ?? 0), 0)
    if (totalPeriods <= 0) continue
    for (const cs of taught) {
      const share = round2(Number(slip.net) * (Number(cs.periodsPerWeek ?? 0) / totalPeriods))
      expenseByClass.set(String(cs.classId), round2((expenseByClass.get(String(cs.classId)) ?? 0) + share))
    }
  }
  const result = [...programs.values()].map(p => {
    const income = 0
    const expense = round2(p.classIds.reduce((a, id) => a + (expenseByClass.get(id) ?? 0), 0))
    const inProgram = classSubjects.filter(cs => p.classIds.includes(String(cs.classId)))
    const teacherCount = new Set(inProgram.filter(cs => cs.teacherId).map(cs => cs.teacherId)).size
    const weeklyPeriods = inProgram.reduce((a, cs) => a + Number(cs.periodsPerWeek ?? 0), 0)
    return { boardId: p.boardId, boardName: p.boardName, gradeId: p.gradeId, gradeLabel: p.gradeLabel, income, expense, profit: round2(income - expense), teacherCount, weeklyPeriods }
  }).sort((a, b) => b.profit - a.profit)
  return { termId, programs: result, methodology }
})

route('GET', '/accounting/reports/concession-impact', (ctx) => {
  requireRole(ctx, ...WRITE_ROLES)
  // No FeeInvoice/ScholarshipAward data in this batch (Fees module) — always a zero report, correctly shaped.
  return {
    termId: ctx.query.termId || undefined, totalInvoiced: 0, totalConcession: 0, pctOfInvoiced: 0,
    scholarshipConcession: 0, manualConcession: 0, byScholarshipType: [], studentsAffected: 0,
  }
})
