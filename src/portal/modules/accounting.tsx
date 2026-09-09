import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertTriangle, BadgeCheck, Calculator, CheckCircle2, ChevronRight, FileBarChart2, GraduationCap, Info, Lock, NotebookPen, Pencil, Plus,
  Scale, TrendingDown, TrendingUp, Trash2, Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import type { AccountRec, AccountType, JournalSourceType, ScholarshipType } from '@/lib/data'
import { useAcademic } from '@/lib/store'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { isoDate } from '@/lib/hooks/useTimetable'
import {
  ACCOUNT_TYPES, DEBIT_NORMAL_TYPES, JOURNAL_SOURCE_TYPES, accountTypeTone, fmtMoney, isSystemSourced,
  sourceLabel, useAccounts, useBalanceSheet, useCashFlowForecast, useConcessionImpact, useJournalEntries, useProfitAndLoss,
  useProgramProfitability, useTrialBalance,
} from '@/lib/hooks/useAccounting'
import { scholarshipTypeLabel } from '@/lib/hooks/useScholarships'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'

// Phase 17 — Accounting / General Ledger (frontend). Chart of Accounts (list/create/edit/delete, grouped by
// type), Journal (filterable list of posted entries + a manual-entry form with a live, float-safe balance
// check), and Reports (Trial Balance / Profit & Loss / Balance Sheet). Admin/superadmin only — endpoint
// shapes reconciled against the live server/src/modules/accounting/{router,schema,service}.ts — see
// useAccounting.ts's header note for the specific points worth knowing (report field names, account
// code/type immutability on edit, delete guardrails). See .agents/edunova/phase-17-accounting.md

const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const rowCls = 'flex flex-wrap items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-5 py-3.5 last:border-0'
const cardHead = 'flex flex-wrap items-center justify-between gap-3 border-b border-black/[.06] dark:border-white/[.08] px-5 py-3.5'
const iconBtn = 'rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-black/[.05]'
const dangerBtn = 'rounded-full bg-rose-50 dark:bg-rose-500/10 p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-40'

// Exported: also used by /portal/accounting/journal/new (JournalEntryNew.tsx).
export function FormActions({ onCancel, onSave, label, disabled }: { onCancel: () => void; onSave: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onSave} disabled={disabled} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{label}</button>
      <button onClick={onCancel} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
    </div>
  )
}

function ConfirmModal({ open, title, body, action, busy, onClose, onConfirm }: {
  open: boolean; title: string; body: string; action: string; busy?: boolean; onClose: () => void; onConfirm: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-[14px] text-black/60 dark:text-white/60">{body}</p>
        <div className="flex gap-3">
          <button onClick={onConfirm} disabled={busy} className="btn-ink flex-1 bg-rose-600 py-3 text-[14px] font-semibold hover:bg-rose-700 disabled:opacity-40">{action}</button>
          <button onClick={onClose} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Chart of Accounts ─────────────────────────────────── */

interface AccountForm { code: string; name: string; type: AccountType; parentId: string; active: boolean }
const emptyAccountForm = (type: AccountType = 'Asset'): AccountForm => ({ code: '', name: '', type, parentId: '', active: true })

function AccountFormModal({ open, editing, accounts, onClose, onSaved }: {
  open: boolean; editing: AccountRec | null; accounts: AccountRec[]; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<AccountForm>(emptyAccountForm())
  const [busy, setBusy] = useState(false)
  // Same closed→open resync convention as inventory.tsx's ItemFormModal — this modal stays mounted between
  // opens, so reset only on a genuine closed→open transition, not on every render while open.
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setForm(editing
      ? { code: editing.code, name: editing.name, type: editing.type, parentId: editing.parentId ?? '', active: editing.active }
      : emptyAccountForm())
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  const parentCandidates = useMemo(
    () => accounts.filter(a => a.type === form.type && a.id !== editing?.id).sort((a, b) => a.code.localeCompare(b.code)),
    [accounts, form.type, editing],
  )

  const save = async () => {
    setBusy(true)
    try {
      // The server's PATCH only accepts name/parentId/active — code and type are immutable once an account
      // is created (changing either could misfile posted journal lines, or break the Fees/Payroll
      // integration's lookup-by-code), so an edit never sends them.
      if (editing) {
        await api.patch(`/accounting/accounts/${editing.id}`, { name: form.name.trim(), parentId: form.parentId || null, active: form.active })
      } else {
        await api.post('/accounting/accounts', { code: form.code.trim(), name: form.name.trim(), type: form.type, parentId: form.parentId || null, active: form.active })
      }
      onSaved(); toast.success(editing ? 'Account updated' : 'Account added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${editing.name}` : 'New account'}>
      <div className="space-y-4">
        {editing?.isSystem && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-3.5 text-[13px] text-amber-800 dark:text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p>This account is used by the automatic Fee/Payroll ledger integration. Deactivating it may break auto-posting.</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {editing ? (
            <>
              <div><span className="text-[13px] font-semibold text-black/60 dark:text-white/60">Code</span><p className="mt-1.5 rounded-xl bg-black/[.04] dark:bg-white/[.06] px-4 py-2.5 font-mono text-[14.5px]">{editing.code}</p></div>
              <div><span className="text-[13px] font-semibold text-black/60 dark:text-white/60">Type</span><p className="mt-1.5 rounded-xl bg-black/[.04] dark:bg-white/[.06] px-4 py-2.5 text-[14.5px]">{editing.type}</p></div>
            </>
          ) : (
            <>
              <Field label="Code"><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g. 1010" className={inputCls} autoFocus /></Field>
              <Field label="Type">
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as AccountType, parentId: '' })} className={inputCls}>
                  {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>
        <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bank" className={inputCls} autoFocus={!!editing} /></Field>
        <Field label="Parent account">
          <select value={form.parentId} onChange={e => setForm({ ...form, parentId: e.target.value })} className={inputCls}>
            <option value="">None (top-level)</option>
            {parentCandidates.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        {editing && (
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Active
          </label>
        )}
        <FormActions onCancel={onClose} onSave={save} label={editing ? 'Save changes' : 'Add account'} disabled={!form.code.trim() || !form.name.trim() || busy} />
      </div>
    </Modal>
  )
}

export function ChartOfAccountsMod() {
  const accounts = useAccounts()
  const [editing, setEditing] = useState<AccountRec | null | 'new'>(null)
  const [delAccount, setDelAccount] = useState<AccountRec | null>(null)
  const [busy, setBusy] = useState(false)
  const byType = useMemo(() => {
    const m = new Map<AccountType, AccountRec[]>()
    ACCOUNT_TYPES.forEach(t => m.set(t, []))
    for (const a of accounts.items ?? []) m.get(a.type)?.push(a)
    m.forEach(list => list.sort((a, b) => a.code.localeCompare(b.code)))
    return m
  }, [accounts.items])
  const byId = useMemo(() => new Map((accounts.items ?? []).map(a => [a.id, a])), [accounts.items])

  const removeAccount = async () => {
    if (!delAccount) return
    setBusy(true)
    try { await api.del(`/accounting/accounts/${delAccount.id}`); setDelAccount(null); accounts.reload(); toast.success('Account deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHead title="Chart of Accounts" sub="Ledger accounts grouped by type — the foundation every journal entry posts against">
        <button onClick={() => setEditing('new')} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
          <Plus size={15} /> New account
        </button>
      </PageHead>

      {accounts.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading chart of accounts…</p>}
      {accounts.error && <Empty text={accounts.error} />}
      {!accounts.loading && !accounts.error && (accounts.items ?? []).length === 0 && (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><Calculator size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No accounts yet</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">Add the first account to start building the chart.</p>
        </Card>
      )}

      <div className="space-y-5">
        {ACCOUNT_TYPES.map(type => {
          const list = byType.get(type) ?? []
          if (list.length === 0) return null
          return (
            <Card key={type} className="p-0">
              <div className={cardHead}>
                <div className="flex items-center gap-2.5">
                  <Pill tone={accountTypeTone(type)}>{type}</Pill>
                  <span className={muted}>{list.length} account{list.length === 1 ? '' : 's'}</span>
                </div>
                <span className={muted}>{DEBIT_NORMAL_TYPES.includes(type) ? 'Debit-normal' : 'Credit-normal'}</span>
              </div>
              <div>
                {list.map(a => (
                  <div key={a.id} className={rowCls}>
                    <span className="font-mono text-[13px] text-black/40 dark:text-white/40">{a.code}</span>
                    <div className="min-w-32 flex-1">
                      <p className="text-[14px] font-semibold">{a.name}</p>
                      {a.parentId && <p className={muted}>Under {byId.get(a.parentId)?.name ?? '—'}</p>}
                    </div>
                    {a.isSystem && <Pill tone="slate"><Lock size={10} /> System</Pill>}
                    {!a.active && <Pill tone="rose">Inactive</Pill>}
                    <button onClick={() => setEditing(a)} className={iconBtn} aria-label={`Edit ${a.name}`}><Pencil size={14} /></button>
                    <button onClick={() => setDelAccount(a)} className={dangerBtn} aria-label={`Delete ${a.name}`} disabled={a.isSystem}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </Card>
          )
        })}
      </div>

      <AccountFormModal
        open={editing !== null}
        editing={editing === 'new' ? null : editing}
        accounts={accounts.items ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); accounts.reload() }}
      />

      <ConfirmModal open={!!delAccount} onClose={() => setDelAccount(null)} title={`Delete ${delAccount?.name ?? 'account'}?`}
        body="This cannot be undone. Accounts with posted journal history or child accounts can't be deleted." action="Delete account" busy={busy} onConfirm={removeAccount} />
    </div>
  )
}

/* ── Journal ───────────────────────────────────────────── */
// The "New manual journal entry" form and the journal-entry detail view used to be `NewEntryModal` /
// `EntryDetailModal` here. Both are inherently multi-line debit/credit builders/viewers, so per
// .agents/edunova/ui-architecture-fix.md Phase D they're now real routed pages:
// `/portal/accounting/journal/new` (src/pages/portal/JournalEntryNew.tsx) and
// `/portal/accounting/journal/:id` (src/pages/portal/JournalEntryDetail.tsx). `LineDraft`/`emptyLine`/
// `BalanceStrip` moved into JournalEntryNew.tsx since nothing else in this module used them; `FormActions`
// above is exported and reused there.

export function JournalMod() {
  const navigate = useNavigate()
  const accounts = useAccounts()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [accountId, setAccountId] = useState('')
  const [sourceType, setSourceType] = useState<JournalSourceType | ''>('')
  const entries = useJournalEntries({ from: from || undefined, to: to || undefined, accountId: accountId || undefined, sourceType: sourceType || undefined })

  const sorted = useMemo(() => [...(entries.items ?? [])].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '')), [entries.items])
  const activeAccounts = useMemo(() => (accounts.items ?? []).sort((a, b) => a.code.localeCompare(b.code)), [accounts.items])

  return (
    <div>
      <PageHead title="Journal" sub="Every posted entry — auto-generated from Fees/Payroll, plus manual entries">
        <button onClick={() => navigate('/portal/accounting/journal/new')} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
          <Plus size={15} /> New manual entry
        </button>
      </PageHead>

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} /></Field>
          <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} /></Field>
          <Field label="Account">
            <select value={accountId} onChange={e => setAccountId(e.target.value)} className={inputCls}>
              <option value="">All accounts</option>
              {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
          <Field label="Source">
            <select value={sourceType} onChange={e => setSourceType(e.target.value as JournalSourceType | '')} className={inputCls}>
              <option value="">All sources</option>
              {JOURNAL_SOURCE_TYPES.map(s => <option key={s} value={s}>{sourceLabel(s)}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      {entries.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading journal…</p>}
      {entries.error && <Empty text={entries.error} />}
      {!entries.loading && !entries.error && sorted.length === 0 && (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><NotebookPen size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No entries found</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">{from || to || accountId || sourceType ? 'Try different filters.' : 'Post a manual entry, or wait for Fees/Payroll activity to auto-post.'}</p>
        </Card>
      )}

      <Card className="p-0">
        {sorted.map(e => {
          const total = e.totalDebit ?? e.lines.reduce((a, l) => a + (Number(l.debit) || 0), 0)
          return (
            <button key={e.id} onClick={() => navigate(`/portal/accounting/journal/${e.id}`)} className={`${rowCls} w-full text-left hover:bg-black/[.02] dark:hover:bg-white/[.03]`}>
              <div className="min-w-40 flex-1">
                <p className="text-[14px] font-semibold">{e.memo}</p>
                <p className={muted}>{fmtDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}{e.reference ? ` · ${e.reference}` : ''}</p>
              </div>
              {isSystemSourced(e.sourceType)
                ? <Pill tone="slate"><Lock size={10} /> System · {sourceLabel(e.sourceType)}</Pill>
                : <Pill tone="indigo"><BadgeCheck size={10} /> Manual</Pill>}
              <span className="text-[13.5px] font-semibold">{fmtMoney(total)}</span>
              <ChevronRight size={16} className="shrink-0 text-black/30 dark:text-white/30" />
            </button>
          )
        })}
      </Card>

    </div>
  )
}

/* ── Reports ───────────────────────────────────────────── */

type ReportTab = 'trial' | 'pl' | 'bs' | 'cashflow' | 'program' | 'concession'
const REPORT_TABS: { id: ReportTab; label: string }[] = [
  { id: 'trial', label: 'Trial Balance' }, { id: 'pl', label: 'Profit & Loss' }, { id: 'bs', label: 'Balance Sheet' },
  { id: 'cashflow', label: 'Cash Flow Forecast' }, { id: 'program', label: 'Program Profitability' }, { id: 'concession', label: 'Concession Impact' },
]

/** Shared disclaimer strip for the two Phase 21 reports whose `methodology` field is an estimate, not
 * precise accounting (per the phase spec: never hide this text). */
function MethodologyNote({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-3.5 text-[12.5px] text-amber-800 dark:text-amber-300">
      <Info size={15} className="mt-0.5 shrink-0" />
      <p>{text}</p>
    </div>
  )
}

function ReportTable({ head, rows, footer }: { head: ReactNode; rows: ReactNode; footer?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-b border-black/[.08] text-left text-[12px] font-semibold uppercase tracking-wide text-black/40 dark:border-white/[.1] dark:text-white/40">{head}</tr>
        </thead>
        <tbody className="divide-y divide-black/[.05] dark:divide-white/[.07]">{rows}</tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  )
}

function TrialBalanceView() {
  const [asOf, setAsOf] = useState(isoDate(new Date()))
  const { data, loading, error } = useTrialBalance(asOf)
  const rows = data?.accounts ?? []
  return (
    <div className="space-y-4">
      <Field label="As of"><input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={`${inputCls} max-w-xs`} /></Field>
      {loading && <p className="py-8 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {error && <Empty text={error} />}
      {!loading && !error && (
        <Card className="p-0">
          {rows.length === 0 ? <div className="p-6"><Empty text="No account balances as of this date." /></div> : (
            <div className="p-5">
              <ReportTable
                head={<><th className="py-2 pr-3">Code</th><th className="py-2 pr-3">Account</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3 text-right">Debit</th><th className="py-2 text-right">Credit</th></>}
                rows={rows.map(r => (
                  <tr key={r.accountId}>
                    <td className="py-2 pr-3 font-mono text-black/50 dark:text-white/50">{r.code}</td>
                    <td className="py-2 pr-3 font-medium">{r.name}</td>
                    <td className="py-2 pr-3"><Pill tone={accountTypeTone(r.type)}>{r.type}</Pill></td>
                    <td className="py-2 pr-3 text-right">{r.debit > 0 ? fmtMoney(r.debit) : ''}</td>
                    <td className="py-2 text-right">{r.credit > 0 ? fmtMoney(r.credit) : ''}</td>
                  </tr>
                ))}
                footer={
                  <tr className="border-t border-black/[.08] font-semibold dark:border-white/[.1]">
                    <td className="py-2 pr-3" colSpan={3}>Total</td>
                    <td className="py-2 pr-3 text-right">{fmtMoney(data?.totalDebit ?? 0)}</td>
                    <td className="py-2 text-right">{fmtMoney(data?.totalCredit ?? 0)}</td>
                  </tr>
                }
              />
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function ProfitAndLossView() {
  const firstOfMonth = () => { const d = new Date(); d.setDate(1); return isoDate(d) }
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(isoDate(new Date()))
  const { data, loading, error } = useProfitAndLoss(from, to)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${inputCls} max-w-xs`} /></Field>
        <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${inputCls} max-w-xs`} /></Field>
      </div>
      {loading && <p className="py-8 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {error && <Empty text={error} />}
      {!loading && !error && data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-0">
            <p className={`${sectionLabel} border-b border-black/[.06] px-5 py-3.5 dark:border-white/[.08]`}>Income</p>
            <div className="p-5">
              <ReportTable
                head={<><th className="py-2 pr-3">Account</th><th className="py-2 text-right">Amount</th></>}
                rows={(data.income ?? []).length === 0
                  ? <tr><td colSpan={2} className="py-4 text-black/40 dark:text-white/40">No income in this period.</td></tr>
                  : data.income.map(r => <tr key={r.accountId}><td className="py-2 pr-3">{r.name}</td><td className="py-2 text-right">{fmtMoney(r.amount)}</td></tr>)}
                footer={<tr className="border-t border-black/[.08] font-semibold dark:border-white/[.1]"><td className="py-2 pr-3">Total income</td><td className="py-2 text-right">{fmtMoney(data.totalIncome)}</td></tr>}
              />
            </div>
          </Card>
          <Card className="p-0">
            <p className={`${sectionLabel} border-b border-black/[.06] px-5 py-3.5 dark:border-white/[.08]`}>Expense</p>
            <div className="p-5">
              <ReportTable
                head={<><th className="py-2 pr-3">Account</th><th className="py-2 text-right">Amount</th></>}
                rows={(data.expense ?? []).length === 0
                  ? <tr><td colSpan={2} className="py-4 text-black/40 dark:text-white/40">No expense in this period.</td></tr>
                  : data.expense.map(r => <tr key={r.accountId}><td className="py-2 pr-3">{r.name}</td><td className="py-2 text-right">{fmtMoney(r.amount)}</td></tr>)}
                footer={<tr className="border-t border-black/[.08] font-semibold dark:border-white/[.1]"><td className="py-2 pr-3">Total expense</td><td className="py-2 text-right">{fmtMoney(data.totalExpense)}</td></tr>}
              />
            </div>
          </Card>
          <Card className={`lg:col-span-2 flex items-center justify-between ${data.netIncome >= 0 ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-rose-50 dark:bg-rose-500/10'}`}>
            <p className="font-display text-lg font-medium">{data.netIncome >= 0 ? 'Net profit' : 'Net loss'}</p>
            <p className={`font-display text-2xl font-medium ${data.netIncome >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{fmtMoney(Math.abs(data.netIncome))}</p>
          </Card>
        </div>
      )}
    </div>
  )
}

function BalanceSheetView() {
  const [asOf, setAsOf] = useState(isoDate(new Date()))
  const { data, loading, error } = useBalanceSheet(asOf)
  // Compare in integer paise, same float-safety rule as the journal-entry balance check — never a bare `===`
  // on rupee floats. The server already computed `totalLiabilitiesAndEquity`, so this only re-verifies it
  // against `totalAssets` rather than re-deriving the sum client-side.
  const balanced = data && Math.round(data.totalAssets * 100) === Math.round(data.totalLiabilitiesAndEquity * 100)
  return (
    <div className="space-y-4">
      <Field label="As of"><input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={`${inputCls} max-w-xs`} /></Field>
      {loading && <p className="py-8 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {error && <Empty text={error} />}
      {!loading && !error && data && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-0">
              <p className={`${sectionLabel} border-b border-black/[.06] px-5 py-3.5 dark:border-white/[.08]`}>Assets</p>
              <div className="p-5">
                <ReportTable
                  head={<><th className="py-2 pr-3">Account</th><th className="py-2 text-right">Balance</th></>}
                  rows={data.assets.map(r => <tr key={r.accountId}><td className="py-2 pr-3">{r.name}</td><td className="py-2 text-right">{fmtMoney(r.amount)}</td></tr>)}
                  footer={<tr className="border-t border-black/[.08] font-semibold dark:border-white/[.1]"><td className="py-2 pr-3">Total assets</td><td className="py-2 text-right">{fmtMoney(data.totalAssets)}</td></tr>}
                />
              </div>
            </Card>
            <div className="space-y-5">
              <Card className="p-0">
                <p className={`${sectionLabel} border-b border-black/[.06] px-5 py-3.5 dark:border-white/[.08]`}>Liabilities</p>
                <div className="p-5">
                  <ReportTable
                    head={<><th className="py-2 pr-3">Account</th><th className="py-2 text-right">Balance</th></>}
                    rows={data.liabilities.length === 0
                      ? <tr><td colSpan={2} className="py-3 text-black/40 dark:text-white/40">None</td></tr>
                      : data.liabilities.map(r => <tr key={r.accountId}><td className="py-2 pr-3">{r.name}</td><td className="py-2 text-right">{fmtMoney(r.amount)}</td></tr>)}
                    footer={<tr className="border-t border-black/[.08] font-semibold dark:border-white/[.1]"><td className="py-2 pr-3">Total liabilities</td><td className="py-2 text-right">{fmtMoney(data.totalLiabilities)}</td></tr>}
                  />
                </div>
              </Card>
              <Card className="p-0">
                <p className={`${sectionLabel} border-b border-black/[.06] px-5 py-3.5 dark:border-white/[.08]`}>Equity</p>
                <div className="p-5">
                  <ReportTable
                    head={<><th className="py-2 pr-3">Account</th><th className="py-2 text-right">Balance</th></>}
                    rows={data.equity.length === 0
                      ? <tr><td colSpan={2} className="py-3 text-black/40 dark:text-white/40">None</td></tr>
                      : data.equity.map(r => <tr key={r.accountId ?? r.name}><td className="py-2 pr-3">{r.name}</td><td className="py-2 text-right">{fmtMoney(r.amount)}</td></tr>)}
                    footer={<tr className="border-t border-black/[.08] font-semibold dark:border-white/[.1]"><td className="py-2 pr-3">Total equity</td><td className="py-2 text-right">{fmtMoney(data.totalEquity)}</td></tr>}
                  />
                </div>
              </Card>
            </div>
          </div>
          <Card className={`flex items-center justify-between ${balanced ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-rose-50 dark:bg-rose-500/10'}`}>
            <p className="text-[14px] font-semibold">Assets = Liabilities + Equity</p>
            <div className={`flex items-center gap-1.5 text-[13.5px] font-semibold ${balanced ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {balanced ? <><CheckCircle2 size={15} /> Balanced</> : <><Scale size={15} /> Out of balance</>}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

/* ── Phase 21 item 1: cash-flow forecast ──────────────────── */

function CashFlowForecastView() {
  const [months, setMonths] = useState(3)
  const { data, loading, error } = useCashFlowForecast(months)
  const maxAbs = useMemo(() => Math.max(1, ...(data?.months ?? []).map(m => Math.abs(m.projectedBalance))), [data])
  return (
    <div className="space-y-4">
      <Field label="Months to project">
        <select value={months} onChange={e => setMonths(Number(e.target.value))} className={`${inputCls} max-w-xs`}>
          {[1, 2, 3, 6, 12].map(n => <option key={n} value={n}>{n} month{n === 1 ? '' : 's'}</option>)}
        </select>
      </Field>
      {loading && <p className="py-8 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {error && <Empty text={error} />}
      {!loading && !error && data && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="flex items-center gap-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10"><Wallet size={20} className="text-indigo-600" /></span>
              <div><p className={muted}>Current bank balance</p><p className="font-display text-2xl font-medium">{fmtMoney(data.startingBalance)}</p></div>
            </Card>
            <Card className="flex items-center gap-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-500/10"><TrendingDown size={20} className="text-amber-600" /></span>
              <div><p className={muted}>Monthly payroll obligation</p><p className="font-display text-2xl font-medium">{fmtMoney(data.monthlyPayrollObligation)}</p></div>
            </Card>
          </div>

          <Card className="p-0">
            <p className={`${sectionLabel} border-b border-black/[.06] px-5 py-3.5 dark:border-white/[.08]`}>Projected balance by month</p>
            <div className="space-y-3 p-5">
              {data.months.map(m => {
                const pct = Math.round((Math.abs(m.projectedBalance) / maxAbs) * 100)
                const negative = m.projectedBalance < 0
                return (
                  <div key={m.month} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-[12.5px] font-semibold text-black/50 dark:text-white/50">{fmtMonthLabel(m.month)}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/[.05] dark:bg-white/[.08]">
                      <div className={`h-full rounded-full ${negative ? 'bg-rose-500' : 'bg-indigo-500'}`} style={{ width: `${Math.max(2, pct)}%` }} />
                    </div>
                    <span className={`w-32 shrink-0 text-right text-[13px] font-semibold ${negative ? 'text-rose-600 dark:text-rose-400' : ''}`}>{fmtMoney(m.projectedBalance)}</span>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card className="p-0">
            <ReportTable
              head={<><th className="px-5 py-2.5">Month</th><th className="px-3 py-2.5 text-right">Projected inflow</th><th className="px-3 py-2.5 text-right">Projected outflow</th><th className="px-5 py-2.5 text-right">Projected balance</th></>}
              rows={data.months.map(m => (
                <tr key={m.month}>
                  <td className="px-5 py-2.5 font-medium">{fmtMonthLabel(m.month)}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-700 dark:text-emerald-400">+{fmtMoney(m.projectedInflow)}</td>
                  <td className="px-3 py-2.5 text-right text-rose-600 dark:text-rose-400">−{fmtMoney(m.projectedOutflow)}</td>
                  <td className={`px-5 py-2.5 text-right font-semibold ${m.projectedBalance < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>{fmtMoney(m.projectedBalance)}</td>
                </tr>
              ))}
            />
          </Card>

          <MethodologyNote text={data.methodology} />
        </div>
      )}
    </div>
  )
}

function fmtMonthLabel(m: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(m)
  if (!match) return m
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

/* ── Phase 21 item 2: per-program profitability ───────────── */

function ProgramProfitabilityView() {
  const { terms, currentTerm } = useAcademic()
  const [termId, setTermId] = useState('')
  const activeTermId = terms.some(t => t.id === termId) ? termId : (currentTerm?.id ?? '')
  const { data, loading, error } = useProgramProfitability(activeTermId)
  const maxProfit = useMemo(() => Math.max(1, ...(data?.programs ?? []).map(p => Math.max(Math.abs(p.income), Math.abs(p.expense)))), [data])

  if (terms.length === 0) return <Card><Empty text="Create terms in Academic Setup first." /></Card>
  return (
    <div className="space-y-4">
      <Field label="Term">
        <select value={activeTermId} onChange={e => setTermId(e.target.value)} className={`${inputCls} max-w-xs`}>
          {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      {loading && <p className="py-8 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {error && <Empty text={error} />}
      {!loading && !error && data && (
        <div className="space-y-5">
          {data.programs.length === 0 ? <Card><Empty text="No classes found for this term's academic year." /></Card> : (
            <Card className="p-0">
              {data.programs.map(p => (
                <div key={`${p.boardId}-${p.gradeId}`} className={rowCls}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><GraduationCap size={17} /></span>
                  <div className="min-w-40 flex-1">
                    <p className="text-[14.5px] font-semibold">{p.boardName} · {p.gradeLabel}</p>
                    <p className={muted}>{p.teacherCount} teacher{p.teacherCount === 1 ? '' : 's'} · {p.weeklyPeriods} periods/week</p>
                  </div>
                  <div className="flex min-w-40 flex-col gap-1">
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="w-16 text-black/45 dark:text-white/45">Income</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[.05] dark:bg-white/[.08]"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(2, Math.round((p.income / maxProfit) * 100))}%` }} /></div>
                      <span className="w-24 text-right font-semibold">{fmtMoney(p.income)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="w-16 text-black/45 dark:text-white/45">Expense</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[.05] dark:bg-white/[.08]"><div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.max(2, Math.round((p.expense / maxProfit) * 100))}%` }} /></div>
                      <span className="w-24 text-right font-semibold">{fmtMoney(p.expense)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {p.profit >= 0 ? <TrendingUp size={14} className="text-emerald-600" /> : <TrendingDown size={14} className="text-rose-500" />}
                    <Pill tone={p.profit >= 0 ? 'green' : 'rose'}>{fmtMoney(p.profit)}</Pill>
                  </div>
                </div>
              ))}
            </Card>
          )}
          <MethodologyNote text={data.methodology} />
        </div>
      )}
    </div>
  )
}

/* ── Phase 21 item 3: concession/scholarship impact ───────── */

function ConcessionImpactView() {
  const { terms, currentTerm } = useAcademic()
  const [termId, setTermId] = useState('')
  const activeTermId = terms.some(t => t.id === termId) ? termId : (currentTerm?.id ?? '')
  const { data, loading, error } = useConcessionImpact(activeTermId || undefined)

  return (
    <div className="space-y-4">
      <Field label="Term">
        <select value={activeTermId} onChange={e => setTermId(e.target.value)} className={`${inputCls} max-w-xs`}>
          <option value="">All terms</option>
          {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      {loading && <p className="py-8 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {error && <Empty text={error} />}
      {!loading && !error && data && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><p className={muted}>Total invoiced</p><p className="mt-1 font-display text-xl font-medium">{fmtMoney(data.totalInvoiced)}</p></Card>
            <Card><p className={muted}>Total concession</p><p className="mt-1 font-display text-xl font-medium text-rose-600 dark:text-rose-400">{fmtMoney(data.totalConcession)}</p></Card>
            <Card><p className={muted}>% of invoiced value</p><p className="mt-1 font-display text-xl font-medium">{data.pctOfInvoiced}%</p></Card>
            <Card><p className={muted}>Students affected</p><p className="mt-1 font-display text-xl font-medium">{data.studentsAffected}</p></Card>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-0">
              <p className={`${sectionLabel} border-b border-black/[.06] px-5 py-3.5 dark:border-white/[.08]`}>Scholarship vs. manual concession</p>
              <div className="p-5">
                <ReportTable
                  head={<><th className="py-2 pr-3">Source</th><th className="py-2 text-right">Amount</th></>}
                  rows={<>
                    <tr><td className="py-2 pr-3">Approved scholarships</td><td className="py-2 text-right">{fmtMoney(data.scholarshipConcession)}</td></tr>
                    <tr><td className="py-2 pr-3">Manual (staff-applied)</td><td className="py-2 text-right">{fmtMoney(data.manualConcession)}</td></tr>
                  </>}
                  footer={<tr className="border-t border-black/[.08] font-semibold dark:border-white/[.1]"><td className="py-2 pr-3">Total</td><td className="py-2 text-right">{fmtMoney(data.totalConcession)}</td></tr>}
                />
              </div>
            </Card>
            <Card className="p-0">
              <p className={`${sectionLabel} border-b border-black/[.06] px-5 py-3.5 dark:border-white/[.08]`}>By scholarship type</p>
              <div className="p-5">
                <ReportTable
                  head={<><th className="py-2 pr-3">Type</th><th className="py-2 text-right">Amount</th></>}
                  rows={data.byScholarshipType.length === 0
                    ? <tr><td colSpan={2} className="py-4 text-black/40 dark:text-white/40">No scholarship-driven concessions this period.</td></tr>
                    : data.byScholarshipType.map(t => <tr key={t.type}><td className="py-2 pr-3">{scholarshipTypeLabel(t.type as ScholarshipType)}</td><td className="py-2 text-right">{fmtMoney(t.amount)}</td></tr>)}
                />
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

export function AccountingReportsMod() {
  const [tab, setTab] = useState<ReportTab>('trial')
  return (
    <div>
      <PageHead title="Accounting Reports" sub="Trial Balance, Profit & Loss and Balance Sheet, computed from the posted ledger" />
      <div className="mb-5 inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
        {REPORT_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${tab === t.id ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
            <FileBarChart2 size={13} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'trial' && <TrialBalanceView />}
      {tab === 'pl' && <ProfitAndLossView />}
      {tab === 'bs' && <BalanceSheetView />}
      {tab === 'cashflow' && <CashFlowForecastView />}
      {tab === 'program' && <ProgramProfitabilityView />}
      {tab === 'concession' && <ConcessionImpactView />}
    </div>
  )
}
