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
  // Phase 4 — account hygiene & profile (see phase-4-admissions-identity.md)
  mustChangePassword?: boolean
  photoFileId?: string | null
  emergencyContact?: string | null
  address?: string | null
  lastLoginAt?: string | null
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

// ─────────────────────────────────────────────────────────────
// Phase 1 — real academic entities (server-backed). See .agents/edunova/phase-0-1-contract.md
// ─────────────────────────────────────────────────────────────
export interface AcademicYear { id: string; label: string; startDate: string; endDate: string; isCurrent: boolean }
export interface TermRec { id: string; academicYearId: string; name: string; startDate: string; endDate: string; isCurrent: boolean }
export interface BoardRec { id: string; name: string; code: string }
export interface Grade { id: string; label: string; order: number }
export interface Stream { id: string; name: string }
export type CurriculumKind = 'core' | 'elective' | 'language'
export interface CurriculumSubject { id: string; boardId: string; gradeId: string; streamId?: string; subjectId: string; kind: CurriculumKind; textbook?: string; syllabusRef?: string }
export interface ClassRec {
  id: string
  academicYearId: string
  boardId: string
  boardCode: string
  gradeId: string
  grade: string
  streamId?: string
  stream?: string
  section: string
  label: string
  classTeacherId?: string
  capacity?: number
  /** Overrides the school's default period template. See phase-2-timetable.md */
  periodTemplateId?: string
}
export interface SubjectRec { id: string; name: string; code: string; color: string }
export interface ClassSubject { id: string; classId: string; subjectId: string; teacherId?: string; periodsPerWeek: number }
export type RoomKind = 'classroom' | 'lab' | 'ground' | 'hall' | 'other'
export interface Room { id: string; name: string; kind: RoomKind; capacity?: number }
export interface Enrollment { id: string; studentId: string; classId: string; academicYearId: string; rollNo?: string; status: 'active' | 'transferred' | 'graduated' }
export interface Guardian { id: string; parentId: string; studentId: string; relation: string }

// Phase 2 — timetable (server-backed, entries fetched per screen). See .agents/edunova/phase-2-timetable.md
export type PeriodKind = 'class' | 'break'
export interface PeriodDef { idx: number; label: string; start: string; end: string; kind: PeriodKind }
export interface PeriodTemplate { id: string; name: string; isDefault: boolean; periods: PeriodDef[] }
/** dayOfWeek is ISO-style: 1 = Monday … 6 = Saturday. */
export interface TimetableEntry { id: string; classId: string; termId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId?: string; teacherId?: string }
export interface Substitution { id: string; timetableEntryId: string; date: string; substituteTeacherId: string; reason?: string }

// Phase 3 — attendance, assessment, homework, files (server-backed, fetched per screen).
// See .agents/edunova/phase-3-attendance-assessment.md. Legacy names (`Homework`, `AttendanceRecord`, `RankRow`)
// still describe the old JSON blob, so the real entities take the `Rec` suffix where they would clash.
export interface FileRec { id: string; uploaderId: string; name: string; mime: string; size: number; createdAt: string }
/** Student session status. H (holiday) is only ever written by the server. */
export type SessionStatus = 'P' | 'A' | 'L' | 'E' | 'H'
export type StaffStatus = 'P' | 'A' | 'L' | 'H'
export interface AttendanceRecordRec { id: string; sessionId: string; studentId: string; status: SessionStatus; note?: string }
/** `periodIdx` null/undefined = whole-day attendance. `records` is present on `/attendance/sessions` responses. */
export interface AttendanceSession { id: string; classId: string; date: string; periodIdx?: number | null; markedById: string; lockedAt?: string | null; records: AttendanceRecordRec[] }
export interface StaffAttendance { id: string; userId: string; date: string; status: StaffStatus; markedById: string }
export interface AttendanceSummary {
  bySubject?: { subjectId?: string; subject: string; present: number; total: number; pct?: number }[]
  overall: { present: number; total: number; pct: number }
  days: { date: string; status: SessionStatus }[]
}
export interface GradeBand { min: number; grade: string; points?: number }
export interface GradeScale { id: string; name: string; boardId?: string | null; bands: GradeBand[] }
export interface Mark { id: string; assessmentId: string; studentId: string; score: number; remark?: string }
/** `marks` is attached when the caller may see them (teacher/admin: all; student/parent: own, published only). */
export interface Assessment { id: string; classSubjectId: string; classId?: string; subjectId?: string; subjectName?: string; termId: string; name: string; maxMarks: number; weight: number; date?: string | null; publishedAt?: string | null; marks?: Mark[] }
export interface ReportCardSubject {
  classSubjectId?: string
  subjectId?: string
  subject: string
  color?: string
  assessments: { id: string; name: string; maxMarks: number; weight?: number; date?: string | null; score?: number | null }[]
  total: number
  max: number
  pct: number
  grade: string
}
export interface ReportCard { subjects: ReportCardSubject[]; overall: { total?: number; max?: number; pct: number; grade: string; rank?: number | null; classSize?: number } }
export interface RankEntry { studentId: string; name: string; rollNo?: string; total: number; max?: number; pct: number; rank: number; grade?: string }
export type SubmissionStatus = 'Submitted' | 'Late' | 'Graded' | 'Returned'
export interface HomeworkSubmission { id: string; homeworkId: string; studentId: string; submittedAt: string; files: string[]; status: SubmissionStatus; grade?: string | null; feedback?: string | null; note?: string | null }
/** `submissions`: teacher/admin see every student's, a student sees only their own. */
export interface HomeworkRec { id: string; classSubjectId: string; classId?: string; subjectId?: string; subjectName?: string; title: string; description: string; dueDate: string; createdById: string; attachments: string[]; submissions?: HomeworkSubmission[]; createdAt?: string }

// Phase 5 — fees, payments, payroll (server-backed, fetched per screen). See .agents/edunova/phase-5-finance.md
export type PaymentMethod = 'UPI' | 'Card' | 'NetBanking' | 'Cash' | 'Cheque'
export type InvoiceStatus = 'Due' | 'PartiallyPaid' | 'Paid' | 'Waived'
export type ReminderChannel = 'InApp' | 'Email' | 'SMS'
export interface FeeHead { id: string; name: string; isRecurring: boolean; createdAt?: string }
export interface FeeStructureLine { feeHeadId: string; amount: number }
export interface FeeStructure { id: string; classId: string; termId: string; dueDate: string; lines: FeeStructureLine[] }
export interface InvoiceLine { feeHeadId: string; name: string; amount: number }
export interface Payment { id: string; invoiceId: string; amount: number; method: PaymentMethod; reference?: string | null; paidAt: string; recordedById: string; receiptNo: string; note?: string | null }
/** `paid` / `payments` / `studentName` are decorations the server may attach; the UI falls back when they are absent. */
export interface FeeInvoice {
  id: string; studentId: string; studentName?: string; classLabel?: string; feeStructureId?: string | null; termId: string
  lines: InvoiceLine[]; total: number; concession: number; dueDate: string; status: InvoiceStatus; invoiceNo: string; createdAt?: string
  paid?: number; payments?: Payment[]
}
export interface FeeReminder { id: string; invoiceId: string; sentById: string; channel: ReminderChannel; sentAt: string; note?: string | null }
export interface FeeDefaulter {
  studentId: string; name: string; classLabel: string; parent?: { name?: string; phone?: string; email?: string } | null
  outstanding: number; oldestDue: string; reminders: number
  /** Optional detail some servers attach — the UI fetches the student's invoices when it is missing. */
  invoices?: { id: string; invoiceNo: string; outstanding: number; dueDate: string }[]
}
export interface FeeSummary { collected: number; outstanding: number; invoiced: number; byHead: { feeHeadId?: string; name: string; invoiced: number; collected: number }[] }
export interface SalaryComponent { name: string; amount: number }
export interface SalaryStructure { id: string; userId: string; basic: number; allowances: SalaryComponent[]; deductions: SalaryComponent[]; effectiveFrom: string }
export type PayslipStatus = 'Generated' | 'Paid'
/** `allowances` / `deductions` are the component lists copied at run time (a total is accepted too). */
export interface Payslip {
  id: string; userId: string; userName?: string; month: string; basic: number; allowances: SalaryComponent[] | number; deductions: SalaryComponent[] | number
  gross: number; net: number; status: PayslipStatus; paidAt?: string | null; paidById?: string | null; slipNo: string
}

export interface AcademicState {
  years: AcademicYear[]
  terms: TermRec[]
  boards: BoardRec[]
  grades: Grade[]
  streams: Stream[]
  curriculum: CurriculumSubject[]
  classes: ClassRec[]
  subjects: SubjectRec[]
  classSubjects: ClassSubject[]
  rooms: Room[]
  enrollments: Enrollment[]
  guardians: Guardian[]
  periodTemplates: PeriodTemplate[]
}
export const emptyAcademic = (): AcademicState => ({
  years: [], terms: [], boards: [], grades: [], streams: [], curriculum: [],
  classes: [], subjects: [], classSubjects: [], rooms: [], enrollments: [], guardians: [],
  periodTemplates: [],
})

// The demo seed generator (`seedDB()`) and its exclusive helpers/constants (SUBJECTS, TIMESLOTS, DAYS,
// makeTT, makeDays, makeMarks, makeRanks, makeContract, gradeFor, pctFor, cgpaFromMarks, matricGrade, …)
// were removed in Phase 10 — the demo school is now seeded server-side from real Prisma tables
// (`server/src/sampleData.ts` + `server/src/sampleConstants.ts`), never from this frontend module.

export const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN')

// ─────────────────────────────────────────────────────────────
// Phase 4 — admissions, certificates, board registration, identity (server-backed, fetched per screen).
// See .agents/edunova/phase-4-admissions-identity.md. The legacy `Application` / `BoardDetail` / `Marksheet`
// interfaces above describe the old (now unseeded, unread) JSON blob shape, so these take the `Rec` suffix.
// ─────────────────────────────────────────────────────────────
export type ApplicationKind = 'Admission' | 'TC' | 'Bonafide' | 'Character'
export type ApplicationStatus = 'Pending' | 'Verified' | 'Approved' | 'Declined'
export interface ApplicationGuardian { name: string; phone?: string; email?: string; relation?: string }
export interface ApplicationRec {
  id: string
  kind: ApplicationKind
  applicantName: string
  dob?: string | null
  gender?: string | null
  guardian?: ApplicationGuardian | null
  targetClassId?: string | null
  targetBoardId?: string | null
  /** TC/Bonafide/Character: the existing student; Admission: set when approved. */
  studentId?: string | null
  /** File ids. */
  documents: string[]
  status: ApplicationStatus
  notes?: string | null
  submittedById?: string | null
  decidedById?: string | null
  decidedAt?: string | null
  createdAt: string
}
/** `POST /applications/:id/approve` on an Admission returns the accounts it created, with plain passwords shown once. */
export interface AdmissionCreated { student: { email: string; password: string }; parent?: { email: string; password: string } | null }
export type CertificateKind = 'TC' | 'Bonafide' | 'Character'
export interface Certificate { id: string; kind: CertificateKind; studentId: string; serialNo: string; issuedById: string; issuedAt: string; pdfFileId: string; applicationId?: string | null }
export type BoardRegistrationStatus = 'Draft' | 'Pending' | 'Validated' | 'SentToBoard'
export interface BoardRegistration {
  id: string
  studentId: string
  boardId: string
  academicYearId: string
  registrationNo?: string | null
  rollNo?: string | null
  nameOnCertificate: string
  dob: string
  affiliationNo?: string | null
  status: BoardRegistrationStatus
  validatedById?: string | null
  validatedAt?: string | null
  sentAt?: string | null
  mismatchNote?: string | null
}
export type VerificationMethod = 'Document' | 'InPerson' | 'Aadhaar'
export type VerificationStatus = 'Pending' | 'Verified' | 'Rejected'
export interface ParentVerification { id: string; parentId: string; method: VerificationMethod; status: VerificationStatus; documentFileId?: string | null; verifiedById?: string | null; verifiedAt?: string | null; note?: string | null; createdAt?: string }

// ─────────────────────────────────────────────────────────────
// Phase 6 — HR: leave, contracts, resignations, duties (server-backed, fetched per screen).
// See .agents/edunova/phase-6-hr.md. The legacy `LeaveReq` / `Contract` / `Resignation` / `AssignmentWork`
// shapes above still describe the old JSON blob, so these take the `Rec` suffix where they would clash.
// ─────────────────────────────────────────────────────────────
export type LeaveAppliesTo = 'student' | 'staff'
export interface LeaveType { id: string; name: string; daysPerYear: number; appliesTo: LeaveAppliesTo }
export type LeaveRequestStatus = 'Pending' | 'Approved' | 'Declined' | 'Cancelled'
export interface LeaveRequest {
  id: string
  requesterId: string
  forUserId: string
  leaveTypeId?: string | null
  fromDate: string
  toDate: string
  /** Computed server-side, excluding Sundays. */
  days: number
  reason: string
  status: LeaveRequestStatus
  decidedById?: string | null
  decidedAt?: string | null
  decisionNote?: string | null
  createdAt: string
  /** Decorations some servers attach so the UI doesn't need an extra lookup. */
  forUserName?: string
  requesterName?: string
  leaveTypeName?: string
}
/** `GET /leave/balance` returns each line's type name as `name` (not `leaveTypeName`). */
export interface LeaveBalanceLine { leaveTypeId: string; name?: string; allowed: number; used: number; remaining: number }

export type ContractRecStatus = 'Draft' | 'Active' | 'Ended'
export interface ContractRec {
  id: string
  userId: string
  designation: string
  department?: string | null
  startDate: string
  endDate?: string | null
  terms: string
  status: ContractRecStatus
  employeeSignedAt?: string | null
  adminSignedAt?: string | null
  adminSignedById?: string | null
  endedAt?: string | null
  endReason?: string | null
  pdfFileId?: string | null
  userName?: string
}

export type ResignationRecStatus = 'Pending' | 'Approved' | 'Declined' | 'Withdrawn'
export interface ResignationRec {
  id: string
  userId: string
  reason: string
  submittedAt: string
  lastWorkingDate: string
  status: ResignationRecStatus
  decidedById?: string | null
  decidedAt?: string | null
  notes?: string | null
  userName?: string
}

export type DutyStatus = 'Assigned' | 'Done'
export interface Duty {
  id: string
  title: string
  eventTitle: string
  eventDate: string
  assigneeId?: string | null
  createdById: string
  status: DutyStatus
  notes?: string | null
  assigneeName?: string
}

// ─────────────────────────────────────────────────────────────
// Phase 7 — communication: feed, messaging, notifications, meetings, calendar audience
// (server-backed, fetched per screen). See .agents/edunova/phase-7-communication.md.
// The legacy `FeedPost` / `Thread` / `Message` / `MeetingRequest` / `CalEvent` shapes above still describe
// the old JSON blob (some screens outside this phase's scope still read them), so these take the `Rec` suffix.
// ─────────────────────────────────────────────────────────────
export type PostAudience = 'School' | 'Class' | 'Role'
/** The server embeds a small `{id,name,role}` snapshot instead of a flat authorId — on posts, comments and messages alike. */
export interface PersonRef { id: string; name: string; role: Role }
export interface PostComment { id: string; body: string; createdAt: string; author: PersonRef }
export interface PostRec {
  id: string
  author: PersonRef
  audience: PostAudience
  classId?: string | null
  role?: Role | null
  title?: string | null
  body: string
  mediaFileIds: string[]
  pinned: boolean
  publishedAt: string
  createdAt: string
  likes: number
  /** Whether the caller has reacted (liked) this post. */
  liked: boolean
  commentCount: number
  /** Embedded on `GET /feed`; `GET /feed/:id/comments` returns the same shape for a single post. */
  comments: PostComment[]
}

export type ConversationKind = 'DM' | 'Group'
export interface ConversationParticipant { userId: string; name: string; role: Role; lastReadAt?: string | null }
export interface MessageRec { id: string; conversationId: string; body: string; fileIds: string[]; sentAt: string; sender: PersonRef }
/** The lighter shape embedded as `ConversationRec.lastMessage` — no sender name, just the id. */
export interface ConversationLastMessage { id: string; body: string; senderId: string; sentAt: string }
export interface ConversationRec {
  id: string
  kind: ConversationKind
  title?: string | null
  classId?: string | null
  createdById?: string
  createdAt: string
  participants: ConversationParticipant[]
  lastMessage?: ConversationLastMessage | null
  unread: number
}
/** `GET /messages/contacts` — people the caller may start a conversation with, grouped by the server as `{ [role]: person[] }`. */
export interface ContactPerson { id: string; name: string; role: Role; title?: string }
export type ContactsByRole = Partial<Record<Role, ContactPerson[]>>

export interface NotificationRec {
  id: string
  userId: string
  kind: string
  title: string
  body?: string | null
  /** A module id string (see Portal's registry) the bell should deep-link to. */
  link?: string | null
  readAt?: string | null
  createdAt: string
}

export type MeetingRecStatus = 'Requested' | 'Scheduled' | 'Completed' | 'Cancelled' | 'Declined'
export interface MeetingRec {
  id: string
  requesterId: string
  withUserId: string
  studentId?: string | null
  purpose: string
  scheduledAt: string
  durationMin: number
  link?: string | null
  status: MeetingRecStatus
  decidedById?: string | null
  decidedAt?: string | null
  note?: string | null
  createdAt: string
}

export type CalendarEventAudience = 'School' | 'Class'
export type CalendarEventType = 'holiday' | 'exam' | 'event'
export interface CalendarEventRec {
  id: string
  title: string
  date: string
  endDate?: string | null
  type: CalendarEventType
  audience: CalendarEventAudience
  classId?: string | null
  termId?: string | null
  createdById?: string
}

// ─────────────────────────────────────────────────────────────
// Phase 8 — student welfare & compliance: health, slips, achievements, discipline, calls, activities
// (server-backed, fetched per screen). See .agents/edunova/phase-8-welfare.md. The legacy `HealthRec` /
// `Slip` / `Achievement` / `DisciplinaryCase` / `AIParentCall` shapes above still describe the old JSON
// blob (which this phase's `GET /data` empties out), so these take the `Rec` suffix where they would clash.
// ─────────────────────────────────────────────────────────────
export type HealthKind = 'Vaccination' | 'Allergy' | 'Condition' | 'Checkup' | 'Other'
export interface HealthRecordRec {
  id: string
  studentId: string
  kind: HealthKind
  title: string
  detail: string
  date: string
  addedById: string
  verifiedById?: string | null
  verifiedAt?: string | null
  fileIds: string[]
}

export interface PermissionSlipRec {
  id: string
  title: string
  detail: string
  dueDate: string
  /** null/undefined = all classes. */
  classId?: string | null
  createdById: string
  requiresVerifiedParent: boolean
  createdAt: string
  /** Decoration for parent/student callers: their own ward(s)' responses to this slip, so the UI can show
   *  already-decided status without a second fetch. Absent for teacher/staff/admin (they use `/slips/:id/responses`). */
  myResponses?: { studentId: string; decision: SlipDecision; respondedAt: string; note?: string | null }[]
}
export type SlipDecision = 'Approved' | 'Declined'
export interface SlipResponseRec {
  id: string
  slipId: string
  studentId: string
  parentId: string
  decision: SlipDecision
  respondedAt: string
  note?: string | null
}

export type AchievementCategory = 'Academic' | 'Sports' | 'Arts' | 'Service' | 'Other'
export interface AchievementRec {
  id: string
  userId: string
  title: string
  detail: string
  date: string
  category: AchievementCategory
  verifiedById?: string | null
  verifiedAt?: string | null
  fileIds: string[]
  /** Decoration some servers attach so the UI doesn't need an extra lookup. */
  userName?: string
}

export type DisciplinaryCaseStatus = 'Reported' | 'Scheduled' | 'Heard' | 'Decision' | 'Action Taken' | 'Appealed' | 'Closed'
export type DisciplinaryActionRec = 'Warning' | 'Suspension' | 'Expulsion' | 'Community Service' | 'Parent Meeting' | 'Fine' | 'No Action'
export interface DisciplinaryCaseRec {
  id: string
  studentId: string
  classId?: string | null
  title: string
  description: string
  reportedById: string
  /** When the case was filed. The running server names this `createdAt` (it also has `updatedAt`). */
  createdAt: string
  updatedAt?: string
  witnesses?: string | null
  status: DisciplinaryCaseStatus
  hearingDate?: string | null
  decision?: string | null
  actionTaken?: DisciplinaryActionRec | null
  appeal?: string | null
  fileIds: string[]
  deletedAt?: string | null
  /** Decorations some servers attach so the UI doesn't need an extra lookup; fall back to a client-side `db.users` lookup when absent. */
  studentName?: string
  reportedByName?: string
}
export interface DisciplinaryNote {
  id: string
  caseId: string
  authorId: string
  body: string
  createdAt: string
  authorName?: string
}

export type CallReason = 'fee' | 'attendance' | 'disciplinary' | 'general'
export type CallOutcome = 'confirmed' | 'callback' | 'unreachable' | 'refused' | 'other'
export interface CallLogRec {
  id: string
  studentId: string
  parentId?: string | null
  byId: string
  reason: CallReason
  summary: string
  outcome: CallOutcome
  calledAt: string
  durationMin?: number | null
  /** Decorations some servers attach so the UI doesn't need an extra lookup. */
  studentName?: string
  parentName?: string
  byName?: string
}

export type ActivityKind = 'club' | 'house' | 'exc' | 'event' | 'faculty'
export interface ActivityRec {
  id: string
  kind: ActivityKind
  title: string
  description: string
  capacity?: number | null
  opensAt?: string | null
  closesAt?: string | null
  forRoles: Role[]
  createdById: string
  createdAt?: string
  /** Decorations the running server attaches on `GET /activities`: the caller's own status, and a registered count (waitlist count is not attached — derive from `/activities/:id/registrations` when needed). */
  registered?: number
  myStatus?: ActivityRegStatus | null
}
export type ActivityRegStatus = 'Registered' | 'Waitlisted' | 'Cancelled'
export interface ActivityRegistrationRec {
  id: string
  activityId: string
  userId: string
  registeredAt: string
  status: ActivityRegStatus
  userName?: string
  userRole?: Role
}

// ─────────────────────────────────────────────────────────────
// Phase 9 — integrations & AI: AI doubt clearing, event highlights CMS, PWA push.
// See .agents/edunova/phase-9-10-integrations-hardening.md.
// ─────────────────────────────────────────────────────────────
export type AiMessageRole = 'user' | 'assistant'
export interface AiMessageRec { id: string; role: AiMessageRole; content: string; createdAt: string }
/** `GET /ai/conversations` — one thread per (student, subjectId): a fresh question for the same subject
 * continues its thread; a different subject starts a new one. */
export interface AiConversationRec {
  id: string
  subjectId?: string
  title?: string
  createdAt: string
  messages?: AiMessageRec[]
}

export type HighlightAudience = 'School' | 'Class'
export interface HighlightRec {
  id: string
  title: string
  url: string
  thumbnailFileId?: string | null
  audience: HighlightAudience
  classId?: string | null
  publishedAt: string
  createdById?: string
}
