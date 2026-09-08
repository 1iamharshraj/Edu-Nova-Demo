import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { serializeReview } from './service'
import { createReview, patchReview, acknowledgeBody, employeeCommentsBody, reviewsQuery } from './schema'

// /api/reviews — see phase-11-employee-management.md → A3.
export const reviewsRouter = Router()
reviewsRouter.use(requireAuth)

reviewsRouter.get('/', wrap(async (req, res) => {
  res.json({ items: (await svc.listReviews(ctxOf(req as AuthedRequest), validate(reviewsQuery, req.query))).map(serializeReview) })
}))
reviewsRouter.post('/', wrap(async (req, res) => {
  res.status(201).json({ item: serializeReview(await svc.createReviewRow(ctxOf(req as AuthedRequest), validate(createReview, req.body))) })
}))
reviewsRouter.get('/:id', wrap(async (req, res) => {
  res.json({ item: serializeReview(await svc.getReview(ctxOf(req as AuthedRequest), req.params.id)) })
}))
reviewsRouter.patch('/:id', wrap(async (req, res) => {
  res.json({ item: serializeReview(await svc.updateReview(ctxOf(req as AuthedRequest), req.params.id, validate(patchReview, req.body))) })
}))
reviewsRouter.post('/:id/share', wrap(async (req, res) => {
  res.json({ item: serializeReview(await svc.shareReview(ctxOf(req as AuthedRequest), req.params.id)) })
}))
reviewsRouter.patch('/:id/comments', wrap(async (req, res) => {
  res.json({ item: serializeReview(await svc.addEmployeeComments(ctxOf(req as AuthedRequest), req.params.id, validate(employeeCommentsBody, req.body))) })
}))
reviewsRouter.post('/:id/acknowledge', wrap(async (req, res) => {
  res.json({ item: serializeReview(await svc.acknowledgeReview(ctxOf(req as AuthedRequest), req.params.id, validate(acknowledgeBody, req.body))) })
}))
