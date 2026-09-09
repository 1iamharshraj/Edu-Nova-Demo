import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertCircle, AlertTriangle, BadgeCheck, CalendarPlus, Check, Copy, Download, FileBadge, HeartHandshake, History, Paperclip, Pencil, Plus,
  School, Search, Send, ShieldAlert, Sparkles, Trash2, UserCheck, UserPlus, UserX, X,
} from 'lucide-react'
import { useAcademic, useStore } from '@/lib/store'
import { api, downloadFile, downloadPath, errorMessage } from '@/lib/api'
import { canManage, isAdmin, isStaffOrAdmin, isSuperAdmin } from '@/lib/access'
import {
  compareClasses,
  type ActivityKind, type ActivityRec, type AdmissionCreated, type ApplicationKind, type ApplicationRec, type ApplicationStatus,
  type BoardRegistration, type BoardRegistrationStatus, type CalendarEventRec, type Certificate, type CertificateKind,
  type ParentVerification, type Role, type User, type VerificationStatus,
} from '@/lib/data'
import {
  APPLICATION_KINDS, APPLICATION_STATUSES, BOARD_REG_STATUSES, CERTIFICATE_KINDS, KIND_LABEL, boardRegLabel, boardRegTone, certificateFileName,
  isCertificateKind, kindTone, useApplications, useBoardRegistrations, useFileUrl, useVerifications, verificationTone,
} from '@/lib/hooks/useIdentity'
import { fmtDate, qs, useFetchMany } from '@/lib/hooks/useAcademics'
import { useCalendarEvents } from '@/lib/hooks/useComms'
import { ACTIVITY_KIND_LABEL, ACTIVITY_KINDS, activityRegTone, useActivities, useActivityRegistrations } from '@/lib/hooks/useWelfare'
import { useBoardReadiness } from '@/lib/hooks/useExams'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, UploadField, inputCls, statusTone, type UploadedFile } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'
import { useViewedStudents } from './viewer'
import { toast } from 'sonner'

// Phase 3 classroom screens live in classroom.tsx; re-exported here so the Portal registry keeps one import.
export { AttendanceMgmtMod, CreateAssignmentMod, GradebookMod, TakeAttendanceMod } from './classroom'

const todayISO = () => new Date().toISOString().slice(0, 10)


/* ── Teacher/staff: work assignments ───────────────────── */


/* ── Student/teacher: activity registrations (clubs / IHA / EXC / events / faculty) ── */
// Real /api/activities-backed registration with capacity + waitlist. See .agents/edunova/phase-8-welfare.md

export function RegistrationsMod({ kind, title, sub }: { kind: ActivityKind; title: string; sub: string }) {
  const { user } = useStore()
  const { items, loading, error, reload } = useActivities(kind, !!user)
  const [busy, setBusy] = useState<string | null>(null)

  const register = async (a: ActivityRec) => {
    setBusy(a.id)
    try { await api.post(`/activities/${a.id}/register`); await reload(); toast.success(`Registered for ${a.title}`) }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const cancel = async (a: ActivityRec) => {
    setBusy(a.id)
    try { await api.post(`/activities/${a.id}/cancel`); await reload(); toast.success('Registration withdrawn') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const rows = items ?? []
  return (
    <div>
      <PageHead title={title} sub={sub} />
      {loading && <p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p>}
      {error && <p className="text-[13px] text-rose-500">{error}</p>}
      {!loading && !error && rows.length === 0 && <Empty text="Nothing open for registration right now." />}
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(a => {
          const full = !!a.capacity && (a.registered ?? 0) >= a.capacity
          const on = a.myStatus === 'Registered' || a.myStatus === 'Waitlisted'
          return (
            <Card key={a.id} className="card-lift">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone="indigo">{ACTIVITY_KIND_LABEL[a.kind]}</Pill>
                    {full && a.myStatus !== 'Registered' && <Pill tone="rose">Full — waitlist</Pill>}
                  </div>
                  <p className="font-display mt-2.5 text-[16.5px] font-medium">{a.title}</p>
                  <p className="mt-1 text-[13px] text-black/50 dark:text-white/50">{a.description}</p>
                  <p className="mt-1 text-[12px] text-black/40 dark:text-white/40">
                    {a.capacity ? `${a.registered ?? 0}/${a.capacity} registered` : `${a.registered ?? 0} registered`}
                  </p>
                </div>
                <button onClick={() => (on ? cancel(a) : register(a))} disabled={busy === a.id}
                  className={`shrink-0 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${on ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-black text-white hover:bg-black/85'}`}>
                  {a.myStatus === 'Registered' ? '✓ Registered' : a.myStatus === 'Waitlisted' ? 'On waitlist — Cancel' : 'Register'}
                </button>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

/* ── Staff/admin: manage activities & view registrations ── */

function ActivityForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ kind: 'club' as ActivityKind, title: '', description: '', capacity: '', opensAt: '', closesAt: '' })
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await api.post('/activities', {
        kind: f.kind, title: f.title.trim(), description: f.description.trim(),
        capacity: f.capacity ? Number(f.capacity) : undefined,
        opensAt: f.opensAt || undefined, closesAt: f.closesAt || undefined,
        forRoles: f.kind === 'faculty' ? ['teacher', 'staff'] : ['student'],
      })
      toast.success('Activity created')
      onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind">
          <select value={f.kind} onChange={e => setF(x => ({ ...x, kind: e.target.value as ActivityKind }))} className={inputCls}>
            {ACTIVITY_KINDS.map(k => <option key={k} value={k}>{ACTIVITY_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Capacity (optional)"><input type="number" min={1} value={f.capacity} onChange={e => setF(x => ({ ...x, capacity: e.target.value }))} className={inputCls} /></Field>
      </div>
      <Field label="Title"><input value={f.title} onChange={e => setF(x => ({ ...x, title: e.target.value }))} className={inputCls} autoFocus /></Field>
      <Field label="Description"><textarea value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} rows={3} className={inputCls} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Opens (optional)"><input type="date" value={f.opensAt} onChange={e => setF(x => ({ ...x, opensAt: e.target.value }))} className={inputCls} /></Field>
        <Field label="Closes (optional)"><input type="date" value={f.closesAt} onChange={e => setF(x => ({ ...x, closesAt: e.target.value }))} className={inputCls} /></Field>
      </div>
      <button onClick={submit} disabled={!f.title.trim() || !f.description.trim() || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Creating…' : 'Create activity'}</button>
    </div>
  )
}

export function ActivityRegistrationsList({ activity }: { activity: ActivityRec }) {
  const { db } = useStore()
  const { items, loading } = useActivityRegistrations(activity.id)
  const nameOf = (id: string) => db.users.find(u => u.id === id)?.name ?? id
  if (loading) return <p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p>
  const rows = items ?? []
  if (rows.length === 0) return <Empty text="No one has registered yet." />
  return (
    <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
      {rows.map(r => (
        <div key={r.id} className="flex items-center justify-between py-2.5 text-[13.5px]">
          <span className="font-medium">{r.userName ?? nameOf(r.userId)}</span>
          <Pill tone={activityRegTone(r.status)}>{r.status}</Pill>
        </div>
      ))}
    </div>
  )
}

export function ActivitiesAdminMod() {
  const navigate = useNavigate()
  const [kindFilter, setKindFilter] = useState<ActivityKind | ''>('')
  const { items, loading, reload } = useActivities(kindFilter || undefined)
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const remove = async (a: ActivityRec) => {
    if (!window.confirm(`Delete "${a.title}"? This cannot be undone.`)) return
    setBusy(a.id)
    try { await api.del(`/activities/${a.id}`); await reload(); toast.success('Activity deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const rows = items ?? []
  return (
    <div>
      <PageHead title="Activities Admin" sub="Create clubs, houses, EXC slots, events and faculty programmes; watch capacity fill up">
        <button onClick={() => setCreateOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> New activity</button>
      </PageHead>
      <div className="mb-4 inline-flex flex-wrap rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
        {(['', ...ACTIVITY_KINDS] as const).map(k => (
          <button key={k || 'all'} onClick={() => setKindFilter(k)} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-all ${kindFilter === k ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
            {k ? ACTIVITY_KIND_LABEL[k] : 'All'}
          </button>
        ))}
      </div>
      <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
        {loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>}
        {!loading && rows.length === 0 && <div className="p-6"><Empty text="No activities yet." /></div>}
        {rows.map(a => (
          <div key={a.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
            <Pill tone="indigo">{ACTIVITY_KIND_LABEL[a.kind]}</Pill>
            <div className="min-w-52 flex-1">
              <p className="text-[14.5px] font-semibold">{a.title}</p>
              <p className="text-[12.5px] text-black/45 dark:text-white/45">{a.capacity ? `${a.registered ?? 0}/${a.capacity} registered` : `${a.registered ?? 0} registered`}</p>
            </div>
            <button onClick={() => navigate(`/portal/activities/${a.id}/registrations`)} className={ghostPill}>View registrations</button>
            <button onClick={() => remove(a)} disabled={busy === a.id} className="rounded-full p-1.5 text-black/35 hover:bg-rose-50 hover:text-rose-500 dark:text-white/35" title="Delete activity"><Trash2 size={14} /></button>
          </div>
        ))}
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New activity">
        {createOpen && <ActivityForm onDone={() => { setCreateOpen(false); reload() }} />}
      </Modal>
    </div>
  )
}

/* ── Applications: admissions & certificates (Phase 4) ── */
// Staff/admin run the pipeline (Pending → Verified → Approved / Declined); parents and students apply for
// TC / Bonafide / Character certificates for themselves or their wards and download the PDF once issued.
// See .agents/edunova/phase-4-admissions-identity.md

type AppTab = 'All' | ApplicationKind | 'Issued'
type AppModal =
  | { t: 'cert' } | { t: 'issue' }
  | { t: 'decline'; app: ApplicationRec } | { t: 'approve'; app: ApplicationRec }

const pillBtn = 'rounded-full px-4 py-1.5 text-[12.5px] font-semibold disabled:opacity-40'
const ghostPill = `${pillBtn} bg-black/[.06] dark:bg-white/[.08] hover:bg-black/10 dark:hover:bg-white/15`
const unwrapList = <T,>(d: { items?: T[] } | T[] | undefined) => (!d ? [] : Array.isArray(d) ? d : d.items ?? [])

function DocumentLinks({ ids }: { ids: string[] }) {
  if (!ids.length) return null
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {ids.map((id, i) => (
        <button key={id} onClick={() => downloadFile(id, `document-${i + 1}`).catch(e => toast.error(errorMessage(e)))}
          className="flex items-center gap-1 rounded-full bg-black/[.05] dark:bg-white/[.07] px-2.5 py-1 text-[11.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
          <Paperclip size={11} /> Doc {i + 1}
        </button>
      ))}
    </span>
  )
}

function CertificateDownload({ cert, studentName, compact = false }: { cert: Certificate; studentName?: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try { await downloadPath(`/certificates/${cert.id}/pdf`, certificateFileName(cert, studentName)) }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <button onClick={run} disabled={busy} title={cert.serialNo}
      className={`flex items-center gap-1.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 ${compact ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2 text-[13px]'} font-semibold`}>
      <Download size={13} /> {busy ? 'Preparing…' : compact ? 'PDF' : 'Download certificate'}
    </button>
  )
}

export function ApplicationsMod({ approver = true }: { approver?: boolean }) {
  const navigate = useNavigate()
  const { db, user } = useStore()
  const { classById, classOf, boardById } = useAcademic()
  const viewed = useViewedStudents()
  const adminRole = isAdmin(user)
  const [tab, setTab] = useState<AppTab>('All')
  const [status, setStatus] = useState<ApplicationStatus | ''>('')
  const [modal, setModal] = useState<AppModal | null>(null)
  const apps = useApplications({ kind: tab === 'All' || tab === 'Issued' ? '' : tab, status })

  // Certificates: staff/admin see the school's; parents/students fetch per viewed student (the list endpoint is keyed by studentId).
  const [certNonce, setCertNonce] = useState(0)
  const certPaths = useMemo(() => {
    const suffix = certNonce ? `${approver ? '?' : '&'}r=${certNonce}` : ''
    return approver ? [`/certificates${suffix}`] : viewed.map(s => `/certificates?studentId=${encodeURIComponent(s.id)}${suffix}`)
  }, [approver, viewed, certNonce])
  const certsQ = useFetchMany<{ items?: Certificate[] } | Certificate[]>(certPaths)
  const certs = useMemo(() => (certsQ.data ?? []).flatMap(unwrapList).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)), [certsQ.data])
  const reloadAll = () => { apps.reload(); setCertNonce(n => n + 1) }

  const nameOf = (id?: string | null) => db.users.find(u => u.id === id)?.name
  const certFor = (a: ApplicationRec) => {
    if (a.status !== 'Approved' || !isCertificateKind(a.kind)) return undefined
    return certs.find(c => c.applicationId === a.id) ?? certs.find(c => c.studentId === a.studentId && c.kind === a.kind)
  }
  const subOf = (a: ApplicationRec) => {
    if (a.kind === 'Admission') {
      const cls = a.targetClassId ? classById.get(a.targetClassId) : undefined
      return [cls ? `for ${cls.label}` : 'class not set', a.guardian?.name ? `guardian ${a.guardian.name}` : undefined, a.dob ? `DOB ${fmtDate(a.dob, { day: 'numeric', month: 'short', year: 'numeric' })}` : undefined].filter(Boolean).join(' · ')
    }
    const cls = a.studentId ? classOf(a.studentId) : undefined
    return [cls?.label, a.notes ? a.notes : undefined].filter(Boolean).join(' · ')
  }
  const counts = useMemo(() => {
    const c: Partial<Record<ApplicationStatus, number>> = {}
    for (const a of apps.items ?? []) c[a.status] = (c[a.status] ?? 0) + 1
    return c
  }, [apps.items])

  const [acting, setActing] = useState<string | null>(null)
  const verify = async (a: ApplicationRec) => {
    setActing(a.id)
    try { await api.post(`/applications/${a.id}/verify`); apps.reload(); toast.success('Application verified') }
    catch (e) { toast.error(errorMessage(e)) } finally { setActing(null) }
  }
  const remove = async (a: ApplicationRec) => {
    if (!window.confirm(`Delete this ${a.kind} application for ${a.applicantName}?`)) return
    setActing(a.id)
    try { await api.del(`/applications/${a.id}`); apps.reload(); toast.success('Application deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setActing(null) }
  }

  const tabs: AppTab[] = approver ? ['All', ...APPLICATION_KINDS, 'Issued'] : ['All', ...CERTIFICATE_KINDS]
  const rows = apps.items ?? []
  const applyStudents = approver ? db.users.filter(u => u.role === 'student').sort(byName) : viewed

  return (
    <div>
      <PageHead title={approver ? 'Admissions & Certificates' : 'Certificates'}
        sub={approver ? 'Admission pipeline, transfer / bonafide / character certificates' : user?.role === 'parent' ? 'Apply for certificates for your wards and download them once issued' : 'Apply for certificates and download them once issued'}>
        <div className="flex flex-wrap items-center gap-2">
          {approver && (
            <>
              <button onClick={() => setModal({ t: 'issue' })} className="flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-4 py-2.5 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06]"><FileBadge size={14} /> Issue certificate</button>
              <button onClick={() => navigate('/portal/admissions/new')} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><UserPlus size={15} /> New admission</button>
            </>
          )}
          <button onClick={() => setModal({ t: 'cert' })} disabled={applyStudents.length === 0} title={applyStudents.length === 0 ? 'No student linked to this account yet' : undefined}
            className={approver ? 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-4 py-2.5 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40' : 'btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40'}>
            <Plus size={15} /> {approver ? 'Certificate request' : 'New application'}
          </button>
        </div>
      </PageHead>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-all ${tab === t ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
              {t === 'Issued' ? `Issued (${certs.length})` : t}
            </button>
          ))}
        </div>
        {tab !== 'Issued' && (
          <select value={status} onChange={e => setStatus(e.target.value as ApplicationStatus | '')} className={`${inputCls} w-auto py-1.5 text-[12.5px]`} aria-label="Status">
            <option value="">All statuses</option>
            {APPLICATION_STATUSES.map(s => <option key={s} value={s}>{s}{counts[s] ? ` (${counts[s]})` : ''}</option>)}
          </select>
        )}
      </div>

      {tab === 'Issued' ? (
        <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
          {certsQ.loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>}
          {!certsQ.loading && certs.length === 0 && <div className="p-6"><Empty text="No certificates issued yet." /></div>}
          {certs.map(c => (
            <div key={c.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
              <Pill tone={kindTone(c.kind)}>{c.kind}</Pill>
              <div className="min-w-52 flex-1">
                <p className="text-[14.5px] font-semibold">{nameOf(c.studentId) ?? 'Student'}</p>
                <p className="text-[12.5px] text-black/45 dark:text-white/45"><span className="font-mono">{c.serialNo}</span> · issued {fmtDate(c.issuedAt, { day: 'numeric', month: 'short', year: 'numeric' })}{nameOf(c.issuedById) ? ` by ${nameOf(c.issuedById)}` : ''}</p>
              </div>
              <CertificateDownload cert={c} studentName={nameOf(c.studentId)} />
            </div>
          ))}
        </Card>
      ) : (
        <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
          {apps.loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>}
          {apps.error && <div className="p-6 text-center text-[13px] text-rose-500">{apps.error}</div>}
          {!apps.loading && !apps.error && rows.length === 0 && <div className="p-6"><Empty text={approver ? 'No applications in this view.' : 'No applications yet — start one with “New application”.'} /></div>}
          {rows.map(a => {
            const cert = certFor(a)
            const busy = acting === a.id
            return (
              <div key={a.id} className="px-6 py-4">
                <div className="flex flex-wrap items-center gap-4">
                  <Pill tone={kindTone(a.kind)}>{a.kind}</Pill>
                  <div className="min-w-52 flex-1">
                    <p className="text-[14.5px] font-semibold">{a.applicantName}</p>
                    <p className="text-[12.5px] text-black/45 dark:text-white/45">{subOf(a)}{subOf(a) ? ' · ' : ''}{fmtDate(a.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </div>
                  <DocumentLinks ids={a.documents ?? []} />
                  <Pill tone={statusTone(a.status)}>{a.status}</Pill>
                  <div className="flex flex-wrap items-center gap-2">
                    {approver && a.status === 'Pending' && (
                      <button onClick={() => verify(a)} disabled={busy} className={`${pillBtn} bg-sky-600 text-white hover:bg-sky-700`}>Verify</button>
                    )}
                    {approver && a.status === 'Verified' && (
                      <button onClick={() => setModal({ t: 'approve', app: a })} disabled={busy} className={`${pillBtn} bg-emerald-600 text-white hover:bg-emerald-700`}>Approve</button>
                    )}
                    {approver && (a.status === 'Pending' || a.status === 'Verified') && (
                      <button onClick={() => setModal({ t: 'decline', app: a })} disabled={busy} className={ghostPill}>Decline</button>
                    )}
                    {cert && <CertificateDownload cert={cert} studentName={nameOf(a.studentId)} compact={approver} />}
                    {a.status === 'Approved' && a.kind === 'Admission' && <span className="text-[12px] font-semibold text-emerald-600">Accounts created{a.studentId && nameOf(a.studentId) ? ` · ${nameOf(a.studentId)}` : ''}</span>}
                    {a.status === 'Approved' && !cert && isCertificateKind(a.kind) && <span className="text-[12px] font-semibold text-emerald-600">Approved</span>}
                    {adminRole && (
                      <button onClick={() => remove(a)} disabled={busy} className="rounded-full p-1.5 text-black/35 hover:bg-rose-50 hover:text-rose-500 dark:text-white/35" title="Delete application"><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
                {(a.status === 'Declined' && a.notes) && <p className="mt-2 text-[12.5px] text-rose-600 dark:text-rose-400">Reason: {a.notes}</p>}
                {a.decidedAt && a.status !== 'Pending' && (
                  <p className="mt-1 text-[12px] text-black/40 dark:text-white/40">{a.status} {nameOf(a.decidedById) ? `by ${nameOf(a.decidedById)} ` : ''}on {fmtDate(a.decidedAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                )}
              </div>
            )
          })}
        </Card>
      )}

      <Modal open={modal?.t === 'cert'} onClose={() => setModal(null)} title="Apply for a certificate">
        {modal?.t === 'cert' && <CertificateApplicationForm students={applyStudents} wholeSchool={approver} onDone={() => { setModal(null); reloadAll() }} />}
      </Modal>
      <Modal open={modal?.t === 'issue'} onClose={() => setModal(null)} title="Issue a certificate directly">
        {modal?.t === 'issue' && <IssueCertificateForm students={applyStudents} wholeSchool={approver} onDone={() => { setModal(null); setTab('Issued'); reloadAll() }} />}
      </Modal>
      <Modal open={modal?.t === 'decline'} onClose={() => setModal(null)} title="Decline application">
        {modal?.t === 'decline' && <DeclineForm app={modal.app} onDone={() => { setModal(null); apps.reload() }} />}
      </Modal>
      <Modal open={modal?.t === 'approve'} onClose={() => setModal(null)} title={modal?.t === 'approve' && modal.app.kind === 'Admission' ? 'Approve admission' : 'Approve & issue certificate'} wide={modal?.t === 'approve' && modal.app.kind === 'Admission'}>
        {modal?.t === 'approve' && <ApproveDialog app={modal.app} onClose={() => setModal(null)} onChanged={reloadAll} boardName={modal.app.targetBoardId ? boardById.get(modal.app.targetBoardId)?.name : undefined} />}
      </Modal>
    </div>
  )
}

export function AdmissionForm({ onDone }: { onDone: () => void }) {
  const { classes, classById, currentYear, gradeById } = useAcademic()
  const options = useMemo(() => classes.filter(c => !currentYear || c.academicYearId === currentYear.id).sort(compareClasses(gradeById)), [classes, currentYear, gradeById])
  const [f, setF] = useState({ applicantName: '', dob: '', gender: '', gName: '', gPhone: '', gEmail: '', gRelation: 'Parent', targetClassId: options[0]?.id ?? '' })
  const [docs, setDocs] = useState<UploadedFile[]>([])
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(x => ({ ...x, [k]: e.target.value }))
  const valid = f.applicantName.trim() && f.dob && f.gName.trim() && f.targetClassId
  const submit = async () => {
    setBusy(true)
    try {
      await api.post('/applications', {
        kind: 'Admission', applicantName: f.applicantName.trim(), dob: f.dob, gender: f.gender || undefined,
        guardian: { name: f.gName.trim(), phone: f.gPhone.trim() || undefined, email: f.gEmail.trim() || undefined, relation: f.gRelation },
        targetClassId: f.targetClassId, targetBoardId: classById.get(f.targetClassId)?.boardId, documents: docs.map(d => d.id),
      })
      toast.success('Admission application recorded')
      onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Applicant name"><input value={f.applicantName} onChange={set('applicantName')} className={inputCls} autoFocus /></Field>
        <Field label="Date of birth"><input type="date" value={f.dob} onChange={set('dob')} className={inputCls} /></Field>
        <Field label="Gender">
          <select value={f.gender} onChange={set('gender')} className={inputCls}>
            <option value="">Prefer not to say</option><option>Female</option><option>Male</option><option>Other</option>
          </select>
        </Field>
        <Field label="Admit to class">
          <select value={f.targetClassId} onChange={set('targetClassId')} className={inputCls}>
            {options.length === 0 && <option value="">No classes in the current year</option>}
            {options.map(c => <option key={c.id} value={c.id}>{c.label} · {c.boardCode}</option>)}
          </select>
        </Field>
      </div>
      <p className="text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Guardian</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><input value={f.gName} onChange={set('gName')} className={inputCls} /></Field>
        <Field label="Relation">
          <select value={f.gRelation} onChange={set('gRelation')} className={inputCls}><option>Parent</option><option>Mother</option><option>Father</option><option>Guardian</option></select>
        </Field>
        <Field label="Phone"><input value={f.gPhone} onChange={set('gPhone')} placeholder="+91 …" className={inputCls} /></Field>
        <Field label="Email (links an existing parent account if it matches)"><input type="email" value={f.gEmail} onChange={set('gEmail')} className={inputCls} /></Field>
      </div>
      <Field label="Documents (birth certificate, previous TC, ID…)">
        <UploadField files={docs} onChange={setDocs} multiple accept=".pdf,.png,.jpg,.jpeg,.docx" hint="PDF, images or DOCX · up to 10 MB each" />
      </Field>
      <button onClick={submit} disabled={!valid || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Record application'}</button>
    </div>
  )
}

// `wholeSchool` (approver flow, applying/issuing for any student in the school) swaps the bounded flat
// `<select>` for an AsyncEntityPicker over the whole roster; the non-approver flow keeps the flat select
// over `students` since that's already bounded to the caller's own viewed wards (parent/student), never the
// full school. See ui-architecture-fix.md Phase B.
function CertificateApplicationForm({ students, wholeSchool, onDone }: { students: User[]; wholeSchool?: boolean; onDone: () => void }) {
  const { classOf } = useAcademic()
  const [kind, setKind] = useState<CertificateKind>('Bonafide')
  const [studentId, setStudentId] = useState(wholeSchool ? '' : (students[0]?.id ?? ''))
  const [studentName, setStudentName] = useState('')
  const [notes, setNotes] = useState('')
  const [docs, setDocs] = useState<UploadedFile[]>([])
  const [busy, setBusy] = useState(false)
  const student = students.find(s => s.id === studentId)
  const applicantName = wholeSchool ? studentName : (student?.name ?? '')
  const submit = async () => {
    if (!studentId || !applicantName) return
    setBusy(true)
    try {
      await api.post('/applications', { kind, studentId, applicantName, notes: notes.trim() || undefined, documents: docs.map(d => d.id) })
      toast.success(`${KIND_LABEL[kind]} requested`)
      onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <Field label="Certificate">
        <select value={kind} onChange={e => setKind(e.target.value as CertificateKind)} className={inputCls}>
          {CERTIFICATE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </Field>
      {wholeSchool ? (
        <Field label="Student">
          <AsyncEntityPicker role="student" value={studentId} onChange={(id, label) => { setStudentId(id); setStudentName(label) }} placeholder="Search students…" />
        </Field>
      ) : students.length > 1 ? (
        <Field label="Student">
          <select value={studentId} onChange={e => setStudentId(e.target.value)} className={inputCls}>
            {students.map(s => <option key={s.id} value={s.id}>{s.name}{classOf(s.id) ? ` · ${classOf(s.id)!.label}` : ''}</option>)}
          </select>
        </Field>
      ) : student && <p className="text-[13.5px] text-black/60 dark:text-white/60">For <b>{student.name}</b>{classOf(student.id) ? ` · ${classOf(student.id)!.label}` : ''}</p>}
      <Field label="Reason / notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder={kind === 'TC' ? 'Where is the student moving to, and when?' : 'What is the certificate needed for?'} className={inputCls} /></Field>
      <Field label="Supporting documents (optional)"><UploadField files={docs} onChange={setDocs} multiple accept=".pdf,.png,.jpg,.jpeg" /></Field>
      <button onClick={submit} disabled={!studentId || !applicantName || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Submitting…' : 'Submit application'}</button>
    </div>
  )
}

function IssueCertificateForm({ students, wholeSchool, onDone }: { students: User[]; wholeSchool?: boolean; onDone: () => void }) {
  const { classOf } = useAcademic()
  const [kind, setKind] = useState<CertificateKind>('Bonafide')
  const [studentId, setStudentId] = useState(wholeSchool ? '' : (students[0]?.id ?? ''))
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      const res = await api.post<{ item: Certificate }>('/certificates', { kind, studentId })
      toast.success(`Issued ${res?.item?.serialNo ?? 'certificate'}`)
      onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <p className="text-[13.5px] text-black/60 dark:text-white/60">Issues a numbered certificate straight away, without an application. A TC issued here does not close the student’s enrolment.</p>
      <Field label="Certificate">
        <select value={kind} onChange={e => setKind(e.target.value as CertificateKind)} className={inputCls}>
          {CERTIFICATE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </Field>
      <Field label="Student">
        {wholeSchool ? (
          <AsyncEntityPicker role="student" value={studentId} onChange={id => setStudentId(id)} placeholder="Search students…" />
        ) : (
          <select value={studentId} onChange={e => setStudentId(e.target.value)} className={inputCls}>
            {students.length === 0 && <option value="">No students yet</option>}
            {students.map(s => <option key={s.id} value={s.id}>{s.name}{classOf(s.id) ? ` · ${classOf(s.id)!.label}` : ''}</option>)}
          </select>
        )}
      </Field>
      <button onClick={submit} disabled={!studentId || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Issuing…' : 'Issue certificate'}</button>
    </div>
  )
}

function DeclineForm({ app, onDone }: { app: ApplicationRec; onDone: () => void }) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try { await api.post(`/applications/${app.id}/decline`, { notes: notes.trim() }); toast.success('Application declined'); onDone() }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <p className="text-[13.5px] text-black/60 dark:text-white/60">Declining the <b>{app.kind}</b> application for <b>{app.applicantName}</b>. The applicant sees your reason.</p>
      <Field label="Reason"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} autoFocus className={inputCls} /></Field>
      <button onClick={submit} disabled={!notes.trim() || busy} className="w-full rounded-xl bg-rose-600 py-3 text-[14px] font-semibold text-white hover:bg-rose-700 disabled:opacity-40">{busy ? 'Declining…' : 'Decline'}</button>
    </div>
  )
}

/** Admission: previews the accounts the server will create, then shows their credentials once. Certificates: confirm → issued. */
function ApproveDialog({ app, boardName, onClose, onChanged }: { app: ApplicationRec; boardName?: string; onClose: () => void; onChanged: () => void }) {
  const { db, refreshDB, refreshAcademic } = useStore()
  const { classById } = useAcademic()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ item: ApplicationRec; created?: AdmissionCreated } | null>(null)
  const isAdmission = app.kind === 'Admission'
  const cls = app.targetClassId ? classById.get(app.targetClassId) : undefined
  const gEmail = app.guardian?.email?.trim().toLowerCase()
  const existingParent = gEmail ? db.users.find(u => u.role === 'parent' && u.email.toLowerCase() === gEmail) : undefined
  const student = app.studentId ? db.users.find(u => u.id === app.studentId) : undefined

  const run = async () => {
    setBusy(true)
    try {
      const res = await api.post<{ item: ApplicationRec; created?: AdmissionCreated }>(`/applications/${app.id}/approve`)
      if (isAdmission) await Promise.all([refreshDB(), refreshAcademic()])
      else if (app.kind === 'TC') await refreshAcademic()
      onChanged()
      setResult(res)
      toast.success(isAdmission ? 'Admission approved — accounts created' : `${KIND_LABEL[app.kind]} issued`)
      if (!isAdmission) onClose()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  if (result?.created) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-4 text-[13px] text-amber-800 dark:text-amber-300">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <p>These passwords are shown <b>only once</b>. Share them with the family now — both accounts must change them at first sign-in.</p>
        </div>
        <div>
          <p className="mb-2 text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Student · {app.applicantName}</p>
          <div className="space-y-2">
            <CredentialRow label="Email" value={result.created.student.email} />
            <CredentialRow label="Password" value={result.created.student.password} />
          </div>
        </div>
        {result.created.parent ? (
          <div>
            <p className="mb-2 text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Parent · {app.guardian?.name ?? 'Guardian'}</p>
            <div className="space-y-2">
              <CredentialRow label="Email" value={result.created.parent.email} />
              <CredentialRow label="Password" value={result.created.parent.password} />
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-black/60 dark:text-white/60">Linked to the existing parent account{existingParent ? ` of ${existingParent.name}` : ''} — no new parent password.</p>
        )}
        <button onClick={onClose} className="btn-ink w-full py-3 text-[14px] font-semibold">Done</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {isAdmission ? (
        <>
          <p className="text-[13.5px] text-black/60 dark:text-white/60">Approving creates the accounts below in one step and enrols the student with the next free roll number.</p>
          <div className="space-y-2">
            <div className="rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-4 py-3">
              <p className="text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Student account</p>
              <p className="text-[14px] font-semibold">{app.applicantName}</p>
              <p className="text-[12.5px] text-black/50 dark:text-white/50">{cls ? `Enrolled in ${cls.label}${boardName ? ` · ${boardName}` : ''}` : 'No target class — set one before approving'}{app.dob ? ` · DOB ${fmtDate(app.dob, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</p>
            </div>
            <div className="rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-4 py-3">
              <p className="text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">{existingParent ? 'Existing parent (linked as guardian)' : 'Parent account'}</p>
              <p className="text-[14px] font-semibold">{existingParent?.name ?? app.guardian?.name ?? 'Guardian'}</p>
              <p className="text-[12.5px] text-black/50 dark:text-white/50">{[app.guardian?.relation, app.guardian?.email || (existingParent ? existingParent.email : 'email will be generated'), app.guardian?.phone].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
        </>
      ) : (
        <p className="text-[13.5px] text-black/60 dark:text-white/60">
          Issues a numbered <b>{KIND_LABEL[app.kind]}</b> for <b>{student?.name ?? app.applicantName}</b>{app.kind === 'TC' ? ' and marks their enrolment as transferred' : ''}. The PDF becomes downloadable for the family straight away.
        </p>
      )}
      <div className="flex gap-3">
        <button onClick={run} disabled={busy || (isAdmission && !cls)} className="flex-1 rounded-xl bg-emerald-600 py-3 text-[14px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">{busy ? 'Approving…' : isAdmission ? 'Approve & create accounts' : 'Approve & issue'}</button>
        <button onClick={onClose} className="rounded-xl bg-black/[.05] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:bg-white/[.07] dark:hover:bg-white/15">Cancel</button>
      </div>
    </div>
  )
}

/* ── People management (students, teachers, staff, parents, admins) ── */

type PeopleTabId = 'students' | 'teachers' | 'staff' | 'parents' | 'admins'
type PeopleTab = { id: PeopleTabId; label: string; singular: string; roles: Role[] }

const ALL_TABS: PeopleTab[] = [
  { id: 'students', label: 'Students', singular: 'student', roles: ['student'] },
  { id: 'teachers', label: 'Teachers', singular: 'teacher', roles: ['teacher'] },
  { id: 'staff', label: 'Staff', singular: 'staff', roles: ['staff'] },
  { id: 'parents', label: 'Parents', singular: 'parent', roles: ['parent'] },
  { id: 'admins', label: 'Admins', singular: 'admin', roles: ['admin', 'superadmin'] },
]

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/** Add-one-at-a-time picker over an unbounded role (AsyncEntityPicker, Phase B) — replaces the old flat
 * checkbox grid that rendered every parent/student in the school. Selected ids show as removable chips;
 * names resolve from the already-loaded `db.users` cache (`nameOf`), not from the search results — no need
 * to keep a whole-roster array around just to label a handful of already-chosen ids. `pickKey` remounts the
 * inner AsyncEntityPicker after each add so its search text clears, ready for the next pick. */
export function AsyncPickList({ role, selected, onAdd, onRemove, nameOf, placeholder }: {
  role: Role | Role[]
  selected: string[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  nameOf: (id: string) => string
  placeholder: string
}) {
  const [pickKey, setPickKey] = useState(0)
  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(id => (
            <span key={id} className="flex items-center gap-1.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 px-3 py-1.5 text-[12.5px] font-medium text-indigo-700 dark:text-indigo-300">
              {nameOf(id)}
              <button type="button" onClick={() => onRemove(id)} aria-label={`Remove ${nameOf(id)}`} className="rounded-full p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-500/20"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <AsyncEntityPicker key={pickKey} role={role} value=""
        onChange={id => { if (id) { onAdd(id); setPickKey(k => k + 1) } }}
        placeholder={placeholder} />
    </div>
  )
}

export function CredentialRow({ label, value }: { label: string; value: string }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); toast.success(`${label} copied`) }
    catch { toast.error('Could not copy — select the text manually') }
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">{label}</p>
        <p className="select-all truncate font-mono text-[14px]">{value}</p>
      </div>
      <button onClick={copy} className="flex items-center gap-1 rounded-full bg-white dark:bg-[#14141f] px-3 py-1.5 text-[12px] font-semibold ring-1 ring-black/10 dark:ring-white/15 hover:bg-black/[.04] dark:hover:bg-white/[.08]" title={`Copy ${label.toLowerCase()}`}>
        <Copy size={13} /> Copy
      </button>
    </div>
  )
}

export function PeopleMod() {
  const navigate = useNavigate()
  const { db, user, setUserActive, refreshDB } = useStore()
  const academic = useAcademic()
  const { currentYear, classById, subjectById, classOf, wardsOf, classesTaughtBy } = academic
  const current = user!
  const isSuper = isSuperAdmin(current)

  const tabs = ALL_TABS.filter(t => t.id !== 'admins' || isSuper)
  const [tab, setTabState] = useState<PeopleTabId>('students')

  const [search, setSearch] = useState('')
  const [cls, setCls] = useState('')
  const [subject, setSubject] = useState('')
  const [department, setDepartment] = useState('')

  const [confirmId, setConfirmId] = useState<string | null>(null)

  const setTab = (t: PeopleTabId) => { setTabState(t); setCls(''); setSubject(''); setDepartment('') }

  const activeTab = tabs.find(t => t.id === tab) ?? tabs[0]
  const activeRoles = activeTab.roles

  /* ── entity lookups ── */
  const yearClasses = useMemo(
    () => academic.classes.filter(c => !currentYear || c.academicYearId === currentYear.id).slice().sort(compareClasses(academic.gradeById)),
    [academic.classes, academic.gradeById, currentYear],
  )
  const userById = useMemo(() => new Map(db.users.map(u => [u.id, u])), [db.users])

  const enrollmentOf = (studentId: string) =>
    academic.enrollments.find(e => e.studentId === studentId && e.status === 'active' && (!currentYear || e.academicYearId === currentYear.id))
    ?? academic.enrollments.find(e => e.studentId === studentId)
  const guardiansOf = (studentId: string) => academic.guardians.filter(g => g.studentId === studentId)
  const classTeacherOf = (teacherId: string) => academic.classes.find(c => c.classTeacherId === teacherId)
  const teachingOf = (teacherId: string) => academic.classSubjects
    .filter(cs => cs.teacherId === teacherId)
    .map(cs => ({ id: cs.id, label: `${subjectById.get(cs.subjectId)?.name ?? 'Subject'} · ${classById.get(cs.classId)?.label ?? '—'}` }))

  const departmentOptions = useMemo(
    () => Array.from(new Set(db.users.map(u => u.department).filter((d): d is string => !!d))).sort(),
    [db.users],
  )

  const filtersActive = !!(search || cls || subject || department)
  // Class option text: "X-A · CBSE" (plus " · Science" when the class has a stream)
  const classOption = (c: { label: string; boardCode: string; stream?: string }) => `${c.label} · ${c.boardCode}${c.stream ? ' · ' + c.stream : ''}`

  // Plain derivation (no manual useMemo): the React Compiler memoizes it, and the
  // preserve-manual-memoization rule can't prove `activeRoles` stable otherwise.
  const q = search.trim().toLowerCase()
  const filtered = db.users.filter(u => {
    if (!activeRoles.includes(u.role)) return false
    if (cls) {
      if (u.role === 'student' && classOf(u.id)?.id !== cls) return false
      if (u.role === 'teacher' && !classesTaughtBy(u.id).some(c => c.id === cls)) return false
    }
    if (subject && u.role === 'teacher' && !academic.classSubjects.some(cs => cs.teacherId === u.id && cs.subjectId === subject)) return false
    if (department && u.department !== department) return false
    if (q) return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    return true
  }).sort(byName)

  // Bug A fix: "Revoke access" soft-deactivates (User.active = false) instead of hard-deleting the
  // account — reversible via "Reactivate" below, matching the resignation-approval convention.
  const confirmDelete = async () => {
    if (!confirmId) return
    const ok = await setUserActive(confirmId, false)
    if (ok) toast.success('Access revoked — account deactivated')
    else toast.error('Cannot revoke your own access or the last superadmin')
    setConfirmId(null)
  }

  const [reactivateBusy, setReactivateBusy] = useState<string | null>(null)
  const reactivate = async (u: User) => {
    setReactivateBusy(u.id)
    const ok = await setUserActive(u.id, true)
    if (ok) toast.success(`${u.name}'s access restored`)
    else toast.error('Could not restore access')
    setReactivateBusy(null)
  }

  const canEdit = (u: User) => user ? canManage(user, u, db.users) : false

  const tabLabel = activeTab.label
  const addBlocked = tab === 'students' && yearClasses.length === 0
  const showClassFilter = (tab === 'students' || tab === 'teachers') && yearClasses.length > 0
  const showSubjectFilter = tab === 'teachers' && academic.subjects.length > 0
  const showDeptFilter = (tab === 'staff' || tab === 'admins') && departmentOptions.length > 0

  const emptyText = filtersActive
    ? 'No people match the filters.'
    : tab === 'students'
      ? (yearClasses.length === 0 ? 'No classes yet. Create a class in Academic Setup, then add students.' : 'No students yet. Add the first one.')
      : `No ${tabLabel.toLowerCase()} yet.`

  const roleTone = (r: Role) => r === 'student' ? 'sky' : r === 'teacher' ? 'indigo' : r === 'parent' ? 'green' : r === 'staff' ? 'amber' : 'rose'
  const muted = 'text-[12.5px] text-black/50 dark:text-white/50'
  const isEmployeeRole = (r: Role) => r === 'teacher' || r === 'staff' || r === 'admin' || r === 'superadmin'

  // Phase 22 item 3: the narrow flag gating the counseling module — admin/superadmin only, its own
  // endpoint (not the generic PATCH /users/:id) since staff-managing-teacher must never be able to grant
  // it. See phase-22-campus-safety.md.
  const [counselorBusy, setCounselorBusy] = useState<string | null>(null)
  const toggleCounselor = async (u: User) => {
    setCounselorBusy(u.id)
    try {
      await api.patch(`/users/${u.id}/counselor`, { isCounselor: !u.isCounselor })
      await refreshDB()
      toast.success(u.isCounselor ? `${u.name} is no longer a counselor` : `${u.name} can now access the counseling module`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setCounselorBusy(null) }
  }

  const details = (u: User) => {
    if (u.role === 'student') {
      const c = classOf(u.id)
      const e = enrollmentOf(u.id)
      const gs = guardiansOf(u.id).map(g => userById.get(g.parentId)?.name).filter(Boolean)
      return (
        <>
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            <span>Class {c?.label ?? '—'}</span>
            {c && <Pill tone="indigo">{c.boardCode}</Pill>}
            {c?.stream && <Pill tone="sky">{c.stream}</Pill>}
            <span>· Roll {e?.rollNo || '—'}</span>
          </p>
          <p className={muted}>{u.dob ? `DOB ${u.dob}` : 'No DOB on file'}</p>
          <p className={muted}>Parent(s): {gs.length ? gs.join(', ') : '—'}</p>
        </>
      )
    }
    if (u.role === 'teacher') {
      const ct = classTeacherOf(u.id)
      const t = teachingOf(u.id)
      return (
        <>
          <p className="font-medium">Class teacher of {ct?.label ?? '—'}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {t.length ? t.map(x => <Pill key={x.id} tone="indigo">{x.label}</Pill>) : <span className={muted}>No subjects assigned</span>}
          </div>
          {u.employeeId && <p className={muted}>ID: {u.employeeId}</p>}
        </>
      )
    }
    if (u.role === 'parent') {
      const wards = wardsOf(u.id).map(id => userById.get(id)).filter((w): w is User => !!w)
      return (
        <>
          <p className="font-medium">{wards.length ? `Parent of ${wards.map(w => w.name).join(', ')}` : 'No wards linked'}</p>
          {wards.length > 0 && <p className={muted}>{wards.map(w => `${w.name} · ${classOf(w.id)?.label ?? '—'}`).join(' / ')}</p>}
        </>
      )
    }
    if (u.role === 'staff') {
      return (
        <>
          <p className="font-medium">{u.designation || u.title || '—'}</p>
          <p className={muted}>{u.department || '—'}{u.joinDate ? ` · since ${u.joinDate}` : ''}</p>
          {u.employeeId && <p className={muted}>ID: {u.employeeId}</p>}
        </>
      )
    }
    return (
      <>
        <p className="font-medium">{u.designation || u.title || u.role}</p>
        <p className={muted}>Access: {u.department || '—'}</p>
        {u.employeeId && <p className={muted}>ID: {u.employeeId}</p>}
      </>
    )
  }

  return (
    <div>
      <PageHead title="People Management" sub={`${tabLabel} · search, filter, add, edit and revoke access`}>
        <button onClick={() => navigate(`/portal/people/new?role=${tab === 'admins' ? 'admin' : activeTab.singular}`)} disabled={addBlocked} title={addBlocked ? 'Create a class first in Academic Setup' : undefined}
          className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40">
          <UserPlus size={15} /> Add {activeTab.singular}
        </button>
      </PageHead>

      {/* tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${tab === t.id ? 'bg-black text-white' : 'bg-white dark:bg-[#14141f] text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white border border-black/[.06] dark:border-white/[.08]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* filters */}
      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#14141f] px-3 py-2">
            <Search size={16} className="text-black/40 dark:text-white/40" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email" className="flex-1 bg-transparent text-[14px] outline-none" />
          </div>
          {showClassFilter && (
            <select value={cls} onChange={e => setCls(e.target.value)} className={inputCls + ' w-auto min-w-[120px]'}>
              <option value="">All classes</option>
              {yearClasses.map(c => <option key={c.id} value={c.id}>{classOption(c)}</option>)}
            </select>
          )}
          {showSubjectFilter && (
            <select value={subject} onChange={e => setSubject(e.target.value)} className={inputCls + ' w-auto min-w-[140px]'}>
              <option value="">All subjects</option>
              {academic.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {showDeptFilter && (
            <select value={department} onChange={e => setDepartment(e.target.value)} className={inputCls + ' w-auto min-w-[140px]'}>
              <option value="">All departments</option>
              {departmentOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {filtersActive && (
            <button onClick={() => { setSearch(''); setCls(''); setSubject(''); setDepartment('') }}
              className="flex items-center gap-1 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
              <X size={13} /> Clear
            </button>
          )}
        </div>
      </Card>

      {/* desktop table */}
      <Card className="hidden p-0 md:block">
        <table className="w-full text-left text-[14px]">
          <thead className="border-b border-black/[.06] dark:border-white/[.08]">
            <tr className="text-[12px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
              <th className="px-6 py-3.5">Person</th>
              <th className="px-6 py-3.5">Role details</th>
              <th className="px-6 py-3.5">Contact</th>
              <th className="px-6 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={u.name} hue={u.avatarHue} size={40} />
                    <div>
                      <p className="font-semibold">{u.name}</p>
                      <div className="flex items-center gap-1.5">
                        <Pill tone={roleTone(u.role)}>{u.role}</Pill>
                        {u.active === false && <Pill tone="rose">Inactive</Pill>}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">{details(u)}</td>
                <td className="px-6 py-4">
                  <p className="text-[13.5px]">{u.email}</p>
                  {u.phone && <p className={muted}>{u.phone}</p>}
                </td>
                <td className="px-6 py-4 text-right">
                  {canEdit(u) ? (
                    <div className="flex items-center justify-end gap-2">
                      {u.role === 'student' && (
                        <button onClick={() => navigate(`/portal/students/${u.id}/report`)} className="rounded-full bg-indigo-50 dark:bg-indigo-500/10 p-2 text-indigo-600 hover:bg-indigo-100 dark:hover:bg-indigo-500/20" title="View full report"><FileBadge size={15} /></button>
                      )}
                      {isEmployeeRole(u.role) && (
                        <button onClick={() => navigate(`/portal/employees/${u.id}`)} className="rounded-full bg-indigo-50 dark:bg-indigo-500/10 p-2 text-indigo-600 hover:bg-indigo-100 dark:hover:bg-indigo-500/20" title="View profile — history, documents, ID card"><History size={15} /></button>
                      )}
                      {isEmployeeRole(u.role) && isAdmin(current) && (
                        <button onClick={() => toggleCounselor(u)} disabled={counselorBusy === u.id}
                          className={`rounded-full p-2 disabled:opacity-40 ${u.isCounselor ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/10' : 'bg-black/[.05] dark:bg-white/[.07] hover:bg-black/10 dark:hover:bg-white/15'}`}
                          title={u.isCounselor ? 'Counselor — click to revoke access to the counseling module' : 'Grant access to the confidential counseling module'}>
                          <HeartHandshake size={15} />
                        </button>
                      )}
                      <button onClick={() => navigate(`/portal/people/${u.id}/edit`)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15" title="Edit"><Pencil size={15} /></button>
                      {u.active === false ? (
                        <button onClick={() => reactivate(u)} disabled={reactivateBusy === u.id} className="rounded-full bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-100 disabled:opacity-40" title="Reactivate access"><UserCheck size={15} /></button>
                      ) : (
                        <button onClick={() => setConfirmId(u.id)} className="rounded-full bg-rose-50 p-2 text-rose-500 hover:bg-rose-100" title="Revoke access"><UserX size={15} /></button>
                      )}
                    </div>
                  ) : (
                    <span className="text-[12px] text-black/40 dark:text-white/40">Protected</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="p-6"><Empty text={emptyText} /></div>}
      </Card>

      {/* mobile card list */}
      <div className="space-y-3 md:hidden">
        {filtered.map(u => (
          <Card key={u.id} className="flex items-start gap-3">
            <Avatar name={u.name} hue={u.avatarHue} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-semibold">{u.name}</p>
                <div className="flex items-center gap-1.5">
                  <Pill tone={roleTone(u.role)}>{u.role}</Pill>
                  {u.active === false && <Pill tone="rose">Inactive</Pill>}
                </div>
              </div>
              <p className="truncate text-[13px]">{u.email}</p>
              {u.phone && <p className={muted}>{u.phone}</p>}
              <div className="mt-1.5 text-[13px]">{details(u)}</div>
              {canEdit(u) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {u.role === 'student' && (
                    <button onClick={() => navigate(`/portal/students/${u.id}/report`)} className="btn-ink flex flex-1 items-center justify-center gap-1 py-2 text-[13px] font-semibold"><FileBadge size={14} /> Report</button>
                  )}
                  {isEmployeeRole(u.role) && (
                    <button onClick={() => navigate(`/portal/employees/${u.id}`)} className="btn-ink flex flex-1 items-center justify-center gap-1 py-2 text-[13px] font-semibold"><History size={14} /> Profile</button>
                  )}
                  {isEmployeeRole(u.role) && isAdmin(current) && (
                    <button onClick={() => toggleCounselor(u)} disabled={counselorBusy === u.id}
                      className={`flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[13px] font-semibold disabled:opacity-40 ${u.isCounselor ? 'bg-emerald-50 text-emerald-600' : 'bg-black/[.05] dark:bg-white/[.07]'}`}>
                      <HeartHandshake size={14} /> {u.isCounselor ? 'Counselor' : 'Make counselor'}
                    </button>
                  )}
                  <button onClick={() => navigate(`/portal/people/${u.id}/edit`)} className="btn-ink flex flex-1 items-center justify-center gap-1 py-2 text-[13px] font-semibold"><Pencil size={14} /> Edit</button>
                  {u.active === false ? (
                    <button onClick={() => reactivate(u)} disabled={reactivateBusy === u.id} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-50 py-2 text-[13px] font-semibold text-emerald-600 disabled:opacity-40"><UserCheck size={14} /> Reactivate</button>
                  ) : (
                    <button onClick={() => setConfirmId(u.id)} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-rose-50 py-2 text-[13px] font-semibold text-rose-500"><UserX size={14} /> Revoke</button>
                  )}
                </div>
              )}
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <Card><Empty text={emptyText} /></Card>}
      </div>

      {/* delete confirmation */}
      <Modal open={!!confirmId} onClose={() => setConfirmId(null)} title="Revoke access?">
        <div className="space-y-4">
          <p className="text-[14px] text-black/60 dark:text-white/60">This deactivates the account — they will no longer be able to log in, but their history (enrollment, records, certificates) is kept and access can be restored any time from this screen. You cannot revoke your own access or the last remaining superadmin.</p>
          <div className="flex gap-3">
            <button onClick={confirmDelete} className="btn-ink flex-1 py-3 text-[14px] font-semibold bg-rose-600 hover:bg-rose-700">Revoke access</button>
            <button onClick={() => setConfirmId(null)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
          </div>
        </div>
      </Modal>

    </div>
  )
}

/* ── Fees management (admin/staff) ─────────────────────── */


/* ── Calendar & curriculum admin ───────────────────────── */

export function CalendarAdminMod() {
  const academic = useAcademic()
  const { items: events, reload } = useCalendarEvents()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayISO)
  const [type, setType] = useState<'holiday' | 'exam' | 'event'>('event')
  const [audience, setAudience] = useState<'School' | 'Class'>('School')
  const [classId, setClassId] = useState('')
  const [editing, setEditing] = useState<CalendarEventRec | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setTitle(''); setDate(todayISO()); setType('event'); setAudience('School'); setClassId(''); setEditing(null)
  }

  const save = async () => {
    if (!title.trim() || (audience === 'Class' && !classId)) return
    setSaving(true)
    // classId must be omitted (not null) for whole-school events — the server schema declares it
    // `.optional()`, which accepts a missing key but rejects an explicit null; JSON.stringify drops
    // undefined-valued keys, so this is the fix for "Validation failed" on every whole-school save.
    const body = { title, date, type, audience, classId: audience === 'Class' ? classId : undefined }
    try {
      if (editing) await api.patch(`/calendar/${editing.id}`, body)
      else await api.post('/calendar', body)
      await reload()
      toast.success(editing ? 'Event updated' : 'Calendar updated — visible to all portals')
      reset()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (e: CalendarEventRec) => {
    try {
      await api.del(`/calendar/${e.id}`)
      await reload()
      toast.success('Event removed')
      if (editing?.id === e.id) reset()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const edit = (e: CalendarEventRec) => {
    setEditing(e)
    setTitle(e.title)
    setDate(e.date)
    setType(e.type)
    setAudience(e.audience)
    setClassId(e.classId ?? '')
  }

  const list = events ?? []
  const classLabel = (id?: string | null) => academic.classes.find(c => c.id === id)?.label ?? '—'

  return (
    <div>
      <PageHead title="Calendar Management" sub="Add, edit and remove holidays, exams and events" />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <div className="space-y-4">
            <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Founders’ Day rehearsal" className={inputCls} /></Field>
            <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select value={type} onChange={e => setType(e.target.value as 'holiday' | 'exam' | 'event')} className={inputCls}>
                  <option value="event">Event</option><option value="holiday">Holiday</option><option value="exam">Exam</option>
                </select>
              </Field>
              <Field label="Audience">
                <select value={audience} onChange={e => setAudience(e.target.value as 'School' | 'Class')} className={inputCls}>
                  <option value="School">Whole school</option>
                  <option value="Class">One class</option>
                </select>
              </Field>
            </div>
            {audience === 'Class' && (
              <Field label="Class">
                <select value={classId} onChange={e => setClassId(e.target.value)} className={inputCls} disabled={academic.classes.length === 0}>
                  <option value="">{academic.classes.length === 0 ? 'No classes yet' : 'Select a class'}</option>
                  {academic.classes.map(c => <option key={c.id} value={c.id}>{c.label} · {c.boardCode}</option>)}
                </select>
              </Field>
            )}
            <div className="flex gap-2">
              <button onClick={save} disabled={!title.trim() || (audience === 'Class' && !classId) || saving} className="btn-ink flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">
                <CalendarPlus size={16} /> {editing ? 'Update event' : 'Add to calendar'}
              </button>
              {editing && (
                <button onClick={reset} className="rounded-2xl border border-black/10 dark:border-white/15 px-4 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06]">Cancel</button>
              )}
            </div>
          </div>
        </Card>
        <Card className="p-0">
          <p className="border-b border-black/[.06] dark:border-white/[.08] px-6 py-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Upcoming</p>
          <div className="max-h-[380px] overflow-y-auto thin-scroll">
            {list.length === 0 && <div className="p-6"><Empty text="No calendar entries yet." /></div>}
            {list.map(e => (
              <div key={e.id} className="flex items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3 last:border-0">
                <span className="flex-1 text-[13.5px] font-medium">{e.title}</span>
                <span className="text-[12px] text-black/40 dark:text-white/40">{e.date}</span>
                <Pill tone="slate">{e.audience === 'Class' ? classLabel(e.classId) : 'School'}</Pill>
                <Pill tone={e.type === 'holiday' ? 'rose' : e.type === 'exam' ? 'amber' : 'indigo'}>{e.type}</Pill>
                <button onClick={() => edit(e)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15" aria-label="Edit"><Pencil size={14} className="text-black/50 dark:text-white/50" /></button>
                <button onClick={() => remove(e)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-rose-50 dark:hover:bg-rose-500/10" aria-label="Delete"><Trash2 size={14} className="text-rose-500" /></button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ── Board registration (Phase 4) ──────────────────────── */
// One registration per student per academic year: prefilled from the enrolment, checked against the school
// record, validated by the class teacher / office, sent to the board by an admin. Marksheet PDF built server-side.
// See .agents/edunova/phase-4-admissions-identity.md

export function BoardRegistrationMod() {
  const navigate = useNavigate()
  const { db, user } = useStore()
  const { currentYear, classOf, wardsOf, classesTaughtBy, boards, boardById } = useAcademic()
  const regs = useBoardRegistrations()
  const [search, setSearch] = useState('')
  const [boardFilter, setBoardFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState<BoardRegistrationStatus | 'All' | 'None'>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [prefilling, setPrefilling] = useState(false)
  // Phase 25 item 4 — the board-exam readiness dashboard folds in as a second tab here, next to the
  // per-student registration review, rather than a separate nav item.
  const [tab, setTab] = useState<'registration' | 'readiness'>('registration')
  const canSeeReadiness = !!user && (isStaffOrAdmin(user) || user.role === 'teacher')

  const canEdit = !!user && (isStaffOrAdmin(user) || user.role === 'teacher')

  const students = useMemo(() => {
    const all = db.users.filter(u => u.role === 'student').sort(byName)
    if (!user) return []
    if (user.role === 'student') return all.filter(s => s.id === user.id)
    if (user.role === 'parent') {
      const wardIds = new Set(wardsOf(user.id))
      return all.filter(s => wardIds.has(s.id))
    }
    if (user.role === 'teacher') {
      const mine = new Set(classesTaughtBy(user.id).map(c => c.id))
      return all.filter(s => { const c = classOf(s.id); return !!c && mine.has(c.id) })
    }
    return all
  }, [db.users, user, classOf, wardsOf, classesTaughtBy])

  // Registration per student — prefer the current year's, else the latest one the server returned.
  const regByStudent = useMemo(() => {
    const m = new Map<string, BoardRegistration>()
    for (const r of regs.items ?? []) {
      const cur = m.get(r.studentId)
      if (!cur || (currentYear && r.academicYearId === currentYear.id)) m.set(r.studentId, r)
    }
    return m
  }, [regs.items, currentYear])

  const filtered = useMemo(() => students.filter(s => {
    const r = regByStudent.get(s.id)
    if (statusFilter === 'None' ? !!r : statusFilter !== 'All' && r?.status !== statusFilter) return false
    if (boardFilter !== 'All' && (r?.boardId ?? classOf(s.id)?.boardId) !== boardFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return s.name.toLowerCase().includes(q) || (r?.registrationNo ?? '').toLowerCase().includes(q) || (r?.rollNo ?? '').toLowerCase().includes(q)
    }
    return true
  }), [students, regByStudent, statusFilter, boardFilter, search, classOf])

  const selected = selectedId ? students.find(s => s.id === selectedId) : undefined
  const reg = selected ? regByStudent.get(selected.id) : undefined

  const prefill = async () => {
    if (!selected) return
    setPrefilling(true)
    try {
      await api.post('/board-registrations/prefill', { studentId: selected.id })
      regs.reload()
      toast.success('Draft prefilled from the enrolment')
    } catch (e) { toast.error(errorMessage(e)) } finally { setPrefilling(false) }
  }

  return (
    <div>
      <PageHead title="Board Registration" sub={tab === 'registration' ? 'Check each student’s board record against the school record before it goes to the board' : 'Every student’s syllabus pace, average scores and registration status in one place'}>
        <div className="flex flex-wrap items-center gap-2">
          {canSeeReadiness && (
            <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
              {([{ id: 'registration', label: 'Registration' }, { id: 'readiness', label: 'Readiness' }] as const).map(o => (
                <button key={o.id} onClick={() => setTab(o.id)} className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${tab === o.id ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {tab === 'registration' && (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] px-3 py-2">
                <Search size={15} className="text-black/40 dark:text-white/40" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student / reg no." className="bg-transparent text-[13px] outline-none" />
              </div>
              {boards.length > 1 && (
                <select value={boardFilter} onChange={e => setBoardFilter(e.target.value)} className={`${inputCls} w-auto py-1.5 text-[12.5px]`} aria-label="Board">
                  <option value="All">All boards</option>
                  {boards.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
                </select>
              )}
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as BoardRegistrationStatus | 'All' | 'None')} className={`${inputCls} w-auto py-1.5 text-[12.5px]`} aria-label="Status">
                <option value="All">All statuses</option>
                <option value="None">Not started</option>
                {BOARD_REG_STATUSES.map(s => <option key={s} value={s}>{boardRegLabel(s)}</option>)}
              </select>
            </>
          )}
        </div>
      </PageHead>

      {tab === 'readiness' && canSeeReadiness ? <BoardReadinessDashboard /> : (
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-0">
          <div className="border-b border-black/[.06] dark:border-white/[.08] px-6 py-4">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Students ({filtered.length})</p>
          </div>
          {regs.error && <p className="px-6 py-3 text-[12.5px] text-rose-500">{regs.error}</p>}
          {filtered.length === 0 && <div className="p-6"><Empty text={students.length === 0 ? 'No students to show yet.' : 'No students match the filters.'} /></div>}
          <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">
            {filtered.map(s => {
              const r = regByStudent.get(s.id)
              const cls = classOf(s.id)
              return (
                <button key={s.id} onClick={() => setSelectedId(s.id)}
                  className={`flex w-full items-center gap-4 px-6 py-4 text-left transition-colors ${selectedId === s.id ? 'bg-indigo-50/50 dark:bg-indigo-500/10' : 'hover:bg-black/[.02] dark:hover:bg-white/[.04]'}`}>
                  <Avatar name={s.name} hue={s.avatarHue} size={42} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">{s.name}</p>
                    <p className="text-[12.5px] text-black/50 dark:text-white/50">{cls?.label ?? '—'}{r?.rollNo ? ` · Board roll ${r.rollNo}` : ''} · {boardById.get(r?.boardId ?? cls?.boardId ?? '')?.code ?? 'no board'}</p>
                  </div>
                  {r ? <Pill tone={boardRegTone(r.status)}>{r.status === 'SentToBoard' ? 'Sent' : r.status}</Pill> : <Pill tone="slate">Not started</Pill>}
                </button>
              )
            })}
          </div>
        </Card>

        <Card>
          {!selected ? (
            <div className="py-10 text-center">
              <School size={40} className="mx-auto text-black/20 dark:text-white/20" />
              <p className="mt-4 text-[15px] font-semibold text-black/50 dark:text-white/50">Select a student to review their board registration</p>
            </div>
          ) : !reg ? (
            <div className="py-8 text-center">
              <Avatar name={selected.name} hue={selected.avatarHue} size={56} />
              <p className="mt-4 text-[16px] font-semibold">{selected.name}</p>
              <p className="text-[13px] text-black/50 dark:text-white/50">No board registration for {currentYear?.label ?? 'this year'} yet.</p>
              {canEdit ? (
                <button onClick={prefill} disabled={prefilling || !classOf(selected.id)} title={classOf(selected.id) ? undefined : 'Enrol the student in a class first'}
                  className="btn-ink mt-5 inline-flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
                  <Sparkles size={15} /> {prefilling ? 'Prefilling…' : 'Prefill from enrolment'}
                </button>
              ) : <p className="mt-3 text-[12.5px] text-black/40 dark:text-white/40">The office starts the registration.</p>}
            </div>
          ) : (
            <BoardRegistrationView key={reg.id} student={selected} reg={reg} canEdit={canEdit} onEdit={() => navigate(`/portal/students/${selected.id}/board-registration`)} onChanged={regs.reload} />
          )}
        </Card>
      </div>
      )}
    </div>
  )
}

/* ── Board-exam readiness dashboard (Phase 25 item 4) ──── */

function BoardReadinessDashboard() {
  const { classes, currentYear, gradeById } = useAcademic()
  const classList = useMemo(() => classes.filter(c => !currentYear || c.academicYearId === currentYear.id).sort(compareClasses(gradeById)), [classes, currentYear, gradeById])
  // Grades typically labelled with the board-exam years (X / XII) sort to the front, but any class works.
  const boardYear = (label: string) => /^(X|XII)(\b|-)/i.test(label.trim())
  const [classId, setClassId] = useState('')
  const cls = classId || classList.find(c => boardYear(gradeById.get(c.gradeId)?.label ?? c.label))?.id || classList[0]?.id || ''
  const readiness = useBoardReadiness(cls, !!cls)
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'avgScorePct' | 'status'>('name')

  // `subjectsBehind`/`subjectsTotal` in the response are class-wide (pace is tracked per class-subject,
  // not per student) — shown once as a banner rather than repeated on every row.
  const students = useMemo(() => readiness.data?.students ?? [], [readiness.data])
  const rows = useMemo(() => {
    let list = [...students]
    if (needsAttentionOnly) list = list.filter(s => s.needsAttention)
    list.sort((a, b) => {
      if (sortBy === 'avgScorePct') return (a.avgScorePct ?? -1) - (b.avgScorePct ?? -1)
      if (sortBy === 'status') return a.registrationStatus.localeCompare(b.registrationStatus)
      return a.name.localeCompare(b.name)
    })
    return list
  }, [students, needsAttentionOnly, sortBy])

  const attentionCount = students.filter(s => s.needsAttention).length

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={cls} onChange={e => setClassId(e.target.value)} className={`${inputCls} w-auto py-1.5 text-[12.5px]`} aria-label="Class">
          {classList.length === 0 && <option value="">No classes</option>}
          {classList.map(c => <option key={c.id} value={c.id}>{c.label} · {c.boardCode}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className={`${inputCls} w-auto py-1.5 text-[12.5px]`} aria-label="Sort by">
          <option value="name">Sort: name</option>
          <option value="avgScorePct">Sort: average score</option>
          <option value="status">Sort: registration status</option>
        </select>
        <label className="flex items-center gap-2 rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] px-3.5 py-2 text-[13px] font-medium">
          <input type="checkbox" checked={needsAttentionOnly} onChange={e => setNeedsAttentionOnly(e.target.checked)} className="h-4 w-4 accent-rose-600" />
          Needs attention only {attentionCount > 0 && <span className="text-black/40 dark:text-white/40">({attentionCount})</span>}
        </label>
      </div>

      {readiness.data && (
        <div className={`mb-4 rounded-2xl border p-3.5 text-[13px] ${readiness.data.subjectsBehind > 0 ? 'border-amber-300 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'border-black/[.06] dark:border-white/[.08] text-black/60 dark:text-white/60'}`}>
          {readiness.data.subjectsBehind > 0
            ? <><AlertTriangle size={13} className="mr-1.5 inline" />{readiness.data.subjectsBehind} of {readiness.data.subjectsTotal} subject{readiness.data.subjectsTotal === 1 ? '' : 's'} in this class {readiness.data.subjectsBehind === 1 ? 'is' : 'are'} behind pace — applies to every student in the class.</>
            : `All ${readiness.data.subjectsTotal} subject${readiness.data.subjectsTotal === 1 ? '' : 's'} in this class are on pace.`}
        </div>
      )}

      <Card className="p-0 overflow-x-auto">
        {readiness.loading ? <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>
          : readiness.error ? <div className="p-6"><Empty text={readiness.error} /></div>
          : rows.length === 0 ? <div className="p-6"><Empty text={classList.length === 0 ? 'No classes to show yet.' : needsAttentionOnly ? 'No students need attention right now.' : 'No students in this class.'} /></div>
          : (
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-black/[.06] dark:border-white/[.08] text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
                  <th className="px-6 py-3">Student</th>
                  <th className="px-4 py-3">Avg. score</th>
                  <th className="px-4 py-3">Board registration</th>
                  <th className="px-4 py-3">Flag</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.studentId} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                    <td className="px-6 py-3">
                      <p className="font-semibold">{r.name}</p>
                      {r.rollNo && <p className="text-[11.5px] text-black/40 dark:text-white/40">Roll {r.rollNo}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {r.avgScorePct == null ? <span className="text-black/35 dark:text-white/35">—</span> : (
                        <span className={r.trendingDown ? 'font-semibold text-rose-600' : ''}>{Math.round(r.avgScorePct)}%{r.trendingDown ? ' ↓' : ''}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.registrationStatus === 'NotStarted' ? <Pill tone="slate">Not started</Pill> : <Pill tone={boardRegTone(r.registrationStatus)}>{boardRegLabel(r.registrationStatus)}</Pill>}
                    </td>
                    <td className="px-4 py-3">
                      {r.needsAttention && <Pill tone="rose"><AlertTriangle size={11} /> Needs attention</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>
    </div>
  )
}

function BoardRegistrationView({ student, reg, canEdit, onEdit, onChanged }: { student: User; reg: BoardRegistration; canEdit: boolean; onEdit: () => void; onChanged: () => void }) {
  const { db, user } = useStore()
  const { classOf, classesTaughtBy, boardById, terms, currentTerm, years } = useAcademic()
  const [note, setNote] = useState(reg.mismatchNote ?? '')
  const [busy, setBusy] = useState<'validate' | 'send' | 'note' | 'pdf' | null>(null)
  const [termId, setTermId] = useState(currentTerm?.id ?? terms[0]?.id ?? '')
  const cls = classOf(student.id)
  const board = boardById.get(reg.boardId)
  const isCBSE = (board?.code ?? '').toUpperCase().includes('CBSE')
  const nameMatch = reg.nameOnCertificate.trim().toLowerCase() === student.name.trim().toLowerCase()
  const dobMatch = !!student.dob && reg.dob === student.dob
  const mismatch = !nameMatch || !dobMatch
  const noted = note.trim().length > 0
  const canValidate = !!user && (isStaffOrAdmin(user) || (user.role === 'teacher' && !!cls && classesTaughtBy(user.id).some(c => c.id === cls.id)))
  const canSend = isAdmin(user)
  const nameOf = (id?: string | null) => db.users.find(u => u.id === id)?.name

  const checklist = [
    { label: 'Name on certificate matches the school record (or mismatch noted)', ok: nameMatch || noted },
    { label: 'Date of birth matches the school record (or mismatch noted)', ok: dobMatch || noted },
    { label: 'Board registration number filled', ok: !!reg.registrationNo?.trim() },
    { label: 'Board roll number filled', ok: !!reg.rollNo?.trim() },
    { label: isCBSE ? 'School affiliation number filled' : 'Affiliation number (if the board needs one)', ok: !isCBSE || !!reg.affiliationNo?.trim() },
  ]
  const allOk = checklist.every(c => c.ok)

  const call = async (what: 'validate' | 'send') => {
    setBusy(what)
    try {
      await api.post(`/board-registrations/${reg.id}/${what}`)
      onChanged()
      toast.success(what === 'validate' ? 'Registration validated' : 'Sent to the board')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const saveNote = async () => {
    if ((reg.mismatchNote ?? '') === note.trim()) return
    setBusy('note')
    try { await api.patch(`/board-registrations/${reg.id}`, { mismatchNote: note.trim() || null }); onChanged() }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const marksheet = async () => {
    setBusy('pdf')
    try { await downloadPath(`/board-registrations/${reg.id}/marksheet${qs({ termId })}`, `marksheet-${student.name.replace(/[^\w]+/g, '_')}.pdf`) }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const cell = (label: string, value?: string | null, span = false) => (
    <div className={`rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3 ${span ? 'col-span-2' : ''}`}>
      <p className="text-[12px] text-black/50 dark:text-white/50">{label}</p>
      <p className="font-semibold">{value?.trim() ? value : <span className="text-black/30 dark:text-white/30">—</span>}</p>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={student.name} hue={student.avatarHue} size={48} />
          <div>
            <p className="text-[17px] font-semibold">{student.name}</p>
            <p className="text-[13px] text-black/50 dark:text-white/50">{cls?.label ?? '—'} · {years.find(y => y.id === reg.academicYearId)?.label ?? 'year'}</p>
          </div>
        </div>
        <Pill tone={boardRegTone(reg.status)}>{boardRegLabel(reg.status)}</Pill>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[14px]">
        {cell('Board', board ? `${board.name} (${board.code})` : undefined)}
        {cell('Registration no.', reg.registrationNo)}
        {cell('Board roll no.', reg.rollNo)}
        {cell('Date of birth (board record)', reg.dob)}
        {cell('Name on certificate', reg.nameOnCertificate, true)}
        {(isCBSE || reg.affiliationNo) && cell('Affiliation no.', reg.affiliationNo, true)}
      </div>

      <div className={`rounded-2xl border p-4 ${mismatch ? 'border-amber-300 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-500/10' : 'border-black/[.06] dark:border-white/[.08]'}`}>
        <div className="mb-3 flex items-center gap-2">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">School record vs board record</p>
          {mismatch && <Pill tone="amber"><AlertTriangle size={12} /> Mismatch</Pill>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ComparisonRow label="Student name" school={student.name} board={reg.nameOnCertificate} match={nameMatch} />
          <ComparisonRow label="Date of birth" school={student.dob ?? 'Not set'} board={reg.dob} match={dobMatch} />
        </div>
        {(mismatch || reg.mismatchNote) && (
          <div className="mt-3">
            <Field label={mismatch ? 'Mismatch note (required to validate)' : 'Mismatch note'}>
              <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={saveNote} disabled={!canEdit} placeholder="e.g. Board record carries the official name; school record is missing the middle name." className={`${inputCls} min-h-[80px] disabled:opacity-70`} />
            </Field>
            {mismatch && !noted && <p className="mt-2 flex items-center gap-1.5 text-[12px] text-rose-600"><AlertCircle size={13} /> Explain why the mismatch is acceptable before validating.</p>}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-black/[.06] dark:border-white/[.08] p-4">
        <p className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Validation checklist</p>
        <div className="space-y-2">
          {checklist.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px]">
              {c.ok ? <Check size={14} className="text-emerald-500" /> : <X size={14} className="text-rose-500" />}
              <span className={c.ok ? 'text-black/70 dark:text-white/70' : 'text-black/50 dark:text-white/50'}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      {reg.validatedAt && <p className="text-[12.5px] text-black/50 dark:text-white/50">Validated {nameOf(reg.validatedById) ? `by ${nameOf(reg.validatedById)} ` : ''}on {fmtDate(reg.validatedAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p>}
      {reg.sentAt && <p className="text-[12.5px] text-black/50 dark:text-white/50">Sent to board on {fmtDate(reg.sentAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <button onClick={onEdit} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Pencil size={15} /> Edit details</button>
        )}
        {canValidate && reg.status !== 'Validated' && reg.status !== 'SentToBoard' && (
          <button onClick={() => call('validate')} disabled={!allOk || busy !== null} title={allOk ? undefined : 'Complete the checklist first'} className="flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
            <Check size={15} /> {busy === 'validate' ? 'Validating…' : 'Validate'}
          </button>
        )}
        {canSend && reg.status === 'Validated' && (
          <button onClick={() => call('send')} disabled={busy !== null} className="flex items-center gap-2 rounded-full bg-sky-600 px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-sky-700 disabled:opacity-40">
            <Send size={15} /> {busy === 'send' ? 'Sending…' : 'Send to board'}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-black/[.06] dark:border-white/[.08] pt-4">
        <select value={termId} onChange={e => setTermId(e.target.value)} className={`${inputCls} w-auto py-2 text-[13px]`} aria-label="Term">
          {terms.length === 0 && <option value="">No terms</option>}
          {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button onClick={marksheet} disabled={!termId || busy !== null} className="flex items-center gap-2 rounded-full border border-black/10 dark:border-white/15 px-4 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40">
          <Download size={14} /> {busy === 'pdf' ? 'Preparing…' : 'Download marksheet'}
        </button>
      </div>
    </div>
  )
}

function ComparisonRow({ label, school, board, match }: { label: string; school: string; board: string; match: boolean }) {
  return (
    <div className={`rounded-2xl p-3 ${match ? 'bg-black/[.03] dark:bg-white/[.05]' : 'bg-amber-50/60 dark:bg-amber-500/10 ring-1 ring-amber-200 dark:ring-amber-500/30'}`}>
      <p className="mb-2 text-[12px] font-semibold text-black/50 dark:text-white/50">{label}</p>
      <div className="space-y-1.5 text-[13px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-black/50 dark:text-white/50">School</span>
          <span className="font-medium">{school}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-black/50 dark:text-white/50">Board</span>
          <span className={`font-medium ${match ? '' : 'text-amber-700 dark:text-amber-400'}`}>{board || '—'}</span>
        </div>
      </div>
      {!match && <p className="mt-2 flex items-center gap-1 text-[11.5px] font-semibold text-amber-700 dark:text-amber-400"><AlertTriangle size={12} /> Does not match</p>}
    </div>
  )
}

/* ── Parent verifications (staff/admin queue) ──────────── */

function DocumentThumb({ fileId }: { fileId?: string | null }) {
  const url = useFileUrl(fileId)
  const [broken, setBroken] = useState(false)
  if (!fileId) return <span className="text-[12px] text-black/40 dark:text-white/40">No document attached</span>
  return (
    <div className="flex items-center gap-2">
      {url && !broken && <img src={url} alt="ID document" onError={() => setBroken(true)} className="h-14 w-20 rounded-lg object-cover ring-1 ring-black/10 dark:ring-white/15" />}
      <button onClick={() => downloadFile(fileId, 'id-document').catch(e => toast.error(errorMessage(e)))} className="flex items-center gap-1 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
        <Download size={12} /> Document
      </button>
    </div>
  )
}

export function VerificationsMod() {
  const { db, refreshDB } = useStore()
  const { wardsOf, classOf } = useAcademic()
  const [status, setStatus] = useState<VerificationStatus | ''>('Pending')
  const list = useVerifications(status)
  const [reject, setReject] = useState<ParentVerification | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const nameOf = (id?: string | null) => db.users.find(u => u.id === id)?.name
  const wardsText = (parentId: string) => wardsOf(parentId).map(id => { const s = db.users.find(u => u.id === id); return s ? `${s.name}${classOf(id) ? ` (${classOf(id)!.label})` : ''}` : undefined }).filter(Boolean).join(', ')

  const act = async (v: ParentVerification, what: 'verify' | 'reject') => {
    setBusy(v.id)
    try {
      await api.post(`/verification/${v.id}/${what}`, what === 'reject' ? { note: note.trim() } : {})
      list.reload()
      await refreshDB() // `verified` badge on the parent follows
      setReject(null); setNote('')
      toast.success(what === 'verify' ? 'Parent verified' : 'Verification rejected')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const rows = list.items ?? []
  return (
    <div>
      <PageHead title="Parent Verifications" sub="Review the ID documents parents upload; approval unlocks slip approvals and e-signatures">
        <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
          {(['Pending', 'Verified', 'Rejected', ''] as const).map(s => (
            <button key={s || 'all'} onClick={() => setStatus(s)} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-all ${status === s ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>{s || 'All'}</button>
          ))}
        </div>
      </PageHead>
      <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
        {list.loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>}
        {list.error && <div className="p-6 text-center text-[13px] text-rose-500">{list.error}</div>}
        {!list.loading && !list.error && rows.length === 0 && <div className="p-6"><Empty text={status === 'Pending' ? 'Nothing waiting for review.' : 'No verification records here.'} /></div>}
        {rows.map(v => {
          const parent = db.users.find(u => u.id === v.parentId)
          return (
            <div key={v.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
              <Avatar name={parent?.name ?? 'Parent'} hue={parent?.avatarHue} size={42} />
              <div className="min-w-52 flex-1">
                <p className="text-[14.5px] font-semibold">{parent?.name ?? 'Parent'}</p>
                <p className="text-[12.5px] text-black/45 dark:text-white/45">{[parent?.email, wardsText(v.parentId) ? `wards: ${wardsText(v.parentId)}` : 'no wards linked', `via ${v.method}`].filter(Boolean).join(' · ')}</p>
                {v.note && v.status === 'Rejected' && <p className="mt-1 text-[12.5px] text-rose-600 dark:text-rose-400">Note: {v.note}</p>}
                {v.verifiedAt && <p className="mt-1 text-[12px] text-black/40 dark:text-white/40">{v.status} {nameOf(v.verifiedById) ? `by ${nameOf(v.verifiedById)} ` : ''}on {fmtDate(v.verifiedAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p>}
              </div>
              <DocumentThumb fileId={v.documentFileId} />
              <Pill tone={verificationTone(v.status)}>{v.status}</Pill>
              {v.status === 'Pending' && (
                <div className="flex gap-2">
                  <button onClick={() => act(v, 'verify')} disabled={busy === v.id} className={`${pillBtn} bg-emerald-600 text-white hover:bg-emerald-700`}><span className="flex items-center gap-1"><BadgeCheck size={13} /> Approve</span></button>
                  <button onClick={() => { setReject(v); setNote('') }} disabled={busy === v.id} className={ghostPill}>Reject</button>
                </div>
              )}
            </div>
          )
        })}
      </Card>
      <Modal open={!!reject} onClose={() => setReject(null)} title="Reject verification">
        <div className="space-y-4">
          <p className="text-[13.5px] text-black/60 dark:text-white/60">Tell {reject ? nameOf(reject.parentId) ?? 'the parent' : 'the parent'} what to fix — they can upload a new document afterwards.</p>
          <Field label="Note"><textarea value={note} onChange={e => setNote(e.target.value)} rows={3} autoFocus placeholder="e.g. The scan is unreadable — please upload a clearer photo." className={inputCls} /></Field>
          <button onClick={() => reject && act(reject, 'reject')} disabled={!note.trim() || !reject || busy === reject.id} className="w-full rounded-xl bg-rose-600 py-3 text-[14px] font-semibold text-white hover:bg-rose-700 disabled:opacity-40">Reject</button>
        </div>
      </Modal>
    </div>
  )
}

export { FeeDefaultersAndCallsMod } from './feeDefaulters'
export { DisciplinaryCommitteeMod } from './disciplinary'

