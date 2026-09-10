import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { api, errorMessage } from '../api'
import { qs, useList, useOne } from './useAcademics'
import type {
  EnforcementMode, PerformanceBand, SectioningDistributionConfig, SectioningScoreSource, SectioningStrategy,
  SectioningTemplate, SectioningVersion, SubjectScoreRule, TrackEligibilityException, TrackEligibilityRule, TrackRegisterResult,
} from '../data'

// Data hooks for Phase T3 — the Sectioning Engine. Components live in src/portal/modules/sectioning.tsx and
// src/pages/portal/SectioningDraftReview.tsx. See .agents/edunova/phase-t3-sectioning-engine.md and
// server/src/modules/sectioning/{router,service,schema}.ts (source of truth for these shapes).

export const SECTIONING_STRATEGIES: { value: SectioningStrategy; label: string; hint: string }[] = [
  { value: 'BALANCED', label: 'Balanced', hint: 'Each section gets the same band-mix percentage, largest-remainder rounding.' },
  { value: 'RANKED', label: 'Ranked', hint: 'Sort by score, fill each section to capacity in order.' },
  { value: 'BANDED', label: 'Banded', hint: 'Split into broad bands first, then balance within each.' },
  { value: 'STRATIFIED_CAPPED', label: 'Stratified (capped)', hint: 'Balanced, but with a hard per-section cap on each band.' },
  { value: 'RANDOM_PARITY', label: 'Random parity', hint: 'Random placement, then swap until the band mix is within tolerance.' },
  { value: 'SKIM_THEN_BALANCE', label: 'Skim then balance', hint: 'Remove a merit skim first, then run another strategy on the remainder.' },
]
export const SCORE_SOURCES: { value: SectioningScoreSource; label: string }[] = [
  { value: 'LATEST_EXAM', label: 'Latest exam' },
  { value: 'EXAM_AVERAGE', label: 'Exam average (weighted)' },
  { value: 'CUSTOM_WEIGHTING', label: 'Custom subject weighting' },
]
export const ENFORCEMENT_MODES: { value: EnforcementMode; label: string; hint: string }[] = [
  { value: 'STRICT', label: 'Strict', hint: 'A student who fails this rule is rejected unless an authorized staff/admin overrides with a reason.' },
  { value: 'ADVISORY', label: 'Advisory', hint: 'A student who fails this rule is registered anyway, flagged for visibility.' },
]

/* ── Bands (§1) ─────────────────────────────────────────── */

export function useBands(academicYearId?: string, enabled = true) {
  return useList<PerformanceBand>(enabled ? `/sectioning/bands${qs({ academicYearId })}` : null)
}
export function useBandActions() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg: string) => {
    setBusy(true)
    try { const out = await fn(); toast.success(okMsg); return out } catch (e) { toast.error(errorMessage(e)); return null } finally { setBusy(false) }
  }, [])
  return {
    busy,
    create: (body: { academicYearId: string; label: string; minScore: number; maxScore: number }) =>
      run(() => api.post<{ item: PerformanceBand }>('/sectioning/bands', body).then(r => r.item), 'Band created'),
    update: (id: string, body: Partial<{ label: string; minScore: number; maxScore: number }>) =>
      run(() => api.patch<{ item: PerformanceBand }>(`/sectioning/bands/${id}`, body).then(r => r.item), 'Band updated'),
    remove: (id: string) => run(() => api.del(`/sectioning/bands/${id}`), 'Band deleted'),
  }
}

/* ── Templates (§2) ─────────────────────────────────────── */

export interface TemplateInput {
  academicYearId: string; gradeId: string; name: string; strategy: SectioningStrategy; scoreSource: SectioningScoreSource
  subjectWeights?: Record<string, number>; bandIds: string[]; distributionConfig?: SectioningDistributionConfig
  sectionOrder: string[]; respectExisting?: boolean
}
export function useTemplates(filter: { academicYearId?: string; gradeId?: string } = {}, enabled = true) {
  return useList<SectioningTemplate>(enabled ? `/sectioning/templates${qs(filter)}` : null)
}
export function useTemplateActions() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string) => {
    setBusy(true)
    try { const out = await fn(); if (okMsg) toast.success(okMsg); return out } catch (e) { toast.error(errorMessage(e)); return null } finally { setBusy(false) }
  }, [])
  return {
    busy,
    create: (body: TemplateInput) => run(() => api.post<{ item: SectioningTemplate }>('/sectioning/templates', body).then(r => r.item), 'Template created'),
    update: (id: string, body: Partial<TemplateInput>) => run(() => api.patch<{ item: SectioningTemplate }>(`/sectioning/templates/${id}`, body).then(r => r.item), 'Template updated'),
    remove: (id: string) => run(() => api.del(`/sectioning/templates/${id}`), 'Template deleted'),
    /** Runs the template — returns the new DRAFT version (never writes real placements). */
    generate: (id: string, scopeCohortId?: string) => run(() => api.post<{ item: SectioningVersion }>(`/sectioning/templates/${id}/generate`, scopeCohortId ? { scopeCohortId } : {}).then(r => r.item)),
  }
}

/* ── Versions / draft review / approval / moves (§4) ───── */

export function useTemplateVersions(templateId?: string, enabled = true) {
  return useList<SectioningVersion>(enabled && templateId ? `/sectioning/templates/${encodeURIComponent(templateId)}/versions` : null)
}
export function useVersion(id?: string, enabled = true) {
  return useOne<SectioningVersion>(enabled && id ? `/sectioning/versions/${encodeURIComponent(id)}` : null)
}
export function useVersionActions() {
  const [busy, setBusy] = useState<'approve' | 'move' | null>(null)
  const approve = async (id: string, force = false) => {
    setBusy('approve')
    try { return await api.post<{ item: SectioningVersion }>(`/sectioning/versions/${id}/approve`, { force }).then(r => r.item) } finally { setBusy(null) }
  }
  const move = async (body: { studentId: string; toCohortId: string; reason: string }) => {
    setBusy('move')
    try { return await api.post<{ item: { studentId: string; toCohortId: string } }>('/sectioning/moves', body).then(r => r.item) } finally { setBusy(null) }
  }
  return { busy, approve, move }
}

/* ── Track eligibility (§3) ─────────────────────────────── */

export function useTrackRules(trackActivityId?: string, enabled = true) {
  return useList<TrackEligibilityRule>(enabled ? `/sectioning/track-eligibility-rules${qs({ trackActivityId })}` : null)
}
export interface RuleInput { trackActivityId: string; label: string; subjectScoreRules: SubjectScoreRule[]; enforcementMode: EnforcementMode }
export function useRuleActions() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg: string) => {
    setBusy(true)
    try { const out = await fn(); toast.success(okMsg); return out } catch (e) { toast.error(errorMessage(e)); return null } finally { setBusy(false) }
  }, [])
  return {
    busy,
    create: (body: RuleInput) => run(() => api.post<{ item: TrackEligibilityRule }>('/sectioning/track-eligibility-rules', body).then(r => r.item), 'Eligibility rule created'),
    update: (id: string, body: Partial<RuleInput>) => run(() => api.patch<{ item: TrackEligibilityRule }>(`/sectioning/track-eligibility-rules/${id}`, body).then(r => r.item), 'Eligibility rule updated'),
    remove: (id: string) => run(() => api.del(`/sectioning/track-eligibility-rules/${id}`), 'Eligibility rule deleted'),
  }
}

/** `POST /sectioning/tracks/:activityId/register` — a student registering themselves, or staff/admin
 * registering on a student's behalf. `overrideReason` is only consumed when a STRICT rule failed; the
 * caller should retry with it once the first attempt's 409 names the unmet rule(s). */
export async function registerForTrack(activityId: string, body: { studentId?: string; overrideReason?: string } = {}) {
  return api.post<TrackRegisterResult>(`/sectioning/tracks/${encodeURIComponent(activityId)}/register`, body)
}

export function useEligibilityExceptions(trackActivityId?: string, enabled = true) {
  return useList<TrackEligibilityException>(enabled ? `/sectioning/track-eligibility-exceptions${qs({ trackActivityId })}` : null)
}
