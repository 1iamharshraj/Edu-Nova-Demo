// Mirrors server/src/modules/inventory/{router,schema,service}.ts (see git show feature/backend-api:
// server/src/modules/inventory/*.ts). A catalog of items (consumable or fixed asset) whose
// `currentStock` only ever moves via a StockMovement (direct adjustment, or received against a
// PurchaseOrder), Vendors, and PurchaseOrders (Draft → Ordered → PartiallyReceived/Received, or
// Cancelled). Frontend contract confirmed against src/lib/hooks/useInventory.ts's comments.

import { route, requireRole, status } from '../router'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { notFound, badRequest } from '../http'

function serializeItem(i: Row) {
  const lowStock = i.reorderThreshold != null && (i.currentStock as number) <= (i.reorderThreshold as number)
  return { id: i.id, name: i.name, category: i.category ?? undefined, unit: i.unit, isConsumable: i.isConsumable, reorderThreshold: i.reorderThreshold ?? undefined, currentStock: i.currentStock, lowStock, createdAt: i.createdAt, updatedAt: i.updatedAt }
}
function serializeMovement(m: Row) {
  return { id: m.id, itemId: m.itemId, type: m.type, quantity: m.quantity, reason: m.reason ?? undefined, relatedPoId: m.relatedPoId ?? undefined, recordedById: m.recordedById, recordedAt: m.recordedAt }
}
function serializeVendor(v: Row) {
  return { id: v.id, name: v.name, contactName: v.contactName ?? undefined, phone: v.phone ?? undefined, email: v.email ?? undefined, address: v.address ?? undefined, createdAt: v.createdAt, updatedAt: v.updatedAt }
}
function serializePoLine(l: Row) {
  return { id: l.id, poId: l.poId, itemId: l.itemId, quantityOrdered: l.quantityOrdered, quantityReceived: l.quantityReceived, unitCost: l.unitCost ?? undefined }
}
function serializePo(p: Row) {
  const lines = table('PurchaseOrderLine').filter(l => l.poId === p.id)
  return { id: p.id, vendorId: p.vendorId, status: p.status, orderedAt: p.orderedAt ?? undefined, expectedDate: p.expectedDate ?? undefined, notes: p.notes ?? undefined, createdById: p.createdById, lines: lines.map(serializePoLine), createdAt: p.createdAt, updatedAt: p.updatedAt }
}

const deltaFor = (type: string, quantity: number) => (type === 'Out' ? -quantity : quantity)

/** The single place `currentStock` is ever written — mirrors the real server's `applyMovement`. */
function applyMovement(actor: { userId: string; schoolId: string }, item: Row, args: { type: 'In' | 'Out' | 'Adjustment'; quantity: number; reason?: string | null; relatedPoId?: string | null }) {
  const delta = deltaFor(args.type, args.quantity)
  const newStock = (item.currentStock as number) + delta
  if (newStock < 0) throw badRequest(`This would take "${item.name}" stock below zero (current: ${item.currentStock}, change: ${delta})`)
  const items = table('InventoryItem')
  const idx = items.findIndex(i => i.id === item.id)
  items[idx] = { ...item, currentStock: newStock, updatedAt: nowIso() }
  saveTable('InventoryItem', items)
  const movement: Row = { id: uid('stockmv'), schoolId: actor.schoolId, itemId: item.id, type: args.type, quantity: args.quantity, reason: args.reason ?? null, relatedPoId: args.relatedPoId ?? null, recordedById: actor.userId, recordedAt: nowIso() }
  const movements = table('StockMovement'); movements.push(movement); saveTable('StockMovement', movements)
  return { item: items[idx], movement }
}

// ───────────────────────────── items ─────────────────────────────

route('GET', '/inventory/items', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin', 'teacher')
  const { q, category, isConsumable } = ctx.query
  let rows = table('InventoryItem').filter(i => i.schoolId === actor.schoolId)
  if (category) rows = rows.filter(i => i.category === category)
  if (isConsumable !== undefined) rows = rows.filter(i => i.isConsumable === (isConsumable === 'true'))
  if (q) { const needle = q.toLowerCase(); rows = rows.filter(i => String(i.name).toLowerCase().includes(needle) || String(i.category ?? '').toLowerCase().includes(needle)) }
  rows = [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { items: rows.map(serializeItem) }
})

route('POST', '/inventory/items', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { name: string; category?: string; unit: string; isConsumable?: boolean; reorderThreshold?: number }
  const row: Row = { id: uid('item'), schoolId: actor.schoolId, name: b.name, category: b.category ?? null, unit: b.unit, isConsumable: b.isConsumable ?? true, reorderThreshold: b.reorderThreshold ?? null, currentStock: 0, createdAt: nowIso(), updatedAt: nowIso() }
  const rows = table('InventoryItem'); rows.push(row); saveTable('InventoryItem', rows)
  return status(201, { item: serializeItem(row) })
})

route('GET', '/inventory/items/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin', 'teacher')
  const row = table('InventoryItem').find(i => i.id === ctx.params.id && i.schoolId === actor.schoolId)
  if (!row) throw notFound('Inventory item')
  return { item: serializeItem(row) }
})

route('PATCH', '/inventory/items/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('InventoryItem')
  const idx = rows.findIndex(i => i.id === ctx.params.id && i.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Inventory item')
  const b = ctx.body as Record<string, unknown>
  delete b.currentStock
  rows[idx] = { ...rows[idx], ...b, updatedAt: nowIso() }
  saveTable('InventoryItem', rows)
  return { item: serializeItem(rows[idx]) }
})

route('DELETE', '/inventory/items/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('InventoryItem')
  const idx = rows.findIndex(i => i.id === ctx.params.id && i.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Inventory item')
  if (table('StockMovement').some(m => m.itemId === ctx.params.id)) throw badRequest('Cannot delete an item that has stock-movement history — its record must be kept for the audit trail')
  if (table('PurchaseOrderLine').some(l => l.itemId === ctx.params.id)) throw badRequest('Cannot delete an item that appears on a purchase order')
  rows.splice(idx, 1); saveTable('InventoryItem', rows)
  return { ok: true }
})

route('GET', '/inventory/items/:id/movements', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin', 'teacher')
  if (!table('InventoryItem').some(i => i.id === ctx.params.id && i.schoolId === actor.schoolId)) throw notFound('Inventory item')
  const rows = table('StockMovement').filter(m => m.schoolId === actor.schoolId && m.itemId === ctx.params.id).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))
  return { items: rows.map(serializeMovement) }
})

route('POST', '/inventory/items/:id/adjust', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const item = table('InventoryItem').find(i => i.id === ctx.params.id && i.schoolId === actor.schoolId)
  if (!item) throw notFound('Inventory item')
  const b = ctx.body as { quantity: number; reason?: string }
  if (!b.quantity) throw badRequest('quantity must not be zero')
  const { item: updated, movement } = applyMovement(actor, item, { type: 'Adjustment', quantity: b.quantity, reason: b.reason ?? null })
  return { item: serializeItem(updated), movement: serializeMovement(movement) }
})

route('GET', '/inventory/low-stock', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin', 'teacher')
  const rows = table('InventoryItem').filter(i => i.schoolId === actor.schoolId && i.reorderThreshold != null && (i.currentStock as number) <= (i.reorderThreshold as number))
  return { items: rows.map(serializeItem) }
})

// ───────────────────────────── vendors ─────────────────────────────

route('GET', '/inventory/vendors', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  return { items: table('Vendor').filter(v => v.schoolId === actor.schoolId).sort((a, b) => String(a.name).localeCompare(String(b.name))).map(serializeVendor) }
})
route('POST', '/inventory/vendors', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { name: string; contactName?: string; phone?: string; email?: string; address?: string }
  const row: Row = { id: uid('vendor'), schoolId: actor.schoolId, name: b.name, contactName: b.contactName ?? null, phone: b.phone ?? null, email: b.email ?? null, address: b.address ?? null, createdAt: nowIso(), updatedAt: nowIso() }
  const rows = table('Vendor'); rows.push(row); saveTable('Vendor', rows)
  return status(201, { item: serializeVendor(row) })
})
route('GET', '/inventory/vendors/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const row = table('Vendor').find(v => v.id === ctx.params.id && v.schoolId === actor.schoolId)
  if (!row) throw notFound('Vendor')
  return { item: serializeVendor(row) }
})
route('PATCH', '/inventory/vendors/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('Vendor')
  const idx = rows.findIndex(v => v.id === ctx.params.id && v.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Vendor')
  rows[idx] = { ...rows[idx], ...ctx.body, updatedAt: nowIso() }
  saveTable('Vendor', rows)
  return { item: serializeVendor(rows[idx]) }
})
route('DELETE', '/inventory/vendors/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('Vendor')
  const idx = rows.findIndex(v => v.id === ctx.params.id && v.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Vendor')
  if (table('PurchaseOrder').some(p => p.vendorId === ctx.params.id)) throw badRequest('Cannot delete a vendor that has purchase orders on record')
  rows.splice(idx, 1); saveTable('Vendor', rows)
  return { ok: true }
})

// ───────────────────────────── purchase orders ─────────────────────────────

route('GET', '/inventory/purchase-orders', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const { vendorId, status: st } = ctx.query
  let rows = table('PurchaseOrder').filter(p => p.schoolId === actor.schoolId)
  if (vendorId) rows = rows.filter(p => p.vendorId === vendorId)
  if (st) rows = rows.filter(p => p.status === st)
  rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: rows.map(serializePo) }
})

route('POST', '/inventory/purchase-orders', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const b = ctx.body as { vendorId: string; expectedDate?: string; notes?: string; lines: Array<{ itemId: string; quantityOrdered: number; unitCost?: number }> }
  if (!table('Vendor').some(v => v.id === b.vendorId && v.schoolId === actor.schoolId)) throw notFound('Vendor')
  for (const l of b.lines) if (!table('InventoryItem').some(i => i.id === l.itemId && i.schoolId === actor.schoolId)) throw notFound('Inventory item')
  const po: Row = { id: uid('po'), schoolId: actor.schoolId, vendorId: b.vendorId, status: 'Draft', expectedDate: b.expectedDate ?? null, notes: b.notes ?? null, createdById: actor.userId, createdAt: nowIso(), updatedAt: nowIso() }
  const pos = table('PurchaseOrder'); pos.push(po); saveTable('PurchaseOrder', pos)
  const lines = table('PurchaseOrderLine')
  for (const l of b.lines) lines.push({ id: uid('poline'), schoolId: actor.schoolId, poId: po.id, itemId: l.itemId, quantityOrdered: l.quantityOrdered, quantityReceived: 0, unitCost: l.unitCost ?? null })
  saveTable('PurchaseOrderLine', lines)
  return status(201, { item: serializePo(po) })
})

route('GET', '/inventory/purchase-orders/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const row = table('PurchaseOrder').find(p => p.id === ctx.params.id && p.schoolId === actor.schoolId)
  if (!row) throw notFound('Purchase order')
  return { item: serializePo(row) }
})

const ALLOWED_TRANSITIONS: Record<string, string[]> = { Draft: ['Ordered', 'Cancelled'], Ordered: ['Cancelled'] }

route('PATCH', '/inventory/purchase-orders/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('PurchaseOrder')
  const idx = rows.findIndex(p => p.id === ctx.params.id && p.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Purchase order')
  const before = rows[idx]
  const b = ctx.body as { vendorId?: string; expectedDate?: string | null; notes?: string | null; status?: string }
  const hasFieldEdits = b.vendorId !== undefined || b.expectedDate !== undefined || b.notes !== undefined
  if (hasFieldEdits && before.status !== 'Draft') throw badRequest(`Can only edit a purchase order's details while it is Draft (current status: ${before.status})`)
  if (b.vendorId && !table('Vendor').some(v => v.id === b.vendorId && v.schoolId === actor.schoolId)) throw notFound('Vendor')
  const next: Row = { ...before }
  if (b.vendorId !== undefined) next.vendorId = b.vendorId
  if (b.expectedDate !== undefined) next.expectedDate = b.expectedDate
  if (b.notes !== undefined) next.notes = b.notes
  if (b.status) {
    const allowed = ALLOWED_TRANSITIONS[before.status as string] ?? []
    if (!allowed.includes(b.status)) throw badRequest(`Cannot move a purchase order from ${before.status} to ${b.status}`)
    next.status = b.status
    if (b.status === 'Ordered') next.orderedAt = nowIso()
  }
  next.updatedAt = nowIso()
  rows[idx] = next
  saveTable('PurchaseOrder', rows)
  return { item: serializePo(rows[idx]) }
})

route('DELETE', '/inventory/purchase-orders/:id', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const rows = table('PurchaseOrder')
  const idx = rows.findIndex(p => p.id === ctx.params.id && p.schoolId === actor.schoolId)
  if (idx === -1) throw notFound('Purchase order')
  if (rows[idx].status !== 'Draft') throw badRequest(`Can only delete a purchase order while it is Draft (current status: ${rows[idx].status})`)
  saveTable('PurchaseOrderLine', table('PurchaseOrderLine').filter(l => l.poId !== ctx.params.id))
  rows.splice(idx, 1); saveTable('PurchaseOrder', rows)
  return { ok: true }
})

route('POST', '/inventory/purchase-orders/:id/receive', (ctx) => {
  const actor = requireRole(ctx, 'staff', 'admin', 'superadmin')
  const pos = table('PurchaseOrder')
  const poIdx = pos.findIndex(p => p.id === ctx.params.id && p.schoolId === actor.schoolId)
  if (poIdx === -1) throw notFound('Purchase order')
  const po = pos[poIdx]
  if (po.status !== 'Ordered' && po.status !== 'PartiallyReceived') throw badRequest(`Can only receive against an Ordered or PartiallyReceived purchase order (current status: ${po.status})`)
  const b = ctx.body as { lines: Array<{ lineId: string; quantityReceived: number }> }
  const lines = table('PurchaseOrderLine')
  const lineById = new Map(lines.filter(l => l.poId === po.id).map(l => [l.id, l]))
  for (const entry of b.lines) {
    const line = lineById.get(entry.lineId)
    if (!line) throw badRequest(`Line ${entry.lineId} does not belong to this purchase order`)
    const remaining = (line.quantityOrdered as number) - (line.quantityReceived as number)
    if (entry.quantityReceived > remaining) throw badRequest(`Cannot receive ${entry.quantityReceived} on line ${entry.lineId} — only ${remaining} remain(s) outstanding`)
  }
  for (const entry of b.lines) {
    const line = lineById.get(entry.lineId)!
    const item = table('InventoryItem').find(i => i.id === line.itemId)!
    applyMovement(actor, item, { type: 'In', quantity: entry.quantityReceived, reason: 'Purchase order receipt', relatedPoId: po.id })
    const lIdx = lines.findIndex(l => l.id === line.id)
    lines[lIdx] = { ...lines[lIdx], quantityReceived: (lines[lIdx].quantityReceived as number) + entry.quantityReceived }
  }
  saveTable('PurchaseOrderLine', lines)
  const freshLines = table('PurchaseOrderLine').filter(l => l.poId === po.id)
  const allReceived = freshLines.every(l => (l.quantityReceived as number) >= (l.quantityOrdered as number))
  const anyReceived = freshLines.some(l => (l.quantityReceived as number) > 0)
  const nextStatus = allReceived ? 'Received' : anyReceived ? 'PartiallyReceived' : po.status
  const posNow = table('PurchaseOrder')
  const idx2 = posNow.findIndex(p => p.id === po.id)
  posNow[idx2] = { ...posNow[idx2], status: nextStatus, updatedAt: nowIso() }
  saveTable('PurchaseOrder', posNow)
  return { item: serializePo(posNow[idx2]) }
})
