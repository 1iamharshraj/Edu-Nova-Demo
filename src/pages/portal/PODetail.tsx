import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { PackagePlus, ShoppingCart, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { fmtDate } from '@/lib/hooks/useAcademics'
import type { PurchaseOrderRec, PurchaseOrderStatus } from '@/lib/data'
import {
  poCancellable, poDeletable, poEditableDraft, poReceiptTotals, poReceivable, poStatusTone,
  useInventoryItems, usePurchaseOrder, useVendors,
} from '@/lib/hooks/useInventory'
import { Card, Empty, Modal, PageHead, Pill, Progress, inputCls } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Was `PODetailModal` in portal/modules/inventory.tsx — an outer modal with a nested ReceivePOModal and a
// delete-confirm inside it. Converted to a real routed page per .agents/edunova/ui-architecture-fix.md Phase
// C #3: receive-PO and delete-confirm stay as single-level (non-nested) modals ON this page. Data/mutation
// logic is carried over verbatim from the original modal.

const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const rowCls = 'flex flex-wrap items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-5 py-3.5 last:border-0'

function FormActions({ onCancel, onSave, label, disabled }: { onCancel: () => void; onSave: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onSave} disabled={disabled} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{label}</button>
      <button onClick={onCancel} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
    </div>
  )
}

interface ReceiveDraft { lineId: string; label: string; remaining: number; unit: string; qty: string }

function POStatusActions({ po, busy, onOrder, onCancel, onReceive }: {
  po: PurchaseOrderRec; busy: boolean; onOrder: () => void; onCancel: () => void; onReceive: () => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {poEditableDraft(po.status) && (
        <button onClick={onOrder} disabled={busy} className="btn-ink flex items-center gap-1.5 px-4 py-2 text-[12.5px] font-semibold disabled:opacity-40">
          <ShoppingCart size={13} /> Mark as ordered
        </button>
      )}
      {poReceivable(po.status) && (
        <button onClick={onReceive} className="flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-emerald-600">
          <PackagePlus size={13} /> Receive
        </button>
      )}
      {poCancellable(po.status) && (
        <button onClick={onCancel} disabled={busy} className="flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-4 py-2 text-[12.5px] font-semibold text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-40">
          <X size={13} /> Cancel order
        </button>
      )}
    </div>
  )
}

export default function PODetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { db } = useStore()
  const { data: po, loading, error, reload } = usePurchaseOrder(id, !!id)
  const items = useInventoryItems()
  const vendors = useVendors()
  const itemById = useMemo(() => new Map((items.items ?? []).map(i => [i.id, i])), [items.items])
  const vendor = po ? (vendors.items ?? []).find(v => v.id === po.vendorId) : undefined
  const createdBy = po ? db.users.find(u => u.id === po.createdById)?.name : undefined

  const [busy, setBusy] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)

  const setStatus = async (status: PurchaseOrderStatus) => {
    if (!po) return
    setBusy(true)
    try { await api.patch(`/inventory/purchase-orders/${po.id}`, { status }); toast.success(`Order ${status.toLowerCase()}`); reload() }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!po) return
    setBusy(true)
    try { await api.del(`/inventory/purchase-orders/${po.id}`); setDelOpen(false); toast.success('Purchase order deleted'); navigate(-1) }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  // Receive-PO form state
  const [drafts, setDrafts] = useState<ReceiveDraft[] | null>(null)
  const key = po?.id ?? null
  const [syncedFor, setSyncedFor] = useState<string | null>(null)
  if (po && receiveOpen && key !== syncedFor) {
    setSyncedFor(key)
    setDrafts(po.lines.filter(l => l.quantityReceived < l.quantityOrdered).map(l => {
      const item = itemById.get(l.itemId)
      const remaining = l.quantityOrdered - l.quantityReceived
      return { lineId: l.id, label: item?.name ?? 'Item', remaining, unit: item?.unit ?? '', qty: String(remaining) }
    }))
  }
  const setQty = (lineId: string, qty: string) => setDrafts(ds => (ds ?? []).map(d => d.lineId === lineId ? { ...d, qty } : d))
  const closeReceive = () => { setSyncedFor(null); setDrafts(null); setReceiveOpen(false) }
  const submitReceive = async () => {
    if (!po || !drafts) return
    const payload = drafts.filter(d => Number(d.qty) > 0).map(d => ({ lineId: d.lineId, quantityReceived: Math.min(Number(d.qty), d.remaining) }))
    if (payload.length === 0) return
    setBusy(true)
    try {
      await api.post(`/inventory/purchase-orders/${po.id}/receive`, { lines: payload })
      toast.success('Receipt recorded'); closeReceive(); reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const anyPositive = (drafts ?? []).some(d => Number(d.qty) > 0)

  return (
    <PortalPageShell backLabel="Back to purchase orders">
      {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading purchase order…</p>}
      {!loading && (error || !po) && <Empty text={error || 'Purchase order not found.'} />}
      {!loading && po && (
        <div>
          <PageHead title={vendor?.name ?? 'Purchase order'} />
          <div className="space-y-5">
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={poStatusTone(po.status)}>{po.status}</Pill>
                {po.orderedAt && <span className={muted}>Ordered {fmtDate(po.orderedAt)}</span>}
                {po.expectedDate && <span className={muted}>Expected {fmtDate(po.expectedDate)}</span>}
                {createdBy && <span className={muted}>· by {createdBy}</span>}
              </div>

              {po.notes && <p className="mt-3 text-[13.5px] text-black/60 dark:text-white/60">{po.notes}</p>}

              {(() => {
                const totals = poReceiptTotals(po)
                return totals.ordered > 0 ? (
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
                      <span className={muted}>Received</span>
                      <span className="font-semibold">{totals.received} / {totals.ordered} units</span>
                    </div>
                    <Progress pct={totals.pct} />
                  </div>
                ) : null
              })()}
            </Card>

            <POStatusActions po={po} busy={busy} onOrder={() => setStatus('Ordered')} onCancel={() => setStatus('Cancelled')} onReceive={() => setReceiveOpen(true)} />
            {poDeletable(po.status) && (
              <button onClick={() => setDelOpen(true)} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-black/40 hover:text-rose-500 dark:text-white/40">
                <Trash2 size={13} /> Delete this draft
              </button>
            )}

            <div>
              <p className={`${sectionLabel} mb-2`}>Line items</p>
              <Card className="p-0">
                {po.lines.map(l => {
                  const item = itemById.get(l.itemId)
                  const remaining = l.quantityOrdered - l.quantityReceived
                  return (
                    <div key={l.id} className={rowCls}>
                      <div className="min-w-32 flex-1">
                        <p className="text-[14px] font-semibold">{item?.name ?? l.itemId}</p>
                        <p className={muted}>{l.quantityReceived} of {l.quantityOrdered} {item?.unit ?? ''} received{l.unitCost != null ? ` · ₹${l.unitCost}/unit` : ''}</p>
                      </div>
                      <Pill tone={remaining === 0 ? 'green' : l.quantityReceived > 0 ? 'amber' : 'slate'}>{remaining === 0 ? 'Fully received' : `${remaining} remaining`}</Pill>
                    </div>
                  )
                })}
              </Card>
            </div>
          </div>
        </div>
      )}

      <Modal open={receiveOpen} onClose={closeReceive} title="Receive purchase order" wide>
        <div className="space-y-4">
          {(drafts ?? []).length === 0 ? (
            <Empty text="Every line on this order has already been fully received." />
          ) : (
            <div className="space-y-2">
              {(drafts ?? []).map(d => (
                <div key={d.lineId} className="flex flex-wrap items-center gap-3 rounded-2xl border border-black/[.06] dark:border-white/[.08] p-3.5">
                  <div className="min-w-32 flex-1">
                    <p className="text-[14px] font-semibold">{d.label}</p>
                    <p className={muted}>{d.remaining} {d.unit} remaining</p>
                  </div>
                  <input type="number" min={0} max={d.remaining} value={d.qty} onChange={e => setQty(d.lineId, e.target.value)} className={`${inputCls} w-28`} />
                </div>
              ))}
            </div>
          )}
          <FormActions onCancel={closeReceive} onSave={submitReceive} label="Record receipt" disabled={!anyPositive || busy} />
        </div>
      </Modal>

      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="Delete this draft purchase order?">
        <div className="space-y-4">
          <p className="text-[14px] text-black/60 dark:text-white/60">This cannot be undone. Only Draft orders can be deleted.</p>
          <div className="flex gap-3">
            <button onClick={remove} disabled={busy} className="btn-ink flex-1 bg-rose-600 py-3 text-[14px] font-semibold hover:bg-rose-700 disabled:opacity-40">Delete draft</button>
            <button onClick={() => setDelOpen(false)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
          </div>
        </div>
      </Modal>
    </PortalPageShell>
  )
}
