import React, { createContext, useContext, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  AlertTriangle, Award, Banknote, BarChart3, BedDouble, BookMarked, BookOpen, Boxes, BrainCircuit, Bus, Calculator, CalendarClock, CalendarDays, CalendarPlus, CalendarRange, ClipboardCheck, ClipboardList, Clock3,
  CloudUpload, CreditCard, DoorOpen, FileBadge, FileBarChart2, FileWarning, FolderCog, Gavel, GraduationCap, Handshake, HeartHandshake, HeartPulse, Home, IdCard, KeyRound, Landmark, LayoutGrid, Layers,
  LogOut, Megaphone, MessageCircleWarning, MessageSquare, MessagesSquare, Network, NotebookPen, PartyPopper, PencilLine, PillBottle, Play, Route as RouteIcon, School, ScrollText, Settings, ShoppingCart, Shuffle,
  Scale, ShieldAlert, ShieldCheck, Sparkles, Star, Target, Trophy, Truck, UserCheck, UserCircle2, Umbrella, Undo2, Users, Users2, Video, Wallet, Wand2, type LucideIcon,
} from 'lucide-react'
import { Logo } from '@/components/Logo'
import { api, errorMessage } from '@/lib/api'
import { canManage, isSuperAdmin } from '@/lib/access'
import { useAcademic, useStore } from '@/lib/store'
import { ThemeToggle } from '@/lib/theme'
import { InstallButton } from '@/lib/pwa'
import type { Role, User } from '@/lib/data'
import { Avatar, Card, Empty, Field, Modal, PageHead, Pill, inputCls } from './ui'
import { ProfileMod } from './modules/profile'
import { useApplications, useFileUrl } from '@/lib/hooks/useIdentity'
import { AttendanceMod, CalendarMod, MarksMod, RanksMod, TeachersMod } from './modules/academics'
import { todayAgenda, useClock, useEntryLookup, useMyTimetable } from '@/lib/hooks/useTimetable'
import { homeworkStatus, isOpen, useAttendanceSummary, useHomework, useReportCard } from '@/lib/hooks/useAcademics'
import { TimetableMod } from './modules/timetable'
import { TimetableBuilderMod } from './modules/timetableBuilder'
import { AIDoubtsMod, FeedMod, HighlightsMod, MessagesMod, NotificationBell } from './modules/social'
import { AchievementsMod, HealthMod, HomeworkMod, LeaveMod, MedicationMod, SlipsMod, WorkUploadMod } from './modules/actions'
import {
  ActivitiesAdminMod, ApplicationsMod, AttendanceMgmtMod, CalendarAdminMod, CreateAssignmentMod,
  BoardRegistrationMod, GradebookMod, PeopleMod, RegistrationsMod, TakeAttendanceMod, VerificationsMod,
} from './modules/office'
import { useSlips, useDisciplinaryCases } from '@/lib/hooks/useWelfare'
import { useCalendarEvents } from '@/lib/hooks/useComms'
import { MeetingsMod } from './modules/meetings'
import { FeeDefaultersAndCallsMod } from './modules/feeDefaulters'
import { DisciplinaryCommitteeMod } from './modules/disciplinary'
import { PaymentGatewayMod } from './modules/paymentGateway'
import { CollectionsMod, FeeSetupMod, MyPayslipsMod, PayrollMod } from './modules/finance'
import { ContractsResignationsAdminMod, DutiesMod, LeaveApprovalsMod, LeaveTypesMod, MyContractMod, MyLeaveMod } from './modules/hr'
import { useLeaveRequests, useResignations } from '@/lib/hooks/useHr'
import { useDefaulters, useInvoices } from '@/lib/hooks/useFinance'
import { StudentReportMod } from './modules/studentReport'
import { AcademicYearsMod, BoardsMod, ClassesMod, CurriculumMod, PeriodsMod, RoomsMod } from './modules/academic'
import { WorkingDaysMod } from './modules/schoolConfig'
import { AdmissionCatalogsMod, DocumentRecordsReportMod } from './modules/documents'
import { EligibilityExceptionsReportMod, PerformanceBandsMod, SectioningTemplatesMod, TrackEligibilityMod, TrackRegistrationsMod } from './modules/sectioning'
import { SettingsMod } from './modules/settings'
import { firstName } from './modules/viewer'
import { MyTeamMod, MyReviewsMod, TeamReviewsMod, StaffConductMod } from './modules/employee'
import { MyBusMod, TransportMod } from './modules/transport'
import { AlumniMod } from './modules/alumni'
import { HostelMod, MyHostelMod } from './modules/hostel'
import { HostelOutpassMod, HostelRollCallMod, MessMenuMod, MyMessMod, MyOutpassMod } from './modules/hostelExtras'
import { LibraryCatalogMod, LibraryIssueReturnsMod, LibrarySettingsMod, MyLoansMod } from './modules/library'
import { InventoryCatalogMod, PurchaseOrdersMod, VendorsMod } from './modules/inventory'
import { AccountingReportsMod, ChartOfAccountsMod, JournalMod } from './modules/accounting'
import { TeachingProgressMod, SyllabusOverviewMod } from './modules/syllabus'
import { StudentsAtRiskMod, LostInstructionalTimeMod } from './modules/analytics'
import { ScholarshipsMod } from './modules/scholarships'
import { ReportCardRemarksMod, WorksheetGeneratorMod } from './modules/aiTools'
import { AuthorizedPickupMod, PickupDeskMod, VisitorDeskMod } from './modules/safety'
import { CounselingRecordsMod, ConcernReviewQueueMod, ReportConcernMod } from './modules/counseling'
import { FamilyOverviewMod } from './modules/familyOverview'
import { SeatingPlanMod, InvigilationRosterMod } from './modules/exams'
import { LeaderboardMod, PortfolioMod } from './modules/culture'
import { GroupMod } from './modules/group'
import { useGroupMemberships } from '@/lib/hooks/useGroup'
import { UdiseExportMod } from './modules/compliance'
import { CanteenPOSMod, CanteenReconciliationMod, CanteenWalletMod, MyWalletMod } from './modules/canteen'
import { toast } from 'sonner'

/* ── term context ──────────────────────────────────────── */

const TermCtx = createContext<{ term: string; setTerm: (t: string) => void }>({ term: '', setTerm: () => {} })
// eslint-disable-next-line react-refresh/only-export-components
export const useTerm = () => useContext(TermCtx)

/* ── module registry ───────────────────────────────────── */

interface Mod { id: string; label: string; icon: LucideIcon; el: React.ReactNode; group: string }

function modulesFor(role: Role, onNavigate: (id: string) => void): Mod[] {
  const M = (id: string, label: string, icon: LucideIcon, el: React.ReactNode, group: string): Mod => ({ id, label, icon, el, group })
  switch (role) {
    case 'parent': return [
      M('home', 'Overview', Home, <Overview />, 'Main'),
      M('family', 'Family Overview', Users2, <FamilyOverviewMod onNavigate={onNavigate} />, 'Main'),
      M('tt', 'Timetable', CalendarDays, <TimetableMod />, 'Academics'),
      M('att', 'Attendance', ClipboardCheck, <AttendanceMod />, 'Academics'),
      M('marks', 'Marks & Grades', PencilLine, <MarksMod />, 'Academics'),
      M('ranks', 'Rank List', Trophy, <RanksMod />, 'Academics'),
      M('cal', 'Calendar', CalendarPlus, <CalendarMod />, 'Academics'),
      M('teachers', 'Teachers', Users, <TeachersMod />, 'Academics'),
      M('report', 'Student Report', FileBadge, <StudentReportsMod />, 'Academics'),
      M('feed', 'School Feed', Megaphone, <FeedMod />, 'Community'),
      M('msgs', 'Messages', MessagesSquare, <MessagesMod />, 'Community'),
      M('meet', 'Meetings', Video, <MeetingsMod />, 'Community'),
      M('hl', 'Event Highlights', Play, <HighlightsMod />, 'Community'),
      M('leaderboard', 'House Leaderboard', Trophy, <LeaderboardMod />, 'Community'),
      M('portfolio', 'My Portfolio', IdCard, <PortfolioMod />, 'Community'),
      M('hw', 'Homework Status', BookOpen, <HomeworkMod />, 'Actions'),
      M('work', 'Work Upload', CloudUpload, <WorkUploadMod />, 'Actions'),
      M('slips', 'Permission Slips', ShieldCheck, <SlipsMod />, 'Actions'),
      M('leave', 'Holiday Requests', Umbrella, <LeaveMod />, 'Actions'),
      M('health', 'Health Records', HeartPulse, <HealthMod />, 'Actions'),
      M('meds', 'Medication Log', PillBottle, <MedicationMod />, 'Actions'),
      M('ach', 'Achievements', Award, <AchievementsMod />, 'Actions'),
      M('bus', 'My Bus', Bus, <MyBusMod />, 'Actions'),
      M('myhostel', 'My Hostel', BedDouble, <MyHostelMod />, 'Actions'),
      M('myoutpass', 'My Outpass', DoorOpen, <MyOutpassMod />, 'Actions'),
      M('mymess', 'My Mess', ClipboardList, <MyMessMod />, 'Actions'),
      M('library', 'Library', BookMarked, <LibraryCatalogMod />, 'Actions'),
      M('myloans', 'My Loans', BookOpen, <MyLoansMod />, 'Actions'),
      M('pickups', 'Authorized Pickup', KeyRound, <AuthorizedPickupMod />, 'Actions'),
      M('pay', 'Payments', CreditCard, <PaymentGatewayMod />, 'Office'),
      M('canteen', 'Canteen Wallet', Wallet, <CanteenWalletMod />, 'Office'),
      M('apps', 'TC & Bonafide', FileBadge, <ApplicationsMod approver={false} />, 'Office'),
      M('msheet', 'Board Registration', School, <BoardRegistrationMod />, 'Office'),
      M('disc', 'Discipline', Gavel, <DisciplinaryCommitteeMod />, 'Office'),
      M('concern', 'Report a Concern', MessageCircleWarning, <ReportConcernMod />, 'Office'),
      M('profile', 'Profile', UserCircle2, <ProfileMod />, 'Account'),
    ]
    case 'student': return [
      M('home', 'Overview', Home, <Overview />, 'Main'),
      M('tt', 'Timetable', CalendarDays, <TimetableMod />, 'Academics'),
      M('att', 'Attendance', ClipboardCheck, <AttendanceMod />, 'Academics'),
      M('marks', 'Marks & Grades', PencilLine, <MarksMod />, 'Academics'),
      M('ranks', 'Rank List', Trophy, <RanksMod />, 'Academics'),
      M('cal', 'Calendar', CalendarPlus, <CalendarMod />, 'Academics'),
      M('hw', 'Homework Upload', BookOpen, <HomeworkMod uploader />, 'Academics'),
      M('work', 'Work Upload', CloudUpload, <WorkUploadMod />, 'Academics'),
      M('ai', 'AI Doubt Clearing', BrainCircuit, <AIDoubtsMod />, 'Academics'),
      M('report', 'My Report', FileBadge, <StudentReportsMod />, 'Academics'),
      M('feed', 'School Feed', Megaphone, <FeedMod />, 'Community'),
      M('msgs', 'Messages', MessagesSquare, <MessagesMod />, 'Community'),
      M('meet', 'Meetings', Video, <MeetingsMod />, 'Community'),
      M('hl', 'Event Highlights', Play, <HighlightsMod />, 'Community'),
      M('leaderboard', 'House Leaderboard', Trophy, <LeaderboardMod />, 'Community'),
      M('portfolio', 'My Portfolio', IdCard, <PortfolioMod />, 'Community'),
      M('ffcs', 'Clubs & Chapters', Users, <RegistrationsMod kind="club" title="Clubs & Chapters (FFCS)" sub="Fully flexible club selection — pick what moves you" />, 'Activities'),
      M('iha', 'Inter-House (IHA)', PartyPopper, <RegistrationsMod kind="house" title="Inter-House Activities" sub="Represent your house this term" />, 'Activities'),
      M('exc', 'Extra-Curricular (EXC)', Sparkles, <RegistrationsMod kind="exc" title="EXC Registrations" sub="Weekend extra-curricular coaching" />, 'Activities'),
      M('events', 'Event Registration', Play, <RegistrationsMod kind="event" title="Event Registration" sub="Sign up for upcoming school events" />, 'Activities'),
      M('trackreg', 'Track & Stream Registration', RouteIcon, <TrackRegistrationsMod />, 'Actions'),
      M('health', 'Health Records', HeartPulse, <HealthMod />, 'Actions'),
      M('meds', 'Medication Log', PillBottle, <MedicationMod />, 'Actions'),
      M('ach', 'Achievements', Award, <AchievementsMod />, 'Actions'),
      M('bus', 'My Bus', Bus, <MyBusMod />, 'Actions'),
      M('myhostel', 'My Hostel', BedDouble, <MyHostelMod />, 'Actions'),
      M('myoutpass', 'My Outpass', DoorOpen, <MyOutpassMod />, 'Actions'),
      M('mymess', 'My Mess', ClipboardList, <MyMessMod />, 'Actions'),
      M('library', 'Library', BookMarked, <LibraryCatalogMod />, 'Actions'),
      M('myloans', 'My Loans', BookOpen, <MyLoansMod />, 'Actions'),
      M('disc', 'Discipline', Gavel, <DisciplinaryCommitteeMod />, 'Office'),
      M('pay', 'Fee Payments', CreditCard, <PaymentGatewayMod />, 'Office'),
      M('canteen', 'Canteen Wallet', Wallet, <MyWalletMod />, 'Office'),
      M('apps', 'Applications', FileBadge, <ApplicationsMod approver={false} />, 'Office'),
      M('concern', 'Report a Concern', MessageCircleWarning, <ReportConcernMod />, 'Office'),
      M('profile', 'Profile', UserCircle2, <ProfileMod />, 'Account'),
    ]
    case 'teacher': return [
      M('home', 'Overview', Home, <Overview />, 'Main'),
      M('take', 'Take Attendance', ClipboardCheck, <TakeAttendanceMod />, 'Classroom'),
      M('assign', 'Create Assignment', BookOpen, <CreateAssignmentMod />, 'Classroom'),
      M('grades', 'Gradebook', PencilLine, <GradebookMod />, 'Classroom'),
      M('leaderboard', 'House Leaderboard', Trophy, <LeaderboardMod />, 'Classroom'),
      M('syllabus', 'Teaching Progress', BookMarked, <TeachingProgressMod />, 'Classroom'),
      M('atrisk', 'Students at Risk', ShieldAlert, <StudentsAtRiskMod />, 'Classroom'),
      M('worksheets', 'AI Worksheets', Wand2, <WorksheetGeneratorMod />, 'Classroom'),
      M('remarks', 'Report Card Remarks', MessageSquare, <ReportCardRemarksMod />, 'Classroom'),
      M('tt', 'My Timetable', CalendarDays, <TimetableMod />, 'Classroom'),
      M('feed', 'School Feed', Megaphone, <FeedMod />, 'Classroom'),
      M('msgs', 'Messages', MessagesSquare, <MessagesMod />, 'Classroom'),
      M('meet', 'Meetings', Video, <MeetingsMod />, 'Classroom'),
      M('hl', 'Event Highlights', Play, <HighlightsMod />, 'Classroom'),
      M('slips', 'Permission Slips', ShieldCheck, <SlipsMod />, 'Classroom'),
      M('health', 'Health Records', HeartPulse, <HealthMod />, 'Classroom'),
      M('lapprove', 'Leave Approvals', Umbrella, <LeaveApprovalsMod />, 'Classroom'),
      M('msheet', 'Board Registration', School, <BoardRegistrationMod />, 'Classroom'),
      M('defaulters', 'Fee Defaulters', Banknote, <FeeDefaultersAndCallsMod />, 'Classroom'),
      M('disc', 'Discipline', Gavel, <DisciplinaryCommitteeMod />, 'Classroom'),
      M('reports', 'Student Reports', FileBadge, <StudentReportsMod />, 'Classroom'),
      M('library', 'Library', BookMarked, <LibraryCatalogMod />, 'Classroom'),
      M('myloans', 'My Loans', BookOpen, <MyLoansMod />, 'Classroom'),
      M('inv', 'Inventory', Boxes, <InventoryCatalogMod />, 'Classroom'),
      M('salary', 'My Payslips', Wallet, <MyPayslipsMod />, 'My HR'),
      M('myleave', 'My Leave', Umbrella, <MyLeaveMod />, 'My HR'),
      M('contract', 'My Contract', ScrollText, <MyContractMod />, 'My HR'),
      M('work', 'Event Duties', PartyPopper, <DutiesMod />, 'My HR'),
      M('freg', 'Faculty Events', Play, <RegistrationsMod kind="faculty" title="Faculty Event Registration" sub="Workshops and panels for teachers" />, 'My HR'),
      M('ach', 'My Achievements', Award, <AchievementsMod />, 'My HR'),
      M('myteam', 'My Team', Users, <MyTeamMod />, 'My HR'),
      M('myreviews', 'My Reviews', Star, <MyReviewsMod />, 'My HR'),
      M('teamreviews', 'Team Reviews', ClipboardList, <TeamReviewsMod />, 'My HR'),
      M('profile', 'Profile', UserCircle2, <ProfileMod />, 'Account'),
    ]
    case 'staff': return [
      M('home', 'Overview', Home, <Overview />, 'Main'),
      M('attm', 'Attendance Mgmt', ClipboardCheck, <AttendanceMgmtMod />, 'Operations'),
      M('syllabusov', 'Syllabus Overview', BookMarked, <SyllabusOverviewMod />, 'Operations'),
      M('atrisk', 'Students at Risk', ShieldAlert, <StudentsAtRiskMod />, 'Operations'),
      M('losttime', 'Lost Instructional Time', FileBarChart2, <LostInstructionalTimeMod />, 'Operations'),
      M('leaderboard', 'House Leaderboard', Trophy, <LeaderboardMod />, 'Operations'),
      M('seating', 'Exam Seating Plans', ClipboardCheck, <SeatingPlanMod />, 'Operations'),
      M('invigroster', 'Invigilation Roster', Users2, <InvigilationRosterMod />, 'Operations'),
      M('worksheets', 'AI Worksheets', Wand2, <WorksheetGeneratorMod />, 'Operations'),
      M('remarks', 'Report Card Remarks', MessageSquare, <ReportCardRemarksMod />, 'Operations'),
      M('pickupdesk', 'Pickup Desk', KeyRound, <PickupDeskMod />, 'Operations'),
      M('visitordesk', 'Visitor Desk', UserCheck, <VisitorDeskMod />, 'Operations'),
      M('canteenpos', 'Canteen POS', ShoppingCart, <CanteenPOSMod />, 'Operations'),
      M('tt', 'Timetable', CalendarDays, <TimetableMod />, 'Operations'),
      M('people', 'People', Users, <PeopleMod />, 'Operations'),
      M('apps', 'Admissions & Certs', FileBadge, <ApplicationsMod />, 'Operations'),
      M('admissioncat', 'Admission Catalogs', FolderCog, <AdmissionCatalogsMod />, 'Operations'),
      M('docrecords', 'Held Documents', ClipboardList, <DocumentRecordsReportMod />, 'Operations'),
      M('trackexceptions', 'Eligibility Exceptions', FileWarning, <EligibilityExceptionsReportMod />, 'Operations'),
      M('verify', 'Verifications', ShieldCheck, <VerificationsMod />, 'Operations'),
      M('leaves', 'Leave Approvals', Umbrella, <LeaveApprovalsMod />, 'Operations'),
      M('calm', 'Calendar Mgmt', CalendarPlus, <CalendarAdminMod />, 'Operations'),
      M('work', 'Work Assignment', PartyPopper, <DutiesMod manage />, 'Operations'),
      M('actadmin', 'Activities Admin', Sparkles, <ActivitiesAdminMod />, 'Operations'),
      M('transport', 'Transport', Bus, <TransportMod />, 'Operations'),
      M('hostel', 'Hostel', BedDouble, <HostelMod />, 'Operations'),
      M('hostelout', 'Hostel Outpass', DoorOpen, <HostelOutpassMod />, 'Operations'),
      M('hostelroll', 'Hostel Roll-call', ClipboardList, <HostelRollCallMod />, 'Operations'),
      M('hostelmess', 'Mess Menu', ClipboardList, <MessMenuMod />, 'Operations'),
      M('library', 'Library', BookMarked, <LibraryCatalogMod />, 'Operations'),
      M('libissue', 'Issue & Returns', Undo2, <LibraryIssueReturnsMod />, 'Operations'),
      M('myloans', 'My Loans', BookOpen, <MyLoansMod />, 'Operations'),
      M('inv', 'Inventory', Boxes, <InventoryCatalogMod />, 'Operations'),
      M('po', 'Purchase Orders', ShoppingCart, <PurchaseOrdersMod />, 'Operations'),
      M('vendors', 'Vendors', Truck, <VendorsMod />, 'Operations'),
      M('feed', 'School Feed', Megaphone, <FeedMod />, 'Operations'),
      M('msgs', 'Messages', MessagesSquare, <MessagesMod />, 'Operations'),
      M('hl', 'Event Highlights', Play, <HighlightsMod />, 'Operations'),
      M('slips', 'Permission Slips', ShieldCheck, <SlipsMod />, 'Operations'),
      M('health', 'Health Records', HeartPulse, <HealthMod />, 'Operations'),
      M('meds', 'Medication Log', PillBottle, <MedicationMod />, 'Operations'),
      M('ach', 'Achievements', Award, <AchievementsMod />, 'Operations'),
      M('msheet', 'Board Registration', School, <BoardRegistrationMod />, 'Operations'),
      M('defaulters', 'Fee Defaulters', Banknote, <FeeDefaultersAndCallsMod />, 'Operations'),
      M('disc', 'Discipline', Gavel, <DisciplinaryCommitteeMod />, 'Operations'),
      M('reports', 'Student Reports', FileBadge, <StudentReportsMod />, 'Operations'),
      M('meet', 'Meetings', Video, <MeetingsMod />, 'Operations'),
      M('fees', 'Fee Setup', CreditCard, <FeeSetupMod />, 'Finance'),
      M('collect', 'Collections', Landmark, <CollectionsMod />, 'Finance'),
      M('scholarships', 'Scholarships', Award, <ScholarshipsMod />, 'Finance'),
      M('salary', 'My Payslips', ScrollText, <MyPayslipsMod />, 'Finance'),
      M('myteam', 'My Team', Users, <MyTeamMod />, 'My HR'),
      M('myreviews', 'My Reviews', Star, <MyReviewsMod />, 'My HR'),
      M('teamreviews', 'Team Reviews', ClipboardList, <TeamReviewsMod />, 'My HR'),
      M('alumni', 'Alumni', Handshake, <AlumniMod />, 'Alumni'),
      M('profile', 'Profile', UserCircle2, <ProfileMod />, 'Account'),
    ]
    case 'admin': return [
      M('home', 'Overview', Home, <Overview />, 'Main'),
      M('years', 'Years & Terms', CalendarRange, <AcademicYearsMod />, 'Academic Setup'),
      M('boards', 'Boards & Grades', Layers, <BoardsMod />, 'Academic Setup'),
      M('curriculum', 'Curriculum', BookMarked, <CurriculumMod />, 'Academic Setup'),
      M('syllabusov', 'Syllabus Overview', BookMarked, <SyllabusOverviewMod />, 'Academic Setup'),
      M('classes', 'Classes & Sections', GraduationCap, <ClassesMod />, 'Academic Setup'),
      M('ttb', 'Timetable Builder', CalendarDays, <TimetableBuilderMod />, 'Academic Setup'),
      M('tt', 'Timetable', CalendarDays, <TimetableMod />, 'Academic Setup'),
      M('rooms', 'Rooms', DoorOpen, <RoomsMod />, 'Academic Setup'),
      M('periods', 'Periods', Clock3, <PeriodsMod />, 'Academic Setup'),
      M('bands', 'Performance Bands', BarChart3, <PerformanceBandsMod />, 'Academic Setup'),
      M('sectemplates', 'Sectioning Templates', Shuffle, <SectioningTemplatesMod />, 'Academic Setup'),
      M('tracks', 'Track Eligibility', Target, <TrackEligibilityMod />, 'Academic Setup'),
      M('people', 'People & Roles', Users, <PeopleMod />, 'Manage'),
      M('apps', 'Admissions & Certs', FileBadge, <ApplicationsMod />, 'Manage'),
      M('admissioncat', 'Admission Catalogs', FolderCog, <AdmissionCatalogsMod />, 'Manage'),
      M('docrecords', 'Held Documents', ClipboardList, <DocumentRecordsReportMod />, 'Manage'),
      M('trackexceptions', 'Eligibility Exceptions', FileWarning, <EligibilityExceptionsReportMod />, 'Manage'),
      M('verify', 'Verifications', ShieldCheck, <VerificationsMod />, 'Manage'),
      M('attm', 'Attendance', ClipboardCheck, <AttendanceMgmtMod />, 'Manage'),
      M('pickupdesk', 'Pickup Desk', KeyRound, <PickupDeskMod />, 'Manage'),
      M('visitordesk', 'Visitor Desk', UserCheck, <VisitorDeskMod />, 'Manage'),
      M('concernqueue', 'Concern Review', AlertTriangle, <ConcernReviewQueueMod />, 'Manage'),
      M('atrisk', 'Students at Risk', ShieldAlert, <StudentsAtRiskMod />, 'Manage'),
      M('losttime', 'Lost Instructional Time', FileBarChart2, <LostInstructionalTimeMod />, 'Manage'),
      M('leaderboard', 'House Leaderboard', Trophy, <LeaderboardMod />, 'Manage'),
      M('seating', 'Exam Seating Plans', ClipboardCheck, <SeatingPlanMod />, 'Manage'),
      M('invigroster', 'Invigilation Roster', Users2, <InvigilationRosterMod />, 'Manage'),
      M('worksheets', 'AI Worksheets', Wand2, <WorksheetGeneratorMod />, 'Manage'),
      M('remarks', 'Report Card Remarks', MessageSquare, <ReportCardRemarksMod />, 'Manage'),
      M('leavetypes', 'Leave Types', Umbrella, <LeaveTypesMod />, 'Manage'),
      M('leaves', 'Leave Approvals', Umbrella, <LeaveApprovalsMod />, 'Manage'),
      M('calm', 'Calendar', CalendarPlus, <CalendarAdminMod />, 'Manage'),
      M('work', 'Work Assignment', PartyPopper, <DutiesMod manage />, 'Manage'),
      M('actadmin', 'Activities Admin', Sparkles, <ActivitiesAdminMod />, 'Manage'),
      M('transport', 'Transport', Bus, <TransportMod />, 'Manage'),
      M('hostel', 'Hostel', BedDouble, <HostelMod />, 'Manage'),
      M('hostelout', 'Hostel Outpass', DoorOpen, <HostelOutpassMod />, 'Manage'),
      M('hostelroll', 'Hostel Roll-call', ClipboardList, <HostelRollCallMod />, 'Manage'),
      M('hostelmess', 'Mess Menu', ClipboardList, <MessMenuMod />, 'Manage'),
      M('library', 'Library', BookMarked, <LibraryCatalogMod />, 'Manage'),
      M('libissue', 'Issue & Returns', Undo2, <LibraryIssueReturnsMod />, 'Manage'),
      M('myloans', 'My Loans', BookOpen, <MyLoansMod />, 'Manage'),
      M('inv', 'Inventory', Boxes, <InventoryCatalogMod />, 'Manage'),
      M('po', 'Purchase Orders', ShoppingCart, <PurchaseOrdersMod />, 'Manage'),
      M('vendors', 'Vendors', Truck, <VendorsMod />, 'Manage'),
      M('feed', 'School Feed', Megaphone, <FeedMod />, 'Manage'),
      M('msgs', 'Messages', MessagesSquare, <MessagesMod />, 'Manage'),
      M('hl', 'Event Highlights', Play, <HighlightsMod />, 'Manage'),
      M('slips', 'Permission Slips', ShieldCheck, <SlipsMod />, 'Manage'),
      M('health', 'Health Records', HeartPulse, <HealthMod />, 'Manage'),
      M('meds', 'Medication Log', PillBottle, <MedicationMod />, 'Manage'),
      M('ach', 'Achievements', Award, <AchievementsMod />, 'Manage'),
      M('msheet', 'Board Registration', School, <BoardRegistrationMod />, 'Manage'),
      M('contracts', 'Contracts & Exit', ScrollText, <ContractsResignationsAdminMod />, 'Manage'),
      M('myteam', 'My Team', Users, <MyTeamMod />, 'Manage'),
      M('myreviews', 'My Reviews', Star, <MyReviewsMod />, 'Manage'),
      M('teamreviews', 'Team Reviews', ClipboardList, <TeamReviewsMod />, 'Manage'),
      M('staffconduct', 'Staff Conduct', ShieldAlert, <StaffConductMod />, 'Manage'),
      M('alumni', 'Alumni', Handshake, <AlumniMod />, 'Alumni'),
      M('reports', 'Student Reports', FileBadge, <StudentReportsMod />, 'Manage'),
      M('defaulters', 'Fee Defaulters', Banknote, <FeeDefaultersAndCallsMod />, 'Finance'),
      M('disc', 'Discipline', Gavel, <DisciplinaryCommitteeMod />, 'Finance'),
      M('meet', 'Meetings', Video, <MeetingsMod />, 'Finance'),
      M('fees', 'Fee Setup', CreditCard, <FeeSetupMod />, 'Finance'),
      M('collect', 'Collections', Landmark, <CollectionsMod />, 'Finance'),
      M('scholarships', 'Scholarships', Award, <ScholarshipsMod />, 'Finance'),
      M('payroll', 'Payroll', Wallet, <PayrollMod />, 'Finance'),
      M('coa', 'Chart of Accounts', Calculator, <ChartOfAccountsMod />, 'Finance'),
      M('journal', 'Journal', NotebookPen, <JournalMod />, 'Finance'),
      M('acctreports', 'Accounting Reports', FileBarChart2, <AccountingReportsMod />, 'Finance'),
      M('canteenrecon', 'Canteen Reconciliation', Scale, <CanteenReconciliationMod />, 'Finance'),
      M('workingdays', 'Working Days & Periods', CalendarClock, <WorkingDaysMod />, 'System'),
      M('libsettings', 'Library Settings', BookMarked, <LibrarySettingsMod />, 'System'),
      M('udise', 'UDISE+ Export', FileBarChart2, <UdiseExportMod />, 'System'),
      M('settings', 'Settings', Settings, <SettingsMod />, 'System'),
      M('profile', 'Profile', UserCircle2, <ProfileMod />, 'Account'),
    ]
    case 'superadmin': return [
      M('home', 'Overview', Home, <Overview />, 'Main'),
      M('years', 'Years & Terms', CalendarRange, <AcademicYearsMod />, 'Academic Setup'),
      M('boards', 'Boards & Grades', Layers, <BoardsMod />, 'Academic Setup'),
      M('curriculum', 'Curriculum', BookMarked, <CurriculumMod />, 'Academic Setup'),
      M('syllabusov', 'Syllabus Overview', BookMarked, <SyllabusOverviewMod />, 'Academic Setup'),
      M('classes', 'Classes & Sections', GraduationCap, <ClassesMod />, 'Academic Setup'),
      M('ttb', 'Timetable Builder', CalendarDays, <TimetableBuilderMod />, 'Academic Setup'),
      M('tt', 'Timetable', CalendarDays, <TimetableMod />, 'Academic Setup'),
      M('rooms', 'Rooms', DoorOpen, <RoomsMod />, 'Academic Setup'),
      M('periods', 'Periods', Clock3, <PeriodsMod />, 'Academic Setup'),
      M('bands', 'Performance Bands', BarChart3, <PerformanceBandsMod />, 'Academic Setup'),
      M('sectemplates', 'Sectioning Templates', Shuffle, <SectioningTemplatesMod />, 'Academic Setup'),
      M('tracks', 'Track Eligibility', Target, <TrackEligibilityMod />, 'Academic Setup'),
      M('people', 'People & Roles', Users, <PeopleMod />, 'Manage'),
      M('admins', 'Admin Management', ShieldCheck, <AdminManagementMod />, 'Manage'),
      M('apps', 'Admissions & Certs', FileBadge, <ApplicationsMod />, 'Manage'),
      M('admissioncat', 'Admission Catalogs', FolderCog, <AdmissionCatalogsMod />, 'Manage'),
      M('docrecords', 'Held Documents', ClipboardList, <DocumentRecordsReportMod />, 'Manage'),
      M('trackexceptions', 'Eligibility Exceptions', FileWarning, <EligibilityExceptionsReportMod />, 'Manage'),
      M('verify', 'Verifications', ShieldCheck, <VerificationsMod />, 'Manage'),
      M('attm', 'Attendance', ClipboardCheck, <AttendanceMgmtMod />, 'Manage'),
      M('pickupdesk', 'Pickup Desk', KeyRound, <PickupDeskMod />, 'Manage'),
      M('visitordesk', 'Visitor Desk', UserCheck, <VisitorDeskMod />, 'Manage'),
      M('concernqueue', 'Concern Review', AlertTriangle, <ConcernReviewQueueMod />, 'Manage'),
      M('atrisk', 'Students at Risk', ShieldAlert, <StudentsAtRiskMod />, 'Manage'),
      M('losttime', 'Lost Instructional Time', FileBarChart2, <LostInstructionalTimeMod />, 'Manage'),
      M('leaderboard', 'House Leaderboard', Trophy, <LeaderboardMod />, 'Manage'),
      M('seating', 'Exam Seating Plans', ClipboardCheck, <SeatingPlanMod />, 'Manage'),
      M('invigroster', 'Invigilation Roster', Users2, <InvigilationRosterMod />, 'Manage'),
      M('worksheets', 'AI Worksheets', Wand2, <WorksheetGeneratorMod />, 'Manage'),
      M('remarks', 'Report Card Remarks', MessageSquare, <ReportCardRemarksMod />, 'Manage'),
      M('leavetypes', 'Leave Types', Umbrella, <LeaveTypesMod />, 'Manage'),
      M('leaves', 'Leave Approvals', Umbrella, <LeaveApprovalsMod />, 'Manage'),
      M('calm', 'Calendar', CalendarPlus, <CalendarAdminMod />, 'Manage'),
      M('work', 'Work Assignment', PartyPopper, <DutiesMod manage />, 'Manage'),
      M('actadmin', 'Activities Admin', Sparkles, <ActivitiesAdminMod />, 'Manage'),
      M('transport', 'Transport', Bus, <TransportMod />, 'Manage'),
      M('hostel', 'Hostel', BedDouble, <HostelMod />, 'Manage'),
      M('hostelout', 'Hostel Outpass', DoorOpen, <HostelOutpassMod />, 'Manage'),
      M('hostelroll', 'Hostel Roll-call', ClipboardList, <HostelRollCallMod />, 'Manage'),
      M('hostelmess', 'Mess Menu', ClipboardList, <MessMenuMod />, 'Manage'),
      M('library', 'Library', BookMarked, <LibraryCatalogMod />, 'Manage'),
      M('libissue', 'Issue & Returns', Undo2, <LibraryIssueReturnsMod />, 'Manage'),
      M('myloans', 'My Loans', BookOpen, <MyLoansMod />, 'Manage'),
      M('inv', 'Inventory', Boxes, <InventoryCatalogMod />, 'Manage'),
      M('po', 'Purchase Orders', ShoppingCart, <PurchaseOrdersMod />, 'Manage'),
      M('vendors', 'Vendors', Truck, <VendorsMod />, 'Manage'),
      M('feed', 'School Feed', Megaphone, <FeedMod />, 'Manage'),
      M('msgs', 'Messages', MessagesSquare, <MessagesMod />, 'Manage'),
      M('hl', 'Event Highlights', Play, <HighlightsMod />, 'Manage'),
      M('slips', 'Permission Slips', ShieldCheck, <SlipsMod />, 'Manage'),
      M('health', 'Health Records', HeartPulse, <HealthMod />, 'Manage'),
      M('meds', 'Medication Log', PillBottle, <MedicationMod />, 'Manage'),
      M('ach', 'Achievements', Award, <AchievementsMod />, 'Manage'),
      M('msheet', 'Board Registration', School, <BoardRegistrationMod />, 'Manage'),
      M('contracts', 'Contracts & Exit', ScrollText, <ContractsResignationsAdminMod />, 'Manage'),
      M('myteam', 'My Team', Users, <MyTeamMod />, 'Manage'),
      M('myreviews', 'My Reviews', Star, <MyReviewsMod />, 'Manage'),
      M('teamreviews', 'Team Reviews', ClipboardList, <TeamReviewsMod />, 'Manage'),
      M('staffconduct', 'Staff Conduct', ShieldAlert, <StaffConductMod />, 'Manage'),
      M('alumni', 'Alumni', Handshake, <AlumniMod />, 'Alumni'),
      M('reports', 'Student Reports', FileBadge, <StudentReportsMod />, 'Manage'),
      M('defaulters', 'Fee Defaulters', Banknote, <FeeDefaultersAndCallsMod />, 'Finance'),
      M('disc', 'Discipline', Gavel, <DisciplinaryCommitteeMod />, 'Finance'),
      M('meet', 'Meetings', Video, <MeetingsMod />, 'Finance'),
      M('fees', 'Fee Setup', CreditCard, <FeeSetupMod />, 'Finance'),
      M('collect', 'Collections', Landmark, <CollectionsMod />, 'Finance'),
      M('scholarships', 'Scholarships', Award, <ScholarshipsMod />, 'Finance'),
      M('payroll', 'Payroll', Wallet, <PayrollMod />, 'Finance'),
      M('coa', 'Chart of Accounts', Calculator, <ChartOfAccountsMod />, 'Finance'),
      M('journal', 'Journal', NotebookPen, <JournalMod />, 'Finance'),
      M('acctreports', 'Accounting Reports', FileBarChart2, <AccountingReportsMod />, 'Finance'),
      M('canteenrecon', 'Canteen Reconciliation', Scale, <CanteenReconciliationMod />, 'Finance'),
      M('workingdays', 'Working Days & Periods', CalendarClock, <WorkingDaysMod />, 'System'),
      M('libsettings', 'Library Settings', BookMarked, <LibrarySettingsMod />, 'System'),
      M('udise', 'UDISE+ Export', FileBarChart2, <UdiseExportMod />, 'System'),
      M('settings', 'Settings', Settings, <SettingsMod />, 'System'),
      M('profile', 'Profile', UserCircle2, <ProfileMod />, 'Account'),
    ]
  }
}

/* ── small inline modules ──────────────────────────────── */

function StudentReportsMod() {
  const { db, user } = useStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { classOf, wardsOf, enrollments, currentYear } = useAcademic()
  if (!user) return null
  if (user.role === 'student') return <StudentReportMod studentId={user.id} />
  if (user.role === 'parent') {
    const wardIds = wardsOf(user.id)
    const child = db.users.find(u => wardIds.includes(u.id))
    if (!child) {
      return (
        <div>
          <PageHead title="Student Report" sub="No child linked to this parent account" />
          <Card><Empty text="No student linked to this parent account." /></Card>
        </div>
      )
    }
    return <StudentReportMod studentId={child.id} />
  }
  const students = db.users.filter(u => u.role === 'student')
  if (selectedId) return <StudentReportMod studentId={selectedId} />
  return (
    <div>
      <PageHead title="Student Reports" sub="Select a student to view the full dossier" />
      <div className="grid gap-4 md:grid-cols-2">
        {students.map(s => {
          const cls = classOf(s.id)
          const roll = enrollments.find(e => e.studentId === s.id && e.status === 'active' && (!currentYear || e.academicYearId === currentYear.id))?.rollNo
          return (
          <Card key={s.id} className="card-lift flex items-center gap-4">
            <Avatar name={s.name} hue={s.avatarHue} size={48} />
            <div className="flex-1">
              <p className="text-[15px] font-semibold">{s.name}</p>
              <p className="text-[13px] text-black/50 dark:text-white/50">{cls?.label ?? '—'} · Roll {roll ?? '—'}</p>
            </div>
            <button onClick={() => setSelectedId(s.id)} className="btn-ink px-4 py-2 text-[13px] font-semibold">View report</button>
          </Card>
          )
        })}
      </div>
    </div>
  )
}

// Roles a superadmin can promote/demote someone into via PATCH /users/:id/role (admin/staff/teacher only —
// student/parent/superadmin are out of scope for a role change; see phase-4-admissions-identity.md).
const ROLE_CHANGE_OPTIONS: Role[] = ['admin', 'staff', 'teacher']

function AdminManagementMod() {
  const { db, user, createUser, deleteUser, refreshDB } = useStore()
  const admins = useMemo(() => db.users.filter(u => u.role === 'admin' || u.role === 'superadmin').sort((a, b) => a.name.localeCompare(b.name)), [db.users])
  const [createOpen, setCreateOpen] = useState(false)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const submitCreate = async () => {
    setBusy('create')
    try {
      const res = await createUser({ name: name.trim(), role: 'admin', email: email.trim() || undefined })
      setCreated({ email: res.user.email, password: res.password })
      setName(''); setEmail('')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const changeRole = async (target: User, role: Role) => {
    if (role === target.role) return
    setBusy(target.id)
    try {
      await api.patch(`/users/${target.id}/role`, { role })
      await refreshDB()
      toast.success(`${target.name}'s role changed to ${role}`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  const revoke = async (a: User) => {
    if (!window.confirm(`Revoke ${a.name}'s admin access? This deletes their account.`)) return
    setBusy(a.id)
    const ok = await deleteUser(a.id)
    if (ok) toast.success('Admin access revoked')
    else toast.error('Could not revoke access')
    setBusy(null)
  }

  return (
    <div>
      <PageHead title="Admin Management" sub="Create school administrators, change staff roles, and revoke access">
        <button onClick={() => { setCreateOpen(true); setCreated(null) }} className="btn-ink px-5 py-2.5 text-[13.5px] font-semibold">New admin</button>
      </PageHead>
      <div className="grid gap-4">
        {admins.map(a => {
          const isSelf = a.id === user?.id
          const canChangeRole = isSuperAdmin(user) && !isSelf && a.role !== 'superadmin'
          const canRevoke = user ? canManage(user, a, db.users) : false
          return (
            <div key={a.id} className="flex flex-wrap items-center gap-4 rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-5">
              <Avatar name={a.name} hue={a.avatarHue} size={48} />
              <div className="min-w-48 flex-1">
                <p className="text-[15px] font-semibold">{a.name}{isSelf ? ' (you)' : ''}</p>
                <p className="text-[13px] text-black/50 dark:text-white/50">{a.email}</p>
              </div>
              {canChangeRole ? (
                <select value={a.role} onChange={e => changeRole(a, e.target.value as Role)} disabled={busy === a.id} className={`${inputCls} w-auto py-1.5 text-[12.5px] capitalize disabled:opacity-50`}>
                  {ROLE_CHANGE_OPTIONS.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
                </select>
              ) : (
                <Pill tone={a.role === 'superadmin' ? 'indigo' : 'slate'}><span className="capitalize">{a.role}</span></Pill>
              )}
              {canRevoke && (
                <button onClick={() => revoke(a)} disabled={busy === a.id} className="rounded-full bg-rose-50 dark:bg-rose-500/10 px-4 py-2 text-[13px] font-semibold text-rose-500 disabled:opacity-50">Revoke</button>
              )}
            </div>
          )
        })}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={created ? 'Admin created' : 'New admin'}>
        {created ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-4 text-[13px] text-amber-800 dark:text-amber-300">
              This password is shown only once — the new admin must change it at first sign-in.
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-4 py-3">
                <div className="min-w-0 flex-1"><p className="text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Email</p><p className="select-all truncate font-mono text-[14px]">{created.email}</p></div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl bg-black/[.04] dark:bg-white/[.06] px-4 py-3">
                <div className="min-w-0 flex-1"><p className="text-[11.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Password</p><p className="select-all truncate font-mono text-[14px]">{created.password}</p></div>
              </div>
            </div>
            <button onClick={() => setCreateOpen(false)} className="btn-ink w-full py-3 text-[14px] font-semibold">Done</button>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Full name"><input value={name} onChange={e => setName(e.target.value)} autoFocus className={inputCls} /></Field>
            <Field label="Email (optional — generated if left blank)"><input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} /></Field>
            <button onClick={submitCreate} disabled={!name.trim() || busy === 'create'} className="btn-ink w-full py-3 text-[14px] font-semibold disabled:opacity-40">{busy === 'create' ? 'Creating…' : 'Create admin'}</button>
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ── overview dashboards ───────────────────────────────── */

function Overview() {
  const { db, user, academic } = useStore()
  const { term } = useTerm()
  const { currentTerm, classOf, wardsOf, classesTaughtBy, templateFor } = useAcademic()
  const role = user!.role
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const termId = term || currentTerm?.id || ''
  const termName = db.terms.find(t => t.id === termId)?.name ?? 'this term'

  // Phase 3 tiles: attendance % and open homework for the viewed student (student → self, parent → first ward), class rank for students.
  const wardIds = role === 'parent' ? wardsOf(user!.id) : []
  const ward = role === 'parent' ? db.users.find(u => wardIds.includes(u.id)) : undefined
  const viewedId = role === 'student' ? user!.id : ward?.id
  const viewedClass = viewedId ? classOf(viewedId) : undefined
  const { data: attSummary } = useAttendanceSummary({ studentId: viewedId, termId }, !!viewedId)
  const { items: homework } = useHomework(viewedClass?.id, termId)
  const { data: reportCard } = useReportCard(role === 'student' ? user!.id : undefined, termId)

  // Phase 4: pending admissions/certificate applications, staff/admin only.
  const isStaffOrAdminRole = role === 'staff' || role === 'admin' || role === 'superadmin'
  const { items: pendingAppsItems } = useApplications({ status: 'Pending' }, isStaffOrAdminRole)

  // Phase 5: fee defaulters (staff/admin/teacher) and the viewed student's own due invoices.
  const { items: defaulterItems } = useDefaulters({ termId }, isStaffOrAdminRole || role === 'teacher')
  const { items: myInvoices } = useInvoices({ studentId: viewedId, termId }, !!viewedId)

  // Phase 6: pending leave approvals (teacher/staff/admin) and pending resignations (admin/superadmin).
  const { items: pendingLeaveItems } = useLeaveRequests({ scope: 'approvals', status: 'Pending' }, role === 'teacher' || isStaffOrAdminRole)
  const { items: pendingResignationItems } = useResignations(role === 'admin' || role === 'superadmin')

  // Phase 8: pending slips (parent) and open disciplinary cases (teacher/staff/admin).
  const { items: slipItems } = useSlips(role === 'parent')
  const { items: disciplineItems } = useDisciplinaryCases({}, role === 'teacher' || isStaffOrAdminRole)

  // today's periods for the "Next class" / "Classes today" tiles (students and teachers only)
  const now = useClock()
  const { data: myTT, loading: myTTLoading } = useMyTimetable(termId, { enabled: role === 'student' || role === 'teacher' })
  const lookup = useEntryLookup()
  const agenda = useMemo(() => {
    const entries = myTT?.entries ?? []
    const template = myTT?.template ?? templateFor(role === 'student' ? classOf(user!.id)?.id : entries[0]?.classId)
    return todayAgenda(entries, template, now)
  }, [myTT, templateFor, role, classOf, user, now])

  const cards: { k: string; v: string; s: string; tone: string }[] = useMemo(() => {
    const overall = attSummary && attSummary.overall.total > 0 ? `${Math.round(attSummary.overall.pct)}%` : '—'
    const pendingHw = (homework ?? []).filter(h => isOpen(homeworkStatus(h, viewedId))).length
    const slips = (slipItems ?? []).length
    const defaulters = (defaulterItems ?? []).length
    const pendingDisciplinary = (disciplineItems ?? []).filter(d => d.status !== 'Closed').length
    const pendingResignations = (pendingResignationItems ?? []).filter(r => r.status === 'Pending').length
    const pendingLeave = (pendingLeaveItems ?? []).length
    const pendingApps = pendingAppsItems?.length ?? 0
    const students = db.users.filter(u => u.role === 'student').length
    const teachers = db.users.filter(u => u.role === 'teacher').length
    const fmt = (n: number) => '₹' + n.toLocaleString('en-IN')
    switch (role) {
      case 'parent': {
        const due = (myInvoices ?? []).reduce((a, i) => a + Math.max(0, i.total - (i.paid ?? 0)), 0)
        return [
          { k: 'Attendance', v: overall, s: ward ? `${termName} · ${firstName(ward.name)}` : 'No ward linked yet', tone: 'from-emerald-500 to-teal-400' },
          { k: 'Pending homework', v: String(pendingHw), s: termName, tone: 'from-amber-500 to-orange-400' },
          { k: 'Slips to sign', v: String(slips), s: 'awaiting your decision', tone: 'from-indigo-500 to-violet-500' },
          { k: 'Fees due', v: due > 0 ? fmt(due) : '₹0', s: due > 0 ? 'outstanding' : 'nothing outstanding', tone: 'from-rose-500 to-pink-400' },
        ]
      }
      case 'student': {
        const cls = classOf(user!.id)
        const rank = reportCard?.overall.rank ?? undefined
        const up = agenda.running ?? agenda.next
        const nextTile = !myTT || !myTT.published
          ? { k: 'Next class', v: '—', s: myTTLoading ? 'loading timetable…' : 'timetable not published', tone: 'from-fuchsia-500 to-pink-500' }
          : up
            ? { k: agenda.running ? 'Now' : 'Next class', v: lookup.subjectOf(up.entry), s: [up.period.label, `${up.period.start} – ${up.period.end}`, lookup.roomOf(up.entry)].filter(Boolean).join(' · '), tone: 'from-fuchsia-500 to-pink-500' }
            : { k: 'Next class', v: agenda.today.length ? 'Done' : '—', s: agenda.today.length ? 'no more classes today' : 'no classes today', tone: 'from-fuchsia-500 to-pink-500' }
        return [
          nextTile,
          { k: 'Attendance', v: overall, s: termName, tone: 'from-emerald-500 to-teal-400' },
          { k: 'To submit', v: String(pendingHw), s: 'assignments open', tone: 'from-amber-500 to-orange-400' },
          { k: 'Class rank', v: rank ? `#${rank}` : '—', s: cls ? `${termName} · ${cls.label}` : 'not enrolled yet', tone: 'from-indigo-500 to-violet-500' },
          { k: 'My class', v: cls?.label ?? '—', s: cls ? `${academic.enrollments.filter(e => e.classId === cls.id && e.status === 'active').length} students` : 'ask the office to enrol you', tone: 'from-sky-500 to-cyan-400' },
        ]
      }
      case 'teacher': {
        const taught = classesTaughtBy(user!.id)
        const up = agenda.running ?? agenda.next
        const todaySub = up
          ? `${agenda.running ? 'now' : 'next'}: ${lookup.classLabelOf(up.entry) ?? ''} ${lookup.subjectOf(up.entry)} · ${up.period.start}`.trim()
          : agenda.today.length ? 'all done for today' : myTTLoading ? 'loading timetable…' : 'nothing scheduled today'
        return [
          { k: 'Classes today', v: String(agenda.today.length), s: todaySub, tone: 'from-fuchsia-500 to-pink-500' },
          { k: 'My classes', v: String(taught.length), s: taught.map(c => c.label).join(', ') || 'no assignments yet', tone: 'from-indigo-500 to-violet-500' },
          { k: 'Leave requests', v: String(pendingLeave), s: 'awaiting approval', tone: 'from-amber-500 to-orange-400' },
          { k: 'Fee defaulters', v: String(defaulters), s: 'students with dues', tone: 'from-rose-500 to-pink-400' },
          { k: 'Disciplinary', v: String(pendingDisciplinary), s: 'open cases', tone: 'from-sky-500 to-cyan-400' },
        ]
      }
      case 'staff': return [
        { k: 'Fee defaulters', v: String(defaulters), s: 'students with dues', tone: 'from-rose-500 to-pink-400' },
        { k: 'Applications', v: String(pendingApps), s: 'need a decision', tone: 'from-amber-500 to-orange-400' },
        { k: 'Disciplinary', v: String(pendingDisciplinary), s: 'open cases', tone: 'from-indigo-500 to-violet-500' },
        { k: 'Permission slips', v: String(slips), s: 'active', tone: 'from-sky-500 to-cyan-400' },
      ]
      case 'admin': return [
        { k: 'Students', v: String(students), s: `${academic.classes.length} classes`, tone: 'from-sky-500 to-cyan-400' },
        { k: 'Teachers', v: String(teachers), s: `${academic.subjects.length} subjects`, tone: 'from-indigo-500 to-violet-500' },
        { k: 'Fee defaulters', v: String(defaulters), s: 'students with dues', tone: 'from-rose-500 to-pink-400' },
        { k: 'Applications', v: String(pendingApps), s: 'need a decision', tone: 'from-amber-500 to-orange-400' },
      ]
      case 'superadmin': return [
        { k: 'Students', v: String(students), s: `${academic.classes.length} classes`, tone: 'from-sky-500 to-cyan-400' },
        { k: 'Teachers', v: String(teachers), s: `${academic.subjects.length} subjects`, tone: 'from-indigo-500 to-violet-500' },
        { k: 'Admins', v: String(db.users.filter(u => u.role === 'admin').length), s: 'school administrators', tone: 'from-fuchsia-500 to-pink-500' },
        { k: 'Resignations', v: String(pendingResignations), s: 'pending approval', tone: 'from-amber-500 to-orange-400' },
      ]
      default: return []
    }
  }, [db, academic, role, termName, user, classOf, classesTaughtBy, agenda, myTT, myTTLoading, lookup, attSummary, homework, reportCard, ward, viewedId, pendingAppsItems, defaulterItems, myInvoices, pendingLeaveItems, pendingResignationItems, slipItems, disciplineItems])

  const { items: calendarEvents } = useCalendarEvents({ termId: termId || undefined })
  const nextEvents = (calendarEvents ?? []).slice(0, 4)
  const isSetupRole = role === 'admin' || role === 'superadmin'
  const setupSteps = [
    { done: academic.years.length > 0, label: 'Create the academic year and its terms', where: 'Years & Terms' },
    { done: academic.boards.length > 0 && academic.grades.length > 0, label: 'Add the boards you run and the grade ladder', where: 'Boards & Grades' },
    { done: academic.curriculum.length > 0, label: 'Define each board’s grade-wise subjects', where: 'Curriculum' },
    { done: academic.classes.length > 0, label: 'Create sections and assign teachers', where: 'Classes & Sections' },
    { done: db.users.some(u => u.role === 'student'), label: 'Enrol students and link parents', where: 'People & Roles' },
  ]
  const setupComplete = setupSteps.every(s => s.done)

  return (
    <div>
      <div className="mb-8">
        <p className="text-[14px] font-medium text-black/45 dark:text-white/45">{greet},</p>
        <h1 className="font-display mt-1 text-[clamp(1.8rem,3.5vw,2.6rem)] font-medium tracking-tight">{firstName(user!.name)} 👋</h1>
        <p className="mt-1.5 text-[14.5px] text-black/50 dark:text-white/50">{user!.title}</p>
      </div>
      <div className={`grid gap-5 sm:grid-cols-2 ${cards.length === 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        {cards.map(c => (
          <div key={c.k} className="card-lift relative overflow-hidden rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-6">
            <div className={`absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${c.tone} opacity-[.13]`} />
            <p className="text-[12.5px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">{c.k}</p>
            <p className="font-display mt-2.5 text-4xl font-medium">{c.v}</p>
            <p className="mt-1 text-[12.5px] text-black/45 dark:text-white/45">{c.s}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-6">
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">Coming up</p>
          {nextEvents.length === 0 ? (
            <Empty text="No events on the calendar yet." />
          ) : (
            <div className="space-y-3">
              {nextEvents.map(e => (
                <div key={e.date + e.title} className="flex items-center gap-3.5">
                  <span className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl text-[11px] font-bold leading-none ${e.type === 'holiday' ? 'bg-rose-100 text-rose-600' : e.type === 'exam' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-600'}`}>
                    {new Date(e.date).getDate()}<span className="text-[8px] uppercase">{new Date(e.date).toLocaleString('en', { month: 'short' })}</span>
                  </span>
                  <span className="flex-1 text-[14px] font-medium">{e.title}</span>
                  <span className="text-[11.5px] capitalize text-black/40 dark:text-white/40">{e.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {isSetupRole && !setupComplete ? (
          <div className="rounded-3xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/60 dark:bg-indigo-500/10 p-6">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">Set up your school</p>
            <ol className="mt-4 space-y-3">
              {setupSteps.map((s, i) => (
                <li key={s.label} className="flex items-start gap-3 text-[14px]">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${s.done ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-[#14141f] text-black/50 dark:text-white/50 border border-black/10 dark:border-white/15'}`}>
                    {s.done ? '✓' : i + 1}
                  </span>
                  <span className={s.done ? 'text-black/40 dark:text-white/40 line-through' : ''}>
                    {s.label} <span className="text-black/40 dark:text-white/40">· {s.where}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="rounded-3xl border border-black/[.06] dark:border-white/[.08] bg-white dark:bg-[#14141f] p-6">
            <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">This term</p>
            <p className="font-display text-2xl font-medium">{termName}</p>
            <p className="mt-1 text-[13.5px] text-black/50 dark:text-white/50">{db.terms.find(t => t.id === termId)?.range ?? 'No term selected'}</p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── shell ─────────────────────────────────────────────── */

const ROLE_GRAD: Record<Role, string> = {
  parent: 'from-indigo-500 to-violet-500', student: 'from-sky-500 to-cyan-400',
  teacher: 'from-emerald-500 to-teal-400', staff: 'from-amber-500 to-orange-400', admin: 'from-rose-500 to-pink-400',
  superadmin: 'from-fuchsia-500 to-pink-500',
}

export default function Portal() {
  const { user, logout } = useStore()
  const { currentTerm } = useAcademic()
  const navigate = useNavigate()
  const [active, setActive] = useState('home')
  const { memberships } = useGroupMemberships()
  const mods = useMemo(() => {
    const list = modulesFor(user?.role ?? 'parent', setActive)
    if (user?.isCounselor) list.push({ id: 'counseling', label: 'Counseling Records', icon: HeartHandshake, el: <CounselingRecordsMod />, group: 'Manage' })
    if (memberships.length > 0) list.push({ id: 'group', label: 'Group', icon: Network, el: <GroupMod />, group: 'Manage' })
    return list
  }, [user?.role, user?.isCounselor, memberships.length])
  // '' means "follow the school's current term" until the user picks one explicitly.
  const [pickedTerm, setTerm] = useState('')
  const term = pickedTerm || currentTerm?.id || ''
  const current = mods.find(m => m.id === active) ?? mods[0]
  const headerPhoto = useFileUrl(user?.photoFileId)
  const groups = useMemo(() => {
    const g: Record<string, Mod[]> = {}
    mods.forEach(m => { (g[m.group] ??= []).push(m) })
    return g
  }, [mods])

  if (!user) return null

  return (
    <TermCtx.Provider value={{ term, setTerm }}>
      <div className="flex min-h-screen bg-[#f6f6f4] dark:bg-[#090911]">
        {/* sidebar */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-black/[.06] dark:border-white/[.08] bg-white/80 dark:bg-[#14141f]/90 backdrop-blur lg:flex">
          <div className="flex h-[68px] items-center px-6"><Link to="/"><Logo size={30} /></Link></div>
          <nav className="flex-1 overflow-y-auto px-3 pb-4 thin-scroll">
            {Object.entries(groups).map(([g, items]) => (
              <div key={g} className="mt-4 first:mt-1">
                <p className="px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[.16em] text-black/30 dark:text-white/30">{g}</p>
                {items.map(m => (
                  <button key={m.id} onClick={() => setActive(m.id)}
                    className={`mb-0.5 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors ${active === m.id ? 'bg-black text-white shadow-sm' : 'text-black/60 dark:text-white/60 hover:bg-black/[.04] dark:hover:bg-white/[.08] hover:text-black dark:hover:text-white'}`}>
                    <m.icon size={16.5} className={active === m.id ? 'text-white' : 'text-black/40 dark:text-white/40'} />
                    {m.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="border-t border-black/[.06] dark:border-white/[.08] p-3">
            <div className="mb-1 px-1">
              <InstallButton variant="pill" className="w-full justify-center" />
            </div>
            <button onClick={() => { logout(); navigate('/') }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium text-rose-500 hover:bg-rose-50">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </aside>

        {/* main */}
        <div className="flex-1 lg:pl-64">
          <header className="glass-nav sticky top-0 z-30 flex h-[68px] items-center justify-between px-5 sm:px-8">
            <div className="flex items-center gap-3 lg:hidden"><Link to="/"><Logo size={28} /></Link></div>
            <p className="hidden text-[13.5px] font-medium text-black/45 dark:text-white/45 lg:block">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <div className="flex items-center gap-3">
              {!user.verified && user.role === 'parent' && <Pill tone="amber"><ShieldCheck size={12} /> unverified</Pill>}
              <NotificationBell onNavigate={setActive} />
              <ThemeToggle />
              <span className={`hidden rounded-full bg-gradient-to-r px-3.5 py-1.5 text-[12px] font-bold capitalize text-white sm:block ${ROLE_GRAD[user.role]}`}>
                {user.role} portal
              </span>
              <button onClick={() => setActive('profile')} className="rounded-full ring-2 ring-transparent transition hover:ring-indigo-300 dark:hover:ring-indigo-500/50" title="Profile">
                <Avatar name={user.name} hue={user.avatarHue} size={38} src={headerPhoto} />
              </button>
            </div>
          </header>

          <main key={active} className="module-in mx-auto max-w-6xl px-4 py-6 pb-28 sm:px-8 sm:py-8 lg:pb-10">{current.el}</main>
        </div>

        {/* ── mobile bottom navigation ── */}
        <MobileNav mods={mods} active={active} setActive={setActive} />
      </div>
    </TermCtx.Provider>
  )
}

/* ── app-style bottom nav for phones ───────────────────── */

function MobileNav({ mods, active, setActive }: { mods: Mod[]; active: string; setActive: (id: string) => void }) {
  const [more, setMore] = useState(false)
  const { logout, user } = useStore()
  const navigate = useNavigate()
  const primary = mods.slice(0, 4)
  const activeInPrimary = primary.some(m => m.id === active)
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-black/[.07] dark:border-white/[.09] bg-white/85 dark:bg-[#10101a]/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {primary.map(m => (
          <button key={m.id} onClick={() => { setActive(m.id); setMore(false) }}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors ${active === m.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-black/40 dark:text-white/40'}`}>
            {active === m.id && <span className="absolute -top-px h-0.5 w-8 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" />}
            <m.icon size={20} />
            {m.label.split(' ')[0]}
          </button>
        ))}
        <button onClick={() => setMore(true)}
          className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors ${more || !activeInPrimary ? 'text-indigo-600 dark:text-indigo-400' : 'text-black/40 dark:text-white/40'}`}>
          {(more || !activeInPrimary) && <span className="absolute -top-px h-0.5 w-8 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" />}
          <LayoutGrid size={20} />
          More
        </button>
      </nav>

      {/* more sheet */}
      {more && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="fade-in absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMore(false)} />
          <div className="sheet-up absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-[2rem] bg-white dark:bg-[#12121c] p-5 pb-8 thin-scroll">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" />
            <div className="mb-5 flex items-center gap-3.5 px-1">
              <Avatar name={user?.name ?? ''} hue={user?.avatarHue} size={44} />
              <div className="flex-1">
                <p className="text-[15px] font-semibold">{user?.name}</p>
                <p className="text-[12px] capitalize text-black/45 dark:text-white/45">{user?.role} portal</p>
              </div>
              <ThemeToggle />
            </div>
            {Object.entries(mods.reduce((g: Record<string, Mod[]>, m) => { (g[m.group] ??= []).push(m); return g }, {})).map(([g, items]) => (
              <div key={g} className="mb-4">
                <p className="px-1 pb-2 text-[10.5px] font-bold uppercase tracking-[.16em] text-black/30 dark:text-white/30">{g}</p>
                <div className="grid grid-cols-4 gap-2">
                  {items.map(m => (
                    <button key={m.id} onClick={() => { setActive(m.id); setMore(false) }}
                      className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 text-[10.5px] font-semibold transition-colors ${active === m.id ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' : 'text-black/55 dark:text-white/55 hover:bg-black/[.04] dark:hover:bg-white/[.08]'}`}>
                      <m.icon size={20} />
                      <span className="line-clamp-1 px-1 text-center leading-tight">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="mt-2 flex gap-2 px-1">
              <button onClick={() => { logout(); navigate('/') }}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-rose-50 dark:bg-rose-500/10 py-3 text-[13px] font-semibold text-rose-500">
                <LogOut size={15} /> Sign out
              </button>
            </div>
            <div className="mt-2 px-1">
              <InstallButton variant="row" />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
