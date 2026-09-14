// Seeds the exams/assessments/syllabus/homework/attendance/feed/calendar/meetings/slips/achievements/
// health/highlights module batch on top of seed/core.ts's Class/User/Subject/ClassSubject/Enrollment/
// Guardian rows and seed/timetable.ts's Term-scoped TimetableEntry rows (this fragment is imported from
// src/lib/mock/index.ts AFTER './seed/timetable', so db.TimetableEntry is already populated when this
// runs — attendance sessions and syllabus-pace scheduling below key off those real periods rather than
// inventing a parallel timetable). See .agents/edunova/static-demo-plan.md.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'
import { addSeedFragment } from './index'

function seedExamsAcademics(db: Collections) {
  // ═══════════════════════════ CurriculumSubject + SyllabusChapter ═══════════════════════════
  // One curriculum-subject per (board-cbse, grade, subject) that seed/core.ts's ClassSubject rows
  // actually teach, so syllabus chapters/progress/targets below have somewhere real to attach.
  const curriculumDefs: Array<{ id: string; gradeId: string; subjectId: string }> = [
    { id: 'cur-g9-math', gradeId: 'grade-9', subjectId: 'math' },
    { id: 'cur-g9-eng', gradeId: 'grade-9', subjectId: 'english' },
    { id: 'cur-g9-sci', gradeId: 'grade-9', subjectId: 'science' },
    { id: 'cur-g10-math', gradeId: 'grade-10', subjectId: 'math' },
    { id: 'cur-g10-eng', gradeId: 'grade-10', subjectId: 'english' },
    { id: 'cur-g10-phy', gradeId: 'grade-10', subjectId: 'physics' },
    { id: 'cur-g10-chem', gradeId: 'grade-10', subjectId: 'chemistry' },
  ]
  db.CurriculumSubject = curriculumDefs.map(c => ({
    id: c.id, schoolId: SCHOOL_ID, boardId: 'board-cbse', gradeId: c.gradeId, streamId: null,
    subjectId: c.subjectId, kind: 'core', textbook: undefined, syllabusRef: undefined, createdAt: '2025-04-01T00:00:00.000Z',
  } as Row))

  const chapterDefs: Record<string, Array<{ title: string; periods: number; weightage?: number }>> = {
    'cur-g10-math': [
      { title: 'Real Numbers', periods: 8, weightage: 10 },
      { title: 'Polynomials', periods: 7, weightage: 10 },
      { title: 'Pair of Linear Equations in Two Variables', periods: 10, weightage: 15 },
      { title: 'Quadratic Equations', periods: 9, weightage: 15 },
      { title: 'Arithmetic Progressions', periods: 8, weightage: 10 },
    ],
    'cur-g10-phy': [
      { title: 'Light — Reflection and Refraction', periods: 10, weightage: 15 },
      { title: 'The Human Eye and the Colourful World', periods: 6, weightage: 8 },
      { title: 'Electricity', periods: 12, weightage: 18 },
      { title: 'Magnetic Effects of Electric Current', periods: 9, weightage: 12 },
    ],
    'cur-g10-chem': [
      { title: 'Chemical Reactions and Equations', periods: 8, weightage: 12 },
      { title: 'Acids, Bases and Salts', periods: 9, weightage: 12 },
      { title: 'Metals and Non-metals', periods: 10, weightage: 15 },
    ],
    'cur-g10-eng': [
      { title: 'A Letter to God (First Flight)', periods: 4 },
      { title: 'Nelson Mandela: Long Walk to Freedom', periods: 5 },
      { title: 'Two Stories about Flying', periods: 5 },
    ],
    'cur-g9-math': [
      { title: 'Number Systems', periods: 8, weightage: 12 },
      { title: 'Polynomials', periods: 9, weightage: 14 },
      { title: 'Coordinate Geometry', periods: 5, weightage: 8 },
    ],
    'cur-g9-sci': [
      { title: 'Matter in Our Surroundings', periods: 6, weightage: 10 },
      { title: 'Is Matter Around Us Pure', periods: 7, weightage: 10 },
      { title: 'Atoms and Molecules', periods: 8, weightage: 12 },
      { title: 'The Fundamental Unit of Life', periods: 8, weightage: 12 },
    ],
    'cur-g9-eng': [
      { title: 'The Fun They Had', periods: 4 },
      { title: 'The Sound of Music', periods: 5 },
    ],
  }
  const chapters: Row[] = []
  for (const [curriculumSubjectId, defs] of Object.entries(chapterDefs)) {
    defs.forEach((d, i) => {
      chapters.push({
        id: `chp-${curriculumSubjectId}-${i + 1}`, schoolId: SCHOOL_ID, curriculumSubjectId, order: i + 1,
        title: d.title, estimatedPeriods: d.periods, examWeightagePct: d.weightage ?? null, createdAt: '2025-04-01T00:00:00.000Z',
      } as Row)
    })
  }
  db.SyllabusChapter = chapters
  const chapterId = (curriculumSubjectId: string, order: number) => `chp-${curriculumSubjectId}-${order}`

  // ChapterProgress — real progress against real ClassSubject rows from seed/core.ts.
  db.ChapterProgress = [
    { id: 'cpr-1', schoolId: SCHOOL_ID, classSubjectId: 'cs-10a-math', chapterId: chapterId('cur-g10-math', 1), status: 'Done', startedAt: '2025-12-01', completedAt: '2025-12-09', notes: 'Covered well, good class average on the recap quiz.', updatedById: 'u-t', updatedAt: '2025-12-09T10:00:00.000Z' },
    { id: 'cpr-2', schoolId: SCHOOL_ID, classSubjectId: 'cs-10a-math', chapterId: chapterId('cur-g10-math', 2), status: 'Done', startedAt: '2025-12-10', completedAt: '2025-12-18', notes: undefined, updatedById: 'u-t', updatedAt: '2025-12-18T10:00:00.000Z' },
    { id: 'cpr-3', schoolId: SCHOOL_ID, classSubjectId: 'cs-10a-math', chapterId: chapterId('cur-g10-math', 3), status: 'InProgress', startedAt: '2025-12-19', completedAt: undefined, notes: 'Word problems need another period.', updatedById: 'u-t', updatedAt: '2026-01-05T10:00:00.000Z' },
    { id: 'cpr-4', schoolId: SCHOOL_ID, classSubjectId: 'cs-10a-phy', chapterId: chapterId('cur-g10-phy', 1), status: 'Done', startedAt: '2025-12-01', completedAt: '2025-12-15', notes: undefined, updatedById: 'u-t4', updatedAt: '2025-12-15T10:00:00.000Z' },
    { id: 'cpr-5', schoolId: SCHOOL_ID, classSubjectId: 'cs-10a-phy', chapterId: chapterId('cur-g10-phy', 2), status: 'InProgress', startedAt: '2025-12-16', completedAt: undefined, notes: undefined, updatedById: 'u-t4', updatedAt: '2026-01-10T10:00:00.000Z' },
    { id: 'cpr-6', schoolId: SCHOOL_ID, classSubjectId: 'cs-9a-sci', chapterId: chapterId('cur-g9-sci', 1), status: 'InProgress', startedAt: '2025-12-02', completedAt: undefined, notes: undefined, updatedById: 'u-t3', updatedAt: '2025-12-20T10:00:00.000Z' },
  ] as Row[]

  db.TermSyllabusTarget = [
    { id: 'tst-1', schoolId: SCHOOL_ID, curriculumSubjectId: 'cur-g10-math', termId: 't3', targetChapterId: chapterId('cur-g10-math', 4), classId: null, createdAt: '2025-12-01T00:00:00.000Z' },
    { id: 'tst-2', schoolId: SCHOOL_ID, curriculumSubjectId: 'cur-g10-phy', termId: 't3', targetChapterId: chapterId('cur-g10-phy', 3), classId: null, createdAt: '2025-12-01T00:00:00.000Z' },
  ] as Row[]

  db.ChapterResource = []

  // ═══════════════════════════ GradeScale ═══════════════════════════
  db.GradeScale = [
    {
      id: 'gradescale-cbse', schoolId: SCHOOL_ID, name: 'CBSE 8-point Scale', boardId: 'board-cbse',
      bands: [
        { min: 91, grade: 'A1', points: 10 }, { min: 81, grade: 'A2', points: 9 }, { min: 71, grade: 'B1', points: 8 }, { min: 61, grade: 'B2', points: 7 },
        { min: 51, grade: 'C1', points: 6 }, { min: 41, grade: 'C2', points: 5 }, { min: 33, grade: 'D', points: 4 }, { min: 0, grade: 'E', points: 0 },
      ],
      createdAt: '2025-04-01T00:00:00.000Z',
    } as Row,
  ]

  // ═══════════════════════════ Assessment + Mark ═══════════════════════════
  db.Assessment = [
    { id: 'asmt-1', schoolId: SCHOOL_ID, classSubjectId: 'cs-10a-math', termId: 't3', name: 'Unit Test 1 — Real Numbers & Polynomials', maxMarks: 25, weight: 1, date: '2025-12-15', publishedAt: '2025-12-17T09:00:00.000Z', createdAt: '2025-12-10T00:00:00.000Z', chapterIds: [chapterId('cur-g10-math', 1), chapterId('cur-g10-math', 2)] },
    { id: 'asmt-2', schoolId: SCHOOL_ID, classSubjectId: 'cs-10a-math', termId: 't3', name: 'Unit Test 2 — Linear Equations', maxMarks: 25, weight: 1, date: '2026-01-20', publishedAt: undefined, createdAt: '2026-01-05T00:00:00.000Z', chapterIds: [chapterId('cur-g10-math', 3)] },
    { id: 'asmt-3', schoolId: SCHOOL_ID, classSubjectId: 'cs-10a-phy', termId: 't3', name: 'Unit Test 1 — Light', maxMarks: 25, weight: 1, date: '2025-12-16', publishedAt: '2025-12-18T09:00:00.000Z', createdAt: '2025-12-10T00:00:00.000Z', chapterIds: [chapterId('cur-g10-phy', 1)] },
    { id: 'asmt-4', schoolId: SCHOOL_ID, classSubjectId: 'cs-10b-math', termId: 't3', name: 'Unit Test 1 — Real Numbers', maxMarks: 25, weight: 1, date: '2025-12-15', publishedAt: '2025-12-17T09:00:00.000Z', createdAt: '2025-12-10T00:00:00.000Z', chapterIds: [] },
    // Also on cs-9a-math (u-t's other class) so the Gradebook page shows a real assessment no matter which
    // of u-t's teachable class-subjects the UI defaults to selecting.
    { id: 'asmt-5', schoolId: SCHOOL_ID, classSubjectId: 'cs-9a-math', termId: 't3', name: 'Unit Test 1 — Number Systems', maxMarks: 20, weight: 1, date: '2025-12-15', publishedAt: '2025-12-17T09:00:00.000Z', createdAt: '2025-12-10T00:00:00.000Z', chapterIds: [] },
  ] as Row[]

  db.Mark = [
    { id: 'mk-1', assessmentId: 'asmt-1', studentId: 'u-s1', score: 22, remark: 'Excellent work', updatedAt: '2025-12-17T09:00:00.000Z' },
    { id: 'mk-2', assessmentId: 'asmt-1', studentId: 'u-s2', score: 18, remark: undefined, updatedAt: '2025-12-17T09:00:00.000Z' },
    { id: 'mk-3', assessmentId: 'asmt-3', studentId: 'u-s1', score: 20, remark: undefined, updatedAt: '2025-12-18T09:00:00.000Z' },
    { id: 'mk-4', assessmentId: 'asmt-3', studentId: 'u-s2', score: 21, remark: undefined, updatedAt: '2025-12-18T09:00:00.000Z' },
    { id: 'mk-5', assessmentId: 'asmt-4', studentId: 'u-s3', score: 19, remark: undefined, updatedAt: '2025-12-17T09:00:00.000Z' },
    { id: 'mk-6', assessmentId: 'asmt-5', studentId: 'u-s4', score: 16, remark: undefined, updatedAt: '2025-12-17T09:00:00.000Z' },
  ] as Row[]

  // ═══════════════════════════ Exam seating + invigilation ═══════════════════════════
  db.ExamSeatingPlan = [
    { id: 'esp-1', schoolId: SCHOOL_ID, assessmentIds: ['asmt-1'], date: '2025-12-15', roomId: 'room-a201', generatedAt: '2025-12-12T08:00:00.000Z', generatedById: 'u-ad' } as Row,
  ]
  db.ExamSeat = [
    { id: 'eseat-1', planId: 'esp-1', studentId: 'u-s1', seatNumber: 1, assessmentId: 'asmt-1' },
    { id: 'eseat-2', planId: 'esp-1', studentId: 'u-s2', seatNumber: 2, assessmentId: 'asmt-1' },
  ] as Row[]
  db.InvigilationDuty = [
    { id: 'invd-1', schoolId: SCHOOL_ID, assessmentId: 'asmt-1', roomId: 'room-a201', teacherId: 'u-t4', date: '2025-12-15', status: 'Assigned', createdAt: '2025-12-12T08:00:00.000Z' } as Row,
    { id: 'invd-2', schoolId: SCHOOL_ID, assessmentId: 'asmt-3', roomId: 'room-a202', teacherId: 'u-t5', date: '2025-12-16', status: 'Confirmed', createdAt: '2025-12-12T08:00:00.000Z' } as Row,
  ]

  // ═══════════════════════════ Homework ═══════════════════════════
  db.Homework = [
    { id: 'hw-1', schoolId: SCHOOL_ID, classSubjectId: 'cs-10a-math', title: 'Quadratic Equations Worksheet', description: 'Solve all 15 problems from the worksheet handout, showing full working.', dueDate: '2026-02-10', createdById: 'u-t', attachments: [], createdAt: '2026-01-25T00:00:00.000Z' } as Row,
    { id: 'hw-2', schoolId: SCHOOL_ID, classSubjectId: 'cs-10a-math', title: 'Real Numbers — Practice Set', description: 'Euclid’s division lemma practice, questions 1-10.', dueDate: '2025-12-10', createdById: 'u-t', attachments: [], createdAt: '2025-12-03T00:00:00.000Z' } as Row,
  ]
  db.HomeworkSubmission = [
    { id: 'hws-1', homeworkId: 'hw-1', studentId: 'u-s2', submittedAt: '2026-02-08T14:00:00.000Z', files: [], note: 'Attached my worked answers.', status: 'Submitted', grade: undefined, feedback: undefined },
    { id: 'hws-2', homeworkId: 'hw-2', studentId: 'u-s1', submittedAt: '2025-12-09T18:00:00.000Z', files: [], note: undefined, status: 'Graded', grade: 'A', feedback: 'Neat working, correct throughout.' },
  ] as Row[]

  // ═══════════════════════════ Attendance ═══════════════════════════
  // Whole-day sessions for class-10a across a real school week in Term 3, plus one period-scoped session
  // tied to a real TimetableEntry for cs-10a-math (so per-subject attendance summaries have something to
  // aggregate). u-s1 has one Absent day — deliberately, so summary/report views show a non-100% case.
  const weekDates = ['2025-12-08', '2025-12-09', '2025-12-10', '2025-12-11', '2025-12-12']
  const s1Statuses = ['P', 'P', 'A', 'P', 'L']
  const s2Statuses = ['P', 'P', 'P', 'A', 'P']
  const sessions: Row[] = []
  const records: Row[] = []
  weekDates.forEach((date, i) => {
    const sessionId = `ats-10a-day-${i + 1}`
    sessions.push({ id: sessionId, schoolId: SCHOOL_ID, classId: 'class-10a', date, periodIdx: null, markedById: 'u-t', lockedAt: i < 3 ? `${date}T18:00:00.000Z` : undefined, createdAt: `${date}T09:00:00.000Z` } as Row)
    records.push({ id: `atr-10a-day-${i + 1}-s1`, sessionId, studentId: 'u-s1', status: s1Statuses[i], note: s1Statuses[i] === 'A' ? 'Informed — medical' : undefined } as Row)
    records.push({ id: `atr-10a-day-${i + 1}-s2`, sessionId, studentId: 'u-s2', status: s2Statuses[i], note: undefined } as Row)
  })
  // Period-scoped session, anchored to a real cs-10a-math TimetableEntry slot if one exists.
  const mathEntry = (db.TimetableEntry ?? []).find(e => e.classId === 'class-10a' && e.termId === 't3' && e.classSubjectId === 'cs-10a-math')
  if (mathEntry) {
    sessions.push({ id: 'ats-10a-period-1', schoolId: SCHOOL_ID, classId: 'class-10a', date: weekDates[0], periodIdx: mathEntry.periodIdx, markedById: 'u-t', lockedAt: undefined, createdAt: `${weekDates[0]}T09:00:00.000Z` } as Row)
    records.push({ id: 'atr-10a-period-1-s1', sessionId: 'ats-10a-period-1', studentId: 'u-s1', status: 'P', note: undefined } as Row)
    records.push({ id: 'atr-10a-period-1-s2', sessionId: 'ats-10a-period-1', studentId: 'u-s2', status: 'P', note: undefined } as Row)
  }
  db.AttendanceSession = sessions
  db.AttendanceRecord = records

  // Staff attendance — mostly present, with one absence for u-t4 (physics) so syllabus pace's
  // "lost periods" figure for cs-10a-phy has a real, non-zero example to show.
  db.StaffAttendance = [
    { id: 'sfa-1', schoolId: SCHOOL_ID, userId: 'u-t', date: '2025-12-08', status: 'P', markedById: 'u-ad', createdAt: '2025-12-08T08:00:00.000Z' },
    { id: 'sfa-2', schoolId: SCHOOL_ID, userId: 'u-t', date: '2025-12-09', status: 'P', markedById: 'u-ad', createdAt: '2025-12-09T08:00:00.000Z' },
    { id: 'sfa-3', schoolId: SCHOOL_ID, userId: 'u-t4', date: '2025-12-16', status: 'A', markedById: 'u-ad', createdAt: '2025-12-16T08:00:00.000Z' },
    { id: 'sfa-4', schoolId: SCHOOL_ID, userId: 'u-t4', date: '2025-12-17', status: 'P', markedById: 'u-ad', createdAt: '2025-12-17T08:00:00.000Z' },
    { id: 'sfa-5', schoolId: SCHOOL_ID, userId: 'u-t2', date: '2025-12-08', status: 'P', markedById: 'u-ad', createdAt: '2025-12-08T08:00:00.000Z' },
    { id: 'sfa-6', schoolId: SCHOOL_ID, userId: 'u-t3', date: '2025-12-08', status: 'P', markedById: 'u-ad', createdAt: '2025-12-08T08:00:00.000Z' },
  ] as Row[]

  // ═══════════════════════════ Calendar ═══════════════════════════
  db.CalendarEvent = [
    { id: 'cal-1', schoolId: SCHOOL_ID, title: 'Winter Break Begins', date: '2025-12-25', endDate: '2026-01-01', type: 'holiday', audience: 'School', classId: null, termId: 't3', createdById: 'u-ad', createdAt: '2025-11-01T00:00:00.000Z' } as Row,
    { id: 'cal-2', schoolId: SCHOOL_ID, title: 'Grade X-A Term 3 Unit Tests', date: '2025-12-15', endDate: '2025-12-18', type: 'exam', audience: 'Class', classId: 'class-10a', termId: 't3', createdById: 'u-ad', createdAt: '2025-11-20T00:00:00.000Z' } as Row,
    { id: 'cal-3', schoolId: SCHOOL_ID, title: 'Annual Sports Day', date: '2026-02-10', endDate: undefined, type: 'event', audience: 'School', classId: null, termId: 't3', createdById: 'u-ad', createdAt: '2025-12-01T00:00:00.000Z' } as Row,
  ]

  // ═══════════════════════════ Feed ═══════════════════════════
  db.Post = [
    { id: 'post-1', schoolId: SCHOOL_ID, authorId: 'u-ad', audience: 'School', classId: null, role: null, title: 'Welcome back for Term 3!', body: 'Hope everyone had a restful break. Term 3 unit tests begin 15th December — timetables are posted on the notice board.', mediaFileIds: [], pinned: true, publishedAt: '2025-12-01T09:00:00.000Z', createdAt: '2025-12-01T09:00:00.000Z' } as Row,
    { id: 'post-2', schoolId: SCHOOL_ID, authorId: 'u-t', audience: 'Class', classId: 'class-10a', role: null, title: 'Homework portal is live', body: 'You can now submit homework directly through the portal — please attach clear photos of your working.', mediaFileIds: [], pinned: false, publishedAt: '2025-12-03T10:00:00.000Z', createdAt: '2025-12-03T10:00:00.000Z' } as Row,
    { id: 'post-3', schoolId: SCHOOL_ID, authorId: 'u-ad', audience: 'Role', classId: null, role: 'teacher', title: 'Staff meeting — Friday 4pm', body: 'Reminder: all teaching staff to attend the term-planning meeting in the staff room.', mediaFileIds: [], pinned: false, publishedAt: '2025-12-04T08:00:00.000Z', createdAt: '2025-12-04T08:00:00.000Z' } as Row,
  ]
  db.PostReaction = [
    { id: 'preact-1', postId: 'post-1', userId: 'u-t', createdAt: '2025-12-01T10:00:00.000Z' },
    { id: 'preact-2', postId: 'post-1', userId: 'u-p', createdAt: '2025-12-01T11:00:00.000Z' },
  ] as Row[]
  db.PostComment = [
    { id: 'pcm-1', postId: 'post-2', authorId: 'u-s1', body: 'Thank you, this is really convenient!', createdAt: '2025-12-03T12:00:00.000Z' } as Row,
  ]

  // ═══════════════════════════ Meetings ═══════════════════════════
  db.Meeting = [
    { id: 'mtg-1', schoolId: SCHOOL_ID, requesterId: 'u-p', withUserId: 'u-t', studentId: 'u-s1', purpose: 'Discuss Ravi’s progress in Mathematics ahead of the unit test.', scheduledAt: '2025-12-22T10:00:00.000Z', durationMin: 20, link: undefined, status: 'Requested', decidedById: undefined, decidedAt: undefined, note: undefined, createdAt: '2025-12-14T09:00:00.000Z' } as Row,
    { id: 'mtg-2', schoolId: SCHOOL_ID, requesterId: 'u-s1', withUserId: 'u-t2', studentId: 'u-s1', purpose: 'Feedback on the English essay draft.', scheduledAt: '2025-12-19T15:00:00.000Z', durationMin: 15, link: 'https://meet.jit.si/edunova-demoschool-mtg-2', status: 'Scheduled', decidedById: 'u-t2', decidedAt: '2025-12-15T09:00:00.000Z', note: 'Happy to go through it in the library.', createdAt: '2025-12-14T09:00:00.000Z' } as Row,
    { id: 'mtg-3', schoolId: SCHOOL_ID, requesterId: 'u-p', withUserId: 'u-t', studentId: 'u-s1', purpose: 'Term 2 report card discussion.', scheduledAt: '2025-11-10T10:00:00.000Z', durationMin: 20, link: 'https://meet.jit.si/edunova-demoschool-mtg-3', status: 'Completed', decidedById: 'u-t', decidedAt: '2025-11-05T09:00:00.000Z', note: undefined, createdAt: '2025-11-01T09:00:00.000Z' } as Row,
  ]

  // ═══════════════════════════ Permission slips ═══════════════════════════
  db.PermissionSlip = [
    { id: 'slip-1', schoolId: SCHOOL_ID, title: 'Field Trip to Science Museum', detail: 'Grade X-A will visit the City Science Museum on 20th December. Please confirm your consent below.', dueDate: '2025-12-18', classId: 'class-10a', createdById: 'u-t', requiresVerifiedParent: true, createdAt: '2025-12-05T00:00:00.000Z' } as Row,
    { id: 'slip-2', schoolId: SCHOOL_ID, title: 'Annual Sports Day Participation', detail: 'Please confirm whether your ward may participate in the outdoor events for Sports Day.', dueDate: '2026-01-25', classId: null, createdById: 'u-ad', requiresVerifiedParent: true, createdAt: '2025-12-20T00:00:00.000Z' } as Row,
  ]
  db.SlipResponse = [
    { id: 'sres-1', slipId: 'slip-1', studentId: 'u-s1', parentId: 'u-p', decision: 'Approved', respondedAt: '2025-12-06T09:00:00.000Z', note: undefined } as Row,
    // slip-2 deliberately left unanswered by u-p/u-s1 so the e2e spec can exercise a real POST /slips/:id/respond.
  ]

  // ═══════════════════════════ Achievements ═══════════════════════════
  db.Achievement = [
    { id: 'ach-1', schoolId: SCHOOL_ID, userId: 'u-s1', title: 'Won District-Level Chess Championship', detail: 'First place, Under-16 category, District Chess Championship 2025.', date: '2025-11-20', category: 'Sports', verifiedById: 'u-ad', verifiedAt: '2025-11-22T09:00:00.000Z', fileIds: [], createdAt: '2025-11-21T00:00:00.000Z' } as Row,
    { id: 'ach-2', schoolId: SCHOOL_ID, userId: 'u-s2', title: 'Published article in school magazine', detail: 'Wrote a feature article on climate change for the winter edition of the school magazine.', date: '2025-12-01', category: 'Academic', verifiedById: undefined, verifiedAt: undefined, fileIds: [], createdAt: '2025-12-01T00:00:00.000Z' } as Row,
  ]

  // ═══════════════════════════ Health ═══════════════════════════
  db.HealthRecord = [
    { id: 'hlt-1', schoolId: SCHOOL_ID, studentId: 'u-s1', kind: 'Allergy', title: 'Peanut allergy', detail: 'Diagnosed mild peanut allergy — carries an antihistamine; canteen has been informed.', date: '2025-06-15', addedById: 'u-p', verifiedById: 'u-ad', verifiedAt: '2025-06-18T09:00:00.000Z', fileIds: [], createdAt: '2025-06-15T00:00:00.000Z' } as Row,
    { id: 'hlt-2', schoolId: SCHOOL_ID, studentId: 'u-s1', kind: 'Vaccination', title: 'Tdap booster', detail: 'Booster dose administered as part of the school health drive.', date: '2025-08-01', addedById: 'u-st', verifiedById: undefined, verifiedAt: undefined, fileIds: [], createdAt: '2025-08-01T00:00:00.000Z' } as Row,
  ]
  db.MedicationSchedule = [
    { id: 'med-1', schoolId: SCHOOL_ID, studentId: 'u-s1', medicationName: 'Cetirizine', dosage: '10mg', times: ['08:00', '20:00'], startDate: '2025-12-01', endDate: undefined, notes: 'For seasonal allergy symptoms.', addedById: 'u-st', createdAt: '2025-12-01T00:00:00.000Z' } as Row,
  ]
  db.MedicationLog = [
    { id: 'medlog-1', schoolId: SCHOOL_ID, scheduleId: 'med-1', administeredAt: '2025-12-05T08:05:00.000Z', administeredById: 'u-st', notes: undefined } as Row,
  ]

  // ═══════════════════════════ Highlights ═══════════════════════════
  db.Highlight = [
    { id: 'hl-1', schoolId: SCHOOL_ID, title: 'Annual Day Celebrations 2025', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', thumbnailFileId: undefined, audience: 'School', classId: null, publishedAt: '2025-11-15T00:00:00.000Z', createdById: 'u-ad', createdAt: '2025-11-15T00:00:00.000Z' } as Row,
    { id: 'hl-2', schoolId: SCHOOL_ID, title: 'Grade X Math Olympiad Prep Session', url: 'https://www.youtube.com/watch?v=oHg5SJYRHA0', thumbnailFileId: undefined, audience: 'Class', classId: 'class-10a', publishedAt: '2025-12-01T00:00:00.000Z', createdById: 'u-t', createdAt: '2025-12-01T00:00:00.000Z' } as Row,
  ]
}

addSeedFragment(seedExamsAcademics)
