import { z } from 'zod'

// Shared cursor-pagination query shape: `?limit=&cursor=`. `cursor` is always the `id` of the last item
// of the previous page (any consumer's `orderBy` may sort on a different field — Prisma's cursor
// pagination positions on the cursor record's rank under that `orderBy`, not on `id` itself, so this
// works regardless of sort field as long as `id` is part of a stable tiebreaker).
export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().min(1).optional(),
})

export type PaginationInput = z.infer<typeof paginationQuery>

/**
 * Runs `findMany` for one page beyond `opts.cursor`, returning `{ items, nextCursor }`.
 * `findMany` receives `{ take, cursor?, skip? }` to splice into its own where/orderBy/include —
 * callers own the rest of the query so existing filters are untouched.
 * Omitting `cursor` returns the first page exactly like an unpaginated `findMany` capped at `defaultLimit`
 * — the existing behaviour every caller had before pagination was added.
 */
export async function paginate<T extends { id: string }>(
  findMany: (args: { take: number; cursor?: { id: string }; skip?: number }) => Promise<T[]>,
  opts: { limit?: number; cursor?: string; defaultLimit: number; maxLimit?: number },
): Promise<{ items: T[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? opts.defaultLimit, opts.maxLimit ?? opts.defaultLimit)
  const rows = await findMany({
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  })
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null }
}
