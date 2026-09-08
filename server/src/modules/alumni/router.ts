import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { requireRole, ctxOf } from '../../lib/rbac'
import { STAFF_ROLES } from '../../lib/scope'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { createProfile, patchProfile, profileQuery, convertStudentBody, createEvent, patchEvent, rsvpBody, createDonation, patchDonation, donationQuery } from './schema'

// /api/alumni — see phase-13-alumni.md. Alumni are NOT `User`s (no portal login in this system); RSVPs
// and donations are always recorded BY staff on an alumnus's behalf.
export const alumniRouter = Router()
alumniRouter.use(requireAuth)

// Profiles/events: write is staff/admin/superadmin; read is broader (+ teacher) since it's useful
// context for staff running events, but NOT student/parent (institutional data about other people).
// Donations are financial data: staff/admin/superadmin only for both read and write.
const staff = requireRole(...(STAFF_ROLES as any))
const broadRead = requireRole('teacher', ...(STAFF_ROLES as any))

// ---- profiles ----

alumniRouter.get('/profiles', broadRead, wrap(async (req, res) => {
  res.json({ items: (await svc.listProfiles(ctxOf(req as AuthedRequest), validate(profileQuery, req.query))).map(svc.serializeProfile) })
}))

alumniRouter.post('/profiles', staff, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeProfile(await svc.createProfileRow(ctxOf(req as AuthedRequest), validate(createProfile, req.body))) })
}))

alumniRouter.get('/profiles/:id', broadRead, wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  const row = await svc.getProfile(ctx, req.params.id)
  const donationsTotal = await svc.donationsTotalFor(ctx, row.id)
  res.json({ item: { ...svc.serializeProfile(row), donationsTotal } })
}))

alumniRouter.patch('/profiles/:id', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeProfile(await svc.updateProfile(ctxOf(req as AuthedRequest), req.params.id, validate(patchProfile, req.body))) })
}))

alumniRouter.delete('/profiles/:id', staff, wrap(async (req, res) => {
  await svc.removeProfile(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ---- student -> alumnus conversion ----

alumniRouter.post('/convert-student', staff, wrap(async (req, res) => {
  const { profile, enrollmentEnded } = await svc.convertStudent(ctxOf(req as AuthedRequest), validate(convertStudentBody, req.body))
  res.status(201).json({ item: svc.serializeProfile(profile), enrollmentEnded })
}))

// ---- events ----

alumniRouter.get('/events', broadRead, wrap(async (req, res) => {
  res.json({ items: (await svc.listEvents(ctxOf(req as AuthedRequest))).map(svc.serializeEvent) })
}))

alumniRouter.post('/events', staff, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeEvent(await svc.createEventRow(ctxOf(req as AuthedRequest), validate(createEvent, req.body))) })
}))

alumniRouter.get('/events/:id', broadRead, wrap(async (req, res) => {
  res.json({ item: svc.serializeEvent(await svc.getEvent(ctxOf(req as AuthedRequest), req.params.id)) })
}))

alumniRouter.patch('/events/:id', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeEvent(await svc.updateEvent(ctxOf(req as AuthedRequest), req.params.id, validate(patchEvent, req.body))) })
}))

alumniRouter.delete('/events/:id', staff, wrap(async (req, res) => {
  await svc.removeEvent(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))

// ---- rsvp (staff-recorded on an alumnus's behalf) ----

alumniRouter.get('/events/:id/rsvp', broadRead, wrap(async (req, res) => {
  res.json({ items: (await svc.listRsvps(ctxOf(req as AuthedRequest), req.params.id)).map(svc.serializeRsvp) })
}))

alumniRouter.post('/events/:id/rsvp', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeRsvp(await svc.setRsvp(ctxOf(req as AuthedRequest), req.params.id, validate(rsvpBody, req.body))) })
}))

// ---- donations (financial data — staff/admin/superadmin only) ----

alumniRouter.get('/donations', staff, wrap(async (req, res) => {
  res.json({ items: (await svc.listDonations(ctxOf(req as AuthedRequest), validate(donationQuery, req.query))).map(svc.serializeDonation) })
}))

alumniRouter.post('/donations', staff, wrap(async (req, res) => {
  res.status(201).json({ item: svc.serializeDonation(await svc.createDonationRow(ctxOf(req as AuthedRequest), validate(createDonation, req.body))) })
}))

alumniRouter.get('/donations/:id', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeDonation(await svc.getDonation(ctxOf(req as AuthedRequest), req.params.id)) })
}))

alumniRouter.patch('/donations/:id', staff, wrap(async (req, res) => {
  res.json({ item: svc.serializeDonation(await svc.updateDonation(ctxOf(req as AuthedRequest), req.params.id, validate(patchDonation, req.body))) })
}))

alumniRouter.delete('/donations/:id', staff, wrap(async (req, res) => {
  await svc.removeDonation(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
