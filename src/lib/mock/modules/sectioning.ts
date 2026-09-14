// Phase T3 — Sectioning Engine. See .agents/edunova/phase-t3-sectioning-engine.md and (read-only
// reference) server/src/modules/sectioning/{router,service,schema,strategies,scoring}.ts.
//
// SIMULATED: the score a student is sectioned on. The real backend derives it from Phase 3
// Assessment/Mark data (or T2 PriorSubjectScore for a fresh external admit) — that data isn't part of
// this batch's seed, so `computeScore()`/`scoreForSubjectRule()` below hash the student id into a
// stable 0-100 number instead. It's deterministic (same student always lands in the same band across
// reloads/runs) and spreads students realistically across every configured band, which is all a demo
// needs — see the static-demo-plan's "simulate the algorithm, not the surrounding logic" guidance.
//
// REAL (ported near-verbatim from strategies.ts, which is itself pure/DB-free — a genuine "simple
// deterministic rule that looks like the chosen strategy ran", not a duplicated optimizer): all 6
// strategies, largest-remainder allocation, the deterministic tie-breaker, and SKIM_THEN_BALANCE's
// composition over another strategy's own function.
//
// REAL: band-mix tolerance validation, capacity/unassigned validation, the DRAFT → validate → approve
// (blocked unless `force`) version lifecycle, individual audited moves outside that pipeline, and the
// STRICT (409 unless an authorized override with a mandatory reason) vs ADVISORY (allowed through,
// flagged) track-eligibility flow with its exceptions report.

import { route, requireAuth, requireRole, crud, status } from '../router'
import { table, saveTable, uid, nowIso, type Row } from '../store'
import { notFound, badRequest, forbidden, conflict } from '../http'

const WRITE_ROLES = ['admin', 'superadmin']
const STAFF_ROLES = ['teacher', 'staff', 'admin', 'superadmin']

// ─────────────────────────────── score simulation (see file header) ───────────────────────────────

function hashInt(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h)
}
function computeScore(studentId: string, academicYearId: string, scoreSource: string): number {
  return 40 + (hashInt(`${studentId}:${academicYearId}:${scoreSource}`) % 61) // 40-100
}
function scoreForSubjectRule(studentId: string, rule: { subjectId?: string; subjectName?: string }): number {
  return 35 + (hashInt(`${studentId}:${rule.subjectId ?? rule.subjectName ?? ''}`) % 66) // 35-100
}

// ─────────────────────────────── §2 strategies (ported from strategies.ts) ───────────────────────────────

interface ScoredStudent { studentId: string; name: string; rollNo: string; score: number }
interface Band { label: string; minScore: number; maxScore: number }
interface Assignment { studentId: string; sectionId: string; band?: string }
interface StrategyOutput { assignments: Assignment[]; warnings: string[]; overflow?: string[] }
type StrategyFn = (students: ScoredStudent[], sections: string[], bands: Band[]) => StrategyOutput

const tieBreak = (a: ScoredStudent, b: ScoredStudent) => b.score - a.score || a.rollNo.localeCompare(b.rollNo) || a.name.localeCompare(b.name)
const bandOf = (score: number, bands: Band[]): string | undefined => bands.find(b => score >= b.minScore && score <= b.maxScore)?.label

function allocateCounts(n: number, buckets: number): number[] {
  if (buckets <= 0) return []
  const base = Math.floor(n / buckets)
  const remainder = n - base * buckets
  return Array.from({ length: buckets }, (_, i) => base + (i < remainder ? 1 : 0))
}

function collapseBands(bands: Band[], groups: number): Band[] {
  const sorted = [...bands].sort((a, b) => a.minScore - b.minScore)
  const g = Math.max(1, Math.min(groups, sorted.length))
  const chunkSize = Math.ceil(sorted.length / g)
  const out: Band[] = []
  for (let i = 0; i < sorted.length; i += chunkSize) {
    const chunk = sorted.slice(i, i + chunkSize)
    if (!chunk.length) continue
    out.push({ label: `${chunk[0].label}–${chunk[chunk.length - 1].label}`, minScore: chunk[0].minScore, maxScore: chunk[chunk.length - 1].maxScore })
  }
  return out
}

function runBalanced(students: ScoredStudent[], sections: string[], bands: Band[]): StrategyOutput {
  if (!sections.length) return { assignments: [], warnings: ['No target sections configured'] }
  const warnings: string[] = []
  const byBand = new Map<string, ScoredStudent[]>()
  const noBand: ScoredStudent[] = []
  for (const s of students) {
    const b = bandOf(s.score, bands)
    if (!b) { noBand.push(s); continue }
    if (!byBand.has(b)) byBand.set(b, [])
    byBand.get(b)!.push(s)
  }
  if (noBand.length) warnings.push(`${noBand.length} scored student(s) fall outside every configured band and were placed by round-robin fallback`)

  const assignments: Assignment[] = []
  for (const [band, list] of byBand) {
    list.sort(tieBreak)
    const counts = allocateCounts(list.length, sections.length)
    let idx = 0
    sections.forEach((sec, i) => {
      for (let k = 0; k < counts[i]; k++) { assignments.push({ studentId: list[idx].studentId, sectionId: sec, band }); idx++ }
    })
  }
  noBand.sort(tieBreak)
  noBand.forEach((s, i) => assignments.push({ studentId: s.studentId, sectionId: sections[i % sections.length] }))
  return { assignments, warnings }
}

function runRanked(students: ScoredStudent[], sections: string[], bands: Band[], capacityOf?: (sectionId: string) => number | undefined): StrategyOutput {
  if (!sections.length) return { assignments: [], warnings: ['No target sections configured'] }
  const sorted = [...students].sort(tieBreak)
  const defaultCap = Math.ceil(students.length / sections.length) || 1
  const assignments: Assignment[] = []
  let secIdx = 0, filled = 0
  for (const s of sorted) {
    let cap = capacityOf?.(sections[secIdx]) ?? defaultCap
    while (secIdx < sections.length - 1 && filled >= cap) { secIdx++; filled = 0; cap = capacityOf?.(sections[secIdx]) ?? defaultCap }
    assignments.push({ studentId: s.studentId, sectionId: sections[secIdx], band: bandOf(s.score, bands) })
    filled++
  }
  return { assignments, warnings: [] }
}

function runBanded(students: ScoredStudent[], sections: string[], bands: Band[], broadGroups = 3): StrategyOutput {
  return runBalanced(students, sections, collapseBands(bands, broadGroups))
}

function runStratifiedCapped(students: ScoredStudent[], sections: string[], bands: Band[], caps: Record<string, Record<string, number>>): StrategyOutput {
  if (!sections.length) return { assignments: [], warnings: ['No target sections configured'] }
  const warnings: string[] = []
  const byBand = new Map<string, ScoredStudent[]>()
  const noBand: ScoredStudent[] = []
  for (const s of students) {
    const b = bandOf(s.score, bands)
    if (!b) { noBand.push(s); continue }
    if (!byBand.has(b)) byBand.set(b, [])
    byBand.get(b)!.push(s)
  }
  const assignments: Assignment[] = []
  const overflow: string[] = []
  for (const [band, list] of byBand) {
    list.sort(tieBreak)
    const counts = allocateCounts(list.length, sections.length)
    let idx = 0
    const remaining = [...list]
    sections.forEach((sec, i) => {
      const cap = caps[sec]?.[band] ?? Infinity
      const want = Math.min(counts[i], cap)
      for (let k = 0; k < want; k++) { assignments.push({ studentId: remaining[idx].studentId, sectionId: sec, band }); idx++ }
    })
    while (idx < remaining.length) {
      const student = remaining[idx]
      const secWithRoom = sections.find(sec => {
        const cap = caps[sec]?.[band] ?? Infinity
        const used = assignments.filter(a => a.sectionId === sec && a.band === band).length
        return used < cap
      })
      if (secWithRoom) assignments.push({ studentId: student.studentId, sectionId: secWithRoom, band })
      else overflow.push(student.studentId)
      idx++
    }
  }
  noBand.sort(tieBreak)
  noBand.forEach(s => overflow.push(s.studentId))
  if (overflow.length) warnings.push(`${overflow.length} student(s) could not be placed within configured per-band caps and require manual placement`)
  return { assignments, warnings, overflow }
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hashSeed(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

function runRandomParity(students: ScoredStudent[], sections: string[], bands: Band[], opts?: { seed?: number; tolerancePct?: number; maxIterations?: number }): StrategyOutput {
  if (!sections.length) return { assignments: [], warnings: ['No target sections configured'] }
  const tolerancePct = opts?.tolerancePct ?? 8
  const maxIterations = opts?.maxIterations ?? 500
  const rng = mulberry32(opts?.seed ?? 42)

  const withBand = students.map(s => ({ ...s, band: bandOf(s.score, bands) ?? '__none__' }))
  const shuffled = [...withBand]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const assign = new Map<string, string>()
  shuffled.forEach((s, i) => assign.set(s.studentId, sections[i % sections.length]))

  const totalScored = withBand.length || 1
  const byBandCount = new Map<string, number>()
  for (const s of withBand) byBandCount.set(s.band, (byBandCount.get(s.band) ?? 0) + 1)
  const targetPct = new Map<string, number>()
  for (const [b, c] of byBandCount) targetPct.set(b, (c / totalScored) * 100)

  function worstCell() {
    const secTotal = new Map<string, number>()
    const counts = new Map<string, Map<string, number>>()
    for (const sec of sections) { counts.set(sec, new Map()); secTotal.set(sec, 0) }
    for (const s of withBand) {
      const sec = assign.get(s.studentId)!
      counts.get(sec)!.set(s.band, (counts.get(sec)!.get(s.band) ?? 0) + 1)
      secTotal.set(sec, secTotal.get(sec)! + 1)
    }
    let worst: { sec: string; band: string; dev: number } | null = null
    for (const sec of sections) {
      const total = secTotal.get(sec) || 1
      for (const [band, target] of targetPct) {
        const actual = ((counts.get(sec)!.get(band) ?? 0) / total) * 100
        const dev = actual - target
        if (!worst || Math.abs(dev) > Math.abs(worst.dev)) worst = { sec, band, dev }
      }
    }
    return worst
  }

  let iterations = 0
  let worst = worstCell()
  while (worst && Math.abs(worst.dev) > tolerancePct && iterations < maxIterations) {
    iterations++
    const { sec: hotSec, band: hotBand, dev } = worst
    let swapped = false
    const others = sections.filter(sec => sec !== hotSec)
    if (dev > 0) {
      const donor = withBand.find(s => assign.get(s.studentId) === hotSec && s.band === hotBand)
      if (donor) {
        for (const sec of others) {
          const recipient = withBand.find(s => assign.get(s.studentId) === sec && s.band !== hotBand)
          if (recipient) { assign.set(donor.studentId, sec); assign.set(recipient.studentId, hotSec); swapped = true; break }
        }
      }
    } else {
      for (const sec of others) {
        const donor = withBand.find(s => assign.get(s.studentId) === sec && s.band === hotBand)
        if (donor) {
          const recipient = withBand.find(s => assign.get(s.studentId) === hotSec && s.band !== hotBand)
          if (recipient) { assign.set(donor.studentId, hotSec); assign.set(recipient.studentId, sec); swapped = true; break }
        }
      }
    }
    if (!swapped) break
    worst = worstCell()
  }

  const warnings: string[] = []
  if (worst && Math.abs(worst.dev) > tolerancePct) {
    warnings.push(`Band-mix tolerance (${tolerancePct}pp) not fully met after ${iterations} swap iteration(s) — worst cell: section ${worst.sec}, band ${worst.band}, deviates ${worst.dev.toFixed(1)}pp`)
  }
  const assignments = withBand.map(s => ({ studentId: s.studentId, sectionId: assign.get(s.studentId)!, band: s.band === '__none__' ? undefined : s.band }))
  return { assignments, warnings }
}

function runSkimThenBalance(
  students: ScoredStudent[], sections: string[], bands: Band[],
  skim: { sectionId: string; count?: number; percentage?: number }[], remainderRun: StrategyFn,
): StrategyOutput {
  const sorted = [...students].sort(tieBreak)
  const assignments: Assignment[] = []
  const warnings: string[] = []
  let pool = sorted
  for (const sk of skim) {
    const n = sk.count ?? Math.round(((sk.percentage ?? 0) / 100) * sorted.length)
    const take = pool.slice(0, Math.max(0, n))
    take.forEach(s => assignments.push({ studentId: s.studentId, sectionId: sk.sectionId, band: bandOf(s.score, bands) }))
    pool = pool.slice(Math.max(0, n))
  }
  const skimmedSectionIds = new Set(skim.map(sk => sk.sectionId))
  const remainderSections = sections.filter(s => !skimmedSectionIds.has(s))
  const remainder = remainderRun(pool, remainderSections.length ? remainderSections : sections, bands)
  warnings.push(...remainder.warnings)
  assignments.push(...remainder.assignments)
  return { assignments, warnings, overflow: remainder.overflow }
}

type StrategyName = 'BALANCED' | 'RANKED' | 'BANDED' | 'STRATIFIED_CAPPED' | 'RANDOM_PARITY' | 'SKIM_THEN_BALANCE'

function runStrategy(strategy: StrategyName, students: ScoredStudent[], sections: string[], bands: Band[], config: Record<string, unknown>, templateId: string): StrategyOutput {
  switch (strategy) {
    case 'BALANCED': return runBalanced(students, sections, bands)
    case 'RANKED': return runRanked(students, sections, bands)
    case 'BANDED': return runBanded(students, sections, bands, (config.broadGroups as number) ?? 3)
    case 'STRATIFIED_CAPPED': return runStratifiedCapped(students, sections, bands, (config.caps as Record<string, Record<string, number>>) ?? {})
    case 'RANDOM_PARITY': return runRandomParity(students, sections, bands, { seed: hashSeed(templateId), tolerancePct: config.tolerancePct as number | undefined })
    case 'SKIM_THEN_BALANCE': {
      const remainderName = (config.remainderStrategy as StrategyName) ?? 'BALANCED'
      const remainderFn: StrategyFn = (s, sec, b) => runStrategy(remainderName, s, sec, b, config, templateId)
      return runSkimThenBalance(students, sections, bands, (config.skim as { sectionId: string; count?: number; percentage?: number }[]) ?? [], remainderFn)
    }
    default: return { assignments: [], warnings: [`Unknown strategy ${strategy as string}`] }
  }
}

// ─────────────────────────────── validation (ported) ───────────────────────────────

function validateAssignments(
  assignments: Assignment[], scored: ScoredStudent[], sections: string[], bands: Band[],
  capacities: Record<string, number | undefined>, tolerancePct: number, overflowIds: Set<string>,
) {
  const errors: string[] = []
  const countBySection = new Map<string, number>()
  for (const a of assignments) countBySection.set(a.sectionId, (countBySection.get(a.sectionId) ?? 0) + 1)
  for (const sec of sections) {
    const cap = capacities[sec]
    const count = countBySection.get(sec) ?? 0
    if (cap !== undefined && count > cap) errors.push(`Section ${sec} would have ${count} student(s), exceeding its capacity of ${cap}`)
  }

  const assignedIds = new Set(assignments.map(a => a.studentId))
  const missing = scored.filter(s => !assignedIds.has(s.studentId) && !overflowIds.has(s.studentId))
  if (missing.length) errors.push(`${missing.length} scored student(s) were not assigned to any section`)

  const totalByBand = new Map<string, number>()
  for (const s of scored) { const b = bandOf(s.score, bands); if (b) totalByBand.set(b, (totalByBand.get(b) ?? 0) + 1) }
  const totalScored = scored.length || 1
  const sectionBandMix: Record<string, Record<string, number>> = {}
  for (const sec of sections) {
    const secAssignments = assignments.filter(a => a.sectionId === sec)
    const secTotal = secAssignments.length || 1
    sectionBandMix[sec] = {}
    for (const [band, total] of totalByBand) {
      const secCount = secAssignments.filter(a => a.band === band).length
      const secPct = (secCount / secTotal) * 100
      const targetPct = (total / totalScored) * 100
      sectionBandMix[sec][band] = Math.round(secPct * 10) / 10
      if (secAssignments.length && Math.abs(secPct - targetPct) > tolerancePct) {
        errors.push(`Section ${sec}: band "${band}" mix is ${secPct.toFixed(1)}%, outside tolerance of target ${targetPct.toFixed(1)}% (±${tolerancePct}pp)`)
      }
    }
  }
  return { errors, sectionBandMix }
}

// ─────────────────────────────── §1 bands ───────────────────────────────

crud('/sectioning/bands', 'PerformanceBand', {
  writeRoles: WRITE_ROLES,
  filter: (r, q) => !q.academicYearId || r.academicYearId === q.academicYearId,
})

// ─────────────────────────────── §2 templates ───────────────────────────────

crud('/sectioning/templates', 'SectioningTemplate', {
  writeRoles: WRITE_ROLES,
  filter: (r, q) => (!q.academicYearId || r.academicYearId === q.academicYearId) && (!q.gradeId || r.gradeId === q.gradeId),
  deserialize: (b) => ({ respectExisting: true, bandIds: [], sectionOrder: [], ...b }),
})

// ─────────────────────────────── §2/§4 helpers shared by generate/approve/move ───────────────────────────────

// A section-backed Cohort is one of the T1-style auto-generated SECTION cohorts that map 1:1 onto a
// Class (see seed/sectioning.ts's file header) — `classIds` is the flat field src/lib/data.ts's `Cohort`
// type and modules/academic.ts's bootstrap serializer both use (this mock layer's convention; the real
// Prisma schema normalizes the same relationship into a CohortClass join table instead).
function cohortClassOf(cohortId: string): string | null {
  const cohort = table('Cohort').find(c => c.id === cohortId)
  if (!cohort?.autoGenerated || cohort.type !== 'SECTION') return null
  const classIds = (cohort.classIds as string[] | undefined) ?? []
  return classIds.length === 1 ? classIds[0] : null
}

function sectionCapacities(sectionOrder: string[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = {}
  for (const cohortId of sectionOrder) {
    const classId = cohortClassOf(cohortId)
    out[cohortId] = classId ? (table('Class').find(c => c.id === classId)?.capacity as number | undefined) : undefined
  }
  return out
}

function previousCohortFor(schoolId: string, templateId: string, studentId: string, fallbackClassId?: string): string | undefined {
  const versionIds = new Set(table('SectioningVersion').filter(v => v.templateId === templateId && v.status === 'APPROVED').map(v => v.id))
  const past = table('SectioningAssignment')
    .filter(a => a.schoolId === schoolId && a.studentId === studentId && versionIds.has(a.versionId as string))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  if (past[0]) return past[0].cohortId as string
  if (fallbackClassId) {
    const cohort = table('Cohort').find(c => c.autoGenerated && c.type === 'SECTION' && ((c.classIds as string[] | undefined) ?? []).includes(fallbackClassId))
    return cohort?.id as string | undefined
  }
  return undefined
}

function siblingsOf(schoolId: string, studentId: string): string[] {
  const guardians = table('Guardian').filter(g => g.schoolId === schoolId && g.studentId === studentId)
  const parentIds = guardians.map(g => g.parentId)
  if (!parentIds.length) return []
  const siblingGuardians = table('Guardian').filter(g => g.schoolId === schoolId && parentIds.includes(g.parentId) && g.studentId !== studentId)
  return [...new Set(siblingGuardians.map(g => g.studentId as string))]
}

interface PopulationEntry { studentId: string; name: string; rollNo: string; previousCohortId?: string }

function regularPopulation(schoolId: string, template: Row): PopulationEntry[] {
  const classes = table('Class').filter(c => c.gradeId === template.gradeId)
  const classIds = new Set(classes.map(c => c.id))
  const enrollments = table('Enrollment').filter(e => e.schoolId === schoolId && e.academicYearId === template.academicYearId && e.status === 'active' && classIds.has(e.classId as string))
  return enrollments.map(e => {
    const student = table('User').find(u => u.id === e.studentId)
    return {
      studentId: e.studentId as string, name: String(student?.name ?? e.studentId), rollNo: String(e.rollNo ?? e.studentId),
      previousCohortId: previousCohortFor(schoolId, template.id, e.studentId as string, e.classId as string),
    }
  })
}

function scopedPopulation(schoolId: string, template: Row, cohortId: string): PopulationEntry[] {
  const members = table('CohortMembership').filter(m => m.schoolId === schoolId && m.cohortId === cohortId)
  return members.map(m => {
    const student = table('User').find(u => u.id === m.studentId)
    const enrollment = table('Enrollment').find(e => e.studentId === m.studentId && e.academicYearId === template.academicYearId)
    return {
      studentId: m.studentId as string, name: String(student?.name ?? m.studentId), rollNo: String(enrollment?.rollNo ?? m.studentId),
      previousCohortId: previousCohortFor(schoolId, template.id, m.studentId as string),
    }
  })
}

interface VersionSummary {
  scoredCount: number; unscoredStudentIds: string[]; overflowStudentIds: string[]; warnings: string[]
  sectionBandMix: Record<string, Record<string, number>>; validation: { errors: string[]; warnings: string[] }
}

function serializeVersion(v: Row) {
  const assignments = table('SectioningAssignment').filter(a => a.versionId === v.id)
  return {
    id: v.id, templateId: v.templateId, academicYearId: v.academicYearId, scopeCohortId: v.scopeCohortId ?? undefined,
    status: v.status, parentVersionId: v.parentVersionId ?? undefined, summary: v.summary as VersionSummary,
    approvedAt: v.approvedAt ?? undefined, approvedById: v.approvedById ?? undefined, createdAt: v.createdAt,
    assignments: assignments.map(a => ({
      studentId: a.studentId, cohortId: a.cohortId, previousCohortId: a.previousCohortId ?? undefined,
      band: a.band ?? undefined, score: a.score ?? undefined,
    })),
  }
}

function getTemplate(schoolId: string, id: string): Row {
  const row = table('SectioningTemplate').find(t => t.id === id && t.schoolId === schoolId)
  if (!row) throw notFound('Sectioning template')
  return row
}

function getVersion(schoolId: string, id: string): Row {
  const row = table('SectioningVersion').find(v => v.id === id && v.schoolId === schoolId)
  if (!row) throw notFound('Sectioning version')
  return row
}

// ── generate a DRAFT (never writes real placements — see approve below) ──
route('POST', '/sectioning/templates/:id/generate', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const template = getTemplate(actor.schoolId, ctx.params.id)
  const scopeCohortId = ctx.body.scopeCohortId as string | undefined
  if (scopeCohortId && !table('Cohort').find(c => c.id === scopeCohortId && c.schoolId === actor.schoolId)) throw notFound('Scope cohort')

  const bandRows = table('PerformanceBand').filter(b => (template.bandIds as string[]).includes(b.id))
  const bandList: Band[] = bandRows.map(b => ({ label: String(b.label), minScore: Number(b.minScore), maxScore: Number(b.maxScore) }))

  const population = scopeCohortId ? scopedPopulation(actor.schoolId, template, scopeCohortId) : regularPopulation(actor.schoolId, template)

  const scored: ScoredStudent[] = population.map(p => ({
    studentId: p.studentId, name: p.name, rollNo: p.rollNo,
    score: computeScore(p.studentId, template.academicYearId as string, template.scoreSource as string),
  }))
  const unscoredStudentIds: string[] = [] // simulated scoring always succeeds — see file header

  const capacities = sectionCapacities(template.sectionOrder as string[])
  const config = (template.distributionConfig as Record<string, unknown>) ?? {}
  const result = runStrategy(template.strategy as StrategyName, scored, template.sectionOrder as string[], bandList, config, template.id as string)
  const overflowIds = new Set(result.overflow ?? [])
  const tolerancePct = (config.bandMixTolerancePct as number) ?? 15

  const { errors, sectionBandMix } = validateAssignments(result.assignments, scored, template.sectionOrder as string[], bandList, capacities, tolerancePct, overflowIds)
  const warnings = [...result.warnings]

  if (config.siblingsTogether) {
    const assignMap = new Map(result.assignments.map(a => [a.studentId, a.sectionId]))
    const nameOf = new Map(population.map(p => [p.studentId, p.name]))
    const checked = new Set<string>()
    for (const s of scored) {
      if (checked.has(s.studentId)) continue
      const sibs = siblingsOf(actor.schoolId, s.studentId).filter(id => assignMap.has(id))
      for (const sibId of sibs) {
        if (checked.has(sibId)) continue
        const mySec = assignMap.get(s.studentId)
        const sibSec = assignMap.get(sibId)
        if (mySec && sibSec && mySec !== sibSec) {
          warnings.push(`Siblings ${nameOf.get(s.studentId) ?? s.studentId} and ${nameOf.get(sibId) ?? sibId} were placed in different sections`)
        }
      }
      checked.add(s.studentId)
    }
  }

  const scoreOf = new Map(scored.map(s => [s.studentId, s.score]))
  const prevOf = new Map(population.map(p => [p.studentId, p.previousCohortId]))

  const version: Row = {
    id: uid('sectver'), schoolId: actor.schoolId, templateId: template.id, academicYearId: template.academicYearId,
    scopeCohortId: scopeCohortId ?? null, status: 'DRAFT', parentVersionId: null,
    summary: {
      scoredCount: scored.length, unscoredStudentIds, overflowStudentIds: [...overflowIds], warnings,
      sectionBandMix, validation: { errors, warnings },
    } as VersionSummary,
    approvedAt: null, approvedById: null, createdAt: nowIso(),
  }
  const versions = table('SectioningVersion')
  versions.push(version)
  saveTable('SectioningVersion', versions)

  const assignmentRows = table('SectioningAssignment')
  for (const a of result.assignments) {
    assignmentRows.push({
      id: uid('secta'), versionId: version.id, schoolId: actor.schoolId, studentId: a.studentId, cohortId: a.sectionId,
      previousCohortId: prevOf.get(a.studentId) ?? null, band: a.band ?? null, score: scoreOf.get(a.studentId) ?? null, createdAt: nowIso(),
    } as Row)
  }
  saveTable('SectioningAssignment', assignmentRows)

  return status(201, { item: serializeVersion(version) })
})

route('GET', '/sectioning/templates/:id/versions', (ctx) => {
  const actor = requireAuth(ctx)
  const items = table('SectioningVersion')
    .filter(v => v.schoolId === actor.schoolId && v.templateId === ctx.params.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(serializeVersion)
  return { items }
})

route('GET', '/sectioning/versions/:id', (ctx) => {
  const actor = requireAuth(ctx)
  return { item: serializeVersion(getVersion(actor.schoolId, ctx.params.id)) }
})

route('POST', '/sectioning/versions/:id/approve', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const version = getVersion(actor.schoolId, ctx.params.id)
  if (version.status !== 'DRAFT') throw badRequest('Only a DRAFT version can be approved')
  const force = !!ctx.body.force
  const validation = (version.summary as VersionSummary).validation
  if (!force && validation.errors.length) {
    throw conflict('This draft has blocking validation errors — resolve them or approve with force', { errors: validation.errors })
  }

  const assignments = table('SectioningAssignment').filter(a => a.versionId === version.id)
  for (const a of assignments) {
    const classId = cohortClassOf(a.cohortId as string)
    if (classId) {
      const enrollments = table('Enrollment')
      const idx = enrollments.findIndex(e => e.studentId === a.studentId && e.academicYearId === version.academicYearId)
      if (idx !== -1 && enrollments[idx].classId !== classId) {
        enrollments[idx] = { ...enrollments[idx], classId }
        saveTable('Enrollment', enrollments)
      }
    } else {
      const memberships = table('CohortMembership')
      if (!memberships.find(m => m.cohortId === a.cohortId && m.studentId === a.studentId)) {
        memberships.push({ id: uid('cm'), schoolId: actor.schoolId, cohortId: a.cohortId, studentId: a.studentId, createdAt: nowIso() } as Row)
        saveTable('CohortMembership', memberships)
      }
    }
  }

  const versions = table('SectioningVersion')
  const idx = versions.findIndex(v => v.id === version.id)
  versions[idx] = { ...versions[idx], status: 'APPROVED', approvedAt: nowIso(), approvedById: actor.userId }
  saveTable('SectioningVersion', versions)

  return { item: serializeVersion(versions[idx]) }
})

// individual move — an audited edit outside the version pipeline (§4 — "movement is a feature, not a bug")
route('POST', '/sectioning/moves', (ctx) => {
  const actor = requireRole(ctx, ...WRITE_ROLES)
  const studentId = ctx.body.studentId as string | undefined
  const toCohortId = ctx.body.toCohortId as string | undefined
  const reason = typeof ctx.body.reason === 'string' ? ctx.body.reason.trim() : ''
  if (!studentId || !toCohortId) throw badRequest('studentId and toCohortId are required')
  if (!reason) throw badRequest('A reason is required for an individual move')

  const cohort = table('Cohort').find(c => c.id === toCohortId && c.schoolId === actor.schoolId)
  if (!cohort) throw notFound('Target cohort')
  const student = table('User').find(u => u.id === studentId && u.schoolId === actor.schoolId && u.role === 'student')
  if (!student) throw notFound('Student')

  const classId = cohortClassOf(toCohortId)
  if (classId) {
    const cls = table('Class').find(c => c.id === classId)
    if (!cls) throw notFound('Class')
    const enrollments = table('Enrollment')
    const idx = enrollments.findIndex(e => e.studentId === studentId && e.academicYearId === cls.academicYearId)
    if (idx === -1) throw notFound('Enrollment')
    enrollments[idx] = { ...enrollments[idx], classId }
    saveTable('Enrollment', enrollments)
  } else {
    const memberships = table('CohortMembership')
    if (!memberships.find(m => m.cohortId === toCohortId && m.studentId === studentId)) {
      memberships.push({ id: uid('cm'), schoolId: actor.schoolId, cohortId: toCohortId, studentId, createdAt: nowIso() } as Row)
      saveTable('CohortMembership', memberships)
    }
  }
  return status(201, { item: { studentId, toCohortId } })
})

// ─────────────────────────────── §3 track eligibility ───────────────────────────────

crud('/sectioning/track-eligibility-rules', 'TrackEligibilityRule', {
  writeRoles: WRITE_ROLES,
  filter: (r, q) => !q.trackActivityId || r.trackActivityId === q.trackActivityId,
})

interface SubjectScoreRule { subjectId?: string; subjectName?: string; minScore: number }
interface SubjectRuleResult { rule: SubjectScoreRule; passed: boolean; actual: number | null; source: 'MARKS' | 'PRIOR' | 'NONE' }
interface RuleEvaluation { ruleId: string; label: string; enforcementMode: string; results: SubjectRuleResult[]; passed: boolean }

function serializeRegistration(r: Row) {
  const user = table('User').find(u => u.id === r.userId)
  return { id: r.id, activityId: r.activityId, userId: r.userId, registeredAt: r.registeredAt, status: r.status, userName: user?.name, userRole: user?.role }
}

route('POST', '/sectioning/tracks/:activityId/register', (ctx) => {
  const actor = requireAuth(ctx)
  const activity = table('Activity').find(a => a.id === ctx.params.activityId && a.schoolId === actor.schoolId)
  if (!activity) throw notFound('Track activity')

  let studentId: string
  const bodyStudentId = ctx.body.studentId as string | undefined
  if (actor.role === 'student') {
    if (bodyStudentId && bodyStudentId !== actor.userId) throw forbidden('Students may only register themselves')
    studentId = actor.userId
  } else {
    if (!STAFF_ROLES.includes(actor.role)) throw forbidden('Only staff/admin may register a student for a track')
    if (!bodyStudentId) throw badRequest('studentId is required')
    studentId = bodyStudentId
  }
  const student = table('User').find(u => u.id === studentId && u.schoolId === actor.schoolId && u.role === 'student')
  if (!student) throw notFound('Student')

  const rules = table('TrackEligibilityRule').filter(r => r.schoolId === actor.schoolId && r.trackActivityId === activity.id)
  const ruleResults: RuleEvaluation[] = rules.map(rule => {
    const subjectRules = rule.subjectScoreRules as SubjectScoreRule[]
    const results: SubjectRuleResult[] = subjectRules.map(sr => {
      const actual = scoreForSubjectRule(studentId, sr)
      return { rule: sr, passed: actual >= sr.minScore, actual, source: 'MARKS' }
    })
    return { ruleId: rule.id as string, label: rule.label as string, enforcementMode: rule.enforcementMode as string, results, passed: results.every(r => r.passed) }
  })
  const failedStrict = ruleResults.filter(r => !r.passed && r.enforcementMode === 'STRICT')
  const failedAdvisory = ruleResults.filter(r => !r.passed && r.enforcementMode === 'ADVISORY')

  const overrideReason = typeof ctx.body.overrideReason === 'string' ? ctx.body.overrideReason.trim() : undefined
  let overridden = false
  const exceptions = table('TrackEligibilityException')
  if (failedStrict.length) {
    if (!STAFF_ROLES.includes(actor.role) || !overrideReason) {
      throw conflict('This student does not meet a STRICT eligibility rule for this track — an authorized staff/admin override with a reason is required', {
        failedRules: failedStrict.map(r => ({ ruleId: r.ruleId, label: r.label, unmet: r.results.filter(x => !x.passed) })),
      })
    }
    overridden = true
    for (const r of failedStrict) {
      exceptions.push({
        id: uid('trackexc'), schoolId: actor.schoolId, trackActivityId: activity.id, ruleId: r.ruleId, studentId,
        type: 'STRICT_OVERRIDE', unmetDetails: r.results.filter(x => !x.passed), reason: overrideReason, approvedById: actor.userId, createdAt: nowIso(),
      } as Row)
    }
  }
  if (failedAdvisory.length) {
    for (const r of failedAdvisory) {
      exceptions.push({
        id: uid('trackexc'), schoolId: actor.schoolId, trackActivityId: activity.id, ruleId: r.ruleId, studentId,
        type: 'ADVISORY_FLAG', unmetDetails: r.results.filter(x => !x.passed), reason: null, approvedById: null, createdAt: nowIso(),
      } as Row)
    }
  }
  if (failedStrict.length || failedAdvisory.length) saveTable('TrackEligibilityException', exceptions)

  const regs = table('ActivityRegistration')
  let registration = regs.find(r => r.activityId === activity.id && r.userId === studentId)
  if (!registration) {
    const registeredCount = regs.filter(r => r.activityId === activity.id && r.status === 'Registered').length
    const cap = activity.capacity as number | null | undefined
    const willWaitlist = cap != null && registeredCount >= cap
    registration = { id: uid('actreg'), activityId: activity.id, userId: studentId, registeredAt: nowIso(), status: willWaitlist ? 'Waitlisted' : 'Registered' } as Row
    regs.push(registration)
    saveTable('ActivityRegistration', regs)
  }

  if (activity.trackCohortId && registration.status === 'Registered') {
    const memberships = table('CohortMembership')
    if (!memberships.find(m => m.cohortId === activity.trackCohortId && m.studentId === studentId)) {
      memberships.push({ id: uid('cm'), schoolId: actor.schoolId, cohortId: activity.trackCohortId, studentId, createdAt: nowIso() } as Row)
      saveTable('CohortMembership', memberships)
    }
  }

  return status(201, {
    registration: serializeRegistration(registration),
    eligibility: {
      passed: !failedStrict.length && !failedAdvisory.length, overridden,
      failedStrict: failedStrict.map(r => ({ ruleId: r.ruleId, label: r.label })),
      failedAdvisory: failedAdvisory.map(r => ({ ruleId: r.ruleId, label: r.label })),
    },
  })
})

route('GET', '/sectioning/track-eligibility-exceptions', (ctx) => {
  const actor = requireAuth(ctx)
  if (!STAFF_ROLES.includes(actor.role)) throw forbidden('Only staff/admin may view the eligibility exceptions report')
  const trackActivityId = ctx.query.trackActivityId
  const items = table('TrackEligibilityException')
    .filter(r => r.schoolId === actor.schoolId && (!trackActivityId || r.trackActivityId === trackActivityId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(r => {
      const studentUser = table('User').find(u => u.id === r.studentId)
      const approverUser = r.approvedById ? table('User').find(u => u.id === r.approvedById) : undefined
      return {
        id: r.id, trackActivityId: r.trackActivityId, ruleId: r.ruleId ?? undefined, studentId: r.studentId,
        studentName: studentUser?.name ?? r.studentId, type: r.type, unmetDetails: r.unmetDetails,
        reason: r.reason ?? undefined, approvedById: r.approvedById ?? undefined, approvedByName: approverUser?.name,
        createdAt: r.createdAt,
      }
    })
  return { items }
})
