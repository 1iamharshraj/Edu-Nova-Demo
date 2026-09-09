import { useState } from 'react'
import { useParams } from 'react-router'
import { Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import type { FeeStructureLine } from '@/lib/data'
import { isoDate } from '@/lib/hooks/useTimetable'
import { useFeeHeads, useFeeStructures } from '@/lib/hooks/useFinance'
import { InstallmentPlansSection, LinesEditor } from '@/portal/modules/finance'
import { Card, Empty, Field, PageHead, inputCls } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Was the fee-structure editor `<Modal>` inside `StructuresTab` in portal/modules/finance.tsx — opened by
// clicking a class/term cell in the fee-structures grid. It's inherently a multi-line-item editor (per fee-
// head amounts) plus, once a structure exists, an installment-plans sub-section and a "generate invoices"
// action, so per .agents/edunova/ui-architecture-fix.md Phase D it becomes a real page rather than a modal.
// Route shape: `/portal/finance/fee-structures/:classId/:termId` (not `/:id`) — a fee structure is keyed by
// the (class, term) pair and may not exist yet (the "+ Set" cells), so there is no structure id to route on
// until one is saved; classId+termId is the only stable identity the grid cell always has, whether creating
// or editing. Data/mutation logic carried over verbatim from the original modal.

const dangerBtn = 'flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-2 text-[13px] font-semibold text-rose-500 hover:bg-rose-100 disabled:opacity-40'
const primaryBtn = 'flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40'

export default function FeeStructureDetail() {
  const { classId, termId } = useParams<{ classId: string; termId: string }>()
  const { classes, terms } = useAcademic()
  const structures = useFeeStructures()
  const heads = useFeeHeads()

  const cls = classes.find(c => c.id === classId)
  const term = terms.find(t => t.id === termId)
  const existing = (structures.items ?? []).find(s => s.classId === classId && s.termId === termId)

  // The editor form (dueDate/lines/genPlanId) initializes from `existing` once the structures list has
  // loaded — mirrors the original modal's `open()`, which ran synchronously off already-loaded data; here
  // the data loads async on page mount, so this re-syncs on the first load (and if the resolved `existing`
  // record changes identity, e.g. after a save) rather than on every render.
  const [initedFor, setInitedFor] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState('')
  const [lines, setLines] = useState<FeeStructureLine[]>([])
  const [genPlanId, setGenPlanId] = useState('')
  const initKey = `${classId}|${termId}|${existing?.id ?? ''}`
  if (!structures.loading && initedFor !== initKey) {
    setInitedFor(initKey)
    setDueDate(existing?.dueDate ?? term?.startDate ?? isoDate(new Date()))
    setLines(existing?.lines.map(l => ({ ...l })) ?? [])
    setGenPlanId('')
  }

  const [busy, setBusy] = useState<string | null>(null)

  const save = async () => {
    if (!classId || !termId) return
    setBusy('save')
    try {
      const body = { classId, termId, dueDate, lines: lines.filter(l => l.amount > 0) }
      if (existing) await api.patch(`/fees/structures/${existing.id}`, body)
      else await api.post('/fees/structures', body)
      structures.reload()
      toast.success(`Fee structure saved for ${cls?.label ?? ''} · ${term?.name ?? ''}`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const remove = async () => {
    if (!existing || !confirm('Delete this fee structure? Invoices already generated are kept.')) return
    setBusy('delete')
    try { await api.del(`/fees/structures/${existing.id}`); structures.reload(); toast.success('Fee structure deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const generate = async () => {
    if (!existing) return
    setBusy('generate')
    try {
      const res = await api.post<{ created?: number; skipped?: number }>(`/fees/structures/${existing.id}/generate`, genPlanId ? { installmentPlanId: genPlanId } : {})
      const created = res?.created ?? 0, skipped = res?.skipped ?? 0
      toast.success(`${created} invoice${created === 1 ? '' : 's'} created · ${skipped} skipped (already invoiced)`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <PortalPageShell backLabel="Back to fee setup">
      {structures.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading fee structure…</p>}
      {!structures.loading && (!cls || !term) && <Empty text="Class or term not found." />}
      {!structures.loading && cls && term && (
        <div>
          <PageHead title={`${cls.label} · ${term.name}`} sub={existing ? 'Edit this fee structure' : 'Set up a fee structure for this class and term'} />
          <Card>
            <div className="space-y-4">
              <Field label="Due date"><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} /></Field>
              <Field label="Lines"><LinesEditor lines={lines} heads={heads.items ?? []} onChange={setLines} /></Field>
              {existing && (
                <div className="rounded-2xl border border-black/[.06] dark:border-white/[.08] p-4">
                  <InstallmentPlansSection feeStructureId={existing.id} planId={genPlanId} onPlanChange={setGenPlanId} />
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <button onClick={save} disabled={!!busy || !dueDate || lines.length === 0} className="btn-ink flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">{busy === 'save' ? 'Saving…' : 'Save structure'}</button>
                {existing && <button onClick={generate} disabled={!!busy} className={primaryBtn}><Play size={13} /> {busy === 'generate' ? 'Generating…' : 'Generate invoices'}</button>}
                {existing && <button onClick={remove} disabled={!!busy} className={dangerBtn}><Trash2 size={13} /></button>}
              </div>
              {existing && <p className="text-[12.5px] text-black/45 dark:text-white/45">Generate raises one invoice per active student in {cls.label} (or one per installment if a plan is selected above); students/installments that already have an invoice for this structure are skipped.</p>}
            </div>
          </Card>
        </div>
      )}
    </PortalPageShell>
  )
}
