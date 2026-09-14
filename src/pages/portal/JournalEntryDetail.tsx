import { useMemo } from 'react'
import { useParams } from 'react-router'
import { BadgeCheck, Lock } from 'lucide-react'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { fmtMoney, isSystemSourced, sourceLabel, useAccounts, useJournalEntry } from '@/lib/hooks/useAccounting'
import { Card, Empty, PageHead, Pill } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Was `EntryDetailModal` in portal/modules/accounting.tsx. Converted to a real routed page,
// `/portal/accounting/journal/:id`, per .agents/edunova/ui-architecture-fix.md Phase D. Read-only —
// journal entries are immutable once posted, so this page carries no mutation logic, just the same
// line-by-line debit/credit breakdown the modal showed.

const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
const rowCls = 'flex flex-wrap items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-5 py-3.5 last:border-0'

export default function JournalEntryDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: entry, loading, error } = useJournalEntry(id, !!id)
  const accounts = useAccounts()
  const byId = useMemo(() => new Map((accounts.items ?? []).map(a => [a.id, a])), [accounts.items])

  const totalDebit = entry?.lines.reduce((a, l) => a + (Number(l.debit) || 0), 0) ?? 0
  const totalCredit = entry?.lines.reduce((a, l) => a + (Number(l.credit) || 0), 0) ?? 0

  return (
    <PortalPageShell backLabel="Back to journal">
      {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading journal entry…</p>}
      {!loading && (error || !entry) && <Empty text={error || 'Journal entry not found.'} />}
      {!loading && entry && (
        <div>
          <PageHead title={entry.memo} />
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
        </div>
      )}
    </PortalPageShell>
  )
}
