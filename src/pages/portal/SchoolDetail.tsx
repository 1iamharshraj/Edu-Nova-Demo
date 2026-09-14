import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import {
  GROUP_DRILLDOWN_REPORTS, fmtInr, useGroupDrilldown, type GroupDrilldownReport,
} from '@/lib/hooks/useGroup'
import { Card, Empty, PageHead, Pill } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Was `DrilldownModal`/`DrilldownBody` inside `GroupMod` in portal/modules/group.tsx — a cross-campus
// comparison/drilldown view with its own internal report-tab state. Converted to a real routed page,
// `/portal/group/schools/:id`, per .agents/edunova/ui-architecture-fix.md Phase D. Data/mutation logic
// carried over verbatim.
//
// Route shape: `:id` is the school id; the group id (needed by the drilldown endpoint, and not otherwise
// derivable from the school id alone) travels as a `?groupId=` query param set by the trigger site in
// group.tsx, rather than a second path segment — the plan's route list specifies `/portal/group/schools/:id`
// exactly, and a query param keeps that single dynamic segment while still carrying the context this page
// needs. The school's display name isn't looked up separately either — the drilldown response already
// includes `schoolName`, so there's no need for a second fetch just to render the page title.

const REPORT_LABEL: Record<GroupDrilldownReport, string> = {
  fees: 'Fees', attendance: 'Attendance', syllabus: 'Syllabus pace', teacherLoad: 'Teacher load',
}

function DrilldownBody({ report, data, termId }: { report: GroupDrilldownReport; data: unknown; termId: string | null }) {
  if (!termId && report !== 'fees') return <Empty text="No current term set for this school." />
  if (report === 'fees') {
    const d = data as { collected?: number; outstanding?: number; invoiced?: number; byHead?: { name: string; collected: number; invoiced: number }[] } | null
    if (!d) return <Empty text="No fee data for this school yet." />
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-[13.5px]">
          <div><p className="text-black/40 dark:text-white/40">Collected</p><p className="text-xl font-semibold">{fmtInr(d.collected ?? 0)}</p></div>
          <div><p className="text-black/40 dark:text-white/40">Outstanding</p><p className="text-xl font-semibold">{fmtInr(d.outstanding ?? 0)}</p></div>
          <div><p className="text-black/40 dark:text-white/40">Invoiced</p><p className="text-xl font-semibold">{fmtInr(d.invoiced ?? 0)}</p></div>
        </div>
        {d.byHead && d.byHead.length > 0 && (
          <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
            {d.byHead.map(h => (
              <div key={h.name} className="flex items-center justify-between py-2 text-[13.5px]">
                <span>{h.name}</span>
                <span className="font-semibold">{fmtInr(h.collected)} / {fmtInr(h.invoiced)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (report === 'attendance') {
    const d = data as { present?: number; total?: number; pct?: number } | null
    if (!d || !d.total) return <Empty text="No attendance data for this school's current term." />
    return (
      <div className="grid grid-cols-3 gap-3 text-[13.5px]">
        <div><p className="text-black/40 dark:text-white/40">Present</p><p className="text-xl font-semibold">{d.present}</p></div>
        <div><p className="text-black/40 dark:text-white/40">Total</p><p className="text-xl font-semibold">{d.total}</p></div>
        <div><p className="text-black/40 dark:text-white/40">Rate</p><p className="text-xl font-semibold">{Math.round(d.pct ?? 0)}%</p></div>
      </div>
    )
  }
  if (report === 'syllabus') {
    const d = data as { onPace?: number; behind?: number; noData?: number; totalTracked?: number; onPacePct?: number } | null
    if (!d) return <Empty text="No syllabus data yet." />
    return (
      <div className="grid grid-cols-4 gap-3 text-[13.5px]">
        <div><p className="text-black/40 dark:text-white/40">On pace</p><p className="text-xl font-semibold">{d.onPace}</p></div>
        <div><p className="text-black/40 dark:text-white/40">Behind</p><p className="text-xl font-semibold">{d.behind}</p></div>
        <div><p className="text-black/40 dark:text-white/40">Untracked</p><p className="text-xl font-semibold">{d.noData}</p></div>
        <div><p className="text-black/40 dark:text-white/40">On pace %</p><p className="text-xl font-semibold">{d.onPacePct}%</p></div>
      </div>
    )
  }
  // teacherLoad
  const d = data as { items?: { name?: string; periodsPerWeek: number; overThreshold: boolean }[]; highLoadThreshold?: number } | null
  if (!d || !d.items?.length) return <Empty text="No teacher workload data yet." />
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-black/45 dark:text-white/45">High-load threshold: {d.highLoadThreshold} periods/week</p>
      <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
        {d.items.map((t, i) => (
          <div key={i} className="flex items-center justify-between py-2 text-[13.5px]">
            <span>{t.name ?? `Teacher ${i + 1}`}</span>
            <span className="flex items-center gap-2">
              <span className="font-semibold">{t.periodsPerWeek}/wk</span>
              {t.overThreshold && <Pill tone="amber">over threshold</Pill>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SchoolDetail() {
  const { id: schoolId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const groupId = searchParams.get('groupId') ?? undefined
  const [report, setReport] = useState<GroupDrilldownReport>('fees')
  const { data, loading, error } = useGroupDrilldown(groupId, schoolId, report)

  return (
    <PortalPageShell backLabel="Back to group">
      {!groupId && <Empty text="Missing group context — go back and open this school from the Group overview." />}
      {groupId && (
        <div>
          <PageHead title={data?.schoolName ?? 'School'} sub="Cross-campus drilldown" />
          <Card>
            <div className="mb-4 flex flex-wrap gap-2">
              {GROUP_DRILLDOWN_REPORTS.map(r => (
                <button key={r} onClick={() => setReport(r)}
                  className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${report === r ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-black/[.05] text-black/60 hover:bg-black/10 dark:bg-white/[.07] dark:text-white/60 dark:hover:bg-white/15'}`}>
                  {REPORT_LABEL[r]}
                </button>
              ))}
            </div>
            {error ? (
              <Empty text={`Could not load this report: ${error}`} />
            ) : loading || !data ? (
              <p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p>
            ) : (
              <DrilldownBody report={report} data={data.data} termId={data.termId} />
            )}
          </Card>
        </div>
      )}
    </PortalPageShell>
  )
}
