import type { z } from 'zod'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notifyMany } from '../../lib/notify'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isAdmin, isStaff, teacherClassIds, wardClassIds, studentClassIds, rosterOf, getClass } from '../../lib/scope'
import type { createPost, patchPost, feedQuery, createComment } from './schema'

// See phase-7-communication.md → /api/feed and Rules → "Post audience".
// Authors: admin/staff/teacher. A teacher may only post to School, or to Class for a class they teach
// (school-wide Role broadcasts and other teachers' classes are staff/admin-only). Edit/delete: author or admin.

const POST_INCLUDE = {
  author: { select: { id: true, name: true, role: true } },
  reactions: { select: { userId: true } },
  comments: { include: { author: { select: { id: true, name: true, role: true } } }, orderBy: { createdAt: 'asc' as const } },
}
type PostWithRelations = Awaited<ReturnType<typeof loadPost>>

async function loadPost(id: string, schoolId: string) {
  return prisma.post.findFirst({ where: { id, schoolId }, include: POST_INCLUDE })
}

export function serializePost(post: NonNullable<PostWithRelations>, ctx: Ctx) {
  return {
    id: post.id,
    author: post.author,
    audience: post.audience,
    classId: post.classId ?? undefined,
    role: post.role ?? undefined,
    title: post.title ?? undefined,
    body: post.body,
    mediaFileIds: post.mediaFileIds,
    pinned: post.pinned,
    publishedAt: post.publishedAt.toISOString(),
    createdAt: post.createdAt.toISOString(),
    likes: post.reactions.length,
    liked: post.reactions.some(r => r.userId === ctx.actorId),
    commentCount: post.comments.length,
    comments: post.comments.map(serializeComment),
  }
}

export const serializeComment = (c: { id: string; body: string; createdAt: Date; author: { id: string; name: string; role: string } }) => ({
  id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), author: c.author,
})

// ── visibility ──

async function relevantClassIds(ctx: Ctx): Promise<string[]> {
  if (ctx.role === 'student') return studentClassIds(ctx.actorId)
  if (ctx.role === 'parent') return wardClassIds(ctx)
  if (ctx.role === 'teacher') return teacherClassIds(ctx)
  return []
}

async function canViewPost(ctx: Ctx, post: { audience: string; classId: string | null; role: string | null }): Promise<boolean> {
  if (isStaff(ctx)) return true
  if (post.audience === 'School') return true
  if (post.audience === 'Role') return post.role === ctx.role
  return (await relevantClassIds(ctx)).includes(post.classId!)
}

// Every user id (School), users of a role + staff/admin (Role), or roster + guardians + teachers +
// staff/admin (Class) — used to notify a post's audience.
async function audienceUserIds(ctx: Ctx, audience: string, classId?: string, role?: string): Promise<string[]> {
  if (audience === 'School') {
    return (await prisma.user.findMany({ where: { schoolId: ctx.schoolId, active: true }, select: { id: true } })).map(u => u.id)
  }
  if (audience === 'Role') {
    return (await prisma.user.findMany({
      where: { schoolId: ctx.schoolId, active: true, OR: [{ role }, { role: { in: ['staff', 'admin', 'superadmin'] } }] },
      select: { id: true },
    })).map(u => u.id)
  }
  const roster = await rosterOf(classId!)
  const studentIds = roster.map(r => r.id)
  const [guardians, teachers, staffAdmin] = await Promise.all([
    prisma.guardian.findMany({ where: { studentId: { in: studentIds } }, select: { parentId: true } }),
    prisma.user.findMany({ where: { schoolId: ctx.schoolId, OR: [{ classTeacherOf: { some: { id: classId } } }, { teaching: { some: { classId } } }] }, select: { id: true } }),
    prisma.user.findMany({ where: { schoolId: ctx.schoolId, role: { in: ['staff', 'admin', 'superadmin'] } }, select: { id: true } }),
  ])
  return [...studentIds, ...guardians.map(g => g.parentId), ...teachers.map(t => t.id), ...staffAdmin.map(s => s.id)]
}

// ── reads ──

export async function listFeed(ctx: Ctx, q: z.infer<typeof feedQuery>) {
  const where: Record<string, unknown> = { schoolId: ctx.schoolId }
  if (q.audience) where.audience = q.audience

  const posts = await prisma.post.findMany({ where, include: POST_INCLUDE, orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }] })
  if (isStaff(ctx)) return posts.map(p => serializePost(p, ctx))

  const classIds = new Set(await relevantClassIds(ctx))
  const visible = posts.filter(p => p.audience === 'School' || (p.audience === 'Role' && p.role === ctx.role) || (p.audience === 'Class' && classIds.has(p.classId!)))
  return visible.map(p => serializePost(p, ctx))
}

async function getVisible(ctx: Ctx, id: string) {
  const post = await loadPost(id, ctx.schoolId)
  if (!post) throw notFound('Post')
  if (!(await canViewPost(ctx, post))) throw new HttpError(403, 'You cannot view this post')
  return post
}

// ── writes ──

export async function createPostSvc(ctx: Ctx, input: z.infer<typeof createPost>) {
  if (ctx.role !== 'teacher' && !isStaff(ctx)) throw new HttpError(403, 'Only teachers, staff or admin may post to the feed')

  if (input.audience === 'Class') {
    await getClass(ctx, input.classId!)
    if (ctx.role === 'teacher' && !(await teacherClassIds(ctx)).includes(input.classId!)) {
      throw new HttpError(403, 'You do not teach this class')
    }
  }
  if (input.audience === 'Role' && ctx.role === 'teacher') {
    throw new HttpError(403, 'Only staff/admin may post to a role audience')
  }

  const row = await prisma.post.create({
    data: {
      schoolId: ctx.schoolId, authorId: ctx.actorId, audience: input.audience,
      classId: input.audience === 'Class' ? input.classId : null,
      role: input.audience === 'Role' ? input.role : null,
      title: input.title ?? null, body: input.body, mediaFileIds: input.mediaFileIds ?? [],
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'post', row.id, undefined, { audience: row.audience, classId: row.classId, role: row.role })

  const audience = await audienceUserIds(ctx, input.audience, input.classId, input.role)
  await notifyMany(ctx.schoolId, audience.filter(id => id !== ctx.actorId), 'post', input.title ?? 'New post', input.body.slice(0, 140), 'feed')

  return (await loadPost(row.id, ctx.schoolId))!
}

async function getOwnedOrAdmin(ctx: Ctx, id: string) {
  const post = await prisma.post.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!post) throw notFound('Post')
  if (post.authorId !== ctx.actorId && !isAdmin(ctx)) throw new HttpError(403, 'Only the author or admin may modify this post')
  return post
}

export async function updatePost(ctx: Ctx, id: string, input: z.infer<typeof patchPost>) {
  const before = await getOwnedOrAdmin(ctx, id)
  if (input.pinned !== undefined && !isAdmin(ctx)) throw new HttpError(403, 'Only admin may pin/unpin a post')
  await prisma.post.update({
    where: { id },
    data: { title: input.title, body: input.body, mediaFileIds: input.mediaFileIds, pinned: input.pinned },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'post', id, { title: before.title, body: before.body }, { title: input.title, body: input.body })
  return (await loadPost(id, ctx.schoolId))!
}

export async function deletePost(ctx: Ctx, id: string) {
  await getOwnedOrAdmin(ctx, id)
  await prisma.post.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'post', id)
}

export async function togglePin(ctx: Ctx, id: string) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'Only admin may pin/unpin a post')
  const post = await prisma.post.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!post) throw notFound('Post')
  await prisma.post.update({ where: { id }, data: { pinned: !post.pinned } })
  await audit(ctx.schoolId, ctx.actorId, post.pinned ? 'unpin' : 'pin', 'post', id)
  return (await loadPost(id, ctx.schoolId))!
}

export async function toggleReaction(ctx: Ctx, id: string) {
  await getVisible(ctx, id)
  const existing = await prisma.postReaction.findUnique({ where: { postId_userId: { postId: id, userId: ctx.actorId } } })
  if (existing) {
    await prisma.postReaction.delete({ where: { id: existing.id } })
  } else {
    await prisma.postReaction.create({ data: { postId: id, userId: ctx.actorId } })
  }
  return (await loadPost(id, ctx.schoolId))!
}

export async function listComments(ctx: Ctx, id: string) {
  const post = await getVisible(ctx, id)
  return post.comments.map(serializeComment)
}

export async function addComment(ctx: Ctx, id: string, input: z.infer<typeof createComment>) {
  await getVisible(ctx, id)
  const row = await prisma.postComment.create({ data: { postId: id, authorId: ctx.actorId, body: input.body }, include: { author: { select: { id: true, name: true, role: true } } } })
  const post = await prisma.post.findUniqueOrThrow({ where: { id } })
  if (post.authorId !== ctx.actorId) await notifyMany(ctx.schoolId, [post.authorId], 'post-comment', 'New comment on your post', input.body.slice(0, 140), 'feed')
  return serializeComment(row)
}

export async function deleteComment(ctx: Ctx, id: string, commentId: string) {
  const comment = await prisma.postComment.findFirst({ where: { id: commentId, postId: id } })
  if (!comment) throw notFound('Comment')
  if (comment.authorId !== ctx.actorId && !isAdmin(ctx)) throw new HttpError(403, 'Only the comment author or admin may delete this comment')
  await prisma.postComment.delete({ where: { id: commentId } })
}
