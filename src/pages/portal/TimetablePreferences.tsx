import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft, CheckCircle2, Sparkles } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/lib/theme'
import { usePreferenceProfiles, usePreferences } from '@/lib/hooks/useTimetable'
import type { AssignmentPreferenceType, PreferenceProfileName, RefinementPreferenceType } from '@/lib/data'
import { Card, Empty, PageHead, Pill } from '@/portal/ui'
import { ghostBtn, muted, sectionLabel } from '@/portal/modules/academicShared'

// Phase T5 §2/§3 (.agents/edunova/phase-t5-full-solver.md) — the soft-constraint/preference model, made
// tangible: two weight tables (Mode 4's assignment-scoring signals, and the SA refinement engine's
// soft-constraint penalties) plus the 7 named PreferenceProfiles, which pre-fill sensible REFINEMENT-scope
// weight overrides a school can still hand-adjust afterward. A routed page (not a modal) per D9 — three
// independent stateful sub-editors (profile picker, two weight tables) is exactly the "genuinely multi-
// state screen" bar the earlier T2/T3 page-not-modal conversions used.

const ASSIGNMENT_LABELS: Record<AssignmentPreferenceType, string> = {
  QUALIFICATION_MATCH: 'Qualification match',
  AVAILABILITY_MATCH: 'Availability match',
  WORKLOAD_BALANCE: 'Workload balance',
  CLASS_SUITABILITY: 'Class suitability',
  TEACHER_PREFERENCE: 'Teacher preference',
  CONFLICT_MINIMIZATION: 'Conflict minimization',
  BAND_AFFINITY: 'Band affinity',
}
const ASSIGNMENT_ORDER = Object.keys(ASSIGNMENT_LABELS) as AssignmentPreferenceType[]

const REFINEMENT_LABELS: Record<RefinementPreferenceType, string> = {
  LAB_SPLIT: 'Lab splits',
  TEACHER_DAILY_OVERLOAD: 'Teacher daily overload',
  TEACHER_WEEKLY_OVERLOAD: 'Teacher weekly overload',
  WORKLOAD_VARIANCE: 'Workload variance',
  TEACHER_GAPS: 'Teacher gaps',
  UNPREFERRED_SLOT: 'Unpreferred slots',
  FORCED_SAME_DAY_REPEAT: 'Forced same-day repeats',
  ADJACENT_SAME_SUBJECT: 'Adjacent same subject',
}
const REFINEMENT_TIER: Record<RefinementPreferenceType, 'Major' | 'Workload' | 'Minor'> = {
  LAB_SPLIT: 'Major', TEACHER_DAILY_OVERLOAD: 'Major', TEACHER_WEEKLY_OVERLOAD: 'Major',
  WORKLOAD_VARIANCE: 'Workload', TEACHER_GAPS: 'Workload',
  UNPREFERRED_SLOT: 'Minor', FORCED_SAME_DAY_REPEAT: 'Minor', ADJACENT_SAME_SUBJECT: 'Minor',
}
const REFINEMENT_ORDER = Object.keys(REFINEMENT_LABELS) as RefinementPreferenceType[]
const TIER_TONE = { Major: 'rose', Workload: 'amber', Minor: 'slate' } as const

const PROFILE_LABELS: Record<PreferenceProfileName, string> = {
  DEFAULT: 'Default', BALANCED: 'Balanced', TEACHER_FRIENDLY: 'Teacher-friendly', STUDENT_FRIENDLY: 'Student-friendly',
  EXAM_PREP: 'Exam prep', PRIMARY_SCHOOL: 'Primary school', LAB_HEAVY: 'Lab-heavy',
}
const PROFILE_ORDER = Object.keys(PROFILE_LABELS) as PreferenceProfileName[]

export default function TimetablePreferences() {
  const navigate = useNavigate()
  const assignmentPrefs = usePreferences('ASSIGNMENT')
  const refinementPrefs = usePreferences('REFINEMENT')
  const profiles = usePreferenceProfiles()

  const activeProfile = useMemo(() => profiles.items.find(p => p.active), [profiles.items])
  const assignmentByType = useMemo(() => new Map(assignmentPrefs.items.map(p => [p.type, p])), [assignmentPrefs.items])
  const refinementByType = useMemo(() => new Map(refinementPrefs.items.map(p => [p.type, p])), [refinementPrefs.items])

  const needsSeed = assignmentPrefs.items.length === 0 && refinementPrefs.items.length === 0
  const needsProfileSeed = profiles.items.length === 0
  const busy = assignmentPrefs.busy || refinementPrefs.busy || profiles.busy

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f6f4] dark:bg-[#090911]">
      <header className="glass-nav">
        <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-6">
          <Link to="/portal"><Logo /></Link>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-[14px] font-medium text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">
              <ArrowLeft size={16} /> Back
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <PageHead title="Timetable Preferences"
          sub="Weights that drive Mode 4's teacher scoring and the refinement engine's soft-constraint penalties — see the exact numbers a generation run actually used." />

        {needsSeed ? (
          <Card>
            <Empty text="No preference weights configured yet." />
            <button onClick={() => { assignmentPrefs.seedDefaults(); refinementPrefs.seedDefaults() }} disabled={busy}
              className="btn-ink mt-4 w-full py-3 text-[14px] font-semibold disabled:opacity-40">
              {busy ? 'Setting up…' : 'Set up default weights'}
            </button>
          </Card>
        ) : (
          <div className="space-y-5">
            {/* ── Preference profiles ───────────────────────────── */}
            <Card>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className={sectionLabel}>Preference profile</p>
                {needsProfileSeed && (
                  <button onClick={() => profiles.seedDefaults()} disabled={busy} className={ghostBtn}>Set up the 7 named profiles</button>
                )}
              </div>
              {needsProfileSeed ? (
                <p className={muted}>No profiles yet — set them up to pre-fill the refinement weights below with a sensible starting point per school type.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {PROFILE_ORDER.map(name => {
                    const p = profiles.items.find(x => x.name === name)
                    if (!p) return null
                    const active = p.active
                    return (
                      <div key={name} className={`rounded-2xl border p-4 transition ${active ? 'border-indigo-400 bg-indigo-50/60 dark:border-indigo-500/50 dark:bg-indigo-500/10' : 'border-black/[.08] dark:border-white/[.10]'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[14px] font-semibold">{PROFILE_LABELS[name]}</p>
                          {active && <Pill tone="indigo"><CheckCircle2 size={11} /> Active</Pill>}
                        </div>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-black/55 dark:text-white/55">{p.description}</p>
                        {!active && (
                          <button onClick={() => profiles.activate(name)} disabled={busy}
                            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.06] disabled:opacity-40">
                            <Sparkles size={12} /> Activate
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>

            {/* ── Assignment scoring weights (Mode 4) ───────────────────────────── */}
            <Card>
              <p className={sectionLabel}>Assignment scoring · Mode 4 (Optimized)</p>
              <p className={`mt-1 mb-4 ${muted}`}>How the solver scores candidate teachers when a requirement is set to Optimized mode. Not affected by the preference profile above.</p>
              <div className="space-y-3">
                {ASSIGNMENT_ORDER.map(type => {
                  const row = assignmentByType.get(type)
                  if (!row) return null
                  return (
                    <WeightRow key={type} label={ASSIGNMENT_LABELS[type]} weight={row.weight} enabled={row.enabled} max={50} step={1}
                      busy={assignmentPrefs.busy}
                      onWeight={w => assignmentPrefs.update(type, { weight: w })}
                      onEnabled={e => assignmentPrefs.update(type, { enabled: e })} />
                  )
                })}
              </div>
            </Card>

            {/* ── Refinement weights (SA soft-constraint scoring) ───────────────────────────── */}
            <Card>
              <p className={sectionLabel}>Refinement weights · soft-constraint scoring</p>
              <p className={`mt-1 mb-4 ${muted}`}>
                {activeProfile ? <>Effective values under the active <strong>{PROFILE_LABELS[activeProfile.name]}</strong> profile — adjusting one edits that profile's own overrides.</>
                  : 'Base weights the SA refinement pass optimizes against, staged Major (lab splits, teacher overload) &gt;&gt; Workload &gt;&gt; Minor so a lower tier can never outweigh a unit of the tier above it.'}
              </p>
              <div className="space-y-3">
                {REFINEMENT_ORDER.map(type => {
                  const row = refinementByType.get(type)
                  if (!row) return null
                  const override = activeProfile?.weightOverrides?.[type]
                  const effective = override ?? row.weight
                  return (
                    <WeightRow key={type} label={REFINEMENT_LABELS[type]} weight={effective} enabled={row.enabled} max={5} step={0.1}
                      tier={REFINEMENT_TIER[type]} overridden={override !== undefined}
                      busy={refinementPrefs.busy || profiles.busy}
                      onWeight={w => activeProfile ? profiles.update(activeProfile.name, { [type]: w }) : refinementPrefs.update(type, { weight: w })}
                      onEnabled={e => refinementPrefs.update(type, { enabled: e })} />
                  )
                })}
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}

/** Local draft value while dragging/typing — commits (one PATCH) on release/blur/Enter rather than on
 * every pixel of range-slider movement, same "draft then commit" convention as the periods-per-week
 * input above. */
function WeightRow({ label, weight, enabled, max, step, tier, overridden, busy, onWeight, onEnabled }: {
  label: string; weight: number; enabled: boolean; max: number; step: number
  tier?: 'Major' | 'Workload' | 'Minor'; overridden?: boolean; busy: boolean
  onWeight: (w: number) => void; onEnabled: (e: boolean) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const value = draft ?? weight
  const commit = () => { if (draft !== null && draft !== weight) onWeight(draft); setDraft(null) }
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 ${enabled ? '' : 'opacity-50'}`}>
      <label className="flex w-44 shrink-0 items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={e => onEnabled(e.target.checked)} disabled={busy} className="h-4 w-4 accent-indigo-600" />
        <span className="truncate text-[13.5px] font-medium">{label}</span>
      </label>
      {tier && <Pill tone={TIER_TONE[tier]}>{tier}</Pill>}
      {overridden && <Pill tone="indigo">profile override</Pill>}
      <input type="range" min={0} max={max} step={step} value={value} disabled={busy || !enabled}
        onChange={e => setDraft(Number(e.target.value))} onMouseUp={commit} onTouchEnd={commit} onKeyUp={commit}
        className="h-1.5 min-w-[120px] flex-1 accent-indigo-600" aria-label={`${label} weight`} />
      <input type="number" min={0} max={max * 10} step={step} value={value} disabled={busy || !enabled}
        onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) setDraft(n) }}
        onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="w-20 rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-[#14141f] px-2 py-1 text-right text-[13px] tabular-nums outline-none focus:border-indigo-400"
        aria-label={`${label} weight value`} />
    </div>
  )
}
