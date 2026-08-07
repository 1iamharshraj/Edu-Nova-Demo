// ─────────────────────────────────────────────────────────────
// EduNova · simulated backend (seed data + types)
// Everything persists to localStorage so the whole product works
// end-to-end without a server.
// ─────────────────────────────────────────────────────────────

export type Role = 'parent' | 'student' | 'teacher' | 'staff' | 'admin'

export interface User {
  id: string
  role: Role
  name: string
  email: string
  password: string
  title: string
  avatarHue: number
  verified: boolean
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
export interface Thread { id: string; person: string; subtitle: string; term: string; unread: number; messages: Message[] }

export interface Homework {
  id: string; subject: string; title: string; due: string; term: string
  status: 'Submitted' | 'Pending' | 'Graded' | 'Late'; grade?: string; description: string
}

export interface Receipt { id: string; label: string; date: string; amount: number; status: 'Paid' | 'Due'; term: string; kind: 'fee' | 'salary' }

export interface CalEvent { date: string; title: string; type: 'holiday' | 'exam' | 'event'; term: string }

export interface Slip { id: string; title: string; detail: string; due: string; status: 'Pending' | 'Approved' | 'Declined'; requiresAuth: boolean }

export interface LeaveReq { id: string; student: string; from: string; to: string; reason: string; status: 'Pending' | 'Approved' | 'Declined'; by: string }

export interface Achievement { id: string; title: string; detail: string; date: string; by: string; kind: 'student' | 'teacher' }

export interface RankRow { rank: number; name: string; score: number; grade: string }

export interface HealthRec { id: string; label: string; detail: string; date: string; signed: boolean }

export interface DirectoryPerson { id: string; name: string; role: string; subject?: string; email: string; phone: string; room: string }

export interface Application { id: string; kind: 'Admission' | 'TC' | 'Bonafide' | 'Disciplinary'; name: string; detail: string; date: string; status: 'Pending' | 'Approved' | 'Declined' }

export interface AssignmentWork { id: string; title: string; event: string; due: string; status: 'Assigned' | 'Done' }

export interface DB {
  users: User[]
  terms: Term[]
  subjects: Subject[]
  timetable: Record<string, TTCell[][]> // term -> 5 days x 6 periods
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
  let d = base[0]
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

export function seedDB(): DB {
  const terms: Term[] = [
    { id: 't1', name: 'Term 1', range: 'Jun – Sep 2025', months: ['June', 'July', 'August', 'September'] },
    { id: 't2', name: 'Term 2', range: 'Oct – Jan 2026', months: ['October', 'November', 'December', 'January'] },
    { id: 't3', name: 'Term 3', range: 'Feb – May 2026', months: ['February', 'March', 'April', 'May'], current: true },
  ]

  const users: User[] = [
    { id: 'u-p', role: 'parent', name: 'Nisha Sharma', email: 'parent@edunova.in', password: 'parent123', title: 'Parent of Aarav Sharma · X-A', avatarHue: 262, verified: false },
    { id: 'u-s', role: 'student', name: 'Aarav Sharma', email: 'student@edunova.in', password: 'student123', title: 'Class X-A · Roll 12', avatarHue: 200, verified: true },
    { id: 'u-t', role: 'teacher', name: 'Meera Krishnan', email: 'teacher@edunova.in', password: 'teacher123', title: 'Mathematics · Class Teacher X-A', avatarHue: 160, verified: true },
    { id: 'u-st', role: 'staff', name: 'Farhan Qureshi', email: 'staff@edunova.in', password: 'staff123', title: 'Office Superintendent', avatarHue: 20, verified: true },
    { id: 'u-a', role: 'admin', name: 'Dr. Leela Menon', email: 'admin@edunova.in', password: 'admin123', title: 'Principal', avatarHue: 330, verified: true },
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
      id: 'th1', person: 'Meera Krishnan', subtitle: 'Mathematics · Class Teacher', term: 't3', unread: 1,
      messages: [
        { from: 'them', text: 'Good evening! Aarav did really well in the mid-term. His algebra is much stronger now.', time: 'Mon 6:12 PM' },
        { from: 'me', text: 'That’s great to hear, thank you! We’ve been practising daily.', time: 'Mon 7:02 PM' },
        { from: 'them', text: 'It shows. Do remind him to revise trigonometry before Friday’s quiz.', time: 'Tue 8:40 AM' },
      ],
    },
    {
      id: 'th2', person: 'Arjun Nair', subtitle: 'Physics', term: 't3', unread: 0,
      messages: [
        { from: 'them', text: 'Lab records for optics are due this Thursday.', time: 'Sun 11:20 AM' },
        { from: 'me', text: 'Noted, he’ll submit it on time.', time: 'Sun 12:05 PM' },
      ],
    },
    {
      id: 'th3', person: 'Sofia D’Souza', subtitle: 'Chemistry', term: 't2', unread: 0,
      messages: [
        { from: 'them', text: 'Aarav’s titration practical was excellent — full marks.', time: 'Dec 4, 3:15 PM' },
        { from: 'me', text: 'Wonderful, thank you for the update!', time: 'Dec 4, 5:31 PM' },
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
    { id: 'r1', label: 'Tuition Fee — Term 3', date: '2026-02-05', amount: 42500, status: 'Paid', term: 't3', kind: 'fee' },
    { id: 'r2', label: 'Transport Fee — Term 3', date: '2026-02-05', amount: 9000, status: 'Paid', term: 't3', kind: 'fee' },
    { id: 'r3', label: 'Lab & Activity Fee — Term 3', date: '2026-04-20', amount: 6500, status: 'Due', term: 't3', kind: 'fee' },
    { id: 'r4', label: 'Tuition Fee — Term 2', date: '2025-10-03', amount: 42500, status: 'Paid', term: 't2', kind: 'fee' },
    { id: 'r5', label: 'Tuition Fee — Term 1', date: '2025-06-06', amount: 41000, status: 'Paid', term: 't1', kind: 'fee' },
    { id: 's1', label: 'Salary — March 2026', date: '2026-03-31', amount: 78400, status: 'Paid', term: 't3', kind: 'salary' },
    { id: 's2', label: 'Salary — February 2026', date: '2026-02-28', amount: 76100, status: 'Paid', term: 't3', kind: 'salary' },
    { id: 's3', label: 'Salary — January 2026', date: '2026-01-31', amount: 78400, status: 'Paid', term: 't2', kind: 'salary' },
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
    { id: 'l3', student: 'Diya Patel', from: '2026-04-15', to: '2026-04-16', reason: 'State-level debate', status: 'Pending', by: 'Raj Patel' },
    { id: 'l4', student: 'Kabir Singh', from: '2026-03-11', to: '2026-03-12', reason: 'Fever', status: 'Approved', by: 'Simran Singh' },
  ]

  const achievements: Achievement[] = [
    { id: 'a1', title: 'Gold — State Math Olympiad', detail: 'Ranked 3rd across Kerala, senior category.', date: '2026-01-19', by: 'Aarav Sharma', kind: 'student' },
    { id: 'a2', title: 'Best Paper — NCERT Teaching Summit', detail: '“Gamified algebra for grade 10”.', date: '2025-12-02', by: 'Meera Krishnan', kind: 'teacher' },
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
    { id: 'ap4', kind: 'Bonafide', name: 'Aarav Sharma — X-A', detail: 'Required for passport application.', date: '2026-03-18', status: 'Approved' },
    { id: 'ap5', kind: 'Disciplinary', name: 'Rohan Gupta — X-B', detail: 'Lab equipment misuse; parent meet requested.', date: '2026-03-15', status: 'Pending' },
  ]

  const workAssign: AssignmentWork[] = [
    { id: 'w1', title: 'Stage coordination', event: 'Annual Sports Day', due: '2026-04-02', status: 'Done' },
    { id: 'w2', title: 'Quiz master — Senior finals', event: 'Tech Fest ‘26', due: '2026-04-24', status: 'Assigned' },
    { id: 'w3', title: 'Judges liaison', event: 'Science Exhibition', due: '2026-02-26', status: 'Done' },
  ]

  return { users, terms, subjects: SUBJECTS, timetable, attendance, marks, feed, threads, homework, receipts, events, slips, leaves, achievements, ranks, health, directory, applications, workAssign }
}

export const HIGHLIGHTS = [
  { id: 'y1', title: 'Annual Sports Day 2026 — Official Aftermovie', yt: 'dQw4w9WgXcQ', date: 'Apr 2026' },
  { id: 'y2', title: 'Tech Fest ‘26 — Drone Show Finale', yt: 'dQw4w9WgXcQ', date: 'Apr 2026' },
  { id: 'y3', title: 'Founders’ Day — Choir & Orchestra', yt: 'dQw4w9WgXcQ', date: 'Dec 2025' },
  { id: 'y4', title: 'Science Exhibition Walkthrough', yt: 'dQw4w9WgXcQ', date: 'Feb 2026' },
]

export const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN')
