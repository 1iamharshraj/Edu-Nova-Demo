import type { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { audit } from '../../lib/audit'
import { HttpError, notFound } from '../../lib/errors'
import type { Ctx } from '../../lib/rbac'
import { fmtDate } from '../../lib/validate'
import { assertViewClass, assertViewStudent, enrollmentFor, getClass, getTerm, isClassTeacherOfStudent, isStaff, rosterOf } from '../../lib/scope'
import { gradeFor, scaleForBoard } from './gradeScales'
import type { reportCardRemarkBody } from './schema'

// Phase 20 item 3 — shape stored per termId in Enrollment.remarks (see schema.prisma#Enrollment.remarks).
interface RemarkEntry { text: string; updatedById: string; updatedAt: string }
const remarksOf = (json: unknown): Record<string, RemarkEntry> => (json && typeof json === 'object' ? json as Record<string, RemarkEntry> : {})

// Report card + class ranks, both computed from PUBLISHED assessments only. Totals apply the assessment
// weight (default 1) to score and maxMarks alike; a missing mark counts as 0 but still adds to max.

const pct1 = (total: number, max: number) => (max ? Math.round((total / max) * 1000) / 10 : 0)

async function publishedFor(classId: string, termId: string) {
  return prisma.assessment.findMany({
    where: { termId, publishedAt: { not: null }, classSubject: { classId } },
    include: { classSubject: { include: { subject: true } }, marks: true },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  })
}
type Published = Awaited<ReturnType<typeof publishedFor>>

// Standard competition ranking: equal totals share a rank, the next rank is skipped (1, 1, 3).
function rankRows(roster: { id: string; name: string; rollNo?: string }[], assessments: Published) {
  const rows = roster.map(s => {
    let total = 0, max = 0
    for (const a of assessments) {
      const m = a.marks.find(x => x.studentId === s.id)
      total += (m?.score ?? 0) * a.weight
      max += a.maxMarks * a.weight
    }
    return { studentId: s.id, name: s.name, rollNo: s.rollNo, total: Math.round(total * 100) / 100, max: Math.round(max * 100) / 100, pct: pct1(total, max), rank: 0 }
  })
  rows.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name))
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].pct === r.pct ? rows[i - 1].rank : i + 1 })
  return rows
}

// GET /ranks?classId&termId
export async function ranks(ctx: Ctx, classId: string, termId: string) {
  const cls = await getClass(ctx, classId)
  const term = await getTerm(ctx, termId)
  await assertViewClass(ctx, cls.id)
  const [roster, assessments, scale] = await Promise.all([rosterOf(cls.id), publishedFor(cls.id, term.id), scaleForBoard(ctx.schoolId, cls.boardId)])
  const items = rankRows(roster, assessments).map(r => ({ ...r, grade: assessments.length ? gradeFor(scale.bands, r.pct).grade : undefined }))
  return { classId: cls.id, classLabel: `${cls.grade.label}-${cls.section}`, termId: term.id, assessments: assessments.length, items }
}

// GET /report-card?studentId&termId
export async function reportCard(ctx: Ctx, studentId: string, termId: string) {
  await assertViewStudent(ctx, studentId)
  const term = await getTerm(ctx, termId)
  const student = await prisma.user.findFirst({ where: { id: studentId, schoolId: ctx.schoolId, role: 'student' }, select: { id: true, name: true } })
  if (!student) throw notFound('Student')
  const enrollment = await enrollmentFor(studentId, term.academicYearId)
  if (!enrollment) {
    return { studentId, name: student.name, termId: term.id, classId: undefined, classLabel: undefined, scale: undefined, subjects: [], overall: { total: 0, max: 0, pct: 0, grade: undefined, rank: undefined, classSize: 0 }, remark: undefined }
  }
  const cls = enrollment.class
  const [roster, assessments, scale] = await Promise.all([rosterOf(cls.id), publishedFor(cls.id, term.id), scaleForBoard(ctx.schoolId, cls.boardId)])

  const bySubject = new Map<string, { subjectId: string; subject: string; color: string; assessments: { id: string; name: string; date?: string; score?: number; maxMarks: number; weight: number; remark?: string }[]; total: number; max: number }>()
  for (const a of assessments) {
    const s = bySubject.get(a.classSubject.subjectId) ?? { subjectId: a.classSubject.subjectId, subject: a.classSubject.subject.name, color: a.classSubject.subject.color, assessments: [], total: 0, max: 0 }
    const m = a.marks.find(x => x.studentId === studentId)
    s.assessments.push({ id: a.id, name: a.name, date: a.date ? fmtDate(a.date) : undefined, score: m?.score, maxMarks: a.maxMarks, weight: a.weight, remark: m?.remark ?? undefined })
    s.total += (m?.score ?? 0) * a.weight
    s.max += a.maxMarks * a.weight
    bySubject.set(a.classSubject.subjectId, s)
  }
  const subjects = [...bySubject.values()].map(s => {
    const pct = pct1(s.total, s.max)
    const g = gradeFor(scale.bands, pct)
    return { ...s, total: Math.round(s.total * 100) / 100, max: Math.round(s.max * 100) / 100, pct, grade: g.grade, points: g.points }
  })

  const ranked = rankRows(roster, assessments)
  const mine = ranked.find(r => r.studentId === studentId)
  const overallPct = mine?.pct ?? 0
  return {
    studentId, name: student.name, termId: term.id,
    classId: cls.id, classLabel: `${cls.grade.label}-${cls.section}`, boardCode: cls.board.code, rollNo: enrollment.rollNo ?? undefined,
    scale: { id: scale.id, name: scale.name, bands: scale.bands },
    subjects,
    overall: {
      total: mine?.total ?? 0, max: mine?.max ?? 0, pct: overallPct,
      grade: assessments.length ? gradeFor(scale.bands, overallPct).grade : undefined,
      rank: assessments.length ? mine?.rank : undefined,
      classSize: roster.length,
    },
    // Phase 20 item 3 — teacher-authored (optionally AI-drafted-then-edited) overall remark for this term,
    // if one has been saved via setReportCardRemark below. Never auto-filled from an AI draft — the
    // teacher must explicitly paste/edit and save it.
    remark: remarksOf(enrollment.remarks)[term.id]?.text,
  }
}

// PUT /report-card/remark — same "class teacher of this student, or staff/admin" scope as Phase 20's
// POST /ai/draft-remark (modules/ai/service.ts#assertCanDraftRemark) — the AI draft is only ever a
// starting point; whoever may ask the AI for a draft is exactly who may save the real remark.
async function assertCanWriteRemark(ctx: Ctx, studentId: string) {
  if (isStaff(ctx)) return
  if (await isClassTeacherOfStudent(ctx, studentId)) return
  throw new HttpError(403, 'Only the class teacher, staff, or admin may set this student\'s report-card remark')
}

export async function setReportCardRemark(ctx: Ctx, input: z.infer<typeof reportCardRemarkBody>) {
  await assertCanWriteRemark(ctx, input.studentId)
  const term = await getTerm(ctx, input.termId)
  const enrollment = await enrollmentFor(input.studentId, term.academicYearId)
  if (!enrollment) throw new HttpError(400, 'Student is not enrolled for this term\'s academic year')

  const before = remarksOf(enrollment.remarks)
  const entry: RemarkEntry = { text: input.remark, updatedById: ctx.actorId, updatedAt: new Date().toISOString() }
  const after = { ...before, [term.id]: entry }

  await prisma.enrollment.update({ where: { id: enrollment.id }, data: { remarks: after as unknown as Prisma.InputJsonValue } })
  await audit(ctx.schoolId, ctx.actorId, 'set-remark', 'enrollment', enrollment.id, { remark: before[term.id] }, { remark: entry })
  return { studentId: input.studentId, termId: term.id, remark: entry.text }
}
