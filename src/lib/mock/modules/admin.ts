// Mock stand-ins for /api/admin/reset and /api/admin/load-sample-data. On the real backend these
// operate on an otherwise-empty school; in this static demo there's only ever one seeded school, so
// both actions collapse to "reseed everything" — reset empties it back to the same fixture data
// rather than a genuinely blank school, which is a deliberate simplification (see the roadmap note
// in .agents/edunova/static-demo-plan.md) since a truly empty demo has nothing to click through.

import { route, requireRole } from '../router'
import { resetDB } from '../store'

route('POST', '/admin/reset', (ctx) => {
  requireRole(ctx, 'superadmin')
  resetDB()
  return { ok: true }
})

route('POST', '/admin/load-sample-data', (ctx) => {
  requireRole(ctx, 'superadmin')
  resetDB()
  return { ok: true }
})
