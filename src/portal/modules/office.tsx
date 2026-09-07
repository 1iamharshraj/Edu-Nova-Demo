import { useMemo, useState } from 'react'
import {
  AlertCircle, AlertTriangle, BadgeCheck, Briefcase, CalendarPlus, Check, Copy, Download, FileBadge, FileText, Paperclip, Pencil, Plus,
  School, ScrollText, Search, Send, ShieldAlert, Sparkles, Trash2, UserPlus, X,
} from 'lucide-react'
import { useAcademic, useStore, type CreateUserInput } from '@/lib/store'
import { api, downloadFile, downloadPath, errorMessage, uploadFile } from '@/lib/api'
import { canManage, isAdmin, isStaffOrAdmin, isSuperAdmin } from '@/lib/access'
import { fmtINR, type Board, type BoardRegistration, type BoardRegistrationStatus, type CalEvent, type Certificate, type CertificateKind, type Contract, type ContractStatus, type ParentVerification, type Resignation, type Role, type Term, type User, type VerificationStatus } from '@/lib/data'
import {
  APPLICATION_KINDS, APPLICATION_STATUSES, BOARD_REG_STATUSES, CERTIFICATE_KINDS, KIND_LABEL, boardRegLabel, boardRegTone, certificateFileName,
  isCertificateKind, kindTone, useApplications, useBoardRegistrations, useFileUrl, useVerifications, verificationTone,
  type AdmissionCreated, type ApplicationKind, type ApplicationRec, type ApplicationStatus,
} from '@/lib/hooks/useIdentity'
import { fmtDate, qs, useFetchMany } from '@/lib/hooks/useAcademics'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, UploadField, inputCls, statusTone, type UploadedFile } from '../ui'
import { StudentReportMod } from './studentReport'
import { useViewedStudents } from './viewer'
import { toast } from 'sonner'

// Phase 3 classroom screens live in classroom.tsx; re-exported here so the Portal registry keeps one import.
export { AttendanceMgmtMod, CreateAssignmentMod, GradebookMod, TakeAttendanceMod } from './classroom'

const todayISO = () => new Date().toISOString().slice(0, 10)

/** Current term id from the legacy `db.terms` shape — falls back to the first term, else ''. */
function defaultTermId(terms: Term[]): string {
  return terms.find(t => t.current)?.id ?? terms[0]?.id ?? ''
}

/* ── Teacher: contract & notice period ─────────────────── */

export function ContractMod() {
  const { db, user } = useStore()
  const [notice, setNotice] = useState(false)
  const [declared, setDeclared] = useState(false)
  const contract = db.contracts.find(c => c.userId === user?.id)
  return (
    <div>
      <PageHead title="My Contract" sub="Employment terms and declarations" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><ScrollText size={15} /> Current contract</p>
          {contract ? (
            <div>
              {[
                ['Employee', `${user?.name} · ${contract.userId.toUpperCase()}`],
                ['Designation', contract.designation],
                ['Department', contract.department || '—'],
                ['Tenure', `${contract.startDate} → ${contract.endDate}`],
                ['Base salary', fmtINR(contract.salary) + ' / month'],
                ['Leave policy', '18 paid days / year · deductions per day beyond'],
                ['Notice period', '60 days, either side'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-black/[.05] dark:border-white/[.07] py-3 text-[14px] last:border-0">
                  <span className="text-black/50 dark:text-white/50">{k}</span><span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No contract on file. Contact the admin office." />
          )}
        </Card>
        <Card>
          <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40"><FileBadge size={15} /> Notice period declaration</p>
          {declared ? (
            <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 p-5 text-center">
              <BadgeCheck size={36} className="mx-auto text-emerald-600" />
              <p className="mt-3 text-[15px] font-semibold text-emerald-700 dark:text-emerald-400">Declaration submitted</p>
              <p className="mt-1 text-[13px] text-emerald-600/80 dark:text-emerald-400/80">Your 60-day notice clock started on {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}. HR has been notified.</p>
            </div>
          ) : (
            <>
              <p className="text-[13.5px] leading-relaxed text-black/55 dark:text-white/55">
                Declaring notice starts your formal exit process. Your timetable duties stay assigned until HR assigns a handover.
              </p>
              <label className="mt-4 flex items-start gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4 text-[13px] text-black/60 dark:text-white/60">
                <input type="checkbox" checked={notice} onChange={e => setNotice(e.target.checked)} className="mt-0.5" />
                I understand this begins a 60-day notice period as per my contract.
              </label>
              <button onClick={() => { setDeclared(true); toast.success('Notice period declared') }} disabled={!notice}
                className="btn-ink mt-4 w-full py-3 text-[14px] font-semibold disabled:opacity-40">Declare notice period</button>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ── Teacher/staff: work assignments ───────────────────── */

export function WorkAssignMod({ manage = false }: { manage?: boolean }) {
  const { db, update } = useStore()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [event, setEvent] = useState('Tech Fest ‘26')
  const toggle = (id: string) => {
    update(d => { const w = d.workAssign.find(x => x.id === id); if (w) w.status = w.status === 'Done' ? 'Assigned' : 'Done'; return d })
  }
  const create = () => {
    update(d => { d.workAssign.unshift({ id: 'w' + Date.now(), title, event, due: '2026-04-30', status: 'Assigned' }); return d })
    setOpen(false); setTitle(''); toast.success('Work assignment generated')
  }
  return (
    <div>
      <PageHead title={manage ? 'Faculty Work Assignment' : 'My Event Duties'} sub={manage ? 'Generate duties from the event seed' : 'Everything you’re rostered for, in one place'}>
        {manage && <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> Generate duty</button>}
      </PageHead>
      <div className="grid gap-4 md:grid-cols-2">
        {db.workAssign.map(w => (
          <Card key={w.id} className="flex items-center gap-4">
            <button onClick={() => toggle(w.id)}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${w.status === 'Done' ? 'bg-emerald-500 text-white' : 'bg-black/[.06] dark:bg-white/[.08] text-black/30 dark:text-white/30 hover:bg-black/10 dark:hover:bg-white/15'}`}>
              <Check size={18} />
            </button>
            <div className="flex-1">
              <p className={`text-[14.5px] font-semibold ${w.status === 'Done' ? 'text-black/40 dark:text-white/40 line-through' : ''}`}>{w.title}</p>
              <p className="text-[12.5px] text-black/45 dark:text-white/45">{w.event} · due {new Date(w.due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
            </div>
            <Pill tone={statusTone(w.status)}>{w.status}</Pill>
          </Card>
        ))}
        {db.workAssign.length === 0 && <div className="md:col-span-2"><Empty text={manage ? 'No duties generated yet.' : 'No event duties assigned to you yet.'} /></div>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Generate duty">
        <div className="space-y-4">
          <Field label="Duty"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Stage lights coordination" className={inputCls} /></Field>
          <Field label="Event">
            <select value={event} onChange={e => setEvent(e.target.value)} className={inputCls}>
              {['Tech Fest ‘26', 'Annual Sports Day', 'Science Exhibition', 'Founders’ Day'].map(e => <option key={e}>{e}</option>)}
            </select>
          </Field>
          <button onClick={create} disabled={!title.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Assign</button>
        </div>
      </Modal>
    </div>
  )
}

/* ── Student: registrations (FFCS / events / IHA / EXC) ── */

const CATALOG: Record<string, { name: string; detail: string; tag: string }[]> = {
  ffcs: [
    { name: 'Robotics Chapter', detail: 'Tue & Fri · CS Lab · 24 seats', tag: 'Chapter' },
    { name: 'Astronomy Club', detail: 'Wed · Observatory deck', tag: 'Club' },
    { name: 'Debate Society', detail: 'Mon · Seminar Hall', tag: 'Club' },
    { name: 'Photography Circle', detail: 'Thu · Media room', tag: 'Club' },
  ],
  iha: [
    { name: 'Inter-house Basketball', detail: 'Trials 12 Apr · Main court', tag: 'Sport' },
    { name: 'Inter-house Quiz', detail: 'Prelims 15 Apr', tag: 'Literary' },
    { name: 'House Choir', detail: 'Auditions 9 Apr', tag: 'Arts' },
  ],
  exc: [
    { name: 'Classical Dance', detail: 'Sat 9 AM · Arts block', tag: 'EXC' },
    { name: 'Chess Coaching', detail: 'Sat 10 AM · Library annexe', tag: 'EXC' },
    { name: 'Swimming', detail: 'Sun 7 AM · Aquatic centre', tag: 'EXC' },
  ],
  events: [
    { name: 'Tech Fest ‘26', detail: '24 Apr · Senior block · team of 3', tag: 'Event' },
    { name: 'Inter-school MUN', detail: '10 May · Kochi · delegate slots', tag: 'Event' },
    { name: 'Art Exhibition “Chromatic”', detail: 'Open entries till 20 Apr', tag: 'Event' },
  ],
  faculty: [
    { name: 'Tech Fest ‘26 — Judges panel', detail: '24 Apr · Senior block', tag: 'Faculty' },
    { name: 'STEM Teaching Workshop', detail: '3 May · Kochi convention centre', tag: 'Faculty' },
  ],
}

export function RegistrationsMod({ kind, title, sub }: { kind: keyof typeof CATALOG; title: string; sub: string }) {
  const { user } = useStore()
  const key = 'regs_' + kind + '_' + (user?.id ?? 'x')
  const [regs, setRegs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('edunova_x_' + key) ?? '[]') } catch { return [] }
  })
  const toggle = (name: string) => {
    const next = regs.includes(name) ? regs.filter(r => r !== name) : [...regs, name]
    setRegs(next); localStorage.setItem('edunova_x_' + key, JSON.stringify(next))
    toast.success(regs.includes(name) ? 'Registration withdrawn' : `Registered for ${name}`)
  }
  return (
    <div>
      <PageHead title={title} sub={sub} />
      <div className="grid gap-4 md:grid-cols-2">
        {CATALOG[kind].map(c => {
          const on = regs.includes(c.name)
          return (
            <Card key={c.name} className="card-lift">
              <div className="flex items-start justify-between">
                <div>
                  <Pill tone="indigo">{c.tag}</Pill>
                  <p className="font-display mt-2.5 text-[16.5px] font-medium">{c.name}</p>
                  <p className="mt-1 text-[13px] text-black/50 dark:text-white/50">{c.detail}</p>
                </div>
                <button onClick={() => toggle(c.name)}
                  className={`rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors ${on ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-black text-white hover:bg-black/85'}`}>
                  {on ? '✓ Registered' : 'Register'}
                </button>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

/* ── Applications: admissions & certificates (Phase 4) ── */
// Staff/admin run the pipeline (Pending → Verified → Approved / Declined); parents and students apply for
// TC / Bonafide / Character certificates for themselves or their wards and download the PDF once issued.
// See .agents/edunova/phase-4-admissions-identity.md

type AppTab = 'All' | ApplicationKind | 'Issued'
type AppModal =
  | { t: 'admission' } | { t: 'cert' } | { t: 'issue' }
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
              <button onClick={() => setModal({ t: 'admission' })} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><UserPlus size={15} /> New admission</button>
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

      <Modal open={modal?.t === 'admission'} onClose={() => setModal(null)} title="New admission" wide>
        {modal?.t === 'admission' && <AdmissionForm onDone={() => { setModal(null); reloadAll() }} />}
      </Modal>
      <Modal open={modal?.t === 'cert'} onClose={() => setModal(null)} title="Apply for a certificate">
        {modal?.t === 'cert' && <CertificateApplicationForm students={applyStudents} onDone={() => { setModal(null); reloadAll() }} />}
      </Modal>
      <Modal open={modal?.t === 'issue'} onClose={() => setModal(null)} title="Issue a certificate directly">
        {modal?.t === 'issue' && <IssueCertificateForm students={applyStudents} onDone={() => { setModal(null); setTab('Issued'); reloadAll() }} />}
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

function AdmissionForm({ onDone }: { onDone: () => void }) {
  const { classes, classById, currentYear } = useAcademic()
  const options = useMemo(() => classes.filter(c => !currentYear || c.academicYearId === currentYear.id).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })), [classes, currentYear])
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

function CertificateApplicationForm({ students, onDone }: { students: User[]; onDone: () => void }) {
  const { classOf } = useAcademic()
  const [kind, setKind] = useState<CertificateKind>('Bonafide')
  const [studentId, setStudentId] = useState(students[0]?.id ?? '')
  const [notes, setNotes] = useState('')
  const [docs, setDocs] = useState<UploadedFile[]>([])
  const [busy, setBusy] = useState(false)
  const student = students.find(s => s.id === studentId)
  const submit = async () => {
    if (!student) return
    setBusy(true)
    try {
      await api.post('/applications', { kind, studentId: student.id, applicantName: student.name, notes: notes.trim() || undefined, documents: docs.map(d => d.id) })
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
      {students.length > 1 ? (
        <Field label="Student">
          <select value={studentId} onChange={e => setStudentId(e.target.value)} className={inputCls}>
            {students.map(s => <option key={s.id} value={s.id}>{s.name}{classOf(s.id) ? ` · ${classOf(s.id)!.label}` : ''}</option>)}
          </select>
        </Field>
      ) : student && <p className="text-[13.5px] text-black/60 dark:text-white/60">For <b>{student.name}</b>{classOf(student.id) ? ` · ${classOf(student.id)!.label}` : ''}</p>}
      <Field label="Reason / notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder={kind === 'TC' ? 'Where is the student moving to, and when?' : 'What is the certificate needed for?'} className={inputCls} /></Field>
      <Field label="Supporting documents (optional)"><UploadField files={docs} onChange={setDocs} multiple accept=".pdf,.png,.jpg,.jpeg" /></Field>
      <button onClick={submit} disabled={!student || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Submitting…' : 'Submit application'}</button>
    </div>
  )
}

function IssueCertificateForm({ students, onDone }: { students: User[]; onDone: () => void }) {
  const { classOf } = useAcademic()
  const [kind, setKind] = useState<CertificateKind>('Bonafide')
  const [studentId, setStudentId] = useState(students[0]?.id ?? '')
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
        <select value={studentId} onChange={e => setStudentId(e.target.value)} className={inputCls}>
          {students.length === 0 && <option value="">No students yet</option>}
          {students.map(s => <option key={s.id} value={s.id}>{s.name}{classOf(s.id) ? ` · ${classOf(s.id)!.label}` : ''}</option>)}
        </select>
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

/** Placeholder hint only — the server derives the real default (server/src/userDefaults.ts). */
function emailHint(name: string, role: Role) {
  const base = name.trim().toLowerCase().replace(/[^a-z]+/g, '.').replace(/(^\.|\.$)/g, '') || 'first.last'
  return role === 'parent' ? `parent.${base}@edunova.in` : `${base}@edunova.in`
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

interface PersonForm {
  name: string
  email: string
  role: Role
  // student
  classId: string
  rollNo: string
  board: Board
  dob: string
  parentIds: string[]
  // parent
  studentIds: string[]
  phone: string
  // teacher
  classTeacherOf: string
  joinDate: string
  salary: number
  // staff / admin
  department: string
  designation: string
}

const emptyPersonForm = (role: Role): PersonForm => ({
  name: '', email: '', role,
  classId: '', rollNo: '', board: 'CBSE', dob: '', parentIds: [],
  studentIds: [], phone: '',
  classTeacherOf: '', joinDate: todayISO(), salary: 0,
  department: '', designation: '',
})

function PickList({ items, selected, onToggle, empty }: { items: { id: string; label: string; sub?: string }[]; selected: string[]; onToggle: (id: string) => void; empty: string }) {
  if (items.length === 0) return <p className="rounded-xl border border-dashed border-black/15 dark:border-white/15 px-3 py-2.5 text-[13px] text-black/45 dark:text-white/45">{empty}</p>
  return (
    <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto thin-scroll sm:grid-cols-2">
      {items.map(it => (
        <label key={it.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-[13px] transition-colors ${selected.includes(it.id) ? 'border-indigo-300 bg-indigo-50/60 dark:border-indigo-500/40 dark:bg-indigo-500/10' : 'border-black/10 dark:border-white/15'}`}>
          <input type="checkbox" checked={selected.includes(it.id)} onChange={() => onToggle(it.id)} />
          <span className="min-w-0 flex-1 truncate font-medium">{it.label}</span>
          {it.sub && <span className="shrink-0 text-[11.5px] text-black/45 dark:text-white/45">{it.sub}</span>}
        </label>
      ))}
    </div>
  )
}

function CredentialRow({ label, value }: { label: string; value: string }) {
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
  const { db, user, createUser, updateUser, deleteUser, refreshAcademic, refreshDB } = useStore()
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

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [viewReportId, setViewReportId] = useState<string | null>(null)
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null)

  const setTab = (t: PeopleTabId) => { setTabState(t); setCls(''); setSubject(''); setDepartment('') }

  const activeTab = tabs.find(t => t.id === tab) ?? tabs[0]
  const activeRoles = activeTab.roles

  /* ── entity lookups ── */
  const yearClasses = useMemo(
    () => academic.classes.filter(c => !currentYear || c.academicYearId === currentYear.id).slice().sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    [academic.classes, currentYear],
  )
  const userById = useMemo(() => new Map(db.users.map(u => [u.id, u])), [db.users])
  const students = useMemo(() => db.users.filter(u => u.role === 'student').sort(byName), [db.users])
  const parents = useMemo(() => db.users.filter(u => u.role === 'parent').sort(byName), [db.users])

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

  /* ── form ── */
  const [form, setForm] = useState<PersonForm>(() => emptyPersonForm('student'))
  const patch = (p: Partial<PersonForm>) => setForm(f => ({ ...f, ...p }))
  const toggleIn = (key: 'parentIds' | 'studentIds', id: string) =>
    setForm(f => ({ ...f, [key]: f[key].includes(id) ? f[key].filter(x => x !== id) : [...f[key], id] }))

  const openAdd = () => {
    setEditing(null)
    setForm(emptyPersonForm(tab === 'admins' ? 'admin' : activeTab.singular as Role))
    setModalOpen(true)
  }

  const openEdit = (u: User) => {
    const e = enrollmentOf(u.id)
    const c = classOf(u.id)
    setEditing(u)
    setForm({
      ...emptyPersonForm(u.role),
      name: u.name,
      email: u.email,
      classId: c && yearClasses.some(x => x.id === c.id) ? c.id : '',
      rollNo: e?.rollNo ?? u.roll ?? '',
      board: u.board ?? 'CBSE',
      dob: u.dob ?? '',
      parentIds: guardiansOf(u.id).map(g => g.parentId),
      studentIds: wardsOf(u.id),
      phone: u.phone ?? '',
      classTeacherOf: classTeacherOf(u.id)?.id ?? '',
      joinDate: u.joinDate ?? todayISO(),
      salary: u.salary ?? 0,
      department: u.department ?? '',
      designation: u.designation ?? '',
    })
    setModalOpen(true)
  }

  const noClassForStudent = form.role === 'student' && yearClasses.length === 0
  const canSave = !!form.name.trim() && !saving && (form.role !== 'student' || !!form.classId)

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    const name = form.name.trim()
    try {
      if (editing) {
        const id = editing.id
        let touchedAcademic = false
        if (form.role === 'student') {
          await updateUser(id, { name, classId: form.classId, rollNo: form.rollNo.trim(), board: form.board, dob: form.dob || undefined })
          const existing = guardiansOf(id)
          const want = new Set(form.parentIds)
          const toAdd = form.parentIds.filter(pid => !existing.some(g => g.parentId === pid))
          const toRemove = existing.filter(g => !want.has(g.parentId))
          if (toAdd.length || toRemove.length) {
            await Promise.all([
              ...toAdd.map(parentId => api.post('/academic/guardians', { parentId, studentId: id })),
              ...toRemove.map(g => api.del('/academic/guardians/' + g.id)),
            ])
            touchedAcademic = true
          }
        } else if (form.role === 'parent') {
          await updateUser(id, { name, phone: form.phone.trim(), studentIds: form.studentIds })
        } else if (form.role === 'teacher') {
          const prev = classTeacherOf(id)
          await updateUser(id, { name, joinDate: form.joinDate, salary: form.salary, classTeacherOf: form.classTeacherOf || undefined })
          if (prev && !form.classTeacherOf) {
            // Unassign: PATCH /users can only (re)assign, so clear the class directly.
            await api.patch('/academic/classes/' + prev.id, { classTeacherId: null })
            touchedAcademic = true
          }
        } else if (form.role === 'staff') {
          await updateUser(id, { name, department: form.department, designation: form.designation.trim(), joinDate: form.joinDate })
        } else {
          await updateUser(id, { name, designation: form.designation.trim(), department: form.department })
        }
        if (touchedAcademic) await Promise.all([refreshAcademic(), refreshDB()])
        toast.success(`${name} updated`)
      } else {
        const email = form.email.trim() || undefined
        const base = { role: form.role, name, email }
        const input: CreateUserInput =
          form.role === 'student' ? { ...base, classId: form.classId, rollNo: form.rollNo.trim() || undefined, board: form.board, dob: form.dob || undefined }
          : form.role === 'parent' ? { ...base, phone: form.phone.trim() || undefined, studentIds: form.studentIds }
          : form.role === 'teacher' ? { ...base, joinDate: form.joinDate, salary: form.salary, classTeacherOf: form.classTeacherOf || undefined }
          : form.role === 'staff' ? { ...base, department: form.department || undefined, designation: form.designation.trim() || undefined, joinDate: form.joinDate }
          : { ...base, designation: form.designation.trim() || undefined, department: form.department || undefined }
        const res = await createUser(input)
        if (form.role === 'student' && form.parentIds.length) {
          await Promise.all(form.parentIds.map(parentId => api.post('/academic/guardians', { parentId, studentId: res.user.id })))
          await Promise.all([refreshAcademic(), refreshDB()])
        }
        setCreated({ name: res.user.name, email: res.user.email, password: res.password })
        toast.success(`${res.user.name} onboarded as ${res.user.role}`)
      }
      setModalOpen(false)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!confirmId) return
    const ok = await deleteUser(confirmId)
    if (ok) toast.success('Access revoked')
    else toast.error('Cannot delete yourself or the last superadmin')
    setConfirmId(null)
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
          <p className={muted}>Board: {u.board ?? '—'}{u.dob ? ` · DOB ${u.dob}` : ''}</p>
          <p className={muted}>Parent(s): {gs.length ? gs.join(', ') : '—'}</p>
        </>
      )
    }
    if (u.role === 'teacher') {
      const ct = classTeacherOf(u.id)
      const t = teachingOf(u.id)
      return (
        <>
          <p className="font-medium">Class teacher of {ct?.label ?? '—'}{u.salary ? ` · ${fmtINR(u.salary)}` : ''}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {t.length ? t.map(x => <Pill key={x.id} tone="indigo">{x.label}</Pill>) : <span className={muted}>No subjects assigned</span>}
          </div>
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
        </>
      )
    }
    return (
      <>
        <p className="font-medium">{u.designation || u.title || u.role}</p>
        <p className={muted}>Access: {u.department || '—'}</p>
      </>
    )
  }

  return (
    <div>
      <PageHead title="People Management" sub={`${tabLabel} · search, filter, add, edit and revoke access`}>
        <button onClick={openAdd} disabled={addBlocked} title={addBlocked ? 'Create a class first in Academic Setup' : undefined}
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
                      <Pill tone={roleTone(u.role)}>{u.role}</Pill>
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
                        <button onClick={() => setViewReportId(u.id)} className="rounded-full bg-indigo-50 dark:bg-indigo-500/10 p-2 text-indigo-600 hover:bg-indigo-100 dark:hover:bg-indigo-500/20" title="View full report"><FileBadge size={15} /></button>
                      )}
                      <button onClick={() => openEdit(u)} className="rounded-full bg-black/[.05] dark:bg-white/[.07] p-2 hover:bg-black/10 dark:hover:bg-white/15" title="Edit"><Pencil size={15} /></button>
                      <button onClick={() => setConfirmId(u.id)} className="rounded-full bg-rose-50 p-2 text-rose-500 hover:bg-rose-100" title="Revoke access"><Trash2 size={15} /></button>
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
                <Pill tone={roleTone(u.role)}>{u.role}</Pill>
              </div>
              <p className="truncate text-[13px]">{u.email}</p>
              {u.phone && <p className={muted}>{u.phone}</p>}
              <div className="mt-1.5 text-[13px]">{details(u)}</div>
              {canEdit(u) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {u.role === 'student' && (
                    <button onClick={() => setViewReportId(u.id)} className="btn-ink flex flex-1 items-center justify-center gap-1 py-2 text-[13px] font-semibold"><FileBadge size={14} /> Report</button>
                  )}
                  <button onClick={() => openEdit(u)} className="btn-ink flex flex-1 items-center justify-center gap-1 py-2 text-[13px] font-semibold"><Pencil size={14} /> Edit</button>
                  <button onClick={() => setConfirmId(u.id)} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-rose-50 py-2 text-[13px] font-semibold text-rose-500"><Trash2 size={14} /> Delete</button>
                </div>
              )}
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <Card><Empty text={emptyText} /></Card>}
      </div>

      {/* add/edit modal */}
      <Modal open={modalOpen} onClose={() => !saving && setModalOpen(false)} title={editing ? `Edit ${editing.name}` : `Add ${form.role}`} wide>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <input value={form.name} onChange={e => patch({ name: e.target.value })} placeholder="e.g. Kavya Nair" className={inputCls} autoFocus />
            </Field>
            {editing ? (
              <Field label="Email"><input value={form.email} readOnly className={`${inputCls} bg-black/[.03] dark:bg-white/[.04] text-black/60 dark:text-white/60`} /></Field>
            ) : (
              <Field label="Email (optional)">
                <input type="email" value={form.email} onChange={e => patch({ email: e.target.value })} placeholder={emailHint(form.name, form.role)} className={inputCls} />
              </Field>
            )}
          </div>

          {!editing && (
            <Field label="Role">
              <select value={form.role} onChange={e => setForm(emptyPersonForm(e.target.value as Role))} className={inputCls}>
                {(['student', 'teacher', 'staff', 'parent', ...(isSuper ? ['admin'] : [])] as Role[]).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          )}

          {form.role === 'student' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Class">
                  {noClassForStudent ? (
                    <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-800 dark:text-amber-300">Create a class first in Academic Setup.</p>
                  ) : (
                    <select value={form.classId} onChange={e => patch({ classId: e.target.value })} className={inputCls}>
                      <option value="">Select class</option>
                      {yearClasses.map(c => <option key={c.id} value={c.id}>{classOption(c)}</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Roll number"><input value={form.rollNo} onChange={e => patch({ rollNo: e.target.value })} placeholder="e.g. 12" className={inputCls} /></Field>
                <Field label="Board">
                  <select value={form.board} onChange={e => patch({ board: e.target.value as Board })} className={inputCls}>
                    <option value="CBSE">CBSE</option>
                    <option value="Matric">Matric</option>
                  </select>
                </Field>
                <Field label="Date of birth"><input type="date" value={form.dob} onChange={e => patch({ dob: e.target.value })} className={inputCls} /></Field>
              </div>
              <Field label="Parent(s) — optional">
                <PickList
                  items={parents.map(p => ({ id: p.id, label: p.name, sub: p.phone || p.email }))}
                  selected={form.parentIds}
                  onToggle={id => toggleIn('parentIds', id)}
                  empty="No parent accounts yet. Add parents from the Parents tab and link them here later."
                />
              </Field>
            </div>
          )}

          {form.role === 'parent' && (
            <div className="space-y-4">
              <Field label="Phone"><input value={form.phone} onChange={e => patch({ phone: e.target.value })} placeholder="+91 98765 43210" className={inputCls} /></Field>
              <Field label="Wards">
                <PickList
                  items={students.map(s => ({ id: s.id, label: s.name, sub: classOf(s.id)?.label ?? 'No class' }))}
                  selected={form.studentIds}
                  onToggle={id => toggleIn('studentIds', id)}
                  empty="No students yet. Add students first, then link them here."
                />
              </Field>
            </div>
          )}

          {form.role === 'teacher' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Class teacher of">
                  <select value={form.classTeacherOf} onChange={e => patch({ classTeacherOf: e.target.value })} className={inputCls}>
                    <option value="">{yearClasses.length ? 'None' : 'No classes yet'}</option>
                    {yearClasses.map(c => {
                      const other = c.classTeacherId && c.classTeacherId !== editing?.id ? userById.get(c.classTeacherId)?.name : undefined
                      return <option key={c.id} value={c.id}>{c.label}{other ? ` · currently ${other}` : ''}</option>
                    })}
                  </select>
                </Field>
                <Field label="Joining date"><input type="date" value={form.joinDate} onChange={e => patch({ joinDate: e.target.value })} className={inputCls} /></Field>
                <Field label="Salary (₹)"><input type="number" value={form.salary} onChange={e => patch({ salary: +e.target.value })} className={inputCls} /></Field>
              </div>
              <div>
                <span className="text-[13px] font-semibold text-black/60 dark:text-white/60">Subjects taught</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {editing && teachingOf(editing.id).length > 0
                    ? teachingOf(editing.id).map(x => <Pill key={x.id} tone="indigo">{x.label}</Pill>)
                    : <span className="text-[13px] text-black/45 dark:text-white/45">No subjects assigned yet.</span>}
                </div>
                <p className="mt-1.5 text-[12px] text-black/45 dark:text-white/45">Assign subjects in Classes & Sections → Subjects & teachers.</p>
              </div>
            </div>
          )}

          {form.role === 'staff' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Department">
                <select value={form.department} onChange={e => patch({ department: e.target.value })} className={inputCls}>
                  <option value="">Select department</option>
                  {Array.from(new Set([...departmentOptions, 'Administration', 'Finance', 'Admissions', 'Operations'])).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Designation"><input value={form.designation} onChange={e => patch({ designation: e.target.value })} placeholder="e.g. Office Superintendent" className={inputCls} /></Field>
              <Field label="Joining date"><input type="date" value={form.joinDate} onChange={e => patch({ joinDate: e.target.value })} className={inputCls} /></Field>
            </div>
          )}

          {(form.role === 'admin' || form.role === 'superadmin') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Designation"><input value={form.designation} onChange={e => patch({ designation: e.target.value })} placeholder="e.g. School Administrator" className={inputCls} /></Field>
              <Field label="Access scope">
                <select value={form.department} onChange={e => patch({ department: e.target.value })} className={inputCls}>
                  <option value="">Select scope</option>
                  <option value="Full access">Full access</option>
                  <option value="Finance">Finance only</option>
                  <option value="Academics">Academics only</option>
                  <option value="Admissions">Admissions only</option>
                </select>
              </Field>
            </div>
          )}

          {!editing && (
            <p className="text-[12.5px] text-black/45 dark:text-white/45">A one-time password is generated on creation and shown once — copy it for the new user.</p>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={!canSave} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
            </button>
            <button onClick={() => setModalOpen(false)} disabled={saving} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* one-time credentials */}
      <Modal open={!!created} onClose={() => setCreated(null)} title="Account created">
        {created && (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-black/60 dark:text-white/60">
              Share these credentials with <b>{created.name}</b>. The password is shown only once; they will be asked to change it on first login.
            </p>
            <CredentialRow label="Email" value={created.email} />
            <CredentialRow label="Password" value={created.password} />
            <button onClick={() => setCreated(null)} className="btn-ink w-full py-3 text-[14px] font-semibold">Done</button>
          </div>
        )}
      </Modal>

      {/* delete confirmation */}
      <Modal open={!!confirmId} onClose={() => setConfirmId(null)} title="Revoke access?">
        <div className="space-y-4">
          <p className="text-[14px] text-black/60 dark:text-white/60">This will permanently remove the account. You cannot delete your own account or the last remaining superadmin.</p>
          <div className="flex gap-3">
            <button onClick={confirmDelete} className="btn-ink flex-1 py-3 text-[14px] font-semibold bg-rose-600 hover:bg-rose-700">Revoke access</button>
            <button onClick={() => setConfirmId(null)} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">Cancel</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!viewReportId} onClose={() => setViewReportId(null)} title="Student Profile Report" wide>
        {viewReportId ? <StudentReportMod studentId={viewReportId} /> : <Empty text="Select a student to view the report." />}
      </Modal>
    </div>
  )
}

/* ── Fees management (admin/staff) ─────────────────────── */

export function FeesMod() {
  const { db, update } = useStore()
  const [label, setLabel] = useState('Lab & Activity Fee')
  const [amount, setAmount] = useState(6500)
  const termId = defaultTermId(db.terms)
  const assign = () => {
    if (!label.trim()) return
    update(d => {
      d.receipts.push({ id: 'r' + Date.now(), label: label.trim(), date: todayISO(), amount, status: 'Due', term: termId, kind: 'fee' })
      return d
    })
    toast.success(`Fee assigned to all students: ${label.trim()}`)
  }
  const fees = db.receipts.filter(r => r.kind === 'fee')
  return (
    <div>
      <PageHead title="Fees" sub="Update and assign fees across classes" />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Assign new fee</p>
          <div className="space-y-4">
            <Field label="Fee head"><input value={label} onChange={e => setLabel(e.target.value)} className={inputCls} /></Field>
            <Field label="Amount (₹)"><input type="number" value={amount} onChange={e => setAmount(+e.target.value)} className={inputCls} /></Field>
            <button onClick={assign} disabled={!label.trim() || !termId} title={termId ? undefined : 'Create a term first in Academic Setup'} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Assign to all classes</button>
            {!termId && <p className="text-[12.5px] text-black/45 dark:text-white/45">Fees are tied to a term — create one in Academic Setup first.</p>}
          </div>
        </Card>
        <Card className="p-0">
          <p className="border-b border-black/[.06] dark:border-white/[.08] px-6 py-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Active fee heads</p>
          {fees.length === 0 && <div className="p-6"><Empty text="No fee heads assigned yet." /></div>}
          {fees.map(f => (
            <div key={f.id} className="flex items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0">
              <span className="flex-1 text-[14px] font-medium">{f.label}</span>
              <span className="text-[14px] font-bold">{fmtINR(f.amount)}</span>
              <Pill tone={statusTone(f.status)}>{f.status}</Pill>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}

/* ── Calendar & curriculum admin ───────────────────────── */

export function CalendarAdminMod() {
  const { db, update } = useStore()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayISO)
  const [type, setType] = useState<'holiday' | 'exam' | 'event'>('event')
  const [termPick, setTerm] = useState('')
  // Fall back to the current term whenever the picked one is unset or no longer exists.
  const term = db.terms.some(t => t.id === termPick) ? termPick : defaultTermId(db.terms)
  const [editing, setEditing] = useState<CalEvent | null>(null)

  const reset = () => {
    setTitle(''); setDate(todayISO()); setType('event'); setTerm(''); setEditing(null)
  }

  const matches = (a: CalEvent, b: CalEvent) => a.date === b.date && a.title === b.title && a.type === b.type && a.term === b.term

  const save = () => {
    if (!title.trim() || !term) return
    update(d => {
      if (editing) {
        const idx = d.events.findIndex(e => matches(e, editing))
        if (idx >= 0) {
          d.events[idx] = { date, title, type, term }
          d.events.sort((a, b) => a.date.localeCompare(b.date))
        }
      } else {
        d.events.push({ date, title, type, term })
        d.events.sort((a, b) => a.date.localeCompare(b.date))
      }
      return d
    })
    toast.success(editing ? 'Event updated' : 'Calendar updated — visible to all portals')
    reset()
  }

  const remove = (e: CalEvent) => {
    update(d => { d.events = d.events.filter(x => !matches(x, e)); return d })
    toast.success('Event removed')
    if (editing && matches(editing, e)) reset()
  }

  const edit = (e: CalEvent) => {
    setEditing(e)
    setTitle(e.title)
    setDate(e.date)
    setType(e.type)
    setTerm(e.term)
  }

  return (
    <div>
      <PageHead title="Calendar Management" sub="Add, edit and remove holidays, exams and events per term" />
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
              <Field label="Term">
                <select value={term} onChange={e => setTerm(e.target.value)} className={inputCls} disabled={db.terms.length === 0}>
                  {db.terms.length === 0 && <option value="">No terms yet</option>}
                  {db.terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            </div>
            {db.terms.length === 0 && <p className="text-[12.5px] text-black/45 dark:text-white/45">Events belong to a term — create one in Academic Setup first.</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={!title.trim() || !term} className="btn-ink flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40">
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
            {db.events.length === 0 && <div className="p-6"><Empty text="No calendar entries yet." /></div>}
            {db.events.map(e => (
              <div key={e.date + e.title + e.type} className="flex items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3 last:border-0">
                <span className="flex-1 text-[13.5px] font-medium">{e.title}</span>
                <span className="text-[12px] text-black/40 dark:text-white/40">{e.date}</span>
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
  const { db, user } = useStore()
  const { currentYear, classOf, wardsOf, classesTaughtBy, boards, boardById } = useAcademic()
  const regs = useBoardRegistrations()
  const [search, setSearch] = useState('')
  const [boardFilter, setBoardFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState<BoardRegistrationStatus | 'All' | 'None'>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [prefilling, setPrefilling] = useState(false)

  const canEdit = !!user && (isStaffOrAdmin(user) || user.role === 'teacher')

  const students = useMemo(() => {
    const all = db.users.filter(u => u.role === 'student').sort(byName)
    if (!user) return []
    if (user.role === 'student') return all.filter(s => s.id === user.id)
    if (user.role === 'parent') {
      const wardIds = new Set(wardsOf(user.id))
      return all.filter(s => wardIds.has(s.id) || (!!user.email && s.parentEmail === user.email))
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
      <PageHead title="Board Registration" sub="Check each student’s board record against the school record before it goes to the board">
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </PageHead>

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
            <BoardRegistrationView key={reg.id} student={selected} reg={reg} canEdit={canEdit} onEdit={() => setEditOpen(true)} onChanged={regs.reload} />
          )}
        </Card>
      </div>

      {selected && reg && (
        <EditBoardRegistrationModal open={editOpen} onClose={() => setEditOpen(false)} student={selected} reg={reg} onSaved={regs.reload} />
      )}
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

function EditBoardRegistrationModal({ open, onClose, student, reg, onSaved }: { open: boolean; onClose: () => void; student: User; reg: BoardRegistration; onSaved: () => void }) {
  const { boards } = useAcademic()
  const [f, setF] = useState({
    boardId: reg.boardId, nameOnCertificate: reg.nameOnCertificate, dob: reg.dob, registrationNo: reg.registrationNo ?? '', rollNo: reg.rollNo ?? '',
    affiliationNo: reg.affiliationNo ?? '', mismatchNote: reg.mismatchNote ?? '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(x => ({ ...x, [k]: e.target.value }))
  const save = async () => {
    setBusy(true)
    try {
      await api.patch(`/board-registrations/${reg.id}`, {
        boardId: f.boardId, nameOnCertificate: f.nameOnCertificate.trim(), dob: f.dob, registrationNo: f.registrationNo.trim() || null, rollNo: f.rollNo.trim() || null,
        affiliationNo: f.affiliationNo.trim() || null, mismatchNote: f.mismatchNote.trim() || null,
      })
      onSaved(); onClose()
      toast.success('Board details updated')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Edit board details — ${student.name}`} wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Board">
            <select value={f.boardId} onChange={set('boardId')} className={inputCls}>
              {boards.map(b => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
          </Field>
          <Field label="Name on certificate"><input value={f.nameOnCertificate} onChange={set('nameOnCertificate')} className={inputCls} /></Field>
          <Field label="Registration no."><input value={f.registrationNo} onChange={set('registrationNo')} className={inputCls} /></Field>
          <Field label="Board roll no."><input value={f.rollNo} onChange={set('rollNo')} className={inputCls} /></Field>
          <Field label="Date of birth (board record)"><input type="date" value={f.dob} onChange={set('dob')} className={inputCls} /></Field>
          <Field label="Affiliation no."><input value={f.affiliationNo} onChange={set('affiliationNo')} placeholder="School’s affiliation with the board" className={inputCls} /></Field>
        </div>
        <Field label="Mismatch note (optional)">
          <textarea value={f.mismatchNote} onChange={set('mismatchNote')} placeholder="Explain any difference between the school and board records." className={`${inputCls} min-h-[80px]`} />
        </Field>
        {reg.status === 'SentToBoard' && <p className="text-[12.5px] text-amber-700 dark:text-amber-300">This registration was already sent to the board — edits may need to be re-validated.</p>}
        <button onClick={save} disabled={busy || !f.nameOnCertificate.trim() || !f.dob || !f.boardId} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save details'}</button>
      </div>
    </Modal>
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

/* ── Admin / HR: contracts & resignations ──────────────── */

const CONTRACT_STATUSES: ContractStatus[] = ['Draft', 'Active', 'Resigned', 'Terminated']

function contractStatusTone(s: ContractStatus): 'green' | 'amber' | 'rose' | 'slate' {
  if (s === 'Active') return 'green'
  if (s === 'Draft') return 'amber'
  if (s === 'Resigned' || s === 'Terminated') return 'rose'
  return 'slate'
}

export function ContractsResignationsMod() {
  const { db, user, update } = useStore()
  const [tab, setTab] = useState<'contracts' | 'resignations'>('contracts')
  const [editContract, setEditContract] = useState<Contract | null>(null)
  const [editResignation, setEditResignation] = useState<Resignation | null>(null)
  const [notes, setNotes] = useState('')

  const activeContracts = useMemo(() => db.contracts.map(c => ({ c, u: db.users.find(u => u.id === c.userId) })), [db.contracts, db.users])

  const resignations = db.resignations.slice().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

  const approveResignation = (r: Resignation) => {
    update(d => {
      const res = d.resignations.find(x => x.id === r.id)
      if (res) {
        res.status = 'Approved'
        res.approvedBy = user?.name
        res.approvedAt = new Date().toISOString().slice(0, 10)
        res.adminNotes = notes.trim() || undefined
      }
      const c = d.contracts.find(x => x.userId === r.userId)
      if (c && c.status === 'Active') c.status = 'Resigned'
      return d
    })
    setEditResignation(null)
    setNotes('')
    toast.success('Resignation approved · contract status updated')
  }

  const declineResignation = (r: Resignation) => {
    update(d => {
      const res = d.resignations.find(x => x.id === r.id)
      if (res) {
        res.status = 'Declined'
        res.approvedBy = user?.name
        res.approvedAt = new Date().toISOString().slice(0, 10)
        res.adminNotes = notes.trim() || undefined
      }
      return d
    })
    setEditResignation(null)
    setNotes('')
    toast.success('Resignation declined')
  }

  const saveContract = () => {
    if (!editContract) return
    update(d => {
      const c = d.contracts.find(x => x.id === editContract.id)
      if (c) {
        c.designation = editContract.designation
        c.department = editContract.department
        c.salary = editContract.salary
        c.startDate = editContract.startDate
        c.endDate = editContract.endDate
        c.status = editContract.status
        c.clauses = editContract.clauses
      }
      return d
    })
    setEditContract(null)
    toast.success('Contract updated')
  }

  return (
    <div>
      <PageHead title="Contracts & Resignations" sub="Manage employment contracts and approve exit requests">
        <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
          {(['contracts', 'resignations'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${tab === t ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
              {t === 'contracts' ? 'Contracts' : 'Resignations'}
            </button>
          ))}
        </div>
      </PageHead>

      {tab === 'contracts' ? (
        <div className="grid gap-4 md:grid-cols-2">
          {activeContracts.map(({ c, u }) => (
            <Card key={c.id} className="card-lift">
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${c.status === 'Active' ? 'bg-emerald-50 text-emerald-600' : c.status === 'Draft' ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}`}>
                  <Briefcase size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{u?.name ?? 'Unknown'}</p>
                  <p className="text-[12.5px] text-black/50 dark:text-white/50">{c.designation}{c.department ? ' · ' + c.department : ''} · {fmtINR(c.salary)}/mo</p>
                  <p className="text-[12px] text-black/40 dark:text-white/40">{c.startDate} → {c.endDate}</p>
                </div>
                <Pill tone={contractStatusTone(c.status)}>{c.status}</Pill>
              </div>
              <div className="mt-4 flex items-start gap-2 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3">
                <FileText size={16} className="mt-0.5 text-black/40 dark:text-white/40" />
                <p className="text-[12.5px] leading-relaxed text-black/60 dark:text-white/60">{c.clauses}</p>
              </div>
              <button onClick={() => setEditContract(c)} className="btn-ink mt-4 flex w-full items-center justify-center gap-2 py-2.5 text-[13px] font-semibold">
                <Pencil size={14} /> Edit contract
              </button>
            </Card>
          ))}
          {activeContracts.length === 0 && <div className="md:col-span-2"><Empty text="No contracts on file." /></div>}
        </div>
      ) : (
        <div className="grid gap-4">
          {resignations.map(r => {
            const u = db.users.find(x => x.id === r.userId)
            return (
              <Card key={r.id} className="card-lift">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={r.status === 'Approved' ? 'green' : r.status === 'Pending' ? 'amber' : 'rose'}>{r.status}</Pill>
                      {r.status === 'Pending' && <Pill tone="slate"><ShieldAlert size={10} /> awaiting approval</Pill>}
                    </div>
                    <p className="font-display mt-3 text-[17px] font-medium">{u?.name ?? 'Unknown'}</p>
                    <p className="text-[13px] text-black/55 dark:text-white/55">{u?.title}</p>
                    <p className="mt-2 text-[13px] leading-relaxed text-black/70 dark:text-white/70">{r.reason}</p>
                    <p className="mt-1 text-[12.5px] text-black/45 dark:text-white/45">Submitted {new Date(r.submittedAt).toLocaleDateString('en-IN')} · Last working day {new Date(r.lastWorkingDate).toLocaleDateString('en-IN')}</p>
                    {r.adminNotes && <p className="mt-2 text-[12.5px] text-black/50 dark:text-white/50">Admin note: {r.adminNotes}</p>}
                  </div>
                  {r.status === 'Pending' && (
                    <div className="flex gap-2">
                      <button onClick={() => setEditResignation(r)} className="btn-ink px-4 py-2 text-[13px] font-semibold">Review</button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
          {resignations.length === 0 && <Empty text="No resignation requests." />}
        </div>
      )}

      <Modal open={!!editContract} onClose={() => setEditContract(null)} title="Edit contract" wide>
        {editContract && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Designation"><input value={editContract.designation} onChange={e => setEditContract({ ...editContract, designation: e.target.value })} className={inputCls} /></Field>
              <Field label="Department"><input value={editContract.department ?? ''} onChange={e => setEditContract({ ...editContract, department: e.target.value })} className={inputCls} /></Field>
              <Field label="Salary"><input type="number" value={editContract.salary} onChange={e => setEditContract({ ...editContract, salary: Number(e.target.value) })} className={inputCls} /></Field>
              <Field label="Status">
                <select value={editContract.status} onChange={e => setEditContract({ ...editContract, status: e.target.value as ContractStatus })} className={inputCls}>
                  {CONTRACT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Start date"><input type="date" value={editContract.startDate} onChange={e => setEditContract({ ...editContract, startDate: e.target.value })} className={inputCls} /></Field>
              <Field label="End date"><input type="date" value={editContract.endDate} onChange={e => setEditContract({ ...editContract, endDate: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="Clauses"><textarea value={editContract.clauses} onChange={e => setEditContract({ ...editContract, clauses: e.target.value })} rows={3} className={inputCls} /></Field>
            <button onClick={saveContract} className="btn-ink w-full py-3 text-[14px] font-semibold">Save contract</button>
          </div>
        )}
      </Modal>

      <Modal open={!!editResignation} onClose={() => { setEditResignation(null); setNotes('') }} title="Review resignation">
        {editResignation && (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-black/70 dark:text-white/70">{editResignation.reason}</p>
            <Field label="Admin note">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Notes for the employee file…" className={inputCls} />
            </Field>
            <div className="flex gap-2">
              <button onClick={() => approveResignation(editResignation)} className="btn-ink flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-semibold">
                <Check size={16} /> Approve
              </button>
              <button onClick={() => declineResignation(editResignation)} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-rose-50 dark:bg-rose-500/10 py-3 text-[14px] font-semibold text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20">
                <X size={16} /> Decline
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export { FeeDefaultersAndCallsMod } from './feeDefaulters'
export { DisciplinaryCommitteeMod } from './disciplinary'

