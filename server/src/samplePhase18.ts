import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import type { Prisma } from '@prisma/client'
import { toDate } from './lib/validate'
import { UPLOAD_ROOT } from './modules/files/service'

// Phase 18 demo data (syllabus chapters, teaching progress, term targets, chapter resources, one
// assessment linked to a completed chapter for the coverage view). Runs inside the same transaction as
// loadSampleData, after Phase 1b (curriculum) and Phase 3 (assessments/marks infra) already exist. See
// phase-18-syllabus-tracking.md → Frontend → Sample data.
//
// Real CBSE Class X chapter lists (Mathematics / Physics / Chemistry, per the current NCERT syllabus) —
// not "Chapter 1 / Chapter 2" placeholders, per the spec's explicit instruction.

type Tx = Prisma.TransactionClient

export interface Phase18Args {
  schoolId: string
  boardIds: Map<string, string> // code → Board.id
  gradeIds: Map<string, string> // label → Grade.id
  classIds: Map<string, string> // label → Class.id
  classSubjects: Map<string, { id: string; teacherId: string | null }> // `${classLabel}:${subjectId}` → ClassSubject
  users: { id: string; role: string; class?: string }[]
  userId: (seedId: string) => string
}

const id = () => crypto.randomUUID().replace(/-/g, '')

const MATH_CHAPTERS: { title: string; periods: number; weight?: number }[] = [
  { title: 'Real Numbers', periods: 6, weight: 6 },
  { title: 'Polynomials', periods: 6, weight: 6 },
  { title: 'Pair of Linear Equations in Two Variables', periods: 8, weight: 8 },
  { title: 'Quadratic Equations', periods: 8, weight: 8 },
  { title: 'Arithmetic Progressions', periods: 7, weight: 6 },
  { title: 'Triangles', periods: 9, weight: 8 },
  { title: 'Coordinate Geometry', periods: 6, weight: 6 },
  { title: 'Introduction to Trigonometry', periods: 7, weight: 6 },
  { title: 'Some Applications of Trigonometry', periods: 5, weight: 4 },
  { title: 'Circles', periods: 6, weight: 5 },
  { title: 'Areas Related to Circles', periods: 5, weight: 4 },
  { title: 'Surface Areas and Volumes', periods: 7, weight: 6 },
  { title: 'Statistics', periods: 7, weight: 6 },
  { title: 'Probability', periods: 5, weight: 5 },
]

const PHYSICS_CHAPTERS: { title: string; periods: number; weight?: number }[] = [
  { title: 'Light – Reflection and Refraction', periods: 10, weight: 12 },
  { title: 'The Human Eye and the Colourful World', periods: 6, weight: 6 },
  { title: 'Electricity', periods: 10, weight: 13 },
  { title: 'Magnetic Effects of Electric Current', periods: 8, weight: 8 },
]

const CHEMISTRY_CHAPTERS: { title: string; periods: number; weight?: number }[] = [
  { title: 'Chemical Reactions and Equations', periods: 8, weight: 9 },
  { title: 'Acids, Bases and Salts', periods: 8, weight: 8 },
  { title: 'Metals and Non-metals', periods: 8, weight: 9 },
  { title: 'Carbon and its Compounds', periods: 9, weight: 10 },
  { title: 'Periodic Classification of Elements', periods: 6, weight: 6 },
]

async function seedTextFile(tx: Tx, schoolId: string, uploaderId: string, name: string, text: string) {
  const bytes = Buffer.from(text, 'utf8')
  const fileId = id()
  const rel = path.join(schoolId, fileId)
  const dest = path.join(UPLOAD_ROOT, rel)
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  await fs.promises.writeFile(dest, bytes)
  return tx.file.create({
    data: { id: fileId, schoolId, uploaderId, name, mime: 'text/plain', size: bytes.length, path: rel, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
  })
}

export async function loadPhase18(tx: Tx, a: Phase18Args) {
  const { schoolId } = a
  const cbse = a.boardIds.get('CBSE')!
  const gradeX = a.gradeIds.get('X')!
  const uid = a.userId

  const curriculumSubject = async (subjectId: string) => {
    const row = await tx.curriculumSubject.findFirst({ where: { schoolId, boardId: cbse, gradeId: gradeX, subjectId } })
    if (!row) throw new Error(`Phase 18 sample data: no CBSE-X curriculum row for subject ${subjectId}`)
    return row
  }

  async function seedChapters(subjectId: string, defs: { title: string; periods: number; weight?: number }[]) {
    const cs = await curriculumSubject(subjectId)
    const rows: { id: string; order: number; title: string; estimatedPeriods: number }[] = []
    for (const [i, d] of defs.entries()) {
      const row = await tx.syllabusChapter.create({
        data: { schoolId, curriculumSubjectId: cs.id, order: i + 1, title: d.title, estimatedPeriods: d.periods, examWeightagePct: d.weight ?? null },
      })
      rows.push({ id: row.id, order: row.order, title: row.title, estimatedPeriods: row.estimatedPeriods })
    }
    return { curriculumSubjectId: cs.id, chapters: rows }
  }

  const math = await seedChapters('math', MATH_CHAPTERS)
  const phy = await seedChapters('phy', PHYSICS_CHAPTERS)
  const chem = await seedChapters('chem', CHEMISTRY_CHAPTERS)

  const mathXA = a.classSubjects.get('X-A:math')!
  const mathXB = a.classSubjects.get('X-B:math')!
  const phyXA = a.classSubjects.get('X-A:phy')!
  const phyXB = a.classSubjects.get('X-B:phy')!
  const chemXA = a.classSubjects.get('X-A:chem')!

  const meera = uid('u-t') // Mathematics
  const arjun = uid('u-t2') // Physics
  const sofia = uid('u-t3') // Chemistry

  // ── progress: Math X-A well ahead, Math X-B behind, Physics X-A roughly on pace, Physics X-B just
  // starting, Chemistry X-A ahead with a graded assessment on its first Done chapter (for the coverage
  // view) — Chemistry X-B is deliberately left with NO progress rows at all, to prove untouched chapters
  // read back as NotStarted with no row required. ──

  async function setProgress(classSubjectId: string, chapterId: string, updatedById: string, status: 'InProgress' | 'Done', startedAt: string, completedAt?: string) {
    await tx.chapterProgress.create({
      data: {
        schoolId, classSubjectId, chapterId, status, updatedById,
        startedAt: toDate(startedAt), completedAt: completedAt ? toDate(completedAt) : null,
        notes: status === 'Done' ? 'Covered in class with worked examples; unit test administered.' : 'In progress — currently on worked examples.',
      },
    })
  }

  // Math X-A: chapters 1–9 Done (real-numbers → applications-of-trig), chapter 10 (Circles) InProgress.
  for (const ch of math.chapters.slice(0, 9)) {
    await setProgress(mathXA.id, ch.id, meera, 'Done', '2025-06-10', '2025-06-10')
  }
  await setProgress(mathXA.id, math.chapters[9].id, meera, 'InProgress', '2026-08-20')

  // Math X-B: chapters 1–3 Done, chapter 4 (Quadratic Equations) InProgress — clearly behind X-A on the
  // same shared chapter list.
  for (const ch of math.chapters.slice(0, 3)) {
    await setProgress(mathXB.id, ch.id, meera, 'Done', '2025-06-12', '2025-06-12')
  }
  await setProgress(mathXB.id, math.chapters[3].id, meera, 'InProgress', '2026-08-25')

  // Physics X-A: chapters 1–2 Done, chapter 3 (Electricity) InProgress.
  for (const ch of phy.chapters.slice(0, 2)) {
    await setProgress(phyXA.id, ch.id, arjun, 'Done', '2025-07-01', '2025-07-01')
  }
  await setProgress(phyXA.id, phy.chapters[2].id, arjun, 'InProgress', '2026-08-10')

  // Physics X-B: chapter 1 Done only — just starting.
  await setProgress(phyXB.id, phy.chapters[0].id, arjun, 'Done', '2025-07-05', '2025-07-05')

  // Chemistry X-A: chapter 1 (Chemical Reactions and Equations) Done early in Term 1 — an assessment is
  // linked to it below for the coverage-vs-learning demo — chapter 2 InProgress.
  await setProgress(chemXA.id, chem.chapters[0].id, sofia, 'Done', '2025-06-20', '2025-07-08')
  await setProgress(chemXA.id, chem.chapters[1].id, sofia, 'InProgress', '2026-08-15')
  // Chemistry X-B intentionally has no ChapterProgress rows at all.

  // ── term targets: a school-wide Math target for Term 3, plus a class-specific override for the
  // behind-pace X-B section (a lower bar, reflecting where they realistically are). ──
  await tx.termSyllabusTarget.create({
    data: { schoolId, curriculumSubjectId: math.curriculumSubjectId, termId: 't3', targetChapterId: math.chapters[9].id, classId: null },
  })
  await tx.termSyllabusTarget.create({
    data: { schoolId, curriculumSubjectId: math.curriculumSubjectId, termId: 't3', targetChapterId: math.chapters[5].id, classId: a.classIds.get('X-B')! },
  })

  // ── chapter resources: a lesson plan + a worksheet, shared per curriculum-subject (visible to every
  // teacher teaching that CBSE-X subject, not just the one class-subject). ──
  const lessonPlan = await seedTextFile(tx, schoolId, meera, 'Real-Numbers-lesson-plan.txt',
    'CBSE Class X Mathematics — Real Numbers\nLesson plan: Euclid\'s division lemma, Fundamental Theorem of Arithmetic, HCF/LCM via prime factorisation, irrationality proofs.\n5 periods theory + 1 period problem-solving.')
  await tx.chapterResource.create({ data: { schoolId, chapterId: math.chapters[0].id, fileId: lessonPlan.id, label: 'Lesson plan — Real Numbers', uploadedById: meera } })

  const worksheet = await seedTextFile(tx, schoolId, sofia, 'Chemical-Reactions-worksheet.txt',
    'CBSE Class X Chemistry — Chemical Reactions and Equations\nWorksheet: balancing equations, types of reactions (combination/decomposition/displacement/double-displacement), oxidation & reduction in daily life.')
  await tx.chapterResource.create({ data: { schoolId, chapterId: chem.chapters[0].id, fileId: worksheet.id, label: 'Worksheet — Chemical Reactions and Equations', uploadedById: sofia } })

  // ── coverage demo: an assessment on X-A's completed "Chemical Reactions and Equations" chapter, with
  // marks across the roster so /api/syllabus/coverage/:classSubjectId has a real class-average to show. ──
  const studentsXA = a.users.filter(u => u.role === 'student' && u.class === 'X-A')
  const assessment = await tx.assessment.create({
    data: {
      schoolId, classSubjectId: chemXA.id, termId: 't1', name: 'Unit Test — Chemical Reactions and Equations',
      maxMarks: 25, weight: 1, date: toDate('2025-07-08'), publishedAt: toDate('2025-07-09'),
      chapterIds: [chem.chapters[0].id],
    },
  })
  // Deterministic, varied scores (10–24 / 25) so the coverage view shows a genuine class average, not a
  // flat number — same "small varied spread" spirit as the Phase 3 mark generators.
  const scores = [22, 18, 24, 15, 20, 12, 23, 19, 10, 21]
  await tx.mark.createMany({
    data: studentsXA.map((s, i) => ({ assessmentId: assessment.id, studentId: uid(s.id), score: scores[i % scores.length] })),
  })
}
