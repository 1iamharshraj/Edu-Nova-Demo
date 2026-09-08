import type { Prisma } from '@prisma/client'

// Phase 16 demo data: 10 inventory items across Lab Equipment / Sports / Furniture / Stationery / IT
// (a mix of consumable and fixed-asset, three already at/below their reorder threshold to demonstrate
// the low-stock view), 2 vendors, one fully-received PO and one partially-received PO, and enough
// StockMovement history on a few items to make their timeline non-trivial. Every item's `currentStock`
// is the running sum of the movements created for it below — seeding writes both directly (this script
// bypasses the API, so the "movements are the only path to currentStock" invariant doesn't apply to it,
// but staying internally consistent keeps the demo honest). Runs inside the same transaction as
// loadSampleData, after users already exist. See phase-16-inventory.md → sample-data notes.
//
// Movement/PO timestamps are relative to "now" (load time), not fixed calendar dates — mirrors
// samplePhase12.ts's vehicle-location pings and samplePhase15.ts's loan dates — so the demo stays
// coherent no matter when it's loaded.

type Tx = Prisma.TransactionClient

export interface Phase16Args {
  schoolId: string
  userId: (seedId: string) => string
}

const daysAgo = (now: Date, n: number) => new Date(now.getTime() - n * 86_400_000)
function dateDaysAgo(now: Date, n: number): Date {
  const d = daysAgo(now, n)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export async function loadPhase16(tx: Tx, a: Phase16Args) {
  const { schoolId } = a
  const uid = a.userId
  const now = new Date()

  const storeKeeper = uid('u-st') // Farhan Qureshi, Office Superintendent — doubles as the store/inventory desk.
  const admin = uid('u-a') // Dr. Leela Menon — approves/creates purchase orders in this demo.

  const item = (name: string, category: string, unit: string, isConsumable: boolean, reorderThreshold: number | null) =>
    tx.inventoryItem.create({ data: { schoolId, name, category, unit, isConsumable, reorderThreshold, currentStock: 0 } })

  const microscope = await item('Microscope', 'Lab Equipment', 'pcs', false, null)
  const beakerSet = await item('Beaker Set (250ml)', 'Lab Equipment', 'box', true, 5)
  const football = await item('Football', 'Sports', 'pcs', true, 4)
  const cricketBat = await item('Cricket Bat', 'Sports', 'pcs', false, null)
  const studentDesk = await item('Student Desk', 'Furniture', 'pcs', false, null)
  const whiteboardMarker = await item('Whiteboard Marker', 'Stationery', 'box', true, 10)
  const a4Paper = await item('A4 Paper Ream', 'Stationery', 'ream', true, 20)
  const projector = await item('Projector', 'IT', 'pcs', false, null)
  const laptop = await item('Laptop (Chromebook)', 'IT', 'pcs', false, null)
  const toner = await item('Printer Toner Cartridge', 'IT', 'pcs', true, 3)

  // A movement + a stock update, kept in lockstep the way `applyMovement` (service.ts) would — this is
  // seed data, not a request through the API, so it writes both directly rather than transactionally
  // recomputing, but the end state matches exactly what recordMovement would have produced. `quantity`
  // is positive for In/Out (direction implied by type) and signed for Adjustment — same convention as
  // schema.ts#adjustStock / schema.prisma's StockMovement.quantity comment.
  const running = new Map<string, number>()
  const move = async (itemId: string, type: 'In' | 'Out' | 'Adjustment', quantity: number, reason: string, daysBack: number, relatedPoId?: string) => {
    await tx.stockMovement.create({
      data: { schoolId, itemId, type, quantity, reason, relatedPoId: relatedPoId ?? null, recordedById: storeKeeper, recordedAt: daysAgo(now, daysBack) },
    })
    const delta = type === 'Out' ? -quantity : quantity
    running.set(itemId, (running.get(itemId) ?? 0) + delta)
  }

  // ── vendors ──
  const eduSupplies = await tx.vendor.create({
    data: { schoolId, name: 'EduSupplies India Pvt Ltd', contactName: 'Ramesh Iyer', phone: '+91 98200 11223', email: 'orders@edusupplies.example.in', address: '14 Industrial Estate, Chennai' },
  })
  const techWorld = await tx.vendor.create({
    data: { schoolId, name: 'TechWorld Distributors', contactName: 'Kavya Menon', phone: '+91 98450 66778', email: 'sales@techworld.example.in', address: '7th Cross, Electronic City, Bengaluru' },
  })

  // ── PO #1: fully received, term-start lab & stationery restock ──
  const po1 = await tx.purchaseOrder.create({
    data: {
      schoolId, vendorId: eduSupplies.id, status: 'Ordered',
      orderedAt: dateDaysAgo(now, 20), expectedDate: dateDaysAgo(now, 13), notes: 'Term-start lab & stationery restock',
      createdById: admin,
      lines: {
        create: [
          { itemId: beakerSet.id, quantityOrdered: 10, unitCost: 150 },
          { itemId: whiteboardMarker.id, quantityOrdered: 20, unitCost: 40 },
        ],
      },
    },
  })

  // ── PO #2: partially received, IT refresh ──
  const po2 = await tx.purchaseOrder.create({
    data: {
      schoolId, vendorId: techWorld.id, status: 'Ordered',
      orderedAt: dateDaysAgo(now, 10), expectedDate: dateDaysAgo(now, -4), notes: 'IT refresh — laptops for computer lab, toner restock',
      createdById: admin,
      lines: {
        create: [
          { itemId: laptop.id, quantityOrdered: 10, unitCost: 18_000 },
          { itemId: toner.id, quantityOrdered: 5, unitCost: 650 },
        ],
      },
    },
  })

  const po1Lines = await tx.purchaseOrderLine.findMany({ where: { poId: po1.id } })
  const po2Lines = await tx.purchaseOrderLine.findMany({ where: { poId: po2.id } })
  const lineFor = (lines: typeof po1Lines, itemId: string) => lines.find(l => l.itemId === itemId)!

  // ── stock movements: opening counts for items with no PO tie, purchase receipts + issues for the
  // rest — the running totals below match each item's final `currentStock`. ──
  await move(microscope.id, 'Adjustment', 12, 'Initial stock count', 90)

  await move(beakerSet.id, 'In', 10, 'Purchase order receipt', 20, po1.id)
  await move(beakerSet.id, 'Out', 5, 'Issued to Chemistry Lab', 15)
  await move(beakerSet.id, 'Out', 2, 'Issued to Physics Lab', 8)

  await move(football.id, 'Adjustment', 15, 'Initial stock count', 90)
  await move(football.id, 'Out', 6, 'Issued for Annual Sports Day', 30)
  await move(football.id, 'Out', 3, 'Issued to PE department', 10)

  await move(cricketBat.id, 'Adjustment', 15, 'Initial stock count', 90)

  await move(studentDesk.id, 'Adjustment', 120, 'Initial stock count', 90)

  await move(whiteboardMarker.id, 'In', 20, 'Purchase order receipt', 20, po1.id)
  await move(whiteboardMarker.id, 'Out', 12, 'Issued to classrooms', 12)
  await move(whiteboardMarker.id, 'Out', 4, 'Issued to staff room', 5)

  await move(a4Paper.id, 'Adjustment', 80, 'Initial stock count', 90)
  await move(a4Paper.id, 'Out', 35, 'Issued to office & exam printing', 25)

  await move(projector.id, 'Adjustment', 9, 'Initial stock count', 90)
  await move(projector.id, 'Adjustment', -1, 'Damaged beyond repair, written off', 40)

  await move(laptop.id, 'Adjustment', 19, 'Initial stock count', 90)
  await move(laptop.id, 'In', 6, 'Purchase order receipt', 4, po2.id)

  await move(toner.id, 'In', 2, 'Purchase order receipt', 4, po2.id)

  // Apply the final running totals to each item, and the receipts to their PO lines.
  for (const [itemId, stock] of running) {
    await tx.inventoryItem.update({ where: { id: itemId }, data: { currentStock: stock } })
  }

  await tx.purchaseOrderLine.update({ where: { id: lineFor(po1Lines, beakerSet.id).id }, data: { quantityReceived: 10 } })
  await tx.purchaseOrderLine.update({ where: { id: lineFor(po1Lines, whiteboardMarker.id).id }, data: { quantityReceived: 20 } })
  await tx.purchaseOrder.update({ where: { id: po1.id }, data: { status: 'Received' } })

  await tx.purchaseOrderLine.update({ where: { id: lineFor(po2Lines, laptop.id).id }, data: { quantityReceived: 6 } })
  await tx.purchaseOrderLine.update({ where: { id: lineFor(po2Lines, toner.id).id }, data: { quantityReceived: 2 } })
  await tx.purchaseOrder.update({ where: { id: po2.id }, data: { status: 'PartiallyReceived' } })
}
