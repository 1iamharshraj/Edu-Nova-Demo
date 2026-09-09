import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import {
  createHostel, patchHostel,
  createRoom, patchRoom, roomQuery,
  createBed, patchBed, bedQuery,
  createAllocation, vacateBody, transferBody, allocationQuery,
  createOutpass, decideOutpass, outpassQuery,
  createRollCall, patchRollCallEntries, rollCallQuery,
  createMenu, patchMenu, menuQuery, createFeedback, feedbackQuery,
} from './schema'

// /api/hostel — see phase-14-hostel.md.
export const hostelRouter = Router()
hostelRouter.use(requireAuth)

// Hostels/rooms/beds: write is staff/admin/superadmin; read is any authenticated role — see
// service.ts's comment above listHostels for the reasoning (mirrors Transport's routes/stops).
// Allocations: write (allocate/vacate/transfer) is staff/admin/superadmin only; read is scoped in the
// service (staff/admin/superadmin see everything, student/parent see only their own/ward's).
const write = requireRole('staff', 'admin', 'superadmin')

// ───────────────────────────── hostels ─────────────────────────────

hostelRouter.get('/hostels', wrap(async (req, res) => {
  res.json({ items: await svc.listHostels(ctxOf(req as AuthedRequest)) })
}))
hostelRouter.get('/hostels/:id', wrap(async (req, res) => {
  res.json({ item: await svc.getHostel(ctxOf(req as AuthedRequest), req.params.id) })
}))
hostelRouter.post('/hostels', write, wrap(async (req, res) => {
  const item = await svc.createHostelRow(ctxOf(req as AuthedRequest), validate(createHostel, req.body))
  res.status(201).json({ item: svc.serializeHostel(item) })
}))
hostelRouter.patch('/hostels/:id', write, wrap(async (req, res) => {
  const item = await svc.updateHostel(ctxOf(req as AuthedRequest), req.params.id, validate(patchHostel, req.body))
  res.json({ item: svc.serializeHostel(item) })
}))
hostelRouter.delete('/hostels/:id', write, wrap(async (req, res) => {
  await svc.removeHostel(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ───────────────────────────── rooms ─────────────────────────────

hostelRouter.get('/rooms', wrap(async (req, res) => {
  const q = validate(roomQuery, req.query)
  res.json({ items: await svc.listRooms(ctxOf(req as AuthedRequest), q) })
}))
hostelRouter.post('/rooms', write, wrap(async (req, res) => {
  const item = await svc.createRoomRow(ctxOf(req as AuthedRequest), validate(createRoom, req.body))
  res.status(201).json({ item: svc.serializeRoom(item) })
}))
hostelRouter.patch('/rooms/:id', write, wrap(async (req, res) => {
  const item = await svc.updateRoom(ctxOf(req as AuthedRequest), req.params.id, validate(patchRoom, req.body))
  res.json({ item: svc.serializeRoom(item) })
}))
hostelRouter.delete('/rooms/:id', write, wrap(async (req, res) => {
  await svc.removeRoom(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ───────────────────────────── beds ─────────────────────────────

hostelRouter.get('/beds', wrap(async (req, res) => {
  const q = validate(bedQuery, req.query)
  res.json({ items: await svc.listBeds(ctxOf(req as AuthedRequest), q) })
}))
hostelRouter.post('/beds', write, wrap(async (req, res) => {
  const item = await svc.createBedRow(ctxOf(req as AuthedRequest), validate(createBed, req.body))
  res.status(201).json({ item: svc.serializeBed(item) })
}))
hostelRouter.patch('/beds/:id', write, wrap(async (req, res) => {
  const item = await svc.updateBed(ctxOf(req as AuthedRequest), req.params.id, validate(patchBed, req.body))
  res.json({ item: svc.serializeBed(item) })
}))
hostelRouter.delete('/beds/:id', write, wrap(async (req, res) => {
  await svc.removeBed(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ───────────────────────────── allocations ─────────────────────────────

hostelRouter.get('/allocations', wrap(async (req, res) => {
  const q = validate(allocationQuery, req.query)
  const items = await svc.listAllocations(ctxOf(req as AuthedRequest), q)
  res.json({ items: items.map(svc.serializeAllocation) })
}))
hostelRouter.get('/allocations/:id', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const row = await svc.getAllocation(ctx, req.params.id)
  // Self/guardian scoping for the single-record read: reuse listAllocations' rules by checking the row's
  // studentId is one the caller may see (cheap: listAllocations({studentId}) throws 403 if not visible).
  await svc.listAllocations(ctx, { studentId: row.studentId })
  res.json({ item: svc.serializeAllocation(row) })
}))
hostelRouter.post('/allocations', write, wrap(async (req, res) => {
  const item = await svc.allocate(ctxOf(req as AuthedRequest), validate(createAllocation, req.body))
  res.status(201).json({ item: svc.serializeAllocation(item) })
}))
hostelRouter.post('/allocations/:id/vacate', write, wrap(async (req, res) => {
  const item = await svc.vacate(ctxOf(req as AuthedRequest), req.params.id, validate(vacateBody, req.body ?? {}))
  res.json({ item: svc.serializeAllocation(item) })
}))
hostelRouter.post('/allocations/:id/transfer', write, wrap(async (req, res) => {
  const item = await svc.transfer(ctxOf(req as AuthedRequest), req.params.id, validate(transferBody, req.body))
  res.status(201).json({ item: svc.serializeAllocation(item) })
}))

// ═══════════════════════════ Phase 24: outpasses / roll-call / mess menu ═══════════════════════════
// See phase-24-boarding-hostel-extensions.md. No blanket `write` gate on these — a hostel's warden may be
// a teacher account (outside staff/admin/superadmin), so per-hostel/per-request permission is enforced
// inside the service (assertWardenOrStaff / role checks) instead of at the router.

// ───────────────────────────── outpasses ─────────────────────────────

hostelRouter.get('/outpasses', wrap(async (req, res) => {
  const items = await svc.listOutpasses(ctxOf(req as AuthedRequest), validate(outpassQuery, req.query))
  res.json({ items })
}))
hostelRouter.post('/outpasses', wrap(async (req, res) => {
  const item = await svc.createOutpassSvc(ctxOf(req as AuthedRequest), validate(createOutpass, req.body))
  res.status(201).json({ item: svc.serializeOutpass(item) })
}))
hostelRouter.post('/outpasses/:id/approve', wrap(async (req, res) => {
  const item = await svc.approveOutpass(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializeOutpass(item) })
}))
hostelRouter.post('/outpasses/:id/decline', wrap(async (req, res) => {
  const item = await svc.declineOutpass(ctxOf(req as AuthedRequest), req.params.id, validate(decideOutpass, req.body ?? {}))
  res.json({ item: svc.serializeOutpass(item) })
}))
hostelRouter.post('/outpasses/:id/depart', wrap(async (req, res) => {
  const item = await svc.departOutpass(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializeOutpass(item) })
}))
hostelRouter.post('/outpasses/:id/return', wrap(async (req, res) => {
  const item = await svc.returnOutpass(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializeOutpass(item) })
}))

// ───────────────────────────── roll-call ─────────────────────────────

hostelRouter.get('/roll-calls', wrap(async (req, res) => {
  const items = await svc.listRollCalls(ctxOf(req as AuthedRequest), validate(rollCallQuery, req.query))
  res.json({ items })
}))
hostelRouter.post('/roll-calls', wrap(async (req, res) => {
  const { row, created } = await svc.upsertRollCall(ctxOf(req as AuthedRequest), validate(createRollCall, req.body))
  res.status(created ? 201 : 200).json({ item: svc.serializeRollCall(row) })
}))
hostelRouter.patch('/roll-calls/:id/entries', wrap(async (req, res) => {
  const row = await svc.patchRollCall(ctxOf(req as AuthedRequest), req.params.id, validate(patchRollCallEntries, req.body))
  res.json({ item: svc.serializeRollCall(row) })
}))

// ───────────────────────────── mess menu ─────────────────────────────

hostelRouter.get('/mess-menu', wrap(async (req, res) => {
  const items = await svc.listMenus(ctxOf(req as AuthedRequest), validate(menuQuery, req.query))
  res.json({ items })
}))
hostelRouter.post('/mess-menu', wrap(async (req, res) => {
  const { row, created } = await svc.upsertMenu(ctxOf(req as AuthedRequest), validate(createMenu, req.body))
  res.status(created ? 201 : 200).json({ item: svc.serializeMenu(row) })
}))
hostelRouter.patch('/mess-menu/:id', wrap(async (req, res) => {
  const item = await svc.patchMenuSvc(ctxOf(req as AuthedRequest), req.params.id, validate(patchMenu, req.body))
  res.json({ item: svc.serializeMenu(item) })
}))
hostelRouter.delete('/mess-menu/:id', wrap(async (req, res) => {
  await svc.removeMenu(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ───────────────────────────── meal feedback ─────────────────────────────

hostelRouter.get('/meal-feedback', wrap(async (req, res) => {
  res.json(await svc.listFeedback(ctxOf(req as AuthedRequest), validate(feedbackQuery, req.query)))
}))
hostelRouter.post('/meal-feedback', wrap(async (req, res) => {
  const { row, created } = await svc.createFeedbackSvc(ctxOf(req as AuthedRequest), validate(createFeedback, req.body))
  res.status(created ? 201 : 200).json({ item: svc.serializeFeedback(row) })
}))
