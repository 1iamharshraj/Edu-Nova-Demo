import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useStore } from '@/lib/store'
import { isAdmin } from '@/lib/access'
import { useEmployees } from '@/lib/hooks/useFinance'
import { ReviewForm } from '@/portal/modules/employee'
import { Card, PageHead } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Was the "New performance review" `<Modal>` inside `TeamReviewsMod` in portal/modules/employee.tsx.
// Converted to a real routed page, `/portal/reviews/new`, per .agents/edunova/ui-architecture-fix.md
// Phase D. Data/mutation logic (ReviewForm) carried over verbatim — only the wrapper changed.

export default function ReviewNew() {
  const { user } = useStore()
  const navigate = useNavigate()
  const employees = useEmployees()
  const hr = isAdmin(user)
  const manageable = useMemo(() => (hr ? employees.filter(e => e.id !== user?.id) : employees.filter(e => e.reportsTo === user?.id)), [employees, hr, user])

  return (
    <PortalPageShell backLabel="Back to reviews">
      <PageHead title="New performance review" sub={hr ? 'Create a review for any employee' : 'Create a review for one of your direct reports'} />
      <Card>
        <ReviewForm employees={manageable} wholeSchool={hr} onDone={() => navigate(-1)} />
      </Card>
    </PortalPageShell>
  )
}
