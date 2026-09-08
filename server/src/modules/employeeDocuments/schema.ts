import { z } from 'zod'
import { idStr } from '../../lib/validate'

// See phase-11-employee-management.md → A6. No new file-storage code: the client uploads via the
// existing POST /api/files first, then attaches the returned fileId here with a label.
export const addDocument = z.object({
  fileId: idStr,
  label: z.string().trim().min(1).max(120),
})
