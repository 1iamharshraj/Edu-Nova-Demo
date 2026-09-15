// Core seed: school, users (one per role, login-ready), academic-year/terms/boards/grades/streams/
// classes/subjects/class-subjects/rooms/enrollments/guardians. Every other module's seed file
// (src/lib/mock/seed/*.ts) extends the classes/users/subjects created here rather than inventing a
// second school. Passwords match the ones used throughout the real backend's dev/test fixtures, so
// anyone who worked on `feature/backend-api` can log into the static demo with the same credentials.

import type { Collections, Row } from '../store'
import { SCHOOL_ID } from '../store'

export function seedCore(db: Collections) {
  db.School = [{ id: SCHOOL_ID, name: 'Edkonic Public School', createdAt: '2024-04-01T00:00:00.000Z' } as Row]

  db.AcademicYear = [
    { id: 'ay-2025', schoolId: SCHOOL_ID, label: '2025–26', startDate: '2025-04-01', endDate: '2026-03-31', isCurrent: true } as Row,
  ]

  db.Board = [
    { id: 'board-cbse', schoolId: SCHOOL_ID, name: 'CBSE', code: 'CBSE' } as Row,
    { id: 'board-state', schoolId: SCHOOL_ID, name: 'State Board', code: 'Matric' } as Row,
  ]

  db.Term = [
    { id: 't1', schoolId: SCHOOL_ID, academicYearId: 'ay-2025', name: 'Term 1', startDate: '2025-04-01', endDate: '2025-07-31', isCurrent: false } as Row,
    { id: 't2', schoolId: SCHOOL_ID, academicYearId: 'ay-2025', name: 'Term 2', startDate: '2025-08-01', endDate: '2025-11-30', isCurrent: false } as Row,
    { id: 't3', schoolId: SCHOOL_ID, academicYearId: 'ay-2025', name: 'Term 3', startDate: '2025-12-01', endDate: '2026-03-31', isCurrent: true } as Row,
  ]

  const gradeLabels = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
  db.Grade = gradeLabels.map((label, i) => ({
    id: `grade-${i + 1}`, schoolId: SCHOOL_ID, label, order: i + 1,
  } as Row))

  db.Stream = [
    { id: 'stream-science', schoolId: SCHOOL_ID, name: 'Science' } as Row,
    { id: 'stream-commerce', schoolId: SCHOOL_ID, name: 'Commerce' } as Row,
    { id: 'stream-humanities', schoolId: SCHOOL_ID, name: 'Humanities' } as Row,
  ]

  const subjectDefs: Array<[string, string, string]> = [
    ['math', 'Mathematics', '#6366f1'],
    ['english', 'English', '#ec4899'],
    ['science', 'Science', '#10b981'],
    ['physics', 'Physics', '#0ea5e9'],
    ['chemistry', 'Chemistry', '#f59e0b'],
    ['biology', 'Biology', '#22c55e'],
    ['social', 'Social Studies', '#a855f7'],
    ['hindi', 'Hindi', '#f97316'],
    ['computer', 'Computer Science', '#14b8a6'],
    ['pe', 'Physical Education', '#84cc16'],
  ]
  db.Subject = subjectDefs.map(([id, name, color]) => ({ id, schoolId: SCHOOL_ID, name, color } as Row))

  db.Room = [
    { id: 'room-a201', schoolId: SCHOOL_ID, name: 'A-201', kind: 'CLASSROOM', capacity: 45 } as Row,
    { id: 'room-a202', schoolId: SCHOOL_ID, name: 'A-202', kind: 'CLASSROOM', capacity: 45 } as Row,
    { id: 'room-b101', schoolId: SCHOOL_ID, name: 'B-101 Science Lab', kind: 'LAB', capacity: 30 } as Row,
    { id: 'room-b102', schoolId: SCHOOL_ID, name: 'B-102 Computer Lab', kind: 'LAB', capacity: 30 } as Row,
    { id: 'room-hall', schoolId: SCHOOL_ID, name: 'Main Hall', kind: 'HALL', capacity: 300 } as Row,
  ]

  // ── Users — one of each role, login-ready, plus a handful of extra teachers/students for realism.
  const mkUser = (over: Partial<Row> & { id: string; role: string; name: string; email: string; password: string }): Row => ({
    schoolId: SCHOOL_ID,
    title: over.title ?? over.role,
    avatarHue: Math.floor(Math.random() * 360),
    verified: true,
    active: true,
    mustChangePassword: false,
    isCounselor: false,
    createdAt: '2025-04-01T00:00:00.000Z',
    ...over,
  })

  db.User = [
    mkUser({ id: 'u-sa', role: 'superadmin', name: 'Dr. Arun Nambiar', email: 'principal@edkonic.in', password: 'principal123', title: 'Principal & Superadmin', designation: 'Principal', department: 'Administration', employeeId: 'EMP-2018-0001', joinDate: '2018-04-01' }),
    mkUser({ id: 'u-ad', role: 'admin', name: 'Priya Menon', email: 'admin@edkonic.in', password: 'admin123', title: 'Vice Principal & Admin', designation: 'Vice Principal', department: 'Administration', employeeId: 'EMP-2019-0002', joinDate: '2019-06-01' }),
    mkUser({ id: 'u-t', role: 'teacher', name: 'Meera Krishnan', email: 'teacher@edkonic.in', password: 'teacher123', title: 'Mathematics Teacher', designation: 'PGT Mathematics', department: 'Mathematics', employeeId: 'EMP-2021-0001', joinDate: '2021-06-01', subjects: ['math'] }),
    mkUser({ id: 'u-t2', role: 'teacher', name: 'Arjun Nair', email: 'arjun.n@edkonic.in', password: 'teacher123', title: 'English Teacher', designation: 'PGT English', department: 'English', employeeId: 'EMP-2020-0002', joinDate: '2020-06-01', subjects: ['english'] }),
    mkUser({ id: 'u-t3', role: 'teacher', name: 'Sofia D’Souza', email: 'sofia.d@edkonic.in', password: 'teacher123', title: 'Science Teacher', designation: 'PGT Science', department: 'Science', employeeId: 'EMP-2021-0002', joinDate: '2021-06-01', subjects: ['science', 'biology'] }),
    mkUser({ id: 'u-t4', role: 'teacher', name: 'Rahul Verma', email: 'rahul.v@edkonic.in', password: 'teacher123', title: 'Physics Teacher', designation: 'PGT Physics', department: 'Science', employeeId: 'EMP-2020-0003', joinDate: '2020-06-01', subjects: ['physics'] }),
    mkUser({ id: 'u-t5', role: 'teacher', name: 'Ananya Iyer', email: 'ananya.i@edkonic.in', password: 'teacher123', title: 'Chemistry Teacher', designation: 'PGT Chemistry', department: 'Science', employeeId: 'EMP-2022-0001', joinDate: '2022-06-01', subjects: ['chemistry'] }),
    mkUser({ id: 'u-t6', role: 'teacher', name: 'Vikram Rao', email: 'vikram.r@edkonic.in', password: 'teacher123', title: 'Computer Science Teacher', designation: 'PGT Computer Science', department: 'Computer Science', employeeId: 'EMP-2022-0002', joinDate: '2022-06-01', subjects: ['computer'] }),
    mkUser({ id: 'u-st', role: 'staff', name: 'Kavita Joshi', email: 'staff@edkonic.in', password: 'staff123', title: 'Front Office', designation: 'Office Executive', department: 'Administration', employeeId: 'EMP-2023-0001', joinDate: '2023-01-01' }),
    mkUser({ id: 'u-p', role: 'parent', name: 'Sunil Kumar', email: 'parent@edkonic.in', password: 'parent123', title: 'Parent', wards: 'u-s1' }),
    mkUser({ id: 'u-s1', role: 'student', name: 'Ravi Kumar', email: 'ravi.k@edkonic.in', password: 'student123', title: 'Student', class: 'X', section: 'A', roll: '12', parentEmail: 'parent@edkonic.in', dob: '2010-05-14', board: 'CBSE' }),
    mkUser({ id: 'u-s2', role: 'student', name: 'Ananya Singh', email: 'ananya.s@edkonic.in', password: 'student123', title: 'Student', class: 'X', section: 'A', roll: '13', dob: '2010-08-22', board: 'CBSE' }),
    mkUser({ id: 'u-s3', role: 'student', name: 'Karthik Reddy', email: 'karthik.r@edkonic.in', password: 'student123', title: 'Student', class: 'X', section: 'B', roll: '05', dob: '2010-02-10', board: 'CBSE' }),
    mkUser({ id: 'u-s4', role: 'student', name: 'Divya Sharma', email: 'divya.s@edkonic.in', password: 'student123', title: 'Student', class: 'IX', section: 'A', roll: '21', dob: '2011-03-18', board: 'CBSE' }),
  ]

  // ── Classes: X-A, X-B, IX-A, IX-B on the CBSE board, science stream for the senior-most grade only.
  const classDefs: Array<{ id: string; gradeId: string; section: string; classTeacherId: string }> = [
    { id: 'class-9a', gradeId: 'grade-9', section: 'A', classTeacherId: 'u-t2' },
    { id: 'class-9b', gradeId: 'grade-9', section: 'B', classTeacherId: 'u-t3' },
    { id: 'class-10a', gradeId: 'grade-10', section: 'A', classTeacherId: 'u-t' },
    { id: 'class-10b', gradeId: 'grade-10', section: 'B', classTeacherId: 'u-t4' },
  ]
  db.Class = classDefs.map(c => ({
    id: c.id, schoolId: SCHOOL_ID, gradeId: c.gradeId, boardId: 'board-cbse', section: c.section,
    stream: null, classTeacherId: c.classTeacherId, academicYearId: 'ay-2025',
  } as Row))

  db.ClassSubject = [
    { id: 'cs-9a-math', schoolId: SCHOOL_ID, classId: 'class-9a', subjectId: 'math', teacherId: 'u-t', periodsPerWeek: 6 },
    { id: 'cs-9a-eng', schoolId: SCHOOL_ID, classId: 'class-9a', subjectId: 'english', teacherId: 'u-t2', periodsPerWeek: 5 },
    { id: 'cs-9a-sci', schoolId: SCHOOL_ID, classId: 'class-9a', subjectId: 'science', teacherId: 'u-t3', periodsPerWeek: 6 },
    { id: 'cs-10a-math', schoolId: SCHOOL_ID, classId: 'class-10a', subjectId: 'math', teacherId: 'u-t', periodsPerWeek: 6 },
    { id: 'cs-10a-eng', schoolId: SCHOOL_ID, classId: 'class-10a', subjectId: 'english', teacherId: 'u-t2', periodsPerWeek: 5 },
    { id: 'cs-10a-phy', schoolId: SCHOOL_ID, classId: 'class-10a', subjectId: 'physics', teacherId: 'u-t4', periodsPerWeek: 5 },
    { id: 'cs-10a-chem', schoolId: SCHOOL_ID, classId: 'class-10a', subjectId: 'chemistry', teacherId: 'u-t5', periodsPerWeek: 5 },
    { id: 'cs-10b-math', schoolId: SCHOOL_ID, classId: 'class-10b', subjectId: 'math', teacherId: 'u-t', periodsPerWeek: 6 },
  ].map(r => r as Row)

  db.Enrollment = [
    { id: 'enr-s1', schoolId: SCHOOL_ID, studentId: 'u-s1', classId: 'class-10a', academicYearId: 'ay-2025', status: 'active', rollNo: '12' },
    { id: 'enr-s2', schoolId: SCHOOL_ID, studentId: 'u-s2', classId: 'class-10a', academicYearId: 'ay-2025', status: 'active', rollNo: '13' },
    { id: 'enr-s3', schoolId: SCHOOL_ID, studentId: 'u-s3', classId: 'class-10b', academicYearId: 'ay-2025', status: 'active', rollNo: '05' },
    { id: 'enr-s4', schoolId: SCHOOL_ID, studentId: 'u-s4', classId: 'class-9a', academicYearId: 'ay-2025', status: 'active', rollNo: '21' },
  ].map(r => r as Row)

  db.Guardian = [
    { id: 'g-1', schoolId: SCHOOL_ID, studentId: 'u-s1', parentId: 'u-p', relation: 'Father', isPrimary: true },
  ].map(r => r as Row)
}
