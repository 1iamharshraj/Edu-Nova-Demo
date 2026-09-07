import { z } from 'zod'
import type { GradeScale } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import type { band, createGradeScale, patchGradeScale } from './schema'

export type Band = z.infer<typeof band>

// Default CBSE 8-point scale used when a school has defined no scale of its own.
export const DEFAULT_BANDS: Band[] = [
  { min: 91, grade: 'A1', points: 10 }, { min: 81, grade: 'A2', points: 9 }, { min: 71, grade: 'B1', points: 8 }, { min: 61, grade: 'B2', points: 7 },
  { min: 51, grade: 'C1', points: 6 }, { min: 41, grade: 'C2', points: 5 }, { min: 33, grade: 'D', points: 4 }, { min: 0, grade: 'E', points: 0 },
]

export const sortBands = (bands: Band[]) => bands.slice().sort((a, b) => b.min - a.min)

export const serializeGradeScale = (g: GradeScale) => ({
  id: g.id, name: g.name, boardId: g.boardId ?? undefined, bands: sortBands(g.bands as Band[]),
})

// First band whose threshold the percentage reaches; below every threshold → the lowest band.
export function gradeFor(bands: Band[], pct: number) {
  const sorted = sortBands(bands)
  const hit = sorted.find(b => pct >= b.min) ?? sorted[sorted.length - 1]
  return { grade: hit.grade, points: hit.points }
}

// Resolution order (contract): the class board's scale → the school's first scale → the built-in default.
export async function scaleForBoard(schoolId: string, boardId: string | null | undefined): Promise<{ id?: string; name: string; bands: Band[] }> {
  if (boardId) {
    const own = await prisma.gradeScale.findFirst({ where: { schoolId, boardId }, orderBy: { createdAt: 'asc' } })
    if (own) return { id: own.id, name: own.name, bands: sortBands(own.bands as Band[]) }
  }
  const any = await prisma.gradeScale.findFirst({ where: { schoolId }, orderBy: { createdAt: 'asc' } })
  if (any) return { id: any.id, name: any.name, bands: sortBands(any.bands as Band[]) }
  return { name: 'Default (CBSE 8-point)', bands: DEFAULT_BANDS }
}

export function list(ctx: Ctx) {
  return prisma.gradeScale.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
}

export async function get(ctx: Ctx, id: string) {
  const row = await prisma.gradeScale.findFirst({ where: { id, schoolId: ctx.schoolId } })
  if (!row) throw notFound('Grade scale')
  return row
}

async function assertBoard(ctx: Ctx, boardId: string | null | undefined) {
  if (!boardId) return
  if (!(await prisma.board.findFirst({ where: { id: boardId, schoolId: ctx.schoolId } }))) throw notFound('Board')
}

export async function create(ctx: Ctx, input: z.infer<typeof createGradeScale>) {
  await assertBoard(ctx, input.boardId)
  const row = await prisma.gradeScale.create({ data: { schoolId: ctx.schoolId, name: input.name, boardId: input.boardId ?? null, bands: sortBands(input.bands) } })
  await audit(ctx.schoolId, ctx.actorId, 'create', 'gradeScale', row.id, undefined, serializeGradeScale(row))
  return row
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof patchGradeScale>) {
  const before = await get(ctx, id)
  await assertBoard(ctx, input.boardId)
  const row = await prisma.gradeScale.update({
    where: { id },
    data: { name: input.name, boardId: input.boardId === undefined ? undefined : input.boardId, bands: input.bands ? sortBands(input.bands) : undefined },
  })
  await audit(ctx.schoolId, ctx.actorId, 'update', 'gradeScale', id, serializeGradeScale(before), serializeGradeScale(row))
  return row
}

export async function remove(ctx: Ctx, id: string) {
  const before = await get(ctx, id)
  await prisma.gradeScale.delete({ where: { id } })
  await audit(ctx.schoolId, ctx.actorId, 'delete', 'gradeScale', id, serializeGradeScale(before))
}
