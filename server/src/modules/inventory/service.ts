import type { z } from 'zod'
import type { Prisma, InventoryItem, StockMovement, Vendor, PurchaseOrder, PurchaseOrderLine } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate, toDate } from '../../lib/validate'
import type {
  createItem, patchItem, itemQuery, adjustStock,
  createVendor, patchVendor,
  createPo, patchPo, poQuery, receivePo,
} from './schema'

// See phase-16-inventory.md. Every write here is gated at the router (staff/admin/superadmin for
// items/vendors/purchase-orders and the adjust/receive actions) — this service assumes that has
// already run.
//
// Core invariant: `InventoryItem.currentStock` is denormalized and must ONLY ever change through
// `applyMovement` below, which writes a `StockMovement` row in the same transaction as the stock
// update. There is no other code path in this module (or anywhere else in the codebase) that touches
// `currentStock` directly — `updateItem` doesn't even accept it in its input type (see schema.ts).

type PoWithLines = PurchaseOrder & { lines: PurchaseOrderLine[] }

// ───────────────────────────── serialization ─────────────────────────────

export const serializeItem = (i: InventoryItem) => ({
  id: i.id,
  name: i.name,
  category: i.category ?? undefined,
  unit: i.unit,
  isConsumable: i.isConsumable,
  reorderThreshold: i.reorderThreshold ?? undefined,
  currentStock: i.currentStock,
  lowStock: i.reorderThreshold != null && i.currentStock <= i.reorderThreshold,
  createdAt: i.createdAt.toISOString(),
  updatedAt: i.updatedAt.toISOString(),
})

export const serializeMovement = (m: StockMovement) => ({
  id: m.id,
  itemId: m.itemId,
  type: m.type,
  quantity: m.quantity,
  reason: m.reason ?? undefined,
  relatedPoId: m.relatedPoId ?? undefined,
  recordedById: m.recordedById,
  recordedAt: m.recordedAt.toISOString(),
})

export const serializeVendor = (v: Vendor) => ({
  id: v.id,
  name: v.name,
  contactName: v.contactName ?? undefined,
  phone: v.phone ?? undefined,
  email: v.email ?? undefined,
  address: v.address ?? undefined,
  createdAt: v.createdAt.toISOString(),
  updatedAt: v.updatedAt.toISOString(),
})

export const serializePoLine = (l: PurchaseOrderLine) => ({
  id: l.id,
  poId: l.poId,
  itemId: l.itemId,
  quantityOrdered: l.quantityOrdered,
  quantityReceived: l.quantityReceived,
  unitCost: l.unitCost ?? undefined,
})

export const serializePo = (p: PoWithLines) => ({
  id: p.id,
  vendorId: p.vendorId,
  status: p.status,
  orderedAt: p.orderedAt ? fmtDate(p.orderedAt) : undefined,
  expectedDate: p.expectedDate ? fmtDate(p.expectedDate) : undefined,
  notes: p.notes ?? undefined,
  createdById: p.createdById,
  lines: p.lines.map(serializePoLine),
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
})

// ───────────────────────────── internal helpers ─────────────────────────────

async function findItemRaw(ctx: Ctx, id: string) {
  const row = await prisma.inventoryItem.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Inventory item')
  return row
}

async function findVendorRaw(ctx: Ctx, id: string) {
  const row = await prisma.vendor.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Vendor')
  return row
}

async function findPoRaw(ctx: Ctx, id: string): Promise<PoWithLines> {
  const row = await prisma.purchaseOrder.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { lines: true } })
  if (!row) throw notFound('Purchase order')
  return row as PoWithLines
}

// In/Out: `quantity` is always positive, direction implied by type. Adjustment: `quantity` is signed
// (positive = add, negative = remove) — see schema.prisma's StockMovement.quantity comment.
const deltaFor = (type: 'In' | 'Out' | 'Adjustment', quantity: number): number => (type === 'Out' ? -quantity : quantity)

// The single place `currentStock` is ever written. Runs inside the given transaction client, atomically
// updating the item's stock and writing the movement row together — never one without the other.
// Rejects any movement that would take stock negative.
async function applyMovement(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  item: InventoryItem,
  args: { type: 'In' | 'Out' | 'Adjustment'; quantity: number; reason?: string | null; relatedPoId?: string | null },
): Promise<{ item: InventoryItem; movement: StockMovement }> {
  const delta = deltaFor(args.type, args.quantity)
  const newStock = item.currentStock + delta
  if (newStock < 0) {
    throw new HttpError(400, `This would take "${item.name}" stock below zero (current: ${item.currentStock}, change: ${delta})`)
  }
  const updatedItem = await tx.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } })
  const movement = await tx.stockMovement.create({
    data: {
      schoolId: ctx.schoolId,
      itemId: item.id,
      type: args.type,
      quantity: args.quantity,
      reason: args.reason ?? null,
      relatedPoId: args.relatedPoId ?? null,
      recordedById: ctx.actorId,
    },
  })
  return { item: updatedItem, movement }
}

// ───────────────────────────── items ─────────────────────────────

export async function listItems(ctx: Ctx, q: z.infer<typeof itemQuery>) {
  return prisma.inventoryItem.findMany({
    where: {
      schoolId: ctx.schoolId,
      category: q.category,
      ...(q.isConsumable !== undefined ? { isConsumable: q.isConsumable === 'true' } : {}),
      ...(q.q ? { OR: [
        { name: { contains: q.q, mode: 'insensitive' } },
        { category: { contains: q.q, mode: 'insensitive' } },
      ] } : {}),
    },
    orderBy: [{ name: 'asc' }],
  })
}

export async function getItem(ctx: Ctx, id: string) {
  return findItemRaw(ctx, id)
}

export async function listMovements(ctx: Ctx, itemId: string) {
  await findItemRaw(ctx, itemId)
  return prisma.stockMovement.findMany({ where: { schoolId: ctx.schoolId, itemId }, orderBy: [{ recordedAt: 'desc' }] })
}

export async function lowStockItems(ctx: Ctx) {
  const rows = await prisma.inventoryItem.findMany({
    where: { schoolId: ctx.schoolId, reorderThreshold: { not: null } },
    orderBy: [{ name: 'asc' }],
  })
  return rows.filter(r => r.reorderThreshold != null && r.currentStock <= r.reorderThreshold)
}

// `currentStock` always starts at 0 on creation — the only way to give a new item opening stock is an
// immediate follow-up POST /:id/adjust (an "Adjustment" movement records that opening count, which is
// the honest thing to do: even an opening balance is a movement, not a silent initial value).
export async function createItemRow(ctx: Ctx, input: z.infer<typeof createItem>) {
  const row = await prisma.inventoryItem.create({
    data: {
      schoolId: ctx.schoolId, name: input.name, category: input.category ?? null, unit: input.unit,
      isConsumable: input.isConsumable ?? true, reorderThreshold: input.reorderThreshold ?? null,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'inventoryItem', row.id, undefined, serializeItem(row))
  return row
}

export async function updateItem(ctx: Ctx, id: string, input: z.infer<typeof patchItem>) {
  const before = await findItemRaw(ctx, id)
  const row = await prisma.inventoryItem.update({
    where: { id },
    data: { name: input.name, category: input.category, unit: input.unit, isConsumable: input.isConsumable, reorderThreshold: input.reorderThreshold },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'inventoryItem', id, serializeItem(before), serializeItem(row))
  return row
}

export async function removeItem(ctx: Ctx, id: string) {
  const before = await findItemRaw(ctx, id)
  const movementCount = await prisma.stockMovement.count({ where: { itemId: id } })
  if (movementCount > 0) throw new HttpError(400, 'Cannot delete an item that has stock-movement history — its record must be kept for the audit trail')
  const poLineCount = await prisma.purchaseOrderLine.count({ where: { itemId: id } })
  if (poLineCount > 0) throw new HttpError(400, 'Cannot delete an item that appears on a purchase order')
  await prisma.inventoryItem.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'inventoryItem', id, serializeItem(before))
}

// POST /items/:id/adjust — a direct stock correction (damage/loss/count correction), always recorded
// as an Adjustment-type StockMovement (see schema.ts#adjustStock / phase-16-inventory.md).
export async function adjustStockRow(ctx: Ctx, id: string, input: z.infer<typeof adjustStock>) {
  const item = await findItemRaw(ctx, id)
  const { item: updatedItem, movement } = await prisma.$transaction(async tx =>
    applyMovement(tx, ctx, item, { type: 'Adjustment', quantity: input.quantity, reason: input.reason ?? null }),
  )
  await audit(ctx.schoolId, ctx.actorId, 'adjust', 'inventoryItem', id, { currentStock: item.currentStock }, { currentStock: updatedItem.currentStock, movementId: movement.id })
  return { item: updatedItem, movement }
}

// ───────────────────────────── vendors ─────────────────────────────

export async function listVendors(ctx: Ctx) {
  return prisma.vendor.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ name: 'asc' }] })
}

export async function getVendor(ctx: Ctx, id: string) {
  return findVendorRaw(ctx, id)
}

export async function createVendorRow(ctx: Ctx, input: z.infer<typeof createVendor>) {
  const row = await prisma.vendor.create({
    data: { schoolId: ctx.schoolId, name: input.name, contactName: input.contactName ?? null, phone: input.phone ?? null, email: input.email ?? null, address: input.address ?? null },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'vendor', row.id, undefined, serializeVendor(row))
  return row
}

export async function updateVendor(ctx: Ctx, id: string, input: z.infer<typeof patchVendor>) {
  const before = await findVendorRaw(ctx, id)
  const row = await prisma.vendor.update({
    where: { id },
    data: { name: input.name, contactName: input.contactName, phone: input.phone, email: input.email, address: input.address },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'vendor', id, serializeVendor(before), serializeVendor(row))
  return row
}

export async function removeVendor(ctx: Ctx, id: string) {
  const before = await findVendorRaw(ctx, id)
  const poCount = await prisma.purchaseOrder.count({ where: { vendorId: id } })
  if (poCount > 0) throw new HttpError(400, 'Cannot delete a vendor that has purchase orders on record')
  await prisma.vendor.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'vendor', id, serializeVendor(before))
}

// ───────────────────────────── purchase orders ─────────────────────────────

export async function listPos(ctx: Ctx, q: z.infer<typeof poQuery>) {
  return prisma.purchaseOrder.findMany({
    where: { schoolId: ctx.schoolId, vendorId: q.vendorId, status: q.status },
    include: { lines: true },
    orderBy: [{ createdAt: 'desc' }],
  }) as Promise<PoWithLines[]>
}

export async function getPo(ctx: Ctx, id: string) {
  return findPoRaw(ctx, id)
}

export async function createPoRow(ctx: Ctx, input: z.infer<typeof createPo>) {
  await findVendorRaw(ctx, input.vendorId)
  for (const line of input.lines) await findItemRaw(ctx, line.itemId)

  const row = await prisma.purchaseOrder.create({
    data: {
      schoolId: ctx.schoolId, vendorId: input.vendorId, status: 'Draft',
      expectedDate: input.expectedDate ? toDate(input.expectedDate) : null,
      notes: input.notes ?? null, createdById: ctx.actorId,
      lines: { create: input.lines.map(l => ({ itemId: l.itemId, quantityOrdered: l.quantityOrdered, unitCost: l.unitCost ?? null })) },
    },
    include: { lines: true },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'purchaseOrder', row.id, undefined, serializePo(row as PoWithLines))
  return row as PoWithLines
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Ordered', 'Cancelled'],
  Ordered: ['Cancelled'],
}

// Non-status fields (`vendorId`, `expectedDate`, `notes`) are only editable while the PO is still Draft
// — once Ordered, the paper trail (what was actually ordered, from whom) should stop moving; the only
// further transition allowed manually is Cancelled (PartiallyReceived/Received are exclusively set by
// receivePo below). Line items are fixed at creation (see phase-16-inventory.md — this endpoint doesn't
// support editing them after the fact).
export async function updatePo(ctx: Ctx, id: string, input: z.infer<typeof patchPo>) {
  const before = await findPoRaw(ctx, id)
  const { status, ...fields } = input
  const hasFieldEdits = fields.vendorId !== undefined || fields.expectedDate !== undefined || fields.notes !== undefined
  if (hasFieldEdits && before.status !== 'Draft') {
    throw new HttpError(400, `Can only edit a purchase order's details while it is Draft (current status: ${before.status})`)
  }
  if (fields.vendorId) await findVendorRaw(ctx, fields.vendorId)

  const data: Prisma.PurchaseOrderUpdateInput = {
    ...(fields.vendorId !== undefined ? { vendor: { connect: { id: fields.vendorId } } } : {}),
    ...(fields.expectedDate !== undefined ? { expectedDate: fields.expectedDate ? toDate(fields.expectedDate) : null } : {}),
    ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
  }

  if (status) {
    const allowed = ALLOWED_TRANSITIONS[before.status] ?? []
    if (!allowed.includes(status)) throw new HttpError(400, `Cannot move a purchase order from ${before.status} to ${status}`)
    data.status = status
    if (status === 'Ordered') data.orderedAt = new Date()
  }

  await prisma.purchaseOrder.update({ where: { id }, data })
  const after = await findPoRaw(ctx, id)
  await audit(ctx.schoolId, ctx.actorId, 'update', 'purchaseOrder', id, serializePo(before), serializePo(after))
  return after
}

export async function removePo(ctx: Ctx, id: string) {
  const before = await findPoRaw(ctx, id)
  if (before.status !== 'Draft') throw new HttpError(400, `Can only delete a purchase order while it is Draft (current status: ${before.status})`)
  await prisma.purchaseOrder.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'purchaseOrder', id, serializePo(before))
}

// POST /purchase-orders/:id/receive — full or partial: for each `{lineId, quantityReceived}` entry,
// records an In-type StockMovement for that item/quantity (relatedPoId set), increments the line's
// quantityReceived, and finally recomputes the PO's overall status (all lines fully received ->
// Received; some but not all -> PartiallyReceived). A line not mentioned in `input.lines` simply
// receives nothing this round. See phase-16-inventory.md's receiving logic.
export async function receivePoRows(ctx: Ctx, id: string, input: z.infer<typeof receivePo>) {
  const po = await findPoRaw(ctx, id)
  if (po.status !== 'Ordered' && po.status !== 'PartiallyReceived') {
    throw new HttpError(400, `Can only receive against an Ordered or PartiallyReceived purchase order (current status: ${po.status})`)
  }
  const lineById = new Map(po.lines.map(l => [l.id, l]))
  for (const entry of input.lines) {
    const line = lineById.get(entry.lineId)
    if (!line) throw new HttpError(400, `Line ${entry.lineId} does not belong to this purchase order`)
    const remaining = line.quantityOrdered - line.quantityReceived
    if (entry.quantityReceived > remaining) {
      throw new HttpError(400, `Cannot receive ${entry.quantityReceived} on line ${entry.lineId} — only ${remaining} remain(s) outstanding`)
    }
  }

  await prisma.$transaction(async tx => {
    for (const entry of input.lines) {
      const line = lineById.get(entry.lineId)!
      const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: line.itemId } })
      await applyMovement(tx, ctx, item, { type: 'In', quantity: entry.quantityReceived, reason: 'Purchase order receipt', relatedPoId: po.id })
      await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { quantityReceived: { increment: entry.quantityReceived } } })
    }
    const freshLines = await tx.purchaseOrderLine.findMany({ where: { poId: po.id } })
    const allReceived = freshLines.every(l => l.quantityReceived >= l.quantityOrdered)
    const anyReceived = freshLines.some(l => l.quantityReceived > 0)
    const status = allReceived ? 'Received' : anyReceived ? 'PartiallyReceived' : po.status
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status } })
  })

  const after = await findPoRaw(ctx, id)
  await audit(ctx.schoolId, ctx.actorId, 'receive', 'purchaseOrder', id, serializePo(po), serializePo(after))
  return after
}
