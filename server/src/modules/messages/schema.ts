import { z } from 'zod'
import { idStr } from '../../lib/validate'
import { paginationQuery } from '../../lib/pagination'

export const createConversation = z.object({
  userIds: z.array(idStr).min(1).max(200).optional(),
  classId: idStr.optional(),
  title: z.string().trim().max(200).optional(),
}).refine(v => !!v.userIds !== !!v.classId, { message: 'Provide exactly one of userIds or classId' })

// `before` (ISO timestamp) is the original "load older messages" cursor and keeps working unchanged;
// `cursor`/`limit` are the Phase 10 additions — an id-based cursor from a previous page's `nextCursor`.
export const messagesQuery = paginationQuery.extend({ before: z.string().datetime().optional() })

export const createMessage = z.object({
  body: z.string().trim().min(1).max(10_000),
  fileIds: z.array(idStr).max(20).optional(),
})
