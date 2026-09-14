import { useParams } from 'react-router'
import { useActivities, ACTIVITY_KIND_LABEL } from '@/lib/hooks/useWelfare'
import { Card, Empty, PageHead } from '@/portal/ui'
import { ActivityRegistrationsList } from '@/portal/modules/office'
import { PortalPageShell } from './PortalPageShell'

// Was the "Registrations · [activity]" modal inside `ActivitiesAdminMod` (office.tsx). Converted to a routed
// page per .agents/edunova/ui-architecture-fix.md Phase D #4. `ActivityRegistrationsList`'s data logic is
// unchanged, only exported from office.tsx and reused here. There's no single-activity-by-id endpoint, so —
// same approach as the alumni events RSVPs page — this fetches the (small, school-scoped) activities list
// and finds the one it needs client-side.

export default function ActivityRegistrations() {
  const { id } = useParams<{ id: string }>()
  const activities = useActivities()
  const activity = (activities.items ?? []).find(a => a.id === id) ?? null

  return (
    <PortalPageShell backLabel="Back to activities">
      {activities.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {!activities.loading && !activity && <Empty text="Activity not found." />}
      {activity && (
        <div>
          <PageHead title={`Registrations · ${activity.title}`} sub={ACTIVITY_KIND_LABEL[activity.kind]} />
          <Card>
            <ActivityRegistrationsList activity={activity} />
          </Card>
        </div>
      )}
    </PortalPageShell>
  )
}
