import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { CheckCircle2, Plus, Scale, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import type { AccountRec, AccountType } from '@/lib/data'
import { isoDate } from '@/lib/hooks/useTimetable'
import { ACCOUNT_TYPES, computeBalance, fmtMoney, useAccounts } from '@/lib/hooks/useAccounting'
import { FormActions } from '@/portal/modules/accounting'
import { Card, Field, PageHead, inputCls } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Was `NewEntryModal` in portal/modules/accounting.tsx. A manual journal entry is inherently a multi-line
// debit/credit builder, so per .agents/edunova/ui-architecture-fix.md Phase D it's now a real page,
// `/portal/accounting/journal/new`. Data/mutation logic and the balance-check UI carried over verbatim.

const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const muted = 'text-[12.5px] text-black/50 dark:text-white/50'

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

export default function JournalEntryNew() {
  const navigate = useNavigate()
  const accounts = useAccounts()
  const [date, setDate] = useState(isoDate(new Date()))
  const [memo, setMemo] = useState('')
  const [reference, setReference] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()])
  const [busy, setBusy] = useState(false)

  const activeAccounts = useMemo(() => (accounts.items ?? []).filter((a: AccountRec) => a.active).sort((a, b) => a.code.localeCompare(b.code)), [accounts.items])
  const byType = useMemo(() => {
    const m = new Map<AccountType, AccountRec[]>()
    for (const a of activeAccounts) { if (!m.has(a.type)) m.set(a.type, []); m.get(a.type)!.push(a) }
    return m
  }, [activeAccounts])

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
      toast.success('Journal entry posted')
      navigate(-1)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <PortalPageShell backLabel="Back to journal">
      <PageHead title="New manual journal entry" sub="Every line must post to an account, and total debits must equal total credits" />
      <Card>
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

          <FormActions onCancel={() => navigate(-1)} onSave={submit} label="Post entry" disabled={!canSubmit || busy} />
        </div>
      </Card>
    </PortalPageShell>
  )
}
