// ─────────────────────────────────────────────────────────────
// Edkonic · simulated backend (seed data + types)
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
  reportsTo?: string | null
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
  // Phase 22 — narrow, admin-set flag gating the counseling module. Deliberately not a role string
  // (a staff/teacher/admin account can also be a counselor) and deliberately not derived from
  // `designation` (free text is fragile to match on). See phase-22-campus-safety.md.
  isCounselor?: boolean
  address?: string | null
  lastLoginAt?: string | null
  // Phase 11 — employee management (see phase-11-employee-management.md). `employeeId` is only ever
  // set for teacher/staff/admin/superadmin; `reportsTo` (above) becomes a real FK once the server relation lands.
  employeeId?: string | null
  // Soft-deactivation flag (Bug A fix). Login is refused for inactive accounts; the office People
  // screen's "Revoke access" action now sets this instead of hard-deleting the row.
  active?: boolean
  // Phase T1 §4 — teacher band affinity (self-service declared value + a future-verified value from T11).
  // Present on every role's serialized user; only ever meaningfully set for teachers.
  declaredBandAffinity?: BandAffinity
  verifiedBandAffinity?: BandAffinity
  affinitySource?: 'DECLARED' | 'VERIFIED'
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
export interface Room { id: string; name: string; kind: RoomKind; capacity?: number; capabilityIds?: string[] }
export interface Enrollment { id: string; studentId: string; classId: string; academicYearId: string; rollNo?: string; status: 'active' | 'transferred' | 'graduated' }
export interface Guardian { id: string; parentId: string; studentId: string; relation: string }

// Phase 2 — timetable (server-backed, entries fetched per screen). See .agents/edunova/phase-2-timetable.md
export type PeriodKind = 'class' | 'break'
export interface PeriodDef { idx: number; label: string; start: string; end: string; kind: PeriodKind }
export interface PeriodTemplate { id: string; name: string; isDefault: boolean; periods: PeriodDef[] }

// ─────────────────────────────────────────────────────────────
// Phase T1 — advanced timetable generation, scheduling data-model foundations.
// See .agents/edunova/phase-t1-timetable-foundations.md
// ─────────────────────────────────────────────────────────────

/** SECTION is auto-generated 1:1 per Class; the other 4 are what the manual-cohort UI can create. */
export type CohortType = 'SECTION' | 'GRADE' | 'CROSS_SECTION' | 'TRACK' | 'ELECTIVE'
export interface Cohort {
  id: string
  academicYearId: string
  name: string
  gradeId?: string
  type: CohortType
  autoGenerated: boolean
  classIds: string[]
  /** Server-attached display labels for the member classes, e.g. ["XII-A", "XII-B"]. */
  classLabels: string[]
}

/** A small admin-managed catalog (Physics Lab, Projector, ...) — additive detail on top of `Room.kind`. */
export interface Capability { id: string; name: string; code: string }

export type QualificationProficiency = 'PRIMARY' | 'SECONDARY'
export interface TeacherQualification {
  id: string
  teacherId: string
  subjectId: string
  /** Grade-level numbers — matches `Grade.order`. */
  gradeRangeMin: number
  gradeRangeMax: number
  proficiency: QualificationProficiency
  isPrimarySubject: boolean
}

export type BandLevel = 'STRONG' | 'MEDIUM' | 'NONE'
export interface BandAffinity { support: BandLevel; mid: BandLevel; advanced: BandLevel }

export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'
export type SaturdayPattern = 'NONE' | 'ALL' | 'ALTERNATE_1_3' | 'ALTERNATE_2_4' | 'HALF_DAY_ALL'
export interface WorkingDayPattern {
  id: string
  academicYearId: string
  workingDays: Weekday[]
  saturdayPattern: SaturdayPattern
}

/** A day-of-week override row for a base `PeriodTemplate` (roadmap D7) — e.g. a shorter Saturday. */
export interface PeriodTemplateOverride {
  id: string
  baseTemplateId: string
  dayOfWeek: number // 1=Mon..6=Sat
  name: string
  periods: PeriodDef[]
}
/** dayOfWeek is ISO-style: 1 = Monday … 6 = Saturday. */
export interface TimetableEntry { id: string; classId: string; termId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string; roomId?: string; teacherId?: string }
export interface Substitution { id: string; timetableEntryId: string; date: string; substituteTeacherId: string; reason?: string }

// ─────────────────────────────────────────────────────────────
// Phase T3 — Sectioning Engine (bands, templates, draft/approve, track eligibility).
// See .agents/edunova/phase-t3-sectioning-engine.md and server/src/modules/sectioning/{router,service,schema}.ts.
// ─────────────────────────────────────────────────────────────

export interface PerformanceBand { id: string; academicYearId: string; label: string; minScore: number; maxScore: number }

export type SectioningStrategy = 'BALANCED' | 'RANKED' | 'BANDED' | 'STRATIFIED_CAPPED' | 'RANDOM_PARITY' | 'SKIM_THEN_BALANCE'
export type SectioningScoreSource = 'LATEST_EXAM' | 'EXAM_AVERAGE' | 'CUSTOM_WEIGHTING'

/** `distributionConfig` is strategy-specific — see phase-t3-sectioning-engine.md §2. Every key is optional;
 * a template only sets the ones its strategy reads. `skim`/`remainderStrategy` back SKIM_THEN_BALANCE. */
export interface SectioningDistributionConfig {
  bandMixTolerancePct?: number
  broadGroups?: number // BANDED
  caps?: Record<string, Record<string, number>> // STRATIFIED_CAPPED: { [cohortId]: { [bandLabel]: maxCount } }
  skim?: { sectionId: string; count?: number; percentage?: number }[] // SKIM_THEN_BALANCE
  remainderStrategy?: SectioningStrategy // SKIM_THEN_BALANCE — any of the other 5
  siblingsTogether?: boolean
}
export interface SectioningTemplate {
  id: string
  academicYearId: string
  gradeId: string
  name: string
  strategy: SectioningStrategy
  scoreSource: SectioningScoreSource
  subjectWeights?: Record<string, number> // CUSTOM_WEIGHTING only: { [subjectId]: weight }
  bandIds: string[]
  distributionConfig?: SectioningDistributionConfig
  sectionOrder: string[] // target Cohort ids, fill order
  respectExisting: boolean
  createdAt: string
}

export type SectioningVersionStatus = 'DRAFT' | 'APPROVED' | 'SUPERSEDED'
export interface SectioningAssignment { studentId: string; cohortId: string; previousCohortId?: string; band?: string; score?: number }
export interface SectioningVersionSummary {
  scoredCount: number
  unscoredStudentIds: string[]
  overflowStudentIds: string[]
  warnings: string[]
  /** `[cohortId][bandLabel] = pct` — the actual band mix landed in each target section. */
  sectionBandMix: Record<string, Record<string, number>>
  validation: { errors: string[]; warnings: string[] }
}
export interface SectioningVersion {
  id: string
  templateId: string
  academicYearId: string
  scopeCohortId?: string // set for a Stage-2 run scoped to one track cohort's population
  status: SectioningVersionStatus
  parentVersionId?: string
  summary: SectioningVersionSummary
  approvedAt?: string
  approvedById?: string
  createdAt: string
  assignments: SectioningAssignment[]
}

export type EnforcementMode = 'STRICT' | 'ADVISORY'
export interface SubjectScoreRule { subjectId?: string; subjectName?: string; minScore: number }
export interface TrackEligibilityRule {
  id: string
  trackActivityId: string
  label: string
  subjectScoreRules: SubjectScoreRule[]
  enforcementMode: EnforcementMode
  createdAt: string
}
export interface SubjectRuleResult { rule: SubjectScoreRule; passed: boolean; actual: number | null; source: 'MARKS' | 'PRIOR' | 'NONE' }
export type TrackExceptionType = 'ADVISORY_FLAG' | 'STRICT_OVERRIDE'
export interface TrackEligibilityException {
  id: string
  trackActivityId: string
  ruleId?: string
  studentId: string
  studentName: string
  type: TrackExceptionType
  unmetDetails: SubjectRuleResult[]
  reason?: string
  approvedById?: string
  approvedByName?: string
  createdAt: string
}
export interface TrackRegisterResult {
  registration: ActivityRegistrationRec
  eligibility: {
    passed: boolean
    overridden: boolean
    failedStrict: { ruleId: string; label: string }[]
    failedAdvisory: { ruleId: string; label: string }[]
  }
}

// Timetable auto-generation draft/commit shapes — introduced Phase 26 (see
// .agents/edunova/phase-26-timetable-autogen.md), now produced by the Cohort-scoped solver (T4+;
// server/src/modules/timetable/{autogen,solver}.ts are the source of truth for these shapes). Phase T10 §2
// retired the legacy ClassSubject-scoped generator that originally populated them; the shapes themselves
// are unchanged since the new solver returns the exact same DraftEntry/UnplacedItem structure.
export type AutoGenerateMode = 'fill-empty' | 'full-regenerate'
export interface AutoGenerateDraftEntry {
  classId: string; classLabel: string; dayOfWeek: number; periodIdx: number; classSubjectId: string
  subjectName: string; subjectColor: string; roomId: string | null; roomName?: string
  teacherId: string | null; teacherName?: string; isDoublePeriod: boolean
}
export interface AutoGenerateUnplacedItem {
  classId: string; classLabel: string; classSubjectId: string | null; subjectName: string | null
  teacherId: string | null; teacherName: string | null; remaining: number; reason: string
}
export interface AutoGenerateResult { draftEntries: AutoGenerateDraftEntry[]; unplaced: AutoGenerateUnplacedItem[]; conflictsAvoided: number }
export interface AutoGenerateCommitResult { committed: number; classes: { classId: string; entries: number }[] }

// ─────────────────────────────────────────────────────────────
// Phase T4 — Constraint Builder + solver core (narrow scope: Fixed-mode assignment, hard constraints only).
// See .agents/edunova/phase-t4-solver-core.md and server/src/modules/timetable/{teachingRequirements,solver}.ts.
// The auto-generate flow's response shapes (AutoGenerateMode/Result/DraftEntry above) are unchanged; these
// types are additive, for the Cohort-scoped path that now always handles the request (Phase T10 §2).
// ─────────────────────────────────────────────────────────────

export type SessionDuration = 'SINGLE' | 'DOUBLE' | 'TRIPLE' | 'BLOCK'
export type RoomRequirementKind = 'ANY' | 'LAB_TYPE' | 'SPECIFIC_ROOM'
/** A cohort's declared weekly teaching need for one subject — replaces the implicit
 * `ClassSubject.periodsPerWeek` signal for schools that adopt Cohort/TeachingRequirement. */
export interface TeachingRequirement {
  id: string
  schoolId: string
  cohortId: string
  subjectId: string
  requiredPeriodsPerWeek: number
  sessionDuration: SessionDuration
  roomRequirement: RoomRequirementKind
  specificRoomId?: string
  labDoubleAllowed: boolean
  /** T5 §1 — which of the 4 modes resolves this requirement's TeachingAssignment. Defaults to FIXED
   * server-side for every requirement created before this phase. */
  assignmentMode: AssignmentMode
}

export type AssignmentMode = 'FIXED' | 'POOL' | 'RANDOM' | 'OPTIMIZED'
/** All 4 modes as of Phase T5 — Pool/Random/Optimized resolve into the same row shape Fixed already used. */
export interface TeachingAssignment {
  id: string
  schoolId: string
  teachingRequirementId: string
  teacherId: string
  assignmentMode: AssignmentMode
  selectionReason?: string
  createdAt: string
  createdBy: string
}

// ─────────────────────────────────────────────────────────────
// Phase T5 — full assignment modes + soft constraints. See .agents/edunova/phase-t5-full-solver.md and
// server/src/modules/timetable/{assignmentModes,preferences,preferenceProfiles,refinement}.ts.
// ─────────────────────────────────────────────────────────────

/** Mode 2 (Pool) — an admin-defined eligible-teacher set for one requirement; the solver picks the
 * lowest-current-workload member at generation time. */
export interface TeachingAssignmentPoolMember {
  id: string
  teachingRequirementId: string
  teacherId: string
}

export type AvailabilityStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'PREFERRED' | 'NOT_PREFERRED'
export interface TeacherAvailabilityEntry {
  id: string
  teacherId: string
  dayOfWeek: number
  periodIdx: number
  status: AvailabilityStatus
}

/** Assignment-scoring weights (scope ASSIGNMENT, Mode 4's selector) and soft-constraint refinement weights
 * (scope REFINEMENT, the SA engine) — same table, `type` values differ per scope. See
 * assignmentModes.ts#ASSIGNMENT_PREFERENCE_TYPES / refinement.ts#REFINEMENT_TYPES. */
// 'SUBSTITUTION' (Phase T9) added alongside the original two scopes — same `Preference(type, scope, weight)`
// table, `PATCH /timetable/preferences/:type` unmodified, just a third scope value. See useSubstitution.ts.
export type PreferenceScope = 'REFINEMENT' | 'ASSIGNMENT' | 'SUBSTITUTION'
export type AssignmentPreferenceType =
  'QUALIFICATION_MATCH' | 'AVAILABILITY_MATCH' | 'WORKLOAD_BALANCE' | 'CLASS_SUITABILITY'
  | 'TEACHER_PREFERENCE' | 'CONFLICT_MINIMIZATION' | 'BAND_AFFINITY'
export type RefinementPreferenceType =
  'LAB_SPLIT' | 'TEACHER_DAILY_OVERLOAD' | 'TEACHER_WEEKLY_OVERLOAD'
  | 'WORKLOAD_VARIANCE' | 'TEACHER_GAPS'
  | 'UNPREFERRED_SLOT' | 'FORCED_SAME_DAY_REPEAT' | 'ADJACENT_SAME_SUBJECT'
export interface Preference {
  id: string
  type: AssignmentPreferenceType | RefinementPreferenceType | string
  scope: PreferenceScope
  weight: number
  priority: number
  enabled: boolean
  parameters: Record<string, unknown>
}

export type PreferenceProfileName =
  'DEFAULT' | 'BALANCED' | 'TEACHER_FRIENDLY' | 'STUDENT_FRIENDLY' | 'EXAM_PREP' | 'PRIMARY_SCHOOL' | 'LAB_HEAVY'
export interface PreferenceProfile {
  id: string
  name: PreferenceProfileName
  description?: string
  weightOverrides: Record<string, number>
  active: boolean
}

/** SA refinement — POST /timetable/auto-generate/refine. Operates on an in-memory draft (the exact shape
 * POST /auto-generate returns) and never touches the DB; the Timetable Builder chains generate → [refine]
 * → commit, so skipping this call reproduces T4's hard-constraint-only behavior byte-for-byte. */
export interface RefineDraftEntry {
  classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string
  roomId?: string | null; teacherId?: string | null; subjectName: string; isDoublePeriod: boolean
}
export interface ScoreBreakdown {
  major: number; workload: number; minor: number; total: number
  details: Record<string, number>
}
export interface RefineGroupReport {
  groupKey: string; gradeLabel: string; entries: number; iterations: number; accepted: number; elapsedMs: number
  hardBefore: number; hardAfter: number; scoreBefore: ScoreBreakdown; scoreAfter: ScoreBreakdown; improvementPct: number
}
export interface RefineDraftResult {
  draftEntries: RefineDraftEntry[]
  groups: RefineGroupReport[]
  scoreBefore: number
  scoreAfter: number
  improvementPct: number
  hardViolationsBefore: number
  hardViolationsAfter: number
}

// ─────────────────────────────────────────────────────────────
// Phase T6 — sessions, generation jobs, diagnostics. See .agents/edunova/phase-t6-sessions-jobs.md and
// server/src/modules/timetable/{sessions,electives,jobs,diagnostics}.ts (source of truth for these shapes).
// ─────────────────────────────────────────────────────────────

export type TimetableSessionType =
  'SINGLE' | 'DOUBLE' | 'TRIPLE' | 'LAB_BLOCK' | 'ASSEMBLY' | 'LUNCH' | 'ACTIVITY' | 'STUDY' | 'FREE' | 'SHARED' | 'FIXED'

/** §1 — one scheduled occurrence. 2+ `cohortIds` marks a genuine SharedSession: it satisfies every linked
 * cohort's own requirement for that slot in one session, never a collision between them. */
export interface TimetableSession {
  id: string
  schoolId: string
  termId: string
  subjectId: string
  teachingAssignmentId?: string
  teacherId?: string
  roomId?: string
  sessionType: TimetableSessionType
  durationPeriods: number
  isSplittable: boolean
  jobId?: string
  committed: boolean
  committedAt?: string
  createdAt: string
  entries: { dayOfWeek: number; periodIdx: number }[]
  cohortIds: string[]
  requirementIds: string[]
  isShared: boolean
}

// §1b — ElectiveBlock: a grade-wide reserved slot, N parallel offerings students individually choose
// between (the inverse of SharedSession — one slot, multiple parallel sessions).
export interface ElectiveOffering {
  id: string
  electiveBlockId: string
  teachingRequirementId: string
  subjectId?: string
  cohortId?: string
  sessionId?: string
  capacity?: number
  registered: number
  choices: { studentId: string; status: string }[]
}

export interface ElectiveBlock {
  id: string
  schoolId: string
  termId: string
  gradeId: string
  name: string
  dayOfWeek: number
  periodIdx: number
  durationPeriods: number
  createdAt: string
  offerings: ElectiveOffering[]
}

export type ElectiveChoiceStatus = 'Registered' | 'Waitlisted' | 'Cancelled'
export interface ElectiveChoiceResult { id: string; offeringId: string; studentId: string; status: ElectiveChoiceStatus }

// §3 — TimetableGenerationJob: wraps T4/T5's generate→refine pipeline as a first-class, reproducible,
// diagnosable object. Currently runs synchronously within the request that creates it (see jobs.ts) — the
// status/progress/currentStage fields are still recorded faithfully, so the same shape (and the polling
// hook built against it) is ready for genuine async execution later with no breaking change.
export type GenerationJobStatus = 'QUEUED' | 'BUILDING_MODEL' | 'SOLVING' | 'VALIDATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

// §4 — structured infeasibility diagnostics, computed deterministically from the real constraint model —
// never free-text guesswork. `CAPACITY_EXCEEDED` is a cohort-level structural mismatch (more weekly periods
// required than exist); `REQUIREMENT_UNSATISFIED` is a specific unplaced requirement with a classified cause.
export interface CapacityDiagnostic {
  type: 'CAPACITY_EXCEEDED'
  cohortId: string
  cohortLabel: string
  requiredPeriodsPerWeek: number
  availablePeriodsPerWeek: number
  deficit: number
  suggestedActions: string[]
}
export type RequirementDiagnosticCause = 'NO_TEACHER_ASSIGNED' | 'TEACHER_BUSY' | 'NO_ROOM_TYPE' | 'ROOM_SHORTAGE' | 'OTHER'
export interface RequirementDiagnostic {
  type: 'REQUIREMENT_UNSATISFIED'
  cohortLabel: string
  subjectName: string | null
  teacherName: string | null
  unplacedPeriods: number
  cause: RequirementDiagnosticCause
  reason: string
  suggestedActions: string[]
}
export type Diagnostic = CapacityDiagnostic | RequirementDiagnostic

export interface TimetableGenerationJob {
  id: string
  schoolId: string
  academicYearId: string
  termId: string
  scopeCohortIds: string[]
  status: GenerationJobStatus
  progress: number
  currentStage?: string
  startedAt?: string
  completedAt?: string
  solverVersion: string
  timeLimit: number
  randomSeed: number
  solverParameters: { timeBudgetMsPerGroup: number; preferenceProfileName: PreferenceProfileName | null; mode: AutoGenerateMode }
  outputHash?: string
  diagnostics?: Diagnostic[]
  errorCode?: string
  errorDetails?: unknown
  createdById: string
  createdAt: string
}

export interface RegenerateJobResult {
  job: TimetableGenerationJob
  originalOutputHash?: string
  newOutputHash?: string
  byteIdentical: boolean
}

// ─────────────────────────────────────────────────────────────
// Phase T7 — versioning + locks + the management-override system (the centerpiece of the whole roadmap —
// D10). See .agents/edunova/phase-t7-versioning-override.md and
// server/src/modules/timetable/{versions,locks,overrides}.ts (source of truth for these shapes). This
// upgrades the existing Timetable Builder grid (above) in place: outside an edit session the grid behaves
// exactly as before (content-edit modal + PUT /timetable/entries); once a class/term is governed by a
// PUBLISHED TimetableVersion that legacy path is refused server-side (409), and a fork→edit→approve→publish
// session — built here — is the sanctioned way to change it.
// ─────────────────────────────────────────────────────────────

export type TimetableVersionStatus = 'DRAFT' | 'GENERATED' | 'MODIFIED' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED'
/** A version's own entry snapshot — the source of truth for that version regardless of whether it's
 * currently materialized into live `TimetableEntry` rows (only a PUBLISHED version's snapshot is). */
export interface VersionEntry {
  classId: string; dayOfWeek: number; periodIdx: number; classSubjectId: string
  roomId: string | null; teacherId: string | null; sessionId: string | null
}
export interface VersionDiff { added: VersionEntry[]; removed: VersionEntry[]; changed: { before: VersionEntry; after: VersionEntry }[] }
export interface TimetableVersion {
  id: string; schoolId: string; academicYearId: string; termId: string
  scopeCohortIds: string[]; scopeClassIds: string[]
  status: TimetableVersionStatus
  parentVersionId?: string; generationJobId?: string; changeReason?: string
  entryCount: number; entries: VersionEntry[]
  diffFromParent?: VersionDiff
  publishedAt?: string; archivedAt?: string
  createdById: string; createdAt: string
}

/** Exactly the granularities phase-t7 §3 calls for — a whole-DAY lock, a TEACHER lock (that teacher
 * untouchable anywhere in this version), and a single-slot ASSIGNMENT lock are all materially different. */
export type TimetableLockType = 'SESSION' | 'TEACHER' | 'ROOM' | 'COHORT' | 'DAY' | 'PERIOD' | 'ASSIGNMENT'
export interface TimetableLock {
  id: string; timetableVersionId: string; lockType: TimetableLockType; targetType: string
  targetId?: string; dayOfWeek?: number; periodIdx?: number; reason?: string
  createdById: string; createdAt: string
  active: boolean; releasedAt?: string; releasedById?: string
}

/** The exact same 409+`conflicts[]` convention used since Phase 2 (`Conflict` above), extended with the
 * two rules only the override system can hit: `occupied` (defensive — a proposed set collides with
 * itself) and `locked` (the proposed change touches an active `TimetableLock`'s target). */
export interface OverrideConflict {
  rule: 'teacher' | 'room' | 'occupied' | 'locked'
  classId: string; classLabel: string; dayOfWeek: number; periodIdx: number
  teacherId?: string; roomId?: string; lockId?: string; lockReason?: string
}
/** Every move/swap/regenerate-slot call returns this shape. `dryRun: true` never throws — `ok: false` +
 * populated `conflicts` IS the live-preview signal, checked with the exact same logic the real save uses. */
export interface OverrideResult { ok: boolean; conflicts: OverrideConflict[]; entries?: VersionEntry[] }

export type TimetableEditAction = 'MOVE' | 'SWAP' | 'LOCK' | 'UNLOCK' | 'REGENERATE_SLOT' | 'UNDO'
/** One row of a version's ordered hand-edit log — real before/after entry snapshots, which is what makes
 * Undo a genuine replay rather than a best-effort guess. */
export interface TimetableEditEvent {
  id: string; timetableVersionId: string; seq: number; action: TimetableEditAction
  before: VersionEntry[]; after: VersionEntry[]; reason?: string
  createdById: string; createdAt: string; undone: boolean; undoneAt?: string
}

// ─────────────────────────────────────────────────────────────
// Phase T8 — What-If / partial re-optimization. See .agents/edunova/phase-t8-what-if.md and
// server/src/modules/timetable/whatif.ts (source of truth for these shapes). POST /timetable/what-if takes
// an existing TimetableVersion + a changeEvent (a teacher/room going unavailable, a period removed, a school
// event blocking slots, or a TeachingRequirement being added/changed), computes the MINIMAL set of sessions
// that change touches (respecting every active TimetableLock — nothing locked ever moves), and returns a
// brand-new GENERATED `item` version (parent = the version being patched) plus a `summary` naming exactly
// how contained the change was. That new version is reviewed/approved/published through the exact same T7
// version-lineage endpoints `useOverrideSession` already wraps — no separate approval mechanism.
// ─────────────────────────────────────────────────────────────

export interface WhatIfSlotRef { dayOfWeek: number; periodIdx: number }
export type WhatIfChangeEvent =
  | { type: 'TEACHER_UNAVAILABLE'; teacherId: string; slots: WhatIfSlotRef[] }
  | { type: 'ROOM_UNAVAILABLE'; roomId: string; slots: WhatIfSlotRef[] }
  | { type: 'REQUIREMENT_ADDED'; teachingRequirementId: string }
  | { type: 'REQUIREMENT_CHANGED'; teachingRequirementId: string }
  | { type: 'PERIOD_REMOVED'; dayOfWeek: number; periodIdx: number }
  | { type: 'EVENT_BLOCKING_SLOTS'; slots: WhatIfSlotRef[]; classIds?: string[]; cohortIds?: string[] }
export type WhatIfChangeEventType = WhatIfChangeEvent['type']

/** A seed session the event directly touched that could NOT be relocated because an active lock protects it
 * — surfaced honestly rather than either silently violating the lock or silently dropping the session. */
export interface WhatIfLockConflict { entry: VersionEntry; lockId: string; lockType: TimetableLockType; reason?: string }
/** The "97% untouched" reassurance from the phase's own framing, made visible rather than just true. */
export interface WhatIfSummary { affectedSessionCount: number; unaffectedSessionCount: number; affectedCohorts: { id: string; name: string }[] }
export interface WhatIfResult {
  item: TimetableVersion
  changeEvent: WhatIfChangeEvent
  draftEntries: VersionEntry[]
  unplaced: AutoGenerateUnplacedItem[]
  diagnostics: Diagnostic[]
  lockConflicts: WhatIfLockConflict[]
  summary: WhatIfSummary
}

// ─────────────────────────────────────────────────────────────
// Phase T9 — Substitution workflow. See .agents/edunova/phase-t9-substitution.md (roadmap D6). EXTENDS the
// existing `LeaveRequest`/`LeaveType` model (Phase 6) and the existing `Substitution` model (Phase 2, see
// `Substitution` above — reused as-is by `onLeaveApproved` to write the real one-off coverage row, not
// reimplemented) — this section does not fork a parallel leave model. These shapes are confirmed against the
// real server implementation (`server/src/modules/timetable/substitution.ts` + `schema.ts` + `router.ts`,
// and `server/prisma/schema.prisma`'s own T9 doc comments), built in parallel by a separate agent from the
// same spec — every call site lives in `src/lib/hooks/useSubstitution.ts`.
// ─────────────────────────────────────────────────────────────

export type SubstitutionPolicyMode = 'TEACHER_INITIATED' | 'ADMIN_ASSIGNED' | 'HYBRID'
/** `GET/PUT /timetable/substitution-policy` — a school-level singleton; `configured: false` means the school
 * has never saved one and every field is the server's own documented default. */
export interface SubstitutionPolicy {
  schoolId: string
  mode: SubstitutionPolicyMode
  minNoticeHoursForSubstitution: number
  allowCrossSubject: boolean
  /** Hard workload cap the Finder excludes candidates over (not a soft ranking signal). */
  maxWeeklySubstitutePeriods: number
  tentativeHoldExpiryMinutes: number
  configured: boolean
}

/** Ranking weight types for `Preference(scope: 'SUBSTITUTION')` — same table T5's Mode 4 (`scope:
 * 'ASSIGNMENT'`) already uses, reused via the existing `usePreferences`/`PATCH /timetable/preferences/:type`
 * hook rather than a parallel weights concept. Default weights sum to 100 per the spec's table. */
export const SUBSTITUTION_PREFERENCE_TYPES = [
  'QUALIFICATION_MATCH', 'SAME_SUBJECT', 'AVAILABILITY_FIT', 'WORKLOAD_HEADROOM',
  'AVOIDS_CONSECUTIVE_LOAD', 'PREFERENCE', 'CLASS_SUITABILITY',
] as const
export const SUBSTITUTION_PREFERENCE_LABELS: Record<(typeof SUBSTITUTION_PREFERENCE_TYPES)[number], string> = {
  QUALIFICATION_MATCH: 'Qualification match', SAME_SUBJECT: 'Same subject', AVAILABILITY_FIT: 'Availability fit',
  WORKLOAD_HEADROOM: 'Workload headroom', AVOIDS_CONSECUTIVE_LOAD: 'Avoids consecutive load', PREFERENCE: 'Preference', CLASS_SUITABILITY: 'Class suitability',
}

/** One concrete period a substitute is needed for — captured once at send time (`timetableEntryId` names
 * the absent teacher's own recurring row) so a later timetable edit can never retroactively change what a
 * substitute agreed to cover. */
export interface SubstitutionPeriodRef { date: string; dayOfWeek: number; periodIdx: number; timetableEntryId: string }
/** The Finder's own richer period shape (`POST /timetable/substitution-finder`'s response) — everything
 * `SubstitutionPeriodRef` has, plus display context and grade order (used for qualification range checks). */
export interface SubFinderPeriod extends SubstitutionPeriodRef {
  classId: string; classLabel: string; classSubjectId: string; subjectId: string; subjectName: string
  termId: string; roomId: string | null; gradeOrder: number
}

/** Explainable ranking — never a bare score, matching T5 Mode 4's reasoning-visible pattern. `total`/
 * `breakdown` are the weighted per-signal scores; `reasons` are human-readable positives (candidates in this
 * list already passed every hard constraint). */
export interface SubstitutionCandidate { teacherId: string; teacherName: string; total: number; breakdown: Record<string, number>; reasons: string[] }
/** A teacher who failed at least one HARD constraint for this period — `reasons` explains which. */
export interface SubstitutionExcluded { teacherId: string; teacherName: string; reasons: string[] }
export interface SubstitutionFinderPeriodResult { period: SubFinderPeriod; candidates: SubstitutionCandidate[]; excluded: SubstitutionExcluded[] }
export interface SubstituteFinderResult { periods: SubstitutionFinderPeriodResult[]; originalTeacherId: string }

export type SubstitutionRequestStatus = 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'
/** Which policy path produced this row — TEACHER_INITIATED/HYBRID go through SENT→accept; ADMIN_ASSIGNED
 * and EMERGENCY (sub-minimum-notice routing) are created directly ACCEPTED, no round-trip. */
export type SubstitutionRequestMode = 'TEACHER_INITIATED' | 'ADMIN_ASSIGNED' | 'HYBRID' | 'EMERGENCY'
export interface SubstitutionRequest {
  id: string
  leaveRequestId: string
  originalTeacherId: string
  substituteTeacherId: string
  periods: SubstitutionPeriodRef[]
  status: SubstitutionRequestStatus
  mode: SubstitutionRequestMode
  /** The Finder's ranking score for this candidate at send time, if sent through the Finder. */
  score?: number
  /** §4 — an admin forced a candidate through who failed only a soft/qualification check; `overrideNote` is
   * the mandatory audit reason in that case. */
  isOverride: boolean
  overrideNote?: string
  sentById: string
  sentAt: string
  decidedById?: string
  acceptedAt?: string
  declinedAt?: string
  expiredAt?: string
  createdAt: string
  /** Decorations this frontend adds client-side (not server fields) so rows don't need an extra lookup. */
  originalTeacherName?: string
  substituteTeacherName?: string
}

/** `onLeaveApproved`'s result, attached to `POST /leave/requests/:id/approve`'s response as `substitution`
 * (only present when the leave belongs to a teacher and touches at least one teaching period). */
export interface SubstitutionApprovalResult {
  covered: SubFinderPeriod[]
  uncovered: { period: SubFinderPeriod; reasons: string[] }[]
  substitutionIds: string[]
  /** A ready-to-submit T8 What-If event for any period nothing ever covered — surfaced for an admin to
   * explicitly opt into in Timetable Builder, never auto-run (see substitution.ts's own design note: a
   * substitution is a one-off calendar-date exception, not a permanent recurring-template change). */
  whatIfSuggestion?: { versionHint: string; changeEvent: { type: 'TEACHER_UNAVAILABLE'; teacherId: string; slots: { dayOfWeek: number; periodIdx: number }[] } }
}

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
/** `remark` — Phase 20 item 3's one teacher-editable overall remark for this (student, term), stored on
 * `Enrollment.remarks` and set via `PUT /assessments/report-card/remark`. Undefined until a class teacher
 * (or staff/admin) saves one — never auto-filled from an AI draft. */
export interface ReportCard { subjects: ReportCardSubject[]; overall: { total?: number; max?: number; pct: number; grade: string; rank?: number | null; classSize?: number }; remark?: string }
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
  paid?: number; payments?: Payment[]; balance?: number
  /** Phase 21 item 5 — set when this invoice was raised from a `FeeInstallmentPlan` instead of one lump
   * sum; `installmentLabel` is that plan's per-installment label ("Q1", "Q2", ...), empty/absent for a
   * plain (non-installment) invoice. */
  installmentPlanId?: string | null; installmentLabel?: string
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
  // Phase T1 additions — purely additive keys, see phase-t1-timetable-foundations.md
  cohorts: Cohort[]
  capabilities: Capability[]
  teacherQualifications: TeacherQualification[]
}
export const emptyAcademic = (): AcademicState => ({
  years: [], terms: [], boards: [], grades: [], streams: [], curriculum: [],
  classes: [], subjects: [], classSubjects: [], rooms: [], enrollments: [], guardians: [],
  periodTemplates: [],
  cohorts: [], capabilities: [], teacherQualifications: [],
})

/**
 * Comparator for classes in true academic order — by each class's `Grade.order` (I, II, III … XII) —
 * rather than `label.localeCompare(..., { numeric: true })`, which is built for decimal digit runs
 * ("item2" vs "item10") and has no notion of Roman-numeral magnitude, so it misorders a full I–XII
 * school as I, II, III, IV, IX, V, VI, VII, VIII, X, XI, XII. Ties (same grade) break by board, then
 * stream, then section.
 */
export function compareClasses(gradeById: Map<string, Grade>) {
  return (a: ClassRec, b: ClassRec) =>
    (gradeById.get(a.gradeId)?.order ?? 0) - (gradeById.get(b.gradeId)?.order ?? 0)
    || a.boardCode.localeCompare(b.boardCode)
    || (a.stream ?? '').localeCompare(b.stream ?? '')
    || a.section.localeCompare(b.section, undefined, { numeric: true })
}

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
  /** Present once a certificate has been issued against this application (TC/Bonafide/Character). */
  certificateId?: string | null

  // ── Phase T2 Part A — admission data expansion (Admission kind only) ──
  /** Prior academics. */
  previousSchoolName?: string | null
  previousBoardId?: string | null
  lastGradeCompleted?: string | null
  /** Individual key-subject scores from the previous school — feeds T3 TrackEligibilityRule thresholds. */
  priorSubjectScores?: PriorSubjectScore[]
  /** Free-text for T2; T3 formalizes against real Cohort/track data. */
  declaredTrackPreference?: string | null
  /** A student already enrolled who is a sibling — set once a suggested/looked-up match is accepted. */
  siblingStudentId?: string | null
  /** School-editable AdmissionCategory catalog (General/SC/ST/OBC/EWS/RTE/…) — drives which RequiredDocumentTypes apply. */
  admissionCategoryId?: string | null
  /** How the seat was allotted — distinct from `admissionCategoryId` (the reservation basis); drives RequiredDocumentType.requiredIfAdmissionMode. */
  admissionMode?: AdmissionMode | null
  /** Small structured subset captured once at intake, handed off into HealthRecord on approval — not a duplicate of the full module. */
  healthFlags?: AdmissionHealthFlags | null
  /** Captured at intake, surfaced as a to-do (`GET /applications/transport-todos`) for staff to complete the actual StudentStopAssignment post-enrollment. */
  transportRequired?: boolean
  transportPreferredArea?: string | null
  transportHandledAt?: string | null
}
export interface PriorSubjectScore { id?: string; applicationId?: string; subjectName: string; score: number; maxScore: number }
export type AdmissionMode = 'Regular' | 'RTE' | 'Management' | 'Staff-Ward'
export interface AdmissionHealthFlags { allergies?: string | null; conditions?: string | null; bloodGroup?: string | null }
/** School-editable quota/reservation catalog — real, India-specific, not a hardcoded enum. */
export interface AdmissionCategory { id: string; name: string; code: string; requiresCertificate: boolean; isActive: boolean }
/** Possible-sibling suggestion from `GET /applications/sibling-suggestions?phone=&email=` — derived from a shared Guardian, not a stored field. */
export interface SiblingSuggestion { studentId: string; name: string; classLabel?: string | null }
/** `GET /applications/transport-todos` — approved admissions that declared a transport need, not yet handled. */
export interface TransportTodo { applicationId: string; studentId: string; applicantName: string; transportPreferredArea?: string | null; alreadyAssigned: boolean }

/** `POST /applications/:id/approve` on an Admission returns the accounts it created, with plain passwords shown once. */
export interface AdmissionCreated { student: { email: string; password: string }; parent?: { email: string; password: string } | null }
export type CertificateKind = 'TC' | 'Bonafide' | 'Character'
export interface Certificate { id: string; kind: CertificateKind; studentId: string; serialNo: string; issuedById: string; issuedAt: string; pdfFileId: string; applicationId?: string | null }

// ─────────────────────────────────────────────────────────────
// Phase T2 Part B — document & certificate management, with physical custody tracking.
// See .agents/edunova/phase-t2-strong-admissions.md
// ─────────────────────────────────────────────────────────────

/** A school-configurable catalog of document types, each with a simple structured condition for when it's required. */
export interface RequiredDocumentType {
  id: string
  name: string
  code: string
  /** Required for every application/student, regardless of category/mode/board. */
  alwaysRequired: boolean
  /** Required when the application's AdmissionCategory.code is one of these. */
  requiredIfCategoryIn: string[]
  /** Required when the application's admissionMode (e.g. "RTE") is one of these. */
  requiredIfAdmissionMode: string[]
  /** Required when the applicant's previous board differs from the school's board for the target class. */
  requiredIfBoardChanged: boolean
  isActive: boolean
}

export type DocumentStatus = 'HELD' | 'RETURNED' | 'LOST' | 'NOT_APPLICABLE'

/** A document on file for an application and/or an enrolled student — a digital scan (via the existing File
 * system), physical-custody fields for originals, or both. `GET /admission-documents`. */
export interface SubmittedDocument {
  id: string
  applicationId?: string | null
  studentId?: string | null
  requiredDocumentTypeId?: string | null
  /** Digital scan — existing File system. */
  fileId?: string | null
  isOriginal: boolean
  physicalLocationRoom?: string | null
  physicalLocationShelf?: string | null
  physicalLocationFolder?: string | null
  receivedDate?: string | null
  status: DocumentStatus
  returnedDate?: string | null
  returnedTo?: string | null
  returnReason?: string | null
  submittedById?: string | null
  createdAt: string
  // Decorations only present on the records-report row (GET /admission-documents/records-report).
  documentTypeName?: string
  documentTypeCode?: string
  studentName?: string
  applicantName?: string
  resolvedStudentId?: string
}

/** `GET /admission-documents/settings` · `PATCH .../settings`. */
export interface AdmissionSettings { admissionDocumentsBlockApproval: boolean }

/** `GET /admission-documents/checklist/:applicationId`. */
export interface AdmissionChecklistItem { requiredDocumentTypeId: string; name: string; code: string; required: boolean; submitted: boolean; submittedDocumentId?: string; status?: DocumentStatus }
export interface AdmissionChecklist {
  applicationId: string
  admissionDocumentsBlockApproval: boolean
  items: AdmissionChecklistItem[]
  missingRequired: string[]
  complete: boolean
  extraDocuments: SubmittedDocument[]
}

/** `GET /admission-documents/tc-return-checklist/:studentId` — the held-originals gate ahead of TC issuance. */
export interface TcReturnChecklistItem { id: string; name: string; physicalLocationRoom?: string | null; physicalLocationShelf?: string | null; physicalLocationFolder?: string | null; receivedDate?: string | null }
export interface TcReturnChecklist { studentId: string; heldOriginals: TcReturnChecklistItem[]; blocksIssuance: boolean }
/** Body accepted by `POST /applications/:id/approve` for a TC application, per held original. */
export interface DocumentReturnResolution { submittedDocumentId: string; action: 'RETURNED' | 'EXCEPTION'; returnedTo?: string; exceptionReason?: string }
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
/** Phase T9 (roadmap D6) adds `PENDING_SUBSTITUTION` before `Pending` in the lifecycle — set while one or
 * more `SubstitutionRequest` rows are SENT (not yet accepted/declined/expired) for this leave, flipping back
 * to `Pending` once every outstanding request resolves. `approve()`/`decline()` 409 while a leave is in this
 * state — see `assertPending` in `leave/service.ts`. Existing non-teaching leave (staff, student, or
 * teaching leave that never had an outstanding SENT request) never sees this value, unchanged. */
export type LeaveRequestStatus = 'PENDING_SUBSTITUTION' | 'Pending' | 'Approved' | 'Declined' | 'Cancelled'
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

export type ActivityKind = 'club' | 'house' | 'exc' | 'event' | 'faculty' | 'track'
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
  /** Set when kind='track' (Phase T3): links this activity's choice-collection surface to a T1 Cohort. */
  trackCohortId?: string | null
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

// ─────────────────────────────────────────────────────────────
// Phase 11 — Employee management: reporting line, performance reviews, employment history,
// staff conduct records, employee documents & ID card. See .agents/edunova/phase-11-employee-management.md
// ─────────────────────────────────────────────────────────────

export type ReviewStatus = 'Draft' | 'Shared' | 'Acknowledged'
export interface PerformanceReviewRec {
  id: string
  employeeId: string
  reviewerId: string
  cycle: string
  periodStart: string
  periodEnd: string
  overallRating: number
  strengths: string
  areasForImprovement: string
  goals: string
  employeeComments?: string | null
  status: ReviewStatus
  createdAt: string
  sharedAt?: string | null
  acknowledgedAt?: string | null
  /** Decorations some servers attach so the UI doesn't need an extra lookup. */
  employeeName?: string
  reviewerName?: string
}

export type EmploymentChangeType = 'Role' | 'Designation' | 'Department' | 'Salary' | 'ClassTeacherAssignment' | 'Other'
export interface EmploymentHistoryEntry {
  id: string
  userId: string
  changeType: EmploymentChangeType
  fromValue?: string | null
  toValue: string
  effectiveDate: string
  changedById: string
  note?: string | null
  createdAt: string
  changedByName?: string
}

export type StaffConductCategory = 'Conduct' | 'Performance' | 'Policy' | 'Attendance' | 'Other'
export type StaffConductStatus = 'Reported' | 'UnderReview' | 'Resolved'
export interface StaffConductRecord {
  id: string
  employeeId: string
  reportedById: string
  title: string
  description: string
  category: StaffConductCategory
  status: StaffConductStatus
  actionTaken?: string | null
  fileIds: string[]
  createdAt: string
  resolvedAt?: string | null
  resolvedById?: string | null
  /** Decorations some servers attach so the UI doesn't need an extra lookup. */
  employeeName?: string
  reportedByName?: string
}

export interface EmployeeDocumentRec {
  id: string
  userId: string
  fileId: string
  label: string
  uploadedAt: string
  fileName?: string
}

/* ── Phase 13 — Alumni management ──────────────────────── */

export interface AlumniProfile {
  id: string
  studentUserId?: string | null
  name: string
  email?: string | null
  phone?: string | null
  graduationYear: number
  lastClassLabel: string
  currentOccupation?: string | null
  currentOrganization?: string | null
  currentCity?: string | null
  linkedInUrl?: string | null
  notes?: string | null
  convertedAt: string
  convertedById: string
  /** Decorations some servers attach so the UI doesn't need an extra lookup. */
  convertedByName?: string
}

export interface AlumniEvent {
  id: string
  title: string
  description?: string | null
  date: string
  location?: string | null
  createdById: string
  createdByName?: string
}

export type AlumniRsvpStatus = 'Interested' | 'Going' | 'Declined'
export interface AlumniEventRsvp {
  id: string
  eventId: string
  alumniId: string
  status: AlumniRsvpStatus
  respondedAt: string
  alumniName?: string
}

export interface AlumniDonation {
  id: string
  alumniId: string
  amount: number
  purpose?: string | null
  donatedAt: string
  recordedById: string
  note?: string | null
  alumniName?: string
  recordedByName?: string
}

/* ── Phase 12 — Transport / Bus management ─────────────────
 * Routes with ordered stops, vehicles (driver/conductor as plain fields, not User accounts), student→stop
 * assignments, and a VehicleLocation log the future native driver app will write to via a ping endpoint —
 * this web app only ever reads locations. See .agents/edunova/phase-12-transport.md */

export interface RouteRec {
  id: string
  schoolId?: string
  name: string
  description?: string | null
  createdAt: string
  /** Decoration: some servers attach a stop count so the list view doesn't need a second call. */
  stopCount?: number
}

export interface StopRec {
  id: string
  routeId: string
  name: string
  /** Order along the route, 1-based. */
  sequence: number
  latitude?: number | null
  longitude?: number | null
  /** Minutes from route start — a rough ETA estimate. */
  arrivalOffsetMin?: number | null
  /** Decoration. */
  routeName?: string
}

export type BoardingType = 'Pickup' | 'Drop' | 'Both'

export interface VehicleRec {
  id: string
  schoolId?: string
  registrationNo: string
  capacity: number
  routeId?: string | null
  driverName: string
  driverPhone: string
  conductorName?: string | null
  conductorPhone?: string | null
  /** Optional link to an existing staff `User`, for the future native app's driver auth — not required. */
  driverUserId?: string | null
  /** Decoration. */
  routeName?: string
}

export interface StudentStopAssignmentRec {
  id: string
  studentId: string
  stopId: string
  boardingType: BoardingType
  createdAt: string
  /** Decorations some servers attach so the UI doesn't need an extra lookup. */
  studentName?: string
  stopName?: string
  routeId?: string
  routeName?: string
}

/** One GPS ping, written by the future native driver app — history is kept, only the latest per vehicle
 * matters for "where is the bus now." */
export interface VehicleLocationRec {
  id: string
  vehicleId: string
  latitude: number
  longitude: number
  recordedAt: string
  tripDate?: string
}

/** One row of a `GET /transport/my-stop` response — a student can have distinct Pickup and Drop stops (or a
 * single "Both" row), so the endpoint answers with one of these per boarding type the student has. */
export interface MyStopAssignmentRec {
  id: string
  boardingType: BoardingType
  stop: StopRec
  route: RouteRec
  vehicle?: VehicleRec | null
  location?: VehicleLocationRec | null
}

/** `GET /transport/my-stop` response: a parent/student's stop(s), route, vehicle and its latest location
 * bundled in one call so the UI doesn't have to stitch three requests together. */
export interface MyStopRec {
  studentId: string
  assignments: MyStopAssignmentRec[]
}

/* ── Phase 15 — Library Management ──────────────────────────
 * Books (catalog, one row per title) with BookCopies (one row per physical copy, since a title can have
 * several copies), Loans against a specific copy, and a per-school LibrarySettings row (loan period, per-role
 * active-loan limits, fine rate) so the numbers aren't hardcoded. See .agents/edunova/phase-15-library.md */

export type BookCondition = 'New' | 'Good' | 'Worn' | 'Damaged'
export type CopyStatus = 'Available' | 'Loaned' | 'Lost' | 'Retired'
export type FineStatus = 'None' | 'Pending' | 'Paid' | 'Waived'

export interface BookRec {
  id: string
  schoolId?: string
  title: string
  author: string
  isbn?: string | null
  publisher?: string | null
  category?: string | null
  coverFileId?: string | null
  createdAt?: string
  /** Decoration: catalog list/detail carries copy counts so the browse screen doesn't need N+1 calls. */
  totalCopies?: number
  availableCopies?: number
}

export interface BookCopyRec {
  id: string
  bookId: string
  barcode: string
  condition?: BookCondition | null
  status: CopyStatus
  acquiredAt?: string | null
  /** Decoration. */
  bookTitle?: string
}

/** Matches `server/src/modules/library/service.ts#serializeLoan` exactly (verified against the live server) —
 * the book/borrower/issuedBy/returnedBy context is nested, not flattened onto the loan row. */
export interface LoanRec {
  id: string
  copyId: string
  copy: { id: string; barcode: string; status: CopyStatus; condition?: BookCondition; book: { id: string; title: string; author: string } }
  borrowerId: string
  borrower: { id: string; name: string; role: Role }
  issuedAt: string
  dueDate: string
  returnedAt?: string | null
  fineAmount?: number | null
  fineStatus: FineStatus
  issuedById: string
  issuedBy?: { id: string; name: string }
  returnedById?: string | null
  returnedBy?: { id: string; name: string }
  createdAt?: string
}

export interface LibrarySettingsRec {
  id: string
  schoolId?: string
  loanPeriodDays: number
  maxActiveLoansStudent: number
  maxActiveLoansStaff: number
  finePerDayOverdue: number
}

/* ── Phase 14 — Hostel Management ──────────────────────────
 * Hostels → rooms → beds (one row per physical bed, so occupancy is exact — not just a capacity counter) and
 * student allocations (Active | Vacated | Transferred). A transfer is vacate-old + allocate-new as fresh rows,
 * never a mutated bedId, so the allocation history stays honest. Shapes here mirror
 * server/src/modules/hostel/service.ts's serializers exactly (verified against the live server — allocations
 * carry NO name/label decorations, unlike Transport's assignments; the UI cross-references bed/room/hostel/user
 * lists client-side, same as transport.tsx's AssignmentsSection does for stop/route names).
 * See .agents/edunova/phase-14-hostel.md */

export type HostelType = 'Boys' | 'Girls' | 'Mixed'

export interface HostelRec {
  id: string
  schoolId?: string
  name: string
  type: HostelType
  wardenUserId?: string
  address?: string
  createdAt: string
  /** Decorations from `GET /hostel/hostels` only (not on `GET /hostel/hostels/:id`). */
  totalBeds?: number
  occupiedBeds?: number
}

export interface HostelRoomRec {
  id: string
  hostelId: string
  roomNumber: string
  floor?: string
  /** Kept in sync with the room's bed count by the server (createRoom/resizeRoom/createBed/removeBed). */
  capacity: number
  roomType?: string
  createdAt?: string
  /** Decorations from `GET /hostel/rooms`. */
  bedCount?: number
  occupiedCount?: number
}

/** A bed's current occupant, nested under `HostelBedRec.occupant` (not flat fields). */
export interface HostelBedOccupant {
  allocationId: string
  studentId: string
  studentName: string
  checkInDate: string
}

export interface HostelBedRec {
  id: string
  roomId: string
  bedLabel: string
  createdAt?: string
  /** Decoration from `GET /hostel/beds` (and the nested `GET /hostel/hostels/:id`) — `null` while vacant. */
  occupant?: HostelBedOccupant | null
}

export type HostelAllocationStatus = 'Active' | 'Vacated' | 'Transferred'

/** No name/label decorations — `GET /hostel/allocations` answers bare rows; resolve student/bed/room/hostel
 * names by cross-referencing the corresponding list hooks (see `useHostel.ts`). */
export interface HostelAllocationRec {
  id: string
  studentId: string
  bedId: string
  checkInDate: string
  checkOutDate?: string
  status: HostelAllocationStatus
  allocatedById?: string
  notes?: string
  createdAt: string
}

/* ── Phase 24 — Boarding & Hostel Extensions ────────────────
 * Outpass/leave workflow, night roll-call, and mess menu + meal feedback — all layered onto Phase 14's
 * Hostel/HostelRoom/HostelBed/HostelAllocation. See .agents/edunova/phase-24-boarding-hostel-extensions.md and
 * server/src/modules/hostel/{router,schema,service}.ts. */

export type HostelOutpassStatus = 'Pending' | 'Approved' | 'Declined' | 'Departed' | 'Returned' | 'Overdue'

export interface HostelOutpassRec {
  id: string
  studentId: string
  hostelId: string
  requestedDepartureAt: string
  expectedReturnAt: string
  reason: string
  destination?: string
  status: HostelOutpassStatus
  approvedByWardenId?: string
  approvedAt?: string
  actualDepartureAt?: string
  actualReturnAt?: string
  createdAt: string
}

export interface HostelRollCallEntryRec {
  id: string
  rollCallId?: string
  allocationId: string
  present: boolean
  notes?: string
  /** Decorations from the server (joined off the allocation) so the roll-call screen doesn't need a second
   * cross-reference against `/hostel/allocations` + the users list. */
  studentId?: string
  studentName?: string
}

export interface HostelRollCallRec {
  id: string
  hostelId: string
  date: string
  recordedById: string
  createdAt: string
  entries: HostelRollCallEntryRec[]
}

export type MealType = 'Breakfast' | 'Lunch' | 'Snacks' | 'Dinner'

export interface MessMenuRec {
  id: string
  hostelId: string
  date: string
  mealType: MealType
  items: string[]
  createdAt?: string
  /** Server-computed disclaimer, always present — surface it verbatim, never hide it. */
  allergyDisclaimer?: string
  /** Server-computed keyword cross-reference against the caller's (or their single ward's) recorded
   * HealthRecord allergy entries — present only when the caller is a student/parent viewing for exactly
   * one student. Omitted (not empty) when there's nothing to flag or the caller isn't scoped to one student. */
  allergyFlags?: string[]
}

export interface MealFeedbackRec {
  id: string
  menuId: string
  studentId: string
  rating: number
  comment?: string
  createdAt?: string
}

/* ── Phase 16 — Inventory / Procurement ─────────────────────
 * Catalog items (consumable or fixed-asset) whose `currentStock` is denormalized but ONLY ever changes via a
 * `StockMovement` write (direct adjustment, or received against a PurchaseOrder) — never editable through the
 * item-update endpoint itself. Vendors and PurchaseOrders (Draft → Ordered → PartiallyReceived/Received,
 * or Cancelled) round out procurement. See .agents/edunova/phase-16-inventory.md.
 *
 * Matches server/src/modules/inventory/service.ts's serializers exactly (verified against the live server —
 * every response is UNDECORATED: no nested `item`/`vendor`/`recordedBy` context on movements or PO lines, so
 * the UI cross-references the sibling items/vendors lists client-side, same as hostel.tsx resolving
 * bed/room/hostel names). See useInventory.ts's header note for the reconciled endpoint paths/body shapes.
 */

export type StockMovementType = 'In' | 'Out' | 'Adjustment'
export type PurchaseOrderStatus = 'Draft' | 'Ordered' | 'PartiallyReceived' | 'Received' | 'Cancelled'

export interface InventoryItemRec {
  id: string
  schoolId?: string
  name: string
  category?: string | null
  unit: string
  isConsumable: boolean
  /** Only meaningful for consumables — a fixed asset (e.g. a projector) has no reorder point. */
  reorderThreshold?: number | null
  /** Denormalized, server-computed — kept in sync by StockMovement writes. Never sent on an item update. */
  currentStock: number
  /** Server-computed: `reorderThreshold != null && currentStock <= reorderThreshold`. */
  lowStock?: boolean
  createdAt?: string
  updatedAt?: string
}

/** No nested `item`/`recordedBy` — bare row, matching `serializeMovement` exactly. `quantity` is a positive
 * int for In/Out (direction implied by `type`) but SIGNED for Adjustment (positive = added/found, negative =
 * damage/loss) — see useInventory.ts's `movementDelta`. */
export interface StockMovementRec {
  id: string
  itemId: string
  type: StockMovementType
  quantity: number
  reason?: string | null
  relatedPoId?: string | null
  recordedById: string
  recordedAt: string
}

export interface VendorRec {
  id: string
  schoolId?: string
  name: string
  contactName?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  createdAt?: string
  updatedAt?: string
}

/** No nested `item` — matching `serializePoLine` exactly; resolve the item's name/unit via `itemId` against
 * the items list. */
export interface PurchaseOrderLineRec {
  id: string
  poId: string
  itemId: string
  quantityOrdered: number
  quantityReceived: number
  unitCost?: number | null
}

/** No nested `vendor` — matching `serializePo` exactly; resolve the vendor's name via `vendorId`. */
export interface PurchaseOrderRec {
  id: string
  schoolId?: string
  vendorId: string
  status: PurchaseOrderStatus
  orderedAt?: string | null
  expectedDate?: string | null
  notes?: string | null
  createdById: string
  createdAt?: string
  updatedAt?: string
  lines: PurchaseOrderLineRec[]
}

/* ── Phase 17: Accounting / General Ledger ──────────────── */

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense'

export interface AccountRec {
  id: string
  schoolId?: string
  code: string
  name: string
  type: AccountType
  /** A simple one-level hierarchy (e.g. "Cash"/"Bank" under "Current Assets") — nullable, no relation object. */
  parentId?: string | null
  /** True for accounts the Fees/Payroll auto-posting integration relies on — the UI discourages (does not
   * necessarily forbid) deleting/deactivating these. */
  isSystem: boolean
  active: boolean
  createdAt?: string
  updatedAt?: string
}

export type JournalSourceType = 'Manual' | 'FeePayment' | 'Payroll' | 'Other'

/** `debit`/`credit` are both present per line; exactly one is non-zero, enforced server-side. */
export interface JournalLineRec {
  id: string
  entryId: string
  accountId: string
  debit: number
  credit: number
}

/** A JournalEntry is posted immediately on creation (no draft/approval workflow) — `postedAt` is always set. */
export interface JournalEntryRec {
  id: string
  schoolId?: string
  date: string
  memo: string
  reference?: string | null
  sourceType: JournalSourceType
  /** Polymorphic FK-by-convention to the originating FeePayment/Payslip id — not a real relation. */
  sourceId?: string | null
  createdById: string
  createdAt: string
  postedAt: string
  lines: JournalLineRec[]
  /** Server-computed decorations (sum of the lines) — convenient for a list row's total column. */
  totalDebit?: number
  totalCredit?: number
}

export interface TrialBalanceRow { accountId: string; code: string; name: string; type: AccountType; debit: number; credit: number }
export interface TrialBalanceRec { asOf: string; accounts: TrialBalanceRow[]; totalDebit: number; totalCredit: number }

export interface ProfitAndLossRow { accountId: string; code: string; name: string; amount: number }
export interface ProfitAndLossRec {
  from: string; to: string
  income: ProfitAndLossRow[]; expense: ProfitAndLossRow[]
  totalIncome: number; totalExpense: number; netIncome: number
}

/** `accountId`/`code` are null on the one synthetic "Retained Earnings (Net Income)" row the server folds
 * into Equity (this phase has no period-close workflow — see service.ts's balanceSheet for why that row is
 * needed for Assets to equal Liabilities + Equity). */
export interface BalanceSheetRow { accountId: string | null; code: string | null; name: string; amount: number }
export interface BalanceSheetRec {
  asOf: string
  assets: BalanceSheetRow[]; liabilities: BalanceSheetRow[]; equity: BalanceSheetRow[]
  totalAssets: number; totalLiabilities: number; totalEquity: number; totalLiabilitiesAndEquity: number
}

// ─────────────────────────────────────────────────────────────
// Phase 21 — Financial Intelligence: three reports layered on Phase 17's ledger + Phase 5's Fees module,
// a formal scholarship program (propose → approve, admin/superadmin only approve), and parent-facing fee
// installment plans. See .agents/edunova/phase-21-financial-intelligence.md.

export interface CashFlowForecastMonth { month: string; projectedInflow: number; projectedOutflow: number; projectedBalance: number }
/** `startingBalance` is the Bank account's current GL balance (Phase 17); `monthlyPayrollObligation` is
 * the current total monthly SalaryStructure basic+allowances across active staff, assumed constant across
 * the window (no seasonality modeling — see `methodology`). */
export interface CashFlowForecastRec {
  startingBalance: number; monthlyPayrollObligation: number; months: CashFlowForecastMonth[]; methodology: string
}

/** A "program" is a board+grade combination — the only program concept this codebase has before
 * Phase 24/28 hostel/campus exist. `methodology` is a human-readable disclaimer the server always sends —
 * shared/overhead cost allocation (a teacher split across boards, general school overhead not allocated at
 * all) is an estimate, not exact accounting, and the UI must always surface this string, never hide it. */
export interface ProgramProfitabilityRow {
  boardId: string; boardName: string; gradeId: string; gradeLabel: string
  income: number; expense: number; profit: number; teacherCount: number; weeklyPeriods: number
}
export interface ProgramProfitabilityRec { termId: string; programs: ProgramProfitabilityRow[]; methodology: string }

export interface ConcessionImpactRec {
  termId?: string; totalInvoiced: number; totalConcession: number; pctOfInvoiced: number
  scholarshipConcession: number; manualConcession: number
  byScholarshipType: { type: string; amount: number }[]
  studentsAffected: number
}

export type ScholarshipType = 'MeritBased' | 'NeedBased' | 'SiblingDiscount' | 'StaffWard' | 'Other'
export type ScholarshipDiscountType = 'Percentage' | 'FixedAmount'
export type ScholarshipAwardStatus = 'Pending' | 'Approved' | 'Rejected'

/** `type`/`discountType`/`discountValue` are immutable after creation server-side (changing them once
 * awards exist would misrepresent what was actually approved historically). */
export interface Scholarship {
  id: string; schoolId?: string; name: string; type: ScholarshipType; discountType: ScholarshipDiscountType
  discountValue: number; criteria?: string; active: boolean; createdAt?: string
}

/** Pending → Approved | Rejected. On approval the discount is retroactively applied to the student's
 * not-yet-fully-paid invoices for the academic year (`appliedToInvoiceIds`/`totalDiscountApplied` track
 * exactly how much) and auto-applies to any invoice generated afterwards for the same student/year. */
export interface ScholarshipAward {
  id: string; schoolId?: string; scholarshipId: string; studentId: string; academicYearId: string
  status: ScholarshipAwardStatus; reason?: string; proposedById: string
  approvedById?: string; approvedAt?: string
  appliedToInvoiceIds: string[]; totalDiscountApplied: number; createdAt?: string
}

/** One entry in a `FeeInstallmentPlan.installments` array — exactly one of percentage/amount is set (a
 * plan is either all-percentage, summing to 100, or all-fixed-amount, never mixed within one plan).
 * `dueDateOffsetDays` is added to the parent `FeeStructure`'s dueDate to get this installment's own due date. */
export interface InstallmentSpec { label: string; percentage?: number; amount?: number; dueDateOffsetDays: number }

export interface FeeInstallmentPlan {
  id: string; schoolId?: string; feeStructureId: string; name: string; installments: InstallmentSpec[]; createdAt?: string
}

// ─────────────────────────────────────────────────────────────
// Phase 18 — syllabus & teaching-progress tracking.
// See .agents/edunova/phase-18-syllabus-tracking.md. Chapter is the tracked unit (topics are free text on
// the chapter, not a separate entity); progress is self-reported by the teacher, no verification step.
// ─────────────────────────────────────────────────────────────

/** Ordered chapter list on a `CurriculumSubject` (board × grade × stream × subject) — shared by every class-section teaching it.
 * The design doc floats optional free-text `topics` under a chapter; the server doesn't persist that field yet
 * (not on the Prisma model), so it's intentionally absent here — see the frontend report for this Phase 18 gap. */
export interface SyllabusChapter {
  id: string
  curriculumSubjectId: string
  order: number
  title: string
  estimatedPeriods: number
  examWeightagePct?: number | null
}

export type ChapterProgressStatus = 'NotStarted' | 'InProgress' | 'Done'

/** One row per (class-subject, chapter) — this is where two sections of the same curriculum-subject diverge in pace.
 * A chapter with no saved progress yet still gets a row here (server default: `id` undefined, `status: 'NotStarted'`). */
export interface ChapterProgress {
  id?: string
  classSubjectId: string
  chapterId: string
  status: ChapterProgressStatus
  startedAt?: string | null
  completedAt?: string | null
  notes?: string | null
  updatedById?: string
  updatedAt?: string
}

/** `targetChapterId` is the chapter that should be reached by term end. `classId` null = school-wide default for the curriculum-subject. */
export interface TermSyllabusTarget {
  id: string
  curriculumSubjectId: string
  termId: string
  targetChapterId: string
  classId?: string | null
}

/** The shared per-chapter teaching-resource library (lesson plans, worksheets, slides) — visible to every
 * teacher who teaches that curriculum-subject anywhere in the school. */
export interface ChapterResource {
  id: string
  chapterId: string
  fileId: string
  label: string
  uploadedById: string
  createdAt: string
}

/** `GET /syllabus/pace/:classSubjectId` — computed expected-pace view. See phase-18 §Computed views: lost
 * periods split by cause, "expected" derived from delivered periods against cumulative `estimatedPeriods`,
 * "actual" from chapters actually marked Done. */
export interface SyllabusPace {
  classSubjectId: string
  curriculumSubjectId: string | null
  termId: string
  asOf: string
  scheduledPeriodsSoFar: number
  lostPeriods: { holiday: number; teacherAbsence: number; total: number }
  deliverablePeriods: number
  expected: { chaptersCompleted: number; currentChapterId: string | null; currentChapterTitle: string | null; currentChapterOrder: number | null } | null
  actual: { chaptersCompleted: number; currentChapterId: string | null; currentChapterOrder: number | null } | null
  /** actual.chaptersCompleted − expected.chaptersCompleted: positive = ahead, 0 = on pace, negative = behind. */
  paceDeltaChapters: number
}

/** `GET /syllabus/coverage/:classSubjectId` — one row per chapter marked Done, each with every published
 * assessment linked to it (via `Assessment.chapterIds`) and the class's average score on it; `assessments`
 * is an empty array for a Done chapter with nothing linked yet. */
export interface CoverageRow {
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  completedAt?: string | null
  assessments: { assessmentId: string; name: string; maxMarks: number; studentsGraded: number; avgScorePct: number | null }[]
}

// Phase 19 — early warning & teaching analytics. See .agents/edunova/phase-19-early-warning-analytics.md
// and server/src/modules/analytics/{router,service,schema}.ts (built in parallel — these types were
// adjusted to match its actual response shapes once it landed; see the frontend report for any mismatches
// vs. the spec's endpoint list).

export type RiskLevel = 'Low' | 'Medium' | 'High'
/** One line of the "why" behind a risk score — `weight` is the factor's share of the 0-100 point budget,
 * `contribution` is what it actually added for this student (0 for a healthy factor, up to `weight` for a
 * maximally bad one). See server/src/modules/analytics/service.ts's `computeRiskScore` doc comment for the
 * exact per-factor formula and reasoning (attendance 35pts, marks trend 20pts, marks absolute 10pts,
 * homework overdue 15pts, discipline 10pts, fee overdue — tiered, not linear — 10pts). */
export interface RiskFactor { factor: string; weight: number; contribution: number }
/** `GET /analytics/risk-snapshots` — a computed, periodically-refreshed row per (student, term), not a
 * live-query-every-time endpoint. Recomputed via `POST /analytics/risk-snapshots/recompute`. */
export interface StudentRiskSnapshot {
  id: string
  studentId: string
  studentName?: string
  classId?: string
  classLabel?: string
  termId: string
  computedAt: string
  attendancePct: number
  avgMarksPct: number
  homeworkOverdueCount: number
  feeOverdueAmount: number
  openDisciplineCaseCount: number
  riskScore: number
  riskLevel: RiskLevel
  factors: RiskFactor[]
}

/** `GET /analytics/lost-time?termId=&groupBy=class|subject|teacher` — aggregated from Phase 18's
 * per-class-subject pace/lost-periods computation (`syllabus/service.ts#computePace`), summed by group. */
export interface LostTimeRow {
  key: string
  label: string
  scheduledPeriodsSoFar: number
  lostHoliday: number
  lostTeacherAbsence: number
  lostTotal: number
  deliverablePeriods: number
}
export interface LostTimeReport {
  termId: string
  groupBy: 'class' | 'subject' | 'teacher'
  totals: { scheduledPeriodsSoFar: number; lostHoliday: number; lostTeacherAbsence: number; lostTotal: number; deliverablePeriods: number }
  items: LostTimeRow[]
}

/** `GET /analytics/teacher-workload?termId=` — periods/week per teacher from real `TimetableEntry` rows,
 * against the school's `AnalyticsSettings.highLoadThreshold` (admin-editable via `/analytics/settings`). */
export interface TeacherWorkloadRow {
  teacherId: string
  teacherName: string
  periodsPerWeek: number
  overThreshold: boolean
}
export interface TeacherWorkloadReport { termId: string; highLoadThreshold: number; items: TeacherWorkloadRow[] }
/** `GET /analytics/teacher-workload/:teacherId?termId=` — the lightweight single-teacher lookup the
 * Timetable Builder uses inline (avoids fetching the whole-school report on every cell edit). */
export interface TeacherWorkloadOne { teacherId: string; termId: string; periodsPerWeek: number; highLoadThreshold: number; overThreshold: boolean }

export interface AnalyticsSettings { id: string; highLoadThreshold: number; updatedAt: string }

/** `GET /analytics/homework-load?classId=&date=` — homework already due that day for that class, across all subjects. */
export interface HomeworkLoadResult {
  classId: string
  date: string
  count: number
  items: { homeworkId: string; classSubjectId: string; subjectId: string; subjectName: string; title: string }[]
}

/** `GET /analytics/substitute-suggestions?classSubjectId=&date=&periodIdx=` — ranked candidates: free that
 * period, teaches the subject somewhere (preferred), sorted by current workload (lightest first). */
export interface SubstituteSuggestion {
  teacherId: string
  teacherName: string
  teachesSubject: boolean
  periodsPerWeek: number
}
export interface SubstituteSuggestions { timetableEntryId: string; classSubjectId: string; subjectName: string; date: string; periodIdx: number; items: SubstituteSuggestion[] }

// ─────────────────────────────────────────────────────────────
// Phase 22 — campus safety & security: authorized pickup + OTP, visitor management,
// confidential counseling + anonymous reporting, medication log & allergy alerts.
// See .agents/edunova/phase-22-campus-safety.md
// ─────────────────────────────────────────────────────────────

export interface AuthorizedPickupPerson {
  id: string
  studentId: string
  name: string
  relation: string
  phone: string
  photoFileId?: string | null
  addedById: string
  active: boolean
  createdAt: string
}

export type PickupType = 'Regular' | 'EarlyOrUnlisted'
export type PickupEventStatus = 'PendingOtp' | 'Completed' | 'Flagged'
export interface PickupEvent {
  id: string
  studentId: string
  pickedUpByName: string
  pickedUpByRelation: string
  pickupType: PickupType
  otpRequired: boolean
  approvedByOtp: boolean
  otpExpiresAt?: string | null
  otpVerifiedAt?: string | null
  status: PickupEventStatus
  recordedById: string
  recordedAt: string
}

export interface Visitor {
  id: string
  name: string
  phone: string
  purpose: string
  hostUserId?: string | null
  checkInAt: string
  checkOutAt?: string | null
  badgeNo?: string | null
  recordedById: string
}

export type CounselingCategory = 'Academic' | 'Behavioral' | 'Emotional' | 'Family' | 'Other'
export interface CounselingRecord {
  id: string
  studentId: string
  counselorId: string
  sessionDate: string
  notes: string
  category?: CounselingCategory | null
  followUpNeeded: boolean
  createdAt: string
}

export type AnonymousReportCategory = 'Bullying' | 'Safety' | 'Wellbeing' | 'Other'
export type AnonymousReportStatus = 'New' | 'Reviewing' | 'Resolved'
export interface AnonymousReport {
  id: string
  category: AnonymousReportCategory
  description: string
  submittedAt: string
  status: AnonymousReportStatus
  reviewedById?: string | null
  resolutionNotes?: string | null
}

export interface MedicationSchedule {
  id: string
  studentId: string
  medicationName: string
  dosage: string
  /** "HH:MM" administration times, e.g. ["08:00", "14:00"]. */
  times: string[]
  startDate: string
  endDate?: string | null
  notes?: string | null
  addedById: string
  createdAt: string
}

export interface MedicationLog {
  id: string
  scheduleId: string
  administeredAt: string
  administeredById: string
  notes?: string | null
}

// ─────────────────────────────────────────────────────────────
// Phase 20 — AI-powered teaching & communication: AI-generated worksheets, report-card remark drafting,
// and translation of notices/messages/remarks. See .agents/edunova/phase-20-ai-teaching-communication.md
// and server/src/modules/ai/ (extended in parallel — item 1, the syllabus-scoped tutor, is a prompt-only
// change with no new frontend surface; items 2-4 are below).
// Every AI-generated item here is a *draft only* — never saved/sent/published without an explicit
// teacher review-and-approve step; see the corresponding module components for the enforcement.
// ─────────────────────────────────────────────────────────────

/** Matches the server's `worksheetDifficulty` zod enum exactly (server/src/modules/ai/schema.ts) — lowercase. */
export type WorksheetDifficulty = 'easy' | 'medium' | 'hard'

/** `POST /ai/generate-worksheet` returns a not-yet-saved draft in this shape; `POST /ai/worksheets`
 * persists it as a `GeneratedWorksheetRec` (reusing the same title/content fields). */
export interface GeneratedWorksheetDraft {
  title: string
  content: string
}

/** A saved, previously-generated worksheet — `GET /ai/worksheets` (optionally `?classSubjectId=`). */
export interface GeneratedWorksheetRec {
  id: string
  classSubjectId: string
  chapterIds: string[]
  title: string
  content: string
  /** Set only if a PDF was generated for this worksheet — see server/src/lib/pdf.ts's certificate/payslip
   * pattern; the frontend falls back to a plain-text export of `content` when this is absent. */
  pdfFileId?: string
  createdById: string
  createdAt: string
}

/** The seven target languages `POST /ai/translate` accepts (zod-enum validated server-side). */
export const TRANSLATE_LANGUAGES = ['Hindi', 'Tamil', 'Telugu', 'Kannada', 'Marathi', 'Bengali', 'Gujarati'] as const
export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number]

// ─────────────────────────────────────────────────────────────
// Phase 23 — parent experience: a combined "all my children" view for parents with 2+ wards, who otherwise
// pick one ward at a time everywhere (see `useWard()` in src/portal/modules/viewer.ts). See
// .agents/edunova/phase-23-parent-experience.md and server/src/modules/parents/ (built in parallel).
// ─────────────────────────────────────────────────────────────

/** One ward's slice of `GET /parents/me/family-summary` — a read-only aggregation of attendance, homework,
 * fees and (once Phase 18 landed) syllabus pace, reusing each domain's existing per-domain query logic
 * rather than reimplementing it. Shape matches server/src/modules/parents/service.ts's `WardSummary`
 * exactly (live-verified against the real running server). */
export interface FamilyWardSummary {
  studentId: string
  name: string
  classId?: string
  classLabel?: string
  /** Today's whole-day attendance status; `marked` is false (status `null`) until a session is taken. */
  attendanceToday: { status: SessionStatus | string | null; marked: boolean }
  /** Homework assigned to this ward's class due this calendar week (Mon–Sun) — the full list, not just a count. */
  homeworkDueThisWeek: { id: string; title: string; subjectName: string; dueDate: string; submitted: boolean }[]
  /** Total outstanding across this ward's non-Waived invoices (any term), in rupees. */
  feeDue: { total: number; invoiceCount: number }
  /** Syllabus pace (Phase 18) for this ward's core subjects only — empty until that module has data for the ward's class. */
  syllabusPace: { classSubjectId: string; subjectId: string; subjectName: string; paceDeltaChapters: number; headline: string }[]
}

/** `GET /parents/me/family-summary` (parent-only) — one row per ward plus up to 3 upcoming calendar events
 * relevant to any ward's class, for the new Family Overview screen. */
export interface FamilySummary {
  generatedAt: string
  wards: FamilyWardSummary[]
  upcomingEvents: CalendarEventRec[]
}

// ─────────────────────────────────────────────────────────────
// Phase 27 — culture & engagement: inter-house points leaderboard + student digital portfolio.
// server/src/modules/culture/. See .agents/edunova/phase-27-culture-engagement.md.
// ─────────────────────────────────────────────────────────────

export type HousePointsSourceType = 'Sports' | 'Academic' | 'Discipline' | 'Event' | 'Manual'

/** One ledger entry — points awarded to a house (an `Activity` row with `kind: 'house'`), not an individual. */
export interface HousePointsRec {
  id: string
  houseActivityId: string
  points: number
  reason: string
  awardedById: string
  awardedAt: string
  sourceType?: HousePointsSourceType
  sourceRefId?: string
}

/** `GET /culture/house-points/leaderboard?termId=` — one row per house, ranked by summed points. */
export interface HouseLeaderboardRow {
  houseActivityId: string
  houseName: string
  points: number
  rank: number
}

/** `GET /culture/portfolio/:studentId` — an aggregated, read-only presentation of verified achievements,
 * certificates and activity history that already exist elsewhere; no new tables. Shape matches
 * server/src/modules/culture/service.ts#studentPortfolio exactly (live-verified against the running server). */
export interface PortfolioAchievementItem { id: string; title: string; detail: string; date: string; verifiedAt: string }
export interface PortfolioAchievementGroup { category: AchievementCategory; items: PortfolioAchievementItem[] }
export interface PortfolioCertificate { id: string; kind: CertificateKind; serialNo: string; issuedAt: string; pdfUrl?: string }
export interface PortfolioActivityEntry {
  id: string
  activityId: string
  kind: ActivityKind
  title: string
  status: ActivityRegStatus
  registeredAt: string
  year: number
}
export interface StudentPortfolio {
  student: { id: string; name: string }
  summary: { achievements: number; certificates: number; activities: number; years: number }
  achievements: PortfolioAchievementGroup[]
  certificates: PortfolioCertificate[]
  activityHistory: PortfolioActivityEntry[]
}

// ─────────────────────────────────────────────────────────────
// Phase 25 — Exam operations: seating plans, invigilation, hall tickets, board-exam readiness.
// See .agents/edunova/phase-25-exam-operations.md and server/src/modules/exams/{router,service,schema}.ts
// (built in parallel by the server agent — these types were adjusted to match its actual response shapes
// once it landed; see the frontend report for any mismatches vs. the spec).
// ─────────────────────────────────────────────────────────────

/** One assigned seat on a seating plan (`server/src/modules/exams/service.ts#serializeSeatingPlan`). */
export interface ExamSeat {
  id: string
  studentId: string
  studentName: string
  seatNumber: number
  assessmentId: string
  classLabel: string
  subjectName: string
}

/** `POST /exams/seating-plans` generates one of these for a room/date covering one or more assessments
 * (an exam slot can cover several assessments sharing a room/time, e.g. different electives in one hall). */
export interface ExamSeatingPlan {
  id: string
  assessmentIds: string[]
  date: string
  roomId: string
  roomName: string
  roomCapacity?: number
  generatedAt: string
  generatedById?: string
  seats: ExamSeat[]
}

export type InvigilationDutyStatus = 'Assigned' | 'Confirmed' | 'Completed'
/** `/exams/invigilation` — CRUD for manual assignment/adjustment; `POST /:id/confirm` — the assigned
 * teacher confirms. The server's `serializeDuty` returns only these bare fields (no name decorations) —
 * the frontend resolves teacher/room/assessment names itself from data it already has loaded. */
export interface InvigilationDuty {
  id: string
  assessmentId: string
  roomId: string
  teacherId: string
  date: string
  status: InvigilationDutyStatus
  createdAt: string
}

/** One row of `POST /exams/invigilation/auto-assign`'s `suggestions[]` — a teacher free that day, not
 * examining one of the exam subjects, ranked by current invigilation-duty count this term (lowest first). */
export interface InvigilationSuggestion {
  teacherId: string
  name: string
  currentDutyCount: number
}
/** The full `POST /exams/invigilation/auto-assign` response. */
export interface InvigilationSuggestions {
  date: string
  termId: string
  assessmentIds: string[]
  suggestions: InvigilationSuggestion[]
}

/** `GET /exams/board-readiness?classId=` (`server/src/modules/assessments/boardReadiness.ts`).
 * `subjectsBehind`/`subjectsTotal` are class-wide (syllabus pace is tracked per class-subject, not per
 * student) — only the score trend and registration status are genuinely per-student. */
export interface BoardReadinessRow {
  studentId: string
  name: string
  rollNo?: string | null
  avgScorePct: number | null
  trendingDown: boolean
  registrationStatus: BoardRegistrationStatus | 'NotStarted'
  needsAttention: boolean
}
export interface BoardReadinessResponse {
  classId: string
  subjectsBehind: number
  subjectsTotal: number
  students: BoardReadinessRow[]
}

/** A 409 from assessment scheduling when a class's elective papers land on the same date — every student
 * on the roster is nominally sitting both electives, so the clash is reported per elective class-subject
 * rather than per student (`server/src/modules/assessments/service.ts#checkElectiveClash`). Same
 * `{ error, conflicts[] }` convention as the timetable builder's teacher/room clashes. */
export interface AssessmentClash {
  rule: 'elective'
  assessmentId: string
  classId: string
  subjectId: string
  subjectName: string
  date: string
  affectedStudentIds: string[]
}

/* ── Phase 30 — Canteen prepaid wallet ─────────────────────────────────────
 * server/src/modules/canteen/. Wire amounts (`StudentWallet.balance`, `WalletTransaction.amount`) are
 * RUPEES (a decimal number, e.g. 50.5) — the same convention `Payment.amount`/`FeeInvoice` fields already
 * use everywhere else in this API (server stores paise internally, never on the wire — see
 * server/src/modules/canteen/schema.ts). Every top-up/purchase/refund/adjustment posts to the GL: top-up
 * debits Bank/Cash and credits "Canteen Wallet Liability" (money held, not yet revenue); a purchase debits
 * that liability account and credits Canteen Revenue. See .agents/edunova/phase-30-canteen-wallet.md */
export type WalletTxnType = 'TopUp' | 'Purchase' | 'Refund' | 'Adjustment'

/** `GET /canteen/wallets/:studentId` — one wallet per student (created on first top-up/purchase if absent). */
export interface StudentWallet {
  id: string
  studentId: string
  balance: number
  createdAt: string
  updatedAt: string
}

/** One row of a wallet's ledger — `amount` is signed (positive for TopUp/Refund, negative for Purchase),
 * so balance is always the running sum, matching the ledger-not-mutable-total pattern used elsewhere.
 * `runningBalance` is present only on `GET /canteen/wallets/:studentId/transactions` rows. */
export interface WalletTransaction {
  id: string
  walletId: string
  type: WalletTxnType
  amount: number
  reason?: string | null
  itemsSummary?: string | null
  recordedById?: string
  occurredAt: string
  runningBalance?: number
}

/** `GET /canteen/wallets/:studentId` — current balance plus up to 10 recent transactions. For plain
 * `staff` (canteen counter — indistinguishable from other staff, same role-granularity limitation as
 * gate-security in Phase 22) `recent` is always empty: a counter staffer sees the balance before a sale,
 * not a family's spend history — that's what the transactions endpoint below is for. */
export interface WalletSummary {
  studentId: string
  balance: number
  recent: WalletTransaction[]
}

/** `GET /canteen/wallets/:studentId/transactions?from=&to=` — the full, dated, itemized spend log (self/
 * guardian, staff/admin only). Newest first; each row's `runningBalance` is the true wallet balance at
 * that moment (computed over the whole ledger, not just the filtered window). */
export interface WalletTransactionsResponse {
  studentId: string
  balance: number
  items: WalletTransaction[]
}

/** `POST /canteen/wallets/:studentId/topup` and `/purchase` responses. */
export interface WalletMutationResult {
  wallet: StudentWallet
  transaction: WalletTransaction
}

/** `GET /canteen/reconciliation` — admin/superadmin only (item 4/6): sum of every wallet's balance should
 * always equal the Canteen Wallet Liability GL account's balance. */
export interface CanteenReconciliation {
  walletCount: number
  sumWalletBalances: number
  glLiabilityBalance: number
  reconciled: boolean
}
