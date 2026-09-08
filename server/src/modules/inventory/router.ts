import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import {
  createItem, patchItem, itemQuery, adjustStock,
  createVendor, patchVendor,
  createPo, patchPo, poQuery, receivePo,
} from './schema'

// /api/inventory — see phase-16-inventory.md.
// - items: staff/admin/superadmin write, staff/admin/superadmin/teacher read (a teacher might
//   reasonably want to see lab-equipment stock; students/parents have no reason to, so this stays
//   staff-and-up rather than open to every role).
// - vendors, purchase-orders: staff/admin/superadmin only, both read and write.
export const inventoryRouter = Router()
inventoryRouter.use(requireAuth)

const write = requireRole('staff', 'admin', 'superadmin')
const read = requireRole('staff', 'admin', 'superadmin', 'teacher')

// ───────────────────────── items ─────────────────────────

inventoryRouter.get('/items', read, wrap(async (req, res) => {
  res.json({ items: (await svc.listItems(ctxOf(req as AuthedRequest), validate(itemQuery, req.query))).map(svc.serializeItem) })
}))

inventoryRouter.post('/items', write, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeItem(await svc.createItemRow(ctxOf(req as AuthedRequest), validate(createItem, req.body))) })
}))

inventoryRouter.get('/items/:id', read, wrap(async (req, res) => {
  res.json({ item: svc.serializeItem(await svc.getItem(ctxOf(req as AuthedRequest), req.params.id)) })
}))

inventoryRouter.patch('/items/:id', write, wrap(async (req, res) => {
  res.json({ item: svc.serializeItem(await svc.updateItem(ctxOf(req as AuthedRequest), req.params.id, validate(patchItem, req.body))) })
}))

inventoryRouter.delete('/items/:id', write, wrap(async (req, res) => {
  await svc.removeItem(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

inventoryRouter.get('/items/:id/movements', read, wrap(async (req, res) => {
  res.json({ items: (await svc.listMovements(ctxOf(req as AuthedRequest), req.params.id)).map(svc.serializeMovement) })
}))

// A direct stock correction (damage/loss/count correction) — always an Adjustment-type StockMovement.
inventoryRouter.post('/items/:id/adjust', write, wrap(async (req, res) => {
  const { item, movement } = await svc.adjustStockRow(ctxOf(req as AuthedRequest), req.params.id, validate(adjustStock, req.body))
  res.json({ item: svc.serializeItem(item), movement: svc.serializeMovement(movement) })
}))

// ───────────────────────── low stock ─────────────────────────

inventoryRouter.get('/low-stock', read, wrap(async (req, res) => {
  res.json({ items: (await svc.lowStockItems(ctxOf(req as AuthedRequest))).map(svc.serializeItem) })
}))

// ───────────────────────── vendors ─────────────────────────

inventoryRouter.get('/vendors', write, wrap(async (req, res) => {
  res.json({ items: (await svc.listVendors(ctxOf(req as AuthedRequest))).map(svc.serializeVendor) })
}))

inventoryRouter.post('/vendors', write, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeVendor(await svc.createVendorRow(ctxOf(req as AuthedRequest), validate(createVendor, req.body))) })
}))

inventoryRouter.get('/vendors/:id', write, wrap(async (req, res) => {
  res.json({ item: svc.serializeVendor(await svc.getVendor(ctxOf(req as AuthedRequest), req.params.id)) })
}))

inventoryRouter.patch('/vendors/:id', write, wrap(async (req, res) => {
  res.json({ item: svc.serializeVendor(await svc.updateVendor(ctxOf(req as AuthedRequest), req.params.id, validate(patchVendor, req.body))) })
}))

inventoryRouter.delete('/vendors/:id', write, wrap(async (req, res) => {
  await svc.removeVendor(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ───────────────────────── purchase orders ─────────────────────────

inventoryRouter.get('/purchase-orders', write, wrap(async (req, res) => {
  res.json({ items: (await svc.listPos(ctxOf(req as AuthedRequest), validate(poQuery, req.query))).map(svc.serializePo) })
}))

inventoryRouter.post('/purchase-orders', write, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializePo(await svc.createPoRow(ctxOf(req as AuthedRequest), validate(createPo, req.body))) })
}))

inventoryRouter.get('/purchase-orders/:id', write, wrap(async (req, res) => {
  res.json({ item: svc.serializePo(await svc.getPo(ctxOf(req as AuthedRequest), req.params.id)) })
}))

inventoryRouter.patch('/purchase-orders/:id', write, wrap(async (req, res) => {
  res.json({ item: svc.serializePo(await svc.updatePo(ctxOf(req as AuthedRequest), req.params.id, validate(patchPo, req.body))) })
}))

inventoryRouter.delete('/purchase-orders/:id', write, wrap(async (req, res) => {
  await svc.removePo(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

inventoryRouter.post('/purchase-orders/:id/receive', write, wrap(async (req, res) => {
  res.json({ item: svc.serializePo(await svc.receivePoRows(ctxOf(req as AuthedRequest), req.params.id, validate(receivePo, req.body))) })
}))
