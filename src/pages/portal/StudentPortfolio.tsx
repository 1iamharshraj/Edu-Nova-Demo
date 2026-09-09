import { useMemo } from 'react'
import { useParams } from 'react-router'
import { useStore } from '@/lib/store'
import { Empty, PageHead } from '@/portal/ui'
import { PortfolioView } from '@/portal/modules/culture'
import { PortalPageShell } from './PortalPageShell'

// Was `ViewPortfolioButton`'s modal in portal/modules/culture.tsx — the staff/admin/teacher "view someone
// else's portfolio" access point opened from the Student Profile Report screen (portal/modules/studentReport.tsx).
// Converted to a real routed page per .agents/edunova/ui-architecture-fix.md Phase D #3. `PortfolioView` itself
// needs no changes — it already just takes `studentId`. The self-service "My Portfolio" (`PortfolioMod` in
// culture.tsx) is untouched: it's already a standalone sidebar screen, not a modal, so it's out of scope here.
export default function StudentPortfolio() {
  const { id } = useParams<{ id: string }>()
  const { db } = useStore()
  const student = useMemo(() => db.users.find(u => u.id === id) ?? null, [db.users, id])

  return (
    <PortalPageShell backLabel="Back">
      {!id ? (
        <Empty text="No student selected." />
      ) : (
        <>
          <PageHead title={student ? `Portfolio · ${student.name}` : 'Student Portfolio'} sub="Achievements, certificates and activity history" />
          <PortfolioView studentId={id} />
        </>
      )}
    </PortalPageShell>
  )
}
