import { useMemo } from 'react'
import { useParams } from 'react-router'
import { useStore } from '@/lib/store'
import { canManageDisciplinary, isAdmin } from '@/lib/access'
import { useDisciplinaryCases, disciplinaryTone } from '@/lib/hooks/useWelfare'
import { Empty, PageHead, Pill } from '@/portal/ui'
import { CaseDetailPanel } from '@/portal/modules/disciplinary'
import { PortalPageShell } from './PortalPageShell'

// Was `CaseDetailModal` in portal/modules/disciplinary.tsx, opened via a case's "Review case"/"View case"
// button. Converted to a real routed page per .agents/edunova/ui-architecture-fix.md Phase D #2.
// There's no GET /discipline/:id single-fetch endpoint (see phase-8-welfare.md) — same as the modal, which
// only ever had the case row it was passed from the already-fetched list — so this page re-fetches that same
// list (`useDisciplinaryCases`) and finds the matching id; the server already scopes what each viewer can see
// (reporters/staff/admin: theirs or all; parent/student: own), so no extra client-side access check is needed.
export default function DisciplinaryCaseDetail() {
  const { id } = useParams<{ id: string }>()
  const { db, user } = useStore()
  const canManage = user ? canManageDisciplinary(user) : false
  const canSeeArchived = user ? isAdmin(user) : false
  const { items: cases, loading, error, reload } = useDisciplinaryCases({ includeArchived: canSeeArchived }, !!user)
  const caseRec = useMemo(() => (cases ?? []).find(c => c.id === id) ?? null, [cases, id])
  const nameOf = (uid: string) => db.users.find(u => u.id === uid)?.name ?? uid

  return (
    <PortalPageShell backLabel="Back to discipline">
      {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading case…</p>}
      {!loading && (error || !caseRec) && <Empty text={error || 'Case not found.'} />}
      {!loading && caseRec && (
        <>
          <PageHead title={caseRec.title} sub={caseRec.studentName ?? nameOf(caseRec.studentId)}>
            <Pill tone={disciplinaryTone(caseRec.status)}>{caseRec.status}</Pill>
          </PageHead>
          <CaseDetailPanel caseRec={caseRec} canManage={canManage} nameOf={nameOf} onChanged={reload} />
        </>
      )}
    </PortalPageShell>
  )
}
