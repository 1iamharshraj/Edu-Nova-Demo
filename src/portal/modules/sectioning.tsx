import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, ChevronDown, ChevronUp, History, ShieldAlert, Trash2, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAcademic, useStore } from '@/lib/store'
import { ApiError, errorMessage } from '@/lib/api'
import type {
  ActivityRec, EnforcementMode, PerformanceBand, SectioningDistributionConfig, SectioningScoreSource, SectioningStrategy,
  SectioningTemplate, SubjectScoreRule, TrackEligibilityRule,
} from '@/lib/data'
import {
  ENFORCEMENT_MODES, SCORE_SOURCES, SECTIONING_STRATEGIES, registerForTrack, useBandActions, useBands, useEligibilityExceptions,
  useRuleActions, useTemplateActions, useTemplateVersions, useTemplates, useTrackRules,
} from '@/lib/hooks/useSectioning'
import { ACTIVITY_KIND_LABEL, useActivities } from '@/lib/hooks/useWelfare'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, inputCls } from '../ui'
import { AsyncEntityPicker } from '../components/AsyncEntityPicker'
import { ConfirmModal, FormActions, HeaderAdd } from './academic'
import { dangerBtn, ghostBtn, iconBtn, muted, sectionLabel } from './academicShared'

// Phase T3 — Sectioning Engine. See .agents/edunova/phase-t3-sectioning-engine.md. Bands (§1), Templates
// (§2) and Track Eligibility (§3) are configuration screens (this file); the draft-review-before-approve
// screen (§4) is dense and stateful enough to warrant its own routed page — see
// src/pages/portal/SectioningDraftReview.tsx, opened from a template's "Run" action here.

const rowCls = 'flex items-center gap-3 border-b border-black/[.05] dark:border-white/[.07] px-6 py-3.5 last:border-0'
const cardHead = 'flex items-center justify-between gap-3 border-b border-black/[.06] dark:border-white/[.08] px-6 py-3'
const smallInput = inputCls + ' py-1.5 text-[13px]'

function YearGradeBar({ years, yearId, setYearId, gradeId, setGradeId, grades }: {
  years: { id: string; label: string; isCurrent?: boolean }[]; yearId: string; setYearId: (id: string) => void
  gradeId: string; setGradeId: (id: string) => void; grades: { id: string; label: string }[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={yearId} onChange={e => setYearId(e.target.value)} className={inputCls + ' w-auto min-w-[150px]'}>
        {years.map(y => <option key={y.id} value={y.id}>{y.label}{y.isCurrent ? ' · current' : ''}</option>)}
      </select>
      <select value={gradeId} onChange={e => setGradeId(e.target.value)} className={inputCls + ' w-auto min-w-[130px]'}>
        <option value="">All grades</option>
        {grades.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
      </select>
    </div>
  )
}

/* ── §1 Performance Bands ───────────────────────────────── */

interface BandForm { label: string; minScore: string; maxScore: string }
const emptyBandForm = (): BandForm => ({ label: '', minScore: '', maxScore: '' })

export function PerformanceBandsMod() {
  const { years, currentYear } = useAcademic()
  const sortedYears = useMemo(() => [...years].sort((a, b) => b.label.localeCompare(a.label)), [years])
  const [pickedYearId, setYearId] = useState('')
  const yearId = sortedYears.some(y => y.id === pickedYearId) ? pickedYearId : (currentYear?.id ?? sortedYears[0]?.id ?? '')
  const { items, loading, reload } = useBands(yearId, !!yearId)
  const bandActions = useBandActions()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PerformanceBand | null>(null)
  const [form, setForm] = useState<BandForm>(emptyBandForm)
  const openAdd = () => { setEditing(null); setForm(emptyBandForm()); setFormOpen(true) }
  const openEdit = (b: PerformanceBand) => { setEditing(b); setForm({ label: b.label, minScore: String(b.minScore), maxScore: String(b.maxScore) }); setFormOpen(true) }
  const valid = form.label.trim() && form.minScore !== '' && form.maxScore !== '' && Number(form.maxScore) >= Number(form.minScore)
  const save = async () => {
    const body = { label: form.label.trim(), minScore: Number(form.minScore), maxScore: Number(form.maxScore) }
    const out = editing ? await bandActions.update(editing.id, body) : await bandActions.create({ academicYearId: yearId, ...body })
    if (out) { setFormOpen(false); reload() }
  }
  const [del, setDel] = useState<PerformanceBand | null>(null)

  const rows = (items ?? []).slice().sort((a, b) => a.minScore - b.minScore)

  return (
    <div>
      <PageHead title="Performance Bands" sub="Neutral score bands per academic year — never surfaced to families as 'slow/average/topper', just A/B/C style labels used to mix sections.">
        {sortedYears.length > 0 && (
          <select value={yearId} onChange={e => setYearId(e.target.value)} className={inputCls + ' w-auto min-w-[150px]'}>
            {sortedYears.map(y => <option key={y.id} value={y.id}>{y.label}{y.isCurrent ? ' · current' : ''}</option>)}
          </select>
        )}
      </PageHead>

      {sortedYears.length === 0 ? <Empty text="Create an academic year first." /> : (
        <Card className="p-0">
          <div className={cardHead}>
            <div>
              <p className={sectionLabel}>Bands · {sortedYears.find(y => y.id === yearId)?.label}</p>
              <p className={muted}>A template picks which of these bands drive its section mix.</p>
            </div>
            <HeaderAdd label="Add band" onClick={openAdd} />
          </div>
          {loading ? <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>
            : rows.length === 0 ? <div className="p-6"><Empty text="No bands defined yet." /></div>
            : rows.map(b => (
              <div key={b.id} className={rowCls}>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">{b.label}</p>
                  <p className={muted}>{b.minScore}–{b.maxScore}%</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => openEdit(b)} className={ghostBtn}>Edit</button>
                  <button onClick={() => setDel(b)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
        </Card>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.label}` : 'New performance band'}>
        <div className="space-y-4">
          <Field label="Label"><input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="e.g. Band A" className={inputCls} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min score (%)"><input type="number" min={0} max={100} value={form.minScore} onChange={e => setForm({ ...form, minScore: e.target.value })} className={inputCls} /></Field>
            <Field label="Max score (%)"><input type="number" min={0} max={100} value={form.maxScore} onChange={e => setForm({ ...form, maxScore: e.target.value })} className={inputCls} /></Field>
          </div>
          <FormActions onCancel={() => setFormOpen(false)} onSave={save} label={editing ? 'Save changes' : 'Create band'} disabled={!valid || bandActions.busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.label ?? 'band'}?`}
        body="Any template still referencing this band should be updated — future runs of it will simply drop the missing band from its mix."
        action="Delete band" busy={bandActions.busy}
        onConfirm={async () => { if (del && await bandActions.remove(del.id)) { setDel(null); reload() } }} />
    </div>
  )
}

/* ── §2 Sectioning Templates ────────────────────────────── */

interface SkimRow { sectionId: string; mode: 'count' | 'percentage'; value: string }
interface TemplateForm {
  name: string; gradeId: string; strategy: SectioningStrategy; scoreSource: SectioningScoreSource
  bandIds: string[]; sectionOrder: string[]; respectExisting: boolean
  tolerancePct: string; siblingsTogether: boolean
  broadGroups: string
  caps: Record<string, Record<string, string>> // [cohortId][bandLabel] = max
  skim: SkimRow[]; remainderStrategy: SectioningStrategy
  subjectWeights: { subjectId: string; weight: string }[]
}
const emptyTemplateForm = (gradeId = ''): TemplateForm => ({
  name: '', gradeId, strategy: 'BALANCED', scoreSource: 'LATEST_EXAM', bandIds: [], sectionOrder: [], respectExisting: true,
  tolerancePct: '15', siblingsTogether: false, broadGroups: '3', caps: {}, skim: [], remainderStrategy: 'BALANCED', subjectWeights: [],
})

function OrderedPicker({ options, selected, onChange }: { options: { id: string; label: string }[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const move = (i: number, dir: -1 | 1) => {
    const next = [...selected]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <ol className="space-y-1 rounded-2xl border border-black/[.08] dark:border-white/[.12] p-2">
          {selected.map((id, i) => (
            <li key={id} className="flex items-center gap-2 rounded-xl bg-black/[.03] dark:bg-white/[.05] px-2.5 py-1.5 text-[13px]">
              <span className="w-5 text-center font-semibold text-black/40 dark:text-white/40">{i + 1}</span>
              <span className="flex-1 truncate font-medium">{options.find(o => o.id === id)?.label ?? id}</span>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-0.5 hover:bg-black/10 disabled:opacity-30 dark:hover:bg-white/15"><ChevronUp size={13} /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === selected.length - 1} className="rounded p-0.5 hover:bg-black/10 disabled:opacity-30 dark:hover:bg-white/15"><ChevronDown size={13} /></button>
              <button type="button" onClick={() => toggle(id)} className="rounded p-0.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"><X size={13} /></button>
            </li>
          ))}
        </ol>
      )}
      <div className="thin-scroll max-h-40 space-y-1 overflow-y-auto rounded-2xl border border-dashed border-black/15 dark:border-white/15 p-2">
        {options.filter(o => !selected.includes(o.id)).map(o => (
          <button type="button" key={o.id} onClick={() => toggle(o.id)} className="block w-full rounded-xl px-2.5 py-1.5 text-left text-[13px] font-medium hover:bg-black/[.04] dark:hover:bg-white/[.06]">+ {o.label}</button>
        ))}
        {options.every(o => selected.includes(o.id)) && <p className="px-2 py-1 text-[12px] text-black/40 dark:text-white/40">All options added.</p>}
      </div>
    </div>
  )
}

function TemplateFormBody({ form, setForm, grades, bands, cohorts, subjects }: {
  form: TemplateForm; setForm: (f: TemplateForm) => void
  grades: { id: string; label: string }[]; bands: PerformanceBand[]; cohorts: { id: string; name: string }[]; subjects: { id: string; name: string }[]
}) {
  const cohortOptions = cohorts.map(c => ({ id: c.id, label: c.name }))
  const otherStrategies = SECTIONING_STRATEGIES.filter(s => s.value !== 'SKIM_THEN_BALANCE')
  return (
    <div className="space-y-4">
      <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Grade 11 — start of year" className={inputCls} autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Grade">
          <select value={form.gradeId} onChange={e => setForm({ ...form, gradeId: e.target.value })} className={inputCls}>
            <option value="">Select grade</option>
            {grades.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </Field>
        <Field label="Score source">
          <select value={form.scoreSource} onChange={e => setForm({ ...form, scoreSource: e.target.value as SectioningScoreSource })} className={inputCls}>
            {SCORE_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
      </div>

      {form.scoreSource === 'CUSTOM_WEIGHTING' && (
        <div>
          <p className="mb-2 text-[13px] font-semibold text-black/60 dark:text-white/60">Subject weights</p>
          <div className="space-y-2">
            {form.subjectWeights.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={row.subjectId} onChange={e => setForm({ ...form, subjectWeights: form.subjectWeights.map((r, j) => j === i ? { ...r, subjectId: e.target.value } : r) })} className={smallInput + ' flex-1'}>
                  <option value="">Subject…</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input type="number" min={0} step={0.1} value={row.weight} onChange={e => setForm({ ...form, subjectWeights: form.subjectWeights.map((r, j) => j === i ? { ...r, weight: e.target.value } : r) })} placeholder="Weight" className={smallInput + ' w-24'} />
                <button type="button" onClick={() => setForm({ ...form, subjectWeights: form.subjectWeights.filter((_, j) => j !== i) })} className="rounded-full p-1.5 text-black/35 hover:bg-rose-50 hover:text-rose-500 dark:text-white/35"><X size={13} /></button>
              </div>
            ))}
            <button type="button" onClick={() => setForm({ ...form, subjectWeights: [...form.subjectWeights, { subjectId: '', weight: '1' }] })} className={ghostBtn}>+ Add subject weight</button>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-[13px] font-semibold text-black/60 dark:text-white/60">Strategy</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SECTIONING_STRATEGIES.map(s => (
            <button type="button" key={s.value} onClick={() => setForm({ ...form, strategy: s.value })}
              className={`rounded-2xl border p-3 text-left transition ${form.strategy === s.value ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-500/10' : 'border-black/10 dark:border-white/15 hover:bg-black/[.03] dark:hover:bg-white/[.05]'}`}>
              <p className="text-[13.5px] font-semibold">{s.label}</p>
              <p className="mt-0.5 text-[12px] text-black/50 dark:text-white/50">{s.hint}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[13px] font-semibold text-black/60 dark:text-white/60">Bands used · {form.bandIds.length} selected</p>
        <div className="flex flex-wrap gap-2">
          {bands.map(b => (
            <button type="button" key={b.id} onClick={() => setForm({ ...form, bandIds: form.bandIds.includes(b.id) ? form.bandIds.filter(x => x !== b.id) : [...form.bandIds, b.id] })}
              className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 transition ${form.bandIds.includes(b.id) ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-black/[.04] text-black/60 ring-black/10 dark:bg-white/[.06] dark:text-white/60 dark:ring-white/15'}`}>
              {b.label} ({b.minScore}–{b.maxScore}%)
            </button>
          ))}
          {bands.length === 0 && <p className={muted}>No bands defined for this year yet — add them under Performance Bands first.</p>}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[13px] font-semibold text-black/60 dark:text-white/60">Section fill order</p>
        <OrderedPicker options={cohortOptions} selected={form.sectionOrder} onChange={ids => setForm({ ...form, sectionOrder: ids })} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Band-mix tolerance (± percentage points)"><input type="number" min={0} max={100} value={form.tolerancePct} onChange={e => setForm({ ...form, tolerancePct: e.target.value })} className={inputCls} /></Field>
        <div className="flex items-end gap-4 pb-2.5">
          <label className="flex items-center gap-2 text-[13.5px] font-medium">
            <input type="checkbox" checked={form.siblingsTogether} onChange={e => setForm({ ...form, siblingsTogether: e.target.checked })} /> Warn if siblings split
          </label>
        </div>
      </div>
      <label className="flex items-center gap-2 text-[13.5px] font-medium">
        <input type="checkbox" checked={form.respectExisting} onChange={e => setForm({ ...form, respectExisting: e.target.checked })} /> Respect existing placement where possible (continuity across terms)
      </label>

      {form.strategy === 'BANDED' && (
        <Field label="Broad groups (2–3)"><input type="number" min={2} max={3} value={form.broadGroups} onChange={e => setForm({ ...form, broadGroups: e.target.value })} className={inputCls + ' w-32'} /></Field>
      )}

      {form.strategy === 'STRATIFIED_CAPPED' && form.sectionOrder.length > 0 && form.bandIds.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-semibold text-black/60 dark:text-white/60">Per-section band caps (blank = no cap)</p>
          <div className="overflow-x-auto rounded-2xl border border-black/[.08] dark:border-white/[.12]">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-black/[.08] dark:border-white/[.12]"><th className="p-2 text-left">Section</th>{form.bandIds.map(bid => <th key={bid} className="p-2 text-left">{bands.find(b => b.id === bid)?.label ?? bid}</th>)}</tr></thead>
              <tbody>
                {form.sectionOrder.map(sid => (
                  <tr key={sid} className="border-b border-black/[.05] last:border-0 dark:border-white/[.07]">
                    <td className="p-2 font-medium">{cohortOptions.find(o => o.id === sid)?.label ?? sid}</td>
                    {form.bandIds.map(bid => {
                      const label = bands.find(b => b.id === bid)?.label ?? bid
                      return (
                        <td key={bid} className="p-2">
                          <input type="number" min={0} value={form.caps[sid]?.[label] ?? ''} onChange={e => setForm({ ...form, caps: { ...form.caps, [sid]: { ...form.caps[sid], [label]: e.target.value } } })} className={smallInput + ' w-20'} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {form.strategy === 'SKIM_THEN_BALANCE' && (
        <div className="space-y-3">
          <div>
            <p className="mb-2 text-[13px] font-semibold text-black/60 dark:text-white/60">Skim — removed from the pool first, by section</p>
            <div className="space-y-2">
              {form.skim.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select value={row.sectionId} onChange={e => setForm({ ...form, skim: form.skim.map((r, j) => j === i ? { ...r, sectionId: e.target.value } : r) })} className={smallInput + ' flex-1'}>
                    <option value="">Section…</option>
                    {cohortOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  <select value={row.mode} onChange={e => setForm({ ...form, skim: form.skim.map((r, j) => j === i ? { ...r, mode: e.target.value as 'count' | 'percentage' } : r) })} className={smallInput + ' w-28'}>
                    <option value="count">Count</option>
                    <option value="percentage">Percent</option>
                  </select>
                  <input type="number" min={0} value={row.value} onChange={e => setForm({ ...form, skim: form.skim.map((r, j) => j === i ? { ...r, value: e.target.value } : r) })} className={smallInput + ' w-24'} />
                  <button type="button" onClick={() => setForm({ ...form, skim: form.skim.filter((_, j) => j !== i) })} className="rounded-full p-1.5 text-black/35 hover:bg-rose-50 hover:text-rose-500 dark:text-white/35"><X size={13} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setForm({ ...form, skim: [...form.skim, { sectionId: '', mode: 'count', value: '' }] })} className={ghostBtn}>+ Add skim row</button>
            </div>
          </div>
          <Field label="Then run on the remainder">
            <select value={form.remainderStrategy} onChange={e => setForm({ ...form, remainderStrategy: e.target.value as SectioningStrategy })} className={inputCls}>
              {otherStrategies.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
        </div>
      )}
    </div>
  )
}

export function SectioningTemplatesMod() {
  const navigate = useNavigate()
  const { years, grades, currentYear, cohorts, subjects } = useAcademic()
  const sortedYears = useMemo(() => [...years].sort((a, b) => b.label.localeCompare(a.label)), [years])
  const [pickedYearId, setYearId] = useState('')
  const yearId = sortedYears.some(y => y.id === pickedYearId) ? pickedYearId : (currentYear?.id ?? sortedYears[0]?.id ?? '')
  const [gradeId, setGradeId] = useState('')
  const sortedGrades = useMemo(() => [...grades].sort((a, b) => a.order - b.order), [grades])

  const { items: templates, loading, reload } = useTemplates({ academicYearId: yearId || undefined, gradeId: gradeId || undefined }, !!yearId)
  const { items: bands } = useBands(yearId, !!yearId)
  const yearCohorts = useMemo(() => (cohorts as { id: string; name: string; academicYearId: string }[]).filter(c => c.academicYearId === yearId), [cohorts, yearId])
  const templateActions = useTemplateActions()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SectioningTemplate | null>(null)
  const [form, setForm] = useState<TemplateForm>(emptyTemplateForm())
  const openAdd = () => { setEditing(null); setForm(emptyTemplateForm(gradeId)); setFormOpen(true) }
  const openEdit = (t: SectioningTemplate) => {
    setEditing(t)
    const cfg = t.distributionConfig ?? {}
    const capsStr: Record<string, Record<string, string>> = {}
    for (const [sid, m] of Object.entries(cfg.caps ?? {})) capsStr[sid] = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)]))
    setForm({
      name: t.name, gradeId: t.gradeId, strategy: t.strategy, scoreSource: t.scoreSource, bandIds: t.bandIds, sectionOrder: t.sectionOrder,
      respectExisting: t.respectExisting, tolerancePct: String(cfg.bandMixTolerancePct ?? 15), siblingsTogether: !!cfg.siblingsTogether,
      broadGroups: String(cfg.broadGroups ?? 3), caps: capsStr,
      skim: (cfg.skim ?? []).map(s => ({ sectionId: s.sectionId, mode: s.percentage !== undefined ? 'percentage' as const : 'count' as const, value: String(s.percentage ?? s.count ?? '') })),
      remainderStrategy: cfg.remainderStrategy ?? 'BALANCED',
      subjectWeights: Object.entries(t.subjectWeights ?? {}).map(([subjectId, weight]) => ({ subjectId, weight: String(weight) })),
    })
    setFormOpen(true)
  }
  const valid = form.name.trim() && form.gradeId && form.sectionOrder.length > 0

  const save = async () => {
    const distributionConfig: SectioningDistributionConfig = { bandMixTolerancePct: Number(form.tolerancePct) || undefined, siblingsTogether: form.siblingsTogether || undefined }
    if (form.strategy === 'BANDED') distributionConfig.broadGroups = Number(form.broadGroups) || 3
    if (form.strategy === 'STRATIFIED_CAPPED') {
      const caps: Record<string, Record<string, number>> = {}
      for (const [sid, m] of Object.entries(form.caps)) {
        const bandCaps: Record<string, number> = {}
        for (const [label, v] of Object.entries(m)) if (v !== '') bandCaps[label] = Number(v)
        if (Object.keys(bandCaps).length) caps[sid] = bandCaps
      }
      if (Object.keys(caps).length) distributionConfig.caps = caps
    }
    if (form.strategy === 'SKIM_THEN_BALANCE') {
      distributionConfig.skim = form.skim.filter(s => s.sectionId && s.value !== '').map(s => ({ sectionId: s.sectionId, ...(s.mode === 'percentage' ? { percentage: Number(s.value) } : { count: Number(s.value) }) }))
      distributionConfig.remainderStrategy = form.remainderStrategy
    }
    const subjectWeights = form.scoreSource === 'CUSTOM_WEIGHTING'
      ? Object.fromEntries(form.subjectWeights.filter(r => r.subjectId && r.weight !== '').map(r => [r.subjectId, Number(r.weight)]))
      : undefined
    const body = {
      academicYearId: yearId, gradeId: form.gradeId, name: form.name.trim(), strategy: form.strategy, scoreSource: form.scoreSource,
      subjectWeights, bandIds: form.bandIds, distributionConfig, sectionOrder: form.sectionOrder, respectExisting: form.respectExisting,
    }
    const out = editing ? await templateActions.update(editing.id, body) : await templateActions.create(body)
    if (out) { setFormOpen(false); reload() }
  }
  const [del, setDel] = useState<SectioningTemplate | null>(null)
  const remove = async () => { if (del && await templateActions.remove(del.id)) { setDel(null); reload() } }

  const [runningId, setRunningId] = useState<string | null>(null)
  const run = async (t: SectioningTemplate) => {
    setRunningId(t.id)
    try {
      const version = await templateActions.generate(t.id)
      if (version) navigate(`/portal/sectioning/versions/${version.id}`)
    } finally { setRunningId(null) }
  }

  return (
    <div>
      <PageHead title="Sectioning Templates" sub="Configure how a grade's students are split into sections — pick a strategy, the bands that drive the mix, and the fill order.">
        <div className="flex items-center gap-3">
          <YearGradeBar years={sortedYears} yearId={yearId} setYearId={setYearId} gradeId={gradeId} setGradeId={setGradeId} grades={sortedGrades} />
          {yearId && <HeaderAdd label="New template" onClick={openAdd} />}
        </div>
      </PageHead>

      {sortedYears.length === 0 ? <Empty text="Create an academic year first." /> : loading ? (
        <div className="py-10 text-center text-[14px] text-black/40 dark:text-white/40">Loading…</div>
      ) : (templates ?? []).length === 0 ? (
        <Card className="flex flex-col items-center py-14 text-center">
          <p className="font-display text-xl font-medium">No templates yet</p>
          <p className="mt-1 max-w-sm text-[14px] text-black/50 dark:text-white/50">A template is a reusable recipe — strategy, bands, fill order — for one grade's sectioning run.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(templates ?? []).map(t => (
            <TemplateCard key={t.id} template={t} grades={sortedGrades} onEdit={() => openEdit(t)} onDelete={() => setDel(t)} onRun={() => run(t)} running={runningId === t.id} />
          ))}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.name}` : 'New sectioning template'} wide>
        <TemplateFormBody form={form} setForm={setForm} grades={sortedGrades} bands={bands ?? []} cohorts={yearCohorts} subjects={subjects} />
        <div className="pt-4"><FormActions onCancel={() => setFormOpen(false)} onSave={save} label={editing ? 'Save changes' : 'Create template'} disabled={!valid || templateActions.busy} /></div>
      </Modal>

      <ConfirmModal open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.name ?? 'template'}?`}
        body="Past runs of this template stay on record; only the reusable recipe itself is removed." action="Delete template" busy={templateActions.busy} onConfirm={remove} />
    </div>
  )
}

function TemplateCard({ template, grades, onEdit, onDelete, onRun, running }: {
  template: SectioningTemplate; grades: { id: string; label: string }[]; onEdit: () => void; onDelete: () => void; onRun: () => void; running: boolean
}) {
  const { items: versions } = useTemplateVersions(template.id)
  const navigate = useNavigate()
  const strategy = SECTIONING_STRATEGIES.find(s => s.value === template.strategy)
  const recent = (versions ?? []).slice(0, 3)
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[17px] font-medium">{template.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Pill tone="indigo">{grades.find(g => g.id === template.gradeId)?.label ?? template.gradeId}</Pill>
            <Pill tone="slate">{strategy?.label ?? template.strategy}</Pill>
            {template.respectExisting && <Pill tone="green">Respects existing</Pill>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={onEdit} className={iconBtn} aria-label="Edit"><Wand2 size={14} /></button>
          <button onClick={onDelete} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
        </div>
      </div>
      <p className={muted}>{strategy?.hint}</p>
      {recent.length > 0 && (
        <div className="space-y-1 border-t border-black/[.06] dark:border-white/[.08] pt-2.5">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40"><History size={11} /> Recent runs</p>
          {recent.map(v => (
            <button key={v.id} onClick={() => navigate(`/portal/sectioning/versions/${v.id}`)} className="flex w-full items-center justify-between rounded-lg px-1.5 py-1 text-left text-[12.5px] hover:bg-black/[.03] dark:hover:bg-white/[.05]">
              <span>{new Date(v.createdAt).toLocaleDateString()} · {v.assignments.length} students</span>
              <Pill tone={v.status === 'APPROVED' ? 'green' : v.status === 'SUPERSEDED' ? 'slate' : 'amber'}>{v.status}</Pill>
            </button>
          ))}
        </div>
      )}
      <button onClick={onRun} disabled={running} className="btn-ink mt-1 flex items-center justify-center gap-2 py-2.5 text-[13.5px] font-semibold disabled:opacity-50">
        <Wand2 size={14} /> {running ? 'Running…' : 'Run — generate draft'}
      </button>
    </Card>
  )
}

/* ── §3 Track eligibility rules ─────────────────────────── */

interface RuleForm { trackActivityId: string; label: string; rules: SubjectScoreRule[]; enforcementMode: EnforcementMode }
const emptyRuleForm = (activityId = ''): RuleForm => ({ trackActivityId: activityId, label: '', rules: [{ subjectName: '', minScore: 60 }], enforcementMode: 'ADVISORY' })

export function TrackEligibilityMod() {
  const { items: activities } = useActivities()
  const { subjects } = useAcademic()
  const [activityId, setActivityId] = useState('')
  const trackActivities = activities ?? []
  const currentActivityId = trackActivities.some(a => a.id === activityId) ? activityId : (trackActivities[0]?.id ?? '')
  const { items: rules, reload } = useTrackRules(currentActivityId, !!currentActivityId)
  const ruleActions = useRuleActions()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TrackEligibilityRule | null>(null)
  const [form, setForm] = useState<RuleForm>(emptyRuleForm())
  const openAdd = () => { setEditing(null); setForm(emptyRuleForm(currentActivityId)); setFormOpen(true) }
  const openEdit = (r: TrackEligibilityRule) => { setEditing(r); setForm({ trackActivityId: r.trackActivityId, label: r.label, rules: r.subjectScoreRules, enforcementMode: r.enforcementMode }); setFormOpen(true) }
  const valid = form.label.trim() && form.rules.length > 0 && form.rules.every(r => (r.subjectId || r.subjectName) && r.minScore >= 0)
  const save = async () => {
    const body = { trackActivityId: form.trackActivityId, label: form.label.trim(), subjectScoreRules: form.rules, enforcementMode: form.enforcementMode }
    const out = editing ? await ruleActions.update(editing.id, body) : await ruleActions.create(body)
    if (out) { setFormOpen(false); reload() }
  }
  const [del, setDel] = useState<TrackEligibilityRule | null>(null)

  const [registerOpen, setRegisterOpen] = useState(false)

  return (
    <div>
      <PageHead title="Track Eligibility" sub="Choice + eligibility for track/stream cohorts (JEE, NEET, etc.) — registration reuses the Activities capacity+waitlist mechanism; a rule's mode decides whether an unmet threshold blocks or just flags.">
        <div className="flex items-center gap-2">
          <select value={currentActivityId} onChange={e => setActivityId(e.target.value)} className={inputCls + ' w-auto min-w-[200px]'}>
            {trackActivities.length === 0 && <option value="">No activities yet</option>}
            {trackActivities.map(a => <option key={a.id} value={a.id}>{a.title} · {ACTIVITY_KIND_LABEL[a.kind]}</option>)}
          </select>
          {currentActivityId && <button onClick={() => setRegisterOpen(true)} className={ghostBtn}>Register a student…</button>}
          {currentActivityId && <HeaderAdd label="New rule" onClick={openAdd} />}
        </div>
      </PageHead>
      <p className={muted + ' -mt-3 mb-4'}>A track is any Activity (Activities Admin) with one or more eligibility rules attached here — create the activity there first if it doesn't exist yet.</p>

      {trackActivities.length === 0 ? <Empty text="Create an activity under Activities Admin first, then attach an eligibility rule to it here." /> : (
        <Card className="p-0">
          <div className={cardHead}>
            <p className={sectionLabel}>Rules · {trackActivities.find(a => a.id === currentActivityId)?.title}</p>
          </div>
          {(rules ?? []).length === 0 ? <div className="p-6"><Empty text="No eligibility rules — registration is open to anyone (subject to capacity/waitlist)." /></div>
            : (rules ?? []).map(r => (
              <div key={r.id} className={rowCls}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-semibold">{r.label}</p>
                    <Pill tone={r.enforcementMode === 'STRICT' ? 'rose' : 'amber'}>{r.enforcementMode}</Pill>
                  </div>
                  <p className={muted}>{r.subjectScoreRules.map(sr => `${sr.subjectName ?? sr.subjectId} ≥ ${sr.minScore}%`).join(' · ')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => openEdit(r)} className={ghostBtn}>Edit</button>
                  <button onClick={() => setDel(r)} className={dangerBtn} aria-label="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
        </Card>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.label}` : 'New eligibility rule'} wide>
        <div className="space-y-4">
          <Field label="Label"><input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="e.g. JEE eligibility" className={inputCls} autoFocus /></Field>
          <div>
            <p className="mb-2 text-[13px] font-semibold text-black/60 dark:text-white/60">Enforcement mode</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ENFORCEMENT_MODES.map(m => (
                <button type="button" key={m.value} onClick={() => setForm({ ...form, enforcementMode: m.value })}
                  className={`rounded-2xl border p-3 text-left transition ${form.enforcementMode === m.value ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-500/10' : 'border-black/10 dark:border-white/15 hover:bg-black/[.03] dark:hover:bg-white/[.05]'}`}>
                  <p className="text-[13.5px] font-semibold">{m.label}</p>
                  <p className="mt-0.5 text-[12px] text-black/50 dark:text-white/50">{m.hint}</p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-semibold text-black/60 dark:text-white/60">Subject thresholds</p>
            <div className="space-y-2">
              {form.rules.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select value={r.subjectId ?? ''} onChange={e => setForm({ ...form, rules: form.rules.map((x, j) => j === i ? { subjectId: e.target.value || undefined, subjectName: e.target.value ? undefined : x.subjectName, minScore: x.minScore } : x) })} className={smallInput + ' flex-1'}>
                    <option value="">Match by name instead…</option>
                    {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {!r.subjectId && (
                    <input value={r.subjectName ?? ''} onChange={e => setForm({ ...form, rules: form.rules.map((x, j) => j === i ? { ...x, subjectName: e.target.value } : x) })} placeholder="Subject name (external admits)" className={smallInput + ' flex-1'} />
                  )}
                  <input type="number" min={0} max={100} value={r.minScore} onChange={e => setForm({ ...form, rules: form.rules.map((x, j) => j === i ? { ...x, minScore: Number(e.target.value) } : x) })} placeholder="Min %" className={smallInput + ' w-20'} />
                  <button type="button" onClick={() => setForm({ ...form, rules: form.rules.filter((_, j) => j !== i) })} className="rounded-full p-1.5 text-black/35 hover:bg-rose-50 hover:text-rose-500 dark:text-white/35"><X size={13} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setForm({ ...form, rules: [...form.rules, { subjectName: '', minScore: 60 }] })} className={ghostBtn}>+ Add subject threshold</button>
            </div>
          </div>
          <FormActions onCancel={() => setFormOpen(false)} onSave={save} label={editing ? 'Save changes' : 'Create rule'} disabled={!valid || ruleActions.busy} />
        </div>
      </Modal>

      <ConfirmModal open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.label ?? 'rule'}?`}
        body="Future registrations for this track won't be checked against this rule any more. Past exceptions stay on the report."
        action="Delete rule" busy={ruleActions.busy}
        onConfirm={async () => { if (del && await ruleActions.remove(del.id)) { setDel(null); reload() } }} />

      <StaffTrackRegisterModal open={registerOpen} onClose={() => setRegisterOpen(false)} activity={trackActivities.find(a => a.id === currentActivityId)} />
    </div>
  )
}

/** Staff/admin registering a student on their behalf — the same eligibility check runs, and a STRICT
 * failure surfaces the unmet rule(s) with a mandatory-reason override right here (§3 — "override always
 * requires a reason + approver"). */
function StaffTrackRegisterModal({ open, onClose, activity }: { open: boolean; onClose: () => void; activity?: ActivityRec }) {
  const [studentId, setStudentId] = useState('')
  const [studentLabel, setStudentLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState<{ ruleId: string; label: string; unmet: { rule: SubjectScoreRule; actual: number | null }[] }[] | null>(null)
  const [reason, setReason] = useState('')

  const reset = () => { setStudentId(''); setStudentLabel(''); setBlocked(null); setReason('') }
  const close = () => { reset(); onClose() }

  const attempt = async (overrideReason?: string) => {
    if (!activity || !studentId) return
    setBusy(true)
    try {
      const res = await registerForTrack(activity.id, { studentId, overrideReason })
      const { eligibility } = res
      if (eligibility.overridden) toast.success(`Registered with an override — logged in the exceptions report.`)
      else if (eligibility.failedAdvisory.length) toast(`Registered — flagged: ${eligibility.failedAdvisory.map(r => r.label).join(', ')} not met (advisory).`, { icon: '⚠️' })
      else toast.success('Registered — eligible.')
      close()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && (e.body as { failedRules?: typeof blocked })?.failedRules) {
        setBlocked((e.body as { failedRules: typeof blocked }).failedRules)
      } else toast.error(errorMessage(e))
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={close} title={`Register for ${activity?.title ?? 'track'}`}>
      <div className="space-y-4">
        {!blocked ? (
          <>
            <Field label="Student">
              <AsyncEntityPicker role="student" value={studentId} onChange={(id, label) => { setStudentId(id); setStudentLabel(label) }} initialLabel={studentLabel} placeholder="Search students…" />
            </Field>
            <FormActions onCancel={close} onSave={() => attempt()} label={busy ? 'Checking…' : 'Register'} disabled={!studentId || busy} />
          </>
        ) : (
          <>
            <div className="rounded-2xl bg-rose-50 dark:bg-rose-500/10 p-4 text-[13.5px] text-rose-700 dark:text-rose-300">
              <p className="flex items-center gap-2 font-semibold"><ShieldAlert size={16} /> STRICT eligibility not met</p>
              <ul className="mt-2 space-y-1">
                {blocked.map(r => (
                  <li key={r.ruleId}>
                    <span className="font-medium">{r.label}:</span>{' '}
                    {r.unmet.map((u, i) => <span key={i}>{u.rule.subjectName ?? u.rule.subjectId} needs ≥{u.rule.minScore}% (has {u.actual ?? 'no record'}){i < r.unmet.length - 1 ? ', ' : ''}</span>)}
                  </li>
                ))}
              </ul>
            </div>
            <Field label="Override reason (required)"><textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className={inputCls} placeholder="Why this student should be registered despite not meeting the rule…" autoFocus /></Field>
            <FormActions onCancel={close} onSave={() => attempt(reason.trim())} label={busy ? 'Submitting…' : 'Override and register'} disabled={!reason.trim() || busy} />
          </>
        )}
      </div>
    </Modal>
  )
}

/** Student-facing self-registration for tracks — same visual language as Activities' RegistrationsMod
 * (office.tsx), but goes through the sectioning-aware endpoint so eligibility runs and is shown inline. */
export function TrackRegistrationsMod() {
  const { user } = useStore()
  const { items, loading, reload } = useActivities(undefined, !!user)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ activityId: string; passed: boolean; advisoryLabels: string[]; strictLabels: string[] } | null>(null)

  const register = async (a: ActivityRec) => {
    setBusy(a.id)
    setResult(null)
    try {
      const res = await registerForTrack(a.id, {})
      setResult({ activityId: a.id, passed: res.eligibility.passed, advisoryLabels: res.eligibility.failedAdvisory.map(r => r.label), strictLabels: [] })
      await reload()
      toast.success(res.eligibility.passed ? `Registered for ${a.title}` : `Registered for ${a.title} — flagged for review`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const failed = (e.body as { failedRules?: { label: string }[] })?.failedRules
        if (failed) { setResult({ activityId: a.id, passed: false, advisoryLabels: [], strictLabels: failed.map(r => r.label) }); toast.error('Not eligible — ask an admin about an override.') }
        else toast.error(errorMessage(e))
      } else toast.error(errorMessage(e))
    } finally { setBusy(null) }
  }

  const rows = items ?? []
  return (
    <div>
      <PageHead title="Track & Stream Registration" sub="Register your choice of track/stream — some carry eligibility thresholds; a strict one that isn't met needs a staff override, an advisory one just gets flagged." />
      {loading && <p className="text-[13px] text-black/40 dark:text-white/40">Loading…</p>}
      {!loading && rows.length === 0 && <Empty text="Nothing open for registration right now." />}
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(a => {
          const full = !!a.capacity && (a.registered ?? 0) >= a.capacity
          const on = a.myStatus === 'Registered' || a.myStatus === 'Waitlisted'
          const r = result?.activityId === a.id ? result : null
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
                </div>
                <button onClick={() => register(a)} disabled={busy === a.id || on}
                  className={`shrink-0 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${on ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-black text-white hover:bg-black/85'}`}>
                  {a.myStatus === 'Registered' ? '✓ Registered' : a.myStatus === 'Waitlisted' ? 'On waitlist' : busy === a.id ? 'Checking…' : 'Register'}
                </button>
              </div>
              {r && !r.passed && r.strictLabels.length > 0 && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 dark:bg-rose-500/10 p-2.5 text-[12.5px] text-rose-700 dark:text-rose-300">
                  <ShieldAlert size={14} className="mt-0.5 shrink-0" /> Rejected — doesn't meet: {r.strictLabels.join(', ')}. Ask the office about an override.
                </p>
              )}
              {r && r.advisoryLabels.length > 0 && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 p-2.5 text-[12.5px] text-amber-700 dark:text-amber-300">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Registered, but flagged: {r.advisoryLabels.join(', ')} not met.
                </p>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

/* ── Exceptions report ──────────────────────────────────── */

export function EligibilityExceptionsReportMod() {
  const { items: activities } = useActivities()
  const [activityId, setActivityId] = useState('')
  const { items, loading } = useEligibilityExceptions(activityId || undefined)
  const activityById = useMemo(() => new Map((activities ?? []).map(a => [a.id, a])), [activities])

  const rows = items ?? []
  return (
    <div>
      <PageHead title="Eligibility Exceptions" sub="Every track-eligibility override and advisory flag this term, with reason and approver — visibility, not policing.">
        <select value={activityId} onChange={e => setActivityId(e.target.value)} className={inputCls + ' w-auto min-w-[200px]'}>
          <option value="">All tracks</option>
          {(activities ?? []).map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
        </select>
      </PageHead>
      <Card className="p-0">
        {loading ? <div className="p-6 text-center text-[13px] text-black/40 dark:text-white/40">Loading…</div>
          : rows.length === 0 ? <div className="p-6"><Empty text="No exceptions on record." /></div>
          : rows.map(r => (
            <div key={r.id} className={rowCls}>
              <Avatar name={r.studentName} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[14px] font-semibold">{r.studentName}</p>
                  <Pill tone={r.type === 'STRICT_OVERRIDE' ? 'rose' : 'amber'}>{r.type === 'STRICT_OVERRIDE' ? 'Strict override' : 'Advisory flag'}</Pill>
                  <span className={muted}>{activityById.get(r.trackActivityId)?.title ?? r.trackActivityId}</span>
                </div>
                <p className={muted}>{r.unmetDetails.map((u, i) => <span key={i}>{u.rule.subjectName ?? u.rule.subjectId} needs ≥{u.rule.minScore}% (had {u.actual ?? 'no record'}){i < r.unmetDetails.length - 1 ? ', ' : ''}</span>)}</p>
                {r.reason && <p className="mt-1 text-[13px] italic text-black/60 dark:text-white/60">“{r.reason}”</p>}
              </div>
              <div className="shrink-0 text-right">
                {r.approvedByName && <p className="text-[12.5px] font-medium">{r.approvedByName}</p>}
                <p className={muted}>{new Date(r.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
      </Card>
    </div>
  )
}
