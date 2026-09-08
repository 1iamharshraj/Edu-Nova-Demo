import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, BadgeCheck, Calculator, CheckCircle2, ChevronRight, FileBarChart2, Lock, NotebookPen, Pencil, Plus, Scale, Trash2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import type { AccountRec, AccountType, JournalEntryRec, JournalSourceType } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { isoDate } from '@/lib/hooks/useTimetable'
import {
  ACCOUNT_TYPES, DEBIT_NORMAL_TYPES, JOURNAL_SOURCE_TYPES, accountTypeTone, computeBalance, fmtMoney, isSystemSourced,
  sourceLabel, useAccounts, useBalanceSheet, useJournalEntries, useProfitAndLoss, useTrialBalance,
} from '@/lib/hooks/useAccounting'
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

function FormActions({ onCancel, onSave, label, disabled }: { onCancel: () => void; onSave: () => void; label: string; disabled?: boolean }) {
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

interface LineDraft { accountId: string; debit: string; credit: string }
const emptyLine = (): LineDraft => ({ accountId: '', debit: '', credit: '' })

/** Live, float-safe balance readout for the line editor — computeBalance() sums in integer paise so this
 * never trusts a naive floating-point `===` on rupee amounts. */
function BalanceStrip({ lines }: { lines: LineDraft[] }) {
  const { debitPaise, creditPaise, balanced, diffPaise } = computeBalance(lines)
  const hasAmounts = debitPaise > 0 || creditPaise > 0
  const tone = !hasAmounts ? 'slate' : balanced ? 'balanced' : 'unbalanced'
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 ${
      tone === 'balanced' ? 'bg-emerald-50 dark:bg-emerald-500/10' : tone === 'unbalanced' ? 'bg-rose-50 dark:bg-rose-500/10' : 'bg-black/[.04] dark:bg-white/[.06]'
    }`}>
      <div className="flex gap-5 text-[13.5px]">
        <div><span className={muted}>Debit</span> <span className="font-semibold">{fmtMoney(debitPaise / 100)}</span></div>
        <div><span className={muted}>Credit</span> <span className="font-semibold">{fmtMoney(creditPaise / 100)}</span></div>
      </div>
      <div className={`flex items-center gap-1.5 text-[13.5px] font-semibold ${
        tone === 'balanced' ? 'text-emerald-700 dark:text-emerald-400' : tone === 'unbalanced' ? 'text-rose-600 dark:text-rose-400' : 'text-black/40 dark:text-white/40'
      }`}>
        {tone === 'balanced' && <><CheckCircle2 size={15} /> Balanced</>}
        {tone === 'unbalanced' && <><Scale size={15} /> Out of balance by {fmtMoney(Math.abs(diffPaise) / 100)}</>}
        {tone === 'slate' && 'Enter debit and credit amounts'}
      </div>
    </div>
  )
}

function NewEntryModal({ open, accounts, onClose, onCreated }: { open: boolean; accounts: AccountRec[]; onClose: () => void; onCreated: () => void }) {
  const [date, setDate] = useState(isoDate(new Date()))
  const [memo, setMemo] = useState('')
  const [reference, setReference] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()])
  const [busy, setBusy] = useState(false)

  const activeAccounts = useMemo(() => accounts.filter(a => a.active).sort((a, b) => a.code.localeCompare(b.code)), [accounts])
  const byType = useMemo(() => {
    const m = new Map<AccountType, AccountRec[]>()
    for (const a of activeAccounts) { if (!m.has(a.type)) m.set(a.type, []); m.get(a.type)!.push(a) }
    return m
  }, [activeAccounts])

  const reset = () => { setDate(isoDate(new Date())); setMemo(''); setReference(''); setLines([emptyLine(), emptyLine()]) }
  const close = () => { reset(); onClose() }

  const setLine = (idx: number, patch: Partial<LineDraft>) => setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l))
  // A line is a debit XOR a credit — typing into one clears the other so a stray leftover value can never
  // silently count toward both columns.
  const setDebit = (idx: number, v: string) => setLine(idx, { debit: v, credit: v.trim() ? '' : lines[idx].credit })
  const setCredit = (idx: number, v: string) => setLine(idx, { credit: v, debit: v.trim() ? '' : lines[idx].debit })
  const removeLine = (idx: number) => setLines(ls => ls.filter((_, i) => i !== idx))

  const usableLines = lines.filter(l => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0))
  const { balanced, debitPaise } = computeBalance(usableLines)
  const canSubmit = !!date && !!memo.trim() && usableLines.length >= 2 && balanced && debitPaise > 0

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      await api.post('/accounting/journal-entries', {
        date, memo: memo.trim(), reference: reference.trim() || undefined,
        lines: usableLines.map(l => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
      })
      toast.success('Journal entry posted'); reset(); onClose(); onCreated()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={close} title="New manual journal entry" wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Reference"><input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional — e.g. Invoice INV-2026-042" className={inputCls} /></Field>
        </div>
        <Field label="Memo"><input value={memo} onChange={e => setMemo(e.target.value)} placeholder="What is this entry for?" className={inputCls} autoFocus /></Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className={sectionLabel}>Lines</p>
            <button onClick={() => setLines(ls => [...ls, emptyLine()])} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
              <Plus size={13} /> Add line
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((l, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/[.06] dark:border-white/[.08] p-3">
                <select value={l.accountId} onChange={e => setLine(idx, { accountId: e.target.value })} className={`${inputCls} min-w-[200px] flex-1`}>
                  <option value="">Select account</option>
                  {ACCOUNT_TYPES.map(t => (byType.get(t)?.length ? (
                    <optgroup key={t} label={t}>
                      {byType.get(t)!.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                    </optgroup>
                  ) : null))}
                </select>
                <input type="number" min={0} step="0.01" value={l.debit} onChange={e => setDebit(idx, e.target.value)} placeholder="Debit" className={`${inputCls} w-32`} />
                <input type="number" min={0} step="0.01" value={l.credit} onChange={e => setCredit(idx, e.target.value)} placeholder="Credit" className={`${inputCls} w-32`} />
                {lines.length > 2 && (
                  <button onClick={() => removeLine(idx)} className="rounded-full p-2 text-black/40 hover:bg-rose-50 hover:text-rose-500 dark:text-white/40 dark:hover:bg-rose-500/10" aria-label="Remove line"><X size={15} /></button>
                )}
              </div>
            ))}
          </div>
        </div>

        <BalanceStrip lines={lines} />

        <FormActions onCancel={close} onSave={submit} label="Post entry" disabled={!canSubmit || busy} />
      </div>
    </Modal>
  )
}

function EntryDetailModal({ entry, accounts, onClose }: { entry: JournalEntryRec | null; accounts: AccountRec[]; onClose: () => void }) {
  const byId = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])
  if (!entry) return null
  const totalDebit = entry.lines.reduce((a, l) => a + (Number(l.debit) || 0), 0)
  const totalCredit = entry.lines.reduce((a, l) => a + (Number(l.credit) || 0), 0)
  return (
    <Modal open={!!entry} onClose={onClose} title={entry.memo} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {isSystemSourced(entry.sourceType)
            ? <Pill tone="slate"><Lock size={10} /> System · {sourceLabel(entry.sourceType)}</Pill>
            : <Pill tone="indigo"><BadgeCheck size={10} /> Manual</Pill>}
          <span className={muted}>{fmtDate(entry.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          {entry.reference && <span className={muted}>· {entry.reference}</span>}
        </div>
        <Card className="p-0">
          {entry.lines.map(l => {
            const acc = byId.get(l.accountId)
            return (
              <div key={l.id} className={rowCls}>
                <div className="min-w-32 flex-1">
                  <p className="text-[14px] font-semibold">{acc ? `${acc.code} · ${acc.name}` : l.accountId}</p>
                </div>
                <span className="w-24 text-right text-[13.5px] font-semibold">{Number(l.debit) > 0 ? fmtMoney(Number(l.debit)) : ''}</span>
                <span className="w-24 text-right text-[13.5px] font-semibold">{Number(l.credit) > 0 ? fmtMoney(Number(l.credit)) : ''}</span>
              </div>
            )
          })}
          <div className={`${rowCls} bg-black/[.02] dark:bg-white/[.03] font-semibold`}>
            <div className="min-w-32 flex-1">Total</div>
            <span className="w-24 text-right text-[13.5px]">{fmtMoney(totalDebit)}</span>
            <span className="w-24 text-right text-[13.5px]">{fmtMoney(totalCredit)}</span>
          </div>
        </Card>
      </div>
    </Modal>
  )
}

export function JournalMod() {
  const accounts = useAccounts()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [accountId, setAccountId] = useState('')
  const [sourceType, setSourceType] = useState<JournalSourceType | ''>('')
  const entries = useJournalEntries({ from: from || undefined, to: to || undefined, accountId: accountId || undefined, sourceType: sourceType || undefined })
  const [selected, setSelected] = useState<JournalEntryRec | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const sorted = useMemo(() => [...(entries.items ?? [])].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '')), [entries.items])
  const activeAccounts = useMemo(() => (accounts.items ?? []).sort((a, b) => a.code.localeCompare(b.code)), [accounts.items])

  return (
    <div>
      <PageHead title="Journal" sub="Every posted entry — auto-generated from Fees/Payroll, plus manual entries">
        <button onClick={() => setNewOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
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
            <button key={e.id} onClick={() => setSelected(e)} className={`${rowCls} w-full text-left hover:bg-black/[.02] dark:hover:bg-white/[.03]`}>
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

      <NewEntryModal open={newOpen} accounts={accounts.items ?? []} onClose={() => setNewOpen(false)} onCreated={() => entries.reload()} />
      <EntryDetailModal entry={selected} accounts={accounts.items ?? []} onClose={() => setSelected(null)} />
    </div>
  )
}

/* ── Reports ───────────────────────────────────────────── */

type ReportTab = 'trial' | 'pl' | 'bs'
const REPORT_TABS: { id: ReportTab; label: string }[] = [
  { id: 'trial', label: 'Trial Balance' }, { id: 'pl', label: 'Profit & Loss' }, { id: 'bs', label: 'Balance Sheet' },
]

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
    </div>
  )
}
