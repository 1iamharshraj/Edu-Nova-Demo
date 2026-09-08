import type { z } from 'zod'
import type { Highlight } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isStaff, getClass, teacherClassIds, wardClassIds, studentClassIds } from '../../lib/scope'
import type { createHighlight, patchHighlight } from './schema'

// See phase-9-10-integrations-hardening.md → item 2 (Event Highlights CMS). Audience-scoped like
// CalendarEvent (Phase 7): School = everyone, Class = that class's students/parents/teachers. Writes:
// staff/admin/superadmin only.

export const serializeHighlight = (h: Highlight) => ({
  id: h.id, title: h.title, url: h.url, thumbnailFileId: h.thumbnailFileId ?? undefined,
  audience: h.audience, classId: h.classId ?? undefined, publishedAt: h.publishedAt.toISOString(),
  createdById: h.createdById, createdAt: h.createdAt.toISOString(),
})

export async function listHighlights(ctx: Ctx) {
  const rows = await prisma.highlight.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ publishedAt: 'desc' }] })
  if (isStaff(ctx)) return rows.map(serializeHighlight)

  let classIds: string[] = []
  if (ctx.role === 'student') classIds = await studentClassIds(ctx.actorId)
  else if (ctx.role === 'parent') classIds = await wardClassIds(ctx)
  else if (ctx.role === 'teacher') classIds = await teacherClassIds(ctx)

  return rows.filter(h => h.audience === 'School' || (h.audience === 'Class' && classIds.includes(h.classId!))).map(serializeHighlight)
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.highlight.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Highlight')
  return row
}

export async function createHighlightSvc(ctx: Ctx, input: z.infer<typeof createHighlight>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may create highlights')
  if (input.audience === 'Class') await getClass(ctx, input.classId!)
  if (input.thumbnailFileId) {
    const file = await prisma.file.findFirst({ where: { id: input.thumbnailFileId, schoolId: ctx.schoolId } })
    if (!file) throw new HttpError(400, 'Unknown thumbnailFileId')
  }
  const row = await prisma.highlight.create({
    data: {
      schoolId: ctx.schoolId, title: input.title, url: input.url, thumbnailFileId: input.thumbnailFileId ?? null,
      audience: input.audience, classId: input.audience === 'Class' ? input.classId : null,
      publishedAt: input.publishedAt ? new Date(input.publishedAt) : new Date(), createdById: ctx.actorId,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'highlight', row.id, undefined, serializeHighlight(row))
  return row
}

export async function updateHighlight(ctx: Ctx, id: string, input: z.infer<typeof patchHighlight>) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may edit highlights')
  const before = await get(ctx, id)
  if (input.audience === 'Class' && input.classId) await getClass(ctx, input.classId)
  if (input.thumbnailFileId) {
    const file = await prisma.file.findFirst({ where: { id: input.thumbnailFileId, schoolId: ctx.schoolId } })
    if (!file) throw new HttpError(400, 'Unknown thumbnailFileId')
  }
  const audience = input.audience ?? before.audience
  const row = await prisma.highlight.update({
    where: { id },
    data: {
      title: input.title, url: input.url,
      thumbnailFileId: input.thumbnailFileId === undefined ? undefined : input.thumbnailFileId,
      audience: input.audience,
      classId: audience === 'Class' ? (input.classId ?? before.classId) : (input.audience ? null : input.classId),
      publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
    },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'highlight', id, serializeHighlight(before), serializeHighlight(row))
  return row
}

export async function deleteHighlight(ctx: Ctx, id: string) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Only staff/admin may delete highlights')
  const before = await get(ctx, id)
  await prisma.highlight.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'highlight', id, serializeHighlight(before))
}
