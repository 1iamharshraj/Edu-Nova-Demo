import { useParams } from 'react-router'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { useAlumniEvents, useAlumniProfiles } from '@/lib/hooks/useAlumni'
import { Card, Empty, PageHead } from '@/portal/ui'
import { EventRsvps } from '@/portal/modules/alumni'
import { PortalPageShell } from './PortalPageShell'

// Was the "RSVPs · [event]" modal inside `EventsTab` (alumni.tsx). Converted to a routed page per
// .agents/edunova/ui-architecture-fix.md Phase D #6. `EventRsvps`'s data/mutation logic is unchanged, only
// exported from alumni.tsx and reused here. There's no single-event-by-id endpoint, so this fetches the
// (small, school-scoped) events list and finds the one it needs client-side, same as the activity
// registrations page.

export default function AlumniEventRsvps() {
  const { id } = useParams<{ id: string }>()
  const events = useAlumniEvents()
  const profiles = useAlumniProfiles({})
  const event = (events.items ?? []).find(e => e.id === id) ?? null

  return (
    <PortalPageShell backLabel="Back to alumni events">
      {events.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {!events.loading && !event && <Empty text="Event not found." />}
      {event && (
        <div>
          <PageHead title={`RSVPs · ${event.title}`} sub={fmtDate(event.date, { day: 'numeric', month: 'short', year: 'numeric' })} />
          <Card>
            <EventRsvps event={event} alumni={profiles.items ?? []} />
          </Card>
        </div>
      )}
    </PortalPageShell>
  )
}
