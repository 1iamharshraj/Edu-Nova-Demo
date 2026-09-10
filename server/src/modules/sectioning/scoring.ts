import { prisma } from '../../prisma'

// Phase T3 §1 — score computation. Reuses real Phase 3 Assessment/Mark data as the actual score source
// (never a parallel scoring concept — see phase-t3-sectioning-engine.md §1) and, for a student with no
// Mark history yet in this school (typically a fresh external admit still riding on T2's
// PriorSubjectScore), falls back to that instead of silently treating them as zero. Every score this
// module produces is a 0-100 percentage so PerformanceBand.minScore/maxScore and
// TrackEligibilityRule.subjectScoreRules[].minScore share one consistent scale regardless of source.

export type ScoreSource = 'LATEST_EXAM' | 'EXAM_AVERAGE' | 'CUSTOM_WEIGHTING'

const round1 = (n: number) => Math.round(n * 10) / 10

// A single overall 0-100 score per student for a SectioningTemplate run. Returns null when the student
// has no published-assessment history for the year at all in their current class — that is the
// "unscored" pool (§4 edge cases), which is deliberately routed to manual admin placement rather than
// defaulted to 0.
export async function computeOverallScore(
  schoolId: string,
  studentId: string,
  academicYearId: string,
  scoreSource: ScoreSource,
  subjectWeights?: Record<string, number> | null,
): Promise<number | null> {
  const enrollment = await prisma.enrollment.findUnique({ where: { studentId_academicYearId: { studentId, academicYearId } } })
  if (!enrollment) return null

  const assessments = await prisma.assessment.findMany({
    where: { schoolId, publishedAt: { not: null }, classSubject: { classId: enrollment.classId } },
    include: { marks: { where: { studentId } }, classSubject: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })
  if (assessments.length) {
    if (scoreSource === 'LATEST_EXAM') {
      const a = assessments[0]
      const m = a.marks[0]
      if (m) return round1((m.score / a.maxMarks) * 100)
    } else if (scoreSource === 'EXAM_AVERAGE') {
      let total = 0, max = 0
      for (const a of assessments) {
        const m = a.marks[0]
        total += (m?.score ?? 0) * a.weight
        max += a.maxMarks * a.weight
      }
      if (max) return round1((total / max) * 100)
    } else {
      const weights = subjectWeights ?? {}
      const bySubject = new Map<string, { total: number; max: number }>()
      for (const a of assessments) {
        const sId = a.classSubject.subjectId
        if (!(sId in weights)) continue
        const e = bySubject.get(sId) ?? { total: 0, max: 0 }
        const m = a.marks[0]
        e.total += (m?.score ?? 0) * a.weight
        e.max += a.maxMarks * a.weight
        bySubject.set(sId, e)
      }
      let wSum = 0, scoreSum = 0
      for (const [sId, e] of bySubject) {
        const w = weights[sId] ?? 0
        if (!e.max || !w) continue
        scoreSum += (e.total / e.max) * 100 * w
        wSum += w
      }
      if (wSum) return round1(scoreSum / wSum)
    }
  }

  // Fallback: an external admit with no Mark history yet — average their T2 PriorSubjectScore rows
  // (approval creates Application.studentId, see modules/applications/service.ts#approve).
  const application = await prisma.application.findFirst({
    where: { schoolId, studentId, kind: 'Admission' },
    include: { priorSubjectScores: true },
    orderBy: { createdAt: 'desc' },
  })
  if (application?.priorSubjectScores.length) {
    let total = 0, max = 0
    for (const s of application.priorSubjectScores) { total += s.score; max += s.maxScore }
    if (max) return round1((total / max) * 100)
  }
  return null
}

export interface SubjectScoreRule { subjectId?: string; subjectName?: string; minScore: number }
export interface SubjectRuleResult { rule: SubjectScoreRule; passed: boolean; actual: number | null; source: 'MARKS' | 'PRIOR' | 'NONE' }

// One rule of a TrackEligibilityRule.subjectScoreRules[] — `subjectRef` can point at a real Phase 3
// Subject (continuing student, checked against their Mark-derived subject %) or match by free-text
// subjectName against T2's PriorSubjectScore shape (external admit) — see phase-t3-sectioning-engine.md §3.
export async function evaluateSubjectRule(schoolId: string, studentId: string, academicYearId: string, rule: SubjectScoreRule): Promise<SubjectRuleResult> {
  let subjectName = rule.subjectName
  if (rule.subjectId) {
    const enrollment = await prisma.enrollment.findUnique({ where: { studentId_academicYearId: { studentId, academicYearId } } })
    if (enrollment) {
      const assessments = await prisma.assessment.findMany({
        where: { schoolId, publishedAt: { not: null }, classSubject: { classId: enrollment.classId, subjectId: rule.subjectId } },
        include: { marks: { where: { studentId } } },
      })
      if (assessments.length) {
        let total = 0, max = 0
        for (const a of assessments) { const m = a.marks[0]; total += (m?.score ?? 0) * a.weight; max += a.maxMarks * a.weight }
        if (max) {
          const actual = round1((total / max) * 100)
          return { rule, passed: actual >= rule.minScore, actual, source: 'MARKS' }
        }
      }
    }
    if (!subjectName) {
      const subject = await prisma.subject.findFirst({ where: { id: rule.subjectId, schoolId } })
      subjectName = subject?.name
    }
  }

  if (subjectName) {
    const application = await prisma.application.findFirst({
      where: { schoolId, studentId, kind: 'Admission' },
      include: { priorSubjectScores: true },
      orderBy: { createdAt: 'desc' },
    })
    const matches = application?.priorSubjectScores.filter(s => s.subjectName.toLowerCase().includes(subjectName!.toLowerCase()) || subjectName!.toLowerCase().includes(s.subjectName.toLowerCase())) ?? []
    if (matches.length) {
      let total = 0, max = 0
      for (const s of matches) { total += s.score; max += s.maxScore }
      if (max) {
        const actual = round1((total / max) * 100)
        return { rule, passed: actual >= rule.minScore, actual, source: 'PRIOR' }
      }
    }
  }

  return { rule, passed: false, actual: null, source: 'NONE' }
}
