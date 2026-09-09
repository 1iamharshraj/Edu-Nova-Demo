import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertTriangle, Boxes, ChevronRight, Mail, MapPin, Package, Pencil, Phone,
  Plus, Search, ShoppingCart, Trash2, Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { isStaffOrAdmin } from '@/lib/access'
import type { InventoryItemRec, PurchaseOrderStatus, VendorRec } from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import {
  PURCHASE_ORDER_STATUSES, isLowStock, poReceiptTotals, poStatusTone, useInventoryItems, useLowStockItems, usePurchaseOrders, useVendors,
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

export function InventoryCatalogMod() {
  const { user } = useStore()
  const navigate = useNavigate()
  const canManage = isStaffOrAdmin(user)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const items = useInventoryItems({ q: search.trim() || undefined, category: category || undefined })
  const lowStock = useLowStockItems()
  const [addOpen, setAddOpen] = useState(false)

  const categories = useMemo(() => Array.from(new Set((items.items ?? []).map(i => i.category).filter((c): c is string => !!c))).sort(), [items.items])
  const sorted = useMemo(() => [...(items.items ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [items.items])

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
              <button key={i.id} onClick={() => navigate(`/portal/inventory/items/${i.id}`)} className={`${rowCls} w-full text-left hover:bg-black/[.02] dark:hover:bg-white/[.03]`}>
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
          <Card key={i.id} className="card-lift flex cursor-pointer flex-col gap-3" onClick={() => navigate(`/portal/inventory/items/${i.id}`)}>
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
// New-PO creation moved to a routed page — src/pages/portal/PurchaseOrderNew.tsx — see
// .agents/edunova/ui-architecture-fix.md Phase D #5.

export function PurchaseOrdersMod() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('')
  const pos = usePurchaseOrders(status ? { status } : {})
  const vendors = useVendors()
  const vendorById = useMemo(() => new Map((vendors.items ?? []).map(v => [v.id, v])), [vendors.items])

  const sorted = useMemo(() => [...(pos.items ?? [])].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')), [pos.items])
  const statusFilters: (PurchaseOrderStatus | '')[] = ['', ...PURCHASE_ORDER_STATUSES]

  return (
    <div>
      <PageHead title="Purchase Orders" sub="Order inventory from a vendor, then receive it in full or in part">
        <button onClick={() => navigate('/portal/inventory/purchase-orders/new')} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
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
            <Card key={po.id} className="card-lift cursor-pointer" onClick={() => navigate(`/portal/inventory/purchase-orders/${po.id}`)}>
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
    </div>
  )
}
