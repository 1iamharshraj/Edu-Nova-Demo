import { useMemo } from 'react'
import { useParams } from 'react-router'
import { useStore } from '@/lib/store'
import { Empty, PageHead } from '@/portal/ui'
import { CallLogPanel } from '@/portal/modules/feeDefaulters'
import { PortalPageShell } from './PortalPageShell'

// Was `CallLogModal` in portal/modules/feeDefaulters.tsx, opened via the "Call log" button on a defaulter's
// row. Converted to a real routed page per .agents/edunova/ui-architecture-fix.md Phase D #1. Note the
// separate "Call Log" tab (`CallLogBrowser`, same file) is untouched — it's already a browse-any-student
// page-like screen with its own AsyncEntityPicker, not a modal, so it's out of scope for this conversion.
export default function FeeDefaulterCallLog() {
  const { studentId } = useParams<{ studentId: string }>()
  const { db } = useStore()
  const student = useMemo(() => db.users.find(u => u.id === studentId) ?? null, [db.users, studentId])

  return (
    <PortalPageShell backLabel="Back to fee defaulters">
      {!studentId ? (
        <Empty text="No student selected." />
      ) : (
        <>
          <PageHead title={`Call log — ${student?.name ?? ''}`} sub="Record a call and review call history for this student" />
          <CallLogPanel studentId={studentId} studentName={student?.name ?? 'Student'} />
        </>
      )}
    </PortalPageShell>
  )
}
