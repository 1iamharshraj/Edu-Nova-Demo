# Phase 16 — Inventory / Procurement (Track B4 of the ERP roadmap)

## Data model

- `InventoryItem { id, schoolId, name, category? (e.g. "Lab Equipment", "Sports", "Furniture", "Stationery", "IT"), unit (e.g. "pcs", "box", "kg"), isConsumable (bool — consumables get used up and restocked; fixed assets like a projector don't), reorderThreshold? (int, for a low-stock warning on consumables), currentStock (int, denormalized — kept in sync by `StockMovement` rows, don't let callers write it directly) }`
- `StockMovement { id, itemId, type (In | Out | Adjustment), quantity (positive int; direction comes from `type`), reason? (e.g. "Purchase", "Issued to Science Lab", "Damaged", "Annual count correction"), relatedPoId? (nullable link to a PurchaseOrder if this movement came from receiving one), recordedById, recordedAt }`
- `Vendor { id, schoolId, name, contactName?, phone?, email?, address? }`
- `PurchaseOrder { id, schoolId, vendorId, status (Draft → Ordered → PartiallyReceived → Received → Cancelled), orderedAt?, expectedDate?, notes?, createdById }`
- `PurchaseOrderLine { id, poId, itemId, quantityOrdered, quantityReceived (default 0), unitCost? }`

## Core logic

- `currentStock` on `InventoryItem` must ONLY change via a `StockMovement` write (never edited directly through an item-update endpoint) — enforce this by computing/updating it transactionally inside the movement-creation service function, and reject any attempt to set `currentStock` directly in the item update schema.
- Receiving a purchase order (fully or partially): for each line, record a `StockMovement(type: In, relatedPoId)` for the received quantity, increment that line's `quantityReceived`, and update the PO's overall `status` (all lines fully received → `Received`; some but not all → `PartiallyReceived`).
- A low-stock view: items where `currentStock <= reorderThreshold` (only meaningful for consumables with a threshold set) — surface this as a dashboard/list, don't just leave it as a query nobody can see.
- This phase does NOT need to integrate with real payments/accounting (`unitCost` on a PO line is for record-keeping/reporting only, not a ledger entry — that's Phase-B6's job later, keep this phase self-contained).

## Endpoints

- `/api/inventory/items` — CRUD, staff/admin write, staff/admin/teacher read (a teacher might reasonably want to see lab-equipment stock; students/parents have no reason to see this, keep it staff-and-up).
- `POST /inventory/items/:id/adjust` — a direct stock adjustment (for corrections/damage/loss) — creates an `Adjustment`-type `StockMovement`.
- `/api/inventory/vendors` — CRUD, staff/admin.
- `/api/inventory/purchase-orders` — CRUD (Draft/Ordered transitions), `POST /:id/receive` (body: array of `{lineId, quantityReceived}` for a full or partial receipt), staff/admin.
- `GET /inventory/low-stock` — items at/below their reorder threshold.

## Frontend

- **Inventory catalog** (staff/admin/teacher): list/search items by category, see current stock, a low-stock badge/section.
- **Item detail**: stock-movement history (a simple timeline: date, type, quantity, reason, who), an "Adjust stock" action.
- **Purchase Orders** (staff/admin): create a PO against a vendor with line items, transition Draft → Ordered, and a "Receive" flow (mark quantities received per line, partial receipt supported).
- **Vendors** (staff/admin): simple CRUD list.
- Sample data: 8-10 inventory items across a few categories (mix of consumable/fixed, a couple already below their reorder threshold to demonstrate the low-stock view), 2 vendors, one fully-received PO and one partially-received PO, enough `StockMovement` history to make an item's timeline non-trivial.

## Ground rules
Same as every previous phase: additive migrations, `{router,service,schema}.ts` pattern, zod, `requireRole()`, `HttpError`, `audit()` on mutations, no git commands, no `/admin/reset`/`/admin/load-sample-data` except your own final step, server/frontend split with Portal.tsx changes described-not-made by the frontend agent, full tsc/eslint/test verification, live curl+UI verification.
