import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import {
  createRoute, patchRoute,
  createStop, patchStop, stopQuery,
  createVehicle, patchVehicle,
  createAssignment, assignmentQuery,
  pingBody, myStopQuery,
} from './schema'

// /api/transport — see phase-12-transport.md.
export const transportRouter = Router()
transportRouter.use(requireAuth)

// Routes/stops: write is staff/admin/superadmin, read is any authenticated role (a student/parent needs
// to see their own route/stop info). Vehicles: read AND write are staff/admin/superadmin only — driver
// contact info is not broadcast on the open vehicles list; a parent/student only ever sees their own
// assigned vehicle's details via GET /my-stop or GET /vehicles/:id/location. Assignments: write is
// staff/admin/superadmin (the spec says "staff/admin" — superadmin is included per this app's role
// hierarchy, where superadmin is a strict superset of admin everywhere else in the codebase); a
// parent/student may only read their own/ward's assignment (enforced in the service).
const write = requireRole('staff', 'admin', 'superadmin')

// ───────────────────────────── routes ─────────────────────────────

transportRouter.get('/routes', wrap(async (req, res) => {
  res.json({ items: (await svc.listRoutes(ctxOf(req as AuthedRequest))).map(svc.serializeRoute) })
}))
transportRouter.get('/routes/:id', wrap(async (req, res) => {
  const row = await svc.getRoute(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: { ...svc.serializeRoute(row), stops: row.stops.map(svc.serializeStop) } })
}))
transportRouter.post('/routes', write, wrap(async (req, res) => {
  const item = await svc.createRouteRow(ctxOf(req as AuthedRequest), validate(createRoute, req.body))
  res.status(201).json({ item: svc.serializeRoute(item) })
}))
transportRouter.patch('/routes/:id', write, wrap(async (req, res) => {
  const item = await svc.updateRoute(ctxOf(req as AuthedRequest), req.params.id, validate(patchRoute, req.body))
  res.json({ item: svc.serializeRoute(item) })
}))
transportRouter.delete('/routes/:id', write, wrap(async (req, res) => {
  await svc.removeRoute(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ───────────────────────────── stops ─────────────────────────────

transportRouter.get('/stops', wrap(async (req, res) => {
  const q = validate(stopQuery, req.query)
  res.json({ items: (await svc.listStops(ctxOf(req as AuthedRequest), q)).map(svc.serializeStop) })
}))
transportRouter.post('/stops', write, wrap(async (req, res) => {
  const item = await svc.createStopRow(ctxOf(req as AuthedRequest), validate(createStop, req.body))
  res.status(201).json({ item: svc.serializeStop(item) })
}))
transportRouter.patch('/stops/:id', write, wrap(async (req, res) => {
  const item = await svc.updateStopRow(ctxOf(req as AuthedRequest), req.params.id, validate(patchStop, req.body))
  res.json({ item: svc.serializeStop(item) })
}))
transportRouter.delete('/stops/:id', write, wrap(async (req, res) => {
  await svc.removeStopRow(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ───────────────────────────── vehicles ─────────────────────────────

const vehicleRead = requireRole('staff', 'admin', 'superadmin')

transportRouter.get('/vehicles', vehicleRead, wrap(async (req, res) => {
  res.json({ items: (await svc.listVehicles(ctxOf(req as AuthedRequest))).map(svc.serializeVehicle) })
}))
transportRouter.get('/vehicles/:id', vehicleRead, wrap(async (req, res) => {
  const item = await svc.getVehicle(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: svc.serializeVehicle(item) })
}))
transportRouter.post('/vehicles', write, wrap(async (req, res) => {
  const item = await svc.createVehicleRow(ctxOf(req as AuthedRequest), validate(createVehicle, req.body))
  res.status(201).json({ item: svc.serializeVehicle(item) })
}))
transportRouter.patch('/vehicles/:id', write, wrap(async (req, res) => {
  const item = await svc.updateVehicle(ctxOf(req as AuthedRequest), req.params.id, validate(patchVehicle, req.body))
  res.json({ item: svc.serializeVehicle(item) })
}))
transportRouter.delete('/vehicles/:id', write, wrap(async (req, res) => {
  await svc.removeVehicle(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// POST /vehicles/:id/ping — records a GPS ping. AUTH GATE (judgment call, see phase-12-transport.md):
// gated to staff/admin/superadmin, the same as every other write in this module, NOT opened to "any
// authenticated user". Rationale: there is no driver-specific account/role in this system today — a
// driver who needs to report location would, for now, have to be logged in as some staff account, so
// staff/admin/superadmin is the closest match to "whoever the driver actually is today". This is
// explicitly a placeholder: the future Kotlin Multiplatform driver app will define its own auth story
// (likely a vehicle-scoped credential, not a portal User at all), at which point this gate should be
// revisited — probably replaced with that app's own auth middleware rather than widened to "any user",
// since "any authenticated user can spoof any vehicle's GPS" is not a safe default either. The endpoint
// is fully testable via curl today with a staff/admin/superadmin token; see the phase-12 server report.
transportRouter.post('/vehicles/:id/ping', write, wrap(async (req, res) => {
  const item = await svc.pingLocation(ctxOf(req as AuthedRequest), req.params.id, validate(pingBody, req.body))
  res.status(201).json({ item: svc.serializeLocation(item) })
}))

// GET /vehicles/:id/location — latest ping, or `{ item: null }` (never a 404) if none recorded yet.
transportRouter.get('/vehicles/:id/location', wrap(async (req, res) => {
  const loc = await svc.latestLocation(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ item: loc ? svc.serializeLocation(loc) : null })
}))

// ───────────────────────────── assignments ─────────────────────────────

transportRouter.get('/assignments', wrap(async (req, res) => {
  const q = validate(assignmentQuery, req.query)
  res.json({ items: (await svc.listAssignments(ctxOf(req as AuthedRequest), q)).map(svc.serializeAssignment) })
}))
transportRouter.post('/assignments', write, wrap(async (req, res) => {
  const item = await svc.createAssignmentRow(ctxOf(req as AuthedRequest), validate(createAssignment, req.body))
  res.status(201).json({ item: svc.serializeAssignment(item) })
}))
transportRouter.delete('/assignments/:id', write, wrap(async (req, res) => {
  await svc.removeAssignment(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ───────────────────────────── my-stop ─────────────────────────────

// GET /my-stop?studentId — parent/student convenience: stop + route + assigned vehicle's latest location
// in one call. See phase-12-transport.md.
transportRouter.get('/my-stop', wrap(async (req, res) => {
  res.json(await svc.myStop(ctxOf(req as AuthedRequest), validate(myStopQuery, req.query)))
}))
