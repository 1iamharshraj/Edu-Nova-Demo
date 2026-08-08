// ─────────────────────────────────────────────────────────────
// EduNova · simulated backend (seed data + types)
// Everything persists to localStorage so the whole product works
// end-to-end without a server.
// ─────────────────────────────────────────────────────────────

export type Role = 'parent' | 'student' | 'teacher' | 'staff' | 'admin' | 'superadmin'

export interface User {
  id: string
  role: Role
  name: string
  email: string
  password: string
  title: string
  avatarHue: number
  verified: boolean
  // extended profile fields
  class?: string
  section?: string
  roll?: string
  subjects?: string[]
  department?: string
  designation?: string
  reportsTo?: string
  joinDate?: string
  phone?: string
  parentEmail?: string
  board?: Board
  dob?: string
  salary?: number
  wards?: string
  contract?: Contract
  resignation?: Resignation
}

export interface Term { id: string; name: string; range: string; months: string[]; current?: boolean }

export interface Subject { id: string; name: string; teacher: string; color: string }

export interface TTCell { subject: string; room: string; time: string }

export interface AttendanceSubject { subject: string; present: number; total: number }
export interface AttendanceDay { date: string; status: 'P' | 'A' | 'L' }

export interface MarkRow {
  subject: string
  assessments: { name: string; score: number; max: number }[]
}

export interface FeedPost {
  id: string; author: string; role: string; time: string
  text: string; tag: string; likes: number; liked?: boolean
  comments: { by: string; text: string }[]; gradient: string; term: string
}

export interface Message { from: 'me' | 'them'; text: string; time: string }
export interface Thread { id: string; person: string; subtitle: string; term: string; unread: number; messages: Message[]; kind?: 'parent' | 'teacher'; parentName?: string; studentId?: string }

export interface Homework {
  id: string; subject: string; title: string; due: string; term: string
  status: 'Submitted' | 'Pending' | 'Graded' | 'Late'; grade?: string; description: string
}

export interface Receipt { id: string; label: string; date: string; amount: number; status: 'Paid' | 'Due'; term: string; kind: 'fee' | 'salary'; studentId?: string }

export interface CalEvent { date: string; title: string; type: 'holiday' | 'exam' | 'event'; term: string }

export interface Slip { id: string; title: string; detail: string; due: string; status: 'Pending' | 'Approved' | 'Declined'; requiresAuth: boolean }

export interface LeaveReq { id: string; student: string; from: string; to: string; reason: string; status: 'Pending' | 'Approved' | 'Declined'; by: string }

export interface Achievement { id: string; title: string; detail: string; date: string; by: string; kind: 'student' | 'teacher' }

export interface RankRow { rank: number; name: string; score: number; grade: string }

export interface HealthRec { id: string; label: string; detail: string; date: string; signed: boolean }

export interface DirectoryPerson { id: string; name: string; role: string; subject?: string; email: string; phone: string; room: string }

export interface Application { id: string; kind: 'Admission' | 'TC' | 'Bonafide' | 'Disciplinary'; name: string; detail: string; date: string; status: 'Pending' | 'Verified' | 'Approved' | 'Declined'; notes?: string; studentId?: string }

export interface AssignmentWork { id: string; title: string; event: string; due: string; status: 'Assigned' | 'Done' }

export type Board = 'CBSE' | 'Matric'

export type BoardDetailStatus = 'Draft' | 'Pending' | 'Validated' | 'SentToBoard'

export interface BoardDetail {
  studentId: string
  name: string
  board: Board
  registrationNo: string
  schoolName: string
  dob: string
  rollNo: string
  class: string
  section: string
  year: string
  affiliationNo?: string
  status: BoardDetailStatus
  validatedBy?: string
  validatedAt?: string
  sentToBoard?: boolean
  sentAt?: string
  mismatchNote?: string
}

export interface ValidatedMark {
  subject: string
  theory: number
  practical: number
  total: number
  max: number
  grade: string
  boardGrade?: string
}

export type MarksheetStatus = 'Draft' | 'TeacherSigned' | 'Sealed' | 'Published'

export interface Marksheet {
  id: string
  studentId: string
  board: Board
  year: string
  termId: string
  details: BoardDetail
  subjects: ValidatedMark[]
  status: MarksheetStatus
  teacherSignedBy?: string
  sealedBy?: string
  sealedAt?: string
  publishedAt?: string
  totalScore?: number
  cgpa?: number
  percentage?: number
  rank?: number
}

export type ContractStatus = 'Draft' | 'Active' | 'Resigned' | 'Terminated'

export interface Contract {
  id: string
  userId: string
  designation: string
  department?: string
  salary: number
  startDate: string
  endDate: string
  clauses: string
  status: ContractStatus
  signedBy?: string
  signedAt?: string
}

export type ResignationStatus = 'Pending' | 'Approved' | 'Declined' | 'Withdrawn'

export interface Resignation {
  id: string
  userId: string
  reason: string
  submittedAt: string
  lastWorkingDate: string
  status: ResignationStatus
  approvedBy?: string
  approvedAt?: string
  adminNotes?: string
}

export type MeetingStatus = 'Requested' | 'Scheduled' | 'Completed' | 'Cancelled'

export interface MeetingRequest {
  id: string
  requesterId: string
  requesterRole: Role
  requesterName: string
  teacherId?: string
  studentId: string
  studentName: string
  purpose: string
  slot: string
  meetLink: string
  status: MeetingStatus
  createdAt: string
  approvedBy?: string
  approvedAt?: string
}

export interface WorkUpload {
  id: string
  homeworkId: string
  fileName: string
  fileSize: string
  uploadedBy: string
  uploadedAt: string
  status: 'Uploaded' | 'Verified' | 'Rejected'
  url?: string
  notes?: string
}

export type AttendanceStatus = 'P' | 'A' | 'L' | 'H'

export interface AttendanceRecord {
  id: string
  userId: string
  role: Role
  date: string
  status: AttendanceStatus
  notes?: string
}

export type AIParentCallStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Failed' | 'Cancelled'

export interface AIParentCall {
  id: string
  studentId: string
  studentName: string
  parentId?: string
  parentName: string
  requesterId: string
  requesterRole: Role
  requesterName: string
  reason: 'fee' | 'attendance' | 'disciplinary' | 'general'
  reasonText: string
  language: string
  scheduledAt: string
  status: AIParentCallStatus
  duration?: number
  transcript?: string
  outcome?: 'confirmed' | 'callback' | 'unreachable' | 'refused'
  createdAt: string
}

export type DisciplinaryStatus = 'Reported' | 'Scheduled' | 'Heard' | 'Decision' | 'Action Taken' | 'Appealed' | 'Closed'
export type DisciplinaryAction = 'Warning' | 'Suspension' | 'Expulsion' | 'Community Service' | 'Parent Meeting' | 'Fine' | 'No Action'

export interface DisciplinaryCase {
  id: string
  studentId: string
  studentName: string
  title: string
  description: string
  reportedBy: string
  reportedAt: string
  witnesses?: string
  evidence?: string
  status: DisciplinaryStatus
  hearingDate?: string
  decision?: string
  actionTaken?: DisciplinaryAction
  appeal?: string
  notes?: string
  relatedPeople?: string
}

export interface StudentProfileReport {
  id: string
  studentId: string
  generatedAt: string
  generatedBy: string
  summary: string
}

export interface DB {
  users: User[]
  terms: Term[]
  subjects: Subject[]
  timetable: Record<string, TTCell[][]>
  attendance: Record<string, { bySubject: AttendanceSubject[]; days: AttendanceDay[] }>
  marks: Record<string, MarkRow[]>
  feed: FeedPost[]
  threads: Thread[]
  homework: Homework[]
  receipts: Receipt[]
  events: CalEvent[]
  slips: Slip[]
  leaves: LeaveReq[]
  achievements: Achievement[]
  ranks: Record<string, { overall: RankRow[]; subjects: Record<string, RankRow[]> }>
  health: HealthRec[]
  directory: DirectoryPerson[]
  applications: Application[]
  workAssign: AssignmentWork[]
  // new data
  marksheets: Marksheet[]
  contracts: Contract[]
  resignations: Resignation[]
  meetings: MeetingRequest[]
  workUploads: WorkUpload[]
  attendanceRecords: AttendanceRecord[]
  boardDetails: Record<string, BoardDetail>
  aiParentCalls: AIParentCall[]
  disciplinaryCases: DisciplinaryCase[]
  studentProfileReports: StudentProfileReport[]
}

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
export const PERIODS = ['08:00', '09:00', '10:00', '11:15', '12:15', '13:30']

const subj = (id: string, name: string, teacher: string, color: string): Subject => ({ id, name, teacher, color })

export const SUBJECTS: Subject[] = [
  subj('math', 'Mathematics', 'Meera Krishnan', '#6366f1'),
  subj('phy', 'Physics', 'Arjun Nair', '#0ea5e9'),
  subj('chem', 'Chemistry', 'Sofia D’Souza', '#10b981'),
  subj('eng', 'English', 'Rahul Verma', '#f59e0b'),
  subj('cs', 'Computer Science', 'Ananya Iyer', '#8b5cf6'),
  subj('pe', 'Physical Ed.', 'Vikram Rao', '#ef4444'),
]

const mkCell = (s: string, room: string, time: string): TTCell => ({ subject: s, room, time })

function makeTT(shift: number): TTCell[][] {
  const names = ['Mathematics', 'Physics', 'Chemistry', 'English', 'Computer Science', 'Physical Ed.']
  const rooms = ['A-201', 'Lab-2', 'Lab-1', 'B-104', 'CS-Lab', 'Ground']
  return DAYS.map((_, d) =>
    PERIODS.map((t, p) => {
      const i = (d * 2 + p + shift) % names.length
      return mkCell(names[i], rooms[i], t)
    })
  )
}

function makeDays(termIdx: number): AttendanceDay[] {
  const out: AttendanceDay[] = []
  const base = [3 + termIdx * 90]
  const d = base[0]
  for (let i = 0; i < 42; i++) {
    const date = new Date(2025, 5 + termIdx * 3, d + i)
    const r = (i * 7 + termIdx * 3) % 23
    out.push({
      date: date.toISOString().slice(0, 10),
      status: r === 5 ? 'A' : r === 11 ? 'L' : 'P',
    })
  }
  return out
}

function gradeOf(pct: number) {
  return pct >= 90 ? 'A1' : pct >= 80 ? 'A2' : pct >= 70 ? 'B1' : pct >= 60 ? 'B2' : pct >= 50 ? 'C1' : 'C2'
}

function makeMarks(termIdx: number): MarkRow[] {
  return SUBJECTS.map((s, si) => {
    const lift = termIdx * 3 + (si % 2)
    const a = Math.min(96, 62 + si * 5 + lift + (termIdx === 2 ? 6 : 0))
    const b = Math.min(98, 70 + ((si * 7) % 18) + lift)
    const c = Math.min(100, 66 + ((si * 11) % 22) + lift)
    return {
      subject: s.name,
      assessments: [
        { name: 'Unit Test', score: Math.round(a * 0.25), max: 25 },
        { name: 'Mid Term', score: Math.round(b * 0.5), max: 50 },
        { name: 'Term Exam', score: Math.round(c * 0.8), max: 80 },
      ],
    }
  })
}

export function gradeFor(row: MarkRow) {
  const s = row.assessments.reduce((a, x) => a + x.score, 0)
  const m = row.assessments.reduce((a, x) => a + x.max, 0)
  return gradeOf((s / m) * 100)
}
export function pctFor(row: MarkRow) {
  const s = row.assessments.reduce((a, x) => a + x.score, 0)
  const m = row.assessments.reduce((a, x) => a + x.max, 0)
  return Math.round((s / m) * 100)
}

export function cgpaFromMarks(marks: ValidatedMark[]) {
  const total = marks.reduce((a, m) => a + m.total, 0)
  const max = marks.reduce((a, m) => a + m.max, 0)
  const pct = (total / max) * 100
  return { cgpa: Number((pct / 9.5).toFixed(2)), pct: Math.round(pct) }
}

export function matricGrade(pct: number) {
  if (pct >= 90) return 'A+'
  if (pct >= 80) return 'A'
  if (pct >= 70) return 'B+'
  if (pct >= 60) return 'B'
  if (pct >= 50) return 'C+'
  if (pct >= 40) return 'C'
  return 'D'
}

const students = ['Aarav Sharma', 'Diya Patel', 'Kabir Singh', 'Anika Menon', 'Rohan Gupta', 'Ira Choudhary', 'Aditya Rao', 'Myra Kapoor', 'Vihaan Joshi', 'Sara Ali']

function makeRanks(termIdx: number) {
  const overall: RankRow[] = students
    .map((n, i) => ({
      rank: 0,
      name: n,
      score: Math.round(920 - i * 14 + ((i * 37 + termIdx * 13) % 20) - (n === 'Aarav Sharma' ? 0 : (i % 3) * 6)),
      grade: '',
    }))
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ ...r, rank: i + 1, grade: gradeOf(r.score / 10) }))
  const subjects: Record<string, RankRow[]> = {}
  SUBJECTS.forEach((s, si) => {
    subjects[s.name] = students
      .map((n, i) => ({ rank: 0, name: n, score: Math.round(94 - ((i * 7 + si * 5 + termIdx * 3) % 30)), grade: '' }))
      .sort((a, b) => b.score - a.score)
      .map((r, i) => ({ ...r, rank: i + 1, grade: gradeOf(r.score) }))
  })
  return { overall, subjects }
}

function makeAttendanceRecords(userId: string, role: Role, termIdx: number): AttendanceRecord[] {
  const out: AttendanceRecord[] = []
  const base = 3 + termIdx * 90
  const rate = role === 'student' ? 0.92 : 0.97
  for (let i = 0; i < 42; i++) {
    const date = new Date(2025, 5 + termIdx * 3, base + i)
    const r = Math.random()
    let status: AttendanceStatus = 'P'
    if (date.getDay() === 0) status = 'H'
    else if (r > rate) status = 'A'
    else if (r > rate - 0.03) status = 'L'
    out.push({ id: `att_${userId}_${i}`, userId, role, date: date.toISOString().slice(0, 10), status, notes: '' })
  }
  return out
}

function makeContract(userId: string, designation: string, salary: number, department?: string): Contract {
  return {
    id: 'c_' + userId,
    userId,
    designation,
    department,
    salary,
    startDate: '2024-06-01',
    endDate: '2027-05-31',
    clauses: 'Standard EduNova employment terms: 60-day notice period, 18 paid leave days per year, confidentiality and non-solicitation clauses.',
    status: 'Active',
    signedBy: 'Dr. Leela Menon',
    signedAt: '2024-06-01',
  }
}

export function seedDB(): DB {
  const terms: Term[] = [
    { id: 't1', name: 'Term 1', range: 'Jun – Sep 2025', months: ['June', 'July', 'August', 'September'] },
    { id: 't2', name: 'Term 2', range: 'Oct – Jan 2026', months: ['October', 'November', 'December', 'January'] },
    { id: 't3', name: 'Term 3', range: 'Feb – May 2026', months: ['February', 'March', 'April', 'May'], current: true },
  ]

  const users: User[] = [
    { id: 'u-sa', role: 'superadmin', name: 'Dr. Arun Nambiar', email: 'principal@edunova.in', password: 'principal123', title: 'Principal & Superadmin', avatarHue: 280, verified: true, designation: 'Principal', department: 'Administration', joinDate: '2018-04-01' },
    { id: 'u-a', role: 'admin', name: 'Dr. Leela Menon', email: 'admin@edunova.in', password: 'admin123', title: 'School Administrator', avatarHue: 330, verified: true, designation: 'Administrator', department: 'Administration', joinDate: '2019-06-01' },
    { id: 'u-st', role: 'staff', name: 'Farhan Qureshi', email: 'staff@edunova.in', password: 'staff123', title: 'Office Superintendent', avatarHue: 20, verified: true, designation: 'Office Superintendent', department: 'Administration', joinDate: '2020-07-15' },
    { id: 'u-t', role: 'teacher', name: 'Meera Krishnan', email: 'teacher@edunova.in', password: 'teacher123', title: 'Mathematics · Class Teacher X-A', avatarHue: 160, verified: true, subjects: ['Mathematics'], class: 'X-A', joinDate: '2021-05-10' },
    { id: 'u-p', role: 'parent', name: 'Nisha Sharma', email: 'parent@edunova.in', password: 'parent123', title: 'Parent of Aarav Sharma · X-A', avatarHue: 262, verified: false, phone: '+91 98765 43223' },
    { id: 'u-s', role: 'student', name: 'Aarav Sharma', email: 'student@edunova.in', password: 'student123', title: 'Class X-A · Roll 12', avatarHue: 200, verified: true, class: 'X-A', section: 'A', roll: '12', board: 'CBSE', parentEmail: 'parent@edunova.in', dob: '2010-03-15' },
    // additional staff & teachers
    { id: 'u-t2', role: 'teacher', name: 'Arjun Nair', email: 'arjun.n@edunova.in', password: 'teacher123', title: 'Physics Teacher', avatarHue: 190, verified: true, subjects: ['Physics'], class: 'X-B', joinDate: '2020-03-12' },
    { id: 'u-t3', role: 'teacher', name: 'Sofia D’Souza', email: 'sofia.d@edunova.in', password: 'teacher123', title: 'Chemistry Teacher', avatarHue: 120, verified: true, subjects: ['Chemistry'], class: 'X-A', joinDate: '2021-06-15' },
    { id: 'u-t4', role: 'teacher', name: 'Rahul Verma', email: 'rahul.v@edunova.in', password: 'teacher123', title: 'English Teacher', avatarHue: 45, verified: true, subjects: ['English'], class: 'IX-A', joinDate: '2019-04-20' },
    { id: 'u-t5', role: 'teacher', name: 'Ananya Iyer', email: 'ananya.i@edunova.in', password: 'teacher123', title: 'Computer Science Teacher', avatarHue: 260, verified: true, subjects: ['Computer Science'], class: 'X-A', joinDate: '2022-01-08' },
    { id: 'u-t6', role: 'teacher', name: 'Vikram Rao', email: 'vikram.r@edunova.in', password: 'teacher123', title: 'Physical Education Teacher', avatarHue: 340, verified: true, subjects: ['Physical Ed.'], class: 'IX-B', joinDate: '2018-11-02' },
    { id: 'u-st2', role: 'staff', name: 'Priya Menon', email: 'priya.m@edunova.in', password: 'staff123', title: 'Accounts Officer', avatarHue: 60, verified: true, designation: 'Accounts Officer', department: 'Finance', joinDate: '2020-02-14' },
    { id: 'u-st3', role: 'staff', name: 'Rajesh Kumar', email: 'rajesh.k@edunova.in', password: 'staff123', title: 'Admission Coordinator', avatarHue: 100, verified: true, designation: 'Admission Coordinator', department: 'Admissions', joinDate: '2021-08-30' },
    // additional students
    { id: 'u-s2', role: 'student', name: 'Diya Patel', email: 'diya.p@edunova.in', password: 'student123', title: 'Class X-A · Roll 4', avatarHue: 210, verified: true, class: 'X-A', section: 'A', roll: '4', board: 'CBSE', parentEmail: 'parent.diya@edunova.in', dob: '2010-06-20' },
    { id: 'u-s3', role: 'student', name: 'Kabir Singh', email: 'kabir.s@edunova.in', password: 'student123', title: 'Class X-B · Roll 7', avatarHue: 240, verified: true, class: 'X-B', section: 'B', roll: '7', board: 'Matric', parentEmail: 'parent.kabir@edunova.in', dob: '2010-01-08' },
    { id: 'u-s4', role: 'student', name: 'Rohan Gupta', email: 'rohan.g@edunova.in', password: 'student123', title: 'Class X-B · Roll 15', avatarHue: 30, verified: true, class: 'X-B', section: 'B', roll: '15', board: 'CBSE', parentEmail: 'parent.rohan@edunova.in', dob: '2010-09-30' },
    // parents
    { id: 'u-p2', role: 'parent', name: 'Priya Patel', email: 'parent.diya@edunova.in', password: 'parent123', title: 'Parent of Diya Patel · X-A', avatarHue: 300, verified: false, phone: '+91 98765 43224' },
    { id: 'u-p3', role: 'parent', name: 'Harpreet Singh', email: 'parent.kabir@edunova.in', password: 'parent123', title: 'Parent of Kabir Singh · X-B', avatarHue: 70, verified: false, phone: '+91 98765 43225' },
    { id: 'u-p4', role: 'parent', name: 'Anita Gupta', email: 'parent.rohan@edunova.in', password: 'parent123', title: 'Parent of Rohan Gupta · X-B', avatarHue: 150, verified: false, phone: '+91 98765 43226' },
  ]

  const timetable: DB['timetable'] = { t1: makeTT(0), t2: makeTT(2), t3: makeTT(4) }

  const attendance: DB['attendance'] = {}
  terms.forEach((t, ti) => {
    attendance[t.id] = {
      bySubject: SUBJECTS.map((s, si) => ({
        subject: s.name,
        total: 38 + ((si * 3 + ti) % 6),
        present: 34 + ((si * 5 + ti * 2) % 7),
      })).map(a => ({ ...a, present: Math.min(a.present, a.total) })),
      days: makeDays(ti),
    }
  })

  const marks: DB['marks'] = { t1: makeMarks(0), t2: makeMarks(1), t3: makeMarks(2) }

  const feed: FeedPost[] = [
    { id: 'f1', author: 'EduNova School', role: 'Official', time: '2h ago', tag: 'Announcement', text: 'Annual Sports Day 2026 was a blockbuster — 14 records broken, and X-A takes the overall trophy. Full photo album is live.', likes: 214, comments: [{ by: 'Diya Patel', text: 'That 4×100 finish was unreal!' }], gradient: 'linear-gradient(135deg,#6366f1,#a855f7,#ec4899)', term: 't3' },
    { id: 'f2', author: 'Science Club', role: 'Club', time: '1d ago', tag: 'Club', text: 'Our young astronomers captured the lunar eclipse from the school observatory deck. Swipe through the best shots from the night.', likes: 156, comments: [], gradient: 'linear-gradient(135deg,#0ea5e9,#22d3ee,#34d399)', term: 't3' },
    { id: 'f3', author: 'EduNova School', role: 'Official', time: '3d ago', tag: 'Exam', text: 'Term 3 examination timetable is published. Hall tickets will be issued through class teachers from Monday.', likes: 98, comments: [{ by: 'Nisha Sharma', text: 'Thanks for the early notice!' }], gradient: 'linear-gradient(135deg,#f59e0b,#f97316,#ef4444)', term: 't3' },
    { id: 'f4', author: 'Art Society', role: 'Club', time: '5d ago', tag: 'Arts', text: 'Winter exhibition “Chromatic” is now open in the main atrium. 80+ student artworks on display till Friday.', likes: 132, comments: [], gradient: 'linear-gradient(135deg,#8b5cf6,#d946ef,#f43f5e)', term: 't2' },
    { id: 'f5', author: 'EduNova School', role: 'Official', time: '1w ago', tag: 'Event', text: 'Founders’ Day celebrations begin at 9 AM this Saturday. Parents are welcome — entry through Gate 2.', likes: 301, comments: [{ by: 'Kabir Singh', text: 'Choir practice was great today!' }], gradient: 'linear-gradient(135deg,#10b981,#84cc16,#eab308)', term: 't2' },
  ]

  const threads: Thread[] = [
    {
      id: 'th1', person: 'Meera Krishnan', parentName: 'Nisha Sharma', studentId: 'u-s', subtitle: 'Mathematics · Class Teacher', term: 't3', unread: 1, kind: 'parent',
      messages: [
        { from: 'them', text: 'Good evening! Aarav did really well in the mid-term. His algebra is much stronger now.', time: 'Mon 6:12 PM' },
        { from: 'me', text: 'That’s great to hear, thank you! We’ve been practising daily.', time: 'Mon 7:02 PM' },
        { from: 'them', text: 'It shows. Do remind him to revise trigonometry before Friday’s quiz.', time: 'Tue 8:40 AM' },
      ],
    },
    {
      id: 'th2', person: 'Arjun Nair', parentName: 'Nisha Sharma', studentId: 'u-s', subtitle: 'Physics', term: 't3', unread: 0, kind: 'parent',
      messages: [
        { from: 'them', text: 'Lab records for optics are due this Thursday.', time: 'Sun 11:20 AM' },
        { from: 'me', text: 'Noted, he’ll submit it on time.', time: 'Sun 12:05 PM' },
      ],
    },
    {
      id: 'th3', person: 'Sofia D’Souza', parentName: 'Kabir Singh', studentId: 'u-s2', subtitle: 'Chemistry', term: 't2', unread: 0, kind: 'parent',
      messages: [
        { from: 'them', text: 'Aarav’s titration practical was excellent — full marks.', time: 'Dec 4, 3:15 PM' },
        { from: 'me', text: 'Wonderful, thank you for the update!', time: 'Dec 4, 5:31 PM' },
      ],
    },
    // teacher-teacher threads
    {
      id: 'th4', person: 'Arjun Nair', subtitle: 'Physics Teacher', term: 't3', unread: 0, kind: 'teacher',
      messages: [
        { from: 'them', text: 'Hi Meera, can we swap the X-A and X-B Physics slots on Friday?', time: 'Mon 9:00 AM' },
        { from: 'me', text: 'Sure, that works for me. I’ll update the timetable note.', time: 'Mon 9:15 AM' },
      ],
    },
    {
      id: 'th5', person: 'Sofia D’Souza', subtitle: 'Chemistry Teacher', term: 't3', unread: 1, kind: 'teacher',
      messages: [
        { from: 'them', text: 'The lab equipment for titration practicals has arrived.', time: 'Tue 11:30 AM' },
        { from: 'me', text: 'Great, thanks for the update!', time: 'Tue 12:00 PM' },
      ],
    },
  ]

  const homework: Homework[] = [
    { id: 'h1', subject: 'Mathematics', title: 'Quadratic equations — worksheet 7', due: '2026-04-10', term: 't3', status: 'Pending', description: 'Solve all 20 problems; show factorisation steps.' },
    { id: 'h2', subject: 'Physics', title: 'Optics lab record', due: '2026-04-09', term: 't3', status: 'Submitted', description: 'Complete ray diagrams and observations.' },
    { id: 'h3', subject: 'English', title: 'Essay: “The city in 2050”', due: '2026-04-06', term: 't3', status: 'Graded', grade: 'A', description: '500 words, argumentative style.' },
    { id: 'h4', subject: 'Computer Science', title: 'Python: file handling mini-project', due: '2026-04-12', term: 't3', status: 'Pending', description: 'Build a student record CLI with CSV storage.' },
    { id: 'h5', subject: 'Chemistry', title: 'Organic compounds chart', due: '2026-03-28', term: 't3', status: 'Late', description: 'Prepare a chart of functional groups with examples.' },
    { id: 'h6', subject: 'Mathematics', title: 'Trigonometry identities practice', due: '2025-12-02', term: 't2', status: 'Graded', grade: 'A2', description: 'Prove identities 1–15.' },
    { id: 'h7', subject: 'Physics', title: 'Numericals: current electricity', due: '2025-11-24', term: 't2', status: 'Graded', grade: 'A1', description: 'Chapter 12, exercises 1–10.' },
    { id: 'h8', subject: 'English', title: 'Book review: The Giver', due: '2025-09-14', term: 't1', status: 'Graded', grade: 'B1', description: '300-word critical review.' },
  ]

  const receipts: Receipt[] = [
    { id: 'r1', label: 'Tuition Fee — Term 3', date: '2026-02-05', amount: 42500, status: 'Paid', term: 't3', kind: 'fee', studentId: 'u-s' },
    { id: 'r2', label: 'Transport Fee — Term 3', date: '2026-02-05', amount: 9000, status: 'Paid', term: 't3', kind: 'fee', studentId: 'u-s' },
    { id: 'r3', label: 'Lab & Activity Fee — Term 3', date: '2026-04-20', amount: 6500, status: 'Due', term: 't3', kind: 'fee', studentId: 'u-s' },
    { id: 'r4', label: 'Tuition Fee — Term 2', date: '2025-10-03', amount: 42500, status: 'Paid', term: 't2', kind: 'fee', studentId: 'u-s' },
    { id: 'r5', label: 'Tuition Fee — Term 1', date: '2025-06-06', amount: 41000, status: 'Paid', term: 't1', kind: 'fee', studentId: 'u-s' },
    { id: 'r6', label: 'Tuition Fee — Term 3', date: '2026-02-10', amount: 42500, status: 'Paid', term: 't3', kind: 'fee', studentId: 'u-s2' },
    { id: 'r7', label: 'Lab & Activity Fee — Term 3', date: '2026-04-22', amount: 6500, status: 'Due', term: 't3', kind: 'fee', studentId: 'u-s2' },
    { id: 'r8', label: 'Tuition Fee — Term 3', date: '2026-02-12', amount: 41000, status: 'Due', term: 't3', kind: 'fee', studentId: 'u-s3' },
    { id: 'r9', label: 'Transport Fee — Term 3', date: '2026-02-12', amount: 9000, status: 'Due', term: 't3', kind: 'fee', studentId: 'u-s3' },
    { id: 'r10', label: 'Tuition Fee — Term 3', date: '2026-02-15', amount: 42500, status: 'Paid', term: 't3', kind: 'fee', studentId: 'u-s4' },
    { id: 's1', label: 'Salary — March 2026', date: '2026-03-31', amount: 78400, status: 'Paid', term: 't3', kind: 'salary', studentId: 'u-t' },
    { id: 's2', label: 'Salary — February 2026', date: '2026-02-28', amount: 76100, status: 'Paid', term: 't3', kind: 'salary', studentId: 'u-t' },
    { id: 's3', label: 'Salary — January 2026', date: '2026-01-31', amount: 78400, status: 'Paid', term: 't2', kind: 'salary', studentId: 'u-t' },
  ]

  const events: CalEvent[] = [
    { date: '2026-02-14', title: 'Term 3 begins', type: 'event', term: 't3' },
    { date: '2026-02-26', title: 'Science Exhibition', type: 'event', term: 't3' },
    { date: '2026-03-08', title: 'Holi — Holiday', type: 'holiday', term: 't3' },
    { date: '2026-03-18', title: 'Unit Test: Mathematics', type: 'exam', term: 't3' },
    { date: '2026-03-20', title: 'Unit Test: Physics', type: 'exam', term: 't3' },
    { date: '2026-04-02', title: 'Annual Sports Day', type: 'event', term: 't3' },
    { date: '2026-04-14', title: 'Ambedkar Jayanti — Holiday', type: 'holiday', term: 't3' },
    { date: '2026-05-05', title: 'Term 3 Finals begin', type: 'exam', term: 't3' },
    { date: '2025-10-02', title: 'Gandhi Jayanti — Holiday', type: 'holiday', term: 't2' },
    { date: '2025-10-20', title: 'Diwali Break begins', type: 'holiday', term: 't2' },
    { date: '2025-11-10', title: 'Mid Term Exams begin', type: 'exam', term: 't2' },
    { date: '2025-12-24', title: 'Winter Break begins', type: 'holiday', term: 't2' },
    { date: '2025-06-16', title: 'Term 1 begins', type: 'event', term: 't1' },
    { date: '2025-08-15', title: 'Independence Day', type: 'holiday', term: 't1' },
    { date: '2025-09-08', title: 'Unit Test week', type: 'exam', term: 't1' },
  ]

  const slips: Slip[] = [
    { id: 'p1', title: 'Field trip — Science City', detail: 'One-day trip for Class X on 18 Apr. Bus departs 7:30 AM. ₹350 covers entry + lunch.', due: '2026-04-14', status: 'Pending', requiresAuth: true },
    { id: 'p2', title: 'Inter-school football selections', detail: 'Evening practice till 6 PM on Tue/Thu for 4 weeks.', due: '2026-04-11', status: 'Pending', requiresAuth: true },
    { id: 'p3', title: 'Robotics Club — weekend bootcamp', detail: 'Two Saturdays, 9 AM – 1 PM, CS Lab.', due: '2026-03-30', status: 'Approved', requiresAuth: true },
  ]

  const leaves: LeaveReq[] = [
    { id: 'l1', student: 'Aarav Sharma', from: '2026-04-21', to: '2026-04-22', reason: 'Family function in Kochi', status: 'Pending', by: 'Nisha Sharma' },
    { id: 'l2', student: 'Aarav Sharma', from: '2026-01-09', to: '2026-01-09', reason: 'Dental appointment', status: 'Approved', by: 'Nisha Sharma' },
    { id: 'l3', student: 'Diya Patel', from: '2026-04-15', to: '2026-04-16', reason: 'State-level debate', status: 'Pending', by: 'Priya Patel' },
    { id: 'l4', student: 'Kabir Singh', from: '2026-03-11', to: '2026-03-12', reason: 'Fever', status: 'Approved', by: 'Harpreet Singh' },
  ]

  const achievements: Achievement[] = [
    { id: 'a1', title: 'Gold — State Math Olympiad', detail: 'Ranked 3rd across Kerala, senior category.', date: '2026-01-19', by: 'Aarav Sharma', kind: 'student' },
    { id: 'a2', title: 'Best Paper — NCERT Teaching Summit', detail: '“Gamified algebra for grade 10”.', date: '2025-12-02', by: 'Meera Krishnan', kind: 'teacher' },
    { id: 'a3', title: 'Inter-school Debate Winner', detail: 'Represented EduNova at the state-level debate championship.', date: '2025-11-15', by: 'Diya Patel', kind: 'student' },
  ]

  const ranks: DB['ranks'] = { t1: makeRanks(0), t2: makeRanks(1), t3: makeRanks(2) }

  const health: HealthRec[] = [
    { id: 'hc1', label: 'Vaccination record', detail: 'MMR + Td booster, verified by Dr. Kurian.', date: '2025-07-11', signed: true },
    { id: 'hc2', label: 'Allergy declaration', detail: 'Mild peanut allergy — canteen informed.', date: '2025-06-20', signed: true },
  ]

  const directory: DirectoryPerson[] = [
    { id: 'd1', name: 'Meera Krishnan', role: 'Class Teacher', subject: 'Mathematics', email: 'meera.k@edunova.in', phone: '+91 98470 11223', room: 'Staff Room 2' },
    { id: 'd2', name: 'Arjun Nair', role: 'Teacher', subject: 'Physics', email: 'arjun.n@edunova.in', phone: '+91 98470 44556', room: 'Physics Lab' },
    { id: 'd3', name: 'Sofia D’Souza', role: 'Teacher', subject: 'Chemistry', email: 'sofia.d@edunova.in', phone: '+91 98470 77889', room: 'Chem Lab' },
    { id: 'd4', name: 'Rahul Verma', role: 'Teacher', subject: 'English', email: 'rahul.v@edunova.in', phone: '+91 98470 99001', room: 'Staff Room 1' },
    { id: 'd5', name: 'Ananya Iyer', role: 'Teacher', subject: 'Computer Science', email: 'ananya.i@edunova.in', phone: '+91 98470 22334', room: 'CS Lab' },
    { id: 'd6', name: 'Vikram Rao', role: 'Teacher', subject: 'Physical Ed.', email: 'vikram.r@edunova.in', phone: '+91 98470 55667', room: 'Sports Office' },
  ]

  const applications: Application[] = [
    { id: 'ap1', kind: 'Admission', name: 'Nived Pillai — Grade V', detail: 'Sibling of IX-B student; documents verified.', date: '2026-03-28', status: 'Pending' },
    { id: 'ap2', kind: 'Admission', name: 'Zoya Sheikh — Grade VIII', detail: 'Transfer from Delhi; awaiting mark sheets.', date: '2026-03-25', status: 'Pending' },
    { id: 'ap3', kind: 'TC', name: 'Dev Nambiar — IX-C', detail: 'Family relocating to Dubai in June.', date: '2026-03-22', status: 'Pending' },
    { id: 'ap4', kind: 'Bonafide', name: 'Aarav Sharma — X-A', detail: 'Required for passport application.', date: '2026-03-18', status: 'Approved', studentId: 'u-s' },
    { id: 'ap5', kind: 'Disciplinary', name: 'Rohan Gupta — X-B', detail: 'Lab equipment misuse; parent meet requested.', date: '2026-03-15', status: 'Pending', studentId: 'u-s4' },
  ]

  const workAssign: AssignmentWork[] = [
    { id: 'w1', title: 'Stage coordination', event: 'Annual Sports Day', due: '2026-04-02', status: 'Done' },
    { id: 'w2', title: 'Quiz master — Senior finals', event: 'Tech Fest ‘26', due: '2026-04-24', status: 'Assigned' },
    { id: 'w3', title: 'Judges liaison', event: 'Science Exhibition', due: '2026-02-26', status: 'Done' },
  ]

  // new seed data
  const boardDetails: Record<string, BoardDetail> = {
    'u-s': { studentId: 'u-s', name: 'Aarav Kumar Sharma', board: 'CBSE', registrationNo: 'CBSE2024X12345', schoolName: 'EduNova Senior Secondary School', dob: '2010-03-15', rollNo: 'X-A-12', class: 'X', section: 'A', year: '2025-26', affiliationNo: '930001', status: 'Validated' },
    'u-s2': { studentId: 'u-s2', name: 'Diya Patel', board: 'CBSE', registrationNo: 'CBSE2024X12346', schoolName: 'EduNova Senior Secondary School', dob: '2010-06-22', rollNo: 'X-A-04', class: 'X', section: 'A', year: '2025-26', affiliationNo: '930001', status: 'Pending' },
    'u-s3': { studentId: 'u-s3', name: 'Kabir Singh', board: 'Matric', registrationNo: 'MAT2024X98765', schoolName: 'EduNova Senior Secondary School', dob: '2010-01-08', rollNo: 'X-B-07', class: 'X', section: 'B', year: '2025-26', status: 'SentToBoard', sentToBoard: true, sentAt: '2025-12-15' },
    'u-s4': { studentId: 'u-s4', name: 'Rohan Gupta', board: 'CBSE', registrationNo: 'CBSE2024X12347', schoolName: 'EduNova Senior Secondary School', dob: '2010-09-30', rollNo: 'X-B-15', class: 'X', section: 'B', year: '2025-26', affiliationNo: '930001', status: 'Draft' },
  }

  const validatedMarksCBSE: ValidatedMark[] = SUBJECTS.map(s => {
    const theory = 70 + Math.floor(Math.random() * 25)
    const practical = 20 + Math.floor(Math.random() * 10)
    const total = theory + practical
    return { subject: s.name, theory, practical, total, max: 100, grade: gradeOf(total), boardGrade: gradeOf(total) }
  })
  const cbseResult = cgpaFromMarks(validatedMarksCBSE)

  const validatedMarksMatric: ValidatedMark[] = SUBJECTS.map(s => {
    const theory = 75 + Math.floor(Math.random() * 20)
    const practical = 0
    const total = theory
    return { subject: s.name, theory, practical, total, max: 100, grade: matricGrade(total), boardGrade: matricGrade(total) }
  })
  const matricPct = Math.round(validatedMarksMatric.reduce((a, m) => a + m.total, 0) / validatedMarksMatric.length)

  const marksheets: Marksheet[] = [
    {
      id: 'ms1', studentId: 'u-s', board: 'CBSE', year: '2025-26', termId: 't3',
      details: boardDetails['u-s'], subjects: validatedMarksCBSE,
      status: 'Sealed', teacherSignedBy: 'Meera Krishnan', sealedBy: 'Dr. Arun Nambiar', sealedAt: '2026-04-10',
      totalScore: validatedMarksCBSE.reduce((a, m) => a + m.total, 0), cgpa: cbseResult.cgpa, percentage: cbseResult.pct, rank: 3,
    },
    {
      id: 'ms2', studentId: 'u-s3', board: 'Matric', year: '2025-26', termId: 't3',
      details: boardDetails['u-s3'], subjects: validatedMarksMatric,
      status: 'TeacherSigned', teacherSignedBy: 'Meera Krishnan',
      totalScore: validatedMarksMatric.reduce((a, m) => a + m.total, 0), percentage: matricPct, rank: 8,
    },
  ]

  const contracts: Contract[] = [
    makeContract('u-t', 'Senior Mathematics Teacher', 78400),
    makeContract('u-t2', 'Physics Teacher', 72000),
    makeContract('u-t3', 'Chemistry Teacher', 71000),
    makeContract('u-t4', 'English Teacher', 68000),
    makeContract('u-t5', 'Computer Science Teacher', 70000),
    makeContract('u-t6', 'Physical Education Teacher', 65000),
    makeContract('u-st', 'Office Superintendent', 58000, 'Administration'),
    makeContract('u-st2', 'Accounts Officer', 62000, 'Finance'),
    makeContract('u-st3', 'Admission Coordinator', 55000, 'Admissions'),
    makeContract('u-a', 'School Administrator', 95000, 'Administration'),
    makeContract('u-sa', 'Principal & Superadmin', 150000, 'Administration'),
  ]

  const resignations: Resignation[] = [
    { id: 'res1', userId: 'u-t4', reason: 'Relocating to another city for family commitments.', submittedAt: '2026-03-20', lastWorkingDate: '2026-05-31', status: 'Pending' },
  ]

  const meetings: MeetingRequest[] = [
    { id: 'm1', requesterId: 'u-p', requesterRole: 'parent', requesterName: 'Nisha Sharma', studentId: 'u-s', studentName: 'Aarav Sharma', purpose: 'Discuss Aarav’s Algebra progress', slot: 'Fri 4:00 PM', meetLink: 'https://meet.edunova.in/parent-meera-4pm', status: 'Scheduled', createdAt: '2026-04-01', approvedBy: 'Meera Krishnan', approvedAt: '2026-04-02' },
    { id: 'm2', requesterId: 'u-s', requesterRole: 'student', requesterName: 'Aarav Sharma', studentId: 'u-s', studentName: 'Aarav Sharma', purpose: 'Doubt clearing — Physics Optics', slot: 'Wed 3:30 PM', meetLink: 'https://meet.edunova.in/arjun-aarav-optics', status: 'Scheduled', createdAt: '2026-04-03', approvedBy: 'Arjun Nair', approvedAt: '2026-04-04' },
    { id: 'm3', requesterId: 'u-t', requesterRole: 'teacher', requesterName: 'Meera Krishnan', studentId: 'u-s', studentName: 'Aarav Sharma', purpose: 'PTA — mid-term feedback', slot: 'Sat 10:00 AM', meetLink: 'https://meet.edunova.in/meera-nisha-10am', status: 'Requested', createdAt: '2026-04-05' },
  ]

  const workUploads: WorkUpload[] = [
    { id: 'wu1', homeworkId: 'h2', fileName: 'Optics_Lab_Aarav.pdf', fileSize: '1.2 MB', uploadedBy: 'Aarav Sharma', uploadedAt: '2026-04-08', status: 'Verified', notes: 'Complete and well formatted.' },
  ]

  let attendanceRecords: AttendanceRecord[] = []
  users.filter(u => u.role !== 'parent').forEach(u => {
    terms.forEach((_, ti) => {
      attendanceRecords = attendanceRecords.concat(makeAttendanceRecords(u.id, u.role, ti))
    })
  })

  const aiParentCalls: AIParentCall[] = [
    { id: 'ac1', studentId: 'u-s3', studentName: 'Kabir Singh', parentName: 'Harpreet Singh', requesterId: 'u-st', requesterRole: 'staff', requesterName: 'Farhan Qureshi', reason: 'fee', reasonText: 'Term 3 tuition and transport fee pending.', language: 'English', scheduledAt: '2026-04-10T10:00:00', status: 'Completed', duration: 124, transcript: 'AI: Good morning, this is EduNova regarding Kabir Singh’s pending Term 3 fees. Parent: I will pay by Monday. AI: Thank you, a reminder has been noted.', outcome: 'confirmed', createdAt: '2026-04-09' },
    { id: 'ac2', studentId: 'u-s2', studentName: 'Diya Patel', parentName: 'Priya Patel', requesterId: 'u-t', requesterRole: 'teacher', requesterName: 'Meera Krishnan', reason: 'attendance', reasonText: 'Diya has been absent for 3 consecutive days.', language: 'English', scheduledAt: '2026-04-11T16:00:00', status: 'Scheduled', createdAt: '2026-04-10' },
  ]

  const disciplinaryCases: DisciplinaryCase[] = [
    { id: 'dc1', studentId: 'u-s4', studentName: 'Rohan Gupta', title: 'Lab equipment misuse', description: 'Student used lab equipment without supervision and damaged a microscope slide.', reportedBy: 'Sofia D’Souza', reportedAt: '2026-03-12', witnesses: 'Ananya Iyer', status: 'Decision', hearingDate: '2026-03-20', decision: 'Student admitted mistake. Parent meeting required.', actionTaken: 'Parent Meeting', notes: 'Parent has been informed via message.' },
    { id: 'dc2', studentId: 'u-s3', studentName: 'Kabir Singh', title: 'Unauthorized mobile phone use', description: 'Mobile phone used during class hours despite school policy.', reportedBy: 'Rahul Verma', reportedAt: '2026-02-15', status: 'Closed', hearingDate: '2026-02-18', decision: 'Phone confiscated for one week; warning issued.', actionTaken: 'Warning', notes: 'Phone returned after one week.' },
  ]

  const studentProfileReports: StudentProfileReport[] = [
    { id: 'spr1', studentId: 'u-s', generatedAt: '2026-04-07', generatedBy: 'Dr. Leela Menon', summary: 'Aarav is a consistent performer with strong mathematics and science scores. He is active in co-curricular activities and has no open disciplinary cases. One fee component is pending.' },
  ]

  return {
    users, terms, subjects: SUBJECTS, timetable, attendance, marks, feed, threads, homework, receipts, events, slips, leaves, achievements, ranks, health, directory, applications, workAssign,
    marksheets, contracts, resignations, meetings, workUploads, attendanceRecords, boardDetails, aiParentCalls, disciplinaryCases, studentProfileReports,
  }
}

export const HIGHLIGHTS = [
  { id: 'y1', title: 'Annual Sports Day 2026 — Official Aftermovie', yt: 'dQw4w9WgXcQ', date: 'Apr 2026' },
  { id: 'y2', title: 'Tech Fest ‘26 — Drone Show Finale', yt: 'dQw4w9WgXcQ', date: 'Apr 2026' },
  { id: 'y3', title: 'Founders’ Day — Choir & Orchestra', yt: 'dQw4w9WgXcQ', date: 'Dec 2025' },
  { id: 'y4', title: 'Science Exhibition Walkthrough', yt: 'dQw4w9WgXcQ', date: 'Feb 2026' },
]

export const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN')
