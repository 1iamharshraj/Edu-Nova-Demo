import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, errorMessage } from '@/lib/api'
import { isStaffOrAdmin } from '@/lib/access'
import { useBoardRegistrations } from '@/lib/hooks/useIdentity'
import { Card, Empty, Field, PageHead, inputCls } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Was `EditBoardRegistrationModal` inside office.tsx, opened from `BoardRegistrationView`'s "Edit details"
// button. Converted to a routed page per .agents/edunova/ui-architecture-fix.md Phase D #3. Data/mutation
// logic is carried over verbatim from the original modal. The review screen it was opened from
// (`BoardRegistrationMod`) is unchanged and stays a Portal tab, not a route.

export default function BoardRegistrationEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { db, user } = useStore()
  const { boards, currentYear } = useAcademic()
  const regsQ = useBoardRegistrations()

  const student = db.users.find(u => u.id === id) ?? null
  const canEdit = !!user && (isStaffOrAdmin(user) || user.role === 'teacher')
  const regsForStudent = (regsQ.items ?? []).filter(r => r.studentId === id)
  const reg = regsForStudent.find(r => currentYear && r.academicYearId === currentYear.id) ?? regsForStudent[0]

  const [f, setF] = useState({ boardId: '', nameOnCertificate: '', dob: '', registrationNo: '', rollNo: '', affiliationNo: '', mismatchNote: '' })
  const [synced, setSynced] = useState<string | null>(null)
  if (reg && synced !== reg.id) {
    setSynced(reg.id)
    setF({
      boardId: reg.boardId, nameOnCertificate: reg.nameOnCertificate, dob: reg.dob, registrationNo: reg.registrationNo ?? '', rollNo: reg.rollNo ?? '',
      affiliationNo: reg.affiliationNo ?? '', mismatchNote: reg.mismatchNote ?? '',
    })
  }
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(x => ({ ...x, [k]: e.target.value }))

  const save = async () => {
    if (!reg) return
    setBusy(true)
    try {
      await api.patch(`/board-registrations/${reg.id}`, {
        boardId: f.boardId, nameOnCertificate: f.nameOnCertificate.trim(), dob: f.dob, registrationNo: f.registrationNo.trim() || null, rollNo: f.rollNo.trim() || null,
        affiliationNo: f.affiliationNo.trim() || null, mismatchNote: f.mismatchNote.trim() || null,
      })
      toast.success('Board details updated')
      navigate(-1)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <PortalPageShell backLabel="Back to board registration">
      {!student && <Empty text="Student not found." />}
      {student && !canEdit && <Empty text="You don't have permission to edit board registrations." />}
      {student && canEdit && regsQ.loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</p>}
      {student && canEdit && !regsQ.loading && !reg && (
        <Empty text="No board registration for this student yet — start it from the Board Registration screen (Prefill from enrolment)." />
      )}
      {student && canEdit && reg && (
        <div>
          <PageHead title={`Edit board details — ${student.name}`} />
          <Card>
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
              <div className="flex gap-3 pt-2">
                <button onClick={save} disabled={busy || !f.nameOnCertificate.trim() || !f.dob || !f.boardId} className="btn-ink flex-1 py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save details'}</button>
                <button onClick={() => navigate(-1)} disabled={busy} className="rounded-xl bg-black/[.05] dark:bg-white/[.07] px-5 py-3 text-[14px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40">Cancel</button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </PortalPageShell>
  )
}
