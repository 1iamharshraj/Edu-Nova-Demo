import { useParams } from 'react-router'
import { useAcademic } from '@/lib/store'
import { fmtDate, useOne } from '@/lib/hooks/useAcademics'
import { useAdmissionCategories } from '@/lib/hooks/useDocuments'
import type { ApplicationRec } from '@/lib/data'
import { Card, Empty, PageHead, Pill, statusTone } from '@/portal/ui'
import { DocumentChecklistPanel } from '@/portal/modules/documents'
import { PortalPageShell } from './PortalPageShell'

// New dedicated page for Phase T2 Part B (roadmap D9 — a genuinely dense, multi-state checklist screen,
// exactly the kind of surface the earlier UI-architecture fix converted from modal to route). There was no
// single-application detail view before this phase; ApplicationsMod's inline row + modals were enough for
// the old flat kind/status/documents[] shape, but the completeness checklist plus prior-academics/category/
// sibling summary genuinely doesn't fit a modal without becoming exactly the "mini-app in a modal" pattern
// this codebase already moved away from once.

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-[13.5px]">
      <span className="text-black/45 dark:text-white/45">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  )
}

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: app, loading, error } = useOne<ApplicationRec>(id ? `/applications/${id}` : null)
  const { classById, boardById } = useAcademic()
  const categories = useAdmissionCategories()

  return (
    <PortalPageShell backLabel="Back to admissions">
      {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading application…</p>}
      {!loading && (error || !app) && <Empty text={error || 'Application not found.'} />}
      {!loading && app && (
        <>
          <PageHead title={app.applicantName} sub={`Admission application · ${fmtDate(app.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}`}>
            <Pill tone={statusTone(app.status)}>{app.status}</Pill>
          </PageHead>

          <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
            <div className="space-y-5">
              <Card>
                <p className="mb-2 text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Admission</p>
                <Row label="Target class" value={app.targetClassId ? classById.get(app.targetClassId)?.label : undefined} />
                <Row label="Board" value={app.targetBoardId ? boardById.get(app.targetBoardId)?.name : undefined} />
                <Row label="Category / quota" value={app.admissionCategoryId ? categories.items.find(c => c.id === app.admissionCategoryId)?.name : 'General / not specified'} />
                <Row label="Admission mode" value={app.admissionMode ?? 'Regular'} />
                <Row label="Track preference" value={app.declaredTrackPreference} />
                <Row label="DOB" value={app.dob ? fmtDate(app.dob, { day: 'numeric', month: 'short', year: 'numeric' }) : undefined} />
                <Row label="Gender" value={app.gender} />
              </Card>

              <Card>
                <p className="mb-2 text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Guardian</p>
                <Row label="Name" value={app.guardian?.name} />
                <Row label="Relation" value={app.guardian?.relation} />
                <Row label="Phone" value={app.guardian?.phone} />
                <Row label="Email" value={app.guardian?.email} />
              </Card>

              <Card>
                <p className="mb-2 text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Prior academics</p>
                <Row label="Previous school" value={app.previousSchoolName} />
                <Row label="Previous board" value={app.previousBoardId ? boardById.get(app.previousBoardId)?.name : undefined} />
                <Row label="Last grade" value={app.lastGradeCompleted} />
                {(app.priorSubjectScores ?? []).length > 0 && (
                  <div className="mt-2 space-y-1">
                    {(app.priorSubjectScores ?? []).map((s, i) => (
                      <div key={s.id ?? i} className="flex items-center justify-between text-[13px]">
                        <span className="text-black/60 dark:text-white/60">{s.subjectName}</span>
                        <span className="font-mono font-medium">{s.score}/{s.maxScore}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!app.previousSchoolName && !(app.priorSubjectScores ?? []).length && <p className="text-[13px] text-black/40 dark:text-white/40">Not captured.</p>}
              </Card>

              {(app.healthFlags || app.transportRequired) && (
                <Card>
                  <p className="mb-2 text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Health & transport (captured at intake)</p>
                  <Row label="Allergies" value={app.healthFlags?.allergies} />
                  <Row label="Conditions" value={app.healthFlags?.conditions} />
                  <Row label="Blood group" value={app.healthFlags?.bloodGroup} />
                  {app.transportRequired && (
                    <div className="mt-2 rounded-xl bg-sky-50 dark:bg-sky-500/10 px-3 py-2 text-[12.5px] font-semibold text-sky-700 dark:text-sky-300">
                      Needs school transport{app.transportPreferredArea ? ` · ${app.transportPreferredArea}` : ''}{app.transportHandledAt ? ' — assignment handled' : ' — assign a stop after enrollment.'}
                    </div>
                  )}
                </Card>
              )}

              {app.siblingStudentId && (
                <Card>
                  <p className="text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Sibling</p>
                  <p className="mt-1 text-[13.5px]">Linked to an existing enrolled student.</p>
                </Card>
              )}
            </div>

            <div>
              <p className="mb-3 text-[15px] font-semibold">Document checklist</p>
              <DocumentChecklistPanel app={app} />
            </div>
          </div>
        </>
      )}
    </PortalPageShell>
  )
}
