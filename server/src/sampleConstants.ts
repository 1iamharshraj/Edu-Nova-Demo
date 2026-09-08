// Server-local copies of the constants/seed data the demo school loader (`sampleData.ts` and its
// `samplePhase*.ts` helpers) needs. These used to be imported from the frontend's `src/lib/data.ts`
// (`seedDB()` / `SUBJECTS` / `TIMESLOTS` / `DAYS`), which kept the server dependent on frontend code.
// Now that the legacy JSON blob (`SchoolData`) and the legacy `User` columns are gone, only a small
// slice of that old seed literal is still needed here: the six demo subjects, the "standard day" period
// slots, the weekday list, the three demo terms, and the demo user roster (used only as in-memory wiring
// to build real Enrollment/Guardian/ClassSubject rows — none of these fields are persisted onto `User`
// any more except the small, still-real profile fields).

export interface SeedSubject { id: string; name: string; teacher: string; color: string }

export const SUBJECTS: SeedSubject[] = [
  { id: 'math', name: 'Mathematics', teacher: 'Meera Krishnan', color: '#6366f1' },
  { id: 'phy', name: 'Physics', teacher: 'Arjun Nair', color: '#0ea5e9' },
  { id: 'chem', name: 'Chemistry', teacher: 'Sofia D’Souza', color: '#10b981' },
  { id: 'eng', name: 'English', teacher: 'Rahul Verma', color: '#f59e0b' },
  { id: 'cs', name: 'Computer Science', teacher: 'Ananya Iyer', color: '#8b5cf6' },
  { id: 'pe', name: 'Physical Ed.', teacher: 'Vikram Rao', color: '#ef4444' },
]

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

export const TIMESLOTS = [
  { time: '09:00', label: '09:00', kind: 'class' as const },
  { time: '09:45', label: '09:45', kind: 'class' as const },
  { time: '10:30', label: 'Morning Break', kind: 'break' as const, duration: '10:30 - 10:45' },
  { time: '11:30', label: '11:30', kind: 'class' as const },
  { time: '12:15', label: '12:15', kind: 'class' as const },
  { time: '13:00', label: 'Lunch Break', kind: 'break' as const, duration: '13:00 - 13:45' },
  { time: '13:45', label: '13:45', kind: 'class' as const },
  { time: '14:30', label: '14:30', kind: 'class' as const },
  { time: '15:15', label: 'Evening Break', kind: 'break' as const, duration: '15:15 - 15:30' },
  { time: '15:30', label: '15:30', kind: 'class' as const },
  { time: '16:15', label: '16:15', kind: 'class' as const },
]

export interface SeedTerm { id: string; name: string; current?: boolean }

export const SEED_TERMS: SeedTerm[] = [
  { id: 't1', name: 'Term 1' },
  { id: 't2', name: 'Term 2' },
  { id: 't3', name: 'Term 3', current: true },
]

// The demo roster. Only the fields the sample loaders actually read: identity/auth/profile fields that
// still map onto real `User` columns, plus `class` / `section` / `roll` / `subjects` / `parentEmail` used
// purely as in-memory seed wiring to build real Enrollment / Guardian / ClassSubject rows.
export interface SeedUser {
  id: string
  role: 'parent' | 'student' | 'teacher' | 'staff' | 'admin' | 'superadmin'
  name: string
  email: string
  password: string
  title: string
  avatarHue: number
  verified: boolean
  department?: string
  designation?: string
  reportsTo?: string
  joinDate?: string
  phone?: string
  dob?: string
  class?: string
  section?: string
  roll?: string
  subjects?: string[]
  parentEmail?: string
}

export const SEED_USERS: SeedUser[] = [
  { id: 'u-sa', role: 'superadmin', name: 'Dr. Arun Nambiar', email: 'principal@edunova.in', password: 'principal123', title: 'Principal & Superadmin', avatarHue: 280, verified: true, designation: 'Principal', department: 'Administration', joinDate: '2018-04-01' },
  { id: 'u-a', role: 'admin', name: 'Dr. Leela Menon', email: 'admin@edunova.in', password: 'admin123', title: 'School Administrator', avatarHue: 330, verified: true, designation: 'Administrator', department: 'Administration', joinDate: '2019-06-01' },
  { id: 'u-st', role: 'staff', name: 'Farhan Qureshi', email: 'staff@edunova.in', password: 'staff123', title: 'Office Superintendent', avatarHue: 20, verified: true, designation: 'Office Superintendent', department: 'Administration', joinDate: '2020-07-15' },
  { id: 'u-t', role: 'teacher', name: 'Meera Krishnan', email: 'teacher@edunova.in', password: 'teacher123', title: 'Mathematics · Class Teacher X-A', avatarHue: 160, verified: true, subjects: ['Mathematics'], class: 'X-A', joinDate: '2021-05-10' },
  { id: 'u-p', role: 'parent', name: 'Nisha Sharma', email: 'parent@edunova.in', password: 'parent123', title: 'Parent of Aarav Sharma · X-A', avatarHue: 262, verified: false, phone: '+91 98765 43223' },
  { id: 'u-s', role: 'student', name: 'Aarav Sharma', email: 'student@edunova.in', password: 'student123', title: 'Class X-A · Roll 12', avatarHue: 200, verified: true, class: 'X-A', section: 'A', roll: '12', parentEmail: 'parent@edunova.in', dob: '2010-03-15' },
  // additional staff & teachers
  { id: 'u-t2', role: 'teacher', name: 'Arjun Nair', email: 'arjun.n@edunova.in', password: 'teacher123', title: 'Physics Teacher', avatarHue: 190, verified: true, subjects: ['Physics'], class: 'X-B', joinDate: '2020-03-12' },
  { id: 'u-t3', role: 'teacher', name: 'Sofia D’Souza', email: 'sofia.d@edunova.in', password: 'teacher123', title: 'Chemistry Teacher', avatarHue: 120, verified: true, subjects: ['Chemistry'], class: 'X-A', joinDate: '2021-06-15' },
  { id: 'u-t4', role: 'teacher', name: 'Rahul Verma', email: 'rahul.v@edunova.in', password: 'teacher123', title: 'English Teacher', avatarHue: 45, verified: true, subjects: ['English'], class: 'IX-A', joinDate: '2019-04-20' },
  { id: 'u-t5', role: 'teacher', name: 'Ananya Iyer', email: 'ananya.i@edunova.in', password: 'teacher123', title: 'Computer Science Teacher', avatarHue: 260, verified: true, subjects: ['Computer Science'], class: 'X-A', joinDate: '2022-01-08' },
  { id: 'u-t6', role: 'teacher', name: 'Vikram Rao', email: 'vikram.r@edunova.in', password: 'teacher123', title: 'Physical Education Teacher', avatarHue: 340, verified: true, subjects: ['Physical Ed.'], class: 'IX-B', joinDate: '2018-11-02' },
  { id: 'u-st2', role: 'staff', name: 'Priya Menon', email: 'priya.m@edunova.in', password: 'staff123', title: 'Accounts Officer', avatarHue: 60, verified: true, designation: 'Accounts Officer', department: 'Finance', joinDate: '2020-02-14' },
  { id: 'u-st3', role: 'staff', name: 'Rajesh Kumar', email: 'rajesh.k@edunova.in', password: 'staff123', title: 'Admission Coordinator', avatarHue: 100, verified: true, designation: 'Admission Coordinator', department: 'Admissions', joinDate: '2021-08-30' },
  // additional students
  { id: 'u-s2', role: 'student', name: 'Diya Patel', email: 'diya.p@edunova.in', password: 'student123', title: 'Class X-A · Roll 4', avatarHue: 210, verified: true, class: 'X-A', section: 'A', roll: '4', parentEmail: 'parent.diya@edunova.in', dob: '2010-06-20' },
  { id: 'u-s3', role: 'student', name: 'Kabir Singh', email: 'kabir.s@edunova.in', password: 'student123', title: 'Class X-B · Roll 7', avatarHue: 240, verified: true, class: 'X-B', section: 'B', roll: '7', parentEmail: 'parent.kabir@edunova.in', dob: '2010-01-08' },
  { id: 'u-s4', role: 'student', name: 'Rohan Gupta', email: 'rohan.g@edunova.in', password: 'student123', title: 'Class X-B · Roll 15', avatarHue: 30, verified: true, class: 'X-B', section: 'B', roll: '15', parentEmail: 'parent.rohan@edunova.in', dob: '2010-09-30' },
  // parents
  { id: 'u-p2', role: 'parent', name: 'Priya Patel', email: 'parent.diya@edunova.in', password: 'parent123', title: 'Parent of Diya Patel · X-A', avatarHue: 300, verified: false, phone: '+91 98765 43224' },
  { id: 'u-p3', role: 'parent', name: 'Harpreet Singh', email: 'parent.kabir@edunova.in', password: 'parent123', title: 'Parent of Kabir Singh · X-B', avatarHue: 70, verified: false, phone: '+91 98765 43225' },
  { id: 'u-p4', role: 'parent', name: 'Anita Gupta', email: 'parent.rohan@edunova.in', password: 'parent123', title: 'Parent of Rohan Gupta · X-B', avatarHue: 150, verified: false, phone: '+91 98765 43226' },
]
