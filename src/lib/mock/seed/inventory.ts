// Seed fragment for Phase 16: Inventory / Procurement — items, opening-stock movements (an item's
// `currentStock` only ever moves via a StockMovement, even its opening balance — mirrors the real
// server's rule, see modules/inventory.ts), vendors, and purchase orders in a few different statuses so
// every screen in src/portal/modules/inventory.tsx + src/pages/portal/{ItemDetail,PODetail,
// PurchaseOrderNew}.tsx has something real to render. Extends seed/core.ts's School/User rows.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'
import { addSeedFragment } from './index'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const dateDaysAgo = (n: number) => daysAgo(n).slice(0, 10)

export function seedInventory(db: Collections) {
  db.InventoryItem = [
    { id: 'item-chalk', schoolId: SCHOOL_ID, name: 'Chalk Box (Dustless)', category: 'Stationery', unit: 'box', isConsumable: true, reorderThreshold: 20, currentStock: 45, createdAt: '2025-04-01T00:00:00.000Z', updatedAt: daysAgo(2) },
    { id: 'item-notebook', schoolId: SCHOOL_ID, name: 'Notebook — 200 pages', category: 'Stationery', unit: 'piece', isConsumable: true, reorderThreshold: 100, currentStock: 60, createdAt: '2025-04-01T00:00:00.000Z', updatedAt: daysAgo(1) },
    { id: 'item-marker', schoolId: SCHOOL_ID, name: 'Whiteboard Marker', category: 'Stationery', unit: 'piece', isConsumable: true, reorderThreshold: 30, currentStock: 18, createdAt: '2025-04-01T00:00:00.000Z', updatedAt: daysAgo(3) },
    { id: 'item-beaker', schoolId: SCHOOL_ID, name: 'Glass Beaker 250ml', category: 'Lab Equipment', unit: 'piece', isConsumable: false, reorderThreshold: null, currentStock: 40, createdAt: '2025-04-01T00:00:00.000Z', updatedAt: daysAgo(10) },
    { id: 'item-projector', schoolId: SCHOOL_ID, name: 'LCD Projector', category: 'Electronics', unit: 'unit', isConsumable: false, reorderThreshold: null, currentStock: 6, createdAt: '2025-04-01T00:00:00.000Z', updatedAt: daysAgo(20) },
    { id: 'item-firstaid', schoolId: SCHOOL_ID, name: 'First Aid Kit', category: 'Medical', unit: 'kit', isConsumable: true, reorderThreshold: 5, currentStock: 3, createdAt: '2025-04-01T00:00:00.000Z', updatedAt: daysAgo(5) },
    { id: 'item-football', schoolId: SCHOOL_ID, name: 'Football', category: 'Sports', unit: 'piece', isConsumable: false, reorderThreshold: null, currentStock: 12, createdAt: '2025-04-01T00:00:00.000Z', updatedAt: daysAgo(15) },
  ].map(r => r as Row)

  // Opening-stock movements — one per item, matching each item's currentStock above.
  // item-projector's opening stock is 4 — the remaining 2 of its currentStock (6) arrived later via
  // po-3's receipt, recorded as a separate In movement below, so the two sum to the item's currentStock.
  const openingQty: Record<string, number> = {
    'item-chalk': 45, 'item-notebook': 60, 'item-marker': 18, 'item-beaker': 40,
    'item-projector': 4, 'item-firstaid': 3, 'item-football': 12,
  }
  const movements: Row[] = Object.entries(openingQty).map(([itemId, qty], i) => ({
    id: `stockmv-open-${i + 1}`, schoolId: SCHOOL_ID, itemId, type: 'Adjustment', quantity: qty,
    reason: 'Opening stock', relatedPoId: null, recordedById: 'u-st', recordedAt: '2025-04-01T09:00:00.000Z',
  } as Row))
  // A couple more realistic movements on top of opening stock.
  movements.push(
    { id: 'stockmv-2', schoolId: SCHOOL_ID, itemId: 'item-marker', type: 'Adjustment', quantity: -4, reason: 'Dried out, discarded', relatedPoId: null, recordedById: 'u-st', recordedAt: daysAgo(3) } as Row,
    { id: 'stockmv-3', schoolId: SCHOOL_ID, itemId: 'item-firstaid', type: 'Adjustment', quantity: -2, reason: 'Used during sports day', relatedPoId: null, recordedById: 'u-st', recordedAt: daysAgo(5) } as Row,
    { id: 'stockmv-4', schoolId: SCHOOL_ID, itemId: 'item-projector', type: 'In', quantity: 2, reason: 'Purchase order receipt', relatedPoId: 'po-3', recordedById: 'u-st', recordedAt: daysAgo(18) } as Row,
  )
  db.StockMovement = movements

  db.Vendor = [
    { id: 'vendor-sharma', schoolId: SCHOOL_ID, name: 'Sharma Stationery Mart', contactName: 'Ramesh Sharma', phone: '+91 98450 11223', email: 'sales@sharmastationery.in', address: 'T. Nagar, Chennai', createdAt: '2024-05-01T00:00:00.000Z', updatedAt: '2024-05-01T00:00:00.000Z' },
    { id: 'vendor-techzone', schoolId: SCHOOL_ID, name: 'TechZone Solutions', contactName: 'Anitha Rajan', phone: '+91 98450 44556', email: 'orders@techzone.in', address: 'Guindy Industrial Estate, Chennai', createdAt: '2024-05-01T00:00:00.000Z', updatedAt: '2024-05-01T00:00:00.000Z' },
    { id: 'vendor-medicare', schoolId: SCHOOL_ID, name: 'MediCare Surgical Supplies', contactName: 'Deepak Nair', phone: '+91 98450 77889', email: 'contact@medicaresupplies.in', address: 'Nungambakkam, Chennai', createdAt: '2024-05-01T00:00:00.000Z', updatedAt: '2024-05-01T00:00:00.000Z' },
  ].map(r => r as Row)

  db.PurchaseOrder = [
    { id: 'po-1', schoolId: SCHOOL_ID, vendorId: 'vendor-sharma', status: 'Draft', orderedAt: null, expectedDate: null, notes: 'Restock chalk and notebooks for Term 3', createdById: 'u-st', createdAt: daysAgo(2), updatedAt: daysAgo(2) },
    { id: 'po-2', schoolId: SCHOOL_ID, vendorId: 'vendor-medicare', status: 'Ordered', orderedAt: daysAgo(6), expectedDate: dateDaysAgo(-4), notes: 'Refill first-aid kits before sports day', createdById: 'u-st', createdAt: daysAgo(7), updatedAt: daysAgo(6) },
    { id: 'po-3', schoolId: SCHOOL_ID, vendorId: 'vendor-techzone', status: 'Received', orderedAt: daysAgo(25), expectedDate: dateDaysAgo(18), notes: 'New projectors for the computer lab', createdById: 'u-st', createdAt: daysAgo(26), updatedAt: daysAgo(18) },
  ].map(r => r as Row)

  db.PurchaseOrderLine = [
    { id: 'poline-1a', schoolId: SCHOOL_ID, poId: 'po-1', itemId: 'item-chalk', quantityOrdered: 30, quantityReceived: 0, unitCost: 45 },
    { id: 'poline-1b', schoolId: SCHOOL_ID, poId: 'po-1', itemId: 'item-notebook', quantityOrdered: 200, quantityReceived: 0, unitCost: 25 },
    { id: 'poline-2a', schoolId: SCHOOL_ID, poId: 'po-2', itemId: 'item-firstaid', quantityOrdered: 10, quantityReceived: 0, unitCost: 650 },
    { id: 'poline-3a', schoolId: SCHOOL_ID, poId: 'po-3', itemId: 'item-projector', quantityOrdered: 2, quantityReceived: 2, unitCost: 32000 },
  ].map(r => r as Row)
}

addSeedFragment(seedInventory)
