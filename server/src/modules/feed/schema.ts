import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const AUDIENCES = ['School', 'Class', 'Role'] as const
export const POST_ROLES = ['student', 'parent', 'teacher', 'staff', 'admin'] as const

export const createPost = z.object({
  audience: z.enum(AUDIENCES),
  classId: idStr.optional(),
  role: z.enum(POST_ROLES).optional(),
  title: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(20_000),
  mediaFileIds: z.array(idStr).max(20).optional(),
}).refine(v => v.audience !== 'Class' || !!v.classId, { message: 'classId is required for Class audience', path: ['classId'] })
  .refine(v => v.audience !== 'Role' || !!v.role, { message: 'role is required for Role audience', path: ['role'] })

export const patchPost = z.object({
  title: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
  mediaFileIds: z.array(idStr).max(20).optional(),
  pinned: z.boolean().optional(),
})

export const feedQuery = z.object({ audience: z.enum(AUDIENCES).optional() })

export const createComment = z.object({ body: z.string().trim().min(1).max(2_000) })

export const pinBody = z.object({ pinned: z.boolean().optional() })
