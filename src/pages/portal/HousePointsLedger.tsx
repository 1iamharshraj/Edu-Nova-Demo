import { useMemo } from 'react'
import { useParams } from 'react-router'
import { useActivities } from '@/lib/hooks/useWelfare'
import { Empty, PageHead } from '@/portal/ui'
import { HousePointsLedger as HousePointsLedgerCard } from '@/portal/modules/culture'
import { PortalPageShell } from './PortalPageShell'

// Was `HouseLedgerModal` in portal/modules/culture.tsx, opened from a house's row in the leaderboard's
// standings list. Converted to a real routed page per .agents/edunova/ui-architecture-fix.md Phase D. The
// house's display name isn't in the URL (only its id) so it's resolved the same way the leaderboard itself
// resolves house titles — from `useActivities('house')` — rather than threading it through route state.
export default function HousePointsLedger() {
  const { id } = useParams<{ id: string }>()
  const { items: houses } = useActivities('house')
  const house = useMemo(() => (houses ?? []).find(h => h.id === id), [houses, id])

  return (
    <PortalPageShell backLabel="Back to leaderboard">
      {!id ? (
        <Empty text="No house selected." />
      ) : (
        <>
          <PageHead title={house?.title ?? 'House points ledger'} sub="Full points transaction history" />
          <HousePointsLedgerCard houseActivityId={id} houseName={house?.title ?? 'House'} />
        </>
      )}
    </PortalPageShell>
  )
}
