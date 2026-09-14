import { useParams } from 'react-router'
import { StudentReportMod } from '@/portal/modules/studentReport'
import { PortalPageShell } from './PortalPageShell'

// Was `<Modal title="Student Profile Report">` wrapping StudentReportMod in portal/modules/office.tsx's
// PeopleMod. Converted to a real routed page per .agents/edunova/ui-architecture-fix.md Phase C #4.
// StudentReportMod itself needs no changes — it's already self-contained, taking `studentId` as a prop, and
// is still used directly (not in a modal) for self-view in Portal.tsx and analytics.tsx; only the office.tsx
// modal-wrapped usage is replaced by this page.
export default function StudentReport() {
  const { id } = useParams<{ id: string }>()

  return (
    <PortalPageShell backLabel="Back to people">
      {id ? <StudentReportMod studentId={id} /> : <p className="text-[14px] text-black/40 dark:text-white/40">No student selected.</p>}
    </PortalPageShell>
  )
}
