import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/lib/theme'
import { useStore } from '@/lib/store'
import { isAdmin } from '@/lib/access'
import { Card, Empty, PageHead, Pill } from '@/portal/ui'
import { EmployeeDocumentsSection, EmploymentHistoryTimeline, IdCardButton } from '@/portal/modules/employee'

// Converted from the old `EmployeeDetailModal` (modal-as-mini-app with internal tab state) into a real routed
// page — see .agents/edunova/ui-architecture-fix.md, Phase C #1. The 3 tabs (Overview/History/Documents) stay
// as simple in-page tab state rather than further nested sub-routes: they're lightweight read views with no
// deep-linkable state worth bookmarking on their own, so nested routes would only add routing surface without
// real benefit. Reused from `MyTeamMod` (employee.tsx) and the People & Roles screen (office.tsx).

type DetailTab = 'overview' | 'history' | 'documents'

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

export default function EmployeeDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user: viewer, db } = useStore()
  const user = useMemo(() => db.users.find(u => u.id === id) ?? null, [db.users, id])
  const canSeeDocuments = isAdmin(viewer)
  const [tab, setTab] = useState<DetailTab>('overview')

  const managerName = user?.reportsTo ? (db.users.find(u => u.id === user.reportsTo)?.name ?? user.reportsTo) : undefined
  const reports = useMemo(() => (user ? db.users.filter(u => u.reportsTo === user.id).sort(byName) : []), [db.users, user])

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'history', label: 'History' },
    ...(canSeeDocuments ? [{ id: 'documents' as const, label: 'Documents' }] : []),
  ]

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f6f4] dark:bg-[#090911]">
      <header className="glass-nav">
        <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-6">
          <Link to="/portal"><Logo /></Link>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-[14px] font-medium text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">
              <ArrowLeft size={16} /> Back
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
        {!user ? (
          <Empty text="Employee not found." />
        ) : (
          <>
            <PageHead title={user.name} sub={user.employeeId ?? undefined} />
            <Card>
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="indigo"><span className="capitalize">{user.role}</span></Pill>
                  {user.employeeId && <Pill tone="slate">{user.employeeId}</Pill>}
                  {(user.designation || user.title) && <span className="text-[13.5px] text-black/60 dark:text-white/60">{user.designation || user.title}</span>}
                </div>

                <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
                  {tabs.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                      className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${tab === t.id ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {tab === 'overview' && (
                  <div className="space-y-4">
                    <div className="grid gap-4 text-[13.5px] sm:grid-cols-2">
                      <div><p className="text-black/50 dark:text-white/50">Email</p><p className="font-medium">{user.email}</p></div>
                      <div><p className="text-black/50 dark:text-white/50">Phone</p><p className="font-medium">{user.phone || '—'}</p></div>
                      <div><p className="text-black/50 dark:text-white/50">Department</p><p className="font-medium">{user.department || '—'}</p></div>
                      <div><p className="text-black/50 dark:text-white/50">Reports to</p><p className="font-medium">{managerName || '—'}</p></div>
                    </div>
                    {reports.length > 0 && (
                      <div>
                        <p className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Direct reports</p>
                        <div className="flex flex-wrap gap-1.5">
                          {reports.map(r => <Pill key={r.id} tone="slate">{r.name}</Pill>)}
                        </div>
                      </div>
                    )}
                    {canSeeDocuments && <IdCardButton userId={user.id} />}
                  </div>
                )}
                {tab === 'history' && <EmploymentHistoryTimeline userId={user.id} />}
                {tab === 'documents' && canSeeDocuments && <EmployeeDocumentsSection userId={user.id} />}
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  )
}
