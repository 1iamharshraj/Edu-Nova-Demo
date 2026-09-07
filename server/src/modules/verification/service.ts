import type { z } from 'zod'
import type { ParentVerification } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { assertFileIds } from '../files/service'
import type { submitBody, listQuery } from './schema'

export const serializeVerification = (v: ParentVerification) => ({
  id: v.id,
  parentId: v.parentId,
  method: v.method,
  status: v.status,
  documentFileId: v.documentFileId ?? undefined,
  verifiedById: v.verifiedById ?? undefined,
  verifiedAt: v.verifiedAt?.toISOString(),
  note: v.note ?? undefined,
  createdAt: v.createdAt.toISOString(),
  updatedAt: v.updatedAt.toISOString(),
})

// User.verified is derived from the verification record: true iff status === Verified.
async function syncUserVerified(parentId: string, status: string) {
  await prisma.user.update({ where: { id: parentId }, data: { verified: status === 'Verified' } })
}

export async function mine(ctx: Ctx) {
  if (ctx.role !== 'parent') throw new HttpError(403, 'Only parents have a verification record')
  return prisma.parentVerification.findUnique({ where: { parentId: ctx.actorId } })
}

// POST /me — (re)submits the parent's verification; a Verified record cannot be re-submitted.
export async function submit(ctx: Ctx, input: z.infer<typeof submitBody>) {
  if (ctx.role !== 'parent') throw new HttpError(403, 'Only parents can request verification')
  if (input.documentFileId) await assertFileIds(ctx, [input.documentFileId])
  if (input.method === 'Document' && !input.documentFileId) throw new HttpError(400, 'documentFileId is required for Document verification')
  const before = await prisma.parentVerification.findUnique({ where: { parentId: ctx.actorId } })
  if (before?.status === 'Verified') throw new HttpError(409, 'You are already verified')
  const row = await prisma.parentVerification.upsert({
    where: { parentId: ctx.actorId },
    create: { schoolId: ctx.schoolId, parentId: ctx.actorId, method: input.method, documentFileId: input.documentFileId ?? null, status: 'Pending' },
    update: { method: input.method, documentFileId: input.documentFileId ?? null, status: 'Pending', note: null, verifiedById: null, verifiedAt: null },
  })
  await syncUserVerified(ctx.actorId, row.status)
  await audit(ctx.schoolId, ctx.actorId, before ? 'resubmit' : 'submit', 'parentVerification', row.id, before ? serializeVerification(before) : undefined, serializeVerification(row))
  return row
}

export async function list(ctx: Ctx, q: z.infer<typeof listQuery>) {
  return prisma.parentVerification.findMany({
    where: { schoolId: ctx.schoolId, status: q.status },
    orderBy: [{ createdAt: 'asc' }],
  })
}

async function get(ctx: Ctx, id: string) {
  const row = await prisma.parentVerification.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Verification')
  return row
}

export async function decide(ctx: Ctx, id: string, status: 'Verified' | 'Rejected', note?: string) {
  const before = await get(ctx, id)
  const row = await prisma.parentVerification.update({
    where: { id }, data: { status, note: note ?? (status === 'Verified' ? null : before.note), verifiedById: ctx.actorId, verifiedAt: new Date() },
  })
  await syncUserVerified(row.parentId, row.status)
  await audit(ctx.schoolId, ctx.actorId, status === 'Verified' ? 'verify' : 'reject', 'parentVerification', id, serializeVerification(before), serializeVerification(row))
  return row
}
