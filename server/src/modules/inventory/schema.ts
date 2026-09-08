import { z } from 'zod'
import { idStr, dateStr } from '../../lib/validate'

// See phase-16-inventory.md.

export const MOVEMENT_TYPES = ['In', 'Out', 'Adjustment'] as const
export const PO_STATUSES = ['Draft', 'Ordered', 'PartiallyReceived', 'Received', 'Cancelled'] as const

// ───────────────────────────── items ─────────────────────────────

// `currentStock` is deliberately absent from both schemas below — it can ONLY change via a
// StockMovement write (see service.ts#recordMovement). A caller attempting to slip it into the body
// gets it silently stripped by zod (unknown keys are dropped by default), not accepted.
export const createItem = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(80).nullable().optional(),
  unit: z.string().trim().min(1).max(20),
  isConsumable: z.boolean().optional(),
  reorderThreshold: z.number().int().min(0).max(1_000_000).nullable().optional(),
})
export const patchItem = createItem.partial()

export const itemQuery = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  isConsumable: z.enum(['true', 'false']).optional(),
})

// POST /items/:id/adjust — a direct correction (damage/loss/count correction), always recorded as an
// Adjustment-type StockMovement. Unlike In/Out (always positive; direction implied by type), `quantity`
// here is signed: positive to add stock (e.g. a recount finding more than expected), negative to remove
// it (damage, loss, a recount finding less) — see schema.prisma's StockMovement.quantity comment.
export const adjustStock = z.object({
  quantity: z.number().int().refine(n => n !== 0, 'quantity must not be zero').refine(n => Math.abs(n) <= 1_000_000, 'quantity magnitude too large'),
  reason: z.string().trim().max(300).optional(),
})

// ───────────────────────────── vendors ─────────────────────────────

export const createVendor = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().max(160).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
})
export const patchVendor = createVendor.partial()

// ───────────────────────────── purchase orders ─────────────────────────────

export const poLineInput = z.object({
  itemId: idStr,
  quantityOrdered: z.number().int().positive().max(1_000_000),
  unitCost: z.number().min(0).max(10_000_000).nullable().optional(),
})

export const createPo = z.object({
  vendorId: idStr,
  expectedDate: dateStr.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(poLineInput).min(1).max(200),
})

// Everything but `status` is editable while the PO is still Draft (see service.ts#updatePo);
// `status` here only accepts the manual Draft->Ordered / ->Cancelled transitions — PartiallyReceived
// and Received are exclusively set by the receive flow below, never through this endpoint.
export const patchPo = z.object({
  vendorId: idStr.optional(),
  expectedDate: dateStr.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['Ordered', 'Cancelled']).optional(),
})

export const poQuery = z.object({
  vendorId: idStr.optional(),
  status: z.enum(PO_STATUSES).optional(),
})

// POST /purchase-orders/:id/receive — a full or partial receipt: one entry per line being received now
// (a line not mentioned simply receives nothing this round). `quantityReceived` here is the quantity
// being received IN THIS CALL, not a running total.
export const receivePo = z.object({
  lines: z.array(z.object({
    lineId: idStr,
    quantityReceived: z.number().int().positive().max(1_000_000),
  })).min(1).max(200),
})
