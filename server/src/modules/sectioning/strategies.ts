// Phase T3 §2 — the 6 sectioning strategies, as pure functions over an already-scored population. Kept
// side-effect-free and DB-free on purpose: service.ts fetches the population/scores/bands, calls one of
// these, then writes the result — makes every strategy independently unit-testable and keeps
// SKIM_THEN_BALANCE a genuine composition (it literally calls another strategy's own function below,
// never a duplicated algorithm).

export interface ScoredStudent { studentId: string; name: string; rollNo: string; score: number }
export interface Band { label: string; minScore: number; maxScore: number }
export interface Assignment { studentId: string; sectionId: string; band?: string }
export interface StrategyOutput { assignments: Assignment[]; warnings: string[]; overflow?: string[] }

// Deterministic tie-break: score desc, then roll number asc, then name asc (documented per phase-t3's
// "edge cases" — a deterministic tie-breaker for score ties).
const tieBreak = (a: ScoredStudent, b: ScoredStudent) => b.score - a.score || a.rollNo.localeCompare(b.rollNo) || a.name.localeCompare(b.name)

export const bandOf = (score: number, bands: Band[]): string | undefined => bands.find(b => score >= b.minScore && score <= b.maxScore)?.label

// Largest-remainder allocation of `n` items across `buckets` equal-weight buckets, deterministic order.
export function allocateCounts(n: number, buckets: number): number[] {
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

// BALANCED — per-band percentage mix per section, largest-remainder rounding. Students outside every
// configured band (a scored student whose score falls in a gap) are round-robin-placed with a warning
// rather than silently dropped.
export function runBalanced(students: ScoredStudent[], sections: string[], bands: Band[]): StrategyOutput {
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

// RANKED — sort by score desc, fill each section to capacity in sectionOrder before moving to the next.
export function runRanked(students: ScoredStudent[], sections: string[], bands: Band[], capacityOf?: (sectionId: string) => number | undefined): StrategyOutput {
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

// BANDED — split into 2-3 broad bands first (collapsing the fine PerformanceBand list), then BALANCED
// within each broad group. Implemented by literally calling runBalanced with the collapsed band list.
export function runBanded(students: ScoredStudent[], sections: string[], bands: Band[], broadGroups = 3): StrategyOutput {
  return runBalanced(students, sections, collapseBands(bands, broadGroups))
}

// STRATIFIED_CAPPED — BALANCED with a hard per-(section,band) cap. Anything that would exceed a cap
// spills into `overflow` (surfaced by the caller as part of the unscored/manual-placement pool) with a
// warning, rather than silently over-filling a section.
export function runStratifiedCapped(students: ScoredStudent[], sections: string[], bands: Band[], caps: Record<string, Record<string, number>>): StrategyOutput {
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
    // Anything left over (either from a cap below the proportional share, or general leftover) tries any
    // section with spare cap room before falling to overflow.
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
export function hashSeed(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

// RANDOM_PARITY — random initial placement (seeded, deterministic), then swap pairs until each section's
// band mix is within `tolerancePct` percentage points of the overall population mix (or the iteration
// budget runs out, in which case a warning is returned rather than looping forever).
export function runRandomParity(students: ScoredStudent[], sections: string[], bands: Band[], opts?: { seed?: number; tolerancePct?: number; maxIterations?: number }): StrategyOutput {
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

export type StrategyName = 'BALANCED' | 'RANKED' | 'BANDED' | 'STRATIFIED_CAPPED' | 'RANDOM_PARITY' | 'SKIM_THEN_BALANCE'
export type StrategyFn = (students: ScoredStudent[], sections: string[], bands: Band[]) => StrategyOutput

// SKIM_THEN_BALANCE — a genuine composition: skim the top N (or top %) by merit into designated sections,
// then hand the remainder off to `remainderRun` (any of the strategy functions above, called by reference —
// never a duplicated algorithm).
export function runSkimThenBalance(
  students: ScoredStudent[],
  sections: string[],
  bands: Band[],
  skim: { sectionId: string; count?: number; percentage?: number }[],
  remainderRun: StrategyFn,
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
