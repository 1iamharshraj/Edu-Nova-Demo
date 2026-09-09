import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import type { PurchaseOrderRec } from '@/lib/data'
import { useInventoryItems, useVendors } from '@/lib/hooks/useInventory'
import { Card, Field, PageHead, inputCls } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Was `CreatePOModal` inside inventory.tsx — inherently a multi-line-item form (item/qty/unit-cost per row).
// Converted to a routed page per .agents/edunova/ui-architecture-fix.md Phase D #5. Data/mutation logic is
// carried over verbatim from the original modal. On success this navigates straight to the new PO's detail
// page (`/portal/inventory/purchase-orders/:id`, already routed from Phase C) rather than back to the list —
// a small UX improvement now that there's a real URL to land on.

const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'

interface POLineDraft { itemId: string; quantityOrdered: string; unitCost: string }
const emptyLine = (): POLineDraft => ({ itemId: '', quantityOrdered: '', unitCost: '' })

export default function PurchaseOrderNew() {
  const navigate = useNavigate()
  const vendors = useVendors()
  const items = useInventoryItems()

  const [vendorId, setVendorId] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<POLineDraft[]>([emptyLine()])
  const [busy, setBusy] = useState(false)

  const setLine = (idx: number, patch: Partial<POLineDraft>) => setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l))
  const removeLine = (idx: number) => setLines(ls => ls.filter((_, i) => i !== idx))
  const validLines = lines.filter(l => l.itemId && Number(l.quantityOrdered) > 0)

  const save = async () => {
    if (!vendorId || validLines.length === 0) return
    setBusy(true)
    try {
      const res = await api.post<{ item: PurchaseOrderRec }>('/inventory/purchase-orders', {
        vendorId, expectedDate: expectedDate || undefined, notes: notes.trim() || undefined,
        lines: validLines.map(l => ({ itemId: l.itemId, quantityOrdered: Number(l.quantityOrdered), unitCost: l.unitCost.trim() ? Number(l.unitCost) : undefined })),
      })
      toast.success('Purchase order created')
      if (res?.item?.id) navigate(`/portal/inventory/purchase-orders/${res.item.id}`)
      else navigate(-1)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <PortalPageShell backLabel="Back to purchase orders">
      <PageHead title="New purchase order" sub="Order inventory from a vendor, then receive it in full or in part" />
      <Card>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor">
              <select value={vendorId} onChange={e => setVendorId(e.target.value)} className={inputCls}>
                <option value="">Select a vendor</option>
                {(vendors.items ?? []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>
            <Field label="Expected date"><input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optional" className={inputCls} /></Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className={sectionLabel}>Line items</p>
              <button onClick={() => setLines(ls => [...ls, emptyLine()])} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                <Plus size={13} /> Add line
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((l, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/[.06] dark:border-white/[.08] p-3">
                  <select value={l.itemId} onChange={e => setLine(idx, { itemId: e.target.value })} className={`${inputCls} min-w-[160px] flex-1`}>
                    <option value="">Select item</option>
                    {(items.items ?? []).map(it => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}
                  </select>
                  <input type="number" min={1} value={l.quantityOrdered} onChange={e => setLine(idx, { quantityOrdered: e.target.value })} placeholder="Qty" className={`${inputCls} w-24`} />
                  <input type="number" min={0} value={l.unitCost} onChange={e => setLine(idx, { unitCost: e.target.value })} placeholder="Unit cost (optional)" className={`${inputCls} w-40`} />
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(idx)} className="rounded-full p-2 text-black/40 hover:bg-rose-50 hover:text-rose-500 dark:text-white/40 dark:hover:bg-rose-500/10" aria-label="Remove line"><X size={15} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={!vendorId || validLines.length === 0 || busy} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Creating…' : 'Create purchase order'}</button>
            <button onClick={() => navigate(-1)} disabled={busy} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Cancel</button>
          </div>
        </div>
      </Card>
    </PortalPageShell>
  )
}
