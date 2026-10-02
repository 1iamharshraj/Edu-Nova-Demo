import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { FileSpreadsheet, Plus, Upload } from 'lucide-react'
import { Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '@/portal/ui'
import {
  LEAD_SOURCES, LEAD_STATUSES, type LeadSource,
  createLead, errorMessage, importLeadsFromRows, importLeadsFromSheet, leadStatusTone,
  parseLeadsCsv, updateLeadStatus, useLeads, useLeadsSummary,
} from '@/lib/hooks/useLeads'
import { toast } from 'sonner'

const ghostBtn = 'rounded-xl border border-black/10 dark:border-white/15 px-4 py-2 text-[13.5px] font-semibold hover:bg-black/[.03] dark:hover:bg-white/[.06]'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/* ── Summary strip ─────────────────────────────────────── */
function SummaryStrip() {
  const { data } = useLeadsSummary()
  if (!data) return null
  const tiles: Array<{ label: string; value: number }> = [
    { label: 'Total leads', value: data.total },
    { label: 'New this week', value: data.newThisWeek },
    { label: 'Enrolled', value: data.byStatus['Enrolled'] ?? 0 },
    { label: 'Trial pending', value: (data.byStatus['Trial Scheduled'] ?? 0) + (data.byStatus['Trial Attended'] ?? 0) },
  ]
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map(t => (
        <Card key={t.label} className="p-4">
          <p className="text-[24px] font-bold tabular-nums">{t.value}</p>
          <p className="text-[12.5px] text-black/50 dark:text-white/50">{t.label}</p>
        </Card>
      ))}
    </div>
  )
}

/* ── Add Lead modal ────────────────────────────────────── */
function AddLeadModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'Website' as LeadSource, campaign: '', interestedCourse: '' })
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!form.name.trim() || !form.phone.trim()) return
    setBusy(true)
    try {
      await createLead({ ...form, email: form.email || undefined, campaign: form.campaign || undefined })
      toast.success('Lead added')
      setForm({ name: '', phone: '', email: '', source: 'Website', campaign: '', interestedCourse: '' })
      onCreated()
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a lead">
      <div className="space-y-3">
        <Field label="Name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Phone"><input className={inputCls} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Email (optional)"><input className={inputCls} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Source">
          <select className={inputCls} value={form.source} onChange={e => setForm({ ...form, source: e.target.value as LeadSource })}>
            {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        {(form.source === 'Google Ads' || form.source === 'Facebook/Instagram Ads') && (
          <Field label="Campaign name"><input className={inputCls} value={form.campaign} onChange={e => setForm({ ...form, campaign: e.target.value })} placeholder="e.g. JEE_Main_2027_Search_Bangalore" /></Field>
        )}
        <Field label="Interested course / batch"><input className={inputCls} value={form.interestedCourse} onChange={e => setForm({ ...form, interestedCourse: e.target.value })} placeholder="e.g. JEE Main 2027 — Batch A" /></Field>
        <button onClick={submit} disabled={busy || !form.name.trim() || !form.phone.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
          {busy ? 'Adding…' : 'Add lead'}
        </button>
      </div>
    </Modal>
  )
}

/* ── Import Leads modal (CSV upload/paste — real; Google Sheet URL — simulated, clearly labeled) ── */
function ImportLeadsModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [tab, setTab] = useState<'csv' | 'sheet'>('csv')
  const [csvText, setCsvText] = useState('')
  const [sheetUrl, setSheetUrl] = useState('')
  const [batchLabel, setBatchLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setCsvText(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  const submitCsv = async () => {
    const rows = parseLeadsCsv(csvText)
    if (!rows.length) { toast.error('No valid rows found — expected columns: name, phone, email, interestedCourse'); return }
    setBusy(true)
    try {
      const res = await importLeadsFromRows(rows, batchLabel || undefined)
      toast.success(`Imported ${res.imported} leads`)
      setCsvText(''); onImported(); onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const submitSheet = async () => {
    if (!sheetUrl.trim()) return
    setBusy(true)
    try {
      const res = await importLeadsFromSheet(sheetUrl.trim(), batchLabel || undefined)
      toast.success(res.simulated
        ? `Simulated import from this Google Sheet — ${res.imported} leads added (demo mode: no live Sheets connection)`
        : `Imported ${res.imported} leads`)
      setSheetUrl(''); onImported(); onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Import leads" wide>
      <div className="mb-4 flex gap-2">
        <button onClick={() => setTab('csv')} className={`rounded-xl px-3 py-1.5 text-[13px] font-semibold ${tab === 'csv' ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/10 dark:border-white/15'}`}>CSV upload / paste</button>
        <button onClick={() => setTab('sheet')} className={`rounded-xl px-3 py-1.5 text-[13px] font-semibold ${tab === 'sheet' ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/10 dark:border-white/15'}`}>Google Sheet link</button>
      </div>

      <Field label="Import batch label (optional)"><input className={inputCls} value={batchLabel} onChange={e => setBatchLabel(e.target.value)} placeholder="e.g. edu-expo-oct-2026" /></Field>

      {tab === 'csv' ? (
        <div className="mt-3 space-y-3">
          <p className="text-[12.5px] text-black/50 dark:text-white/50">Columns: <code>name, phone, email, interestedCourse</code> — header row optional. Upload a file exported from Google Sheets (File → Download → CSV), or paste rows directly.</p>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-black/15 dark:border-white/20 py-6 text-[13.5px] font-medium text-black/50 dark:text-white/50 hover:border-indigo-300">
            <Upload size={16} /> Choose a .csv file
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
          </label>
          <textarea className={`${inputCls} h-32 font-mono text-[12.5px]`} value={csvText} onChange={e => setCsvText(e.target.value)}
            placeholder={'name,phone,email,interestedCourse\nIshaan Verma,+91 90001 11111,ishaan@gmail.com,JEE Main 2027 — Batch A'} />
          <button onClick={submitCsv} disabled={busy || !csvText.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
            {busy ? 'Importing…' : 'Import from CSV'}
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-[12.5px] text-black/50 dark:text-white/50">
            Paste a Google Sheet link (shared as "Anyone with the link can view"). <strong>Demo mode:</strong> this environment has no live backend to fetch the sheet, so a realistic sample batch is used to show the import flow — the sheet URL itself is still recorded against the lead batch.
          </p>
          <Field label="Google Sheet URL"><input className={inputCls} value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." /></Field>
          <button onClick={submitSheet} disabled={busy || !sheetUrl.trim()} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">
            <FileSpreadsheet size={15} className="mr-1.5 inline" /> {busy ? 'Importing…' : 'Import from Google Sheet'}
          </button>
        </div>
      )}
    </Modal>
  )
}

/* ── Main pipeline view ────────────────────────────────── */
export function LeadsMod() {
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [q, setQ] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const { items, reload } = useLeads({ status: statusFilter || undefined, source: sourceFilter || undefined, q: q.trim() || undefined })
  const leads = useMemo(() => items ?? [], [items])

  const quickStatus = async (id: string, next: string) => {
    try {
      await updateLeadStatus(id, next as never)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div>
      <PageHead title="Leads" sub="Every enquiry — online, offline, paid ads, or imported from a Google Sheet — tracked through one pipeline.">
        <div className="flex gap-2">
          <button onClick={() => setImportOpen(true)} className={ghostBtn}><Upload size={14} className="mr-1.5 inline" />Import</button>
          <button onClick={() => setAddOpen(true)} className="btn-ink px-4 py-2 text-[13.5px] font-semibold"><Plus size={14} className="mr-1.5 inline" />Add lead</button>
        </div>
      </PageHead>

      <SummaryStrip />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-xs`} placeholder="Search name, phone, email…" value={q} onChange={e => setQ(e.target.value)} />
        <select className={inputCls} value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={inputCls} value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">All sources</option>
          {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {leads.length === 0 && <Empty text="No leads match these filters." />}

      <div className="space-y-2">
        {leads.map(l => (
          <Card key={l.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link to={`/portal/leads/${l.id}`} className="text-[14.5px] font-semibold hover:underline">{l.name}</Link>
                  <Pill tone={leadStatusTone(l.status)}>{l.status}</Pill>
                </div>
                <p className="mt-0.5 text-[12.5px] text-black/50 dark:text-white/50">
                  {l.phone}{l.email ? ` · ${l.email}` : ''} · {l.interestedCourse || 'No course specified'}
                </p>
                <p className="mt-0.5 text-[12px] text-black/40 dark:text-white/40">
                  {l.source}{l.campaign ? ` · ${l.campaign}` : ''}{l.importBatch ? ` · batch: ${l.importBatch}` : ''} · {fmtDate(l.createdAt)}
                  {l.assignedToName ? ` · assigned to ${l.assignedToName}` : ''}
                </p>
              </div>
              <select className={`${inputCls} py-1.5`} style={{ maxWidth: 170 }} value={l.status} onChange={e => quickStatus(l.id, e.target.value)}>
                {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </Card>
        ))}
      </div>

      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={reload} />
      <ImportLeadsModal open={importOpen} onClose={() => setImportOpen(false)} onImported={reload} />
    </div>
  )
}
