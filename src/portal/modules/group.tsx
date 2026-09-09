import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { RefreshCw, UserPlus, Users2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { errorMessage } from '@/lib/api'
import {
  fmtInr, useGrantGroupAdmin, useGroupAdmins, useGroupMemberships, useGroupOverview,
  type GroupOverviewRow, type GroupRole,
} from '@/lib/hooks/useGroup'
import { Avatar, Card, Empty, Field, PageHead, Pill, inputCls } from '../ui'
import { SearchableUserPicker } from './employee'

// Phase 28 — Group (multi-school/trust) overview, drilldown and membership management. Only reachable when
// the logged-in user has at least one GroupAdmin/GroupViewer membership (Portal.tsx splices this module's
// nav entry in based on useGroupMemberships(), not on `role` — see phase-28 spec). "Create a group" /
// "Join a group" live in Settings instead (src/portal/modules/settings.tsx): a superadmin with ZERO
// memberships needs a way in before this module's nav entry ever appears, since creating/joining is what
// grants that first membership.

export function GroupMod() {
  const navigate = useNavigate()
  const { memberships } = useGroupMemberships()
  const [groupId, setGroupId] = useState(memberships[0]?.groupId ?? '')
  // Render-time resync (no effect needed — see SearchableUserPicker in modules/employee.tsx for the same
  // pattern): if the picked group id is no longer one of the caller's memberships (first load, or a
  // membership was revoked), fall back to the first membership without an extra render pass.
  const effectiveGroupId = memberships.some(m => m.groupId === groupId) ? groupId : (memberships[0]?.groupId ?? '')
  const current = memberships.find(m => m.groupId === effectiveGroupId)
  const isGroupAdmin = current?.role === 'GroupAdmin'

  const { data: overview, loading, error, reload } = useGroupOverview(effectiveGroupId || undefined)

  if (memberships.length === 0) {
    return (
      <div>
        <PageHead title="Group" sub="Cross-campus comparison for multi-school trusts" />
        <Card><Empty text="You are not a member of any school group." /></Card>
      </div>
    )
  }

  return (
    <div>
      <PageHead
        title="Group"
        sub={current ? `${current.groupName} · ${isGroupAdmin ? 'Group Admin' : 'Group Viewer (read-only)'}` : ''}
      >
        <div className="flex items-center gap-2">
          {memberships.length > 1 && (
            <select value={effectiveGroupId} onChange={e => setGroupId(e.target.value)} className={`${inputCls} w-auto py-2`} aria-label="Group">
              {memberships.map(m => <option key={m.groupId} value={m.groupId}>{m.groupName}</option>)}
            </select>
          )}
          <button onClick={() => reload()} className="flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06]">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </PageHead>

      {error ? (
        <Card><Empty text={`Could not load the group overview: ${error}`} /></Card>
      ) : loading || !overview ? (
        <p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p>
      ) : overview.items.length === 0 ? (
        <Card><Empty text="No schools belong to this group yet." /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {overview.items.map(row => (
            <SchoolOverviewCard key={row.schoolId} row={row} onOpen={() => navigate(`/portal/group/schools/${row.schoolId}?groupId=${encodeURIComponent(effectiveGroupId)}`)} />
          ))}
        </div>
      )}

      {effectiveGroupId && (
        <div className="mt-6">
          <AdminsPanel groupId={effectiveGroupId} isGroupAdmin={isGroupAdmin} />
        </div>
      )}
    </div>
  )
}

/* ── per-school overview card ──────────────────────────────────────── */

function SchoolOverviewCard({ row, onOpen }: { row: GroupOverviewRow; onOpen: () => void }) {
  return (
    <Card className="card-lift cursor-pointer" onClick={onOpen}>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[16px] font-semibold">{row.schoolName}</p>
        {!row.termId && <Pill tone="amber">no current term set</Pill>}
      </div>
      <div className="grid grid-cols-2 gap-4 text-[13.5px]">
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Fee collection</p>
          {row.fees ? (
            <>
              <p className="mt-1 text-2xl font-semibold">{row.fees.collectionPct}%</p>
              <p className="text-black/45 dark:text-white/45">{fmtInr(row.fees.collected)} of {fmtInr(row.fees.invoiced)}</p>
            </>
          ) : <p className="mt-1 text-black/40 dark:text-white/40">no current term set</p>}
        </div>
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Attendance</p>
          {row.attendance ? (
            <>
              <p className="mt-1 text-2xl font-semibold">{Math.round(row.attendance.pct)}%</p>
              <p className="text-black/45 dark:text-white/45">{row.attendance.present} / {row.attendance.total}</p>
            </>
          ) : <p className="mt-1 text-black/40 dark:text-white/40">no current term set</p>}
        </div>
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Syllabus pace</p>
          <p className="mt-1 text-2xl font-semibold">{row.syllabusPace.onPacePct}%</p>
          <p className="text-black/45 dark:text-white/45">
            {row.syllabusPace.onPace} on pace · {row.syllabusPace.behind} behind
            {row.syllabusPace.noData > 0 && ` · ${row.syllabusPace.noData} of ${row.syllabusPace.totalTracked + row.syllabusPace.noData} untracked`}
          </p>
        </div>
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Teacher load</p>
          {row.teacherLoad ? (
            <>
              <p className="mt-1 text-2xl font-semibold">{row.teacherLoad.avgPeriodsPerWeek}<span className="text-[13px] font-normal text-black/40 dark:text-white/40"> /wk avg</span></p>
              <p className="text-black/45 dark:text-white/45">{row.teacherLoad.overThresholdCount} of {row.teacherLoad.teacherCount} over {row.teacherLoad.highLoadThreshold}</p>
            </>
          ) : <p className="mt-1 text-black/40 dark:text-white/40">no current term set</p>}
        </div>
      </div>
      <p className="mt-4 text-[12.5px] font-semibold text-indigo-600 dark:text-indigo-400">View drilldown →</p>
    </Card>
  )
}

// The per-school drilldown used to be `DrilldownModal`/`DrilldownBody` here — a modal with its own internal
// report-tab state. Converted to a real routed page, `/portal/group/schools/:id` (src/pages/portal/
// SchoolDetail.tsx), per .agents/edunova/ui-architecture-fix.md Phase D. Data/mutation logic carried over
// verbatim; `fmtInr` above is exported and reused there.

/* ── group admins panel ────────────────────────────────────────────── */

const GROUP_ROLE_OPTIONS: GroupRole[] = ['GroupAdmin', 'GroupViewer']

function AdminsPanel({ groupId, isGroupAdmin }: { groupId: string; isGroupAdmin: boolean }) {
  const { db } = useStore()
  const { items: admins, loading, reload } = useGroupAdmins(groupId)
  const grantAdmin = useGrantGroupAdmin()
  const [pickedUserId, setPickedUserId] = useState('')
  const [manualUserId, setManualUserId] = useState('')
  const [role, setRole] = useState<GroupRole>('GroupViewer')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const userId = (manualUserId.trim() || pickedUserId).trim()
    if (!userId) return
    setBusy(true)
    try {
      await grantAdmin(groupId, userId, role)
      toast.success('Access granted')
      setPickedUserId(''); setManualUserId('')
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
        <Users2 size={14} /> Group admins &amp; viewers
      </div>
      {loading || !admins ? (
        <p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p>
      ) : admins.length === 0 ? (
        <Empty text="No admins granted yet." />
      ) : (
        <div className="mb-5 divide-y divide-black/[.05] dark:divide-white/[.07]">
          {admins.map(a => (
            <div key={a.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={a.user.name} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{a.user.name}</p>
                <p className="truncate text-[12.5px] text-black/45 dark:text-white/45">{a.user.email}</p>
              </div>
              <Pill tone={a.role === 'GroupAdmin' ? 'indigo' : 'slate'}>{a.role === 'GroupAdmin' ? 'Group Admin' : 'Group Viewer'}</Pill>
            </div>
          ))}
        </div>
      )}

      {isGroupAdmin ? (
        <div className="space-y-3 border-t border-black/[.06] pt-4 dark:border-white/[.08]">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold"><UserPlus size={14} /> Grant access</p>
          <SearchableUserPicker label="From this school (pick a user)" employees={db.users} value={pickedUserId} onChange={setPickedUserId} placeholder="Search by name…" />
          <Field label="Or paste a user ID from any school (grants aren't limited to member schools)">
            <input value={manualUserId} onChange={e => setManualUserId(e.target.value)} placeholder="e.g. usr_abc123" className={inputCls} />
          </Field>
          <Field label="Role">
            <select value={role} onChange={e => setRole(e.target.value as GroupRole)} className={inputCls}>
              {GROUP_ROLE_OPTIONS.map(r => <option key={r} value={r}>{r === 'GroupAdmin' ? 'Group Admin (can grant access)' : 'Group Viewer (read-only)'}</option>)}
            </select>
          </Field>
          <button onClick={submit} disabled={busy || (!pickedUserId && !manualUserId.trim())} className="btn-ink px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
            {busy ? 'Granting…' : 'Grant access'}
          </button>
        </div>
      ) : (
        <p className="border-t border-black/[.06] pt-4 text-[12.5px] text-black/45 dark:border-white/[.08] dark:text-white/45">
          You have read-only (Group Viewer) access — only a Group Admin can grant access to others.
        </p>
      )}
    </Card>
  )
}
