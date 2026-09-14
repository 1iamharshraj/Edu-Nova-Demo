// Phase 28 multi-school group membership. The static demo is a single school with no group, so this
// just returns the "no group" shape store.tsx already handles gracefully (`fetchGroupMine` catches
// and falls back to null on any error, and a null groupMine renders the same as "not in a group").

import { route, requireAuth } from '../router'
import { SCHOOL_ID } from '../store'

route('GET', '/group/mine', (ctx) => {
  requireAuth(ctx)
  return { memberships: [], school: { id: SCHOOL_ID, groupId: null, groupName: null } }
})
