import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, ShieldAlert, Trash2, X } from 'lucide-react'
import { useAcademic } from '@/lib/store'
import { usePeriodTemplateOverrides, useWorkingDayPattern } from '@/lib/hooks/useSchoolConfig'
import { useSeedSubstitutionPreferences, useSubstitutionPolicy } from '@/lib/hooks/useSubstitution'
import { usePreferences } from '@/lib/hooks/useTimetable'
import type { PeriodDef, PeriodTemplateOverride, SaturdayPattern, SubstitutionPolicyMode, Weekday } from '@/lib/data'
import { SUBSTITUTION_PREFERENCE_LABELS } from '@/lib/data'
import { Card, Empty, Field, Modal, PageHead, inputCls } from '../ui'
import { dangerBtn, iconBtn, muted, nextRow, rowsValid, sectionLabel, STARTER_ROWS, type PeriodRow } from './academicShared'
import { ConfirmModal, FormActions, HeaderAdd } from './academic'

// Phase T1 §5 (roadmap D7) — school-level working days + day-scoped period templates. See
// .agents/edunova/phase-t1-timetable-foundations.md
//
// UX-fit call (per roadmap D9): built as its own routed page under System, not a modal. This is two
// genuinely dense sub-configs an admin sets up rarely but carefully and may revisit (a weekday +
// Saturday-pattern toggle, and a full per-day period-row editor) — the same class of screen `PeriodsMod`
// already gets a dedicated page for rather than a modal off some other screen. Nesting the period-row
// editor as a modal-inside-a-modal here would repeat exactly the "modal as mini-app" pattern the earlier
// UI-architecture fix (.agents/edunova/ui-architecture-fix.md) moved this codebase away from.

const WEEKDAY_OPTIONS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DEFAULT_WORKING_DAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

const SATURDAY_PATTERNS: { value: SaturdayPattern; label: string; hint: string }[] = [
  { value: 'NONE', label: 'No school Saturdays', hint: 'Saturday is never a working day.' },
  { value: 'ALL', label: 'Every Saturday', hint: 'Full working Saturday, every week.' },
  { value: 'ALTERNATE_1_3', label: '1st & 3rd Saturdays', hint: 'Working on the 1st and 3rd Saturday of each month.' },
  { value: 'ALTERNATE_2_4', label: '2nd & 4th Saturdays', hint: 'Working on the 2nd and 4th Saturday of each month.' },
  { value: 'HALF_DAY_ALL', label: 'Every Saturday, half day', hint: 'Working every Saturday on a shortened schedule.' },
]

const DAY_TABS: { dow: number; label: string }[] = [
  { dow: 1, label: 'Monday' }, { dow: 2, label: 'Tuesday' }, { dow: 3, label: 'Wednesday' },
  { dow: 4, label: 'Thursday' }, { dow: 5, label: 'Friday' }, { dow: 6, label: 'Saturday' },
]

const periodChips = (periods: PeriodDef[]) => (
  <div className="flex flex-wrap gap-1.5">
    {[...periods].sort((a, b) => a.idx - b.idx).map(p => (
      <span key={p.idx} title={`${p.start} – ${p.end}`}
        className={`rounded-lg px-2 py-1 text-[11.5px] font-semibold ${p.kind === 'break' ? 'bg-amber-400/10 text-amber-700 dark:text-amber-300' : 'bg-black/[.05] dark:bg-white/[.07] text-black/70 dark:text-white/70'}`}>
        {p.label} <span className="font-normal opacity-70">{p.start}</span>
      </span>
    ))}
  </div>
)

export function WorkingDaysMod() {
  const { years, currentYear } = useAcademic()
  const sortedYears = useMemo(() => [...years].sort((a, b) => a.startDate.localeCompare(b.startDate)), [years])
  const [pickedYearId, setPickedYearId] = useState('')
  const yearId = sortedYears.some(y => y.id === pickedYearId) ? pickedYearId : (currentYear?.id ?? sortedYears[0]?.id ?? '')
  const selectedYear = sortedYears.find(y => y.id === yearId)

  return (
    <div>
      <PageHead title="Working Days & Periods" sub="Which weekdays the school runs classes on, the Saturday pattern, and day-specific bell schedules">
        {sortedYears.length > 0 && (
          <select value={yearId} onChange={e => setPickedYearId(e.target.value)} className={inputCls + ' w-auto min-w-[160px]'} aria-label="Academic year">
            {sortedYears.map(y => <option key={y.id} value={y.id}>{y.label}{y.isCurrent ? ' · current' : ''}</option>)}
          </select>
        )}
      </PageHead>

      {sortedYears.length === 0 ? (
        <Empty text="Create an academic year first — working days belong to a year." />
      ) : (
        // Keyed on the year so switching years remounts with a fresh local draft instead of carrying over
        // unsaved edits from the previous year's form.
        <WorkingDaysForYear key={yearId} academicYearId={yearId} yearLabel={selectedYear?.label ?? ''} />
      )}

      {/* School-level (not year-scoped), so it sits outside WorkingDaysForYear's per-year remount. */}
      <div className="mt-5"><SubstitutionPolicyCard /></div>
    </div>
  )
}

const SUBSTITUTION_MODES: { value: SubstitutionPolicyMode; label: string; hint: string }[] = [
  { value: 'TEACHER_INITIATED', label: 'Teacher-initiated', hint: 'The absent teacher picks their own substitute from the ranked list and sends a request — the substitute must accept before admin can approve the leave.' },
  { value: 'ADMIN_ASSIGNED', label: 'Admin-assigned', hint: 'Staff/admin picks directly from the ranked list — no teacher-to-teacher request/accept round-trip.' },
  { value: 'HYBRID', label: 'Hybrid', hint: 'The teacher suggests a substitute from the ranked list, but admin makes the final call.' },
]

/** Phase T9 (roadmap D6) — substitution selection-mode policy + minimum-notice-period, plus the Finder's
 * ranking weights (a `Preference(scope: 'SUBSTITUTION')` row per signal — the exact same table/endpoint T5's
 * Mode 4 already uses, reused via `usePreferences` rather than a parallel weights concept). A small addition
 * to this existing school-config page rather than a new screen, per the phase brief: this is one flat
 * settings form a school sets up once and rarely revisits, the same class of thing the working days card
 * above already is. */
function SubstitutionPolicyCard() {
  const policy = useSubstitutionPolicy()
  const seedWeights = useSeedSubstitutionPreferences()
  const weights = usePreferences('SUBSTITUTION')
  const [mode, setMode] = useState<SubstitutionPolicyMode>('TEACHER_INITIATED')
  const [minNotice, setMinNotice] = useState('12')
  const [crossSubject, setCrossSubject] = useState(false)
  const [maxWeekly, setMaxWeekly] = useState('30')
  const [holdExpiry, setHoldExpiry] = useState('240')

  const [syncedLoading, setSyncedLoading] = useState(policy.loading)
  if (policy.loading !== syncedLoading) {
    setSyncedLoading(policy.loading)
    if (!policy.loading && policy.item) {
      setMode(policy.item.mode)
      setMinNotice(String(policy.item.minNoticeHoursForSubstitution))
      setCrossSubject(policy.item.allowCrossSubject)
      setMaxWeekly(String(policy.item.maxWeeklySubstitutePeriods))
      setHoldExpiry(String(policy.item.tentativeHoldExpiryMinutes))
    }
  }

  const dirty = policy.item
    ? mode !== policy.item.mode
      || Number(minNotice) !== policy.item.minNoticeHoursForSubstitution
      || crossSubject !== policy.item.allowCrossSubject
      || Number(maxWeekly) !== policy.item.maxWeeklySubstitutePeriods
      || Number(holdExpiry) !== policy.item.tentativeHoldExpiryMinutes
    : true

  const save = () => policy.save({
    mode,
    minNoticeHoursForSubstitution: Math.max(0, Number(minNotice) || 0),
    allowCrossSubject: crossSubject,
    maxWeeklySubstitutePeriods: Math.max(1, Number(maxWeekly) || 30),
    tentativeHoldExpiryMinutes: Math.max(5, Number(holdExpiry) || 240),
  }, policy.item?.configured ? 'Substitution policy updated' : 'Substitution policy configured')

  const weightTotal = weights.items.reduce((a, w) => a + w.weight, 0)

  return (
    <Card>
      <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
        <ShieldAlert size={14} /> Substitution policy
      </div>
      <p className={`mt-1 ${muted}`}>Who arranges a substitute when a teacher takes leave over teaching periods, how much notice skips straight to emergency assignment, and how the Substitute Finder ranks candidates.</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {SUBSTITUTION_MODES.map(m => (
          <button key={m.value} type="button" onClick={() => setMode(m.value)}
            className={`flex flex-col items-start gap-1 rounded-2xl border p-3.5 text-left transition ${mode === m.value ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500/50 dark:bg-indigo-500/10' : 'border-black/10 dark:border-white/15 hover:bg-black/[.03] dark:hover:bg-white/[.05]'}`}>
            <span className="text-[13px] font-semibold">{m.label}</span>
            <span className="text-[11.5px] text-black/45 dark:text-white/45">{m.hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        <Field label="Minimum notice (hours)">
          <input type="number" min={0} value={minNotice} onChange={e => setMinNotice(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Max substitute periods/week">
          <input type="number" min={1} value={maxWeekly} onChange={e => setMaxWeekly(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Tentative hold expiry (minutes)">
          <input type="number" min={5} value={holdExpiry} onChange={e => setHoldExpiry(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Cross-subject substitution">
          <button type="button" onClick={() => setCrossSubject(v => !v)}
            className={`w-full rounded-xl px-4 py-2.5 text-[13.5px] font-semibold transition-colors ${crossSubject ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-black/[.06] dark:bg-white/[.08]'}`}>
            {crossSubject ? 'Allowed' : 'Not allowed'}
          </button>
        </Field>
      </div>
      <p className={`mt-1.5 ${muted}`}>Leave submitted with less than {minNotice || 0} hour{minNotice === '1' ? '' : 's'} notice skips the pre-arranged flow and goes straight to admin emergency assignment. A candidate already at/over {maxWeekly || 0} substitute periods this week is a hard exclusion, not a ranking penalty.</p>

      <button onClick={save} disabled={!dirty || policy.busy} className="btn-ink mt-5 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
        {policy.busy ? 'Saving…' : 'Save substitution policy'}
      </button>

      <div className="mt-6 border-t border-black/[.06] dark:border-white/[.08] pt-5">
        <div className="flex items-center justify-between">
          <p className={sectionLabel}>Ranking weights {weights.items.length > 0 && weightTotal !== 100 && <span className="text-amber-600 dark:text-amber-400">(sum {weightTotal}, not 100)</span>}</p>
          {weights.items.length === 0 && !weights.loading && (
            <button onClick={() => seedWeights.seed().then(() => weights.reload())} disabled={seedWeights.busy} className="text-[12px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400 disabled:opacity-40">
              {seedWeights.busy ? 'Creating…' : 'Create default weights'}
            </button>
          )}
        </div>
        {weights.items.length === 0 ? (
          <p className={`mt-1.5 ${muted}`}>Not configured yet — the Finder uses the spec's own defaults (qualification 40 / same subject 20 / availability 15 / workload 10 / avoids-consecutive 5 / preference 5 / class suitability 5) until these are created.</p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {weights.items.map(w => (
              <label key={w.type} className="block">
                <span className="text-[11.5px] font-medium text-black/50 dark:text-white/50">{SUBSTITUTION_PREFERENCE_LABELS[w.type as keyof typeof SUBSTITUTION_PREFERENCE_LABELS] ?? w.type}</span>
                <input type="number" min={0} max={100} defaultValue={w.weight} key={`${w.type}-${w.weight}`}
                  onBlur={e => { const v = Math.max(0, Number(e.target.value) || 0); if (v !== w.weight) weights.update(w.type, { weight: v }) }}
                  className={`${inputCls} mt-1 py-1.5 text-[13px]`} />
              </label>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function WorkingDaysForYear({ academicYearId, yearLabel }: { academicYearId: string; yearLabel: string }) {
  const pattern = useWorkingDayPattern(academicYearId)
  const [days, setDays] = useState<Weekday[]>(() => pattern.item?.workingDays ?? DEFAULT_WORKING_DAYS)
  const [satPattern, setSatPattern] = useState<SaturdayPattern>(() => pattern.item?.saturdayPattern ?? 'NONE')

  // Resync the local draft once the fetch resolves — a render-time adjustment (same pattern as
  // AsyncEntityPicker's `syncedValue`) rather than an effect, so a slow fetch can't clobber an edit the
  // admin already started.
  const [syncedLoading, setSyncedLoading] = useState(pattern.loading)
  if (pattern.loading !== syncedLoading) {
    setSyncedLoading(pattern.loading)
    if (!pattern.loading) {
      setDays(pattern.item?.workingDays ?? DEFAULT_WORKING_DAYS)
      setSatPattern(pattern.item?.saturdayPattern ?? 'NONE')
    }
  }

  const toggleDay = (d: Weekday) => setDays(ds => ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d])
  const dirty = pattern.item
    ? JSON.stringify([...days].sort()) !== JSON.stringify([...pattern.item.workingDays].sort()) || satPattern !== pattern.item.saturdayPattern
    : true
  const save = () => pattern.save({ workingDays: days, saturdayPattern: satPattern }, pattern.item ? 'Working days updated' : 'Working days configured')

  return (
    <div className="space-y-5">
      <Card>
        <p className={sectionLabel}>Working days · {yearLabel}</p>
        <p className={`mt-1 ${muted}`}>Existing schools default to Mon–Fri with no working Saturdays until this is explicitly configured — nothing changes for a school that never opens this screen.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {WEEKDAY_OPTIONS.map(d => {
            const on = days.includes(d)
            return (
              <button key={d} type="button" onClick={() => toggleDay(d)}
                className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${on ? 'bg-indigo-600 text-white' : 'bg-black/[.05] dark:bg-white/[.07] hover:bg-black/10 dark:hover:bg-white/15'}`}>
                {d}
              </button>
            )
          })}
        </div>
        <div className="mt-5 max-w-sm">
          <Field label="Saturday pattern">
            <select value={satPattern} onChange={e => setSatPattern(e.target.value as SaturdayPattern)} className={inputCls}>
              {SATURDAY_PATTERNS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <p className={`mt-1.5 ${muted}`}>{SATURDAY_PATTERNS.find(p => p.value === satPattern)?.hint}</p>
        </div>
        <button onClick={save} disabled={!dirty || pattern.busy} className="btn-ink mt-5 px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-40">
          {pattern.busy ? 'Saving…' : 'Save working days'}
        </button>
      </Card>

      <PeriodOverridesCard />
    </div>
  )
}

function PeriodOverridesCard() {
  const { periodTemplates, defaultTemplate } = useAcademic()
  const sortedTemplates = useMemo(() => [...periodTemplates].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)), [periodTemplates])
  const [pickedTemplateId, setPickedTemplateId] = useState('')
  const templateId = sortedTemplates.some(t => t.id === pickedTemplateId) ? pickedTemplateId : (defaultTemplate?.id ?? sortedTemplates[0]?.id ?? '')
  const template = sortedTemplates.find(t => t.id === templateId)
  const overrides = usePeriodTemplateOverrides(templateId)
  const [dow, setDow] = useState(6) // Saturday is by far the most common override — default the tab there
  const overrideForDay = overrides.items.find(o => o.dayOfWeek === dow)
  const dayLabel = DAY_TABS.find(d => d.dow === dow)?.label ?? ''

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<{ name: string; rows: PeriodRow[] }>({ name: '', rows: STARTER_ROWS.map(r => ({ ...r })) })
  const openAdd = () => { setForm({ name: `${template?.name ?? 'Template'} · ${dayLabel}`, rows: STARTER_ROWS.map(r => ({ ...r })) }); setFormOpen(true) }
  const openEditOverride = (o: PeriodTemplateOverride) => {
    setForm({ name: o.name, rows: [...o.periods].sort((a, b) => a.idx - b.idx).map(p => ({ label: p.label, start: p.start, end: p.end, kind: p.kind })) })
    setFormOpen(true)
  }
  const setRows = (rows: PeriodRow[]) => setForm(f => ({ ...f, rows }))
  const patchRow = (i: number, patch: Partial<PeriodRow>) => setRows(form.rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  const moveRow = (i: number, dir: -1 | 1) => {
    const rows = [...form.rows]
    const j = i + dir
    if (!rows[j]) return
    ;[rows[i], rows[j]] = [rows[j], rows[i]]
    setRows(rows)
  }
  const save = async () => {
    const periods: PeriodDef[] = form.rows.map((r, i) => ({ idx: i + 1, label: r.label.trim(), start: r.start, end: r.end, kind: r.kind }))
    const body = { name: form.name.trim(), periods }
    const out = overrideForDay ? await overrides.update(overrideForDay.id, body, 'Override updated') : await overrides.create({ dayOfWeek: dow, ...body }, 'Override created')
    if (out) setFormOpen(false)
  }
  const [confirmRemove, setConfirmRemove] = useState(false)
  const formValid = form.name.trim().length > 0 && rowsValid(form.rows)

  return (
    <Card className="p-0">
      <div className="border-b border-black/[.06] dark:border-white/[.08] p-6">
        <p className={sectionLabel}>Day-specific period schedules</p>
        <p className={`mt-1 ${muted}`}>Give one weekday (typically Saturday) a different bell schedule than the rest of the week. A day with no override just uses the base template below.</p>
        {sortedTemplates.length > 1 && (
          <div className="mt-4 max-w-sm">
            <Field label="Base template">
              <select value={templateId} onChange={e => setPickedTemplateId(e.target.value)} className={inputCls}>
                {sortedTemplates.map(t => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
              </select>
            </Field>
          </div>
        )}
      </div>

      {sortedTemplates.length === 0 ? (
        <div className="p-6"><Empty text="Create a period template first, under Periods." /></div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 border-b border-black/[.06] dark:border-white/[.08] px-6 py-3">
            {DAY_TABS.map(d => {
              const has = overrides.items.some(o => o.dayOfWeek === d.dow)
              return (
                <button key={d.dow} onClick={() => setDow(d.dow)}
                  className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${dow === d.dow ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-black/[.05] dark:bg-white/[.07] hover:bg-black/10 dark:hover:bg-white/15'}`}>
                  {d.label}{has ? ' ·' : ''}
                </button>
              )
            })}
          </div>

          <div className="p-6">
            {overrideForDay ? (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{overrideForDay.name}</p>
                    <p className={muted}>Overrides the base template on {dayLabel}s</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEditOverride(overrideForDay)} className={iconBtn} aria-label="Edit override"><Pencil size={14} /></button>
                    <button onClick={() => setConfirmRemove(true)} className={dangerBtn} aria-label="Remove override"><Trash2 size={14} /></button>
                  </div>
                </div>
                {periodChips(overrideForDay.periods)}
              </div>
            ) : (
              <div>
                <p className="mb-3 text-[13.5px]">{dayLabel} currently uses the base template, <span className="font-semibold">{template?.name}</span>:</p>
                {periodChips(template?.periods ?? [])}
                <div className="mt-4"><HeaderAdd label={`Add ${dayLabel} override`} onClick={openAdd} /></div>
              </div>
            )}
          </div>
        </>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={overrideForDay ? `Edit ${dayLabel} override` : `New ${dayLabel} override`} wide>
        <div className="space-y-4">
          <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} autoFocus /></Field>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className={sectionLabel}>Periods · {form.rows.length}</p>
              <HeaderAdd label="Add row" onClick={() => setRows([...form.rows, nextRow(form.rows)])} />
            </div>
            <div className="hidden grid-cols-[minmax(0,1fr)_118px_118px_104px_92px] gap-2 px-1 pb-1 text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 sm:grid">
              <span>Label</span><span>Start</span><span>End</span><span>Kind</span><span />
            </div>
            <div className="space-y-2">
              {form.rows.map((r, i) => (
                <div key={i} className={`grid grid-cols-2 gap-2 rounded-2xl p-2 sm:grid-cols-[minmax(0,1fr)_118px_118px_104px_92px] sm:rounded-none sm:p-0 ${r.kind === 'break' ? 'bg-amber-400/10 sm:bg-transparent' : 'bg-black/[.03] dark:bg-white/[.05] sm:bg-transparent'}`}>
                  <input value={r.label} onChange={e => patchRow(i, { label: e.target.value })} placeholder={r.kind === 'break' ? 'Break' : 'P1'} className={inputCls + ' col-span-2 py-2 text-[13.5px] sm:col-span-1'} aria-label="Label" />
                  <input type="time" value={r.start} onChange={e => patchRow(i, { start: e.target.value })} className={inputCls + ' py-2 text-[13.5px]'} aria-label="Start" />
                  <input type="time" value={r.end} onChange={e => patchRow(i, { end: e.target.value })} className={inputCls + ' py-2 text-[13.5px]'} aria-label="End" />
                  <select value={r.kind} onChange={e => patchRow(i, { kind: e.target.value as PeriodRow['kind'] })} className={inputCls + ` py-2 text-[13.5px] ${r.kind === 'break' ? 'text-amber-700 dark:text-amber-300' : ''}`} aria-label="Kind">
                    <option value="class">Class</option>
                    <option value="break">Break</option>
                  </select>
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => moveRow(i, -1)} disabled={i === 0} className={iconBtn} aria-label="Move up"><ChevronUp size={13} /></button>
                    <button onClick={() => moveRow(i, 1)} disabled={i === form.rows.length - 1} className={iconBtn} aria-label="Move down"><ChevronDown size={13} /></button>
                    <button onClick={() => setRows(form.rows.filter((_, j) => j !== i))} className={dangerBtn} aria-label="Remove"><X size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
            {form.rows.length === 0 && <Empty text="Add at least one period." />}
            {form.rows.some(r => r.start && r.end && r.start >= r.end) && <p className="mt-2 text-[12.5px] text-rose-500">Every period must end after it starts.</p>}
          </div>
          <FormActions onCancel={() => setFormOpen(false)} onSave={save} label={overrideForDay ? 'Save changes' : 'Create override'} disabled={!formValid || overrides.busy} />
        </div>
      </Modal>

      <ConfirmModal open={confirmRemove} onClose={() => setConfirmRemove(false)} title={`Remove the ${dayLabel} override?`}
        body="The day falls back to using the base template above." action="Remove override" busy={overrides.busy}
        onConfirm={async () => { if (overrideForDay && await overrides.remove(overrideForDay.id, 'Override removed')) setConfirmRemove(false) }} />
    </Card>
  )
}
