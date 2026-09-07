import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { toDate, fmtDate } from './lib/validate'
import { DEFAULT_BANDS } from './modules/assessments/gradeScales'

// Phase 3 demo data (attendance sessions, staff attendance, grade scale, assessments + marks, homework).
// The generators below are ports of the legacy `makeDays`, `makeMarks`, `makeRanks` and
// `makeAttendanceRecords` from src/lib/data.ts so the demo keeps its familiar numbers.

export interface SeedUserLite { id: string; role: string; name: string; class?: string; subjects?: string[] }
export interface Phase3Args {
  schoolId: string
  terms: { id: string }[]
  termDates: Record<string, [string, string]>
  subjects: { id: string; name: string }[]
  classIds: Map<string, string>                                   // label → Class.id
  classTeacher: Map<string, string | null>                        // label → teacher User.id
  classSubjects: Map<string, { id: string; teacherId: string | null }> // `${label}:${subjectId}`
  boardIds: Map<string, string>
  users: SeedUserLite[]
  userId: (seedId: string) => string
}
type Tx = Prisma.TransactionClient

const id = () => crypto.randomUUID().replace(/-/g, '')
const DAY = 24 * 60 * 60 * 1000
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY)
const CLASSES_WITH_DATA = ['X-A', 'X-B']

// ── legacy generators ──────────────────────────────────────────────────────────

// makeDays: the reference student's day rhythm — every 23-day cycle has one absence and one late.
export function dayPattern(i: number, termIdx: number): 'P' | 'A' | 'L' {
  const r = (i * 7 + termIdx * 3) % 23
  return r === 5 ? 'A' : r === 11 ? 'L' : 'P'
}

function seededRandom(seed: string): number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h ^= Math.imul(h ^ (h >>> 13), 3266489909)
  return (h >>> 0) / 4294967296
}

// makeAttendanceRecords: deterministic per (user, date); students ~92 % present, staff ~97 %.
export function attendanceStatusFor(userId: string, date: string, role: string): 'P' | 'A' | 'L' {
  const rate = role === 'student' ? 0.92 : 0.97
  const r = seededRandom(`${userId}_${date}`)
  return r > rate ? 'A' : r > rate - 0.03 ? 'L' : 'P'
}

// makeMarks: per subject index → [Unit Test /25, Mid Term /50, Term Exam /80] for the reference student.
export const ASSESSMENT_KINDS = [{ name: 'Unit Test', max: 25, offset: 30 }, { name: 'Mid Term', max: 50, offset: 60 }, { name: 'Term Exam', max: 80, offset: 100 }]
export function makeMarks(termIdx: number, subjectCount: number): number[][] {
  return Array.from({ length: subjectCount }, (_, si) => {
    const lift = termIdx * 3 + (si % 2)
    const a = Math.min(96, 62 + si * 5 + lift + (termIdx === 2 ? 6 : 0))
    const b = Math.min(98, 70 + ((si * 7) % 18) + lift)
    const c = Math.min(100, 66 + ((si * 11) % 22) + lift)
    return [Math.round(a * 0.25), Math.round(b * 0.5), Math.round(c * 0.8)]
  })
}

// makeRanks: the legacy overall score per student name; used as a scaling factor relative to the reference.
const RANK_NAMES = ['Aarav Sharma', 'Diya Patel', 'Kabir Singh', 'Anika Menon', 'Rohan Gupta', 'Ira Choudhary', 'Aditya Rao', 'Myra Kapoor', 'Vihaan Joshi', 'Sara Ali']
export function makeRankScore(name: string, termIdx: number) {
  let i = RANK_NAMES.indexOf(name)
  if (i < 0) i = (seededRandom(name) * RANK_NAMES.length) | 0
  return Math.round(920 - i * 14 + ((i * 37 + termIdx * 13) % 20) - (name === 'Aarav Sharma' ? 0 : (i % 3) * 6))
}

// The old seed's eight homework items, keyed by subject name (mapped to X-A class-subjects).
export const HOMEWORK_SEED = [
  { id: 'h1', subject: 'Mathematics', title: 'Quadratic equations — worksheet 7', due: '2026-04-10', description: 'Solve all 20 problems; show factorisation steps.' },
  { id: 'h2', subject: 'Physics', title: 'Optics lab record', due: '2026-04-09', description: 'Complete ray diagrams and observations.', submission: { at: '2026-04-08', status: 'Submitted' } },
  { id: 'h3', subject: 'English', title: 'Essay: “The city in 2050”', due: '2026-04-06', description: '500 words, argumentative style.', submission: { at: '2026-04-05', status: 'Graded', grade: 'A', feedback: 'Strong structure and vivid imagery.' } },
  { id: 'h4', subject: 'Computer Science', title: 'Python: file handling mini-project', due: '2026-04-12', description: 'Build a student record CLI with CSV storage.' },
  { id: 'h5', subject: 'Chemistry', title: 'Organic compounds chart', due: '2026-03-28', description: 'Prepare a chart of functional groups with examples.' },
  { id: 'h6', subject: 'Mathematics', title: 'Trigonometry identities practice', due: '2025-12-02', description: 'Prove identities 1–15.', submission: { at: '2025-12-01', status: 'Graded', grade: 'A2', feedback: 'Identity 12 needs a cleaner proof.' } },
  { id: 'h7', subject: 'Physics', title: 'Numericals: current electricity', due: '2025-11-24', description: 'Chapter 12, exercises 1–10.', submission: { at: '2025-11-23', status: 'Graded', grade: 'A1', feedback: 'All numericals correct.' } },
  { id: 'h8', subject: 'English', title: 'Book review: The Giver', due: '2025-09-14', description: '300-word critical review.', submission: { at: '2025-09-14', status: 'Graded', grade: 'B1', feedback: 'Good analysis; watch the word count.' } },
] as const

// ── loader ─────────────────────────────────────────────────────────────────────

// Mon–Fri dates of the term up to today (inclusive).
function schoolDays(start: string, end: string) {
  const out: string[] = []
  const last = Math.min(toDate(end).getTime(), toDate(fmtDate(new Date())).getTime())
  for (let d = toDate(start); d.getTime() <= last; d = addDays(d, 1)) {
    const wd = d.getUTCDay()
    if (wd >= 1 && wd <= 5) out.push(fmtDate(d))
  }
  return out
}

export async function loadPhase3(tx: Tx, a: Phase3Args) {
  const { schoolId } = a
  const students = a.users.filter(u => u.role === 'student' && u.class)
  const studentsOf = (label: string) => students.filter(s => s.class === label)
  const currentIdx = a.terms.length - 1
  const current = a.terms[currentIdx]
  const [curStart, curEnd] = a.termDates[current.id]
  const marker = a.userId('u-st') // Farhan (office) marks staff attendance

  // Attendance: day sessions for X-A / X-B on every school day of the current term so far, locked.
  const sessions: Prisma.AttendanceSessionCreateManyInput[] = []
  const records: Prisma.AttendanceRecordCreateManyInput[] = []
  const days = schoolDays(curStart, curEnd)
  for (const label of CLASSES_WITH_DATA) {
    const classId = a.classIds.get(label)
    if (!classId) continue
    days.forEach((date, i) => {
      const sid = id()
      sessions.push({ id: sid, schoolId, classId, date: toDate(date), periodIdx: null, markedById: a.classTeacher.get(label) ?? null, lockedAt: addDays(toDate(date), 1) })
      for (const s of studentsOf(label)) {
        const status = s.id === 'u-s' ? dayPattern(i, currentIdx) : attendanceStatusFor(s.id, date, 'student')
        records.push({ sessionId: sid, studentId: a.userId(s.id), status })
      }
    })
  }
  await tx.attendanceSession.createMany({ data: sessions })
  await tx.attendanceRecord.createMany({ data: records })

  // Staff attendance for teachers / staff / admins over the same days.
  const staff = a.users.filter(u => ['teacher', 'staff', 'admin'].includes(u.role))
  await tx.staffAttendance.createMany({
    data: staff.flatMap(u => days.map(date => ({ schoolId, userId: a.userId(u.id), date: toDate(date), status: attendanceStatusFor(u.id, date, u.role), markedById: marker }))),
  })

  // Grade scale for the CBSE board.
  await tx.gradeScale.create({ data: { schoolId, name: 'CBSE 8-point', boardId: a.boardIds.get('CBSE') ?? null, bands: DEFAULT_BANDS } })

  // Assessments: per class × term × subject → Unit Test / Mid Term / Term Exam, published, with marks.
  const assessments: Prisma.AssessmentCreateManyInput[] = []
  const marks: Prisma.MarkCreateManyInput[] = []
  a.terms.forEach((t, ti) => {
    const [start, end] = a.termDates[t.id]
    const ref = makeMarks(ti, a.subjects.length)
    const refScore = makeRankScore('Aarav Sharma', ti)
    for (const label of CLASSES_WITH_DATA) {
      const roster = studentsOf(label)
      a.subjects.forEach((subj, si) => {
        const cs = a.classSubjects.get(`${label}:${subj.id}`)
        if (!cs) return
        ASSESSMENT_KINDS.forEach((kind, k) => {
          const date = new Date(Math.min(addDays(toDate(start), kind.offset).getTime(), toDate(end).getTime()))
          const aid = id()
          assessments.push({ id: aid, schoolId, classSubjectId: cs.id, termId: t.id, name: kind.name, maxMarks: kind.max, weight: 1, date, publishedAt: addDays(date, 3) })
          for (const s of roster) {
            const factor = Math.min(1, Math.max(0.5, makeRankScore(s.name, ti) / refScore))
            marks.push({ assessmentId: aid, studentId: a.userId(s.id), score: Math.min(kind.max, Math.round(ref[si][k] * factor)) })
          }
        })
      })
    }
  })
  await tx.assessment.createMany({ data: assessments })
  await tx.mark.createMany({ data: marks })

  // Homework: the eight seed items on X-A, with Aarav's submissions.
  const subjectByName = new Map(a.subjects.map(s => [s.name, s.id]))
  const aarav = a.userId('u-s')
  for (const h of HOMEWORK_SEED) {
    const cs = a.classSubjects.get(`X-A:${subjectByName.get(h.subject)}`)
    if (!cs) continue
    await tx.homework.create({
      data: { id: h.id, schoolId, classSubjectId: cs.id, title: h.title, description: h.description, dueDate: toDate(h.due), createdById: cs.teacherId, attachments: [] },
    })
    if ('submission' in h && h.submission) {
      const sub = h.submission
      await tx.homeworkSubmission.create({
        data: { homeworkId: h.id, studentId: aarav, submittedAt: toDate(sub.at), status: sub.status, grade: 'grade' in sub ? sub.grade : null, feedback: 'feedback' in sub ? sub.feedback : null, files: [] },
      })
    }
  }
}
