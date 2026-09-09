import { prisma } from '../../prisma'
import { HttpError } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { isStaff, rosterOf, getClass } from '../../lib/scope'
import { computePace } from '../syllabus/service'

// Phase 25 item 4 — board-exam readiness dashboard. GET /api/exams/board-readiness?classId=, mounted from
// modules/exams/router.ts but implemented here since it aggregates assessments/syllabus/board-registration
// data that already lives in this module and modules/syllabus. `subjectsBehind` is a class-level figure —
// ChapterProgress (and therefore pace) is tracked per ClassSubject, not per student, so it is identical for
// every student of the class; only the score trend and registration status are genuinely per-student.
const BEHIND_THRESHOLD_CHAPTERS = -1 // paceDeltaChapters <= this counts the subject as "behind"
const TREND_DROP_PP = 2 // percentage-point drop between first/second half of a student's marks to flag "trending down"

export async function boardReadiness(ctx: Ctx, classId: string) {
  if (!isStaff(ctx)) throw new HttpError(403, 'Staff/admin only')
  const cls = await getClass(ctx, classId)

  const classSubjects = await prisma.classSubject.findMany({ where: { schoolId: ctx.schoolId, classId } })
  const paces = await Promise.all(classSubjects.map(cs => computePace(ctx, cs.id, {}).catch(() => null)))
  const subjectsBehind = paces.filter(p => p && p.paceDeltaChapters <= BEHIND_THRESHOLD_CHAPTERS).length

  const roster = await rosterOf(classId)
  const studentIds = roster.map(s => s.id)

  const [marks, regs] = await Promise.all([
    prisma.mark.findMany({
      where: { studentId: { in: studentIds }, assessment: { schoolId: ctx.schoolId, classSubjectId: { in: classSubjects.map(cs => cs.id) }, publishedAt: { not: null } } },
      include: { assessment: true },
    }),
    prisma.boardRegistration.findMany({ where: { schoolId: ctx.schoolId, studentId: { in: studentIds }, academicYearId: cls.academicYearId } }),
  ])
  const regByStudent = new Map(regs.map(r => [r.studentId, r]))
  const marksByStudent = new Map<string, typeof marks>()
  for (const m of marks) marksByStudent.set(m.studentId, [...(marksByStudent.get(m.studentId) ?? []), m])

  const pct = (m: (typeof marks)[number]) => (m.score / m.assessment.maxMarks) * 100
  const avg = (arr: typeof marks) => arr.reduce((sum, m) => sum + pct(m), 0) / arr.length

  const students = roster.map(s => {
    const sMarks = (marksByStudent.get(s.id) ?? []).slice().sort((a, b) => (a.assessment.date?.getTime() ?? 0) - (b.assessment.date?.getTime() ?? 0))
    const avgScorePct = sMarks.length ? Math.round(avg(sMarks) * 10) / 10 : null
    let trendingDown = false
    if (sMarks.length >= 2) {
      const mid = Math.floor(sMarks.length / 2)
      trendingDown = avg(sMarks.slice(mid)) < avg(sMarks.slice(0, mid)) - TREND_DROP_PP
    }
    const reg = regByStudent.get(s.id)
    const registrationStatus = reg?.status ?? 'NotStarted'
    const needsAttention = subjectsBehind > 0 || trendingDown || !['Validated', 'SentToBoard'].includes(registrationStatus)
    return { studentId: s.id, name: s.name, rollNo: s.rollNo, avgScorePct, trendingDown, registrationStatus, needsAttention }
  })

  return { classId, subjectsBehind, subjectsTotal: classSubjects.length, students }
}
