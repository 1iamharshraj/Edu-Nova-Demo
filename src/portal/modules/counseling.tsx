import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCheck, HeartHandshake, Lock, MessageCircleWarning, Plus, ShieldQuestion } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { isAdmin } from '@/lib/access'
import type { AnonymousReport, AnonymousReportCategory, CounselingCategory } from '@/lib/data'
import { isoDate } from '@/lib/hooks/useTimetable'
import {
  ANON_REPORT_CATEGORIES, ANON_REPORT_STATUSES, COUNSELING_CATEGORIES, anonReportTone,
  useAnonymousReports, useCounselingRecords,
} from '@/lib/hooks/useCounseling'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'

// Phase 22 item 3: confidential counseling records + anonymous reporting.
// See .agents/edunova/phase-22-campus-safety.md — this is the most sensitive data model in the roadmap.
// CounselingRecordsMod must only ever be reachable by isCounselor users (Portal.tsx gates the nav entry);
// if a non-counselor somehow lands here anyway, the server 403s and this screen just shows that message —
// no client-side workaround, no fallback data.

const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
const primaryBtn = 'flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40'
const rowCls = 'flex flex-wrap items-start gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-4 last:border-0'
const loadingRow = (text: string) => <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">{text}</div>

/* ── Counselor-only: Counseling Records ────────────────────── */

export function CounselingRecordsMod() {
  const { user } = useStore()
  const [studentId, setStudentId] = useState('')

  const { items, loading, error, reload } = useCounselingRecords(studentId, !!studentId && !!user)
  const list = useMemo(() => [...(items ?? [])].sort((a, b) => b.sessionDate.localeCompare(a.sessionDate)), [items])

  const [open, setOpen] = useState(false)
  const [sessionDate, setSessionDate] = useState(() => isoDate(new Date()))
  const [category, setCategory] = useState<CounselingCategory | ''>('')
  const [notes, setNotes] = useState('')
  const [followUp, setFollowUp] = useState(false)
  const [busy, setBusy] = useState(false)

  const resetForm = () => { setSessionDate(isoDate(new Date())); setCategory(''); setNotes(''); setFollowUp(false) }
  const save = async () => {
    if (!studentId || !notes.trim()) return
    setBusy(true)
    try {
      await api.post('/safety/counseling-records', { studentId, sessionDate, category: category || undefined, notes: notes.trim(), followUpNeeded: followUp })
      setOpen(false); resetForm(); reload(); toast.success('Session note saved')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  // A 403 here means this screen was reached by a non-counselor somehow (nav is gated on isCounselor) —
  // show the server's message plainly rather than any fallback UI.
  if (error) {
    return (
      <div>
        <PageHead title="Counseling Records" sub="Confidential — visible only to you" />
        <Card><div className="flex items-start gap-3"><Lock size={18} className="mt-0.5 shrink-0 text-black/40 dark:text-white/40" /><Empty text={error} /></div></Card>
      </div>
    )
  }

  return (
    <div>
      <PageHead title="Counseling Records" sub="Confidential — visible only to you as the recording counselor">
        <div className="flex items-center gap-2">
          <div className="w-60"><AsyncEntityPicker role="student" value={studentId} onChange={id => setStudentId(id)} placeholder="Search student…" /></div>
          {studentId && <button onClick={() => setOpen(true)} className="btn-ink flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold"><Plus size={15} /> Log session</button>}
        </div>
      </PageHead>
      <div className="mb-5 flex items-start gap-2 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 p-4 text-[12.5px] text-indigo-800 dark:text-indigo-300">
        <Lock size={15} className="mt-0.5 shrink-0" /> These notes are strictly private to you. They are not visible to the student, parents, class teachers, or other staff — not even admins, unless this school has explicitly designated a counselor-oversight role.
      </div>
      <Card className="p-0">
        {!studentId ? <div className="p-6"><Empty text="Search for and select a student above." /></div>
          : loading ? loadingRow('Loading session notes…')
          : list.length === 0 ? <div className="p-6"><Empty text="No session notes for this student yet." /></div>
          : list.map(r => (
            <div key={r.id} className={rowCls}>
              <div className="min-w-40 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {r.category && <Pill tone="indigo">{r.category}</Pill>}
                  {r.followUpNeeded && <Pill tone="amber">Follow-up needed</Pill>}
                </div>
                <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-black/70 dark:text-white/70">{r.notes}</p>
              </div>
              <p className="text-[12.5px] text-black/40 dark:text-white/40">{r.sessionDate}</p>
            </div>
          ))}
      </Card>
      <Modal open={open} onClose={() => { setOpen(false); resetForm() }} title="Log a counseling session">
        <div className="space-y-4">
          <Field label="Session date"><input type="date" value={sessionDate} onChange={e => setSessionDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Category (optional)">
            <select value={category} onChange={e => setCategory(e.target.value as CounselingCategory | '')} className={inputCls}>
              <option value="">Unspecified</option>
              {COUNSELING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Session notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5} className={inputCls} /></Field>
          <label className="flex items-center gap-2 text-[13.5px] font-medium">
            <input type="checkbox" checked={followUp} onChange={e => setFollowUp(e.target.checked)} className="h-4 w-4 rounded" /> Follow-up needed
          </label>
          <button onClick={save} disabled={busy || !notes.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save session note'}</button>
        </div>
      </Modal>
    </div>
  )
}

/* ── Student/parent: Report a concern (anonymous) ──────────── */

export function ReportConcernMod() {
  const [category, setCategory] = useState<AnonymousReportCategory>('Bullying')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // IMPORTANT: this body carries ONLY category + description — no studentId, no user id, no name, no
  // email, nothing from `useStore().user`. The auth token still travels in the Authorization header (the
  // shared api client always sends it) but the server never stores a submittedById, so nothing in the
  // stored row or its audit-log entry traces back to a person. Do not add any identifying field here.
  const submit = async () => {
    if (!description.trim()) return
    setBusy(true)
    try {
      await api.post('/safety/anonymous-reports', { category, description: description.trim() })
      setSubmitted(true)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const reset = () => { setSubmitted(false); setCategory('Bullying'); setDescription('') }

  return (
    <div>
      <PageHead title="Report a Concern" sub="Anonymous — for bullying, safety or wellbeing concerns" />
      <div className="mx-auto max-w-xl">
        <div className="mb-5 flex items-start gap-3 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 p-4 text-[13px] text-emerald-800 dark:text-emerald-300">
          <ShieldQuestion size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">This report is fully anonymous.</p>
            <p className="mt-1 text-[12.5px] leading-relaxed">Your name, email and account are never attached to what you submit — not even in the school's internal logs. Only the category and description you write below are sent.</p>
          </div>
        </div>
        <Card>
          {submitted ? (
            <div className="py-6 text-center">
              <CheckCheck size={32} className="mx-auto text-emerald-500" />
              <p className="font-display mt-3 text-[18px] font-medium">Report submitted</p>
              <p className="mt-1.5 text-[13.5px] text-black/55 dark:text-white/55">A counselor or the principal will review it. Thank you for speaking up.</p>
              <button onClick={reset} className={`${ghostBtn} mt-5`}>Submit another report</button>
            </div>
          ) : (
            <div className="space-y-4">
              <Field label="Category">
                <select value={category} onChange={e => setCategory(e.target.value as AnonymousReportCategory)} className={inputCls}>
                  {ANON_REPORT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="What's going on?"><textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} placeholder="Describe the concern — as much detail as you're comfortable sharing." className={inputCls} /></Field>
              <button onClick={submit} disabled={busy || !description.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40"><MessageCircleWarning size={15} className="mr-1.5 inline" />{busy ? 'Submitting…' : 'Submit anonymously'}</button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ── Counselor/principal: Review queue ─────────────────────── */

const reviewStatusTone = (s: string) => anonReportTone(s as AnonymousReport['status'])

export function ConcernReviewQueueMod() {
  const { user } = useStore()
  const canReview = user ? (!!user.isCounselor || isAdmin(user)) : false
  const [status, setStatus] = useState<AnonymousReport['status'] | ''>('')
  const { items, loading, error, reload } = useAnonymousReports(status, canReview)
  const list = useMemo(() => [...(items ?? [])].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), [items])

  const [reviewing, setReviewing] = useState<AnonymousReport | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const setStatusOf = async (r: AnonymousReport, next: AnonymousReport['status'], resolutionNotes?: string) => {
    setBusy(r.id)
    try {
      await api.patch(`/safety/anonymous-reports/${r.id}`, { status: next, resolutionNotes })
      setReviewing(null); setNotes(''); reload(); toast.success(`Marked ${next}`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  if (!canReview) {
    return (
      <div>
        <PageHead title="Concern Review Queue" sub="Anonymous reports awaiting review" />
        <Card><Empty text="This queue is limited to counselors and the principal/admin." /></Card>
      </div>
    )
  }

  return (
    <div>
      <PageHead title="Concern Review Queue" sub="Anonymous reports — reviewable by counselors and principal/admin only">
        <select value={status} onChange={e => setStatus(e.target.value as AnonymousReport['status'] | '')} className={`${inputCls} w-auto`}>
          <option value="">All statuses</option>
          {ANON_REPORT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </PageHead>
      <Card className="p-0">
        {loading ? loadingRow('Loading reports…')
          : error ? <div className="p-6"><Empty text={error} /></div>
          : list.length === 0 ? <div className="p-6"><Empty text="No anonymous reports here." /></div>
          : list.map(r => (
            <div key={r.id} className={rowCls}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-500 dark:bg-rose-500/10"><AlertTriangle size={16} /></span>
              <div className="min-w-40 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="slate">{r.category}</Pill>
                  <Pill tone={reviewStatusTone(r.status)}>{r.status}</Pill>
                </div>
                <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-black/70 dark:text-white/70">{r.description}</p>
                {r.resolutionNotes && <p className="mt-2 text-[12.5px] text-black/50 dark:text-white/50">Resolution: {r.resolutionNotes}</p>}
                <p className="mt-1 text-[12px] text-black/40 dark:text-white/40">Submitted {new Date(r.submittedAt).toLocaleString('en-IN')}</p>
              </div>
              <div className="flex flex-col gap-2">
                {r.status === 'New' && <button onClick={() => setStatusOf(r, 'Reviewing')} disabled={busy === r.id} className={ghostBtn}>Start reviewing</button>}
                {r.status !== 'Resolved' && <button onClick={() => { setReviewing(r); setNotes('') }} disabled={busy === r.id} className={primaryBtn}><CheckCheck size={13} /> Resolve</button>}
              </div>
            </div>
          ))}
      </Card>
      <Modal open={!!reviewing} onClose={() => { setReviewing(null); setNotes('') }} title="Resolve report">
        {reviewing && (
          <div className="space-y-4">
            <p className="text-[13.5px] leading-relaxed text-black/70 dark:text-white/70">{reviewing.description}</p>
            <Field label="Resolution notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} className={inputCls} /></Field>
            <button onClick={() => setStatusOf(reviewing, 'Resolved', notes.trim() || undefined)} disabled={busy === reviewing.id} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40"><HeartHandshake size={15} className="mr-1.5 inline" /> Mark resolved</button>
          </div>
        )}
      </Modal>
    </div>
  )
}
