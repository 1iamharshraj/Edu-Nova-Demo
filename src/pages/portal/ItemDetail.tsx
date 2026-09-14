import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AlertTriangle, History, PackageMinus, PackagePlus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { isStaffOrAdmin } from '@/lib/access'
import { fmtDateTime } from '@/lib/hooks/useIdentity'
import { isLowStock, movementDelta, movementTone, useInventoryItem, useInventoryItems, useStockMovements } from '@/lib/hooks/useInventory'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Was `ItemDetailModal` in portal/modules/inventory.tsx — an outer modal with 3 buttons opening sibling
// modals (AdjustStockModal, ItemFormModal for edit, a delete ConfirmModal). Converted to a real routed page
// per .agents/edunova/ui-architecture-fix.md Phase C #2: those 3 actions are now page-level actions with
// single-level (non-nested) modals. Data/mutation logic is carried over verbatim from the original modal.

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

interface ItemForm { name: string; category: string; unit: string; isConsumable: boolean; reorderThreshold: string }

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { db, user } = useStore()
  const canManage = isStaffOrAdmin(user)
  const { data: item, loading, error, reload } = useInventoryItem(id, !!id)
  const movements = useStockMovements(id, !!id)
  // Categories for the edit form's datalist — same source (the full catalog) the original modal used via its
  // parent's `categories` prop.
  const allItems = useInventoryItems()
  const categories = useMemo(() => Array.from(new Set((allItems.items ?? []).map(i => i.category).filter((c): c is string => !!c))).sort(), [allItems.items])

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Adjust stock form state
  const [direction, setDirection] = useState<'increase' | 'decrease'>('decrease')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const resetAdjust = () => { setDirection('decrease'); setQuantity(''); setReason('') }
  const closeAdjust = () => { resetAdjust(); setAdjustOpen(false) }
  const submitAdjust = async () => {
    if (!item || !quantity.trim() || Number(quantity) <= 0) return
    setBusy(true)
    try {
      // The server's `quantity` is signed (positive = add, negative = remove) — `direction` here is only a UI
      // toggle, never sent as its own field.
      const signed = direction === 'increase' ? Number(quantity) : -Number(quantity)
      await api.post(`/inventory/items/${item.id}/adjust`, { quantity: signed, reason: reason.trim() || undefined })
      toast.success('Stock adjusted')
      resetAdjust(); setAdjustOpen(false); movements.reload(); reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  // Edit item form state
  const [form, setForm] = useState<ItemForm>({ name: '', category: '', unit: '', isConsumable: true, reorderThreshold: '' })
  const openEdit = () => {
    if (!item) return
    setForm({ name: item.name, category: item.category ?? '', unit: item.unit, isConsumable: item.isConsumable, reorderThreshold: item.reorderThreshold != null ? String(item.reorderThreshold) : '' })
    setEditOpen(true)
  }
  const saveEdit = async () => {
    if (!item) return
    setBusy(true)
    try {
      // `category`/`reorderThreshold` are nullable-optional server-side — send `null` rather than omitting the
      // key so clearing either on an edit (e.g. unchecking "consumable") actually clears it, instead of a
      // dropped `undefined` key leaving the previous value in place.
      const body = {
        name: form.name.trim(), category: form.category.trim() || null, unit: form.unit.trim(),
        isConsumable: form.isConsumable,
        reorderThreshold: form.isConsumable && form.reorderThreshold.trim() ? Number(form.reorderThreshold) : null,
      }
      await api.patch(`/inventory/items/${item.id}`, body)
      setEditOpen(false); reload(); toast.success('Item updated')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!item) return
    setBusy(true)
    try { await api.del(`/inventory/items/${item.id}`); setDelOpen(false); toast.success('Item deleted'); navigate(-1) }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const sorted = useMemo(() => [...(movements.items ?? [])].sort((a, b) => (b.recordedAt || '').localeCompare(a.recordedAt || '')), [movements.items])

  return (
    <PortalPageShell backLabel="Back to inventory">
      {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading item…</p>}
      {!loading && (error || !item) && <Empty text={error || 'Item not found.'} />}
      {!loading && item && (
        <div>
          <PageHead title={item.name} sub={item.category ?? 'Uncategorized'} />
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              {item.category && <Pill tone="slate">{item.category}</Pill>}
              <Pill tone={item.isConsumable ? 'sky' : 'indigo'}>{item.isConsumable ? 'Consumable' : 'Fixed asset'}</Pill>
              {isLowStock(item) && <Pill tone="rose"><AlertTriangle size={11} /> Low stock</Pill>}
            </div>

            <Card>
              <div className="grid gap-4 sm:grid-cols-3">
                <div><p className={muted}>Current stock</p><p className="font-display text-2xl font-medium">{item.currentStock} <span className="text-[14px] font-sans font-normal text-black/50 dark:text-white/50">{item.unit}</span></p></div>
                {item.isConsumable && <div><p className={muted}>Reorder threshold</p><p className="font-medium">{item.reorderThreshold ?? '—'}</p></div>}
              </div>
            </Card>

            {canManage && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setAdjustOpen(true)} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                  <PackageMinus size={13} /> Adjust stock
                </button>
                <button onClick={openEdit} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
                  <Pencil size={13} /> Edit item
                </button>
                <button onClick={() => setDelOpen(true)} className="flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-2 text-[12.5px] font-semibold text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20">
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            )}

            <div>
              <p className={`${sectionLabel} mb-2 flex items-center gap-1.5`}><History size={13} /> Stock movement history</p>
              <Card className="p-0">
                {movements.loading && <div className="p-5 text-center text-[13px] text-black/40 dark:text-white/40">Loading history…</div>}
                {movements.error && <div className="p-5"><Empty text={movements.error} /></div>}
                {!movements.loading && !movements.error && sorted.length === 0 && <div className="p-5"><Empty text="No stock movements recorded yet." /></div>}
                {sorted.map(m => {
                  const who = db.users.find(u => u.id === m.recordedById)?.name ?? 'Someone'
                  const delta = movementDelta(m)
                  return (
                    <div key={m.id} className={rowCls}>
                      <Pill tone={movementTone(m)}>{m.type}</Pill>
                      <div className="min-w-32 flex-1">
                        <p className="text-[14px] font-semibold">{delta > 0 ? '+' : ''}{delta} {item.unit}{m.reason ? ` · ${m.reason}` : ''}</p>
                        <p className={muted}>{fmtDateTime(m.recordedAt)} · by {who}{m.relatedPoId ? ' · via purchase order' : ''}</p>
                      </div>
                    </div>
                  )
                })}
              </Card>
            </div>
          </div>
        </div>
      )}

      {item && (
        <Modal open={adjustOpen} onClose={closeAdjust} title={`Adjust stock — ${item.name}`}>
          <div className="space-y-4">
            <p className={muted}>Current stock: <span className="font-semibold text-black dark:text-white">{item.currentStock} {item.unit}</span></p>
            <Field label="Direction">
              <div className="inline-flex w-full rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
                {(['decrease', 'increase'] as const).map(d => (
                  <button key={d} onClick={() => setDirection(d)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${direction === d ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
                    {d === 'increase' ? <PackagePlus size={14} /> : <PackageMinus size={14} />} {d === 'increase' ? 'Increase' : 'Decrease'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Quantity"><input type="number" min={1} value={quantity} onChange={e => setQuantity(e.target.value)} className={inputCls} autoFocus /></Field>
            <Field label="Reason"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Damaged, Annual count correction, Issued to Science Lab" className={inputCls} /></Field>
            <FormActions onCancel={closeAdjust} onSave={submitAdjust} label="Record adjustment" disabled={!quantity.trim() || Number(quantity) <= 0 || busy} />
          </div>
        </Modal>
      )}

      {item && (
        <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit ${item.name}`}>
          <div className="space-y-4">
            <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} autoFocus /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Optional" className={inputCls} list="inv-categories" />
                <datalist id="inv-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
              </Field>
              <Field label="Unit"><input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="e.g. pcs, box, kg" className={inputCls} /></Field>
            </div>
            <label className="flex items-center gap-2 text-[13.5px]">
              <input type="checkbox" checked={form.isConsumable} onChange={e => setForm({ ...form, isConsumable: e.target.checked })} />
              Consumable (gets used up and restocked — uncheck for a fixed asset like a projector)
            </label>
            {form.isConsumable && (
              <Field label="Reorder threshold"><input type="number" min={0} value={form.reorderThreshold} onChange={e => setForm({ ...form, reorderThreshold: e.target.value })} placeholder="Optional — enables the low-stock warning" className={inputCls} /></Field>
            )}
            <FormActions onCancel={() => setEditOpen(false)} onSave={saveEdit} label="Save changes" disabled={!form.name.trim() || !form.unit.trim() || busy} />
          </div>
        </Modal>
      )}

      <Modal open={delOpen} onClose={() => setDelOpen(false)} title={`Delete ${item?.name ?? 'item'}?`}>
        <div className="space-y-4">
          <p className="text-[14px] text-black/60 dark:text-white/60">This cannot be undone. Items with recorded stock history may not be deletable.</p>
          <div className="flex gap-3">
            <button onClick={remove} disabled={busy} className="btn-ink flex-1 bg-rose-600 py-3 text-[14px] font-semibold hover:bg-rose-700 disabled:opacity-40">Delete item</button>
            <button onClick={() => setDelOpen(false)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
          </div>
        </div>
      </Modal>
    </PortalPageShell>
  )
}
