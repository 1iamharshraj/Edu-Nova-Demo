import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Banknote, Check, Download, FileText, Layers, Pencil, Play, Plus, Receipt, Search, Trash2, Wallet, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { api, downloadPath, errorMessage } from '@/lib/api'
import { isAdmin } from '@/lib/access'
import {
  compareClasses, fmtINR, type FeeHead, type FeeInstallmentPlan, type FeeInvoice, type FeeStructureLine,
  type InstallmentSpec, type InvoiceStatus, type Payment, type PaymentMethod, type Payslip, type SalaryComponent, type SalaryStructure, type User,
} from '@/lib/data'
import { fmtDate } from '@/lib/hooks/useAcademics'
import { isoDate } from '@/lib/hooks/useTimetable'
import {
  INVOICE_STATUSES, METHOD_LABEL, PAYMENT_METHODS, STATUS_TEXT, fmtMonth, invoiceLabel, invoiceTone, isOutstanding, linesTotal, monthKey, netOf, num, outstandingOf, paidOf,
  payableOf, sumComponents, useEmployees, useFeeHeads, useFeeStructures, useInstallmentPlans, useInvoices, usePayments, usePayslips, useSalaryStructures,
} from '@/lib/hooks/useFinance'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'

// Phase 5 finance screens: fee setup (heads · structures · invoices), staff collections, payroll and payslips.
// Parent/student payments live in paymentGateway.tsx; defaulters in feeDefaulters.tsx. See .agents/edunova/phase-5-finance.md

/* ── shared bits ───────────────────────────────────────── */

const ghostBtn = 'flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40'
const dangerBtn = 'flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-500/10 px-3.5 py-2 text-[13px] font-semibold text-rose-500 hover:bg-rose-100 disabled:opacity-40'
const primaryBtn = 'flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40'
const loadingRow = (text: string) => <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">{text}</div>
const sectionHead = 'border-b border-black/[.06] dark:border-white/[.08] px-6 py-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40'
const rowCls = 'flex flex-wrap items-center gap-4 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0'

function SegTabs<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (t: T) => void }) {
  return (
    <div className="inline-flex rounded-full border border-black/[.08] dark:border-white/[.10] bg-white dark:bg-[#14141f] p-1">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all ${value === o.id ? 'bg-black text-white shadow' : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function StatTile({ icon, label, value, tint }: { icon: React.ReactNode; label: string; value: string; tint: string }) {
  return (
    <Card className="flex items-center gap-4">
      <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tint}`}>{icon}</span>
      <div><p className="text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">{label}</p><p className="font-display text-2xl font-medium">{value}</p></div>
    </Card>
  )
}

/** Downloads an authenticated PDF (receipt / payslip) with a toast on failure. */
async function pdf(path: string, name: string) {
  try { await downloadPath(path, name); toast.success('PDF downloaded') } catch (e) { toast.error(errorMessage(e)) }
}
const invoiceReceipt = (inv: FeeInvoice) => pdf(`/fees/invoices/${inv.id}/receipt.pdf`, `${inv.invoiceNo.replace(/\W+/g, '_')}.pdf`)
const paymentReceipt = (p: Payment) => pdf(`/fees/payments/${p.id}/receipt.pdf`, `${p.receiptNo.replace(/\W+/g, '_')}.pdf`)
const payslipPdf = (s: Payslip) => pdf(`/payroll/payslips/${s.id}.pdf`, `${s.slipNo.replace(/\W+/g, '_')}.pdf`)

/** Editable `{ feeHeadId, amount }` list used by the structure editor and the ad-hoc invoice form.
 * Exported: also used by `/portal/finance/fee-structures/:classId/:termId` (FeeStructureDetail.tsx). */
export function LinesEditor({ lines, heads, onChange }: { lines: FeeStructureLine[]; heads: FeeHead[]; onChange: (l: FeeStructureLine[]) => void }) {
  const used = new Set(lines.map(l => l.feeHeadId))
  const free = heads.filter(h => !used.has(h.id))
  const headName = (id: string) => heads.find(h => h.id === id)?.name ?? 'Fee head'
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={l.feeHeadId} className="flex items-center gap-2">
          <span className="flex-1 text-[14px] font-medium">{headName(l.feeHeadId)}</span>
          <input type="number" min={0} value={l.amount} onChange={e => onChange(lines.map((x, j) => (j === i ? { ...x, amount: num(e.target.value) } : x)))} className={`${inputCls} w-32 py-2`} aria-label={`${headName(l.feeHeadId)} amount`} />
          <button onClick={() => onChange(lines.filter((_, j) => j !== i))} className="rounded-full p-2 text-black/40 hover:bg-rose-50 hover:text-rose-500 dark:text-white/40" aria-label="Remove line"><X size={14} /></button>
        </div>
      ))}
      {lines.length === 0 && <p className="text-[13px] text-black/45 dark:text-white/45">No lines yet — add a fee head below.</p>}
      {free.length > 0 ? (
        <select value="" onChange={e => e.target.value && onChange([...lines, { feeHeadId: e.target.value, amount: 0 }])} className={`${inputCls} py-2 text-[13.5px]`} aria-label="Add fee head">
          <option value="">+ Add fee head…</option>
          {free.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      ) : heads.length === 0 && <p className="text-[12.5px] text-amber-600">Create fee heads first (Heads tab).</p>}
      <p className="pt-1 text-right text-[13px] font-semibold">Total {fmtINR(linesTotal(lines))}</p>
    </div>
  )
}

/** Name / class helpers over the users + academic slices. */
function useStudentLookup() {
  const { db } = useStore()
  const { classOf, enrollments, currentYear } = useAcademic()
  return useMemo(() => {
    const byId = new Map(db.users.map(u => [u.id, u]))
    return {
      students: db.users.filter(u => u.role === 'student').sort((a, b) => a.name.localeCompare(b.name)),
      nameOf: (id: string, fallback?: string) => fallback ?? byId.get(id)?.name ?? 'Student',
      classLabel: (id: string, fallback?: string) => fallback ?? classOf(id)?.label ?? '—',
      rollOf: (id: string) => (enrollments.find(e => e.studentId === id && e.status === 'active' && (!currentYear || e.academicYearId === currentYear.id))
        ?? enrollments.find(e => e.studentId === id))?.rollNo,
      userOf: (id: string) => byId.get(id),
    }
  }, [db.users, classOf, enrollments, currentYear])
}

/* ── Fee Setup: heads · structures · invoices ──────────── */

export function FeeSetupMod() {
  const [tab, setTab] = useState<'heads' | 'structures' | 'invoices'>('heads')
  const subs = { heads: 'Fee heads are the components every invoice is built from', structures: 'What each class pays per term — generate invoices from here', invoices: 'Every invoice raised, with concessions, waivers and receipts' }
  return (
    <div>
      <PageHead title="Fee Setup" sub={subs[tab]}>
        <SegTabs value={tab} onChange={setTab} options={[{ id: 'heads', label: 'Heads' }, { id: 'structures', label: 'Structures' }, { id: 'invoices', label: 'Invoices' }]} />
      </PageHead>
      {tab === 'heads' && <HeadsTab />}
      {tab === 'structures' && <StructuresTab />}
      {tab === 'invoices' && <InvoicesTab />}
    </div>
  )
}

function HeadsTab() {
  const heads = useFeeHeads()
  const [name, setName] = useState('')
  const [recurring, setRecurring] = useState(true)
  const [editing, setEditing] = useState<{ id: string; name: string; isRecurring: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const add = async () => {
    if (!name.trim()) return
    setBusy('add')
    try {
      await api.post('/fees/heads', { name: name.trim(), isRecurring: recurring })
      setName(''); heads.reload(); toast.success(`Fee head "${name.trim()}" added`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const save = async () => {
    if (!editing || !editing.name.trim()) return
    setBusy(editing.id)
    try {
      await api.patch(`/fees/heads/${editing.id}`, { name: editing.name.trim(), isRecurring: editing.isRecurring })
      setEditing(null); heads.reload(); toast.success('Fee head updated')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const remove = async (h: FeeHead) => {
    if (!confirm(`Delete fee head "${h.name}"? Structures that use it will need editing.`)) return
    setBusy(h.id)
    try { await api.del(`/fees/heads/${h.id}`); heads.reload(); toast.success('Fee head deleted') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
      <Card>
        <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">New fee head</p>
        <div className="space-y-4">
          <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Tuition, Transport, Lab & Activity" className={inputCls} onKeyDown={e => e.key === 'Enter' && add()} /></Field>
          <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)} /> Recurring every term</label>
          <button onClick={add} disabled={!name.trim() || busy === 'add'} className="btn-ink flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold disabled:opacity-40"><Plus size={15} /> Add fee head</button>
        </div>
      </Card>
      <Card className="p-0">
        <p className={sectionHead}>Fee heads</p>
        {heads.loading ? loadingRow('Loading fee heads…')
          : heads.error ? <div className="p-6"><Empty text={heads.error} /></div>
          : (heads.items ?? []).length === 0 ? <div className="p-6"><Empty text="No fee heads yet — add Tuition to get started." /></div>
          : (heads.items ?? []).map(h => (
            <div key={h.id} className={rowCls}>
              {editing?.id === h.id ? (
                <>
                  <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className={`${inputCls} flex-1 py-2`} autoFocus onKeyDown={e => e.key === 'Enter' && save()} />
                  <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={editing.isRecurring} onChange={e => setEditing({ ...editing, isRecurring: e.target.checked })} /> Recurring</label>
                  <button onClick={save} disabled={busy === h.id} className={primaryBtn}><Check size={13} /> Save</button>
                  <button onClick={() => setEditing(null)} className={ghostBtn}>Cancel</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-[14.5px] font-medium">{h.name}</span>
                  <Pill tone={h.isRecurring ? 'indigo' : 'slate'}>{h.isRecurring ? 'Recurring' : 'One-time'}</Pill>
                  <button onClick={() => setEditing({ id: h.id, name: h.name, isRecurring: h.isRecurring })} className={ghostBtn}><Pencil size={12} /> Edit</button>
                  <button onClick={() => remove(h)} disabled={busy === h.id} className={dangerBtn}><Trash2 size={12} /></button>
                </>
              )}
            </div>
          ))}
      </Card>
    </div>
  )
}

/* ── Phase 21 item 5: installment plans per fee structure ── */

type InstallmentMode = 'Percentage' | 'FixedAmount'
interface InstallmentRow { label: string; value: string; dueDateOffsetDays: string }
const emptyInstallmentRow = (label = ''): InstallmentRow => ({ label, value: '', dueDateOffsetDays: '0' })

function InstallmentPlanFormModal({ open, feeStructureId, onClose, onSaved }: { open: boolean; feeStructureId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<InstallmentMode>('Percentage')
  const [rows, setRows] = useState<InstallmentRow[]>([emptyInstallmentRow('Q1'), emptyInstallmentRow('Q2')])
  const [busy, setBusy] = useState(false)
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setName(''); setMode('Percentage'); setRows([emptyInstallmentRow('Q1'), emptyInstallmentRow('Q2')])
  } else if (!open && wasOpen) setWasOpen(false)

  const percentSum = rows.reduce((a, r) => a + (Number(r.value) || 0), 0)
  const valid = name.trim() && rows.length >= 2 && rows.every(r => r.label.trim() && Number(r.value) > 0)
    && new Set(rows.map(r => r.label.trim())).size === rows.length && (mode !== 'Percentage' || Math.round(percentSum) === 100)

  const save = async () => {
    setBusy(true)
    try {
      const installments = rows.map(r => ({
        label: r.label.trim(), dueDateOffsetDays: Math.round(Number(r.dueDateOffsetDays) || 0),
        ...(mode === 'Percentage' ? { percentage: Number(r.value) } : { amount: Number(r.value) }),
      }))
      await api.post('/fees/installment-plans', { feeStructureId, name: name.trim(), installments })
      onSaved(); toast.success(`Installment plan "${name.trim()}" added`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New installment plan">
      <div className="space-y-4">
        <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Quarterly" className={inputCls} autoFocus /></Field>
        <Field label="Split by">
          <div className="flex gap-2">
            {(['Percentage', 'FixedAmount'] as InstallmentMode[]).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex-1 rounded-xl py-2.5 text-[13px] font-semibold transition-colors ${mode === m ? 'bg-black text-white' : 'bg-black/[.05] dark:bg-white/[.07] text-black/60 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/15'}`}>
                {m === 'Percentage' ? 'Percentage (of total)' : 'Fixed amount (₹)'}
              </button>
            ))}
          </div>
        </Field>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={r.label} onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Label" className={`${inputCls} w-24 py-2`} />
              <input type="number" min={0} value={r.value} onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                placeholder={mode === 'Percentage' ? '%' : '₹'} className={`${inputCls} flex-1 py-2`} />
              <input type="number" value={r.dueDateOffsetDays} onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, dueDateOffsetDays: e.target.value } : x)))}
                placeholder="Days after due date" title="Days added to the structure's due date" className={`${inputCls} w-40 py-2`} />
              {rows.length > 2 && <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="rounded-full p-2 text-black/40 hover:bg-rose-50 hover:text-rose-500 dark:text-white/40" aria-label="Remove installment"><X size={14} /></button>}
            </div>
          ))}
          <button onClick={() => setRows(rs => [...rs, emptyInstallmentRow(`Q${rs.length + 1}`)])} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
            <Plus size={13} /> Add installment
          </button>
        </div>
        {mode === 'Percentage' && <p className={`text-[12.5px] ${Math.round(percentSum) === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>Total {Math.round(percentSum)}% {Math.round(percentSum) === 100 ? '— balanced' : '(must sum to 100%)'}</p>}
        <p className="text-[12px] text-black/40 dark:text-white/40">"Days after due date" is added to the fee structure's own due date to get each installment's due date (0 = same day).</p>
        <button onClick={save} disabled={!valid || busy} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save installment plan'}</button>
      </div>
    </Modal>
  )
}

/** Lists/creates/deletes the installment plans defined for one fee structure, and lets the admin pick one
 * (or "Full amount") before generating invoices.
 * Exported: also used by `/portal/finance/fee-structures/:classId/:termId` (FeeStructureDetail.tsx). */
export function InstallmentPlansSection({ feeStructureId, planId, onPlanChange }: { feeStructureId: string; planId: string; onPlanChange: (id: string) => void }) {
  const plans = useInstallmentPlans(feeStructureId)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const removePlan = async (p: FeeInstallmentPlan) => {
    if (!confirm(`Delete installment plan "${p.name}"?`)) return
    setBusy(p.id)
    try {
      await api.del(`/fees/installment-plans/${p.id}`)
      if (planId === p.id) onPlanChange('')
      plans.reload(); toast.success('Installment plan deleted')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const summarize = (p: FeeInstallmentPlan) => (p.installments as InstallmentSpec[])
    .map(i => `${i.label} ${i.percentage !== undefined ? `${i.percentage}%` : fmtINR(i.amount ?? 0)}`).join(' · ')

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Installment plans</p>
        <button onClick={() => setFormOpen(true)} className="flex items-center gap-1.5 rounded-full bg-black/[.05] dark:bg-white/[.07] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/10 dark:hover:bg-white/15">
          <Plus size={13} /> New plan
        </button>
      </div>
      {plans.loading ? <p className="text-[13px] text-black/40 dark:text-white/40">Loading plans…</p> : (plans.items ?? []).length === 0 ? (
        <p className="text-[13px] text-black/45 dark:text-white/45">No installment plans yet — students pay the full amount in one invoice unless you add one.</p>
      ) : (
        <div className="space-y-2">
          {(plans.items ?? []).map(p => (
            <div key={p.id} className="flex items-center gap-2 rounded-2xl border border-black/[.06] dark:border-white/[.08] p-3">
              <Layers size={15} className="shrink-0 text-indigo-500" />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold">{p.name}</p>
                <p className="truncate text-[12px] text-black/45 dark:text-white/45">{summarize(p)}</p>
              </div>
              <button onClick={() => removePlan(p)} disabled={busy === p.id} className="rounded-full p-2 text-black/40 hover:bg-rose-50 hover:text-rose-500 dark:text-white/40" aria-label={`Delete ${p.name}`}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3">
        <Field label="Generate using">
          <select value={planId} onChange={e => onPlanChange(e.target.value)} className={inputCls}>
            <option value="">Full amount (one invoice)</option>
            {(plans.items ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <InstallmentPlanFormModal open={formOpen} feeStructureId={feeStructureId} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); plans.reload() }} />
    </div>
  )
}

function StructuresTab() {
  const navigate = useNavigate()
  const { classes, terms, currentYear, gradeById } = useAcademic()
  const classList = useMemo(() => classes.filter(c => !currentYear || c.academicYearId === currentYear.id).sort(compareClasses(gradeById)), [classes, currentYear, gradeById])
  const termList = useMemo(() => terms.filter(t => !currentYear || t.academicYearId === currentYear.id).sort((a, b) => a.startDate.localeCompare(b.startDate)), [terms, currentYear])
  const structures = useFeeStructures()
  const byCell = useMemo(() => new Map((structures.items ?? []).map(s => [`${s.classId}|${s.termId}`, s])), [structures.items])

  if (classList.length === 0 || termList.length === 0) return <Card><Empty text="Create classes and terms in Academic Setup first." /></Card>
  return (
    <Card className="p-0">
      {structures.loading ? loadingRow('Loading fee structures…') : structures.error ? <div className="p-6"><Empty text={structures.error} /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13.5px]">
            <thead>
              <tr className="border-b border-black/[.06] dark:border-white/[.08] text-left text-[12px] uppercase tracking-wider text-black/40 dark:text-white/40">
                <th className="px-6 py-3.5 font-semibold">Class</th>
                {termList.map(t => <th key={t.id} className="px-4 py-3.5 font-semibold">{t.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {classList.map(c => (
                <tr key={c.id} className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
                  <td className="px-6 py-3 font-semibold">{c.label} <span className="font-normal text-black/40 dark:text-white/40">· {c.boardCode}</span></td>
                  {termList.map(t => {
                    const s = byCell.get(`${c.id}|${t.id}`)
                    return (
                      <td key={t.id} className="px-4 py-3">
                        <button onClick={() => navigate(`/portal/finance/fee-structures/${c.id}/${t.id}`)} className={`rounded-xl px-3 py-1.5 text-left transition-colors ${s ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-200' : 'text-black/35 hover:bg-black/[.04] dark:text-white/35 dark:hover:bg-white/[.06]'}`}>
                          {s ? <><span className="font-semibold">{fmtINR(linesTotal(s.lines))}</span><span className="block text-[11.5px] opacity-70">{s.lines.length} line{s.lines.length === 1 ? '' : 's'} · due {fmtDate(s.dueDate)}</span></> : '+ Set'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function InvoicesTab() {
  const { classes, terms, currentYear, currentTerm, classOf, gradeById } = useAcademic()
  const { students, nameOf, classLabel } = useStudentLookup()
  const classList = useMemo(() => classes.filter(c => !currentYear || c.academicYearId === currentYear.id).sort(compareClasses(gradeById)), [classes, currentYear, gradeById])
  const [classId, setClassId] = useState('')
  const [termPick, setTermPick] = useState('')
  const termId = terms.some(t => t.id === termPick) ? termPick : (currentTerm?.id ?? '')
  const [status, setStatus] = useState('')
  const invoices = useInvoices({ classId, termId, status })
  const heads = useFeeHeads()
  const list = useMemo(() => [...(invoices.items ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.invoiceNo.localeCompare(b.invoiceNo)), [invoices.items])

  const [busy, setBusy] = useState<string | null>(null)
  const [concession, setConcession] = useState<{ inv: FeeInvoice; value: string } | null>(null)
  const saveConcession = async () => {
    if (!concession) return
    setBusy(concession.inv.id)
    try {
      await api.patch(`/fees/invoices/${concession.inv.id}`, { concession: num(concession.value) })
      setConcession(null); invoices.reload(); toast.success('Concession updated')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const waive = async (inv: FeeInvoice) => {
    if (!confirm(`Waive ${inv.invoiceNo} (${fmtINR(outstandingOf(inv))} outstanding) for ${nameOf(inv.studentId, inv.studentName)}?`)) return
    setBusy(inv.id)
    try { await api.patch(`/fees/invoices/${inv.id}`, { status: 'Waived' }); invoices.reload(); toast.success('Invoice waived') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  // ad-hoc invoice
  const [adhoc, setAdhoc] = useState(false)
  const [studentId, setStudentId] = useState('')
  const [adTerm, setAdTerm] = useState('')
  const [adDue, setAdDue] = useState(() => isoDate(new Date()))
  const [adLines, setAdLines] = useState<FeeStructureLine[]>([])
  const openAdhoc = () => { setStudentId(''); setAdTerm(termId); setAdDue(isoDate(new Date())); setAdLines([]); setAdhoc(true) }
  const createAdhoc = async () => {
    setBusy('adhoc')
    try {
      const lines = adLines.filter(l => l.amount > 0).map(l => ({ ...l, name: heads.items?.find(h => h.id === l.feeHeadId)?.name }))
      await api.post('/fees/invoices', { studentId, termId: adTerm, lines, dueDate: adDue })
      setAdhoc(false); invoices.reload(); toast.success(`Invoice raised for ${nameOf(studentId)}`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Class">
          <select value={classId} onChange={e => setClassId(e.target.value)} className={`${inputCls} w-auto min-w-[150px]`}>
            <option value="">All classes</option>
            {classList.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Term">
          <select value={termId} onChange={e => setTermPick(e.target.value)} className={`${inputCls} w-auto min-w-[150px]`}>
            <option value="">All terms</option>
            {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={status} onChange={e => setStatus(e.target.value)} className={`${inputCls} w-auto min-w-[150px]`}>
            <option value="">All statuses</option>
            {INVOICE_STATUSES.map(s => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}
          </select>
        </Field>
        <span className="flex-1" />
        <button onClick={openAdhoc} disabled={students.length === 0} className={primaryBtn}><Plus size={13} /> Ad-hoc invoice</button>
      </div>
      <Card className="p-0">
        {invoices.loading ? loadingRow('Loading invoices…')
          : invoices.error ? <div className="p-6"><Empty text={invoices.error} /></div>
          : list.length === 0 ? <div className="p-6"><Empty text="No invoices match — generate them from a fee structure." /></div>
          : list.map(inv => {
            const out = outstandingOf(inv)
            return (
              <div key={inv.id} className={rowCls}>
                <div className="min-w-56 flex-1">
                  <p className="text-[14.5px] font-semibold">{nameOf(inv.studentId, inv.studentName)} <span className="font-normal text-black/40 dark:text-white/40">· {classLabel(inv.studentId, inv.classLabel ?? classOf(inv.studentId)?.label)}</span></p>
                  <p className="text-[12.5px] text-black/45 dark:text-white/45">{inv.invoiceNo} · {invoiceLabel(inv)} · due {fmtDate(inv.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <div className="text-right">
                  <p className="text-[15px] font-bold">{fmtINR(payableOf(inv))}</p>
                  <p className="text-[12px] text-black/45 dark:text-white/45">{inv.concession > 0 ? `${fmtINR(inv.total)} − ${fmtINR(inv.concession)} · ` : ''}{out > 0 ? `${fmtINR(out)} outstanding` : `${fmtINR(paidOf(inv))} received`}</p>
                </div>
                <Pill tone={invoiceTone(inv.status)}>{STATUS_TEXT[inv.status]}</Pill>
                <div className="flex gap-2">
                  {isOutstanding(inv) && <button onClick={() => setConcession({ inv, value: String(inv.concession ?? 0) })} disabled={busy === inv.id} className={ghostBtn}>Concession</button>}
                  {isOutstanding(inv) && <button onClick={() => waive(inv)} disabled={busy === inv.id} className={ghostBtn}>Waive</button>}
                  <button onClick={() => invoiceReceipt(inv)} className={ghostBtn} title="Receipt / statement PDF"><Download size={13} /> PDF</button>
                </div>
              </div>
            )
          })}
      </Card>

      <Modal open={!!concession} onClose={() => setConcession(null)} title={concession ? `Concession · ${concession.inv.invoiceNo}` : 'Concession'}>
        {concession && (
          <div className="space-y-4">
            <p className="text-[13.5px] text-black/60 dark:text-white/60">{nameOf(concession.inv.studentId, concession.inv.studentName)} · invoice total {fmtINR(concession.inv.total)}</p>
            <Field label="Concession (₹)"><input type="number" min={0} max={concession.inv.total} value={concession.value} onChange={e => setConcession({ ...concession, value: e.target.value })} className={inputCls} autoFocus /></Field>
            <p className="text-[13px] font-semibold">Payable after concession: {fmtINR(Math.max(0, concession.inv.total - num(concession.value)))}</p>
            <button onClick={saveConcession} disabled={busy === concession.inv.id || num(concession.value) > concession.inv.total} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">Save concession</button>
          </div>
        )}
      </Modal>

      <Modal open={adhoc} onClose={() => setAdhoc(false)} title="Ad-hoc invoice">
        <div className="space-y-4">
          <AsyncEntityPicker label="Student" role="student" value={studentId} onChange={id => setStudentId(id)} placeholder="Search students by name or email…" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Term">
              <select value={adTerm} onChange={e => setAdTerm(e.target.value)} className={inputCls}>
                {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Due date"><input type="date" value={adDue} onChange={e => setAdDue(e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="Lines"><LinesEditor lines={adLines} heads={heads.items ?? []} onChange={setAdLines} /></Field>
          <button onClick={createAdhoc} disabled={busy === 'adhoc' || !studentId || !adTerm || !adDue || linesTotal(adLines) <= 0} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy === 'adhoc' ? 'Raising…' : 'Raise invoice'}</button>
        </div>
      </Modal>
    </>
  )
}

/* ── Staff: collections (counter payments) ─────────────── */

export function CollectionsMod() {
  const { students, classLabel, rollOf } = useStudentLookup()
  const [q, setQ] = useState('')
  const [pickedId, setPickedId] = useState('')
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return students.filter(u => u.name.toLowerCase().includes(s) || (rollOf(u.id) ?? '').toLowerCase() === s || classLabel(u.id).toLowerCase() === s || (u.email ?? '').toLowerCase().includes(s)).slice(0, 8)
  }, [q, students, classLabel, rollOf])
  const student = students.find(s => s.id === pickedId)
  const invoices = useInvoices({ studentId: pickedId }, !!pickedId)
  const payments = usePayments({ studentId: pickedId }, !!pickedId)
  const list = useMemo(() => [...(invoices.items ?? [])].sort((a, b) => (isOutstanding(a) === isOutstanding(b) ? a.dueDate.localeCompare(b.dueDate) : isOutstanding(a) ? -1 : 1)), [invoices.items])
  const paymentsOf = (inv: FeeInvoice) => inv.payments ?? (payments.items ?? []).filter(p => p.invoiceId === inv.id)
  const totalOut = list.reduce((a, inv) => a + outstandingOf(inv, payments.items), 0)

  const [pay, setPay] = useState<FeeInvoice | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('Cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastReceipt, setLastReceipt] = useState<Payment | null>(null)
  const openPay = (inv: FeeInvoice) => { setPay(inv); setAmount(String(outstandingOf(inv, payments.items))); setMethod('Cash'); setReference(''); setNote(''); setLastReceipt(null) }
  const record = async () => {
    if (!pay) return
    setBusy(true)
    try {
      const res = await api.post<{ item?: Payment } & Partial<Payment>>('/fees/payments', { invoiceId: pay.id, amount: num(amount), method, reference: reference.trim() || undefined, note: note.trim() || undefined })
      const p = (res?.item ?? res) as Payment
      invoices.reload(); payments.reload()
      toast.success(`${fmtINR(num(amount))} received${p?.receiptNo ? ` · ${p.receiptNo}` : ''}`)
      if (p?.id && p.receiptNo) setLastReceipt(p); else setPay(null)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const maxAmount = pay ? outstandingOf(pay, payments.items) : 0

  return (
    <div>
      <PageHead title="Collections" sub="Find a student, record a counter payment and print the receipt" />
      <Card className="mb-5">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-black/35 dark:text-white/35" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by student name, roll number, class or email…" className={`${inputCls} pl-11`} />
        </div>
        {q.trim() && (
          <div className="mt-3 divide-y divide-black/[.05] dark:divide-white/[.07] rounded-2xl border border-black/[.06] dark:border-white/[.08]">
            {matches.length === 0 && <p className="px-4 py-3 text-[13px] text-black/45 dark:text-white/45">No students match.</p>}
            {matches.map(s => (
              <button key={s.id} onClick={() => { setPickedId(s.id); setQ('') }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-black/[.03] dark:hover:bg-white/[.05]">
                <Avatar name={s.name} hue={s.avatarHue} size={30} />
                <span className="flex-1 text-[14px] font-medium">{s.name}</span>
                <span className="text-[12.5px] text-black/45 dark:text-white/45">{classLabel(s.id)}{rollOf(s.id) ? ` · Roll ${rollOf(s.id)}` : ''}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {!student ? <Empty text={students.length ? 'Search for a student to see their invoices.' : 'No students enrolled yet.'} /> : (
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-4 border-b border-black/[.06] dark:border-white/[.08] px-6 py-4">
            <Avatar name={student.name} hue={student.avatarHue} size={40} />
            <div className="flex-1">
              <p className="text-[15px] font-semibold">{student.name}</p>
              <p className="text-[12.5px] text-black/45 dark:text-white/45">{classLabel(student.id)}{rollOf(student.id) ? ` · Roll ${rollOf(student.id)}` : ''}</p>
            </div>
            <Pill tone={totalOut > 0 ? 'rose' : 'green'}>{totalOut > 0 ? `${fmtINR(totalOut)} outstanding` : 'Nothing outstanding'}</Pill>
          </div>
          {invoices.loading ? loadingRow('Loading invoices…')
            : invoices.error ? <div className="p-6"><Empty text={invoices.error} /></div>
            : list.length === 0 ? <div className="p-6"><Empty text="No invoices for this student yet." /></div>
            : list.map(inv => {
              const out = outstandingOf(inv, payments.items)
              const ps = paymentsOf(inv)
              return (
                <div key={inv.id} className="border-b border-black/[.05] dark:border-white/[.07] px-6 py-4 last:border-0">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="min-w-48 flex-1">
                      <p className="text-[14.5px] font-semibold">{invoiceLabel(inv)}</p>
                      <p className="text-[12.5px] text-black/45 dark:text-white/45">{inv.invoiceNo} · due {fmtDate(inv.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[15px] font-bold">{fmtINR(payableOf(inv))}</p>
                      {out > 0 && <p className="text-[12px] text-rose-500">{fmtINR(out)} outstanding</p>}
                    </div>
                    <Pill tone={invoiceTone(inv.status)}>{STATUS_TEXT[inv.status]}</Pill>
                    {isOutstanding(inv) && <button onClick={() => openPay(inv)} className={primaryBtn}><Banknote size={13} /> Record payment</button>}
                  </div>
                  {ps.length > 0 && (
                    <div className="mt-3 space-y-1.5 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3 text-[12.5px]">
                      {ps.map(p => (
                        <div key={p.id} className="flex flex-wrap items-center gap-2">
                          <Receipt size={12} className="text-emerald-600" />
                          <span className="font-semibold">{fmtINR(p.amount)}</span>
                          <span className="text-black/50 dark:text-white/50">{METHOD_LABEL[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ''} · {fmtDate(p.paidAt, { day: 'numeric', month: 'short', year: 'numeric' })} · {p.receiptNo}</span>
                          <span className="flex-1" />
                          <button onClick={() => paymentReceipt(p)} className="flex items-center gap-1 font-semibold text-indigo-600 hover:underline"><Download size={11} /> Receipt</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
        </Card>
      )}

      <Modal open={!!pay} onClose={() => { if (!busy) setPay(null) }} title={pay ? `Record payment · ${pay.invoiceNo}` : 'Record payment'}>
        {pay && lastReceipt ? (
          <div className="flex flex-col items-center py-4 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check size={28} /></span>
            <p className="mt-4 text-[16px] font-semibold">{fmtINR(lastReceipt.amount)} received</p>
            <p className="mt-1 text-[13px] text-black/50 dark:text-white/50">Receipt {lastReceipt.receiptNo}</p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => paymentReceipt(lastReceipt)} className={primaryBtn}><Download size={13} /> Print receipt</button>
              <button onClick={() => setPay(null)} className={ghostBtn}>Done</button>
            </div>
          </div>
        ) : pay && (
          <div className="space-y-4">
            <p className="text-[13.5px] text-black/60 dark:text-white/60">{student?.name} · {invoiceLabel(pay)} · {fmtINR(maxAmount)} outstanding</p>
            <Field label="Amount (₹)"><input type="number" min={1} max={maxAmount} value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} autoFocus /></Field>
            <Field label="Method">
              <div className="flex flex-wrap gap-2">
                {PAYMENT_METHODS.map(m => (
                  <button key={m} onClick={() => setMethod(m)} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${method === m ? 'bg-black text-white' : 'bg-black/[.05] dark:bg-white/[.07] text-black/60 dark:text-white/60'}`}>{METHOD_LABEL[m]}</button>
                ))}
              </div>
            </Field>
            <Field label={method === 'Cheque' ? 'Cheque number' : method === 'Cash' ? 'Reference (optional)' : 'Transaction reference'}>
              <input value={reference} onChange={e => setReference(e.target.value)} placeholder={method === 'Cheque' ? 'e.g. 004512 · HDFC' : 'e.g. UTR / transaction id'} className={inputCls} />
            </Field>
            <Field label="Note (optional)"><input value={note} onChange={e => setNote(e.target.value)} className={inputCls} /></Field>
            <button onClick={record} disabled={busy || num(amount) <= 0 || num(amount) > maxAmount} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy ? 'Recording…' : `Record ${fmtINR(num(amount))}`}</button>
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ── Admin: payroll ────────────────────────────────────── */

function ComponentsEditor({ label, items, onChange }: { label: string; items: SalaryComponent[]; onChange: (c: SalaryComponent[]) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-[12.5px] font-semibold text-black/60 dark:text-white/60">{label} <span className="font-normal text-black/40 dark:text-white/40">· {fmtINR(sumComponents(items))}</span></p>
      <div className="space-y-1.5">
        {items.map((c, i) => (
          <div key={i} className="flex gap-2">
            <input value={c.name} onChange={e => onChange(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" className={`${inputCls} flex-1 py-1.5 text-[13px]`} />
            <input type="number" min={0} value={c.amount} onChange={e => onChange(items.map((x, j) => (j === i ? { ...x, amount: num(e.target.value) } : x)))} className={`${inputCls} w-28 py-1.5 text-[13px]`} />
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="rounded-full p-1.5 text-black/40 hover:text-rose-500 dark:text-white/40" aria-label="Remove"><X size={13} /></button>
          </div>
        ))}
        <button onClick={() => onChange([...items, { name: '', amount: 0 }])} className="text-[12.5px] font-semibold text-indigo-600 hover:underline">+ Add {label.toLowerCase()}</button>
      </div>
    </div>
  )
}

function StructureRow({ user, structure, onSaved }: { user: User; structure?: SalaryStructure; onSaved: (s: SalaryStructure) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<{ basic: number; allowances: SalaryComponent[]; deductions: SalaryComponent[]; effectiveFrom: string }>({ basic: 0, allowances: [], deductions: [], effectiveFrom: '' })
  const [busy, setBusy] = useState(false)
  const start = () => {
    setDraft({
      basic: structure?.basic ?? 0,
      allowances: structure?.allowances.map(c => ({ ...c })) ?? [],
      deductions: structure?.deductions.map(c => ({ ...c })) ?? [],
      effectiveFrom: structure?.effectiveFrom ?? user.joinDate ?? isoDate(new Date()),
    })
    setEditing(true)
  }
  const save = async () => {
    setBusy(true)
    try {
      const body = { ...draft, allowances: draft.allowances.filter(c => c.name.trim()), deductions: draft.deductions.filter(c => c.name.trim()) }
      const res = await api.put<{ item?: SalaryStructure } & Partial<SalaryStructure>>(`/payroll/structures/${user.id}`, body)
      const saved = (res?.item ?? res) as SalaryStructure
      onSaved({ id: saved?.id ?? structure?.id ?? user.id, userId: user.id, ...body, ...(saved && 'basic' in saved ? saved : {}) })
      setEditing(false); toast.success(`Salary structure saved for ${user.name}`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="border-b border-black/[.05] dark:border-white/[.07] last:border-0">
      <div className="flex flex-wrap items-center gap-4 px-6 py-3.5">
        <Avatar name={user.name} hue={user.avatarHue} size={34} />
        <div className="min-w-40 flex-1">
          <p className="text-[14.5px] font-semibold">{user.name}</p>
          <p className="text-[12.5px] text-black/45 dark:text-white/45">{user.designation || user.role}{user.department ? ` · ${user.department}` : ''}</p>
        </div>
        {structure ? (
          <>
            <div className="text-right text-[12.5px] text-black/45 dark:text-white/45"><p>Basic {fmtINR(structure.basic)}</p><p>+{fmtINR(sumComponents(structure.allowances))} − {fmtINR(sumComponents(structure.deductions))}</p></div>
            <p className="w-28 text-right text-[15px] font-bold">{fmtINR(netOf(structure))}</p>
            <span className="text-[12px] text-black/40 dark:text-white/40">from {fmtDate(structure.effectiveFrom)}</span>
          </>
        ) : <Pill tone="amber">No structure</Pill>}
        <button onClick={editing ? () => setEditing(false) : start} className={ghostBtn}>{editing ? <><X size={12} /> Cancel</> : <><Pencil size={12} /> {structure ? 'Edit' : 'Set up'}</>}</button>
      </div>
      {editing && (
        <div className="mx-6 mb-4 grid gap-4 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-4 md:grid-cols-2">
          <Field label="Basic (₹ / month)"><input type="number" min={0} value={draft.basic} onChange={e => setDraft({ ...draft, basic: num(e.target.value) })} className={`${inputCls} py-2`} /></Field>
          <Field label="Effective from"><input type="date" value={draft.effectiveFrom} onChange={e => setDraft({ ...draft, effectiveFrom: e.target.value })} className={`${inputCls} py-2`} /></Field>
          <ComponentsEditor label="Allowances" items={draft.allowances} onChange={allowances => setDraft({ ...draft, allowances })} />
          <ComponentsEditor label="Deductions" items={draft.deductions} onChange={deductions => setDraft({ ...draft, deductions })} />
          <div className="flex items-center justify-between md:col-span-2">
            <p className="text-[14px] font-semibold">Net {fmtINR(netOf(draft))}</p>
            <button onClick={save} disabled={busy || draft.basic <= 0 || !draft.effectiveFrom} className={primaryBtn}><Check size={13} /> {busy ? 'Saving…' : 'Save structure'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function PayslipRow({ slip, name, canPay, onChanged }: { slip: Payslip; name: string; canPay: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const markPaid = async () => {
    setBusy(true)
    try { await api.patch(`/payroll/payslips/${slip.id}/mark-paid`, {}); onChanged(); toast.success(`${name} · ${fmtMonth(slip.month)} marked paid`) }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className={rowCls}>
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${slip.status === 'Paid' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}><FileText size={18} /></span>
      <div className="min-w-44 flex-1">
        <p className="text-[14.5px] font-semibold">{name} <span className="font-normal text-black/40 dark:text-white/40">· {fmtMonth(slip.month)}</span></p>
        <p className="text-[12.5px] text-black/45 dark:text-white/45">{slip.slipNo} · basic {fmtINR(slip.basic)} · gross {fmtINR(slip.gross)}{slip.paidAt ? ` · paid ${fmtDate(slip.paidAt, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</p>
      </div>
      <p className="text-[15px] font-bold">{fmtINR(slip.net)}</p>
      <Pill tone={slip.status === 'Paid' ? 'green' : 'amber'}>{slip.status}</Pill>
      <div className="flex gap-2">
        {canPay && slip.status !== 'Paid' && <button onClick={markPaid} disabled={busy} className={primaryBtn}><Check size={13} /> Mark paid</button>}
        <button onClick={() => payslipPdf(slip)} className={ghostBtn}><Download size={13} /> PDF</button>
      </div>
    </div>
  )
}

export function PayrollMod() {
  const { user } = useStore()
  const employees = useEmployees()
  const [tab, setTab] = useState<'structures' | 'payslips'>('structures')
  const ids = useMemo(() => employees.map(e => e.id), [employees])
  const structures = useSalaryStructures(ids)
  // Saves land here so the table updates without re-fetching every employee.
  const [saved, setSaved] = useState<Record<string, SalaryStructure>>({})
  const structureOf = (id: string) => saved[id] ?? structures.byUser.get(id)
  const withStructure = employees.filter(e => structureOf(e.id)).length
  const monthly = employees.reduce((a, e) => { const s = structureOf(e.id); return a + (s ? netOf(s) : 0) }, 0)

  const [month, setMonth] = useState(() => monthKey())
  const payslips = usePayslips({ month }, tab === 'payslips')
  const [running, setRunning] = useState(false)
  const run = async () => {
    if (!confirm(`Run payroll for ${fmtMonth(month)}? A payslip is generated for every employee with a salary structure; existing ones are kept.`)) return
    setRunning(true)
    try {
      const res = await api.post<{ created?: number; skipped?: number; items?: unknown[] }>('/payroll/run', { month })
      const created = res?.created ?? res?.items?.length ?? 0
      toast.success(`Payroll run for ${fmtMonth(month)} · ${created} payslip${created === 1 ? '' : 's'} generated${res?.skipped ? ` · ${res.skipped} already existed` : ''}`)
      payslips.reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setRunning(false) }
  }
  const nameOf = (id: string, fallback?: string) => fallback ?? employees.find(e => e.id === id)?.name ?? 'Employee'
  const slips = useMemo(() => [...(payslips.items ?? [])].sort((a, b) => a.status.localeCompare(b.status) || nameOf(a.userId, a.userName).localeCompare(nameOf(b.userId, b.userName))), [payslips.items]) // eslint-disable-line react-hooks/exhaustive-deps
  const netTotal = slips.reduce((a, s) => a + s.net, 0)

  return (
    <div>
      <PageHead title="Payroll" sub={tab === 'structures' ? 'Salary structures per employee — basic, allowances and deductions' : 'Run a month, review payslips and mark them paid'}>
        <SegTabs value={tab} onChange={setTab} options={[{ id: 'structures', label: 'Structures' }, { id: 'payslips', label: 'Payslips' }]} />
      </PageHead>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatTile icon={<Wallet size={20} className="text-indigo-600" />} tint="bg-indigo-50" label="Employees" value={`${withStructure} / ${employees.length}`} />
        <StatTile icon={<Banknote size={20} className="text-emerald-600" />} tint="bg-emerald-50" label="Monthly net payroll" value={fmtINR(monthly)} />
        <StatTile icon={<FileText size={20} className="text-amber-600" />} tint="bg-amber-50" label={tab === 'payslips' ? `Net · ${fmtMonth(month)}` : 'Without structure'} value={tab === 'payslips' ? fmtINR(netTotal) : String(employees.length - withStructure)} />
      </div>

      {tab === 'structures' ? (
        <Card className="p-0">
          {employees.length === 0 ? <div className="p-6"><Empty text="No teachers, staff or admins yet — onboard them in People & Roles." /></div>
            : structures.loading && Object.keys(saved).length === 0 ? loadingRow('Loading salary structures…')
            : employees.map(e => <StructureRow key={e.id} user={e} structure={structureOf(e.id)} onSaved={s => setSaved(prev => ({ ...prev, [e.id]: s }))} />)}
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-end gap-3">
            <Field label="Month"><input type="month" value={month} onChange={e => setMonth(e.target.value)} className={`${inputCls} w-auto`} /></Field>
            <span className="flex-1" />
            <button onClick={run} disabled={running || !month} className={primaryBtn}><Play size={13} /> {running ? 'Running…' : `Run ${fmtMonth(month)}`}</button>
          </div>
          <Card className="p-0">
            {payslips.loading ? loadingRow('Loading payslips…')
              : payslips.error ? <div className="p-6"><Empty text={payslips.error} /></div>
              : slips.length === 0 ? <div className="p-6"><Empty text={`No payslips for ${fmtMonth(month)} yet — run the month to generate them.`} /></div>
              : slips.map(s => <PayslipRow key={s.id} slip={s} name={nameOf(s.userId, s.userName)} canPay={isAdmin(user)} onChanged={payslips.reload} />)}
          </Card>
        </>
      )}
    </div>
  )
}

/* ── Employee: my payslips ─────────────────────────────── */

export function MyPayslipsMod() {
  const { user } = useStore()
  const payslips = usePayslips({ userId: user?.id }, !!user)
  const slips = useMemo(() => [...(payslips.items ?? [])].sort((a, b) => b.month.localeCompare(a.month)), [payslips.items])
  const year = monthKey().slice(0, 4)
  const paidThisYear = slips.filter(s => s.status === 'Paid' && s.month.startsWith(year)).reduce((a, s) => a + s.net, 0)
  const latest = slips[0]
  useEffect(() => { /* keep the list fresh when the tab regains focus after payroll is run */
    const fn = () => document.visibilityState === 'visible' && payslips.reload()
    document.addEventListener('visibilitychange', fn)
    return () => document.removeEventListener('visibilitychange', fn)
  }, [payslips.reload]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHead title="My Payslips" sub="Monthly salary slips — download the PDF any time" />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatTile icon={<Wallet size={20} className="text-indigo-600" />} tint="bg-indigo-50" label="Latest net" value={latest ? fmtINR(latest.net) : '—'} />
        <StatTile icon={<Banknote size={20} className="text-emerald-600" />} tint="bg-emerald-50" label={`Paid in ${year}`} value={fmtINR(paidThisYear)} />
        <StatTile icon={<FileText size={20} className="text-amber-600" />} tint="bg-amber-50" label="Payslips" value={String(slips.length)} />
      </div>
      <Card className="p-0">
        {payslips.loading ? loadingRow('Loading payslips…')
          : payslips.error ? <div className="p-6"><Empty text={payslips.error} /></div>
          : slips.length === 0 ? <div className="p-6"><Empty text="No payslips yet — they appear here once payroll is run." /></div>
          : slips.map(s => <PayslipRow key={s.id} slip={s} name={user?.name ?? 'Me'} canPay={false} onChanged={payslips.reload} />)}
      </Card>
    </div>
  )
}

/* ── shared with actions.tsx: invoice list for a viewer ── */

/** Read-only invoice + receipt list for a student (parent/student "Payments & Receipts"). */
export function StudentInvoiceList({ studentId, termId }: { studentId?: string; termId?: string }) {
  const invoices = useInvoices({ studentId, termId }, !!studentId)
  const payments = usePayments({ studentId }, !!studentId)
  const list = useMemo(() => [...(invoices.items ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [invoices.items])
  const paid = list.reduce((a, inv) => a + paidOf(inv, payments.items), 0)
  const due = list.reduce((a, inv) => a + outstandingOf(inv, payments.items), 0)
  const statusOf = (s: InvoiceStatus) => STATUS_TEXT[s]
  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatTile icon={<Wallet size={20} className="text-indigo-600" />} tint="bg-indigo-50" label="Invoiced" value={fmtINR(list.reduce((a, inv) => a + payableOf(inv), 0))} />
        <StatTile icon={<Check size={20} className="text-emerald-600" />} tint="bg-emerald-50" label="Paid" value={fmtINR(paid)} />
        <StatTile icon={<Receipt size={20} className="text-amber-600" />} tint="bg-amber-50" label="Due" value={fmtINR(due)} />
      </div>
      <Card className="p-0">
        {!studentId ? <div className="p-6"><Empty text="No student is linked to your account yet." /></div>
          : invoices.loading ? loadingRow('Loading invoices…')
          : invoices.error ? <div className="p-6"><Empty text={invoices.error} /></div>
          : list.length === 0 ? <div className="p-6"><Empty text="No invoices for this term." /></div>
          : list.map(inv => {
            const ps = inv.payments ?? (payments.items ?? []).filter(p => p.invoiceId === inv.id)
            return (
              <div key={inv.id} className="border-b border-black/[.05] dark:border-white/[.07] px-6 py-4 last:border-0">
                <div className="flex flex-wrap items-center gap-4">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${inv.status === 'Paid' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}><Receipt size={18} /></span>
                  <div className="min-w-48 flex-1">
                    <p className="text-[14.5px] font-semibold">{invoiceLabel(inv)}</p>
                    <p className="text-[12.5px] text-black/45 dark:text-white/45">{inv.invoiceNo} · due {fmtDate(inv.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </div>
                  <p className="text-[15px] font-bold">{fmtINR(payableOf(inv))}</p>
                  <Pill tone={invoiceTone(inv.status)}>{statusOf(inv.status)}</Pill>
                  <button onClick={() => invoiceReceipt(inv)} className={ghostBtn}><Download size={13} /> Statement</button>
                </div>
                {ps.length > 0 && (
                  <div className="mt-3 space-y-1.5 rounded-2xl bg-black/[.03] dark:bg-white/[.05] p-3 text-[12.5px]">
                    {ps.map(p => (
                      <div key={p.id} className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{fmtINR(p.amount)}</span>
                        <span className="text-black/50 dark:text-white/50">{METHOD_LABEL[p.method] ?? p.method} · {fmtDate(p.paidAt, { day: 'numeric', month: 'short', year: 'numeric' })} · {p.receiptNo}</span>
                        <span className="flex-1" />
                        <button onClick={() => paymentReceipt(p)} className="flex items-center gap-1 font-semibold text-indigo-600 hover:underline"><Download size={11} /> Receipt</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
      </Card>
    </>
  )
}
