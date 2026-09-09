import { useCallback } from 'react'
import { api } from '../api'
import { useStore, type GroupMembership, type GroupRole } from '../store'
import { qs, useList, useOne } from './useAcademics'

// Data hooks + mutation helpers for Phase 28: multi-school/group management. See
// .agents/edunova/phase-28-multi-school-group.md and server/src/modules/group/{router,service,schema}.ts
// for the real, final shapes this file mirrors.
//
// Group membership is orthogonal to the ordinary `role`/`schoolId` axis this app is built around — a
// user's GroupAdmin/GroupViewer grants are fetched once per session (`GET /group/mine`, cached on
// StoreCtx.groupMine alongside `user` — see src/lib/store.tsx) rather than through a per-component fetch.

export type { GroupMembership, GroupRole }

/** Shared by group.tsx and the routed `/portal/group/schools/:id` page (src/pages/portal/SchoolDetail.tsx). */
export const fmtInr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

export interface GroupSchool { id: string; name: string; createdAt: string }

export interface GroupFeesSummary { collected: number; outstanding: number; invoiced: number; collectionPct: number }
export interface GroupAttendanceSummary { present: number; total: number; pct: number }
export interface GroupSyllabusPace { onPace: number; behind: number; noData: number; totalTracked: number; onPacePct: number }
export interface GroupTeacherLoad { teacherCount: number; avgPeriodsPerWeek: number; overThresholdCount: number; highLoadThreshold: number }

export interface GroupOverviewRow {
  schoolId: string
  schoolName: string
  termId: string | null
  fees: GroupFeesSummary | null
  attendance: GroupAttendanceSummary | null
  syllabusPace: GroupSyllabusPace
  teacherLoad: GroupTeacherLoad | null
}
export interface GroupOverviewResponse { groupId: string; items: GroupOverviewRow[] }

export type GroupDrilldownReport = 'fees' | 'attendance' | 'syllabus' | 'teacherLoad'
export const GROUP_DRILLDOWN_REPORTS: GroupDrilldownReport[] = ['fees', 'attendance', 'syllabus', 'teacherLoad']
export interface GroupDrilldownResponse {
  report: GroupDrilldownReport
  schoolId: string
  schoolName: string
  termId: string | null
  data: unknown
}

export interface GroupAdminEntry {
  id: string
  groupId: string
  userId: string
  role: GroupRole
  createdAt: string
  user: { id: string; name: string; email: string; schoolId: string }
}

/** This session's group memberships + which group (if any) the caller's own school belongs to — cached
 *  once on StoreCtx by the boot/login flow, no per-mount fetch here. */
export function useGroupMemberships() {
  const { groupMine, refreshGroupMine } = useStore()
  return {
    memberships: groupMine?.memberships ?? [],
    school: groupMine?.school ?? null,
    /** True once `/group/mine` has resolved (memberships/school below are then final for this session). */
    ready: groupMine !== null,
    refresh: refreshGroupMine,
  }
}

/** `GET /group/:groupId/schools` — member schools list. Any group member (admin or viewer). */
export function useGroupSchools(groupId: string | undefined, enabled = true) {
  return useList<GroupSchool>(enabled && groupId ? `/group/${groupId}/schools` : null)
}

/** `GET /group/:groupId/overview?termId=` — the cross-campus comparison. `termId` is best-effort/per-school. */
export function useGroupOverview(groupId: string | undefined, termId?: string, enabled = true) {
  return useOne<GroupOverviewResponse>(enabled && groupId ? `/group/${groupId}/overview${qs({ termId })}` : null)
}

/** `GET /group/:groupId/school/:schoolId/drilldown?termId=&report=` */
export function useGroupDrilldown(
  groupId: string | undefined, schoolId: string | undefined, report: GroupDrilldownReport, termId?: string, enabled = true,
) {
  const path = enabled && groupId && schoolId ? `/group/${groupId}/school/${schoolId}/drilldown${qs({ termId, report })}` : null
  return useOne<GroupDrilldownResponse>(path)
}

/** `GET /group/:id/admins` — any group member. */
export function useGroupAdmins(groupId: string | undefined, enabled = true) {
  return useList<GroupAdminEntry>(enabled && groupId ? `/group/${groupId}/admins` : null)
}

/** `POST /group` — superadmin-only. Creator auto-becomes GroupAdmin; their own school does NOT auto-join. */
export function useCreateGroup() {
  const { refreshGroupMine } = useStore()
  return useCallback(async (name: string) => {
    const res = await api.post<{ item: { id: string; name: string; createdAt: string } }>('/group', { name })
    await refreshGroupMine()
    return res.item
  }, [refreshGroupMine])
}

/** `POST /group/:id/schools` — superadmin-only, adds the CALLER'S OWN school. 409 if already in another group. */
export function useJoinGroup() {
  const { refreshGroupMine } = useStore()
  return useCallback(async (groupId: string) => {
    const res = await api.post<{ item: { id: string; name: string; groupId: string } }>(`/group/${groupId}/schools`, {})
    await refreshGroupMine()
    return res.item
  }, [refreshGroupMine])
}

/** `POST /group/:id/admins` — GroupAdmin role only (a GroupViewer gets a 403 from the server). */
export function useGrantGroupAdmin() {
  return useCallback(async (groupId: string, userId: string, role: GroupRole) => {
    const res = await api.post<{ item: GroupAdminEntry }>(`/group/${groupId}/admins`, { userId, role })
    return res.item
  }, [])
}
