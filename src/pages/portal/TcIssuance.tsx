import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { AlertTriangle, Check, MapPin, ShieldAlert } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { useSubmittedDocumentActions, useTcReturnChecklist } from '@/lib/hooks/useDocuments'
import { Card, Field, Modal, PageHead, inputCls } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// New dedicated page for Phase T2 Part B's TC-issuance document-return workflow — the piece the user
// explicitly flagged ("when getting TC should be given [back] and stuffs"). UX-fit call (D9): a routed page,
// not a modal off the Applications list. Issuing a TC is already a two-source action in this app (approving
// an existing TC application, or issuing one directly with no application) and now additionally requires
// resolving every held original one at a time with its own returnedTo/reason capture — that's a real
// multi-step, multi-state flow, not a single confirm dialog, so it gets a real URL a staff member can return
// to mid-way through resolving a long list without losing their place.
//
// Matches the real server contract: `GET /admission-documents/tc-return-checklist/:studentId` previews the
// held originals; resolving each via `POST /admission-documents/:id/return` or `.../lost` removes it from
// that HELD set, so by the time `POST /applications/:id/approve` runs (with no body — see
// modules/applications/service.ts#approve calling admissionDocuments.resolveHeldOriginalsForTc) there are no
// held originals left to block it. A TC issued with no `applicationId` (the direct-reissue path via `POST
// /certificates`) is not gated server-side — this still shows the checklist as a courtesy, matching the
// existing "a TC issued here does not close the student's enrolment" comment on that path.

function ResolveDocButton({ id, onDone }: { id: string; onDone: () => void }) {
  const { busy, markReturned, markLost } = useSubmittedDocumentActions()
  const [modal, setModal] = useState<'return' | 'lost' | null>(null)
  const [returnedTo, setReturnedTo] = useState('')
  const [reason, setReason] = useState('')

  const doReturn = async () => { if (await markReturned(id, returnedTo.trim())) { setModal(null); setReturnedTo(''); onDone() } }
  const doLost = async () => { if (await markLost(id, reason.trim() || undefined)) { setModal(null); setReason(''); onDone() } }

  return (
    <>
      <div className="flex items-center gap-2">
        <button onClick={() => setModal('return')} className="rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20">Mark returned</button>
        <button onClick={() => setModal('lost')} className="rounded-full bg-amber-50 dark:bg-amber-500/10 px-3 py-1.5 text-[12px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20">Acknowledge exception (lost)</button>
      </div>
      <Modal open={modal === 'return'} onClose={() => setModal(null)} title="Mark original returned">
        <div className="space-y-4">
          <Field label="Returned to (name)"><input value={returnedTo} onChange={e => setReturnedTo(e.target.value)} className={inputCls} autoFocus /></Field>
          <button onClick={doReturn} disabled={!returnedTo.trim() || busy === id} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy === id ? 'Saving…' : 'Confirm returned'}</button>
        </div>
      </Modal>
      <Modal open={modal === 'lost'} onClose={() => setModal(null)} title="Acknowledge exception">
        <div className="space-y-4">
          <p className="text-[13.5px] text-black/60 dark:text-white/60">Use this when the original genuinely cannot be returned right now — it's recorded as lost with a reason, not a silent skip.</p>
          <Field label="Reason"><textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className={inputCls} autoFocus /></Field>
          <button onClick={doLost} disabled={busy === id} className="w-full rounded-xl bg-amber-500 py-3 text-[14px] font-semibold text-white hover:bg-amber-600 disabled:opacity-40">{busy === id ? 'Saving…' : 'Acknowledge & record'}</button>
        </div>
      </Modal>
    </>
  )
}

export default function TcIssuance() {
  const { studentId } = useParams<{ studentId: string }>()
  const [params] = useSearchParams()
  const applicationId = params.get('applicationId') ?? undefined
  const navigate = useNavigate()
  const { db, refreshAcademic } = useStore()
  const student = db.users.find(u => u.id === studentId)
  const checklist = useTcReturnChecklist(studentId)
  const [issuing, setIssuing] = useState(false)

  const rows = checklist.data?.heldOriginals ?? []
  const allResolved = checklist.loading ? false : rows.length === 0

  const issue = async () => {
    if (!studentId) return
    setIssuing(true)
    try {
      if (applicationId) await api.post(`/applications/${applicationId}/approve`)
      else await api.post('/certificates', { kind: 'TC', studentId })
      toast.success('Transfer certificate issued')
      await refreshAcademic()
      navigate(-1)
    } catch (e) { toast.error(errorMessage(e)) } finally { setIssuing(false) }
  }

  return (
    <PortalPageShell backLabel="Back to admissions">
      <PageHead title={`Issue TC — ${student?.name ?? 'Student'}`} sub="Every held original document must be marked returned or an acknowledged exception before the transfer certificate is issued" />

      <Card className="mb-5 flex items-start gap-3 bg-amber-50 dark:bg-amber-500/10 p-4 text-[13px] text-amber-800 dark:text-amber-300">
        <ShieldAlert size={18} className="mt-0.5 shrink-0" />
        <p>This closes the real, common failure mode of schools losing track of original certificates at withdrawal — issuance is blocked here until every row below is resolved one way or the other.</p>
      </Card>

      <Card className="p-0 divide-y divide-black/[.05] dark:divide-white/[.07]">
        {checklist.loading && <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading held originals…</div>}
        {!checklist.loading && rows.length === 0 && (
          <div className="flex items-center gap-2 p-6 text-[13.5px] text-emerald-700 dark:text-emerald-300"><Check size={16} /> No held original documents for this student — clear to issue.</div>
        )}
        {rows.map(d => (
          <div key={d.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
            <div className="min-w-48 flex-1">
              <p className="text-[14px] font-semibold">{d.name}</p>
              {(d.physicalLocationRoom || d.physicalLocationShelf || d.physicalLocationFolder) && (
                <p className="mt-0.5 flex items-center gap-1 text-[12px] text-black/45 dark:text-white/45"><MapPin size={11} /> {[d.physicalLocationRoom, d.physicalLocationShelf, d.physicalLocationFolder].filter(Boolean).join(' / ')}</p>
              )}
            </div>
            <ResolveDocButton id={d.id} onDone={checklist.reload} />
          </div>
        ))}
      </Card>

      <div className="mt-5 flex items-center gap-3">
        <button onClick={issue} disabled={!allResolved || issuing}
          className="btn-ink flex items-center gap-2 px-6 py-3 text-[14px] font-semibold disabled:opacity-40">
          {issuing ? 'Issuing…' : 'Issue transfer certificate'}
        </button>
        {!allResolved && !checklist.loading && (
          <span className="flex items-center gap-1.5 text-[12.5px] text-amber-600 dark:text-amber-400"><AlertTriangle size={13} /> {rows.length} document{rows.length > 1 ? 's' : ''} still need resolving</span>
        )}
      </div>
    </PortalPageShell>
  )
}
