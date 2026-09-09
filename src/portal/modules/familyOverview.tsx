import type { ReactNode } from 'react'
import { Banknote, BookOpenCheck, CalendarDays, ClipboardCheck, ChevronRight, TrendingUp, Users2 } from 'lucide-react'
import { fmtINR, type CalendarEventRec, type FamilyWardSummary } from '@/lib/data'
import { fmtDate, STATUS_LABEL } from '@/lib/hooks/useAcademics'
import { useFamilySummary } from '@/lib/hooks/useParents'
import { Avatar, Card, Empty, PageHead, Pill } from '../ui'
import { useViewedStudents } from './viewer'

// Phase 23 item 1 — Family Overview: a genuinely new landing screen for parents with 2+ wards, who
// otherwise pick one ward at a time everywhere (see `useWard()` in viewer.ts, used in 9+ existing screens
// that all stay as-is). Supplements the shared `Overview` dashboard in Portal.tsx rather than replacing it
// — that component is hand-wired across every role and only ever shows the *first* ward's tiles for a
// parent, so this screen is the actual "all my children at a glance" surface; Portal.tsx wiring (which
// module id/icon to add) is described in this phase's report, not made here.
//
// Data comes from `GET /parents/me/family-summary` (server/src/modules/parents/, built in parallel and
// live-verified here against the real running server) — a read-only aggregation across every ward, reusing
// existing per-domain query logic (fees/homework/calendar/syllabus) rather than reimplementing it.

/** `onNavigate` mirrors `NotificationBell`'s prop (social.tsx) — Portal.tsx owns the active-module state,
 * so this screen asks it to switch tabs rather than holding any navigation state itself. */
export function FamilyOverviewMod({ onNavigate }: { onNavigate?: (moduleId: string) => void }) {
  const students = useViewedStudents()
  const { data, loading, error } = useFamilySummary(students.length > 0)

  const go = (id: string) => onNavigate?.(id)

  return (
    <div>
      <PageHead title="Family Overview" sub={students.length > 1 ? `A combined snapshot for all ${students.length} of your children` : 'A combined snapshot for your child'} />

      {students.length === 0 ? (
        <Card><Empty text="No student is linked to your account yet." /></Card>
      ) : loading ? (
        <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading your family's snapshot…</div>
      ) : error ? (
        <Card><Empty text={error} /></Card>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {(data?.wards ?? []).map(w => <WardCard key={w.studentId} w={w} onOpen={go} />)}
          </div>
          <UpcomingEvents events={data?.upcomingEvents ?? []} />
        </div>
      )}
    </div>
  )
}

function WardCard({ w, onOpen }: { w: FamilyWardSummary; onOpen: (id: string) => void }) {
  const status = w.attendanceToday.status
  const attTone = status === 'P' ? 'green' : status === 'A' ? 'rose' : status ? 'amber' : 'slate'
  const attLabel = status ? (STATUS_LABEL as Record<string, string>)[status] ?? status : 'Not marked'
  const hwCount = w.homeworkDueThisWeek.length
  const openHwCount = w.homeworkDueThisWeek.filter(h => !h.submitted).length

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar name={w.name} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{w.name}</p>
          <p className="text-[12.5px] text-black/45 dark:text-white/45">{w.classLabel ?? 'Class not set'}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat icon={<ClipboardCheck size={14} />} label="Today" value={attLabel} tone={attTone} onClick={() => onOpen('att')} />
        <Stat icon={<BookOpenCheck size={14} />} label="HW due" value={String(hwCount)} tone={openHwCount > 0 ? 'amber' : 'green'} onClick={() => onOpen('hw')} />
        <Stat icon={<Banknote size={14} />} label="Fee due" value={w.feeDue.total > 0 ? fmtINR(w.feeDue.total) : '₹0'} tone={w.feeDue.total > 0 ? 'rose' : 'green'} onClick={() => onOpen('pay')} />
      </div>

      {w.syllabusPace.length > 0 && (
        <div className="space-y-1.5 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><TrendingUp size={12} /> Syllabus pace</p>
          {w.syllabusPace.map(p => (
            <div key={p.classSubjectId} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="text-black/60 dark:text-white/60">{p.subjectName}</span>
              <Pill tone={p.paceDeltaChapters < 0 ? (p.paceDeltaChapters <= -2 ? 'rose' : 'amber') : 'green'}>{p.headline}</Pill>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => onOpen('report')} className="flex items-center justify-center gap-1 rounded-full bg-black/[.06] dark:bg-white/[.08] py-2 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
        View {w.name.split(' ')[0]}'s full report <ChevronRight size={13} />
      </button>
    </Card>
  )
}

function Stat({ icon, label, value, tone, onClick }: { icon: ReactNode; label: string; value: string; tone: 'green' | 'amber' | 'rose' | 'slate'; onClick: () => void }) {
  const toneCls = { green: 'text-emerald-600', amber: 'text-amber-600', rose: 'text-rose-600', slate: 'text-black/50 dark:text-white/50' }[tone]
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 rounded-2xl bg-black/[.03] dark:bg-white/[.05] px-2 py-3 text-center hover:bg-black/[.06] dark:hover:bg-white/[.08]">
      <span className={toneCls}>{icon}</span>
      <span className="text-[13px] font-bold">{value}</span>
      <span className="text-[10.5px] uppercase tracking-wide text-black/40 dark:text-white/40">{label}</span>
    </button>
  )
}

function UpcomingEvents({ events }: { events: CalendarEventRec[] }) {
  return (
    <Card>
      <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-black/60 dark:text-white/60"><CalendarDays size={15} /> Coming up for your family</p>
      {events.length === 0 ? (
        <p className="text-[13px] text-black/40 dark:text-white/40">Nothing on the calendar in the next few weeks.</p>
      ) : (
        <div className="space-y-2">
          {events.map(e => (
            <div key={e.id} className="flex items-center gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] px-4 py-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300"><Users2 size={16} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold">{e.title}</p>
                <p className="text-[12px] text-black/45 dark:text-white/45">{fmtDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })} · {e.type}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
