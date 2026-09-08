import { useMemo, useState } from 'react'
import {
  AlertTriangle, Boxes, ChevronRight, History, Mail, MapPin, Package, PackageMinus, PackagePlus, Pencil, Phone,
  Plus, Search, ShoppingCart, Trash2, Truck, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { isStaffOrAdmin } from '@/lib/access'
import type { InventoryItemRec, PurchaseOrderRec, PurchaseOrderStatus, VendorRec } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { fmtDateTime } from '@/lib/hooks/useIdentity'
import {
  PURCHASE_ORDER_STATUSES, isLowStock, movementDelta, movementTone, poCancellable, poDeletable, poEditableDraft,
  poReceiptTotals, poReceivable, poStatusTone, useInventoryItems, useLowStockItems, usePurchaseOrders, useStockMovements, useVendors,
} from '@/lib/hooks/useInventory'
import { Card, Empty, Field, Modal, PageHead, Pill, Progress, inputCls } from '../ui'

// Phase 16 — Inventory / Procurement (frontend). Catalog (staff/admin/teacher read, staff/admin write) with a
// low-stock section and per-item stock-movement timeline + adjust action, Purchase Orders (staff/admin: create
// against a vendor, Draft → Ordered, partial/full receive) and a simple Vendors CRUD list (staff/admin).
//
// Endpoint paths and request/response shapes are reconciled against the live
// server/src/modules/inventory/{router,schema,service}.ts — see useInventory.ts's header comment for the
// specific points worth knowing (undecorated responses, the signed Adjustment quantity, the wrapped receive
// body). See .agents/edunova/phase-16-inventory.md

const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
const sectionLabel = 'text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const rowCls = 'flex flex-wrap items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-5 py-3.5 last:border-0'
const iconBtn = 'rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-black/[.05]'
const dangerBtn = 'rounded-full bg-rose-50 dark:bg-rose-500/10 p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-40'
const cardHead = 'flex flex-wrap items-center justify-between gap-3 border-b border-black/[.06] dark:border-white/[.08] px-5 py-3.5'

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

/* ── Catalog: browse + manage items, low-stock, item detail/timeline/adjust ─── */

interface ItemForm { name: string; category: string; unit: string; isConsumable: boolean; reorderThreshold: string }
const emptyItemForm = (): ItemForm => ({ name: '', category: '', unit: '', isConsumable: true, reorderThreshold: '' })

const STOCK_TONE = (item: Pick<InventoryItemRec, 'isConsumable' | 'reorderThreshold' | 'currentStock' | 'lowStock'>): 'rose' | 'green' | 'indigo' =>
  isLowStock(item) ? 'rose' : item.isConsumable ? 'green' : 'indigo'

function AdjustStockModal({ item, onClose, onDone }: { item: InventoryItemRec | null; onClose: () => void; onDone: () => void }) {
  const [direction, setDirection] = useState<'increase' | 'decrease'>('decrease')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => { setDirection('decrease'); setQuantity(''); setReason('') }
  const close = () => { reset(); onClose() }

  const submit = async () => {
    if (!item || !quantity.trim() || Number(quantity) <= 0) return
    setBusy(true)
    try {
      // The server's `quantity` is signed (positive = add, negative = remove) — `direction` here is only a UI
      // toggle, never sent as its own field.
      const signed = direction === 'increase' ? Number(quantity) : -Number(quantity)
      await api.post(`/inventory/items/${item.id}/adjust`, { quantity: signed, reason: reason.trim() || undefined })
      toast.success('Stock adjusted')
      reset(); onClose(); onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  if (!item) return null
  return (
    <Modal open={!!item} onClose={close} title={`Adjust stock — ${item.name}`}>
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
        <FormActions onCancel={close} onSave={submit} label="Record adjustment" disabled={!quantity.trim() || Number(quantity) <= 0 || busy} />
      </div>
    </Modal>
  )
}

function ItemFormModal({ open, editing, categories, onClose, onSaved }: {
  open: boolean; editing: InventoryItemRec | null; categories: string[]; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<ItemForm>(emptyItemForm())
  const [busy, setBusy] = useState(false)
  // Reset the form on every closed→open transition (not just when `editing`'s id changes) — otherwise
  // re-opening "Add item" after a successful submit would show the just-submitted values again, since this
  // component stays mounted (with `open: false`) between opens rather than remounting.
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setForm(editing
      ? { name: editing.name, category: editing.category ?? '', unit: editing.unit, isConsumable: editing.isConsumable, reorderThreshold: editing.reorderThreshold != null ? String(editing.reorderThreshold) : '' }
      : emptyItemForm())
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  const save = async () => {
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
      if (editing) await api.patch(`/inventory/items/${editing.id}`, body)
      else await api.post('/inventory/items', body)
      onSaved(); toast.success(editing ? 'Item updated' : 'Item added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${editing.name}` : 'New inventory item'}>
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
        <FormActions onCancel={onClose} onSave={save} label={editing ? 'Save changes' : 'Add item'} disabled={!form.name.trim() || !form.unit.trim() || busy} />
      </div>
    </Modal>
  )
}

function ItemDetailModal({ item, categories, onClose, onChanged, canManage }: {
  item: InventoryItemRec | null; categories: string[]; onClose: () => void; onChanged: () => void; canManage: boolean
}) {
  const { db } = useStore()
  const movements = useStockMovements(item?.id, !!item)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const sorted = useMemo(() => [...(movements.items ?? [])].sort((a, b) => (b.recordedAt || '').localeCompare(a.recordedAt || '')), [movements.items])

  const remove = async () => {
    if (!item) return
    setBusy(true)
    try { await api.del(`/inventory/items/${item.id}`); setDelOpen(false); onClose(); onChanged(); toast.success('Item deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  if (!item) return null
  const low = isLowStock(item)
  return (
    <Modal open={!!item} onClose={onClose} title={item.name} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {item.category && <Pill tone="slate">{item.category}</Pill>
          }<Pill tone={item.isConsumable ? 'sky' : 'indigo'}>{item.isConsumable ? 'Consumable' : 'Fixed asset'}</Pill>
          {low && <Pill tone="rose"><AlertTriangle size={11} /> Low stock</Pill>}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div><p className={muted}>Current stock</p><p className="font-display text-2xl font-medium">{item.currentStock} <span className="text-[14px] font-sans font-normal text-black/50 dark:text-white/50">{item.unit}</span></p></div>
          {item.isConsumable && <div><p className={muted}>Reorder threshold</p><p className="font-medium">{item.reorderThreshold ?? '—'}</p></div>}
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setAdjustOpen(true)} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
              <PackageMinus size={13} /> Adjust stock
            </button>
            <button onClick={() => setEditOpen(true)} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
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

      <AdjustStockModal item={adjustOpen ? item : null} onClose={() => setAdjustOpen(false)} onDone={() => { movements.reload(); onChanged() }} />
      <ItemFormModal open={editOpen} editing={item} categories={categories} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); onChanged() }} />
      <ConfirmModal open={delOpen} onClose={() => setDelOpen(false)} title={`Delete ${item.name}?`}
        body="This cannot be undone. Items with recorded stock history may not be deletable." action="Delete item" busy={busy} onConfirm={remove} />
    </Modal>
  )
}

export function InventoryCatalogMod() {
  const { user } = useStore()
  const canManage = isStaffOrAdmin(user)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const items = useInventoryItems({ q: search.trim() || undefined, category: category || undefined })
  const lowStock = useLowStockItems()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const categories = useMemo(() => Array.from(new Set((items.items ?? []).map(i => i.category).filter((c): c is string => !!c))).sort(), [items.items])
  const sorted = useMemo(() => [...(items.items ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [items.items])
  const selected = selectedId ? (items.items ?? []).find(i => i.id === selectedId) ?? (lowStock.items ?? []).find(i => i.id === selectedId) ?? null : null

  const reload = () => { items.reload(); lowStock.reload() }

  return (
    <div>
      <PageHead title="Inventory" sub="Catalog, stock levels and low-stock alerts">
        {canManage && (
          <button onClick={() => setAddOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
            <Plus size={15} /> Add item
          </button>
        )}
      </PageHead>

      {(lowStock.items ?? []).length > 0 && (
        <Card className="mb-5 p-0">
          <div className={`${cardHead} bg-rose-50/60 dark:bg-rose-500/[.06]`}>
            <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              <AlertTriangle size={14} /> Low stock — {(lowStock.items ?? []).length} item{(lowStock.items ?? []).length === 1 ? '' : 's'} at or below reorder level
            </p>
          </div>
          <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
            {(lowStock.items ?? []).map(i => (
              <button key={i.id} onClick={() => setSelectedId(i.id)} className={`${rowCls} w-full text-left hover:bg-black/[.02] dark:hover:bg-white/[.03]`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-500/10 text-rose-500"><Package size={16} /></span>
                <div className="min-w-32 flex-1">
                  <p className="text-[14px] font-semibold">{i.name}</p>
                  <p className={muted}>{i.category ?? 'Uncategorized'}</p>
                </div>
                <Pill tone="rose">{i.currentStock} of {i.reorderThreshold} {i.unit}</Pill>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#14141f] px-3 py-2">
          <Search size={16} className="text-black/40 dark:text-white/40" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items by name" className="flex-1 bg-transparent text-[14px] outline-none" />
        </div>
        {categories.length > 0 && (
          <select value={category} onChange={e => setCategory(e.target.value)} className={`${inputCls} w-auto min-w-[160px]`}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {items.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading catalog…</p>}
      {items.error && <Empty text={items.error} />}
      {!items.loading && !items.error && sorted.length === 0 && (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><Boxes size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No items found</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">{search || category ? 'Try a different search or clear the filter.' : 'The inventory catalog is empty so far.'}</p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map(i => (
          <Card key={i.id} className="card-lift flex cursor-pointer flex-col gap-3" onClick={() => setSelectedId(i.id)}>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><Package size={20} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{i.name}</p>
                <p className={`truncate ${muted}`}>{i.category ?? 'Uncategorized'}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={STOCK_TONE(i)}>{i.currentStock} {i.unit}</Pill>
              {!i.isConsumable && <Pill tone="indigo">Fixed asset</Pill>}
              {isLowStock(i) && <Pill tone="rose"><AlertTriangle size={11} /> Low</Pill>}
            </div>
          </Card>
        ))}
      </div>

      <ItemDetailModal item={selected} categories={categories} onClose={() => setSelectedId(null)} onChanged={reload} canManage={canManage} />
      <ItemFormModal open={addOpen} editing={null} categories={categories} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); reload() }} />
    </div>
  )
}

/* ── Vendors: simple CRUD list (staff/admin) ─────────────── */

interface VendorForm { name: string; contactName: string; phone: string; email: string; address: string }
const emptyVendorForm = (): VendorForm => ({ name: '', contactName: '', phone: '', email: '', address: '' })

export function VendorsMod() {
  const vendors = useVendors()
  const sorted = useMemo(() => [...(vendors.items ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [vendors.items])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<VendorRec | null>(null)
  const [form, setForm] = useState<VendorForm>(emptyVendorForm())
  const [busy, setBusy] = useState(false)
  const [delVendor, setDelVendor] = useState<VendorRec | null>(null)

  const openAdd = () => { setEditing(null); setForm(emptyVendorForm()); setFormOpen(true) }
  const openEdit = (v: VendorRec) => { setEditing(v); setForm({ name: v.name, contactName: v.contactName ?? '', phone: v.phone ?? '', email: v.email ?? '', address: v.address ?? '' }); setFormOpen(true) }

  const save = async () => {
    setBusy(true)
    try {
      // Nullable-optional server-side (see createVendor in schema.ts) — `null`, not `undefined`, so clearing a
      // field on an edit actually clears it rather than leaving the previous value (an omitted key is a no-op
      // in a PATCH, same reasoning as the item form's save() above).
      const body = {
        name: form.name.trim(), contactName: form.contactName.trim() || null, phone: form.phone.trim() || null,
        email: form.email.trim() || null, address: form.address.trim() || null,
      }
      if (editing) await api.patch(`/inventory/vendors/${editing.id}`, body)
      else await api.post('/inventory/vendors', body)
      setFormOpen(false); vendors.reload(); toast.success(editing ? 'Vendor updated' : 'Vendor added')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!delVendor) return
    setBusy(true)
    try { await api.del(`/inventory/vendors/${delVendor.id}`); setDelVendor(null); vendors.reload(); toast.success('Vendor deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHead title="Vendors" sub="Suppliers you order inventory from">
        <button onClick={openAdd} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> Add vendor</button>
      </PageHead>

      {vendors.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading vendors…</p>}
      {vendors.error && <Empty text={vendors.error} />}
      {!vendors.loading && !vendors.error && sorted.length === 0 && (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><Truck size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No vendors yet</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">Add a vendor before raising a purchase order against them.</p>
          <div className="mt-5"><button onClick={openAdd} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> Add first vendor</button></div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {sorted.map(v => (
          <Card key={v.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><Truck size={20} /></span>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold">{v.name}</p>
                  {v.contactName && <p className={muted}>{v.contactName}</p>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button onClick={() => openEdit(v)} className={iconBtn} aria-label="Edit vendor"><Pencil size={14} /></button>
                <button onClick={() => setDelVendor(v)} className={dangerBtn} aria-label="Delete vendor"><Trash2 size={14} /></button>
              </div>
            </div>
            <div className="space-y-1 text-[13px]">
              {v.phone && <p className="flex items-center gap-1.5 text-black/60 dark:text-white/60"><Phone size={12} /> {v.phone}</p>}
              {v.email && <p className="flex items-center gap-1.5 text-black/60 dark:text-white/60"><Mail size={12} /> {v.email}</p>}
              {v.address && <p className="flex items-center gap-1.5 text-black/60 dark:text-white/60"><MapPin size={12} /> {v.address}</p>}
              {!v.phone && !v.email && !v.address && <p className={muted}>No contact details on file.</p>}
            </div>
          </Card>
        ))}
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.name}` : 'New vendor'}>
        <div className="space-y-4">
          <Field label="Vendor name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} autoFocus /></Field>
          <Field label="Contact name"><input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
            <Field label="Email"><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
          </div>
          <Field label="Address"><textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} placeholder="Optional" className={inputCls} /></Field>
          <FormActions onCancel={() => setFormOpen(false)} onSave={save} label={editing ? 'Save changes' : 'Add vendor'} disabled={!form.name.trim() || busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!delVendor} onClose={() => setDelVendor(null)} title={`Delete ${delVendor?.name ?? 'vendor'}?`}
        body="This cannot be undone. A vendor with existing purchase orders may not be deletable." action="Delete vendor" busy={busy} onConfirm={remove} />
    </div>
  )
}

/* ── Purchase Orders: create, Draft → Ordered, receive (staff/admin) ─── */

interface POLineDraft { itemId: string; quantityOrdered: string; unitCost: string }
const emptyLine = (): POLineDraft => ({ itemId: '', quantityOrdered: '', unitCost: '' })

function CreatePOModal({ open, vendors, items, onClose, onCreated }: {
  open: boolean; vendors: VendorRec[]; items: InventoryItemRec[]; onClose: () => void; onCreated: () => void
}) {
  const [vendorId, setVendorId] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<POLineDraft[]>([emptyLine()])
  const [busy, setBusy] = useState(false)

  const reset = () => { setVendorId(''); setExpectedDate(''); setNotes(''); setLines([emptyLine()]) }
  const close = () => { reset(); onClose() }
  const setLine = (idx: number, patch: Partial<POLineDraft>) => setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l))
  const removeLine = (idx: number) => setLines(ls => ls.filter((_, i) => i !== idx))
  const validLines = lines.filter(l => l.itemId && Number(l.quantityOrdered) > 0)

  const save = async () => {
    if (!vendorId || validLines.length === 0) return
    setBusy(true)
    try {
      await api.post('/inventory/purchase-orders', {
        vendorId, expectedDate: expectedDate || undefined, notes: notes.trim() || undefined,
        lines: validLines.map(l => ({ itemId: l.itemId, quantityOrdered: Number(l.quantityOrdered), unitCost: l.unitCost.trim() ? Number(l.unitCost) : undefined })),
      })
      toast.success('Purchase order created'); reset(); onClose(); onCreated()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={close} title="New purchase order" wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vendor">
            <select value={vendorId} onChange={e => setVendorId(e.target.value)} className={inputCls}>
              <option value="">Select a vendor</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
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
                  {items.map(it => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}
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

        <FormActions onCancel={close} onSave={save} label="Create purchase order" disabled={!vendorId || validLines.length === 0 || busy} />
      </div>
    </Modal>
  )
}

interface ReceiveDraft { lineId: string; label: string; remaining: number; unit: string; qty: string }

function ReceivePOModal({ po, items, onClose, onDone }: { po: PurchaseOrderRec | null; items: InventoryItemRec[]; onClose: () => void; onDone: () => void }) {
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const [drafts, setDrafts] = useState<ReceiveDraft[] | null>(null)
  const [busy, setBusy] = useState(false)

  const key = po?.id ?? null
  const [syncedFor, setSyncedFor] = useState<string | null>(null)
  if (po && key !== syncedFor) {
    setSyncedFor(key)
    setDrafts(po.lines.filter(l => l.quantityReceived < l.quantityOrdered).map(l => {
      const item = itemById.get(l.itemId)
      const remaining = l.quantityOrdered - l.quantityReceived
      return { lineId: l.id, label: item?.name ?? 'Item', remaining, unit: item?.unit ?? '', qty: String(remaining) }
    }))
  }

  const setQty = (lineId: string, qty: string) => setDrafts(ds => (ds ?? []).map(d => d.lineId === lineId ? { ...d, qty } : d))
  const close = () => { setSyncedFor(null); setDrafts(null); onClose() }

  const submit = async () => {
    if (!po || !drafts) return
    const payload = drafts.filter(d => Number(d.qty) > 0).map(d => ({ lineId: d.lineId, quantityReceived: Math.min(Number(d.qty), d.remaining) }))
    if (payload.length === 0) return
    setBusy(true)
    try {
      await api.post(`/inventory/purchase-orders/${po.id}/receive`, { lines: payload })
      toast.success('Receipt recorded'); close(); onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  if (!po) return null
  const anyPositive = (drafts ?? []).some(d => Number(d.qty) > 0)
  return (
    <Modal open={!!po} onClose={close} title="Receive purchase order" wide>
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
        <FormActions onCancel={close} onSave={submit} label="Record receipt" disabled={!anyPositive || busy} />
      </div>
    </Modal>
  )
}

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

function PODetailModal({ po, items, vendors, onClose, onChanged }: {
  po: PurchaseOrderRec | null; items: InventoryItemRec[]; vendors: VendorRec[]; onClose: () => void; onChanged: () => void
}) {
  const { db } = useStore()
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const [busy, setBusy] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)

  const setStatus = async (status: PurchaseOrderStatus) => {
    if (!po) return
    setBusy(true)
    try { await api.patch(`/inventory/purchase-orders/${po.id}`, { status }); toast.success(`Order ${status.toLowerCase()}`); onChanged() }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!po) return
    setBusy(true)
    try { await api.del(`/inventory/purchase-orders/${po.id}`); setDelOpen(false); onClose(); onChanged(); toast.success('Purchase order deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  if (!po) return null
  const vendor = vendors.find(v => v.id === po.vendorId)
  const totals = poReceiptTotals(po)
  const createdBy = db.users.find(u => u.id === po.createdById)?.name

  return (
    <Modal open={!!po} onClose={onClose} title={vendor?.name ?? 'Purchase order'} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={poStatusTone(po.status)}>{po.status}</Pill>
          {po.orderedAt && <span className={muted}>Ordered {fmtDate(po.orderedAt)}</span>}
          {po.expectedDate && <span className={muted}>Expected {fmtDate(po.expectedDate)}</span>}
          {createdBy && <span className={muted}>· by {createdBy}</span>}
        </div>

        {po.notes && <p className="text-[13.5px] text-black/60 dark:text-white/60">{po.notes}</p>}

        {totals.ordered > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
              <span className={muted}>Received</span>
              <span className="font-semibold">{totals.received} / {totals.ordered} units</span>
            </div>
            <Progress pct={totals.pct} />
          </div>
        )}

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

      <ReceivePOModal po={receiveOpen ? po : null} items={items} onClose={() => setReceiveOpen(false)} onDone={onChanged} />
      <ConfirmModal open={delOpen} onClose={() => setDelOpen(false)} title="Delete this draft purchase order?"
        body="This cannot be undone. Only Draft orders can be deleted." action="Delete draft" busy={busy} onConfirm={remove} />
    </Modal>
  )
}

export function PurchaseOrdersMod() {
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('')
  const pos = usePurchaseOrders(status ? { status } : {})
  const vendors = useVendors()
  const invItems = useInventoryItems()
  const vendorById = useMemo(() => new Map((vendors.items ?? []).map(v => [v.id, v])), [vendors.items])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const sorted = useMemo(() => [...(pos.items ?? [])].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')), [pos.items])
  const selected = selectedId ? (pos.items ?? []).find(p => p.id === selectedId) ?? null : null
  const statusFilters: (PurchaseOrderStatus | '')[] = ['', ...PURCHASE_ORDER_STATUSES]

  return (
    <div>
      <PageHead title="Purchase Orders" sub="Order inventory from a vendor, then receive it in full or in part">
        <button onClick={() => setCreateOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
          <Plus size={15} /> New purchase order
        </button>
      </PageHead>

      <div className="mb-5 flex flex-wrap items-center gap-2 overflow-x-auto">
        <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
          {statusFilters.map(s => (
            <button key={s || 'all'} onClick={() => setStatus(s)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${status === s ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {pos.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading purchase orders…</p>}
      {pos.error && <Empty text={pos.error} />}
      {!pos.loading && !pos.error && sorted.length === 0 && (
        <Card className="flex flex-col items-center py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><ShoppingCart size={26} /></div>
          <p className="mt-4 font-display text-xl font-medium">No purchase orders</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">{status ? 'None match this status filter.' : 'Create one against a vendor to start restocking.'}</p>
        </Card>
      )}

      <div className="space-y-3">
        {sorted.map(po => {
          const vendor = vendorById.get(po.vendorId)
          const totals = poReceiptTotals(po)
          return (
            <Card key={po.id} className="card-lift cursor-pointer" onClick={() => setSelectedId(po.id)}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"><Truck size={20} /></span>
                <div className="min-w-40 flex-1">
                  <p className="text-[15px] font-semibold">{vendor?.name ?? 'Vendor'}</p>
                  <p className={muted}>{po.lines.length} line{po.lines.length === 1 ? '' : 's'}{po.expectedDate ? ` · expected ${fmtDate(po.expectedDate)}` : ''}</p>
                </div>
                <Pill tone={poStatusTone(po.status)}>{po.status}</Pill>
                <ChevronRight size={16} className="shrink-0 text-black/30 dark:text-white/30" />
              </div>
              {totals.ordered > 0 && (po.status === 'Ordered' || po.status === 'PartiallyReceived') && (
                <div className="mt-3"><Progress pct={totals.pct} /></div>
              )}
            </Card>
          )
        })}
      </div>

      <PODetailModal po={selected} items={invItems.items ?? []} vendors={vendors.items ?? []} onClose={() => setSelectedId(null)} onChanged={() => pos.reload()} />
      <CreatePOModal open={createOpen} vendors={vendors.items ?? []} items={invItems.items ?? []} onClose={() => setCreateOpen(false)} onCreated={() => pos.reload()} />
    </div>
  )
}
