// Mirrors server/src/modules/feed/{router,service,schema}.ts's contract for src/portal/modules/social.tsx.
// Authors: admin/staff/teacher (a teacher only to School or a class they teach); edit/delete/pin: author
// or admin.

import { route, requireAuth, status } from '../router'
import { badRequest, forbidden, notFound } from '../http'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { isAdmin, isStaff, teacherClassIds, wardClassIds, studentClassIds, getClass } from './examsAcademicsScope'
import type { Actor } from '../router'

function serializeComment(c: Row) {
  const author = table('User').find(u => u.id === c.authorId)
  return { id: c.id, body: c.body, createdAt: c.createdAt, author: author ? { id: author.id, name: author.name, role: author.role } : undefined }
}
function serializePost(post: Row, actor: Actor) {
  const author = table('User').find(u => u.id === post.authorId)
  const reactions = table('PostReaction').filter(r => r.postId === post.id)
  const comments = table('PostComment').filter(c => c.postId === post.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  return {
    id: post.id, author: author ? { id: author.id, name: author.name, role: author.role } : undefined, audience: post.audience,
    classId: post.classId ?? undefined, role: post.role ?? undefined, title: post.title ?? undefined, body: post.body,
    mediaFileIds: post.mediaFileIds ?? [], pinned: !!post.pinned, publishedAt: post.publishedAt, createdAt: post.createdAt,
    likes: reactions.length, liked: reactions.some(r => r.userId === actor.userId), commentCount: comments.length, comments: comments.map(serializeComment),
  }
}

function relevantClassIds(actor: Actor): string[] {
  if (actor.role === 'student') return studentClassIds(actor.userId)
  if (actor.role === 'parent') return wardClassIds(actor)
  if (actor.role === 'teacher') return teacherClassIds(actor.userId)
  return []
}
function canViewPost(actor: Actor, post: Row): boolean {
  if (isStaff(actor.role)) return true
  if (post.audience === 'School') return true
  if (post.audience === 'Role') return post.role === actor.role
  return relevantClassIds(actor).includes(post.classId as string)
}

route('GET', '/feed', (ctx) => {
  const actor = requireAuth(ctx)
  const { audience } = ctx.query
  let rows = table('Post').filter(p => p.schoolId === actor.schoolId)
  if (audience) rows = rows.filter(p => p.audience === audience)
  rows = [...rows].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || String(b.publishedAt).localeCompare(String(a.publishedAt)))
  const visible = isStaff(actor.role) ? rows : rows.filter(p => canViewPost(actor, p))
  return { items: visible.map(p => serializePost(p, actor)) }
})

route('POST', '/feed', (ctx) => {
  const actor = requireAuth(ctx)
  if (actor.role !== 'teacher' && !isStaff(actor.role)) throw forbidden('Only teachers, staff or admin may post to the feed')
  const body = ctx.body as { audience?: string; classId?: string; role?: string; title?: string; body?: string; mediaFileIds?: string[] }
  if (!body.body?.trim()) throw badRequest('body is required')
  if (body.audience === 'Class') {
    if (!body.classId) throw badRequest('classId is required for Class audience')
    getClass(actor, body.classId)
    if (actor.role === 'teacher' && !teacherClassIds(actor.userId).includes(body.classId)) throw forbidden('You do not teach this class')
  } else if (body.audience === 'Role') {
    if (!body.role) throw badRequest('role is required for Role audience')
    if (actor.role === 'teacher') throw forbidden('Only staff/admin may post to a role audience')
  } else if (body.audience !== 'School') {
    throw badRequest('audience must be School, Class or Role')
  }
  const row: Row = {
    id: uid('post'), schoolId: actor.schoolId, authorId: actor.userId, audience: body.audience,
    classId: body.audience === 'Class' ? body.classId : null, role: body.audience === 'Role' ? body.role : null,
    title: body.title ?? null, body: body.body, mediaFileIds: body.mediaFileIds ?? [], pinned: false, publishedAt: nowIso(), createdAt: nowIso(),
  }
  const rows = table('Post'); rows.push(row); saveTable('Post', rows)
  return status(201, { item: serializePost(row, actor) })
})

function getOwnedOrAdmin(actor: Actor, id: string): Row {
  const post = table('Post').find(p => p.id === id && p.schoolId === actor.schoolId)
  if (!post) throw notFound('Post')
  if (post.authorId !== actor.userId && !isAdmin(actor.role)) throw forbidden('Only the author or admin may modify this post')
  return post
}

route('PATCH', '/feed/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getOwnedOrAdmin(actor, ctx.params.id)
  const body = ctx.body as { title?: string; body?: string; mediaFileIds?: string[]; pinned?: boolean }
  if (body.pinned !== undefined && !isAdmin(actor.role)) throw forbidden('Only admin may pin/unpin a post')
  const rows = table('Post'); const idx = rows.findIndex(p => p.id === before.id)
  rows[idx] = { ...rows[idx], ...(body.title !== undefined ? { title: body.title } : {}), ...(body.body !== undefined ? { body: body.body } : {}), ...(body.mediaFileIds !== undefined ? { mediaFileIds: body.mediaFileIds } : {}), ...(body.pinned !== undefined ? { pinned: body.pinned } : {}) }
  saveTable('Post', rows)
  return { item: serializePost(rows[idx], actor) }
})

route('DELETE', '/feed/:id', (ctx) => {
  const actor = requireAuth(ctx)
  const before = getOwnedOrAdmin(actor, ctx.params.id)
  const rows = table('Post'); const idx = rows.findIndex(p => p.id === before.id)
  rows.splice(idx, 1)
  saveTable('Post', rows)
  saveTable('PostReaction', table('PostReaction').filter(r => r.postId !== before.id))
  saveTable('PostComment', table('PostComment').filter(c => c.postId !== before.id))
  return { ok: true }
})

route('POST', '/feed/:id/react', (ctx) => {
  const actor = requireAuth(ctx)
  const post = table('Post').find(p => p.id === ctx.params.id && p.schoolId === actor.schoolId)
  if (!post) throw notFound('Post')
  if (!canViewPost(actor, post)) throw forbidden('You cannot view this post')
  const rows = table('PostReaction')
  const idx = rows.findIndex(r => r.postId === post.id && r.userId === actor.userId)
  if (idx === -1) rows.push({ id: uid('postreaction'), postId: post.id, userId: actor.userId, createdAt: nowIso() } as Row)
  else rows.splice(idx, 1)
  saveTable('PostReaction', rows)
  return { item: serializePost(post, actor) }
})

route('GET', '/feed/:id/comments', (ctx) => {
  const actor = requireAuth(ctx)
  const post = table('Post').find(p => p.id === ctx.params.id && p.schoolId === actor.schoolId)
  if (!post) throw notFound('Post')
  if (!canViewPost(actor, post)) throw forbidden('You cannot view this post')
  return { items: table('PostComment').filter(c => c.postId === post.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(serializeComment) }
})

route('POST', '/feed/:id/comments', (ctx) => {
  const actor = requireAuth(ctx)
  const post = table('Post').find(p => p.id === ctx.params.id && p.schoolId === actor.schoolId)
  if (!post) throw notFound('Post')
  if (!canViewPost(actor, post)) throw forbidden('You cannot view this post')
  const { body } = ctx.body as { body?: string }
  if (!body?.trim()) throw badRequest('body is required')
  const row: Row = { id: uid('postcomment'), postId: post.id, authorId: actor.userId, body, createdAt: nowIso() }
  const rows = table('PostComment'); rows.push(row); saveTable('PostComment', rows)
  return status(201, { item: serializeComment(row) })
})

route('DELETE', '/feed/:id/comments/:cid', (ctx) => {
  const actor = requireAuth(ctx)
  const comment = table('PostComment').find(c => c.id === ctx.params.cid && c.postId === ctx.params.id)
  if (!comment) throw notFound('Comment')
  if (comment.authorId !== actor.userId && !isAdmin(actor.role)) throw forbidden('Only the comment author or admin may delete this comment')
  saveTable('PostComment', table('PostComment').filter(c => c.id !== comment.id))
  return { ok: true }
})

route('POST', '/feed/:id/pin', (ctx) => {
  const actor = requireAuth(ctx)
  if (!isAdmin(actor.role)) throw forbidden('Only admin may pin/unpin a post')
  const post = table('Post').find(p => p.id === ctx.params.id && p.schoolId === actor.schoolId)
  if (!post) throw notFound('Post')
  const rows = table('Post'); const idx = rows.findIndex(p => p.id === post.id)
  rows[idx] = { ...rows[idx], pinned: !rows[idx].pinned }
  saveTable('Post', rows)
  return { item: serializePost(rows[idx], actor) }
})
