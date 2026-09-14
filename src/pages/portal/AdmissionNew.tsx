import { useNavigate } from 'react-router'
import { Card, PageHead } from '@/portal/ui'
import { AdmissionForm } from '@/portal/modules/office'
import { PortalPageShell } from './PortalPageShell'

// Was the "New admission" modal inside `ApplicationsMod` (office.tsx) — a 10+ field admission-application
// form (student, guardian, documents). Converted to a routed page per
// .agents/edunova/ui-architecture-fix.md Phase D #1. `AdmissionForm`'s data/mutation logic is unchanged,
// only exported from office.tsx and reused here — the outer chrome is the only thing that moved.

export default function AdmissionNew() {
  const navigate = useNavigate()
  return (
    <PortalPageShell backLabel="Back to admissions">
      <PageHead title="New admission" sub="Record a new admission application — an admin verifies and approves it from the Admissions & Certificates queue" />
      <Card>
        <AdmissionForm onDone={() => navigate(-1)} />
      </Card>
    </PortalPageShell>
  )
}
