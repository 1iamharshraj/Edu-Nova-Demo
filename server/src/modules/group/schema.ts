import { z } from 'zod'
import { idStr } from '../../lib/validate'

export const createGroupBody = z.object({ name: z.string().min(1).max(200) })

// schoolId is optional — omitted, the caller's own school (ctx.schoolId) is used, which is also the only
// value it's allowed to be (server/src/modules/group/service.ts#addSchool enforces this — see phase-28
// spec §3: "superadmin of that specific School only, to prevent someone claiming another school into
// their group without that school's own admin consent").
export const addSchoolBody = z.object({ schoolId: idStr.optional() })

export const grantAdminBody = z.object({ userId: idStr, role: z.enum(['GroupAdmin', 'GroupViewer']) })

export const overviewQuery = z.object({ termId: idStr.optional() })

export const drilldownQuery = z.object({
  termId: idStr.optional(),
  report: z.enum(['fees', 'attendance', 'syllabus', 'teacherLoad']).optional(),
})
