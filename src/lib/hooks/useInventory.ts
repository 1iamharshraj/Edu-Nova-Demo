import type { InventoryItemRec, PurchaseOrderRec, PurchaseOrderStatus, StockMovementRec, StockMovementType, VendorRec } from '../data'
import { qs, useList, useOne } from './useAcademics'

// Data hooks and pure helpers for Phase 16: Inventory / Procurement — a catalog of items (consumable or fixed
// asset) whose `currentStock` only ever moves via a StockMovement (direct adjustment, or received against a
// PurchaseOrder), Vendors, and PurchaseOrders (Draft → Ordered → PartiallyReceived/Received, or Cancelled).
// Components live in src/portal/modules/inventory.tsx. See .agents/edunova/phase-16-inventory.md.
//
// Reconciled against the live server/src/modules/inventory/{router,schema,service}.ts once it landed (this
// frontend was first drafted before the server existed — see git history if the earlier inferred shapes
// matter). Notable points confirmed live:
// - `GET /inventory/items/:id/movements` (nested under the item, not a top-level `?itemId=` query) for the
//   timeline.
// - `POST /inventory/items/:id/adjust` takes `{ quantity, reason? }` where `quantity` is a SIGNED, non-zero
//   int (positive = add stock, negative = remove) — there is no separate `direction` field.
// - `POST /inventory/purchase-orders/:id/receive` takes `{ lines: [{lineId, quantityReceived}] }`, wrapped in
//   a `lines` key (matching this codebase's usual line-item body convention), not a bare array.
// - `PATCH /inventory/purchase-orders/:id` only ever accepts `status: 'Ordered' | 'Cancelled'` (Draft is the
//   only state `status` can be omitted from; PartiallyReceived/Received are exclusively set by receiving) —
//   vendorId/expectedDate/notes are only patchable while still Draft.
// - Every list/detail response is UNDECORATED (no nested `item`/`vendor`/`recordedBy`) — every helper below
//   cross-references the sibling `useInventoryItems`/`useVendors` list instead (same pattern as hostel.tsx
//   resolving bed/room/hostel names), and components resolve `recordedBy`/`createdBy` names via the store's
//   `db.users`.
// - `InventoryItemRec` carries a server-computed `lowStock` boolean alongside `currentStock`/`reorderThreshold`
//   — `isLowStock()` below recomputes the same rule client-side so a locally-adjusted item (before its list
//   reloads) still renders correctly, but prefers the server's flag when present.

export const STOCK_MOVEMENT_TYPES: StockMovementType[] = ['In', 'Out', 'Adjustment']
export const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = ['Draft', 'Ordered', 'PartiallyReceived', 'Received', 'Cancelled']

/* ── items ─────────────────────────────────────────────── */

/** `/inventory/items?q=&category=&isConsumable=` — staff/admin/teacher read, staff/admin write. */
export function useInventoryItems(params: { q?: string; category?: string; isConsumable?: boolean } = {}, enabled = true) {
  return useList<InventoryItemRec>(enabled ? `/inventory/items${qs({
    q: params.q, category: params.category,
    isConsumable: params.isConsumable === undefined ? undefined : String(params.isConsumable),
  })}` : null)
}

export function useInventoryItem(id?: string, enabled = true) {
  return useOne<InventoryItemRec>(enabled && id ? `/inventory/items/${encodeURIComponent(id)}` : null)
}

/** `/inventory/low-stock` — items at/below their reorder threshold (consumables with a threshold set only). */
export function useLowStockItems(enabled = true) {
  return useList<InventoryItemRec>(enabled ? '/inventory/low-stock' : null)
}

/** `/inventory/items/:id/movements` — an item's stock-movement history, newest first, for its detail timeline. */
export function useStockMovements(itemId?: string, enabled = true) {
  return useList<StockMovementRec>(enabled && itemId ? `/inventory/items/${encodeURIComponent(itemId)}/movements` : null)
}

/** True only for a consumable with a reorder threshold set and stock at/below it — mirrors the server's
 * `currentStock <= reorderThreshold` low-stock rule (see phase-16-inventory.md's Core logic) and its
 * `lowStock` decoration, recomputed client-side so this stays correct even before a stale list reloads. */
export const isLowStock = (item: Pick<InventoryItemRec, 'isConsumable' | 'reorderThreshold' | 'currentStock' | 'lowStock'>): boolean =>
  item.lowStock ?? (item.isConsumable && item.reorderThreshold != null && item.currentStock <= item.reorderThreshold)

/** The actual signed change to `currentStock` a movement represents — In is always a gain, Out (reserved for
 * a future "issue stock" flow; no current endpoint creates one) is always a loss, and an Adjustment's
 * `quantity` is already signed by the server (positive = found/added, negative = damage/loss/shrinkage). */
export const movementDelta = (m: Pick<StockMovementRec, 'type' | 'quantity'>): number => (m.type === 'Out' ? -m.quantity : m.quantity)

export const movementTone = (m: Pick<StockMovementRec, 'type' | 'quantity'>): 'green' | 'rose' | 'slate' => {
  const d = movementDelta(m)
  return d > 0 ? 'green' : d < 0 ? 'rose' : 'slate'
}

/* ── vendors ───────────────────────────────────────────── */

/** `/inventory/vendors` — staff/admin/superadmin only (read and write). */
export function useVendors(enabled = true) {
  return useList<VendorRec>(enabled ? '/inventory/vendors' : null)
}

/* ── purchase orders ───────────────────────────────────── */

/** `/inventory/purchase-orders?vendorId=&status=` — staff/admin/superadmin only. */
export function usePurchaseOrders(params: { vendorId?: string; status?: PurchaseOrderStatus } = {}, enabled = true) {
  return useList<PurchaseOrderRec>(enabled ? `/inventory/purchase-orders${qs(params)}` : null)
}

export function usePurchaseOrder(id?: string, enabled = true) {
  return useOne<PurchaseOrderRec>(enabled && id ? `/inventory/purchase-orders/${encodeURIComponent(id)}` : null)
}

export const poStatusTone = (s: PurchaseOrderStatus): 'green' | 'amber' | 'rose' | 'sky' | 'slate' =>
  s === 'Received' ? 'green' : s === 'PartiallyReceived' ? 'amber' : s === 'Cancelled' ? 'rose' : s === 'Ordered' ? 'sky' : 'slate'

/** Ordered/received unit totals across a PO's lines, for a progress bar and "12 of 40 units received" text. */
export function poReceiptTotals(po: Pick<PurchaseOrderRec, 'lines'>) {
  const ordered = po.lines.reduce((a, l) => a + l.quantityOrdered, 0)
  const received = po.lines.reduce((a, l) => a + l.quantityReceived, 0)
  return { ordered, received, pct: ordered > 0 ? (received / ordered) * 100 : 0 }
}

/** Server-enforced transitions (`ALLOWED_TRANSITIONS` in service.ts): Draft → Ordered|Cancelled,
 * Ordered → Cancelled only. PartiallyReceived/Received are exclusively set by the receive flow. */
export const poEditableDraft = (status: PurchaseOrderStatus) => status === 'Draft'
export const poReceivable = (status: PurchaseOrderStatus) => status === 'Ordered' || status === 'PartiallyReceived'
export const poCancellable = (status: PurchaseOrderStatus) => status === 'Draft' || status === 'Ordered'
export const poDeletable = (status: PurchaseOrderStatus) => status === 'Draft'
