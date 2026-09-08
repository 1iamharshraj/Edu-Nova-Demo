import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../../auth'
import { wrap } from '../../lib/errors'
import { ctxOf } from '../../lib/rbac'
import { validate } from '../../lib/validate'
import * as svc from './service'
import { createPost, patchPost, feedQuery, createComment } from './schema'

// /api/feed — see phase-7-communication.md.
export const feedRouter = Router()
feedRouter.use(requireAuth)

feedRouter.get('/', wrap(async (req, res) => {
  res.json({ items: await svc.listFeed(ctxOf(req as AuthedRequest), validate(feedQuery, req.query)) })
}))
feedRouter.post('/', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  res.status(201).json({ item: svc.serializePost(await svc.createPostSvc(ctx, validate(createPost, req.body)), ctx) })
}))
feedRouter.patch('/:id', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  res.json({ item: svc.serializePost(await svc.updatePost(ctx, req.params.id, validate(patchPost, req.body)), ctx) })
}))
feedRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deletePost(ctxOf(req as AuthedRequest), req.params.id)
  res.json({ ok: true })
}))
feedRouter.post('/:id/react', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  res.json({ item: svc.serializePost(await svc.toggleReaction(ctx, req.params.id), ctx) })
}))
feedRouter.get('/:id/comments', wrap(async (req, res) => {
  res.json({ items: await svc.listComments(ctxOf(req as AuthedRequest), req.params.id) })
}))
feedRouter.post('/:id/comments', wrap(async (req, res) => {
  res.status(201).json({ item: await svc.addComment(ctxOf(req as AuthedRequest), req.params.id, validate(createComment, req.body)) })
}))
feedRouter.delete('/:id/comments/:cid', wrap(async (req, res) => {
  await svc.deleteComment(ctxOf(req as AuthedRequest), req.params.id, req.params.cid)
  res.json({ ok: true })
}))
feedRouter.post('/:id/pin', wrap(async (req, res) => {
  const ctx = ctxOf(req as AuthedRequest)
  res.json({ item: svc.serializePost(await svc.togglePin(ctx, req.params.id), ctx) })
}))
