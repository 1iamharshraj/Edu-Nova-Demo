import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import { isoDate } from '@/lib/hooks/useTimetable'
import { useContract } from '@/lib/hooks/useHr'
import { AsyncEntityPicker } from '@/portal/components/AsyncEntityPicker'
import { Card, Empty, Field, PageHead, inputCls } from '@/portal/ui'
import { PortalPageShell } from './PortalPageShell'

// Was the "New contract" / "Edit contract" `<Modal>`s inside `ContractsResignationsAdminMod` in
// portal/modules/hr.tsx. Per .agents/edunova/ui-architecture-fix.md Phase D, a dense employment-contract
// form (salary/dates/terms) becomes a real page rather than a modal. One component handles both flows via
// an optional `:id` param, routed as two separate paths sharing this page:
//   - `/portal/hr/contracts/new`  → create (no `:id`, ContractDetail renders the create form)
//   - `/portal/hr/contracts/:id`  → edit (only reachable from a Draft contract's Edit button — the server
//     only allows editing designation/department/dates/terms on a Draft contract, so a contract that has
//     since moved past Draft, e.g. by direct URL, is shown read-only instead of a broken edit form)
// Data/mutation logic carried over verbatim from the original modals.

export default function ContractDetail() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const isNew = !id
  const { data: contract, loading, error } = useContract(id, !isNew)

  const [form, setForm] = useState({ userId: '', designation: '', department: '', startDate: isoDate(new Date()), endDate: '', terms: '' })
  const [busy, setBusy] = useState(false)

  // Edit form initializes from the fetched contract once it loads — mirrors the original modal's `setEditing(c)`,
  // which ran off an already-loaded row; here the contract loads async on page mount.
  const [initedFor, setInitedFor] = useState<string | null>(null)
  if (!isNew && contract && initedFor !== contract.id) {
    setInitedFor(contract.id)
    setForm({ userId: contract.userId, designation: contract.designation, department: contract.department ?? '', startDate: contract.startDate, endDate: contract.endDate ?? '', terms: contract.terms })
  }

  const createContract = async () => {
    setBusy(true)
    try {
      await api.post('/hr/contracts', {
        userId: form.userId, designation: form.designation.trim(), department: form.department.trim() || undefined,
        startDate: form.startDate, endDate: form.endDate || undefined, terms: form.terms.trim(),
      })
      toast.success('Contract created')
      navigate(-1)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const saveEdit = async () => {
    if (!contract) return
    setBusy(true)
    try {
      await api.patch(`/hr/contracts/${contract.id}`, {
        designation: form.designation.trim(), department: form.department.trim() || undefined,
        startDate: form.startDate, endDate: form.endDate || undefined, terms: form.terms.trim(),
      })
      toast.success('Contract updated')
      navigate(-1)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <PortalPageShell backLabel="Back to contracts">
      {isNew ? (
        <div>
          <PageHead title="New contract" sub="Create a draft employment contract for an employee" />
          <Card>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Employee">
                  <AsyncEntityPicker role={['teacher', 'staff', 'admin', 'superadmin']} value={form.userId}
                    onChange={uid => setForm({ ...form, userId: uid })} placeholder="Search employees…" />
                </Field>
                <Field label="Designation"><input value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} className={inputCls} /></Field>
                <Field label="Department"><input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} className={inputCls} /></Field>
                <Field label="Start date"><input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} className={inputCls} /></Field>
                <Field label="End date (optional)"><input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} className={inputCls} /></Field>
              </div>
              <Field label="Terms"><textarea value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} rows={4} placeholder="Notice period, leave policy, confidentiality clauses…" className={inputCls} /></Field>
              <button onClick={createContract} disabled={busy || !form.userId || !form.designation.trim() || !form.terms.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Creating…' : 'Create draft'}</button>
            </div>
          </Card>
        </div>
      ) : (
        <>
          {loading && <p className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading contract…</p>}
          {!loading && (error || !contract) && <Empty text={error || 'Contract not found.'} />}
          {!loading && contract && (
            <div>
              <PageHead title={contract.userName ?? 'Contract'} sub={contract.status === 'Draft' ? 'Edit this draft contract' : `${contract.status} — only Draft contracts can be edited`} />
              <Card>
                {contract.status === 'Draft' ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Designation"><input value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} className={inputCls} /></Field>
                      <Field label="Department"><input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} className={inputCls} /></Field>
                      <Field label="Start date"><input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} className={inputCls} /></Field>
                      <Field label="End date"><input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} className={inputCls} /></Field>
                    </div>
                    <Field label="Terms"><textarea value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} rows={4} className={inputCls} /></Field>
                    <button onClick={saveEdit} disabled={busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save contract'}</button>
                  </div>
                ) : (
                  <div className="space-y-3 text-[14px]">
                    <p><span className="text-black/50 dark:text-white/50">Designation:</span> <span className="font-semibold">{contract.designation}</span></p>
                    {contract.department && <p><span className="text-black/50 dark:text-white/50">Department:</span> <span className="font-semibold">{contract.department}</span></p>}
                    <p><span className="text-black/50 dark:text-white/50">Tenure:</span> <span className="font-semibold">{contract.startDate} → {contract.endDate || 'open'}</span></p>
                    <p className="whitespace-pre-line text-black/70 dark:text-white/70">{contract.terms}</p>
                  </div>
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </PortalPageShell>
  )
}
